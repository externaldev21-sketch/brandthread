/**
 * SELLER-AS-BUYER — a seller account (users.accountType = 'seller') can do
 * every buyer action in the Threads feed against another seller, through the
 * same endpoints the mobile buyer screens call (artifacts/mobile/lib/api.ts):
 *
 *   S1 (seller, shopping) → S2 (seller, selling)
 *     POST   /api/social/follow                       follow S2
 *     GET    /api/posts/feed                          S2's post reaches S1's Thread feed
 *     POST   /api/posts/:id/interact {type:"like"}    like S2's post
 *     POST   /api/posts/:id/comments                  comment on S2's post
 *     POST   /api/buyer/saved                         save S2's product
 *     POST   /api/buyer/cart/sync, GET /api/buyer/cart add S2's product to the bag
 *     POST   /api/buyer/checkout/payment-intent       one-page checkout (app/buyer-checkout.tsx)
 *     POST   /api/webhooks/stripe (payment_intent.succeeded, real signature check)
 *     GET    /api/buyer/orders                        the paid order in S1's PURCHASES
 *   S2 sees the order in GET /api/orders (its sales) and gets new_order_received.
 *
 * Mocks mirror connectivity-commerce-social.integration.test.ts (requireAuth
 * via x-test-user-id; requireRole/teamContext pass-through). Stripe is the
 * in-memory fake from lib/money/__tests__/fakeStripe.ts so the checkout route
 * can create a real PaymentIntent and the webhook is delivered signed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db, users, orders, checkoutSessions, productVariants, products, savedItems, posts, interactions,
  postComments, notificationsFeed, follows, cartItems, shippingRates,
} from "@workspace/db";

const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const S1 = `sab-seller-buyer-${suffix}`; // seller shopping as a buyer
const S2 = `sab-seller-store-${suffix}`; // seller being bought from
const ALL_IDS = [S1, S2];

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const header = req.header("x-test-user-id");
    if (!header) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = header;
    next();
  },
}));

vi.mock("../../middlewares/requireRole", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../middlewares/requireRole")>();
  return {
    ...actual,
    teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
    requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock("../../lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/stripe")>();
  const { fake, TEST_WEBHOOK_SECRET } = await import("../../lib/money/__tests__/fakeStripe");
  return { ...actual, stripe: fake.stripe, requireStripe: () => fake.stripe, STRIPE_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET };
});
vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return {
    ...actual,
    normalizePushEventCategory: vi.fn(() => "orders"),
    sendPushToUser: vi.fn(async () => {}),
  };
});
vi.mock("../../lib/brandthreadEmail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/brandthreadEmail")>()),
  isOrderConfirmationEligibleStatus: vi.fn(() => true),
  sendOrderConfirmationEmail: vi.fn(async () => true),
  sendBrandthreadEmail: vi.fn(async () => true),
}));

import { fake } from "../../lib/money/__tests__/fakeStripe";

let server: Server;
let base = "";
let webhookServer: Server;
let webhookBase = "";

async function call(method: string, path: string, userId: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "x-test-user-id": userId, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (text && text.trim().startsWith("<")) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function waitForNotification(userId: string, type: string, actorId?: string) {
  const deadline = Date.now() + 4000;
  for (;;) {
    const rows = await db.select().from(notificationsFeed).where(and(
      eq(notificationsFeed.userId, userId),
      eq(notificationsFeed.type, type),
      actorId ? eq(notificationsFeed.actorId, actorId) : undefined,
    ));
    if (rows.length > 0 || Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let postId = "";
let productId = "";
let variantId = "";
let paymentIntentId = "";
const eventId = `evt_sab_${suffix}`;

beforeAll(async () => {
  await db.insert(users).values([
    {
      clerkId: S1, email: `${S1}@example.test`, name: "Shopping Seller", displayName: "Shopping Seller",
      brandName: "Shopping Seller Co", accountType: "seller", role: "seller", onboardingComplete: true,
      stripeAccountId: `acct_${S1.replace(/-/g, "_")}`, stripeAccountStatus: "active",
      subscriptionStatus: "trialing", subscriptionPlanId: "starter",
    },
    {
      clerkId: S2, email: `${S2}@example.test`, name: "Selling Seller", displayName: "Selling Seller",
      brandName: "Selling Seller Co", accountType: "seller", role: "seller", onboardingComplete: true,
      stripeAccountId: `acct_${S2.replace(/-/g, "_")}`, stripeAccountStatus: "active",
      subscriptionStatus: "trialing", subscriptionPlanId: "starter",
    },
  ]);

  const [product] = await db.insert(products).values({
    ownerId: S2, name: "Seller-to-seller tee", category: "apparel", status: "active",
  }).returning({ id: products.id });
  productId = product.id;
  const [variant] = await db.insert(productVariants).values({
    productId, sku: `sab-${suffix}`, size: "M", priceCents: 4_000, stock: 5,
  }).returning({ id: productVariants.id });
  variantId = variant.id;
  await db.insert(shippingRates).values({ id: `sab-rate-${suffix}`, sellerId: S2, name: "Free shipping", flatRateCents: 0 });

  const [post] = await db.insert(posts).values({ userId: S2, mediaUrl: "https://example.test/sab-post.jpg" })
    .returning({ id: posts.id });
  postId = post.id;

  const [
    { default: savedRouter }, { default: postsRouter }, { default: postCommentsRouter },
    { default: ordersRouter }, { default: socialRouter }, { default: cartDbRouter },
    { default: checkoutIntentRouter }, { default: buyerRouter },
  ] = await Promise.all([
    import("../saved"), import("../posts"), import("../post-comments"),
    import("../orders"), import("../social"), import("../cart-db"),
    import("../checkout-intent"), import("../buyer"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error() {}, warn() {}, info() {} }; next(); });
  // Same mount order as routes/index.ts.
  app.use("/api/orders", ordersRouter);
  app.use("/api/buyer/saved", savedRouter);
  app.use("/api/buyer/cart", cartDbRouter);
  app.use("/api/buyer/checkout/payment-intent", checkoutIntentRouter);
  app.use("/api/buyer", buyerRouter);
  app.use("/api/posts", postCommentsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/social", socialRouter);
  app.use((err: any, _req: any, res: any, _next: any) => { res.status(500).json({ error: String(err?.stack ?? err) }); });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const { default: webhookRouter } = await import("../webhooks");
  const whApp = express();
  whApp.use(express.raw({ type: "application/json" }));
  whApp.use((req, _res, next) => { (req as any).log = { error() {}, warn() {}, info() {} }; next(); });
  whApp.use("/api/webhooks", webhookRouter);
  webhookServer = whApp.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => webhookServer.once("listening", resolve));
  webhookBase = `http://127.0.0.1:${(webhookServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const cleanup = async (step: () => Promise<unknown>) => { await step().catch(() => {}); };
  const orderRows = await db.select({ id: orders.id }).from(orders).where(inArray(orders.ownerId, ALL_IDS)).catch(() => []);
  const orderIds = orderRows.map((o) => o.id);
  const checkoutRows = await db.select({ id: checkoutSessions.id }).from(checkoutSessions)
    .where(inArray(checkoutSessions.sellerId, ALL_IDS)).catch(() => []);
  const checkoutIds = checkoutRows.map((c) => c.id);
  await cleanup(() => db.execute(sql`DELETE FROM stripe_webhook_events WHERE event_id = ${eventId}`));
  await cleanup(() => db.delete(postComments).where(eq(postComments.postId, postId)));
  await cleanup(() => db.delete(interactions).where(eq(interactions.postId, postId)));
  await cleanup(() => db.delete(posts).where(eq(posts.id, postId)));
  await cleanup(() => db.delete(savedItems).where(inArray(savedItems.userId, ALL_IDS)));
  await cleanup(() => db.delete(cartItems).where(inArray(cartItems.userId, ALL_IDS)));
  await cleanup(() => db.delete(follows).where(or(inArray(follows.followerId, ALL_IDS), inArray(follows.followingId, ALL_IDS))));
  await cleanup(() => db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ALL_IDS)));
  if (checkoutIds.length) {
    await cleanup(() => db.execute(sql`DELETE FROM stock_reservations WHERE checkout_session_id IN (${sql.join(checkoutIds.map((id) => sql`${id}::uuid`), sql`, `)})`));
  }
  if (orderIds.length) await cleanup(() => db.delete(orders).where(inArray(orders.id, orderIds)));
  if (checkoutIds.length) await cleanup(() => db.delete(checkoutSessions).where(inArray(checkoutSessions.id, checkoutIds)));
  await cleanup(() => db.delete(shippingRates).where(eq(shippingRates.sellerId, S2)));
  await cleanup(() => db.delete(productVariants).where(eq(productVariants.productId, productId)));
  await cleanup(() => db.delete(products).where(eq(products.id, productId)));
  await cleanup(() => db.delete(users).where(inArray(users.clerkId, ALL_IDS)));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await new Promise<void>((resolve) => webhookServer?.close(() => resolve()));
});

describe("a seller account shopping as a buyer (S1 → S2)", () => {
  it("S1 follows S2, and S2's post reaches S1's Thread feed", async () => {
    const res = await call("POST", "/api/social/follow", S1, { userId: S2 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ ok: true, isFollowing: true });
    const rows = await db.select().from(follows).where(and(eq(follows.followerId, S1), eq(follows.followingId, S2)));
    expect(rows).toHaveLength(1);
    expect(await waitForNotification(S2, "new_follower", S1)).toHaveLength(1);

    const feed = await call("GET", "/api/posts/feed", S1);
    expect(feed.status, JSON.stringify(feed.body)).toBe(200);
    const items = (Array.isArray(feed.body) ? feed.body : feed.body.posts ?? feed.body.items) as Array<{ id: string }>;
    expect(items.some((p) => p.id === postId)).toBe(true);
  });

  it("S1 likes and comments on S2's post; S2 is notified", async () => {
    const like = await call("POST", `/api/posts/${postId}/interact`, S1, { type: "like" });
    expect(like.status, JSON.stringify(like.body)).toBe(200);
    expect(like.body).toMatchObject({ action: "added", count: 1 });
    expect(await waitForNotification(S2, "post_like", S1)).toHaveLength(1);

    const comment = await call("POST", `/api/posts/${postId}/comments`, S1, { body: "Collab soon?" });
    expect(comment.status, JSON.stringify(comment.body)).toBe(201);
    expect(await waitForNotification(S2, "post_comment", S1)).toHaveLength(1);
    const page = await call("GET", `/api/posts/${postId}/comments`, S1);
    expect((page.body.comments as Array<{ body: string }>).some((c) => c.body === "Collab soon?")).toBe(true);
  });

  it("S1 saves S2's product and adds it to the server cart", async () => {
    const save = await call("POST", "/api/buyer/saved", S1, { type: "product", targetId: productId, title: "Seller-to-seller tee" });
    expect(save.status, JSON.stringify(save.body)).toBe(201);

    const line = { id: variantId, variantId, productId, sellerId: S2, name: "Seller-to-seller tee", priceCents: 4_000, quantity: 1 };
    const sync = await call("POST", "/api/buyer/cart/sync", S1, { items: [line], savedItems: [] });
    expect(sync.status, JSON.stringify(sync.body)).toBe(200);
    expect(sync.body).toMatchObject({ ok: true, count: 1 });

    const cart = await call("GET", "/api/buyer/cart", S1);
    expect(cart.status).toBe(200);
    expect(cart.body.items).toHaveLength(1);
    expect(cart.body.items[0]).toMatchObject({ variantId, productId, isAvailable: true });
  });

  it("S1 checks out (one-page PaymentIntent), the signed webhook pays it, S1 sees it in buyer orders, S2 gets the order + new_order_received", async () => {
    const cart = await call("GET", "/api/buyer/cart", S1);
    const groups = [{ items: (cart.body.items as any[]).map((i) => ({ variantId: i.variantId, productId: i.productId, quantity: i.quantity })) }];

    const start = await call("POST", "/api/buyer/checkout/payment-intent", S1, {
      groups,
      contactEmail: `${S1}@example.test`,
      contactPhone: "+1 503 555 0100",
      shippingAddress: {
        recipientName: "Shopping Seller", street: "148 Mercer Street", line2: null,
        city: "New York", state: "NY", postalCode: "10012", country: "US",
      },
      clientIdempotencyKey: `sab-pay-${suffix}`,
    });
    expect(start.status, JSON.stringify(start.body)).toBe(200);
    paymentIntentId = start.body.paymentIntentId;
    expect(start.body.groups).toHaveLength(1);
    expect(start.body.groups[0]).toMatchObject({ sellerId: S2 });

    // Stripe reports the intent paid; deliver it through the REAL webhook route with a real signature.
    const intent = fake.state.paymentIntents.get(paymentIntentId);
    intent.status = "succeeded";
    intent.amount_received = intent.amount;
    intent.latest_charge = `ch_${paymentIntentId}`;
    const { payload, header } = fake.signedEvent({
      id: eventId, object: "event", type: "payment_intent.succeeded",
      created: Math.floor(Date.now() / 1000), data: { object: intent },
    });
    const webhookRes = await fetch(`${webhookBase}/api/webhooks/stripe`, {
      method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload,
    });
    expect(webhookRes.status, await webhookRes.clone().text()).toBe(200);

    const made = await db.select({ id: orders.id, ownerId: orders.ownerId, buyerId: orders.buyerId })
      .from(orders).where(eq(orders.stripePaymentIntentId, paymentIntentId));
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ ownerId: S2, buyerId: S1 });
    const orderId = made[0].id;

    // S1's purchases (mobile buyer orders screen: GET /api/buyer/orders).
    const purchases = await call("GET", "/api/buyer/orders", S1);
    expect(purchases.status, JSON.stringify(purchases.body)).toBe(200);
    expect((purchases.body as Array<{ id: string; ownerId: string }>).find((o) => o.id === orderId))
      .toMatchObject({ ownerId: S2 });
    const detail = await call("GET", `/api/buyer/orders/${orderId}`, S1);
    expect(detail.status).toBe(200);

    // GET /api/orders is the SALES list: S2 sees the order, S1 (the purchaser) does not.
    const s2Sales = await call("GET", "/api/orders", S2);
    expect(s2Sales.status).toBe(200);
    expect((s2Sales.body as Array<{ id: string }>).some((o) => o.id === orderId)).toBe(true);
    const s1Sales = await call("GET", "/api/orders", S1);
    expect(s1Sales.status).toBe(200);
    expect((s1Sales.body as Array<{ id: string }>).some((o) => o.id === orderId)).toBe(false);

    const notifs = await waitForNotification(S2, "new_order_received");
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ targetId: orderId, targetType: "order" });
  });
});
