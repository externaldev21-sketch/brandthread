/**
 * Brandthread-funded first-order discount ($5 off a buyer's first paid
 * order) through the in-app one-page checkout, against real Postgres and the
 * in-memory Stripe:
 *  - eligibility: flag on, signed-in buyer, no kept paid order, merchandise
 *    of at least $10; one seller group only;
 *  - the buyer is charged $5 less, the seller is still paid the full price
 *    (normal order transfer + a $5 platform-funded top-up), the platform fee
 *    stays on the full price, and the ledger balances;
 *  - once per buyer: a retried webhook never tops up twice, a racing second
 *    checkout can't hold it too, and a later order gets nothing;
 *  - a cancelled checkout gives it back; a fully refunded order reverses the
 *    top-up and makes the buyer eligible again;
 *  - flag off: nothing changes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../push")>()),
  normalizePushEventCategory: () => "orders",
  sendPushToUser: async () => {},
  stableNotificationId: (...parts: string[]) => parts.join(":"),
}));
vi.mock("../../brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../brandthreadEmail")>()),
  sendOrderConfirmationEmail: async () => true,
  sendOrderShippingEmail: async () => true,
  sendReturnStatusEmail: async () => true,
}));
vi.mock("../../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.headers["x-test-user"];
    next();
  },
}));
// The flag is seeded OFF. Flip it per test without touching the shared
// feature_flags row other test files read.
const flags = vi.hoisted(() => ({ firstOrder: true }));
vi.mock("../../threadCash/wallet", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../threadCash/wallet")>()),
  isFeatureEnabled: async (key: string) => key === "firstOrderPlatformDiscount" ? flags.firstOrder : false,
}));

import { db, checkoutSessions, firstOrderDiscounts, orders, shippingRates } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { handleCartPaymentSucceeded } from "../../../routes/webhooks";
import checkoutIntentRouter from "../../../routes/checkout-intent";
import { refundOrder } from "../refunds";
import {
  FIRST_ORDER_DISCOUNT_CENTS, firstOrderDiscountForGroup, isFirstOrderDiscountEligible, reserveFirstOrderDiscount,
} from "../../firstOrderDiscount";
import { call, expectLedgerBalanced, orderLedger, seedBuyer, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";

const PATH = "/api/buyer/checkout/payment-intent";
const TAX = (cents: number) => Math.round(cents * 0.08); // fake Stripe Tax rate

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp((server) => {
    server.use(PATH, checkoutIntentRouter);
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
  flags.firstOrder = true;
});

const address = {
  recipientName: "Jordan Reyes", street: "148 Mercer Street", line2: null,
  city: "New York", state: "NY", postalCode: "10012", country: "US",
};
type Groups = Array<{ items: Array<{ variantId: string; productId: string; quantity: number }> }>;
const payBody = (groups: Groups) => ({
  groups, contactEmail: "buyer@test.local", contactPhone: "+1 503 555 0100",
  shippingAddress: address, clientIdempotencyKey: uid("pay"),
});
const quote = (buyer: string, groups: Groups) =>
  call(app.base, "POST", `${PATH}/quote`, buyer, { groups, shippingAddress: { postalCode: "10012", country: "US" } });

async function cart(tag: string, priceCents = 4_000) {
  const seller = await seedSeller(tag);
  // This suite measures the platform discount independently of shipping.
  await db.insert(shippingRates).values({id: uid("free-shipping"), sellerId: seller, flatRateCents: 0});
  const buyer = await seedBuyer(tag);
  const product = await seedProduct(seller, { priceCents, stock: 10 });
  const groups: Groups = [{ items: [{ variantId: product.variantId, productId: product.productId, quantity: 1 }] }];
  return { seller, buyer, product, groups };
}

async function claimOf(buyerId: string) {
  const [row] = await db.select().from(firstOrderDiscounts).where(eq(firstOrderDiscounts.buyerId, buyerId));
  return row;
}

function succeeded(intentId: string) {
  const intent = fake.state.paymentIntents.get(intentId);
  intent.status = "succeeded";
  intent.amount_received = intent.amount;
  intent.latest_charge = `ch_${intentId}`;
  return intent;
}

async function payAndConfirm(buyer: string, groups: Groups) {
  const res = await call(app.base, "POST", PATH, buyer, payBody(groups));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const intent = succeeded(res.body.paymentIntentId);
  await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
  const made = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, intent.id));
  return { res, intent, made };
}

describe("first-order discount rule", () => {
  it("needs at least $10 of merchandise", () => {
    expect(firstOrderDiscountForGroup(999)).toBe(0);
    expect(firstOrderDiscountForGroup(1_000)).toBe(FIRST_ORDER_DISCOUNT_CENTS);
    expect(FIRST_ORDER_DISCOUNT_CENTS).toBe(500);
  });
});

describe("first-order discount at checkout", () => {
  it("takes $5 off the first order while the seller is still paid the full price", async () => {
    const c = await cart("first");
    const q = await quote(c.buyer, c.groups);
    expect(q.status).toBe(200);
    const fullTotal = 4_000 + TAX(4_000);
    expect(q.body.groups[0]).toMatchObject({ discountCents: 500, firstOrderDiscountCents: 500, totalCents: fullTotal - 500 });
    expect(q.body.amountCents).toBe(fullTotal - 500);

    const { res, intent, made } = await payAndConfirm(c.buyer, c.groups);
    expect(res.body.amountCents).toBe(fullTotal - 500);
    expect(intent.amount).toBe(fullTotal - 500);
    expect(made).toHaveLength(1);
    const order = made[0];
    // The seller's discount and the fee basis ignore the platform discount.
    expect(order.discountAmountCents).toBe(0);
    expect(order.platformFeeCents).toBe(200); // 5% of the full $40
    expect(order.grossChargedCents).toBe(fullTotal - 500);

    const claim = await claimOf(c.buyer);
    expect(claim).toMatchObject({ status: "applied", orderId: order.id, sellerId: c.seller, amountCents: 500 });
    const topups = fake.state.transfers.filter((t) => t.metadata?.kind === "first_order_discount_topup");
    expect(topups).toHaveLength(1);
    expect(topups[0]).toMatchObject({ amount: 500, transfer_group: order.id, idempotencyKey: `first-order-discount/${order.id}` });
    expect(topups[0].source_transaction).toBeUndefined(); // from Brandthread's own balance
    expect(claim.stripeTransferId).toBe(topups[0].id);

    // Seller total = order transfer + top-up = what they'd get with no discount.
    const orderTransfer = fake.state.transfers.find((t) => t.metadata?.kind === "cart_order_transfer")!;
    expect(orderTransfer.amount + 500).toBe(order.sellerNetCents! + 500);
    const ledger = await orderLedger(order.id);
    expect(ledger.first_order_discount).toBe(-500);
    expect(ledger.seller_paid_out).toBe(order.sellerNetCents! + 500);
    await expectLedgerBalanced();

    // A webhook redelivery never tops up twice.
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    expect(fake.state.transfers.filter((t) => t.metadata?.kind === "first_order_discount_topup")).toHaveLength(1);

    // Once per buyer: the next order is full price.
    const again = await quote(c.buyer, c.groups);
    expect(again.body.groups[0]).toMatchObject({ discountCents: 0, firstOrderDiscountCents: 0, totalCents: fullTotal });
  });

  it("does nothing under $10 of merchandise, with the flag off, or after a kept order", async () => {
    const small = await cart("small", 900);
    expect((await quote(small.buyer, small.groups)).body.groups[0].firstOrderDiscountCents).toBe(0);

    const off = await cart("off");
    flags.firstOrder = false;
    const q = await quote(off.buyer, off.groups);
    expect(q.body.groups[0]).toMatchObject({ discountCents: 0, firstOrderDiscountCents: 0 });
    const paid = await payAndConfirm(off.buyer, off.groups);
    expect(paid.intent.amount).toBe(4_000 + TAX(4_000));
    expect(await claimOf(off.buyer)).toBeUndefined();
    expect(fake.state.transfers.filter((t) => t.metadata?.kind === "first_order_discount_topup")).toHaveLength(0);

    // That buyer now has a kept paid order: turning the flag on doesn't help.
    flags.firstOrder = true;
    expect(await isFirstOrderDiscountEligible(off.buyer)).toBe(false);
    expect(await isFirstOrderDiscountEligible(null)).toBe(false);
  });

  it("applies to one seller group only in a multi-seller cart", async () => {
    const a = await cart("multi-a", 3_000);
    const sellerB = await seedSeller("multi-b");
    const productB = await seedProduct(sellerB, { priceCents: 2_000, stock: 5 });
    const groups = [...a.groups, { items: [{ variantId: productB.variantId, productId: productB.productId, quantity: 1 }] }];
    const q = await quote(a.buyer, groups);
    expect(q.body.groups.map((g: any) => g.firstOrderDiscountCents)).toEqual([500, 0]);
  });

  it("can only be held by one checkout at a time, even when two race", async () => {
    const c = await cart("race");
    const [one, two] = await Promise.all([
      call(app.base, "POST", PATH, c.buyer, payBody(c.groups)),
      call(app.base, "POST", PATH, c.buyer, payBody(c.groups)),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    const lost = one.status === 409 ? one : two;
    expect(lost.body.code).toBe("FIRST_ORDER_DISCOUNT_UNAVAILABLE");
    expect(fake.state.paymentIntents.size).toBe(1);
    // While the winner's payment is open, a new quote doesn't promise it again.
    expect((await quote(c.buyer, c.groups)).body.groups[0].firstOrderDiscountCents).toBe(0);

    // Direct reservations: exactly one of several concurrent claims wins.
    const buyer = await seedBuyer("race-direct");
    const rows = await db.insert(checkoutSessions).values(
      [1, 2, 3].map(() => ({ buyerId: buyer, sellerId: c.seller, items: [], chargeModel: "transfer" })),
    ).returning();
    const results = await Promise.all(rows.map((row) => db.transaction((tx) => reserveFirstOrderDiscount(tx, {
      buyerId: buyer, checkoutSessionId: row.id, amountCents: 500,
    }))));
    expect(results.filter(Boolean)).toHaveLength(1);
    // The same checkout reserving again is a no-op success.
    const winner = rows[results.indexOf(true)];
    expect(await db.transaction((tx) => reserveFirstOrderDiscount(tx, { buyerId: buyer, checkoutSessionId: winner.id, amountCents: 500 }))).toBe(true);
  });

  it("gives the discount back when the buyer backs out of the payment", async () => {
    const c = await cart("cancel");
    const res = await call(app.base, "POST", PATH, c.buyer, payBody(c.groups));
    expect((await claimOf(c.buyer)).status).toBe("reserved");
    const cancel = await call(app.base, "POST", `${PATH}/${res.body.paymentIntentId}/cancel`, c.buyer, {});
    expect(cancel.status).toBe(200);
    expect((await claimOf(c.buyer)).status).toBe("released");
    expect((await quote(c.buyer, c.groups)).body.groups[0].firstOrderDiscountCents).toBe(500);
  });

  it("reverses the seller top-up on a full refund and lets the buyer use it again", async () => {
    const c = await cart("refund");
    const { made } = await payAndConfirm(c.buyer, c.groups);
    const order = made[0];
    const topup = fake.state.transfers.find((t) => t.metadata?.kind === "first_order_discount_topup")!;

    await refundOrder({
      orderId: order.id, reason: "seller_cancelled", initiatedBy: c.seller, idempotencyKey: `test-refund/${order.id}`,
      cancelOrder: { reason: "seller_cancelled", notes: null, restock: true },
    });
    const reversal = fake.state.reversals.find((r) => r.transfer === topup.id);
    expect(reversal).toMatchObject({ amount: 500 });
    expect((await claimOf(c.buyer)).status).toBe("reversed");
    const ledger = await orderLedger(order.id);
    expect(ledger.first_order_discount).toBe(0);
    await expectLedgerBalanced();

    // Their only order was cancelled, so their next order is a first order again.
    expect((await quote(c.buyer, c.groups)).body.groups[0].firstOrderDiscountCents).toBe(500);
    const again = await payAndConfirm(c.buyer, c.groups);
    expect((await claimOf(c.buyer))).toMatchObject({ status: "applied", orderId: again.made[0].id });
    expect(fake.state.transfers.filter((t) => t.metadata?.kind === "first_order_discount_topup")).toHaveLength(2);
    await expectLedgerBalanced();
  });

  it("keeps the order transfer and discount separate in the database", async () => {
    const c = await cart("audit");
    const { made } = await payAndConfirm(c.buyer, c.groups);
    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, made[0].stripeCheckoutSessionId!));
    expect(row.firstOrderDiscountCents).toBe(500);
    const kinds = (await db.execute(sql`SELECT kind FROM ledger_transactions WHERE order_id = ${made[0].id}::uuid`)).rows.map((r: any) => r.kind);
    expect(kinds).toContain("first_order_discount_topup");
  });
});
