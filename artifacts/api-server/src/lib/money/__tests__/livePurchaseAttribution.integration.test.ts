/**
 * Buying from a live, buyer → seller, end to end: the real checkout routes
 * (hosted Stripe Checkout Session and one-page PaymentIntent), the real
 * paid webhook handler, the real `ws` hub and the seller's live analytics
 * route, against real Postgres with the in-memory Stripe.
 *
 *   buyer checks out from a live → checkout row and order carry the stream →
 *   the host's socket gets "<first name> bought <product>" → the live summary
 *   counts the order, units, revenue, viewers, gifts →
 *   a refund lowers revenue →
 *   another seller's stream, a stream past the grace window, or a payment
 *   landing after it, are silently not attributed (checkout still works).
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
vi.mock("../../../middlewares/requireAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../middlewares/requireAuth")>()),
  requireAuth: (req: any, res: any, next: () => void) => {
    const id = req.headers["x-test-user"];
    if (!id) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = id;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../ws/auth", () => ({
  verifyWsToken: async (token: string | undefined | null) => (token ? token : null),
}));

import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import WS from "ws";
import {
  db, checkoutSessions, liveComments, liveStreams, liveViewers, orders, shippingRates, threadCashEntries, users,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { fake } from "./fakeStripe";
import { handleCartPaymentSucceeded, handleCheckoutPaid } from "../../../routes/webhooks";
import buyerRouter from "../../../routes/buyer";
import checkoutIntentRouter from "../../../routes/checkout-intent";
import liveAnalyticsRouter from "../../../routes/live-analytics";
import { attachLiveWebSocket } from "../../../ws/liveHub";
import { refundOrder } from "../refunds";
import { call, expectLedgerBalanced, seedBuyer, seedProduct, seedSeller, uid } from "./moneyHarness";

const PRICE = 6_000;
const SHIPPING = 800;

let server: Server;
let base = "";
let wsBase = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {}, info: () => {} }; next(); });
  app.use("/api/buyer/checkout/payment-intent", checkoutIntentRouter);
  app.use("/api/buyer", buyerRouter);
  app.use("/api/live", liveAnalyticsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: String(err?.stack ?? err) }); });
  server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
  attachLiveWebSocket(server);
});
afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await expectLedgerBalanced();
});
beforeEach(() => fake.reset());

async function seedShop(tag: string) {
  const host = await seedSeller(`${tag}-host`);
  const other = await seedSeller(`${tag}-other`);
  const buyer = await seedBuyer(tag);
  await db.update(users).set({ displayName: "Jordan Reyes" }).where(eq(users.clerkId, buyer));
  const product = await seedProduct(host, { priceCents: PRICE });
  const otherProduct = await seedProduct(other, { priceCents: PRICE });
  await db.insert(shippingRates).values([
    { id: uid("rate"), sellerId: host, name: "Standard", flatRateCents: SHIPPING },
    { id: uid("rate"), sellerId: other, name: "Standard", flatRateCents: SHIPPING },
  ]);
  return { host, other, buyer, product, otherProduct };
}

async function seedLive(sellerId: string, opts: { startedMinAgo: number; endedMinAgo?: number }) {
  const [row] = await db.insert(liveStreams).values({
    sellerId,
    channelName: `bt_${uid("ch")}`,
    title: "Fall drop live",
    status: opts.endedMinAgo == null ? "live" : "ended",
    startedAt: new Date(Date.now() - opts.startedMinAgo * 60_000),
    endedAt: opts.endedMinAgo == null ? null : new Date(Date.now() - opts.endedMinAgo * 60_000),
  }).returning();
  return row.id;
}

function checkoutBody(product: { productId: string; variantId: string }, extra: Record<string, unknown> = {}) {
  return {
    items: [{ variantId: product.variantId, productId: product.productId, quantity: 1 }],
    successUrl: "https://brandthread.test/checkout/success",
    cancelUrl: "https://brandthread.test/checkout/cancel",
    contactEmail: "buyer@test.local",
    contactPhone: "+1 503 555 0100",
    shippingAddress: {
      recipientName: "Jordan Reyes", street: "148 Mercer Street", city: "New York",
      state: "NY", postalCode: "10012", country: "US", phone: "+1 503 555 0100",
    },
    clientIdempotencyKey: uid("idem"),
    ...extra,
  };
}

/** Stripe reports the hosted session paid; the real webhook handler builds the order. */
async function payStripeSession(sessionId: string, paidAt = new Date()) {
  const [checkout] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, sessionId)).limit(1);
  const session = fake.state.checkoutSessions.get(sessionId);
  session.status = "complete";
  session.payment_status = "paid";
  session.payment_intent = `pi_${uid("pi").replace(/-/g, "_")}`;
  session.amount_total = PRICE + SHIPPING;
  session.total_details = { amount_tax: 0, amount_shipping: SHIPPING, amount_discount: 0 };
  session.metadata = { ...session.metadata, csRef: checkout.id };
  await handleCheckoutPaid(session, `evt_${uid("paid")}`, paidAt);
  const [order] = await db.select().from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId)).limit(1);
  return { checkout, order };
}

