import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray, or } from "drizzle-orm";
import { blocks, db, follows, forYouFeedCache, liveStreams, users } from "@workspace/db";

// A follow, unfollow, block or unblock must show on the very next read, on
// both sides: cached For You pages are dropped, the live list hides blocked
// hosts, and other people's follower lists hide accounts with a block.

vi.mock("../../middlewares/requireAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../middlewares/requireAuth")>()),
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
}));
vi.mock("@clerk/express", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clerk/express")>()),
  getAuth: (req: any) => ({ userId: req.header?.("x-test-user-id") ?? null }),
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => undefined }));

const suffix = crypto.randomBytes(6).toString("hex");
const viewer = `rel-sync-viewer-${suffix}`;
const seller = `rel-sync-seller-${suffix}`;
const other = `rel-sync-other-${suffix}`;
const ids = [viewer, seller, other];
const channel = `rel-sync-${suffix}`;
let server: Server;
let base = "";

const call = (method: string, path: string, as: string | null, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(as ? { "x-test-user-id": as } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function cachedForYou(userIds: string[]) {
  const rows = await db.select({ userId: forYouFeedCache.userId }).from(forYouFeedCache)
    .where(inArray(forYouFeedCache.userId, userIds));
  return rows.map((r) => r.userId).sort();
}

async function seedForYouCache() {
  await db.insert(forYouFeedCache).values(ids.map((userId) => ({ userId, results: [], itemCount: 0 })))
    .onConflictDoNothing();
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: viewer, email: `${viewer}@test.local`, name: "Viewer", role: "buyer", accountType: "buyer" },
    { clerkId: seller, email: `${seller}@test.local`, name: "Seller", role: "seller", accountType: "seller" },
    { clerkId: other, email: `${other}@test.local`, name: "Other", role: "buyer", accountType: "buyer" },
  ]);
  await db.insert(liveStreams).values({ sellerId: seller, channelName: channel, title: "Live now", status: "live" });

  const { default: socialRouter } = await import("../social");
  const { default: liveRouter } = await import("../live");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.clerkUserId = req.header("x-test-user-id"); next(); });
  app.use("/api/social", socialRouter);
  app.use("/api/live", liveRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await db.delete(blocks).where(or(inArray(blocks.blockerId, ids), inArray(blocks.blockedId, ids)));
  await db.delete(follows).where(or(inArray(follows.followerId, ids), inArray(follows.followingId, ids)));
  await db.delete(forYouFeedCache).where(inArray(forYouFeedCache.userId, ids));
});

afterAll(async () => {
  server?.close();
  await db.delete(blocks).where(or(inArray(blocks.blockerId, ids), inArray(blocks.blockedId, ids)));
  await db.delete(follows).where(or(inArray(follows.followerId, ids), inArray(follows.followingId, ids)));
  await db.delete(forYouFeedCache).where(inArray(forYouFeedCache.userId, ids));
  await db.delete(liveStreams).where(inArray(liveStreams.sellerId, ids));
  await db.delete(users).where(inArray(users.clerkId, ids));
});

describe("follow → For You re-ranks on the next load", () => {
  it("drops only the follower's cached page on follow and on unfollow", async () => {
    await seedForYouCache();
    expect((await call("POST", "/api/social/follow", viewer, { userId: seller })).status).toBe(200);
    expect(await cachedForYou(ids)).toEqual([other, seller].sort());

    await seedForYouCache();
    expect((await call("DELETE", `/api/social/follow/${seller}`, viewer)).status).toBe(200);
    expect(await cachedForYou(ids)).toEqual([other, seller].sort());
  });
});

describe("block → hidden on both sides immediately", () => {
  it("drops both people's cached For You pages on block and on unblock", async () => {
    await seedForYouCache();
    expect((await call("POST", "/api/social/block", viewer, { userId: seller })).status).toBe(200);
    expect(await cachedForYou(ids)).toEqual([other]);

    await seedForYouCache();
    expect((await call("DELETE", `/api/social/block/${seller}`, viewer)).status).toBe(200);
    expect(await cachedForYou(ids)).toEqual([other]);
  });

  it("hides a blocked host from the active lives list, in both directions", async () => {
    const hosts = async (as: string | null) => {
      const res = await call("GET", "/api/live/active", as);
      expect(res.status).toBe(200);
      const body = await res.json() as { streams: Array<{ seller_id: string }> };
      return body.streams.map((s) => s.seller_id);
    };
    expect(await hosts(viewer)).toContain(seller);

    await call("POST", "/api/social/block", seller, { userId: viewer });
    expect(await hosts(viewer)).not.toContain(seller);
    expect(await hosts(null)).toContain(seller);
    expect(await hosts(other)).toContain(seller);
  });

  it("leaves people with a block out of someone else's follower and following lists", async () => {
    await call("POST", "/api/social/follow", other, { userId: seller });
    await call("POST", "/api/social/follow", seller, { userId: other });
    const listed = async (list: "followers" | "following") => {
      const res = await call("GET", `/api/social/${list}?userId=${seller}`, viewer);
      expect(res.status).toBe(200);
      return ((await res.json()) as Array<{ userId: string }>).map((r) => r.userId);
    };
    expect(await listed("followers")).toContain(other);
    expect(await listed("following")).toContain(other);

    await call("POST", "/api/social/block", other, { userId: viewer });
    expect(await listed("followers")).not.toContain(other);
    expect(await listed("following")).not.toContain(other);
  });
});
