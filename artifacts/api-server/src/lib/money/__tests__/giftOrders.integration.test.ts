/**
 * "Gift this" at checkout, against real Postgres with the in-memory Stripe:
 *  - POST /api/buyer/checkout/payment-intent stores the gift (trimmed) on
 *    every checkout session of the cart;
 *  - the paid webhook copies it onto EVERY order (one per seller);
 *  - limits: To/From 60, message 250; abusive messages are refused;
 *  - the seller and buyer order detail responses return it.
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
vi.mock("../../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middlewares/requireRole")>()),
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requirePermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { db, checkoutSessions, orders, shippingRates } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { handleCartPaymentSucceeded } from "../../../routes/webhooks";
import checkoutIntentRouter from "../../../routes/checkout-intent";
import { call, seedBuyer, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  const { default: ordersRouter } = await import("../../../routes/orders");
  const { default: buyerRouter } = await import("../../../routes/buyer");
  app = await startApp((server) => {
    server.use("/api/buyer/checkout/payment-intent", checkoutIntentRouter);
    server.use("/api/buyer", buyerRouter);
    server.use("/api/orders", ordersRouter);
    server.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: String(err?.stack ?? err) });
    });
  });
});
afterAll(async () => { await app.close(); });
beforeEach(() => fake.reset());

const address = {
  recipientName: "Jordan Reyes", street: "148 Mercer Street", line2: "Apt 4",
  city: "New York", state: "NY", postalCode: "10012", country: "US",
};

async function seedCart(tag: string) {
  const sellerA = await seedSeller(`${tag}-a`);
  const sellerB = await seedSeller(`${tag}-b`);
  const buyer = await seedBuyer(tag);
  const productA = await seedProduct(sellerA, { priceCents: 5_000, stock: 5 });
  const productB = await seedProduct(sellerB, { priceCents: 2_500, stock: 5 });
  await db.insert(shippingRates).values({ id: uid("rate"), sellerId: sellerA, name: "Standard", flatRateCents: 1_200 });
  const groups = [
    { items: [{ variantId: productA.variantId, productId: productA.productId, quantity: 1 }] },
    { items: [{ variantId: productB.variantId, productId: productB.productId, quantity: 1 }] },
  ];
  return { sellerA, sellerB, buyer, groups };
}

function body(groups: unknown, gift?: unknown) {
  return {
    groups,
    contactEmail: "buyer@test.local",
    contactPhone: "+1 503 555 0100",
    shippingAddress: address,
    clientIdempotencyKey: uid("pay"),
    ...(gift === undefined ? {} : { gift }),
  };
}

function succeeded(intentId: string) {
  const intent = fake.state.paymentIntents.get(intentId);
  intent.status = "succeeded";
  intent.amount_received = intent.amount;
  intent.latest_charge = `ch_${intentId}`;
  return intent;
}

async function ordersForIntent(intentId: string) {
  const rows = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, intentId));
  return db.select().from(orders)
    .where(sql`${orders.stripeCheckoutSessionId} IN (${sql.join(rows.map((r) => sql`${r.stripeSessionId}`), sql`, `)})`);
}

describe("gift at checkout", () => {
  it("stores the gift on the session and copies it onto every seller's order", async () => {
    const cart = await seedCart("gift");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups, {
      to: "  Sam Lee ", from: "Alex Kim", message: "  Happy birthday. Love, Alex  ",
    }));
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const sessions = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, res.body.paymentIntentId));
    expect(sessions).toHaveLength(2);
    for (const row of sessions) {
      expect(row).toMatchObject({ isGift: true, giftTo: "Sam Lee", giftFrom: "Alex Kim", giftMessage: "Happy birthday. Love, Alex" });
    }

    const intent = succeeded(res.body.paymentIntentId);
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    const made = await ordersForIntent(intent.id);
    expect(made).toHaveLength(2);
    expect(new Set(made.map((o) => o.ownerId))).toEqual(new Set([cart.sellerA, cart.sellerB]));
    for (const order of made) {
      expect(order).toMatchObject({ isGift: true, giftTo: "Sam Lee", giftFrom: "Alex Kim", giftMessage: "Happy birthday. Love, Alex" });
    }

    // Seller order detail.
    const sellerOrder = made.find((o) => o.ownerId === cart.sellerA)!;
    const seller = await call(app.base, "GET", `/api/orders/${sellerOrder.id}`, cart.sellerA);
    expect(seller.status, JSON.stringify(seller.body)).toBe(200);
    expect(seller.body.isGift).toBe(true);
    expect(seller.body.gift).toEqual({ to: "Sam Lee", from: "Alex Kim", message: "Happy birthday. Love, Alex" });

    // Buyer order detail.
    const buyer = await call(app.base, "GET", `/api/buyer/orders/${sellerOrder.id}`, cart.buyer);
    expect(buyer.status, JSON.stringify(buyer.body)).toBe(200);
    expect(buyer.body.isGift).toBe(true);
    expect(buyer.body.gift).toEqual({ to: "Sam Lee", from: "Alex Kim", message: "Happy birthday. Love, Alex" });
  });

  it("leaves orders without a gift as not a gift", async () => {
    const cart = await seedCart("nogift");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const intent = succeeded(res.body.paymentIntentId);
    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    const made = await ordersForIntent(intent.id);
    expect(made).toHaveLength(2);
    for (const order of made) expect(order).toMatchObject({ isGift: false, giftTo: null, giftFrom: null, giftMessage: null });

    const seller = await call(app.base, "GET", `/api/orders/${made[0].id}`, made[0].ownerId);
    expect(seller.body).toMatchObject({ isGift: false, gift: null });
    const buyer = await call(app.base, "GET", `/api/buyer/orders/${made[0].id}`, cart.buyer);
    expect(buyer.body).toMatchObject({ isGift: false, gift: null });
  });

  it("enforces the length limits", async () => {
    const cart = await seedCart("limits");
    const cases = [
      { to: "x".repeat(61) },
      { from: "x".repeat(61) },
      { message: "x".repeat(251) },
      { message: "hi", extra: "nope" },
    ];
    for (const gift of cases) {
      const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups, gift));
      expect(res.status, JSON.stringify(gift)).toBe(400);
    }
    // At the limit is fine (and whitespace does not count).
    const ok = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups, {
      to: "t".repeat(60), from: "f".repeat(60), message: ` ${"m".repeat(250)} `,
    }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(fake.state.paymentIntents.size).toBe(1);
  });

  it("refuses an abusive gift message before anything is reserved", async () => {
    const cart = await seedCart("abuse");
    const res = await call(app.base, "POST", "/api/buyer/checkout/payment-intent", cart.buyer, body(cart.groups, {
      message: "kill yourself",
    }));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CONTENT_REJECTED");
    expect(fake.state.paymentIntents.size).toBe(0);
  });
});
