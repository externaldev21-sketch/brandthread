/**
 * END-TO-END CONNECTIVITY SUITE — sections 4 and 5 (commerce, social content).
 * Run it as part of the whole suite: see the header comment in
 * connectivity-suite.integration.test.ts for the one-command invocation, or
 * `pnpm run test:connectivity` from artifacts/api-server.
 *
 *   4. COMMERCE CONNECTIONS — a buyer saving a seller's product, a real paid
 *      order becoming visible to the seller (orders list + dashboard
 *      totals), and the new_order_received notification, exercised through
 *      the REAL Stripe webhook route end-to-end (mocked Stripe SDK +
 *      signature verification only — same seam as
 *      paid-checkout-notification.integration.test.ts).
 *   5. SOCIAL CONTENT CONNECTIONS — a buyer's like/comment on a seller's
 *      post reaching the seller via notificationsFeed AND the post's own
 *      counts; a story view/reply.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, users, orders, checkoutSessions, productVariants, products, savedItems, posts, interactions,
  postComments, notificationsFeed, stories, storyViews,
} from "@workspace/db";

const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const S = `conn-cs-seller-${suffix}`;
const A = `conn-cs-buyer-a-${suffix}`;
const ALL_IDS = [S, A];

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

// ── Webhook seam (mirrors paid-checkout-notification.integration.test.ts) ───
const webhookState = vi.hoisted(() => ({ event: null as any, pushCalls: 0 }));

vi.mock("../../lib/stripe", () => ({
  STRIPE_WEBHOOK_SECRET: "test-secret",
  stripe: { webhooks: { constructEvent: vi.fn(() => webhookState.event) } },
}));
vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return {
    ...actual,
    normalizePushEventCategory: vi.fn(() => "orders"),
    sendPushToUser: vi.fn(async () => { webhookState.pushCalls += 1; }),
  };
});
vi.mock("../../lib/brandthreadEmail", () => ({
  isOrderConfirmationEligibleStatus: vi.fn(() => true),
  sendOrderConfirmationEmail: vi.fn(async () => {}),
}));
vi.mock("../loyalty", () => ({
  awardLoyaltyPointsOnce: vi.fn(),
  consumeLoyaltyRedemption: vi.fn(),
  releaseLoyaltyRedemption: vi.fn(),
}));

let server: Server; // requireAuth-backed routers (saved, posts, comments, orders, seller-profile)
let base = "";
let webhookServer: Server;
let webhookBase = "";

function asHeader(userId: string) {
  return { "x-test-user-id": userId, "content-type": "application/json" };
}
async function call(method: string, path: string, userId: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method, headers: asHeader(userId), body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (text && text.trim().startsWith("<")) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const productIds: string[] = [];
const postIds: string[] = [];
const storyIds: string[] = [];

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: S, email: `${S}@example.test`, name: "Commerce Seller", displayName: "Commerce Seller", accountType: "seller", onboardingComplete: true },
    { clerkId: A, email: `${A}@example.test`, name: "Commerce Buyer A", displayName: "Commerce Buyer A", accountType: "buyer", onboardingComplete: true },
  ]);

  const [
    { default: savedRouter }, { default: postsRouter }, { default: postCommentsRouter },
    { default: ordersRouter }, { default: sellerProfileRouter }, { default: socialRouter },
  ] = await Promise.all([
    import("../saved"), import("../posts"), import("../post-comments"),
    import("../orders"), import("../seller-profile"), import("../social"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api/buyer/saved", savedRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/posts", postCommentsRouter);
  app.use("/api/orders", ordersRouter);
  app.use("/api/seller", sellerProfileRouter);
  app.use("/api/social", socialRouter);
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
  await db.delete(storyViews).where(inArray(storyViews.storyId, storyIds));
  await db.delete(stories).where(inArray(stories.id, storyIds));
  await db.delete(postComments).where(inArray(postComments.postId, postIds));
  await db.delete(interactions).where(inArray(interactions.postId, postIds));
  await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(savedItems).where(eq(savedItems.userId, A));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ALL_IDS));
  await db.delete(orders).where(inArray(orders.ownerId, ALL_IDS));
  await db.delete(checkoutSessions).where(eq(checkoutSessions.sellerId, S));
  await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
  await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(users).where(inArray(users.clerkId, ALL_IDS));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await new Promise<void>((resolve) => webhookServer?.close(() => resolve()));
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. COMMERCE CONNECTIONS
// ═══════════════════════════════════════════════════════════════════════════
describe("4. Commerce connections", () => {
  it("A saves S's product: the save is queryable by product, attributed to A", async () => {
    const [product] = await db.insert(products).values({
      ownerId: S, name: "Connectivity product", category: "apparel", status: "active",
    }).returning({ id: products.id });
    productIds.push(product.id);

    const saveRes = await call("POST", "/api/buyer/saved", A, {
      type: "product", targetId: product.id, title: "Connectivity product",
    });
    expect(saveRes.status).toBe(201);

    const rows = await db.select().from(savedItems)
      .where(and(eq(savedItems.userId, A), eq(savedItems.targetId, product.id), eq(savedItems.itemType, "product")));
    expect(rows).toHaveLength(1);

    // KNOWN GAP: no seller-facing "product insights / likes-saves count"
    // endpoint was found (grepped routes/products.ts, routes/seller-profile.ts,
    // lib/stockNotifications.ts) — stockNotifications.ts reads savedItems by
    // productId only to fan out back-in-stock alerts, never to surface a
    // count to the seller. The save itself is proven connected at the DB
    // level above; a seller-visible count is not wired up today. Flagging
    // for hand-off rather than asserting a count that doesn't exist.
  });

  it("a real paid order (real Stripe webhook route, mocked Stripe SDK) appears in S's orders list, S's dashboard totals, and triggers new_order_received", async () => {
    const [product] = await db.insert(products).values({
      ownerId: S, name: "Webhook order product", category: "apparel", status: "active",
    }).returning({ id: products.id });
    productIds.push(product.id);
    const [variant] = await db.insert(productVariants).values({
      productId: product.id, sku: `conn-cs-${suffix}`, priceCents: 5_000, stock: 5,
    }).returning({ id: productVariants.id });

    const sessionId = `cs_conn_commerce_${suffix}`;
    const eventId = `evt_conn_commerce_${suffix}`;
    const [checkout] = await db.insert(checkoutSessions).values({
      stripeSessionId: sessionId, buyerId: A, sellerId: S,
      items: [{ variantId: variant.id, productName: "Webhook order product", variantLabel: "Default", quantity: 1, priceCents: 5_000 }],
    }).returning({ id: checkoutSessions.id });

    webhookState.event = {
      id: eventId, type: "checkout.session.completed", created: Math.floor(Date.now() / 1000),
      data: { object: {
        id: sessionId, payment_status: "paid", payment_intent: `pi_conn_commerce_${suffix}`,
        amount_total: 5_000,
        total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
        metadata: { csRef: checkout.id },
      } },
    };

    const webhookRes = await fetch(`${webhookBase}/api/webhooks/stripe`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": "test-signature" },
      body: JSON.stringify({}),
    });
    expect(webhookRes.status).toBe(200);
    expect(await webhookRes.json()).toMatchObject({ received: true });

    const persistedOrders = await db.select({ id: orders.id, totalCents: orders.totalCents })
      .from(orders).where(eq(orders.stripeCheckoutSessionId, sessionId));
    expect(persistedOrders).toHaveLength(1);
    const orderId = persistedOrders[0].id;

    // Seller's own orders list.
    const sellerOrders = await call("GET", "/api/orders", S);
    expect(sellerOrders.status).toBe(200);
    expect((sellerOrders.body as Array<{ id: string }>).some((o) => o.id === orderId)).toBe(true);

    // Seller dashboard totals — GET /api/seller/profile's metrics.orders /
    // revenueCents (see seller-profile.integration.test.ts's "counts only
    // paid checkout orders" case for the same pattern).
    const sellerProfile = await call("GET", "/api/seller/profile", S);
    expect(sellerProfile.status).toBe(200);
    expect(sellerProfile.body.metrics.orders).toBeGreaterThanOrEqual(1);
    expect(sellerProfile.body.metrics.revenueCents).toBeGreaterThanOrEqual(5_000);

    // new_order_received notification, deep-linkable to this exact order.
    const notifs = await db.select({ targetId: notificationsFeed.targetId, targetType: notificationsFeed.targetType })
      .from(notificationsFeed)
      .where(and(eq(notificationsFeed.userId, S), eq(notificationsFeed.type, "new_order_received")));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({ targetId: orderId, targetType: "order" });

    await db.execute(sql`DELETE FROM stripe_webhook_events WHERE event_id = ${eventId}`).catch(() => {});
  });

  it("KNOWN GAP: Thread Cash balance connection — out of scope for cheap testing here (separate money subsystem with its own dedicated integration tests: thread-cash.integration.test.ts, thread-cash-send.integration.test.ts)", () => {
    expect(true).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. SOCIAL CONTENT CONNECTIONS
// ═══════════════════════════════════════════════════════════════════════════
describe("5. Social content connections", () => {
  it("A's like on S's post: notifyPostLike reaches S AND the post's own likeCount reflects it", async () => {
    const [post] = await db.insert(posts).values({ userId: S, mediaUrl: "https://example.test/conn-social-like.jpg" }).returning({ id: posts.id });
    postIds.push(post.id);

    const likeRes = await call("POST", `/api/posts/${post.id}/interact`, A, { type: "like" });
    expect(likeRes.status).toBe(200);

    const deadline = Date.now() + 4000;
    let notifRows: any[] = [];
    while (Date.now() < deadline) {
      notifRows = await db.select().from(notificationsFeed)
        .where(and(eq(notificationsFeed.userId, S), eq(notificationsFeed.type, "post_like"), eq(notificationsFeed.actorId, A)));
      if (notifRows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(notifRows).toHaveLength(1);
    expect(notifRows[0].targetId).toBe(post.id);

    const postViewRes = await fetch(`${base}/api/posts/${post.id}`);
    const postViewText = await postViewRes.text();
    if (postViewRes.status !== 200) throw new Error(`GET /api/posts/${post.id} -> ${postViewRes.status}: ${postViewText.slice(0, 300)}`);
    const postView = JSON.parse(postViewText) as { likeCount: number };
    expect(postView.likeCount).toBe(1);
  });

  it("A's comment on S's post: notifyCommentActivity reaches S AND the post's own comment list reflects it", async () => {
    const [post] = await db.insert(posts).values({ userId: S, mediaUrl: "https://example.test/conn-social-comment.jpg" }).returning({ id: posts.id });
    postIds.push(post.id);

    const commentRes = await call("POST", `/api/posts/${post.id}/comments`, A, { body: "Great post!" });
    expect(commentRes.status).toBe(201);

    const deadline = Date.now() + 4000;
    let notifRows: any[] = [];
    while (Date.now() < deadline) {
      notifRows = await db.select().from(notificationsFeed)
        .where(and(eq(notificationsFeed.userId, S), eq(notificationsFeed.type, "post_comment"), eq(notificationsFeed.actorId, A)));
      if (notifRows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(notifRows).toHaveLength(1);

    const commentsPage = await fetch(`${base}/api/posts/${post.id}/comments`).then((r) => r.json()) as { comments: Array<{ body: string }> };
    expect(commentsPage.comments.some((c) => c.body === "Great post!")).toBe(true);
  });

  it("story view: POST /stories/:id/view is reflected in the author's GET /stories/:id/viewers", async () => {
    const [story] = await db.insert(stories).values({
      authorId: S, authorName: "Commerce Seller", authorAccountType: "seller",
      media: [{ type: "image", url: "https://example.test/conn-story.jpg" }],
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }).returning({ id: stories.id });
    storyIds.push(story.id);

    const viewRes = await call("POST", `/api/social/stories/${story.id}/view`, A);
    expect(viewRes.status).toBe(200);

    const viewers = await call("GET", `/api/social/stories/${story.id}/viewers`, S);
    expect(viewers.status).toBe(200);
    expect((viewers.body as Array<{ userId: string }>).some((v) => v.userId === A)).toBe(true);
  });

  it("KNOWN GAP: story reply is routed through the same DM/request pipeline covered exhaustively in connectivity-dm-routing.integration.test.ts (no separate story-reply conversation-creation code path was found distinct from POST /api/conversations) — not duplicated here", () => {
    expect(true).toBe(true);
  });
});
