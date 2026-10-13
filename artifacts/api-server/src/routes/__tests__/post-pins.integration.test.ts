/**
 * Pin to your profile: POST/DELETE /api/posts/:id/pin, GET /api/posts/pins/mine,
 * and pinned-first ordering + `pinnedAt` on the profile grids
 * (GET /api/public/users/:id/videos, GET /api/social/profile/:id/posts, GET /api/posts/mine).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray, or } from "drizzle-orm";
import { db, follows, posts, postPins, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    if (!req.clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
    next();
  },
}));
vi.mock("../../lib/safety", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/safety")>();
  return { ...actual, optionalViewerId: (req: any) => req.clerkUserId ?? null };
});

const suffix = crypto.randomBytes(6).toString("hex");
const seller = `pin-seller-${suffix}`;
const buyer = `pin-buyer-${suffix}`;
const friend = `pin-friend-${suffix}`;
const userIds = [seller, buyer, friend];

let server: Server;
let base = "";
const sellerPosts: string[] = []; // oldest first
let draftId = "";
let archivedId = "";
const buyerPosts: string[] = [];

async function call(method: string, path: string, userId: string | null, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(userId ? { "x-test-user-id": userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}
const pin = (id: string, as: string | null, body?: unknown) => call("POST", `/api/posts/${id}/pin`, as, body ?? {});
const unpin = (id: string, as: string | null) => call("DELETE", `/api/posts/${id}/pin`, as);
const gridIds = async (userId: string, viewer: string | null) =>
  (await call("GET", `/api/public/users/${userId}/videos`, viewer)).body.videos.map((v: any) => v.id);

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: seller, email: `${seller}@t.local`, name: "Pin Seller", brandName: "Pin Seller", role: "seller", accountType: "seller", username: `pinseller${suffix}` },
    { clerkId: buyer, email: `${buyer}@t.local`, name: "Pin Buyer", role: "buyer", accountType: "buyer", username: `pinbuyer${suffix}` },
    { clerkId: friend, email: `${friend}@t.local`, name: "Pin Friend", role: "buyer", accountType: "buyer", username: `pinfriend${suffix}` },
  ]);
  await db.insert(follows).values([{ followerId: buyer, followingId: friend }, { followerId: friend, followingId: buyer }]);
  const t0 = Date.now() - 10 * 3_600_000;
  const base_ = { mediaUrl: "https://cdn.test/a.jpg", mediaUrls: ["https://cdn.test/a.jpg"], mediaType: "photo", surface: "thread" };
  for (let i = 0; i < 5; i += 1) {
    const at = new Date(t0 + i * 3_600_000);
    const [row] = await db.insert(posts).values({ ...base_, userId: seller, postStatus: "published", publishedAt: at, createdAt: at } as any).returning();
    sellerPosts.push(row.id);
  }
  const [draft] = await db.insert(posts).values({ ...base_, userId: seller, postStatus: "draft" } as any).returning();
  draftId = draft.id;
  const [archived] = await db.insert(posts).values({ ...base_, userId: seller, postStatus: "archived" } as any).returning();
  archivedId = archived.id;
  for (let i = 0; i < 3; i += 1) {
    const at = new Date(t0 + i * 3_600_000);
    const [row] = await db.insert(posts).values({ ...base_, surface: "profile", userId: buyer, postStatus: "published", publishedAt: at, createdAt: at } as any).returning();
    buyerPosts.push(row.id);
  }

  const [{ default: pinsRouter }, { default: profileMediaRouter }, { default: socialRouter }, { default: postsRouter }] = await Promise.all([
    import("../post-pins"), import("../profile-media"), import("../social"), import("../posts"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    const viewer = req.header("x-test-user-id");
    if (viewer) req.clerkUserId = viewer;
    next();
  });
  app.use("/api/posts", pinsRouter);
  app.use("/api/posts", postsRouter);
  app.use("/api/public", profileMediaRouter);
  app.use("/api/social", socialRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(posts).where(inArray(posts.id, [...sellerPosts, ...buyerPosts, draftId, archivedId]));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("pinning", () => {
  it("only the owner, only published posts, only signed in", async () => {
    expect((await pin(sellerPosts[0], null)).status).toBe(401);
    const other = await pin(sellerPosts[0], buyer);
    expect(other.status).toBe(403);
    expect(other.body.code).toBe("NOT_POST_OWNER");
    const draft = await pin(draftId, seller);
    expect(draft.status).toBe(400);
    expect(draft.body.code).toBe("POST_NOT_PUBLISHED");
    expect((await pin(archivedId, seller)).body.code).toBe("POST_NOT_PUBLISHED");
    expect((await pin("nope", seller)).status).toBe(404);
    expect((await pin(crypto.randomUUID(), seller)).status).toBe(404);
    expect((await unpin(sellerPosts[0], buyer)).status).toBe(403);
  });

  it("pins up to 3, idempotently, newest pin first", async () => {
    const a = await pin(sellerPosts[0], seller);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ pinned: true, replaced: null, pins: [sellerPosts[0]] });
    expect(typeof a.body.pinnedAt).toBe("string");
    expect((await pin(sellerPosts[0], seller)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 5));
    await pin(sellerPosts[1], seller);
    await new Promise((r) => setTimeout(r, 5));
    const c = await pin(sellerPosts[2], seller);
    expect(c.body.pins).toEqual([sellerPosts[2], sellerPosts[1], sellerPosts[0]]);
    const mine = await call("GET", "/api/posts/pins/mine", seller);
    expect(mine.body.max).toBe(3);
    expect(mine.body.pins.map((p: any) => p.postId)).toEqual([sellerPosts[2], sellerPosts[1], sellerPosts[0]]);
  });

  it("blocks a 4th pin until the owner agrees to replace the oldest", async () => {
    const blocked = await pin(sellerPosts[3], seller);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: "PIN_LIMIT", max: 3, pinned: [sellerPosts[0], sellerPosts[1], sellerPosts[2]] });
    const replaced = await pin(sellerPosts[3], seller, { replaceOldest: true });
    expect(replaced.status).toBe(201);
    expect(replaced.body.replaced).toBe(sellerPosts[0]);
    expect(replaced.body.pins).toEqual([sellerPosts[3], sellerPosts[2], sellerPosts[1]]);
    const rows = await db.select().from(postPins).where(eq(postPins.userId, seller));
    expect(rows).toHaveLength(3);
  });

  it("concurrent pins never exceed the cap", async () => {
    await unpin(sellerPosts[1], seller);
    const results = await Promise.all([pin(sellerPosts[0], seller), pin(sellerPosts[4], seller)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await db.select().from(postPins).where(eq(postPins.userId, seller))).toHaveLength(3);
    // restore a known state: pins = 3 (newest), 2, and whichever won
    const winner = results[0].status === 201 ? sellerPosts[0] : sellerPosts[4];
    await unpin(winner, seller);
    await pin(sellerPosts[1], seller);
  });
});

describe("profile grids list pinned posts first", () => {
  it("public profile videos: pinned (newest pin first) then newest posts, with pinnedAt", async () => {
    // pins now: [1 (newest pin), 3, 2]
    const res = await call("GET", `/api/public/users/${seller}/videos`, null);
    expect(res.status).toBe(200);
    expect(res.body.videos.map((v: any) => v.id)).toEqual([sellerPosts[1], sellerPosts[3], sellerPosts[2], sellerPosts[4], sellerPosts[0]]);
    expect(res.body.videos.slice(0, 3).every((v: any) => typeof v.pinnedAt === "string")).toBe(true);
    expect(res.body.videos.slice(3).every((v: any) => v.pinnedAt === null)).toBe(true);
    expect(await gridIds(seller, seller)).toEqual([sellerPosts[1], sellerPosts[3], sellerPosts[2], sellerPosts[4], sellerPosts[0]]);
  });

  it("paginates across the pinned block without duplicates", async () => {
    const p1 = await call("GET", `/api/public/users/${seller}/videos?limit=2&offset=0`, null);
    const p2 = await call("GET", `/api/public/users/${seller}/videos?limit=2&offset=2`, null);
    const p3 = await call("GET", `/api/public/users/${seller}/videos?limit=2&offset=4`, null);
    expect([...p1.body.videos, ...p2.body.videos, ...p3.body.videos].map((v: any) => v.id))
      .toEqual([sellerPosts[1], sellerPosts[3], sellerPosts[2], sellerPosts[4], sellerPosts[0]]);
  });

  it("own posts list (/api/posts/mine) puts pins first and returns pinnedAt", async () => {
    const res = await call("GET", "/api/posts/mine", seller);
    expect(res.status).toBe(200);
    const ids = res.body.map((p: any) => p.id);
    expect(ids.slice(0, 3)).toEqual([sellerPosts[1], sellerPosts[3], sellerPosts[2]]);
    expect(res.body.find((p: any) => p.id === sellerPosts[0]).pinnedAt).toBeNull();
    expect(typeof res.body[0].pinnedAt).toBe("string");
  });

  it("unpinning drops the post back into date order; archiving a pinned post retires the pin", async () => {
    await unpin(sellerPosts[3], seller);
    expect(await gridIds(seller, null)).toEqual([sellerPosts[1], sellerPosts[2], sellerPosts[4], sellerPosts[3], sellerPosts[0]]);
    await db.update(posts).set({ postStatus: "archived" }).where(eq(posts.id, sellerPosts[2]));
    expect(await gridIds(seller, seller)).toEqual([sellerPosts[1], sellerPosts[4], sellerPosts[3], sellerPosts[0]]);
    const mine = await call("GET", "/api/posts/pins/mine", seller);
    expect(mine.body.pins.map((p: any) => p.postId)).toEqual([sellerPosts[1]]);
    const archivedRow = (await call("GET", "/api/posts/mine", seller)).body.find((p: any) => p.id === sellerPosts[2]);
    expect(archivedRow.pinnedAt).toBeNull();
    await db.update(posts).set({ postStatus: "published" }).where(eq(posts.id, sellerPosts[2]));
  });

  it("buyer profile posts (/api/social/profile/:id/posts) for the owner and friends", async () => {
    expect((await pin(buyerPosts[0], buyer)).status).toBe(201);
    const own = await call("GET", `/api/social/profile/${buyer}/posts`, buyer);
    expect(own.body.map((p: any) => p.id)).toEqual([buyerPosts[0], buyerPosts[2], buyerPosts[1]]);
    expect(typeof own.body[0].pinnedAt).toBe("string");
    expect(own.body[1].pinnedAt).toBeNull();
    const asFriend = await call("GET", `/api/social/profile/${buyer}/posts`, friend);
    expect(asFriend.body.map((p: any) => p.id)).toEqual([buyerPosts[0], buyerPosts[2], buyerPosts[1]]);
  });

  it("deleting a post removes its pin", async () => {
    await db.delete(posts).where(eq(posts.id, buyerPosts[0]));
    expect(await db.select().from(postPins).where(eq(postPins.postId, buyerPosts[0]))).toHaveLength(0);
  });
});
