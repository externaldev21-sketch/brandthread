/**
 * END-TO-END SOCIAL — follow consistency, driven from BOTH sides.
 *
 * Buyer A follows/unfollows Seller S through the real social router against
 * a real Postgres database; every assertion is on what the other side sees:
 *   - follow works with either id form (Clerk id or users.id alias), same as
 *     GET /status and /profile already did — POST used to 404 on the alias;
 *   - both responses carry the exact counts for BOTH sides (S's followers,
 *     A's following), so no screen has to guess with ±1;
 *   - unfollow removes S's "started following you" Activity row even after
 *     S has read it (QA-0037: count and Activity disagreed);
 *   - S's profile counts S's real posts (was always 0 for sellers);
 *   - batch follow status for a page of accounts in one request.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, users, follows, posts, notificationsFeed } from "@workspace/db";

const suffix = `${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const S = `soc-fol-seller-${suffix}`;
const S2 = `soc-fol-seller2-${suffix}`;
const A = `soc-fol-buyer-${suffix}`;
const ALL = [S, S2, A];

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const header = req.header("x-test-user-id");
    if (!header) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = header;
    next();
  },
}));
vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return { ...actual, sendPushToUser: vi.fn(async () => {}) };
});

let server: Server;
let base = "";
let sellerUuid = "";

async function call(method: string, path: string, userId: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json", "x-test-user-id": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function followerRows(target: string, actor: string) {
  return db.select().from(notificationsFeed).where(and(
    eq(notificationsFeed.userId, target), eq(notificationsFeed.type, "new_follower"), eq(notificationsFeed.actorId, actor),
  ));
}

beforeAll(async () => {
  const inserted = await db.insert(users).values([
    { clerkId: S, email: `${S}@example.test`, name: "Follow Seller", displayName: "Follow Seller", brandName: "Follow Seller", accountType: "seller", onboardingComplete: true },
    { clerkId: S2, email: `${S2}@example.test`, name: "Other Seller", displayName: "Other Seller", accountType: "seller", onboardingComplete: true },
    { clerkId: A, email: `${A}@example.test`, name: "Follow Buyer", displayName: "Follow Buyer", accountType: "buyer", onboardingComplete: true },
  ]).returning({ id: users.id, clerkId: users.clerkId });
  sellerUuid = inserted.find((u) => u.clerkId === S)!.id;
  await db.insert(posts).values([
    { userId: S, mediaUrl: "https://example.test/f1.jpg" },
    { userId: S, mediaUrl: "https://example.test/f2.jpg" },
    { userId: S, mediaUrl: "https://example.test/f3.jpg", postStatus: "draft" },
  ] as any);

  const { default: socialRouter } = await import("../social");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error() {}, warn() {}, info() {} }; next(); });
  app.use("/api/social", socialRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ALL));
  await db.delete(follows).where(or(inArray(follows.followerId, ALL), inArray(follows.followingId, ALL)));
  await db.delete(posts).where(inArray(posts.userId, ALL));
  await db.delete(users).where(inArray(users.clerkId, ALL));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("Follow: both sides stay in sync", () => {
  it("following by the users.id alias works and returns exact counts for both sides", async () => {
    const res = await call("POST", "/api/social/follow", A, { userId: sellerUuid });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isFollowing: true, followersCount: 1, followingCount: 1 });

    // The edge is stored against the canonical Clerk id — S sees A.
    const status = await call("GET", `/api/social/status/${A}`, S);
    expect(status.body).toMatchObject({ isFollowedBy: true });
    await expect.poll(async () => (await followerRows(S, A)).length).toBe(1);

    const sellerProfile = await call("GET", `/api/social/profile/${S}`, A);
    expect(sellerProfile.body).toMatchObject({ followersCount: 1, isFollowing: true, postsCount: 2 });
    const buyerProfile = await call("GET", `/api/social/profile/${A}`, A);
    expect(buyerProfile.body.followingCount).toBe(1);
  });

  it("a repeated follow is a no-op with the same exact counts (no client can drift to 2)", async () => {
    const again = await call("POST", "/api/social/follow", A, { userId: S });
    expect(again.body).toMatchObject({ followersCount: 1, followingCount: 1 });
  });

  it("batch status answers for a page of accounts in one request, keyed by the id sent", async () => {
    const res = await call("GET", `/api/social/status?ids=${S},${sellerUuid},${S2},nobody-${suffix}`, A);
    expect(res.status).toBe(200);
    expect(res.body[S]).toMatchObject({ isFollowing: true });
    expect(res.body[sellerUuid]).toMatchObject({ isFollowing: true });
    expect(res.body[S2]).toMatchObject({ isFollowing: false, isFollowedBy: false });
    expect(res.body[`nobody-${suffix}`]).toMatchObject({ isFollowing: false });
  });

  it("unfollow (by alias) removes S's follower Activity row even after S has READ it, and counts drop on both sides", async () => {
    await db.update(notificationsFeed).set({ isRead: true }).where(and(eq(notificationsFeed.userId, S), eq(notificationsFeed.actorId, A)));
    const res = await call("DELETE", `/api/social/follow/${sellerUuid}`, A);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isFollowing: false, followersCount: 0, followingCount: 0 });
    expect(await followerRows(S, A)).toHaveLength(0);
    const sellerProfile = await call("GET", `/api/social/profile/${S}`, A);
    expect(sellerProfile.body).toMatchObject({ followersCount: 0, isFollowing: false });
  });
});
