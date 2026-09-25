/**
 * GET /api/social/followers|following?userId= — another profile's lists (the
 * follower/following screens opened from a public profile), block-aware, with
 * the viewer's own follow state per row and each row's account type (so the
 * app opens the right profile screen).
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
const seller = `fl-seller-${suffix}`;
const fanA = `fl-fan-a-${suffix}`;
const fanB = `fl-fan-b-${suffix}`;
const viewer = `fl-viewer-${suffix}`;
const blocked = `fl-blocked-${suffix}`;
const userIds = [seller, fanA, fanB, viewer, blocked];
let sellerUuid = "";
let server: Server;
let base = "";

function get(path: string, as: string) {
  return fetch(`${base}${path}`, { headers: { "x-test-user-id": as } });
}

beforeAll(async () => {
  const rows = await db.insert(users).values([
    { clerkId: seller, email: `${seller}@test.local`, name: "FL Seller", displayName: "FL Seller", role: "seller", accountType: "seller" },
    { clerkId: fanA, email: `${fanA}@test.local`, name: "Fan A", displayName: "Fan A", role: "buyer", accountType: "buyer" },
    { clerkId: fanB, email: `${fanB}@test.local`, name: "Fan B", displayName: "Fan B", role: "buyer", accountType: "buyer" },
    { clerkId: viewer, email: `${viewer}@test.local`, name: "Viewer", displayName: "Viewer", role: "buyer", accountType: "buyer" },
    { clerkId: blocked, email: `${blocked}@test.local`, name: "Blocked", displayName: "Blocked", role: "buyer", accountType: "buyer" },
  ]).returning({ id: users.id, clerkId: users.clerkId });
  sellerUuid = rows.find((row) => row.clerkId === seller)!.id;

  await db.insert(follows).values([
    { followerId: fanA, followingId: seller },
    { followerId: fanB, followingId: seller },
    { followerId: seller, followingId: fanA },
    { followerId: viewer, followingId: fanA },
  ]);
  await db.insert(blocks).values({ blockerId: seller, blockedId: blocked });

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

describe("another profile's follower / following lists", () => {
  it("lists the profile's followers (not the viewer's) with account type and the viewer's follow state", async () => {
    const response = await get(`/api/social/followers?userId=${seller}`, viewer);
    expect(response.status).toBe(200);
    const rows = await response.json() as any[];
    const byId = new Map(rows.map((row) => [row.userId, row]));
    expect([...byId.keys()].sort()).toEqual([fanA, fanB].sort());
    expect(byId.get(fanA)).toMatchObject({ accountType: "buyer", isFollowing: true });
    expect(byId.get(fanB)).toMatchObject({ accountType: "buyer", isFollowing: false });
  });

  it("resolves the users.id alias and serves the following list too", async () => {
    const rows = await get(`/api/social/following?userId=${sellerUuid}`, viewer).then((r) => r.json() as Promise<any[]>);
    expect(rows.map((row) => row.userId)).toEqual([fanA]);
    expect(rows[0].isFollowing).toBe(true);
  });

  it("still returns the viewer's own list without userId", async () => {
    const rows = await get(`/api/social/following`, fanA).then((r) => r.json() as Promise<any[]>);
    expect(rows.map((row) => row.userId)).toEqual([seller]);
    expect(rows[0]).toMatchObject({ accountType: "seller", isFollowing: true });
  });

  it("hides a profile's lists from someone it blocked", async () => {
    expect((await get(`/api/social/followers?userId=${seller}`, blocked)).status).toBe(404);
  });
});
