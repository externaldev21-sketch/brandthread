/**
 * One-page checkout: ONE PaymentIntent for a multi-seller cart, confirmed in
 * the app, with separate charges and transfers. Covers, against real Postgres
 * with the in-memory Stripe:
 *  - stock is reserved atomically at pay time (two buyers racing for the
 *    last unit: exactly one wins), released on failure or cancel,
 *    committed (not decremented twice) when the payment succeeds;
 *  - POST /api/buyer/checkout/payment-intent prices each seller group,
 *    adds Stripe Tax, and creates one intent for the sum. A retry with the
 *    same key returns the same intent;
 *  - payment_intent.succeeded creates one order per seller. Each seller is
 *    paid by a transfer (transfer_group = order id, source_transaction =
 *    the cart charge), exactly once, and the ledger balances;
 *  - refunding one seller's order reverses that seller's transfer;
 *  - abandoned intents are cancelled before their stock is released;
 *  - PCI SAQ-A: a request carrying a card number or CVC is refused before
 *    anything else sees it, and the number is never logged or stored.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("./fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../push", () => ({
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

import { db, checkoutSessions, orders, productVariants, shippingRates } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { logger } from "../../logger";
import { handleCartPaymentEnded, handleCartPaymentSucceeded } from "../../../routes/webhooks";
import checkoutIntentRouter from "../../../routes/checkout-intent";
import { expireStockReservations, settleTransferOrder } from "../cartTransfers";
import { refundOrder } from "../refunds";
import { StockReservationError, releaseStockReservation, reserveStock } from "../stockReservation";
import {
  call, expectLedgerBalanced, orderLedger, seedBuyer, seedProduct, seedSeller, startApp, uid,
} from "./moneyHarness";

const TEST_CARD = "4242 4242 4242 4242";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/buyer/checkout/payment-intent", checkoutIntentRouter);
    // Surface route crashes in the assertion output.
    server.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: String(err?.stack ?? err) });
    });
  });
});
afterAll(async () => {
  await app.close();
  await expectLedgerBalanced();
});
beforeEach(() => fake.reset());

async function stockOf(variantId: string): Promise<number> {
  const [row] = await db.select({ stock: productVariants.stock }).from(productVariants)
    .where(eq(productVariants.id, variantId)).limit(1);
  return row.stock;
}

async function reservationsFor(checkoutSessionId: string) {
  const result = await db.execute(sql`
    SELECT status, quantity, stripe_payment_intent_id FROM stock_reservations
    WHERE checkout_session_id = ${checkoutSessionId}::uuid
  `);
  return result.rows as Array<{ status: string; quantity: number; stripe_payment_intent_id: string | null }>;
}

async function seedCheckoutRow(buyerId: string, sellerId: string) {
  const [row] = await db.insert(checkoutSessions).values({
    buyerId, sellerId, items: [], chargeModel: "transfer",
  }).returning();
  return row;
}

const address = {
  recipientName: "Jordan Reyes", street: "148 Mercer Street", line2: "Apt 4",
  city: "New York", state: "NY", postalCode: "10012", country: "US",
};

function body(groups: Array<{ items: Array<{ variantId: string; productId: string; quantity: number }> }>, extra: Record<string, unknown> = {}) {
  return {
    groups,
    contactEmail: "buyer@test.local",
    contactPhone: "+1 503 555 0100",
    shippingAddress: address,
    clientIdempotencyKey: uid("pay"),
    ...extra,
  };
}

/** Two sellers, one buyer, one product each (stock 5), $12 flat shipping at seller A, free at seller B. */
async function seedCart(tag: string) {
  const sellerA = await seedSeller(`${tag}-a`);
  const sellerB = await seedSeller(`${tag}-b`);
  const buyer = await seedBuyer(tag);
  const productA = await seedProduct(sellerA, { priceCents: 5_000, stock: 5 });
  const productB = await seedProduct(sellerB, { priceCents: 2_500, stock: 5 });
  await db.insert(shippingRates).values({ id: uid("rate"), sellerId: sellerA, name: "Standard", flatRateCents: 1_200 });
  // Seller B offers free shipping explicitly (no rate at all now means the standard rate, lib/defaultShipping.ts).
  await db.insert(shippingRates).values({ id: uid("rate"), sellerId: sellerB, name: "Free shipping", flatRateCents: 0 });
  const groups = [
    { items: [{ variantId: productA.variantId, productId: productA.productId, quantity: 2 }] },
    { items: [{ variantId: productB.variantId, productId: productB.productId, quantity: 1 }] },
  ];
  return { sellerA, sellerB, buyer, productA, productB, groups };
}

