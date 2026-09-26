/**
 * GET /api/public/users/:userId/videos, GET /api/public/products/:id/feed-videos,
 * and the profile-facing extensions of the public catalog
 * (/products?ownerId=<users.id alias>, /sellers/:id productsCount/videosCount).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray, or } from "drizzle-orm";
import {
  blocks, db, follows, interactions, postTaggedProducts, posts, products, productVariants, users,
} from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!req.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    next();
  },
}));

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `pm-seller-${suffix}`;
const buyer = `pm-buyer-${suffix}`;
const friend = `pm-friend-${suffix}`;
const stranger = `pm-stranger-${suffix}`;
const blocker = `pm-blocker-${suffix}`;
const userIds = [seller, buyer, friend, stranger, blocker];

let server: Server;
let base = "";
let sellerUuid = "";
let productId = "";
const postIds: Record<string, string> = {};

function get(path: string, viewer?: string) {
  return fetch(`${base}${path}`, { headers: viewer ? { "x-test-user-id": viewer } : {} });
}

async function insertPost(key: string, values: Partial<typeof posts.$inferInsert> & { userId: string }) {
  const [row] = await db.insert(posts).values({
    mediaUrl: `https://cdn.example.com/${key}.mp4`,
    thumbnailUrl: `https://cdn.example.com/${key}.jpg`,
    mediaType: "video",
    caption: `Caption ${key}`,
    ...values,
  }).returning({ id: posts.id });
  postIds[key] = row.id;
  return row.id;
}

beforeAll(async () => {
  const inserted = await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.local`, name: "PM Seller", displayName: "PM Seller", brandName: "Thread Atelier", username: `pmseller${suffix}`, role: "seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@test.local`, name: "PM Buyer", displayName: "PM Buyer", role: "buyer", accountType: "buyer" },
    { clerkId: friend, email: `${friend}@test.local`, name: "PM Friend", displayName: "PM Friend", role: "buyer", accountType: "buyer" },
    { clerkId: stranger, email: `${stranger}@test.local`, name: "PM Stranger", displayName: "PM Stranger", role: "buyer", accountType: "buyer" },
    { clerkId: blocker, email: `${blocker}@test.local`, name: "PM Blocker", displayName: "PM Blocker", role: "buyer", accountType: "buyer" },
  ]).returning({ id: users.id, clerkId: users.clerkId });
  sellerUuid = inserted.find((row) => row.clerkId === seller)!.id;

  const [product] = await db.insert(products).values({
    ownerId: seller, name: "Stitched Overshirt", category: "apparel", status: "active",
  }).returning({ id: products.id });
  productId = product.id;
  await db.insert(productVariants).values([
    { productId, sku: `pm-${suffix}-m`, priceCents: 2_500, stock: 4 },
    { productId, sku: `pm-${suffix}-l`, priceCents: 2_900, stock: 1 },
  ]);

  const older = new Date(Date.now() - 60_000);
  await insertPost("public", { userId: seller, createdAt: older });
  await insertPost("private", { userId: seller, visibility: { isPublic: false, allowComments: true, allowReposts: true, showLikeCount: true } });
  await insertPost("draft", { userId: seller, postStatus: "draft" });
  await insertPost("future", { userId: seller, postStatus: "scheduled", scheduledAt: new Date(Date.now() + 86_400_000) });
  await insertPost("buyerPhoto", { userId: buyer, mediaType: "photo", mediaUrl: "https://cdn.example.com/b.jpg" });

  await db.insert(postTaggedProducts).values({ postId: postIds.public, productId, position: 0 });
  await db.insert(interactions).values([
    { userId: stranger, postId: postIds.public, type: "view" },
    { userId: friend, postId: postIds.public, type: "view" },
    { userId: friend, postId: postIds.public, type: "like" },
  ]);

  // buyer ↔ friend are mutual follows (friends); stranger follows buyer one-way.
  await db.insert(follows).values([
    { followerId: buyer, followingId: friend },
    { followerId: friend, followingId: buyer },
    { followerId: stranger, followingId: buyer },
  ]);
  await db.insert(blocks).values({ blockerId: blocker, blockedId: seller });

  const { default: publicRouter } = await import("../public");
  const { default: profileMediaRouter } = await import("../profile-media");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const viewer = req.header("x-test-user-id");
    if (viewer) req.clerkUserId = viewer;
    next();
  });
  app.use("/api/public", publicRouter);
  app.use("/api/public", profileMediaRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(posts).where(inArray(posts.id, Object.values(postIds)));
  await db.delete(products).where(inArray(products.id, [productId]));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/public/users/:userId/videos", () => {
  it("returns a seller's public published videos in the Thread feed row shape with view counts", async () => {
    const response = await get(`/api/public/users/${seller}/videos`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.user).toMatchObject({ userId: seller, accountType: "seller", displayName: "Thread Atelier" });
    expect(body.restricted).toBeNull();
    expect(body.total).toBe(1);
    expect(body.videos.map((video: any) => video.id)).toEqual([postIds.public]);
    const [video] = body.videos;
    expect(video).toMatchObject({
      userId: seller,
      mediaType: "video",
      authorAccountType: "seller",
      viewsCount: 2,
      likesCount: 1,
      seller: { brandName: "Thread Atelier" },
    });
    // Tagged product carries its live lowest variant price for the shop pill.
    expect(video.taggedProducts).toEqual([
      expect.objectContaining({ productId, name: "Stitched Overshirt", priceCents: 2_500 }),
    ]);
  });

  it("lets the owner see their own non-public published posts, never drafts or future schedules", async () => {
    const body = await get(`/api/public/users/${seller}/videos`, seller).then((r) => r.json() as Promise<any>);
    const ids = body.videos.map((video: any) => video.id);
    expect(ids).toEqual(expect.arrayContaining([postIds.public, postIds.private]));
    expect(ids).not.toContain(postIds.draft);
    expect(ids).not.toContain(postIds.future);
    expect(body.total).toBe(2);
  });

  it("accepts the users.id UUID alias and paginates with hasMore", async () => {
    const page = await get(`/api/public/users/${sellerUuid}/videos?limit=1`, seller).then((r) => r.json() as Promise<any>);
    expect(page.videos).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    const next = await get(`/api/public/users/${sellerUuid}/videos?limit=1&offset=1`, seller).then((r) => r.json() as Promise<any>);
    expect(next.videos).toHaveLength(1);
    expect(next.hasMore).toBe(false);
    expect(next.videos[0].id).not.toBe(page.videos[0].id);
  });

  it("hides the profile from a viewer blocked in either direction", async () => {
    expect((await get(`/api/public/users/${seller}/videos`, blocker)).status).toBe(404);
  });

  it("keeps buyer posts friends-only: non-friends get a restricted empty page", async () => {
    const anonymous = await get(`/api/public/users/${buyer}/videos`).then((r) => r.json() as Promise<any>);
    expect(anonymous).toMatchObject({ restricted: "friends_only", videos: [], total: 0 });
    const oneWay = await get(`/api/public/users/${buyer}/videos`, stranger).then((r) => r.json() as Promise<any>);
    expect(oneWay.restricted).toBe("friends_only");

    const mutual = await get(`/api/public/users/${buyer}/videos`, friend).then((r) => r.json() as Promise<any>);
    expect(mutual.restricted).toBeNull();
    expect(mutual.videos.map((video: any) => video.id)).toEqual([postIds.buyerPhoto]);
    expect(mutual.videos[0].authorAccountType).toBe("buyer");

    const self = await get(`/api/public/users/${buyer}/videos`, buyer).then((r) => r.json() as Promise<any>);
    expect(self.videos.map((video: any) => video.id)).toEqual([postIds.buyerPhoto]);
  });

  it("rejects oversized pages and unknown profiles", async () => {
    expect((await get(`/api/public/users/${seller}/videos?limit=51`)).status).toBe(400);
    expect((await get(`/api/public/users/pm-nobody-${suffix}/videos`)).status).toBe(404);
  });
});

describe("GET /api/public/products/:productId/feed-videos", () => {
  it("returns the public videos that tag the product", async () => {
    const response = await get(`/api/public/products/${productId}/feed-videos`);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.total).toBe(1);
    expect(body.videos.map((video: any) => video.id)).toEqual([postIds.public]);
  });

  it("404s a malformed product id", async () => {
    expect((await get(`/api/public/products/not-a-uuid/feed-videos`)).status).toBe(404);
  });
});

describe("seller shop source for profiles", () => {
  it("lists a seller's active products with variants by the users.id alias (same source as product detail)", async () => {
    const rows = await get(`/api/public/products?ownerId=${sellerUuid}`).then((r) => r.json() as Promise<any[]>);
    expect(rows.map((row) => row.id)).toEqual([productId]);
    expect(rows[0].variants.map((variant: any) => variant.priceCents).sort()).toEqual([2_500, 2_900]);
    const byClerk = await get(`/api/public/products?ownerId=${seller}`).then((r) => r.json() as Promise<any[]>);
    expect(byClerk.map((row) => row.id)).toEqual([productId]);
  });

  it("reports true product and video counts on the public seller profile", async () => {
    const body = await get(`/api/public/sellers/${seller}`).then((r) => r.json() as Promise<any>);
    expect(body.profile.productsCount).toBe(1);
    expect(body.profile.videosCount).toBe(1);
  });
});

// Thread Cash is owner-only: a public profile response must never carry a
// wallet balance, whoever is asking (balances are only served by the
// self-scoped, authenticated /api/thread-cash). Guard every public profile read.
describe("public profile responses never leak a Thread Cash / wallet balance", () => {
  const LEAK = /balance|threadcash|thread_cash|wallet/i;
  function keysDeep(value: unknown, out: string[] = []): string[] {
    if (Array.isArray(value)) value.forEach((item) => keysDeep(item, out));
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) { out.push(key); keysDeep(child, out); }
    }
    return out;
  }

  it.each([
    ["seller profile", () => `/api/public/sellers/${seller}`],
    ["profile by username", () => `/api/public/profiles/pmseller${suffix}`],
    ["seller videos", () => `/api/public/users/${seller}/videos`],
    ["buyer videos", () => `/api/public/users/${buyer}/videos`],
  ])("%s has no balance fields for anonymous, a stranger, or the owner", async (_label, path) => {
    for (const viewer of [undefined, stranger, seller, buyer]) {
      const response = await get(path(), viewer);
      expect(response.status).toBeLessThan(500);
      const keys = keysDeep(await response.json());
      expect(keys.filter((key) => LEAK.test(key))).toEqual([]);
    }
  });
});