function hostSocket(streamId: string, userId: string): Promise<{ ws: WS; events: any[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WS(`${wsBase}/ws/live?streamId=${streamId}&token=${userId}&role=host`);
    const events: any[] = [];
    ws.on("message", (raw) => events.push(JSON.parse(raw.toString())));
    ws.once("open", () => resolve({ ws, events }));
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`ws ${res.statusCode}`)));
  });
}

async function waitForEvent(events: any[], match: (e: any) => boolean, ms = 4000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const hit = events.find(match);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no matching event; got ${JSON.stringify(events)}`);
}

describe("Live purchase attribution — buyer → seller", () => {
  it("a purchase made in the live is attributed, announced to the host, and counted in the live summary", async () => {
    const { host, buyer, product } = await seedShop("live-attr");
    const streamId = await seedLive(host, { startedMinAgo: 20 });
    // Audience: the buyer watched (presence row → unique viewer via trigger), chatted, hearted, gifted.
    await db.insert(liveViewers).values({ streamId, userIdOrSessionId: buyer });
    await db.insert(liveComments).values({ streamId, userId: buyer, displayName: "Jordan", message: "love this" });
    await db.update(liveStreams).set({ likeCount: 12, peakViewerCount: 3 }).where(eq(liveStreams.id, streamId));
    await db.insert(threadCashEntries).values({ buyerId: host, amountCents: 500, source: "live_gift", referenceId: streamId });

    const socket = await hostSocket(streamId, host);
    try {
      const created = await call(base, "POST", "/api/buyer/checkout/session", buyer, checkoutBody(product, { liveStreamId: streamId }));
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      const { checkout, order } = await payStripeSession(created.body.sessionId);
      expect(checkout.sourceLiveStreamId).toBe(streamId);
      expect(order.sourceLiveStreamId).toBe(streamId);

      const ev = await waitForEvent(socket.events, (e) => e.type === "purchase");
      expect(ev.purchase).toMatchObject({ id: order.id, buyerFirstName: "Jordan", productName: product.productName, units: 1, sellerId: host });
    } finally {
      socket.ws.close();
    }

    const summary = await call(base, "GET", `/api/live/${streamId}/analytics`, host);
    expect(summary.status, JSON.stringify(summary.body)).toBe(200);
    expect(summary.body.audience).toEqual({ peakViewers: 3, uniqueViewers: 1, comments: 1, likes: 12 });
    expect(summary.body.gifts).toEqual({ count: 1, threadCashCents: 500 });
    expect(summary.body.sales).toMatchObject({
      orders: 1, buyers: 1, units: 1, grossCents: PRICE + SHIPPING, refundedCents: 0, revenueCents: PRICE + SHIPPING, conversionRate: 1,
    });
    expect(summary.body.topProducts).toEqual([expect.objectContaining({ name: product.productName, units: 1, revenueCents: PRICE })]);
    expect(summary.body.stream.durationSeconds).toBeGreaterThanOrEqual(20 * 60 - 5);

    // Only the host reads it.
    expect((await call(base, "GET", `/api/live/${streamId}/analytics`, buyer)).status).toBe(404);

    const recent = await call(base, "GET", "/api/live/analytics/recent", host);
    expect(recent.body.lives[0]).toMatchObject({ streamId, orders: 1, revenueCents: PRICE + SHIPPING, status: "live" });

    // A partial refund lowers the live's revenue.
    const [attributed] = await db.select().from(orders).where(eq(orders.sourceLiveStreamId, streamId));
    await refundOrder({ orderId: attributed.id, amountCents: 1_000, reason: "return_approved", initiatedBy: host, idempotencyKey: uid("refund") });
    const after = await call(base, "GET", `/api/live/${streamId}/analytics`, host);
    expect(after.body.sales).toMatchObject({ orders: 1, grossCents: PRICE + SHIPPING, refundedCents: 1_000, revenueCents: PRICE + SHIPPING - 1_000 });
  });

  it("another seller's stream is ignored — the order still goes through, unattributed", async () => {
    const { host, buyer, otherProduct } = await seedShop("live-attr-foreign");
    const streamId = await seedLive(host, { startedMinAgo: 5 });
    const created = await call(base, "POST", "/api/buyer/checkout/session", buyer, checkoutBody(otherProduct, { liveStreamId: streamId }));
    expect(created.status).toBe(200);
    const { checkout, order } = await payStripeSession(created.body.sessionId);
    expect(checkout.sourceLiveStreamId).toBeNull();
    expect(order).toBeTruthy();
    expect(order.sourceLiveStreamId).toBeNull();
    // Garbage ids are ignored too, never a 400.
    expect((await call(base, "POST", "/api/buyer/checkout/session", buyer, checkoutBody(otherProduct, { liveStreamId: "not-a-stream" }))).status).toBe(200);
  });

  it("an accepted co-host's sale counts for the stream and shows as their contribution", async () => {
    const { host, other, buyer, otherProduct } = await seedShop("live-attr-cohost");
    const streamId = await seedLive(host, { startedMinAgo: 15 });
    await db.execute(sql`
      INSERT INTO live_cohosts (stream_id, host_id, cohost_id, status, responded_at)
      VALUES (${streamId}::uuid, ${host}, ${other}, 'accepted', now() - interval '10 minutes')
    `);
    const created = await call(base, "POST", "/api/buyer/checkout/session", buyer, checkoutBody(otherProduct, { liveStreamId: streamId }));
    const { order } = await payStripeSession(created.body.sessionId);
    expect(order.sourceLiveStreamId).toBe(streamId);
    expect(order.ownerId).toBe(other);

    const summary = await call(base, "GET", `/api/live/${streamId}/analytics`, host);
    // The host's own totals stay theirs; the co-host's sale is listed separately.
    expect(summary.body.sales.orders).toBe(0);
    expect(summary.body.cohosts).toEqual([expect.objectContaining({ userId: other, orders: 1, revenueCents: PRICE + SHIPPING })]);
  });

  it("grace window: 10 minutes after the end still counts, 2 hours after does not", async () => {
    const { host, buyer, product } = await seedShop("live-attr-grace");
    const recent = await seedLive(host, { startedMinAgo: 60, endedMinAgo: 10 });
    const old = await seedLive(host, { startedMinAgo: 180, endedMinAgo: 120 });

    const a = await call(base, "POST", "/api/buyer/checkout/session", buyer, checkoutBody(product, { liveStreamId: recent }));
    expect((await payStripeSession(a.body.sessionId)).order.sourceLiveStreamId).toBe(recent);

    const b = await call(base, "POST", "/api/buyer/checkout/session", buyer, checkoutBody(product, { liveStreamId: old }));
    const late = await payStripeSession(b.body.sessionId);
    expect(late.checkout.sourceLiveStreamId).toBeNull();
    expect(late.order.sourceLiveStreamId).toBeNull();
  });

  it("the webhook re-checks with the payment time: checkout started live, paid long after the end → not attributed", async () => {
    const { host, buyer, product } = await seedShop("live-attr-paidlate");
    const streamId = await seedLive(host, { startedMinAgo: 30 });
    const created = await call(base, "POST", "/api/buyer/checkout/session", buyer, checkoutBody(product, { liveStreamId: streamId }));
    const [row] = await db.select().from(checkoutSessions).where(eq(checkoutSessions.stripeSessionId, created.body.sessionId));
    expect(row.sourceLiveStreamId).toBe(streamId);
    await db.update(liveStreams).set({ status: "ended", endedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(liveStreams.id, streamId));
    const { order } = await payStripeSession(created.body.sessionId);
    expect(order.sourceLiveStreamId).toBeNull();
  });

  it("one-page checkout: a cart group's live source (from a cart line added in the live) reaches the order", async () => {
    const { host, other, buyer, product, otherProduct } = await seedShop("live-attr-cart");
    const streamId = await seedLive(host, { startedMinAgo: 8 });
    const res = await call(base, "POST", "/api/buyer/checkout/payment-intent", buyer, {
      groups: [
        { items: [{ variantId: product.variantId, productId: product.productId, quantity: 1 }], liveStreamId: streamId },
        // A line from elsewhere in the same cart, also claiming the live: not the stream's seller → dropped.
        { items: [{ variantId: otherProduct.variantId, productId: otherProduct.productId, quantity: 1 }], liveStreamId: streamId },
      ],
      contactEmail: "buyer@test.local",
      contactPhone: "+1 503 555 0100",
      shippingAddress: { recipientName: "Jordan Reyes", street: "148 Mercer Street", line2: null, city: "New York", state: "NY", postalCode: "10012", country: "US" },
      clientIdempotencyKey: uid("pay"),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const intent = fake.state.paymentIntents.get(res.body.paymentIntentId);
    intent.status = "succeeded";
    intent.amount_received = intent.amount;
    intent.latest_charge = `ch_${intent.id}`;
    await handleCartPaymentSucceeded(intent, `evt_${uid("cart")}`, new Date());
    const created = await db.select().from(orders).where(eq(orders.stripePaymentIntentId, res.body.paymentIntentId));
    const bySeller = Object.fromEntries(created.map((o) => [o.ownerId, o.sourceLiveStreamId]));
    expect(bySeller).toEqual({ [host]: streamId, [other]: null });
  });
});
