/**
 * Activity Center events: the social, saved-product and followed-brand events
 * that feed the in-app Activity Center through the shared notifications feed.
 *
 * Runs the real routes against the database. `publishNotification` is spied
 * (the real implementation still writes rows) and push delivery is stubbed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db, follows, notificationsFeed, posts, productVariants, products, savedItems, users,
} from "@workspace/db";

const spies = vi.hoisted(() => ({
  publish: vi.fn(),
  push: vi.fn(async () => undefined),
}));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = req.header("x-test-user");
    next();
  },
}));

vi.mock("../../middlewares/requireRole", () => ({
  teamContext: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../lib/planAccess", () => ({
  getVerifiedPlanAccess: async () => ({ planId: "growth", limits: { products: null } }),
  sendPlanLimitReached: vi.fn(),
  sendPlanLookupUnavailable: vi.fn(),
}));

vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return { ...actual, sendPushToUser: spies.push };
});

vi.mock("../notifications-feed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../notifications-feed")>();
  spies.publish.mockImplementation(actual.publishNotification);
  return { ...actual, publishNotification: spies.publish };
});

const suffix = crypto.randomBytes(6).toString("hex");
const ownerId = `activity-owner-${suffix}`;
const likerA = `activity-liker-a-${suffix}`;
const likerB = `activity-liker-b-${suffix}`;
const sellerId = `activity-seller-${suffix}`;
const shopperId = `activity-shopper-${suffix}`;
const userIds = [ownerId, likerA, likerB, sellerId, shopperId];
const POST_THUMB = `https://cdn.example.test/${suffix}/post-thumb.jpg`;
const PRODUCT_IMAGE = `https://cdn.example.test/${suffix}/product.jpg`;

let server: Server;
let base = "";
let postId = "";
let productId = "";
let variantId = "";
const createdProductIds: string[] = [];

async function call(method: string, path: string, userId: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function publishedOfType(type: string) {
  return spies.publish.mock.calls
    .map(([args]) => args as Record<string, unknown>)
    .filter((args) => args.type === type);
}

/** Publishers run after the response; wait for their writes to settle. */
async function settle(expectedCalls?: () => void) {
  if (expectedCalls) await vi.waitFor(expectedCalls, { timeout: 4000, interval: 25 });
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function feedRows(userId: string, type: string) {
  return db.select().from(notificationsFeed)
    .where(and(eq(notificationsFeed.userId, userId), eq(notificationsFeed.type, type)));
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: ownerId, email: `${ownerId}@test.local`, name: "Olive Owner", displayName: "Olive Owner", username: `olive_${suffix}`, accountType: "buyer", role: "buyer" },
    { clerkId: likerA, email: `${likerA}@test.local`, name: "Jay Park", displayName: "Jay Park", username: `jay_${suffix}`, accountType: "buyer", role: "buyer" },
    { clerkId: likerB, email: `${likerB}@test.local`, name: "Mina Cole", displayName: "Mina Cole", username: `mina_${suffix}`, accountType: "buyer", role: "buyer" },
    { clerkId: sellerId, email: `${sellerId}@test.local`, name: "Seller", brandName: "North Loom", accountType: "seller", role: "owner" },
    { clerkId: shopperId, email: `${shopperId}@test.local`, name: "Sam Shopper", displayName: "Sam Shopper", username: `sam_${suffix}`, accountType: "buyer", role: "buyer" },
  ]);

  const [post] = await db.insert(posts).values({
    userId: ownerId,
    mediaUrl: `https://cdn.example.test/${suffix}/video.mp4`,
    thumbnailUrl: POST_THUMB,
    mediaType: "video",
    caption: "Fit check",
    postStatus: "published",
  }).returning({ id: posts.id });
  postId = post.id;

  const [product] = await db.insert(products).values({
    ownerId: sellerId,
    name: "Heavyweight Tee",
    status: "active",
    images: [PRODUCT_IMAGE],
  }).returning({ id: products.id });
  productId = product.id;
  createdProductIds.push(productId);
  const [variant] = await db.insert(productVariants).values({
    productId,
    sku: `ACT-${suffix}`,
    size: "M",
    priceCents: 5000,
    stock: 0,
  }).returning({ id: productVariants.id });
  variantId = variant.id;

  await db.insert(savedItems).values({
    userId: shopperId,
    itemType: "product",
    targetId: productId,
    title: "Heavyweight Tee",
  });

  // Import sequentially, feed first: concurrent imports can race the async
  // mock factory and hand some routers the unspied publisher.
  const { default: notificationsRouter } = await import("../notifications-feed");
  const { default: postsRouter } = await import("../posts");
  const { default: postCommentsRouter } = await import("../post-comments");
  const { default: socialRouter } = await import("../social");
  const { default: productsRouter } = await import("../products");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
    next();
  });
  app.use("/api/posts", postCommentsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/social", socialRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/buyer/notifications", notificationsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  spies.publish.mockClear();
  spies.push.mockClear();
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, userIds));
  await db.delete(savedItems).where(inArray(savedItems.userId, userIds));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  if (postId) await db.delete(posts).where(eq(posts.id, postId));
  const sellerProducts = await db.select({ id: products.id }).from(products).where(eq(products.ownerId, sellerId));
  const ids = [...new Set([...createdProductIds, ...sellerProducts.map((row) => row.id)])];
  if (ids.length) await db.delete(products).where(inArray(products.id, ids));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("post likes", () => {
  it("publishes one post_like per distinct liker with actor and thumbnail, ignoring toggles and self-likes", async () => {
    expect((await call("POST", `/api/posts/${postId}/interact`, likerA, { type: "like" })).status).toBe(200);
    await settle(() => expect(publishedOfType("post_like")).toHaveLength(1));

    // Unlike + like again from the same person, and a self-like: no new rows.
    await call("POST", `/api/posts/${postId}/interact`, likerA, { type: "like", value: "remove" });
    await call("POST", `/api/posts/${postId}/interact`, likerA, { type: "like" });
    await call("POST", `/api/posts/${postId}/interact`, ownerId, { type: "like" });
    await call("POST", `/api/posts/${postId}/interact`, likerB, { type: "like" });
    await settle(() => expect(publishedOfType("post_like")).toHaveLength(2));

    expect(publishedOfType("post_like")[0]).toEqual(expect.objectContaining({
      userId: ownerId,
      category: "social",
      type: "post_like",
      actorId: likerA,
      actorName: "Jay Park",
      actorInitials: "JP",
      targetId: postId,
      targetType: "post",
      targetImageUrl: POST_THUMB,
    }));
    const rows = await feedRows(ownerId, "post_like");
    expect(rows.map((row) => row.actorId).sort()).toEqual([likerA, likerB].sort());
    expect(rows.every((row) => row.targetId === postId && row.targetImageUrl === POST_THUMB)).toBe(true);

    // The feed returns the aggregation input the Activity Center merges.
    const feed = await call("GET", "/api/buyer/notifications?limit=10", ownerId);
    expect(feed.status).toBe(200);
    const likes = (feed.body as any[]).filter((row) => row.type === "post_like");
    expect(likes).toHaveLength(2);
    expect(likes.every((row) => row.targetId === postId && row.targetImageUrl === POST_THUMB)).toBe(true);
  });
});

