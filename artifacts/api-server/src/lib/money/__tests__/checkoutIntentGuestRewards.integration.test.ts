/**
 * In-app cart payment (routes/checkout-intent.ts) for what used to force the
 * hosted Stripe page. Real Postgres, in-memory Stripe:
 *  - BT-257: a guest pays in the app with no account. The guest mount needs
 *    no Clerk session, returns a guestAccessToken that status and cancel
 *    require (only its hash is stored), refuses rewards and gift cards, and
 *    the paid webhook makes guest orders;
 *  - BT-258: a preorder group keeps its held charge plan (paid out when it
 *    ships), next to an in-stock group in the same payment;
 *  - BT-270: one Thread Cash token is split across two stores, each store's
 *    card share stays at or above 50¢, cancel gives it back, a new attempt
 *    re-splits, and the paid webhook spends each store's share once and tops
 *    each seller up;
 *  - BT-258: loyalty points on a one-store in-app payment are settled by the
 *    same webhook path as hosted Checkout.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push")>()),
  sendPushToUser: async () => {},
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
  sendReturnStatusEmail: async () => true,
}));
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const user = req.headers["x-test-user"];
    if (!user) return void res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = user;
    next();
  },
}));
// The checkout flag stays OFF by default in production (Dev's sign-off);
// these tests run the flow as it works once it is turned on.
vi.mock("../../threadCash/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../threadCash/wallet")>()),
  isFeatureEnabled: async () => true,
}));

// Before any import: guest-checkout.ts reads it when it loads.
vi.hoisted(() => { process.env.SESSION_SECRET ||= "checkout-intent-guest-test-secret"; });

import { db, checkoutSessions, loyaltyPoints, orders, shippingRates, threadCashEntries } from "@workspace/db";
import { and, eq, inArray, like } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { handleCartPaymentSucceeded } from "../../../routes/webhooks";
import checkoutIntentRouter, { guestCheckoutIntentRouter } from "../../../routes/checkout-intent";
import { redeemLoyaltyPoints } from "../../../routes/loyalty";
import { cancelThreadCashRedemption, getBalanceCents, redeemThreadCash } from "../../threadCash/wallet";
import {
  call, expectLedgerBalanced, seedBuyer, seedDrop, seedProduct, seedSeller, startApp, uid,
} from "./moneyHarness";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/guest/checkout/payment-intent", guestCheckoutIntentRouter);
    server.use("/api/buyer/checkout/payment-intent", checkoutIntentRouter);
    server.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: String(err?.stack ?? err) });
    });
  });
});
afterAll(async () => {
  await app.close();
  await expectLedgerBalanced();
});
beforeEach(() => {
  fake.reset();
  // Round numbers below; the loyalty test turns tax back on to check it is charged on the discounted amount.
  fake.state.taxRate = 0;
});

const address = {
  recipientName: "Jordan Reyes", street: "148 Mercer Street", line2: "Apt 4",
  city: "New York", state: "NY", postalCode: "10012", country: "US",
};

function body(groups: unknown[], extra: Record<string, unknown> = {}) {
  return {
    groups,
    contactEmail: `guest-${uid("mail")}@test.local`,
    contactPhone: "+1 503 555 0100",
    shippingAddress: address,
    clientIdempotencyKey: uid("pay"),
    ...extra,
  };
}

async function guestPost(path: string, payload: unknown) {
  const response = await fetch(`${app.base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() as any };
}

function succeeded(intentId: string) {
  const intent = fake.state.paymentIntents.get(intentId);
  intent.status = "succeeded";
  intent.amount_received = intent.amount;
  intent.latest_charge = `ch_${intentId}`;
  return intent;
}

async function ordersFor(intentId: string) {
  const rows = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, intentId));
  const made = rows.length
    ? await db.select().from(orders).where(inArray(orders.stripeCheckoutSessionId, rows.map((row) => row.stripeSessionId!)))
    : [];
  return { rows, made };
}

async function twoStores(tag: string) {
  const sellerA = await seedSeller(`${tag}-a`);
  const sellerB = await seedSeller(`${tag}-b`);
  const productA = await seedProduct(sellerA, { priceCents: 5_000, stock: 5 });
  const productB = await seedProduct(sellerB, { priceCents: 1_000, stock: 5 });
  await db.insert(shippingRates).values({ id: uid("rate"), sellerId: sellerA, name: "Standard", flatRateCents: 1_200 });
  return {
    sellerA, sellerB,
    groups: [
      { items: [{ variantId: productA.variantId, productId: productA.productId, quantity: 1 }] },
      { items: [{ variantId: productB.variantId, productId: productB.productId, quantity: 1 }] },
    ],
  };
}

describe("guest in-app payment (BT-257)", () => {
  it("needs no account, hands back a token only it can use, and makes guest orders when paid", async () => {
    const cart = await twoStores("guest-pay");
    const payload = body(cart.groups);
    const quote = await guestPost("/api/guest/checkout/payment-intent/quote", { groups: cart.groups, shippingAddress: { postalCode: "10012", country: "US" } });
    expect(quote.status).toBe(200);
    expect(quote.body.amountCents).toBe(5_000 + 1_200 + 1_000);

    const created = await guestPost("/api/guest/checkout/payment-intent", payload);
    expect(created.status).toBe(200);
    expect(created.body.guestAccessToken).toHaveLength(43);
    expect(created.body.amountCents).toBe(7_200);
    const intent = fake.state.paymentIntents.get(created.body.paymentIntentId);
    expect(intent.customer).toBeUndefined();
    expect(intent.setup_future_usage).toBeUndefined();
    expect(intent.metadata).toMatchObject({ kind: "cart_checkout", guest: "true" });

    const { rows } = await ordersFor(created.body.paymentIntentId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.buyerId).toBeNull();
      expect(row.guestEmail).toBe(payload.contactEmail);
      expect(row.guestAccessTokenHash).toHaveLength(64);
      expect(row.guestAccessTokenHash).not.toBe(created.body.guestAccessToken);
    }

    // A retry with the same key returns the same intent and token.
    const retried = await guestPost("/api/guest/checkout/payment-intent", payload);
    expect(retried.body.paymentIntentId).toBe(created.body.paymentIntentId);
    expect(retried.body.guestAccessToken).toBe(created.body.guestAccessToken);
    // Someone else's email can't take over that key.
    const hijack = await guestPost("/api/guest/checkout/payment-intent", { ...payload, contactEmail: "other@test.local" });
    expect(hijack.body.paymentIntentId).not.toBe(created.body.paymentIntentId);

    const statusPath = `/api/guest/checkout/payment-intent/${created.body.paymentIntentId}/status`;
    expect((await guestPost(statusPath, { guestAccessToken: "x".repeat(43) })).status).toBe(404);
    const unpaid = await guestPost(statusPath, { guestAccessToken: created.body.guestAccessToken });
    expect(unpaid.status).toBe(200);
    expect(unpaid.body.paymentStatus).toBe("unpaid");

    await handleCartPaymentSucceeded(succeeded(created.body.paymentIntentId), `evt_${uid("pi")}`, new Date());
    const paid = await guestPost(statusPath, { guestAccessToken: created.body.guestAccessToken });
    expect(paid.body).toMatchObject({ paymentStatus: "paid", complete: true });
    const { made } = await ordersFor(created.body.paymentIntentId);
    expect(made).toHaveLength(2);
    for (const order of made) {
      expect(order.buyerId).toBeNull();
      expect(order.guestEmail).toBe(payload.contactEmail);
      expect(order.chargeModel).toBe("transfer");
    }
  });

  it("is not reachable through the signed-in mount without an account", async () => {
    const cart = await twoStores("guest-signed-in-only");
    const res = await guestPost("/api/buyer/checkout/payment-intent", body(cart.groups));
    expect(res.status).toBe(401);
  });

  it("refuses rewards, gift cards and card data for guests", async () => {
    const cart = await twoStores("guest-refusals");
    const rewards = await guestPost("/api/guest/checkout/payment-intent", body(cart.groups, { threadCashToken: "TCASH-ABC-123" }));
    expect(rewards.status).toBe(400);
    expect(rewards.body.code).toBe("REWARDS_NEED_ACCOUNT");
    const gift = await guestPost("/api/guest/checkout/payment-intent", body([{ ...cart.groups[0], giftCard: { code: "GIFT-1234" } }]));
    expect(gift.status).toBe(400);
    expect(gift.body.code).toBe("GIFT_CARD_NEEDS_ACCOUNT");
    const card = await guestPost("/api/guest/checkout/payment-intent", body(cart.groups, { cardNumber: "4242 4242 4242 4242" }));
    expect(card.status).toBe(400);
    expect(card.body.code).toBe("CARD_DATA_REJECTED");
    expect(fake.state.paymentIntents.size).toBe(0);
  });

  it("lets the guest cancel with the token, and gives the stock back", async () => {
    const cart = await twoStores("guest-cancel");
    const created = await guestPost("/api/guest/checkout/payment-intent", body(cart.groups));
    const cancelPath = `/api/guest/checkout/payment-intent/${created.body.paymentIntentId}/cancel`;
    expect((await guestPost(cancelPath, { guestAccessToken: "y".repeat(43) })).status).toBe(404);
    const cancelled = await guestPost(cancelPath, { guestAccessToken: created.body.guestAccessToken });
    expect(cancelled.status).toBe(200);
    expect(fake.state.paymentIntents.get(created.body.paymentIntentId).status).toBe("canceled");
  });
});

describe("preorders in the app (BT-258)", () => {
  it("keeps a preorder group held next to an in-stock group in one payment", async () => {
    const preSeller = await seedSeller("pre-inapp");
    const stockSeller = await seedSeller("stock-inapp");
    const buyer = await seedBuyer("pre-inapp");
    const drop = await seedDrop(preSeller);
    const preorder = await seedProduct(preSeller, { priceCents: 4_000, dropId: drop.id });
    const inStock = await seedProduct(stockSeller, { priceCents: 2_000 });
    const groups = [
      { items: [{ variantId: preorder.variantId, productId: preorder.productId, quantity: 1 }] },
      { items: [{ variantId: inStock.variantId, productId: inStock.productId, quantity: 1 }] },
    ];
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyer, body(groups));
    expect(res.status).toBe(200);
    const { rows } = await ordersFor(res.body.paymentIntentId);
    const preRow = rows.find((row) => row.sellerId === preSeller)!;
    expect(preRow).toMatchObject({ chargeModel: "held", dropId: drop.id });
    expect(rows.find((row) => row.sellerId === stockSeller)).toMatchObject({ chargeModel: "transfer", dropId: null });

    await handleCartPaymentSucceeded(succeeded(res.body.paymentIntentId), `evt_${uid("pi")}`, new Date());
    const { made } = await ordersFor(res.body.paymentIntentId);
    const preOrder = made.find((order) => order.ownerId === preSeller)!;
    expect(preOrder).toMatchObject({ chargeModel: "held", fundsState: "held", dropId: drop.id });
    // Paid out only when it ships: the only transfer so far is the in-stock seller's.
    expect(fake.state.transfers.map((transfer: any) => transfer.destination)).not.toContain(`acct_${preSeller.replace(/-/g, "_")}`);
    expect(made.find((order) => order.ownerId === stockSeller)).toMatchObject({ chargeModel: "transfer", fundsState: "released" });
  });
});

describe("Thread Cash across stores (BT-270)", () => {
  it("splits one token across stores, gives it back on cancel, and spends each share once when paid", async () => {
    const cart = await twoStores("tc-split");
    const buyer = await seedBuyer("tc-split");
    await db.insert(threadCashEntries).values({ buyerId: buyer, amountCents: 3_000, source: "daily_checkin", referenceId: uid("grant") });
    const redeemed = await redeemThreadCash(buyer, 1_500, uid("redeem"));
    expect(await getBalanceCents(db, buyer)).toBe(1_500);

    const quote = await call(app.base, "POST", "/api/buyer/checkout/payment-intent/quote", buyer, {
      groups: cart.groups, shippingAddress: { postalCode: "10012", country: "US" }, threadCashToken: redeemed.token,
    });
    expect(quote.status).toBe(200);
    expect(quote.body.amountCents).toBe(7_200 - 1_500);

    const first = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyer, body(cart.groups, { threadCashToken: redeemed.token }));
    expect(first.status).toBe(200);
    expect(first.body.amountCents).toBe(7_200 - 1_500);
    const shares = first.body.groups.map((group: any) => group.threadCashCents);
    expect(shares.reduce((a: number, b: number) => a + b, 0)).toBe(1_500);
    for (const group of first.body.groups) expect(group.totalCents).toBeGreaterThanOrEqual(50);
    const firstRows = (await ordersFor(first.body.paymentIntentId)).rows;
    expect(firstRows.every((row) => row.threadCashToken?.startsWith(`${redeemed.token}-S1-`))).toBe(true);
    expect(await getBalanceCents(db, buyer)).toBe(1_500);

    // Backing out releases the children; the next attempt splits again.
    const cancel = await call(app.base, "POST", `/api/buyer/checkout/payment-intent/${first.body.paymentIntentId}/cancel`, buyer, {});
    expect(cancel.status).toBe(200);
    const second = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyer, body(cart.groups, { threadCashToken: redeemed.token }));
    expect(second.status).toBe(200);
    const secondRows = (await ordersFor(second.body.paymentIntentId)).rows;
    expect(secondRows.every((row) => row.threadCashToken?.startsWith(`${redeemed.token}-S2-`))).toBe(true);
    expect(await getBalanceCents(db, buyer)).toBe(1_500);

    await handleCartPaymentSucceeded(succeeded(second.body.paymentIntentId), `evt_${uid("pi")}`, new Date());
    await handleCartPaymentSucceeded(succeeded(second.body.paymentIntentId), `evt_${uid("pi")}`, new Date()); // redelivery
    const { made } = await ordersFor(second.body.paymentIntentId);
    expect(made).toHaveLength(2);
    expect(made.reduce((sum, order) => sum + (order.threadCashAppliedCents ?? 0), 0)).toBe(1_500);
    const children = await db.select().from(threadCashEntries).where(and(
      eq(threadCashEntries.buyerId, buyer), like(threadCashEntries.referenceId, `${redeemed.token}-S2-%`),
    ));
    expect(children).toHaveLength(2);
    expect(children.every((child) => child.usedOrderId)).toBe(true);
    // Brandthread funds it: each seller is topped up for its share, once.
    for (const order of made) {
      expect(order.stripeThreadCashTransferId).toBeTruthy();
      const topups = fake.state.transfers.filter((transfer: any) => transfer.metadata?.orderId === order.id && transfer.metadata?.kind === "thread_cash_seller_topup");
      expect(topups).toHaveLength(1);
      expect(topups[0].amount).toBe(order.threadCashAppliedCents);
    }
    expect(await getBalanceCents(db, buyer)).toBe(1_500);
    await expect(cancelThreadCashRedemption(buyer, redeemed.token)).rejects.toMatchObject({ code: "THREAD_CASH_TOKEN_USED" });
  });

  it("refuses Thread Cash that would leave a store under Stripe's minimum", async () => {
    const cart = await twoStores("tc-too-much");
    const buyer = await seedBuyer("tc-too-much");
    await db.insert(threadCashEntries).values({ buyerId: buyer, amountCents: 10_000, source: "daily_checkin", referenceId: uid("grant") });
    const redeemed = await redeemThreadCash(buyer, 7_200 - 99, uid("redeem"));
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyer, body(cart.groups, { threadCashToken: redeemed.token }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("THREAD_CASH_DISCOUNT_TOO_LARGE");
    expect(fake.state.paymentIntents.size).toBe(0);
    // The token is untouched and can still be cancelled back to the balance.
    expect((await cancelThreadCashRedemption(buyer, redeemed.token)).returnedCents).toBe(7_101);
  });

  it("re-splits a token into one store when the buyer drops a store between attempts", async () => {
    const cart = await twoStores("tc-drop-store");
    const buyer = await seedBuyer("tc-drop-store");
    await db.insert(threadCashEntries).values({ buyerId: buyer, amountCents: 2_000, source: "daily_checkin", referenceId: uid("grant") });
    const redeemed = await redeemThreadCash(buyer, 1_000, uid("redeem"));
    const both = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyer, body(cart.groups, { threadCashToken: redeemed.token }));
    await call(app.base, "POST", `/api/buyer/checkout/payment-intent/${both.body.paymentIntentId}/cancel`, buyer, {});
    const one = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyer, body([cart.groups[0]], { threadCashToken: redeemed.token }));
    expect(one.status).toBe(200);
    expect(one.body.groups[0].threadCashCents).toBe(1_000);
    const [row] = (await ordersFor(one.body.paymentIntentId)).rows;
    expect(row.threadCashToken).toBe(`${redeemed.token}-S2-1`);
    expect(await getBalanceCents(db, buyer)).toBe(1_000);
  });

  it("cancelling a split token returns what its children hold", async () => {
    const cart = await twoStores("tc-cancel-split");
    const buyer = await seedBuyer("tc-cancel-split");
    await db.insert(threadCashEntries).values({ buyerId: buyer, amountCents: 2_000, source: "daily_checkin", referenceId: uid("grant") });
    const redeemed = await redeemThreadCash(buyer, 1_000, uid("redeem"));
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyer, body(cart.groups, { threadCashToken: redeemed.token }));
    expect(res.status).toBe(200);
    // Still attached to the open payment: can't be pulled out from under it.
    await expect(cancelThreadCashRedemption(buyer, redeemed.token)).rejects.toMatchObject({ code: "THREAD_CASH_TOKEN_RESERVED" });
    await call(app.base, "POST", `/api/buyer/checkout/payment-intent/${res.body.paymentIntentId}/cancel`, buyer, {});
    const returned = await cancelThreadCashRedemption(buyer, redeemed.token);
    expect(returned.returnedCents).toBe(1_000);
    expect(await getBalanceCents(db, buyer)).toBe(2_000);
  });
});

describe("loyalty points in the app (BT-258)", () => {
  it("takes loyalty off a one-store payment and the webhook spends the token", async () => {
    const seller = await seedSeller("loyalty-inapp");
    const buyer = await seedBuyer("loyalty-inapp");
    const product = await seedProduct(seller, { priceCents: 5_000 });
    await db.insert(loyaltyPoints).values({ buyerId: buyer, points: 1_000, source: "bonus", referenceId: uid("bonus") });
    const redeemed = await redeemLoyaltyPoints(buyer, 500);
    const groups = [{ items: [{ variantId: product.variantId, productId: product.productId, quantity: 1 }] }];
    fake.state.taxRate = 0.08;
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyer, body(groups, { loyaltyToken: redeemed.token }));
    expect(res.status).toBe(200);
    // Tax on the discounted $45, as hosted Checkout's coupon does: 4,500 + 360.
    expect(res.body.amountCents).toBe(4_860);
    expect(res.body.groups[0]).toMatchObject({ loyaltyCents: 500, threadCashCents: 0, taxCents: 360 });

    await handleCartPaymentSucceeded(succeeded(res.body.paymentIntentId), `evt_${uid("pi")}`, new Date());
    const { made } = await ordersFor(res.body.paymentIntentId);
    expect(made).toHaveLength(1);
    expect(made[0].discountAmountCents).toBe(500);
    const [token] = await db.select().from(loyaltyPoints).where(and(eq(loyaltyPoints.buyerId, buyer), eq(loyaltyPoints.referenceId, redeemed.token)));
    expect(token.usedOrderId).toBe(made[0].id);
  });

  it("keeps loyalty to one store", async () => {
    const cart = await twoStores("loyalty-two");
    const buyer = await seedBuyer("loyalty-two");
    await db.insert(loyaltyPoints).values({ buyerId: buyer, points: 1_000, source: "bonus", referenceId: uid("bonus") });
    const redeemed = await redeemLoyaltyPoints(buyer, 500);
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyer, body(cart.groups, { loyaltyToken: redeemed.token }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LOYALTY_ONE_STORE");
  });
});
