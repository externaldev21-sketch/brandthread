/**
 * Mystery boxes end to end against the local DB: seller pool API, public
 * summary, the paid-order pick hook (through the real Stripe webhook route,
 * including a retry), and the buyer reveal.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db, checkoutSessions, notificationsFeed, orderItems, orders, productVariants, products, users,
  mysteryBoxPicks,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

const state = vi.hoisted(() => ({ eventsBySignature: new Map<string, any>(), userId: "" }));

vi.mock("../../lib/stripe", () => ({
  STRIPE_WEBHOOK_SECRET: "test-secret",
  stripe: { webhooks: { constructEvent: vi.fn((_payload: any, sig: any) => state.eventsBySignature.get(sig)) } },
}));
vi.mock("../../lib/push", () => ({
  normalizePushEventCategory: vi.fn(() => "orders"),
  sendPushToUser: vi.fn(async () => {}),
}));
vi.mock("../../lib/brandthreadEmail", () => ({
  isOrderConfirmationEligibleStatus: vi.fn(() => true),
  sendOrderConfirmationEmail: vi.fn(async () => {}),
  sendOrderShippingEmail: vi.fn(async () => true),
}));
vi.mock("../loyalty", () => ({
  awardLoyaltyPointsOnce: vi.fn(),
  consumeLoyaltyRedemption: vi.fn(),
  releaseLoyaltyRedemption: vi.fn(),
  reversePurchasePointsOnce: vi.fn(),
}));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!state.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = state.userId;
    next();
  },
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  teamContext: () => (_req: any, _res: any, next: () => void) => next(),
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
}));

const suffix = crypto.randomBytes(6).toString("hex");
const sellerId = `mystery-seller-${suffix}`;
const otherSeller = `mystery-other-${suffix}`;
const buyerId = `mystery-buyer-${suffix}`;
const sessionId = `cs_mystery_${suffix}`;
const eventIds = [`evt_mystery_${suffix}_1`, `evt_mystery_${suffix}_2`];
const productIds: string[] = [];
let boxProduct = "";
let boxVariant = "";
let teeVariant = "";   // stock 1
let capVariant = "";   // stock 0
let foreignVariant = "";
let checkoutId = "";
let server: Server;
let base = "";

async function makeProduct(ownerId: string, name: string, priceCents: number, stock: number) {
  const [p] = await db.insert(products).values({
    ownerId, name, status: "active", images: [`https://example.test/${name}.jpg`],
  }).returning({ id: products.id });
  productIds.push(p.id);
  const [v] = await db.insert(productVariants).values({
    productId: p.id, sku: `mystery-${suffix}-${crypto.randomBytes(3).toString("hex")}`, priceCents, stock, size: "M",
  }).returning({ id: productVariants.id });
  return { productId: p.id, variantId: v.id };
}

const request = (path: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
  method,
  headers: body === undefined ? undefined : { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function postWebhook(eventId: string) {
  const sig = `sig-${eventId}`;
  state.eventsBySignature.set(sig, {
    id: eventId, type: "checkout.session.completed", created: 1_756_600_000,
    data: { object: {
      id: sessionId, payment_status: "paid", payment_intent: `pi_${sessionId}`, amount_total: 6_000,
      total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
      metadata: { csRef: checkoutId },
    } },
  });
  return fetch(`${base}/api/webhooks/stripe`, {
    method: "POST", headers: { "content-type": "application/json", "stripe-signature": sig }, body: "{}",
  });
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Mystery Seller", role: "seller", accountType: "seller" },
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Mystery Buyer", role: "buyer", accountType: "buyer" },
  ]);
  ({ productId: boxProduct, variantId: boxVariant } = await makeProduct(sellerId, `Box-${suffix}`, 3_000, 10));
  teeVariant = (await makeProduct(sellerId, `Tee-${suffix}`, 4_000, 1)).variantId;
  capVariant = (await makeProduct(sellerId, `Cap-${suffix}`, 2_000, 0)).variantId;
  foreignVariant = (await makeProduct(otherSeller, `Foreign-${suffix}`, 1_000, 5)).variantId;

  const [cs] = await db.insert(checkoutSessions).values({
    stripeSessionId: sessionId, buyerId, sellerId,
    items: [{ variantId: boxVariant, productName: `Box-${suffix}`, variantLabel: "M", quantity: 2, priceCents: 3_000 }],
    shippingAddress: { name: "Mystery Buyer", street: "1 Test St", city: "Austin", state: "TX", zip: "78701", country: "US" },
  }).returning({ id: checkoutSessions.id });
  checkoutId = cs.id;

  const { default: webhookRouter } = await import("../webhooks");
  const { default: mysteryRouter, buyerMysteryBoxesRouter } = await import("../mystery-boxes");
  const app = express();
  app.use("/api/webhooks", express.raw({ type: "application/json" }));
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/webhooks", webhookRouter);
  app.use(express.json());
  app.use("/api/mystery-boxes", mysteryRouter);
  app.use("/api/buyer/mystery-boxes", buyerMysteryBoxesRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.execute(sql`DELETE FROM stripe_webhook_events WHERE event_id IN (${eventIds[0]}, ${eventIds[1]})`);
  await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, sellerId));
  const created = await db.select({ id: orders.id }).from(orders).where(eq(orders.ownerId, sellerId));
  if (created.length) {
    const ids = created.map((o) => o.id);
    await db.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await db.delete(orders).where(inArray(orders.id, ids)).catch(() => {});
  }
  await db.delete(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, sessionId));
  if (productIds.length) await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(users).where(inArray(users.clerkId, [sellerId, buyerId]));
});

describe("mystery boxes", () => {
  it("lets only the owner set a pool of their own items", async () => {
    state.userId = sellerId;
    const foreign = await request(`/api/mystery-boxes/${boxProduct}`, "PUT", { items: [{ variantId: foreignVariant }] });
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).code).toBe("NOT_OWNER");
    const self = await request(`/api/mystery-boxes/${boxProduct}`, "PUT", { items: [{ variantId: boxVariant }] });
    expect((await self.json()).code).toBe("NOT_OWNER");

    state.userId = otherSeller;
    expect((await request(`/api/mystery-boxes/${boxProduct}`, "PUT", { items: [{ variantId: teeVariant }] })).status).toBe(404);

    state.userId = sellerId;
    const ok = await request(`/api/mystery-boxes/${boxProduct}`, "PUT", {
      reveal: "at_purchase", items: [{ variantId: teeVariant, weight: 2 }, { variantId: capVariant, weight: 1 }],
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.isMysteryBox).toBe(true);
    expect(body.items).toHaveLength(2);
    expect(body.catalog.map((c: any) => c.variantId)).toEqual(expect.arrayContaining([teeVariant, capVariant]));
    expect(body.catalog.map((c: any) => c.variantId)).not.toContain(boxVariant);
  });

  it("publishes an honest summary without odds unless opted in", async () => {
    state.userId = "";
    const body = await (await request(`/api/mystery-boxes/public/${boxProduct}`)).json();
    expect(body).toEqual({ isMysteryBox: true, itemCount: 1, priceRange: { minCents: 4_000, maxCents: 4_000 }, reveal: "at_purchase" });
    expect(await (await request(`/api/mystery-boxes/public/${teeVariant}`)).json()).toEqual({ isMysteryBox: false });
  });

  it("flags an empty box for checkout", async () => {
    const { emptyMysteryBoxVariants } = await import("../../lib/mysteryBox");
    expect(await emptyMysteryBoxVariants(db, [boxVariant, teeVariant])).toEqual([]);
  });

  it("picks on payment, decrements the pick, flags the unfilled unit and is idempotent", async () => {
    expect((await postWebhook(eventIds[0])).status).toBe(200);
    const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId));
    expect(order).toBeTruthy();
    const picks = await db.select({ variantId: mysteryBoxPicks.variantId, unitIndex: mysteryBoxPicks.unitIndex })
      .from(mysteryBoxPicks).innerJoin(orderItems, eq(orderItems.id, mysteryBoxPicks.orderItemId))
      .where(eq(orderItems.orderId, order.id));
    // Two units: the only in-stock candidate (tee, stock 1) is taken once; the second has nothing left.
    expect(picks.sort((a, b) => a.unitIndex - b.unitIndex)).toEqual([
      { variantId: teeVariant, unitIndex: 0 }, { variantId: null, unitIndex: 1 },
    ]);
    const stocks = await db.select({ id: productVariants.id, stock: productVariants.stock })
      .from(productVariants).where(inArray(productVariants.id, [teeVariant, capVariant, boxVariant]));
    const stockOf = Object.fromEntries(stocks.map((s) => [s.id, s.stock]));
    expect(stockOf).toEqual({ [teeVariant]: 0, [capVariant]: 0, [boxVariant]: 8 });
    const flags = await db.select().from(notificationsFeed)
      .where(eq(notificationsFeed.userId, sellerId));
    expect(flags.filter((f) => f.type === "mystery_box_unfilled")).toHaveLength(1);

    // Stripe retries with a new event id for the same session: nothing changes.
    expect((await postWebhook(eventIds[1])).status).toBe(200);
    const after = await db.select({ id: mysteryBoxPicks.id }).from(mysteryBoxPicks)
      .innerJoin(orderItems, eq(orderItems.id, mysteryBoxPicks.orderItemId)).where(eq(orderItems.orderId, order.id));
    expect(after).toHaveLength(2);

    // Box is now empty for the next buyer.
    const { emptyMysteryBoxVariants } = await import("../../lib/mysteryBox");
    expect(await emptyMysteryBoxVariants(db, [boxVariant])).toEqual([boxVariant]);

    // Buyer sees the revealed item; another user sees nothing.
    state.userId = buyerId;
    const reveal = await (await request(`/api/buyer/mystery-boxes/orders/${order.id}`)).json();
    expect(reveal.reveals).toEqual([expect.objectContaining({ variantId: teeVariant, name: `Tee-${suffix}`, size: "M" })]);
    state.userId = otherSeller;
    expect((await request(`/api/buyer/mystery-boxes/orders/${order.id}`)).status).toBe(404);

    // Seller sees both units, including the one to fill by hand.
    state.userId = sellerId;
    const sellerView = await (await request(`/api/mystery-boxes/orders/${order.id}`)).json();
    expect(sellerView.picks.map((p: any) => p.needsItem)).toEqual([false, true]);
  });
});