describe("comments and mentions", () => {
  it("notifies the post owner once and any @mentioned user separately", async () => {
    const response = await call("POST", `/api/posts/${postId}/comments`, likerA, {
      body: `Love this, @mina_${suffix} you need one`,
    });
    expect(response.status).toBe(201);
    await settle(() => expect(spies.publish).toHaveBeenCalledTimes(2));

    expect(publishedOfType("post_comment")).toEqual([expect.objectContaining({
      userId: ownerId, category: "social", actorId: likerA, targetId: postId, targetImageUrl: POST_THUMB,
    })]);
    expect(publishedOfType("mention")).toEqual([expect.objectContaining({
      userId: likerB, category: "social", actorId: likerA, targetId: postId, targetType: "post",
    })]);
  });
});

describe("follows", () => {
  it("offers Follow back on a one-way follow and omits it once the follow is mutual", async () => {
    expect((await call("POST", "/api/social/follow", likerA, { userId: ownerId })).status).toBe(200);
    await settle(() => expect(publishedOfType("new_follower")).toHaveLength(1));
    expect(publishedOfType("new_follower")[0]).toEqual(expect.objectContaining({
      userId: ownerId,
      category: "social",
      type: "new_follower",
      actorId: likerA,
      targetId: likerA,
      targetType: "user",
      cta: "Follow back",
    }));

    spies.publish.mockClear();
    expect((await call("POST", "/api/social/follow", ownerId, { userId: likerA })).status).toBe(200);
    await settle(() => expect(publishedOfType("new_follower")).toHaveLength(1));
    expect(publishedOfType("new_follower")[0].userId).toBe(likerA);
    expect(publishedOfType("new_follower")[0].cta).toBeUndefined();
  });
});

