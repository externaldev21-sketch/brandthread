/**
 * Proves two concurrent checkouts for the last unit of a variant cannot both
 * win it — the actual regression this workstream is about (server-authoritative,
 * atomic stock; oversell must be impossible across concurrent requests).
 *
 * This is a REAL concurrency test, not a unit test of the SQL clause in
 * isolation: two independent Stripe "checkout.session.completed" webhook
 * requests are fired at the running Express app at the same time (`Promise.all`,
 * not sequential awaits) against a variant seeded with stock = 1. Both go
 * through the exact same code path production traffic uses
 * (routes/webhooks.ts -> handleCheckoutPaid -> lib/stockReservation.ts), each
 * inside its own real Postgres transaction, so this exercises the actual
 * `SELECT ... FOR UPDATE` row lock + all-or-nothing decrement — not a mock.
 *
 * Expected outcome: exactly one order is created with status "pending" (the
 * winner, stock decremented) and the other with status "refund_pending" (the
 * loser, stock left untouched, refunded separately) — and the variant's final
 * stock is 0, never negative.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import {
  db,
  checkoutSessions,
  notificationsFeed,
  orderItems,
  orders,
  productVariants,
  products,
  users,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

// Keyed by the (fake) stripe-signature header so two concurrent requests each
// get their OWN event back from constructEvent() — a single shared
// `state.event` variable would itself race between the two concurrent
// fetches below (both dispatched before either request handler runs), which
// would make this test's own harness the source of nondeterminism instead of
// proving anything about the server's real concurrency handling.
const state = vi.hoisted(() => ({ eventsBySignature: new Map<string, any>() }));

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

const suffix = crypto.randomUUID();
const sellerId = `oversell-seller-${suffix}`;
const buyerId = `oversell-buyer-${suffix}`;
const buyerSessionId = `cs_oversell_buyer_${suffix}`;
const guestSessionId = `cs_oversell_guest_${suffix}`;
const guestEmail = `guest-${suffix}@test.local`;
let variantId = "";
let server: Server;
let base = "";

function paidEvent(id: string, sessionId: string, csRef: string) {
  return {
    id,
    type: "checkout.session.completed",
    created: 1_756_600_000,
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: `pi_${sessionId}`,
        amount_total: 2_500,
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
        metadata: { csRef },
      },
    },
  };
}

async function postWebhook(event: any) {
  const sig = `test-signature-${event.id}`;
  state.eventsBySignature.set(sig, event);
  return fetch(`${base}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": sig },
    body: "{}",
  });
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Oversell Seller", role: "seller", accountType: "seller" },
    { clerkId: buyerId, email: `${buyerId}@test.local`, name: "Sam Rivera", role: "buyer", accountType: "buyer" },
  ]);
  const [product] = await db.insert(products).values({
    ownerId: sellerId, name: "Last Unit Jacket", category: "apparel", status: "active",
  }).returning({ id: products.id });
  const [variant] = await db.insert(productVariants).values({
    // The whole point of this test: only ONE unit exists.
    productId: product.id, sku: `oversell-${suffix}`, priceCents: 2_500, stock: 1, lowStockThreshold: 5,
  }).returning({ id: productVariants.id });
  variantId = variant.id;

  const item = { variantId, productName: "Last Unit Jacket", variantLabel: "M", quantity: 1, priceCents: 2_500 };
  const address = { name: "Sam Rivera", street: "500 SW 5th Ave", city: "Portland", state: "OR", zip: "97204", country: "US" };
  const [buyerCheckout] = await db.insert(checkoutSessions).values({
    stripeSessionId: buyerSessionId, buyerId, sellerId, items: [item], shippingAddress: address,
  }).returning({ id: checkoutSessions.id });
  const [guestCheckout] = await db.insert(checkoutSessions).values({
    stripeSessionId: guestSessionId, guestEmail, sellerId, items: [item],
    shippingAddress: { ...address, name: "Guest Buyer" },
  }).returning({ id: checkoutSessions.id });

  const { default: webhookRouter } = await import("../webhooks");
  const app = express();
  app.use("/api/webhooks", express.raw({ type: "application/json" }));
  app.use((req, _res, next) => {
    (req as any).log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api/webhooks", webhookRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // ── The actual concurrency proof ────────────────────────────────────────
  // Two independent buyers "pay" for the same last unit at the same time.
  // Fired together (Promise.all), not one-after-another, so this is a race
  // against the real DB, not a sequential simulation of one.
  const [buyerRes, guestRes] = await Promise.all([
    postWebhook(paidEvent(`evt_oversell_buyer_${suffix}`, buyerSessionId, buyerCheckout.id)),
    postWebhook(paidEvent(`evt_oversell_guest_${suffix}`, guestSessionId, guestCheckout.id)),
  ]);
  expect(buyerRes.status).toBe(200);
  expect(guestRes.status).toBe(200);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.execute(sql`DELETE FROM stripe_webhook_events WHERE event_id IN (${`evt_oversell_buyer_${suffix}`}, ${`evt_oversell_guest_${suffix}`})`);
  await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, sellerId));
  const created = await db.select({ id: orders.id }).from(orders).where(eq(orders.ownerId, sellerId));
  if (created.length) {
    const ids = created.map((o) => o.id);
    await db.delete(orderItems).where(inArray(orderItems.orderId, ids));
    await db.delete(orders).where(inArray(orders.id, ids)).catch(() => {});
  }
  await db.delete(checkoutSessions).where(inArray(checkoutSessions.stripeSessionId, [buyerSessionId, guestSessionId]));
  await db.delete(productVariants).where(eq(productVariants.id, variantId));
  await db.delete(products).where(eq(products.ownerId, sellerId));
  await db.delete(users).where(inArray(users.clerkId, [sellerId, buyerId]));
});

describe("concurrent checkouts for the last unit of stock", () => {
  it("lets exactly one order win the unit and never oversells", async () => {
    const createdOrders = await db
      .select({ id: orders.id, status: orders.status, stripeCheckoutSessionId: orders.stripeCheckoutSessionId })
      .from(orders)
      .where(eq(orders.ownerId, sellerId));

    // Both webhook deliveries create their own order row (one winner, one
    // loser) — neither request is silently dropped.
    expect(createdOrders).toHaveLength(2);

    const statuses = createdOrders.map((o) => o.status).sort();
    // Exactly one winner ("pending" — stock claimed) and one loser
    // ("refund_pending" — oversold, refunded, no stock taken). If the
    // reservation were not atomic, this could read ["pending", "pending"]
    // (both think they won) instead.
    expect(statuses).toEqual(["pending", "refund_pending"]);

    const [variant] = await db
      .select({ stock: productVariants.stock })
      .from(productVariants)
      .where(eq(productVariants.id, variantId));
    // The decisive assertion: stock lands at exactly 0 — one unit taken by
    // the winner, never both (which would read -1) and never neither
    // (which would read 1).
    expect(variant?.stock).toBe(0);
  });
});
