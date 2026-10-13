/**
 * "Add to this order": GET lists the same seller's in-stock pieces while the
 * window is open; POST charges the order's saved card off-session with no
 * shipping, and the normal cart webhook turns it into an order.
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

import { db, checkoutSessions, orderItems, orders, productVariants, shippingRates } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { handleCartPaymentSucceeded } from "../../../routes/webhooks";
import orderAddOnRouter from "../../../routes/order-add-on";
import { call, seedBuyer, seedProduct, seedSeller, startApp, uid } from "./moneyHarness";

let app: Awaited<ReturnType<typeof startApp>>;

beforeAll(async () => {
  app = await startApp((server) => {
    server.use("/api/buyer/add-on", orderAddOnRouter);
    server.use((err: any, _req: any, res: any, _next: any) => {
      res.status(500).json({ error: String(err?.stack ?? err) });
    });
  });
});
afterAll(async () => { await app.close(); });
beforeEach(() => fake.reset());

const address = { name: "Jordan Reyes", street: "148 Mercer Street", line2: null, city: "New York", state: "NY", zip: "10012", country: "US" };

/** A paid order from `seller`, paid `minutesAgo`, with the card saved on the buyer's customer. */
async function seedPaidOrder(tag: string, minutesAgo = 1) {
  const seller = await seedSeller(tag);
  const buyer = await seedBuyer(tag);
  const bought = await seedProduct(seller, { priceCents: 5_000, stock: 5 });
  const extra = await seedProduct(seller, { priceCents: 2_000, stock: 3 });
  // Flat shipping the add-on must not charge again.
  await db.insert(shippingRates).values({ id: uid("rate"), sellerId: seller, name: "Standard", flatRateCents: 1_200 });
  const piId = uid("pi_original");
  fake.state.paymentIntents.set(piId, {
    id: piId, status: "succeeded", customer: "cus_addon",
    payment_method: { id: "pm_addon", type: "card", customer: "cus_addon", card: { brand: "visa", last4: "4242" } },
  });
  const [order] = await db.insert(orders).values({
    ownerId: seller, buyerId: buyer, orderNumber: uid("BT-ADDON"), status: "processing",
    totalCents: 6_200, subtotalCents: 5_000, shippingCents: 1_200,
    shippingAddress: address, paidAt: new Date(Date.now() - minutesAgo * 60_000), stripePaymentIntentId: piId,
  }).returning();
  await db.insert(orderItems).values({
    orderId: order.id, variantId: bought.variantId, productName: bought.productName, variantLabel: "M", quantity: 1, priceCents: 5_000,
  });
  return { seller, buyer, bought, extra, order };
}

async function stockOf(variantId: string) {
  const [row] = await db.select({ stock: productVariants.stock }).from(productVariants).where(eq(productVariants.id, variantId));
  return row.stock;
}

describe("add to this order", () => {
  it("offers the seller's other in-stock pieces with the card on file", async () => {
    const { buyer, bought, extra, order } = await seedPaidOrder("offer");
    const res = await call(app.base, "GET", `/api/buyer/add-on/${order.id}`, buyer);
    expect(res.status).toBe(200);
    expect(res.body.card).toEqual({ brand: "visa", last4: "4242" });
    const ids = res.body.products.map((p: any) => p.productId);
    expect(ids).toContain(extra.productId);
    expect(ids).not.toContain(bought.productId);
    expect(res.body.products.find((p: any) => p.productId === extra.productId).variants[0])
      .toMatchObject({ variantId: extra.variantId, priceCents: 2_000 });
  });

  it("charges the saved card off-session, with no shipping, and the webhook makes the order", async () => {
    const { buyer, seller, extra, order } = await seedPaidOrder("charge");
    const res = await call(app.base, "POST", `/api/buyer/add-on/${order.id}`, buyer, {
      productId: extra.productId, variantId: extra.variantId, clientKey: uid("tap"),
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("succeeded");
    // $20 piece + 8% tax, no shipping.
    expect(res.body.amountCents).toBe(2_160);

    const confirm = fake.state.paymentIntentConfirms.at(-1)!;
    expect(confirm.params).toMatchObject({ off_session: true, payment_method: "pm_addon" });
    const intent = fake.state.paymentIntents.get(res.body.paymentIntentId);
    expect(intent).toMatchObject({ customer: "cus_addon", amount: 2_160 });

    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripePaymentIntentId, intent.id));
    expect(row).toMatchObject({ shippingCents: 0, amountTotalCents: 2_160, sellerId: seller });

    await handleCartPaymentSucceeded(intent, `evt_${uid("pi")}`, new Date());
    const made = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, intent.id));
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ buyerId: buyer, ownerId: seller, shippingCents: 0 });
    expect(await stockOf(extra.variantId)).toBe(2);
  });

  it("a repeated tap returns the first charge instead of charging twice", async () => {
    const { buyer, extra, order } = await seedPaidOrder("retry");
    const payload = { productId: extra.productId, variantId: extra.variantId, clientKey: uid("tap") };
    const first = await call(app.base, "POST", `/api/buyer/add-on/${order.id}`, buyer, payload);
    const second = await call(app.base, "POST", `/api/buyer/add-on/${order.id}`, buyer, payload);
    expect(second.status).toBe(200);
    expect(second.body.paymentIntentId).toBe(first.body.paymentIntentId);
    expect(fake.state.paymentIntentConfirms).toHaveLength(1);
  });

  it("gives the stock back when the bank wants the buyer present", async () => {
    const { buyer, extra, order } = await seedPaidOrder("sca");
    fake.state.confirmFails = "authentication_required";
    const res = await call(app.base, "POST", `/api/buyer/add-on/${order.id}`, buyer, {
      productId: extra.productId, variantId: extra.variantId, clientKey: uid("tap"),
    });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("ADD_ON_NEEDS_CHECKOUT");
    const held = await db.execute(sql`
      SELECT count(*)::int AS n FROM stock_reservations r
      JOIN checkout_sessions c ON c.id = r.checkout_session_id
      WHERE c.buyer_id = ${buyer} AND r.status = 'held'
    `);
    expect((held.rows[0] as any).n).toBe(0);
    expect(await stockOf(extra.variantId)).toBe(3);
  });

  it("closes after the window, and to anyone but the buyer", async () => {
    const late = await seedPaidOrder("late", 20);
    const closed = await call(app.base, "GET", `/api/buyer/add-on/${late.order.id}`, late.buyer);
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe("ADD_ON_WINDOW_CLOSED");

    const fresh = await seedPaidOrder("stranger");
    const other = await seedBuyer("stranger-2");
    expect((await call(app.base, "GET", `/api/buyer/add-on/${fresh.order.id}`, other)).status).toBe(404);
  });

  it("only adds pieces from the same seller", async () => {
    const { buyer, order } = await seedPaidOrder("cross");
    const otherSeller = await seedSeller("cross-other");
    const elsewhere = await seedProduct(otherSeller, { priceCents: 3_000, stock: 2 });
    const res = await call(app.base, "POST", `/api/buyer/add-on/${order.id}`, buyer, {
      productId: elsewhere.productId, variantId: elsewhere.variantId, clientKey: uid("tap"),
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ADD_ON_OTHER_SELLER");
  });
});