/** Stripe reports the cart intent paid. */
function succeeded(intentId: string) {
  const intent = fake.state.paymentIntents.get(intentId);
  intent.status = "succeeded";
  intent.amount_received = intent.amount;
  intent.latest_charge = `ch_${intentId}`;
  return intent;
}

describe("stock reservation", () => {
  it("lets exactly one of two concurrent buyers take the last unit", async () => {
    const seller = await seedSeller("race");
    const buyer = await seedBuyer("race");
    const product = await seedProduct(seller, { priceCents: 1_000, stock: 1 });
    const first = await seedCheckoutRow(buyer, seller);
    const second = await seedCheckoutRow(buyer, seller);

    const attempt = (checkoutId: string) => db.transaction((tx) => reserveStock(tx, checkoutId, [
      { variantId: product.variantId, quantity: 1, productName: product.productName },
    ]));
    const results = await Promise.allSettled([attempt(first.id), attempt(second.id)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(StockReservationError);
    expect(await stockOf(product.variantId)).toBe(0);
  });

  it("gives the units back on release, once", async () => {
    const seller = await seedSeller("release");
    const buyer = await seedBuyer("release");
    const product = await seedProduct(seller, { priceCents: 1_000, stock: 3 });
    const row = await seedCheckoutRow(buyer, seller);
    await db.transaction((tx) => reserveStock(tx, row.id, [{ variantId: product.variantId, quantity: 2 }]));
    expect(await stockOf(product.variantId)).toBe(1);

    await db.transaction((tx) => releaseStockReservation(tx, row.id));
    await db.transaction((tx) => releaseStockReservation(tx, row.id));
    expect(await stockOf(product.variantId)).toBe(3);
    expect((await reservationsFor(row.id)).map((r) => r.status)).toEqual(["released"]);
  });
});

describe("POST /api/buyer/checkout/payment-intent", () => {
  it("creates one intent for the whole cart, with server prices, tax and reserved stock", async () => {
    const cart = await seedCart("create");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // Seller A: 2 × $50 + $12 shipping; seller B: $25, free shipping. 8% fake tax.
    const taxA = Math.round((10_000 + 1_200) * 0.08);
    const taxB = Math.round(2_500 * 0.08);
    expect(res.body.groups.map((g: any) => g.totalCents)).toEqual([10_000 + 1_200 + taxA, 2_500 + taxB]);
    expect(res.body.amountCents).toBe(10_000 + 1_200 + taxA + 2_500 + taxB);
    expect(res.body.clientSecret).toMatch(/_secret_/);

    const [created] = fake.state.paymentIntentCreates;
    expect(fake.state.paymentIntentCreates).toHaveLength(1);
    expect(created.params.amount).toBe(res.body.amountCents);
    expect(created.params.metadata.kind).toBe("cart_checkout");
    expect(created.params.shipping.address.postal_code).toBe("10012");
    // Tax is calculated on each seller's own connected account.
    expect(fake.state.taxCalculations.map((c) => c.options.stripeAccount)).toHaveLength(2);

    // Stock is held now, not when the webhook arrives.
    expect(await stockOf(cart.productA.variantId)).toBe(3);
    expect(await stockOf(cart.productB.variantId)).toBe(4);
    const rows = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, res.body.paymentIntentId));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.chargeModel).toBe("transfer");
      expect((await reservationsFor(row.id))[0]).toMatchObject({ status: "held", stripe_payment_intent_id: res.body.paymentIntentId });
    }
  });

  it("quotes the cart for a ZIP alone without reserving stock or creating an intent", async () => {
    const cart = await seedCart("quote");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent/quote", cart.buyer, {
      groups: cart.groups, shippingAddress: { postalCode: "10012", country: "US" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const taxA = Math.round((10_000 + 1_200) * 0.08);
    const taxB = Math.round(2_500 * 0.08);
    expect(res.body.amountCents).toBe(10_000 + 1_200 + taxA + 2_500 + taxB);
    expect(res.body.groups[0]).toMatchObject({ sellerId: cart.sellerA, shippingCents: 1_200, taxCents: taxA });
    // No street was sent, so none is passed to Stripe Tax.
    expect(fake.state.taxCalculations[0].params.customer_details.address).toEqual({ postal_code: "10012", country: "US" });
    expect(fake.state.paymentIntents.size).toBe(0);
    expect(await stockOf(cart.productA.variantId)).toBe(5);
  });

  it("returns the same intent for a retried pay attempt without reserving twice", async () => {
    const cart = await seedCart("retry");
    const payload = body(cart.groups);
    const first = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, payload);
    const second = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, payload);
    expect(second.status).toBe(200);
    expect(second.body.paymentIntentId).toBe(first.body.paymentIntentId);
    expect(fake.state.paymentIntents.size).toBe(1);
    expect(await stockOf(cart.productA.variantId)).toBe(3);
  });

  it("refuses the last unit to a second buyer with OUT_OF_STOCK", async () => {
    const seller = await seedSeller("oos");
    const buyerOne = await seedBuyer("oos-1");
    const buyerTwo = await seedBuyer("oos-2");
    const product = await seedProduct(seller, { priceCents: 3_000, stock: 1 });
    const groups = [{ items: [{ variantId: product.variantId, productId: product.productId, quantity: 1 }] }];
    const [one, two] = await Promise.all([
      call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyerOne, body(groups)),
      call(app.base, "POST", "/api/buyer/checkout/payment-intent", buyerTwo, body(groups)),
    ]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    expect([one.body.code, two.body.code]).toContain("OUT_OF_STOCK");
    expect(await stockOf(product.variantId)).toBe(0);
  });

  it("sends the app to hosted Checkout when Stripe Tax can't calculate", async () => {
    const cart = await seedCart("tax-off");
    fake.state.taxFails = true;
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("USE_HOSTED_CHECKOUT");
    expect(fake.state.paymentIntents.size).toBe(0);
    expect(await stockOf(cart.productA.variantId)).toBe(5);
  });

  it("cancel releases the stock and closes the intent", async () => {
    const cart = await seedCart("cancel");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups));
    const cancel = await call(app.base, "POST", `/api/buyer/checkout/payment-intent/${res.body.paymentIntentId}/cancel`, cart.buyer, {});
    expect(cancel.status).toBe(200);
    expect(fake.state.paymentIntents.get(res.body.paymentIntentId).status).toBe("canceled");
    expect(await stockOf(cart.productA.variantId)).toBe(5);
    expect(await stockOf(cart.productB.variantId)).toBe(5);
  });
});