describe("saved products", () => {
  it("publishes back_in_stock when a saved product's variant is restocked", async () => {
    const response = await call("PATCH", `/api/products/${productId}/variants/${variantId}`, sellerId, { stock: 4 });
    expect(response.status).toBe(200);
    await settle(() => expect(publishedOfType("back_in_stock")).toHaveLength(1));
    expect(publishedOfType("back_in_stock")[0]).toEqual(expect.objectContaining({
      userId: shopperId,
      category: "social",
      type: "back_in_stock",
      targetId: productId,
      targetType: "product",
      targetImageUrl: PRODUCT_IMAGE,
      actorName: "North Loom",
    }));

    // Stock moving between positive values is not a restock.
    spies.publish.mockClear();
    await call("PATCH", `/api/products/${productId}/variants/${variantId}`, sellerId, { stock: 9 });
    await settle();
    expect(publishedOfType("back_in_stock")).toHaveLength(0);
  });

  it("publishes price_drop on a decrease only, at most once per cooldown window", async () => {
    await call("PATCH", `/api/products/${productId}/variants/${variantId}`, sellerId, { priceCents: 6000 });
    await settle();
    expect(publishedOfType("price_drop")).toHaveLength(0);

    await call("PATCH", `/api/products/${productId}/variants/${variantId}`, sellerId, { priceCents: 4000 });
    await settle(() => expect(publishedOfType("price_drop")).toHaveLength(1));
    expect(publishedOfType("price_drop")[0]).toEqual(expect.objectContaining({
      userId: shopperId,
      category: "social",
      type: "price_drop",
      body: "Now $40.00 (was $60.00).",
      targetId: productId,
      targetType: "product",
      targetImageUrl: PRODUCT_IMAGE,
    }));

    spies.publish.mockClear();
    await call("PATCH", `/api/products/${productId}/variants/${variantId}`, sellerId, { priceCents: 3500 });
    await settle();
    expect(publishedOfType("price_drop")).toHaveLength(0);
    expect(await feedRows(shopperId, "price_drop")).toHaveLength(1);
  });
});

describe("followed brands", () => {
  it("publishes new_product to followers once, even if the listing is republished", async () => {
    await db.insert(follows).values({ followerId: shopperId, followingId: sellerId });

    const created = await call("POST", "/api/products", sellerId, {
      name: "Wool Overshirt",
      status: "active",
      images: [PRODUCT_IMAGE],
    });
    expect(created.status).toBe(201);
    createdProductIds.push(created.body.id);
    await settle(() => expect(publishedOfType("new_product")).toHaveLength(1));
    expect(publishedOfType("new_product")[0]).toEqual(expect.objectContaining({
      userId: shopperId,
      category: "social",
      type: "new_product",
      actorName: "North Loom",
      targetId: created.body.id,
      targetType: "product",
      targetImageUrl: PRODUCT_IMAGE,
    }));

    await call("PUT", `/api/products/${created.body.id}`, sellerId, { status: "archived" });
    await call("PUT", `/api/products/${created.body.id}`, sellerId, { status: "active" });
    await settle(() => expect(publishedOfType("new_product")).toHaveLength(2));
    // The unique index keeps it to a single row for this follower.
    const rows = (await feedRows(shopperId, "new_product")).filter((row) => row.targetId === created.body.id);
    expect(rows).toHaveLength(1);
  });

  it("publishes new_product when a draft goes live", async () => {
    const draft = await call("POST", "/api/products", sellerId, { name: "Canvas Tote", status: "draft" });
    expect(draft.status).toBe(201);
    createdProductIds.push(draft.body.id);
    await settle();
    expect(publishedOfType("new_product")).toHaveLength(0);

    await call("PUT", `/api/products/${draft.body.id}`, sellerId, { status: "active" });
    await settle(() => expect(publishedOfType("new_product")).toHaveLength(1));
    expect(publishedOfType("new_product")[0]).toEqual(expect.objectContaining({
      userId: shopperId, targetId: draft.body.id, targetImageUrl: null,
    }));
  });
});

describe("feed paging", () => {
  it("pages with limit/offset, filters by chip, and reports the unread count", async () => {
    const all = await call("GET", "/api/buyer/notifications", ownerId);
    expect(all.status).toBe(200);
    const total = (all.body as any[]).length;
    expect(total).toBeGreaterThanOrEqual(3);

    const first = await call("GET", "/api/buyer/notifications?limit=1&offset=0", ownerId);
    const second = await call("GET", "/api/buyer/notifications?limit=1&offset=1", ownerId);
    expect(first.body).toHaveLength(1);
    expect(second.body).toHaveLength(1);
    expect(first.body[0].id).toBe(all.body[0].id);
    expect(second.body[0].id).toBe(all.body[1].id);

    const orders = await call("GET", "/api/buyer/notifications?limit=30&filter=orders", ownerId);
    expect(orders.body).toHaveLength(0);
    const social = await call("GET", "/api/buyer/notifications?limit=30&filter=social", ownerId);
    expect(social.body).toHaveLength(total);

    const unread = await call("GET", "/api/buyer/notifications/unread-count", ownerId);
    expect(unread.body).toEqual({ count: total });
    await call("PATCH", `/api/buyer/notifications/${first.body[0].id}/read`, ownerId, {});
    expect((await call("GET", "/api/buyer/notifications/unread-count", ownerId)).body).toEqual({ count: total - 1 });
  });
});
