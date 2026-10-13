/**
 * Follower/following list search (?q=), the "Follows you" flag on someone
 * else's lists, the profile header's "Followed by …" mutual followers, and the
 * bio link on GET /api/social/profile/:userId.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray, or } from "drizzle-orm";
import { blocks, db, follows, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
}));

vi.mock("../notifications-feed", () => ({
  publishNotification: async () => undefined,
}));

const suffix = crypto.randomBytes(6).toString("hex");
const target = `mf-target-${suffix}`;
const viewer = `mf-viewer-${suffix}`;
const maya = `mf-maya-${suffix}`;
const leo = `mf-leo-${suffix}`;
const ana = `mf-ana-${suffix}`;
const zed = `mf-zed-${suffix}`;
const blockedByViewer = `mf-bv-${suffix}`;
const blockedByTarget = `mf-bt-${suffix}`;
const stranger = `mf-stranger-${suffix}`;
const userIds = [target, viewer, maya, leo, ana, zed, blockedByViewer, blockedByTarget, stranger];
let server: Server;
let base = "";

function get(path: string, as: string) {
  return fetch(`${base}${path}`, { headers: { "x-test-user-id": as } });
}

function buyer(clerkId: string, name: string, username: string, extra: Record<string, unknown> = {}) {
  return { clerkId, email: `${clerkId}@test.local`, name, displayName: name, username: `${username}_${suffix}`, role: "buyer", accountType: "buyer", ...extra } as any;
}

beforeAll(async () => {
  await db.insert(users).values([
    buyer(target, "Target Person", "target", { website: "https://target.example.com/shop" }),
    buyer(viewer, "Viewer", "viewer"),
    buyer(maya, "Maya Lane", "maya"),
    buyer(leo, "Leo Park", "leo"),
    buyer(ana, "Ana Ruiz", "ana"),
    buyer(zed, "Zed 100%", "zed"),
    buyer(blockedByViewer, "Blocked V", "bv"),
    buyer(blockedByTarget, "Blocked T", "bt"),
    buyer(stranger, "Stranger", "stranger"),
  ]);
  const t = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s));
  await db.insert(follows).values([
    // Viewer follows maya, leo, ana, zed, both blocked people.
    { followerId: viewer, followingId: maya },
    { followerId: viewer, followingId: leo },
    { followerId: viewer, followingId: ana },
    { followerId: viewer, followingId: zed },
    { followerId: viewer, followingId: blockedByViewer },
    { followerId: viewer, followingId: blockedByTarget },
    // All of them (plus a stranger the viewer doesn't follow) follow target.
    { followerId: maya, followingId: target, createdAt: t(1) },
    { followerId: leo, followingId: target, createdAt: t(4) },
    { followerId: ana, followingId: target, createdAt: t(3) },
    { followerId: zed, followingId: target, createdAt: t(2) },
    { followerId: blockedByViewer, followingId: target, createdAt: t(5) },
    { followerId: blockedByTarget, followingId: target, createdAt: t(6) },
    { followerId: stranger, followingId: target, createdAt: t(7) },
    // Leo and Zed follow the viewer back; target follows maya and leo.
    { followerId: leo, followingId: viewer },
    { followerId: zed, followingId: viewer },
    { followerId: target, followingId: maya },
    { followerId: target, followingId: leo },
  ]);
  await db.insert(blocks).values([
    { blockerId: viewer, blockedId: blockedByViewer },
    { blockerId: target, blockedId: blockedByTarget },
  ]);

  const { default: socialRouter } = await import("../social");
  const app = express();
  app.use(express.json());
  app.use("/api/social", socialRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("follower / following list search", () => {
  it("filters someone else's followers by username, display name or name (case-insensitive)", async () => {
    const byName = await get(`/api/social/followers?userId=${target}&q=MAYA`, viewer).then((r) => r.json() as Promise<any[]>);
    expect(byName.map((r) => r.userId)).toEqual([maya]);
    const byUsername = await get(`/api/social/followers?userId=${target}&q=leo_${suffix}`, viewer).then((r) => r.json() as Promise<any[]>);
    expect(byUsername.map((r) => r.userId)).toEqual([leo]);
  });

  it("treats % and _ literally", async () => {
    const pct = await get(`/api/social/followers?userId=${target}&q=${encodeURIComponent("100%")}`, viewer).then((r) => r.json() as Promise<any[]>);
    expect(pct.map((r) => r.userId)).toEqual([zed]);
    const none = await get(`/api/social/followers?userId=${target}&q=${encodeURIComponent("%")}`, viewer).then((r) => r.json() as Promise<any[]>);
    expect(none.map((r) => r.userId)).toEqual([zed]);
  });

  it("works with pagination and on the following list", async () => {
    const page1 = await get(`/api/social/following?q=${suffix}&limit=2&offset=0`, viewer).then((r) => r.json() as Promise<any[]>);
    const page2 = await get(`/api/social/following?q=${suffix}&limit=2&offset=2`, viewer).then((r) => r.json() as Promise<any[]>);
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(new Set([...page1, ...page2].map((r) => r.userId)).size).toBe(4);
    const ana1 = await get(`/api/social/following?q=ruiz`, viewer).then((r) => r.json() as Promise<any[]>);
    expect(ana1.map((r) => r.userId)).toEqual([ana]);
  });

  it("returns the full list when q is blank", async () => {
    const rows = await get(`/api/social/followers?userId=${target}&q=%20`, viewer).then((r) => r.json() as Promise<any[]>);
    expect(rows).toHaveLength(6); // Blocked users stay excluded even for a blank search.
  });
});

describe("followsMe on any owner's list", () => {
  it("flags people on someone else's followers list who follow the viewer", async () => {
    const rows = await get(`/api/social/followers?userId=${target}`, viewer).then((r) => r.json() as Promise<any[]>);
    const byId = new Map(rows.map((r) => [r.userId, r]));
    expect(byId.get(leo).followsMe).toBe(true);
    expect(byId.get(zed).followsMe).toBe(true);
    expect(byId.get(maya).followsMe).toBe(false);
  });

  it("flags people on someone else's following list who follow the viewer", async () => {
    const rows = await get(`/api/social/following?userId=${target}`, viewer).then((r) => r.json() as Promise<any[]>);
    const byId = new Map(rows.map((r) => [r.userId, r]));
    expect(byId.get(leo)).toMatchObject({ followsMe: true, isFollowing: true });
    expect(byId.get(maya)).toMatchObject({ followsMe: false, isFollowing: true });
  });
});

describe("profile mutual followers + website", () => {
  it("counts people the viewer follows who follow the profile, excluding blocked relations", async () => {
    const profile = await get(`/api/social/profile/${target}`, viewer).then((r) => r.json() as Promise<any>);
    expect(profile.mutualFollowers.count).toBe(4);
    // Most recent follow of the target first, max 3.
    expect(profile.mutualFollowers.users.map((u: any) => u.userId)).toEqual([leo, ana, zed]);
    expect(profile.mutualFollowers.users[0]).toMatchObject({ username: `leo_${suffix}`, displayName: "Leo Park" });
    const ids = profile.mutualFollowers.users.map((u: any) => u.userId);
    expect(ids).not.toContain(blockedByViewer);
    expect(ids).not.toContain(blockedByTarget);
  });

  it("is zero for a viewer who follows none of them, and absent on your own profile", async () => {
    const other = await get(`/api/social/profile/${target}`, stranger).then((r) => r.json() as Promise<any>);
    expect(other.mutualFollowers).toEqual({ users: [], count: 0 });
    const own = await get(`/api/social/profile/${target}`, target).then((r) => r.json() as Promise<any>);
    expect(own.mutualFollowers).toBeUndefined();
  });

  it("returns the bio website on the profile endpoint", async () => {
    const profile = await get(`/api/social/profile/${target}`, viewer).then((r) => r.json() as Promise<any>);
    expect(profile.website).toBe("https://target.example.com/shop");
    const noSite = await get(`/api/social/profile/${maya}`, viewer).then((r) => r.json() as Promise<any>);
    expect(noSite.website).toBeNull();
  });
});