describe("payment_intent webhooks", () => {
  it("creates one order per seller, transfers each seller's share once, and never double-decrements stock", async () => {
    const cart = await seedCart("paid");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups));
    const intent = succeeded(res.body.paymentIntentId);

    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date()); // redelivery

    const rows = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, intent.id));
    const made = await db.select().from(orders).where(sql`${orders.stripeCheckoutSessionId} IN (${sql.join(rows.map((r) => sql`${r.stripeSessionId}`), sql`, `)})`);
    expect(made).toHaveLength(2);
    expect(new Set(made.map((o) => o.ownerId))).toEqual(new Set([cart.sellerA, cart.sellerB]));
    for (const order of made) {
      expect(order.chargeModel).toBe("transfer");
      expect(order.fundsState).toBe("released");
      expect(order.stripeTransferId).toBeTruthy();
      expect(order.stripePaymentIntentId).toBe(intent.id);
    }
    const total = made.reduce((sum, o) => sum + o.grossChargedCents, 0);
    expect(total).toBe(intent.amount);

    // One transfer per seller, tied to its order and the cart's charge.
    expect(fake.state.transfers).toHaveLength(2);
    for (const transfer of fake.state.transfers) {
      const order = made.find((o) => o.id === transfer.transfer_group)!;
      expect(order).toBeTruthy();
      expect(transfer.source_transaction).toBe(`ch_${intent.id}`);
      expect(transfer.amount).toBe(order.sellerNetCents);
      expect(transfer.idempotencyKey).toBe(`order-transfer/${order.id}`);
      expect(await orderLedger(order.id)).toMatchObject({ seller_held: 0, seller_paid_out: order.sellerNetCents });
    }
    expect(await settleTransferOrder(made[0].id)).toBe("already");

    // Reserved at pay time, committed now: 5 − 2 and 5 − 1, not less.
    expect(await stockOf(cart.productA.variantId)).toBe(3);
    expect(await stockOf(cart.productB.variantId)).toBe(4);
    for (const row of rows) expect((await reservationsFor(row.id))[0].status).toBe("committed");
    // Stripe Tax transactions are recorded on each seller's account, once
    // per order (the redelivery reuses the same idempotency key).
    const taxKeys = new Set(fake.state.taxTransactions.map((t) => t.options.idempotencyKey));
    expect([...taxKeys].sort()).toEqual(made.map((o) => `tax-transaction/${o.id}`).sort());
    expect(new Set(fake.state.taxTransactions.map((t) => t.options.stripeAccount)).size).toBe(2);
    await expectLedgerBalanced();

    const status = await call(app.base, "GET", `/api/buyer/checkout/payment-intent/${intent.id}`, cart.buyer);
    expect(status.body).toMatchObject({ paymentStatus: "paid", complete: true });
    expect(status.body.orders).toHaveLength(2);
  });

  it("refunding one seller's order reverses only that seller's transfer", async () => {
    const cart = await seedCart("refund");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups));
    const intent = succeeded(res.body.paymentIntentId);
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    const [order] = await db.select().from(orders)
      .where(sql`${orders.stripePaymentIntentId} = ${intent.id} AND ${orders.ownerId} = ${cart.sellerB}`);

    const result = await refundOrder({
      orderId: order.id, reason: "seller_cancelled", initiatedBy: cart.sellerB, idempotencyKey: `test-refund/${order.id}`,
    });
    expect(result.amountCents).toBe(order.grossChargedCents);
    expect(fake.state.refunds).toHaveLength(1);
    expect(fake.state.refunds[0]).toMatchObject({ payment_intent: intent.id, amount: order.grossChargedCents });
    expect(fake.state.reversals).toHaveLength(1);
    expect(fake.state.reversals[0].transfer).toBe(order.stripeTransferId);
    expect(fake.state.reversals[0].amount).toBe(order.sellerNetCents);
    await expectLedgerBalanced();
  });

  it("a failed payment gives the stock back and closes the intent", async () => {
    const cart = await seedCart("failed");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups));
    const intent = fake.state.paymentIntents.get(res.body.paymentIntentId);
    await handleCartPaymentEnded({ ...intent, status: "requires_payment_method" }, true);
    expect(intent.status).toBe("canceled");
    expect(await stockOf(cart.productA.variantId)).toBe(5);
    expect(await stockOf(cart.productB.variantId)).toBe(5);
    const made = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, intent.id));
    expect(made).toHaveLength(0);
  });

  it("the sweep cancels an abandoned intent before releasing its stock, but leaves a paid one alone", async () => {
    const cart = await seedCart("expire");
    const abandoned = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups));
    const paying = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups));
    fake.state.paymentIntents.get(paying.body.paymentIntentId).status = "processing";

    await expireStockReservations({ now: new Date(Date.now() + 31 * 60_000) });
    expect(fake.state.paymentIntents.get(abandoned.body.paymentIntentId).status).toBe("canceled");
    expect(fake.state.paymentIntents.get(paying.body.paymentIntentId).status).toBe("processing");
    // Only the abandoned cart's units came back.
    expect(await stockOf(cart.productA.variantId)).toBe(3);
    expect(await stockOf(cart.productB.variantId)).toBe(4);
  });
});

