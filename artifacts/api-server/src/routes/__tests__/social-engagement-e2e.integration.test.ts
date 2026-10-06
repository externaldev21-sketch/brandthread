/**
 * END-TO-END SOCIAL — post engagement, driven from BOTH sides.
 *
 * Seller S publishes; Buyer A engages through the real routers against a real
 * Postgres database; every assertion is on what the OTHER side sees:
 *   - A's like/save/repost come back on every feed surface as A's own state
 *     (likedByMe/savedByMe/repostedByMe) — previously hardcoded false, so a
 *     reload showed a liked post as unliked and A could never unlike.
 *   - S's per-post analytics reflect A's real views/likes/shares/comments,
 *     never S's own views, and product clicks + the order they lead to
 *     (last-click attribution job) — previously always 0.
 *   - "Not interested" sticks in the general feed.
 *   - Video search matches hashtags and respects blocks.
 *
 * Run: TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/brandthread_test \
 *        npx vitest run src/routes/__tests__/social-engagement-e2e.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, or } from "drizzle-orm";
import {
  db, users, posts, interactions, postComments, savedItems, notificationsFeed, follows, blocks,
  products, productVariants, orders, orderItems, postTaggedProducts, feedNotInterested,
} from "@workspace/db";

const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const S = `soc-eng-seller-${suffix}`;
const A = `soc-eng-buyer-${suffix}`;
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
vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return { ...actual, sendPushToUser: vi.fn(async () => {}) };
});

let server: Server;
let base = "";
const postIds: string[] = [];
const productIds: string[] = [];
const orderIds: string[] = [];

async function call(method: string, path: string, userId: string | null, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId) headers["x-test-user-id"] = userId;
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function newPost(values: Partial<typeof posts.$inferInsert> = {}) {
  const [post] = await db.insert(posts).values({
    userId: S, mediaUrl: `https://example.test/${crypto.randomUUID()}.jpg`, caption: "Engagement post", ...values,
  }).returning({ id: posts.id });
  postIds.push(post.id);
  return post.id;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: S, email: `${S}@example.test`, name: "Eng Seller", displayName: "Eng Seller", brandName: "Eng Seller", accountType: "seller", onboardingComplete: true },
    { clerkId: A, email: `${A}@example.test`, name: "Eng Buyer", displayName: "Eng Buyer", accountType: "buyer", onboardingComplete: true },
  ]);
  await db.insert(follows).values({ followerId: A, followingId: S });

  const [
    { default: postsRouter }, { default: postCommentsRouter }, { default: savedRouter },
    { default: publicRouter }, { default: profileMediaRouter }, { default: socialRouter },
  ] = await Promise.all([
    import("../posts"), import("../post-comments"), import("../saved"),
    import("../public"), import("../profile-media"), import("../social"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).log = { error() {}, warn() {}, info() {}, debug() {} };
    // Public routes resolve an OPTIONAL viewer; mirror Clerk's middleware.
    const header = req.header("x-test-user-id");
    if (header) (req as any).clerkUserId = header;
    next();
  });
  app.use("/api/posts", postsRouter);
  app.use("/api/posts", postCommentsRouter);
  app.use("/api/buyer/saved", savedRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/public", profileMediaRouter);
  app.use("/api/social", socialRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(orderItems).where(inArray(orderItems.orderId, orderIds.length ? orderIds : ["00000000-0000-0000-0000-000000000000"]));
  await db.delete(orders).where(inArray(orders.ownerId, ALL_IDS));
  await db.delete(postTaggedProducts).where(inArray(postTaggedProducts.postId, postIds));
  await db.delete(feedNotInterested).where(eq(feedNotInterested.userId, A));
  await db.delete(postComments).where(inArray(postComments.postId, postIds));
  await db.delete(interactions).where(inArray(interactions.userId, ALL_IDS));
  await db.delete(posts).where(inArray(posts.id, postIds));
  await db.delete(productVariants).where(inArray(productVariants.productId, productIds));
  await db.delete(products).where(inArray(products.id, productIds));
  await db.delete(savedItems).where(inArray(savedItems.userId, ALL_IDS));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ALL_IDS));
  await db.delete(blocks).where(or(inArray(blocks.blockerId, ALL_IDS), inArray(blocks.blockedId, ALL_IDS)));
  await db.delete(follows).where(or(inArray(follows.followerId, ALL_IDS), inArray(follows.followingId, ALL_IDS)));
  await db.delete(users).where(inArray(users.clerkId, ALL_IDS));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("Viewer engagement state is the server's, on every feed surface", () => {
  it("A's like/save/repost come back as A's state in Following feed, public feed, profile grid and post detail — and unlike really unlikes", async () => {
    const postId = await newPost({ mediaType: "video", mediaUrl: "https://example.test/eng.mp4" });

    expect((await call("POST", `/api/posts/${postId}/interact`, A, { type: "like", value: "add" })).status).toBe(200);
    expect((await call("POST", `/api/posts/${postId}/interact`, A, { type: "repost" })).status).toBe(200);
    expect((await call("POST", "/api/buyer/saved", A, { type: "post", targetId: postId, title: "Engagement post" })).status).toBe(201);

    const following = await call("GET", "/api/posts/feed", A);
    const fRow = (following.body as any[]).find((p) => p.id === postId);
    expect(fRow).toMatchObject({ likedByMe: true, savedByMe: true, repostedByMe: true, likesCount: 1, savesCount: 1, repostsCount: 1 });

    const pub = await call("GET", "/api/public/posts?limit=50", A);
    expect((pub.body as any[]).find((p) => p.id === postId)).toMatchObject({ likedByMe: true, savedByMe: true, repostedByMe: true });

    const grid = await call("GET", `/api/public/users/${S}/videos?limit=50`, A);
    const gridRows = Array.isArray(grid.body) ? grid.body : grid.body.videos;
    expect(gridRows.find((p: any) => p.id === postId)).toMatchObject({ likedByMe: true, savedByMe: true, repostedByMe: true });

    const detail = await call("GET", `/api/posts/${postId}`, A);
    expect(detail.body).toMatchObject({ likedByMe: true, savedByMe: true, repostedByMe: true, likeCount: 1, commentsCount: 0 });

    // The seller (another viewer) never sees A's state as their own.
    const sellerView = await call("GET", `/api/posts/${postId}`, S);
    expect(sellerView.body).toMatchObject({ likedByMe: false, savedByMe: false, repostedByMe: false, likeCount: 1 });
    // A signed-out visitor gets counts, no state.
    const anon = await call("GET", "/api/public/posts?limit=50", null);
    expect((anon.body as any[]).find((p) => p.id === postId)).toMatchObject({ likedByMe: false, likesCount: 1 });

    // Unlike after "reload": state flips back and S's count drops.
    const unlike = await call("POST", `/api/posts/${postId}/interact`, A, { type: "like", value: "remove" });
    expect(unlike.body).toMatchObject({ action: "removed", count: 0 });
    expect((await call("DELETE", `/api/buyer/saved/${postId}`, A)).status).toBeLessThan(300);
    const after = await call("GET", `/api/posts/${postId}`, A);
    expect(after.body).toMatchObject({ likedByMe: false, savedByMe: false, repostedByMe: true, likeCount: 0 });
  });
});

describe("Seller post analytics reflect the buyer's real activity", () => {
  it("views (owner excluded), likes, shares and comments from A land in S's analytics", async () => {
    const postId = await newPost();
    await call("POST", `/api/posts/${postId}/interact`, S, { type: "view" }); // owner's own view
    await call("POST", `/api/posts/${postId}/interact`, A, { type: "view" });
    await call("POST", `/api/posts/${postId}/interact`, A, { type: "like" });
    await call("POST", `/api/posts/${postId}/interact`, A, { type: "share" });
    const comment = await call("POST", `/api/posts/${postId}/comments`, A, { body: "love this fit" });
    expect(comment.status).toBeLessThan(300);

    const analytics = await call("GET", `/api/posts/${postId}/analytics`, S);
    expect(analytics.status).toBe(200);
    expect(analytics.body.metrics).toMatchObject({
      likes: 1, shares: 1, comments: 1,
      views: { tracked: true, count: 1, uniqueViewers: 1 },
    });
    // Only the owner can read them.
    expect((await call("GET", `/api/posts/${postId}/analytics`, A)).status).toBe(404);
  });

  it("a product-tag tap (shop_click) + A's paid order is attributed to the post (conversions + revenue)", async () => {
    const [product] = await db.insert(products).values({ ownerId: S, name: "Tagged tee", category: "apparel", status: "active" })
      .returning({ id: products.id });
    productIds.push(product.id);
    const [variant] = await db.insert(productVariants).values({ productId: product.id, sku: `soc-eng-${suffix}`, priceCents: 4_200, stock: 3 })
      .returning({ id: productVariants.id });
    const postId = await newPost();
    await db.insert(postTaggedProducts).values({ postId, productId: product.id, position: 0 });

    // A taps the product tag (ShopProductSheet records this) …
    expect((await call("POST", `/api/posts/${postId}/interact`, A, { type: "shop_click", value: product.id })).status).toBe(200);
    // … and buys it.
    const [order] = await db.insert(orders).values({
      ownerId: S, buyerId: A, orderNumber: `SOC-${suffix}`, status: "processing",
      totalCents: 4_200, subtotalCents: 4_200, paidAt: new Date(),
    }).returning({ id: orders.id });
    orderIds.push(order.id);
    await db.insert(orderItems).values({ orderId: order.id, variantId: variant.id, productName: "Tagged tee", quantity: 1, priceCents: 4_200 });

    const { runOrderPostAttribution } = await import("../../jobs/orderPostAttribution");
    expect(await runOrderPostAttribution()).toBeGreaterThanOrEqual(1);
    // Idempotent: a second run (or another instance) changes nothing.
    const [{ sourcePostId }] = await db.select({ sourcePostId: orders.sourcePostId }).from(orders).where(eq(orders.id, order.id));
    expect(sourcePostId).toBe(postId);
    await runOrderPostAttribution();
    const [again] = await db.select({ sourcePostId: orders.sourcePostId }).from(orders).where(eq(orders.id, order.id));
    expect(again.sourcePostId).toBe(postId);

    const analytics = await call("GET", `/api/posts/${postId}/analytics`, S);
    expect(analytics.body.metrics.productClicks).toMatchObject({ count: 1, uniqueClickers: 1 });
    expect(analytics.body.metrics.conversions).toMatchObject({ orders: 1, revenueCents: 4_200, rate: 1 });
  });

  it("an order with no prior tag tap stays unattributed", async () => {
    const [product] = await db.insert(products).values({ ownerId: S, name: "Untapped", category: "apparel", status: "active" })
      .returning({ id: products.id });
    productIds.push(product.id);
    const [variant] = await db.insert(productVariants).values({ productId: product.id, sku: `soc-eng-u-${suffix}`, priceCents: 1_000, stock: 3 })
      .returning({ id: productVariants.id });
    const [order] = await db.insert(orders).values({
      ownerId: S, buyerId: A, orderNumber: `SOC-U-${suffix}`, status: "processing", totalCents: 1_000, subtotalCents: 1_000, paidAt: new Date(),
    }).returning({ id: orders.id });
    orderIds.push(order.id);
    await db.insert(orderItems).values({ orderId: order.id, variantId: variant.id, productName: "Untapped", quantity: 1, priceCents: 1_000 });
    const { runOrderPostAttribution } = await import("../../jobs/orderPostAttribution");
    await runOrderPostAttribution();
    const [row] = await db.select({ sourcePostId: orders.sourcePostId }).from(orders).where(eq(orders.id, order.id));
    expect(row.sourcePostId).toBeNull();
  });
});

describe("Feed + search hygiene", () => {
  it("'Not interested' removes the post from A's general feed for good, not from anyone else's", async () => {
    const postId = await newPost();
    expect((await call("GET", "/api/public/posts?limit=50", A)).body.some((p: any) => p.id === postId)).toBe(true);
    expect((await call("POST", `/api/posts/${postId}/interact`, A, { type: "not_interested" })).status).toBe(200);
    expect((await call("GET", "/api/public/posts?limit=50", A)).body.some((p: any) => p.id === postId)).toBe(false);
    expect((await call("GET", "/api/public/posts?limit=50", null)).body.some((p: any) => p.id === postId)).toBe(true);
    // The creator's own grid still lists it.
    expect((await call("GET", `/api/public/posts?ownerId=${S}&limit=50`, A)).body.some((p: any) => p.id === postId)).toBe(true);
  });

  it("video search matches a post's hashtags, and hides a blocked creator", async () => {
    const tag = `zzhashtag${suffix.replace(/[^a-z0-9]/gi, "")}`;
    const postId = await newPost({ mediaType: "video", mediaUrl: "https://example.test/tag.mp4", caption: "no tag in caption", hashtags: [tag] });
    const found = await call("GET", `/api/public/search?q=${encodeURIComponent(`#${tag}`)}`, A);
    expect(found.status).toBe(200);
    expect(found.body.results.some((r: any) => r.kind === "video" && r.postId === postId)).toBe(true);

    expect((await call("POST", "/api/social/block", A, { userId: S })).status).toBeLessThan(300);
    const hidden = await call("GET", `/api/public/search?q=${encodeURIComponent(tag)}`, A);
    expect(hidden.body.results.some((r: any) => r.kind === "video" && r.postId === postId)).toBe(false);
  });
});
