/**
 * Pinned posts (Instagram "Pin to your profile"): POST/DELETE /api/posts/:id/pin
 * — owner only, published posts only, max 3 (409) — and profile grids that list
 * pinned posts first (most recently pinned first) with `pinnedAt` in the payload.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray, or } from "drizzle-orm";
import { db, follows, posts, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const uid = req.header("x-test-user-id");
    if (!uid) return res.status(401).json({ error: "Unauthorized" });
    req.clerkUserId = uid;
    next();
  },
}));
vi.mock("../../lib/safety", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/safety")>();
  return { ...real, optionalViewerId: (req: any) => req.header("x-test-user-id") || null };
});
vi.mock("../notifications-feed", () => ({ publishNotification: async () => undefined }));

const suffix = crypto.randomBytes(5).toString("hex");
const seller = `pin-seller-${suffix}`;
const buyer = `pin-buyer-${suffix}`;
const friend = `pin-friend-${suffix}`;
const userIds = [seller, buyer, friend];
const sellerPosts: string[] = [];
const buyerPosts: string[] = [];
let draftId = "";
let server: Server;
let base = "";

async function call(method: string, urlPath: string, userId?: string) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}

async function seed(userId: string, minutesAgo: number, extra: Partial<typeof posts.$inferInsert> = {}) {
  const createdAt = new Date(Date.now() - minutesAgo * 60_000);
  const [row] = await db.insert(posts).values({
    userId, mediaUrl: "https://img.test/a.jpg", mediaUrls: ["https://img.test/a.jpg"], mediaType: "photo",
    caption: "seeded", postStatus: "published", publishedAt: createdAt, createdAt, ...extra,
  }).returning();
  return row.id;
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@t.local`, name: "Pin Seller", role: "seller", accountType: "seller" },
    { clerkId: buyer, email: `${buyer}@t.local`, name: "Pin Buyer", role: "buyer", accountType: "buyer" },
    { clerkId: friend, email: `${friend}@t.local`, name: "Pin Friend", role: "buyer", accountType: "buyer" },
  ]);
  for (let i = 0; i < 5; i++) sellerPosts.push(await seed(seller, 50 - i)); // index 4 = newest
  for (let i = 0; i < 3; i++) buyerPosts.push(await seed(buyer, 50 - i));
  draftId = await seed(seller, 1, { postStatus: "draft" });
  await db.insert(follows).values([
    { followerId: buyer, followingId: friend },
    { followerId: friend, followingId: buyer },
  ]);

  const [{ default: postsRouter }, { default: profileMediaRouter }, { default: socialRouter }] = await Promise.all([
    import("../posts"), import("../profile-media"), import("../social"),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/api/posts", postsRouter);
  app.use("/api/public", profileMediaRouter);
  app.use("/api/social", socialRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  await db.delete(posts).where(inArray(posts.userId, userIds));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(users).where(inArray(users.clerkId, userIds));
});

describe("POST/DELETE /api/posts/:id/pin", () => {
  it("only the owner can pin", async () => {
    expect((await call("POST", `/api/posts/${sellerPosts[0]}/pin`)).status).toBe(401);
    expect((await call("POST", `/api/posts/${sellerPosts[0]}/pin`, buyer)).status).toBe(404);
  });

  it("refuses drafts", async () => {
    const res = await call("POST", `/api/posts/${draftId}/pin`, seller);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("POST_NOT_PINNABLE");
  });

  it("pins up to 3 (idempotent) and returns 409 with a clear message on the 4th", async () => {
    for (const id of sellerPosts.slice(0, 3)) {
      const res = await call("POST", `/api/posts/${id}/pin`, seller);
      expect(res.status).toBe(200);
      expect(res.body.pinnedAt).toBeTruthy();
      await new Promise((r) => setTimeout(r, 5));
    }
    const again = await call("POST", `/api/posts/${sellerPosts[0]}/pin`, seller);
    expect(again.status).toBe(200);
    const fourth = await call("POST", `/api/posts/${sellerPosts[3]}/pin`, seller);
    expect(fourth.status).toBe(409);
    expect(fourth.body).toMatchObject({ code: "PIN_LIMIT_REACHED", limit: 3 });
    expect(fourth.body.error).toMatch(/up to 3/);
  });

  it("lists pinned posts first, most recently pinned first, with pinnedAt", async () => {
    const res = await call("GET", `/api/public/users/${seller}/videos?limit=10`, buyer);
    expect(res.status).toBe(200);
    const ids = res.body.videos.map((v: any) => v.id);
    expect(ids.slice(0, 3)).toEqual([sellerPosts[2], sellerPosts[1], sellerPosts[0]]);
    expect(ids.slice(3)).toEqual([sellerPosts[4], sellerPosts[3]]);
    expect(res.body.videos[0].pinnedAt).toBeTruthy();
    expect(res.body.videos[3].pinnedAt).toBeNull();
  });

  it("unpinning frees a slot and restores normal order", async () => {
    const del = await call("DELETE", `/api/posts/${sellerPosts[1]}/pin`, seller);
    expect(del.status).toBe(200);
    expect(del.body.pinnedAt).toBeNull();
    expect((await call("POST", `/api/posts/${sellerPosts[3]}/pin`, seller)).status).toBe(200);
    const res = await call("GET", `/api/public/users/${seller}/videos?limit=10`, buyer);
    const ids = res.body.videos.map((v: any) => v.id);
    expect(ids).toEqual([sellerPosts[3], sellerPosts[2], sellerPosts[0], sellerPosts[4], sellerPosts[1]]);
  });

  it("orders a buyer's profile posts pinned first too", async () => {
    expect((await call("POST", `/api/posts/${buyerPosts[0]}/pin`, buyer)).status).toBe(200);
    const res = await call("GET", `/api/social/profile/${buyer}/posts`, friend);
    expect(res.status).toBe(200);
    expect(res.body.map((p: any) => p.id)).toEqual([buyerPosts[0], buyerPosts[2], buyerPosts[1]]);
    expect(res.body[0].pinnedAt).toBeTruthy();
    // The friends activity feed keeps plain recency.
    const feed = await call("GET", `/api/social/friends/activity`, friend);
    expect(feed.body.map((p: any) => p.id)).toEqual([buyerPosts[2], buyerPosts[1], buyerPosts[0]]);
  });
});