describe("card data never reaches Brandthread (PCI SAQ-A)", () => {
  const cases: Array<[string, (b: Record<string, any>) => Record<string, any>]> = [
    ["a card number field", (b) => ({ ...b, cardNumber: TEST_CARD })],
    ["a nested card object", (b) => ({ ...b, paymentMethod: { card: { number: TEST_CARD.replace(/ /g, "") } } })],
    ["a CVC", (b) => ({ ...b, cvc: "123" })],
    ["a card number typed into the address", (b) => ({ ...b, shippingAddress: { ...b.shippingAddress, line2: TEST_CARD } })],
  ];

  for (const [label, mutate] of cases) {
    it(`refuses ${label}, stores nothing and never logs the number`, async () => {
      const cart = await seedCart(`pci-${label.length}`);
      const warn = vi.spyOn(logger, "warn");
      const before = await db.select({ id: checkoutSessions.id }).from(checkoutSessions)
        .where(eq(checkoutSessions.buyerId, cart.buyer));

      const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, mutate(body(cart.groups)));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("CARD_DATA_REJECTED");
      expect(JSON.stringify(res.body)).not.toContain("4242");

      expect(fake.state.paymentIntentCreates).toHaveLength(0);
      const after = await db.select({ id: checkoutSessions.id }).from(checkoutSessions)
        .where(eq(checkoutSessions.buyerId, cart.buyer));
      expect(after).toHaveLength(before.length);
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toMatch(/4242\s?4242/);
      expect(logged).not.toContain('"123"');
      warn.mockRestore();
    });
  }

  it("the normal request the app sends passes the guard", async () => {
    const cart = await seedCart("pci-ok");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups));
    expect(res.status).toBe(200);
  });
});
