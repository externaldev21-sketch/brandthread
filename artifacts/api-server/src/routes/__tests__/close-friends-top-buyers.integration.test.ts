/**
 * Close Friends for top buyers (sellers):
 *  - GET /api/social/close-friends/suggestions ranks the seller's paid buyers
 *    by spend, seller only, minus blocked / deleted / already-listed / guests.
 *  - PUT accepts a paid buyer who doesn't follow the seller; a non-buyer
 *    stranger is still rejected; a cancelled or unpaid order doesn't count.
 *  - A buyer added this way sees the seller's Close Friends story.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray, or } from "drizzle-orm";
import { blocks, closeFriends, db, follows, orders, stories, storyArchive, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id") || auth.userId;
    next();
  },
}));
vi.mock("../notifications-feed", () => ({ publishNotification: async () => {} }));

const suffix = crypto.randomBytes(6).toString("hex");
const id = (n: string) => `tb-${n}-${suffix}`;
const seller = id("seller");
const whale = id("whale");           // biggest spender, doesn't follow the seller
const regular = id("regular");       // smaller spender, follows the seller
const unpaid = id("unpaid");         // only an unpaid order
const cancelled = id("cancelled");   // only a cancelled order
const blockedBuyer = id("blocked");  // paid, but the seller blocked them
const gone = id("gone");             // paid, account deleted
const stranger = id("stranger");     // no orders, no follow
const otherSeller = id("other");     // another seller: whale is not their buyer
const buyerOnly = id("buyeronly");   // a buyer account
const userIds = [seller, whale, regular, unpaid, cancelled, blockedBuyer, gone, stranger, otherSeller, buyerOnly];
const handle = (u: string) => u.replace(/-/g, "_");

let server: Server;
let base = "";

async function req(path: string, userId: string, options: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", "x-test-user-id": userId, ...(options.headers ?? {}) },
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as any };
}
const get = (p: string, u: string) => req(p, u);
const send = (method: string, p: string, u: string, body?: unknown) =>
  req(p, u, { method, body: body === undefined ? undefined : JSON.stringify(body) });

let n = 0;
const order = (buyerId: string, totalCents: number, extra: Partial<typeof orders.$inferInsert> = {}) => ({
  ownerId: seller, buyerId, orderNumber: `${suffix}-${++n}`, status: "processing",
  totalCents, subtotalCents: totalCents, paidAt: new Date(), ...extra,
});

beforeAll(async () => {
  await db.insert(users).values(userIds.map((u) => ({
    clerkId: u, email: `${u}@t.local`, name: `User ${u.slice(3, 12)}`, username: handle(u),
    role: u === seller || u === otherSeller ? "seller" : "buyer",
    accountType: u === seller || u === otherSeller ? "seller" : "buyer",
    deletedAt: u === gone ? new Date() : null,
  })));
  await db.insert(follows).values([{ followerId: regular, followingId: seller }]);
  await db.insert(blocks).values({ blockerId: seller, blockedId: blockedBuyer });
  await db.insert(orders).values([
    order(whale, 90000), order(whale, 30000),
    order(regular, 5000),
    order(unpaid, 99999, { paidAt: null, status: "pending" }),
    order(cancelled, 99999, { status: "cancelled" }),
    order(blockedBuyer, 80000),
    order(gone, 70000),
    order(null as unknown as string, 50000, { guestEmail: "guest@t.local" }),
  ]);
  const [{ default: social }, { default: cfRouter }] = await Promise.all([
    import("../social"), import("../close-friends"),
  ]);
  const app = express();
  app.use(express.json());
  for (const r of [cfRouter, social]) app.use("/api/social", r);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(storyArchive).where(inArray(storyArchive.authorId, userIds));
  await db.delete(stories).where(inArray(stories.authorId, userIds));
  await db.delete(orders).where(inArray(orders.ownerId, [seller, otherSeller]));
  await db.delete(closeFriends).where(or(inArray(closeFriends.userId, userIds), inArray(closeFriends.friendId, userIds)));
  await db.delete(follows).where(or(inArray(follows.followerId, userIds), inArray(follows.followingId, userIds)));
  await db.delete(blocks).where(inArray(blocks.blockerId, userIds));
  await db.delete(users).where(inArray(users.clerkId, userIds));
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

describe("GET /close-friends/suggestions", () => {
  it("is seller only", async () => {
    const res = await get("/api/social/close-friends/suggestions", buyerOnly);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SELLER_ONLY");
  });

  it("ranks paid buyers by spend; excludes unpaid, cancelled, blocked, deleted and guests", async () => {
    const res = await get("/api/social/close-friends/suggestions", seller);
    expect(res.status).toBe(200);
    expect(res.body.suggestions.map((s: any) => s.userId)).toEqual([whale, regular]);
    expect(res.body.suggestions[0]).toMatchObject({
      userId: whale, handle: expect.any(String), name: expect.any(String),
      orderCount: 2, totalCents: 120000, followsYou: false,
    });
    expect(res.body.suggestions[1]).toMatchObject({ userId: regular, orderCount: 1, totalCents: 5000, followsYou: true });
  });

  it("honours limit", async () => {
    const res = await get("/api/social/close-friends/suggestions?limit=1", seller);
    expect(res.body.suggestions.map((s: any) => s.userId)).toEqual([whale]);
  });

  it("another seller gets only their own buyers", async () => {
    const res = await get("/api/social/close-friends/suggestions", otherSeller);
    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([]);
  });
});

describe("PUT /close-friends for a seller", () => {
  it("accepts a top buyer who doesn't follow, still rejects strangers / unpaid / cancelled / blocked", async () => {
    const res = await send("PUT", "/api/social/close-friends", seller, {
      userIds: [whale, regular, stranger, unpaid, cancelled, blockedBuyer, gone],
    });
    expect(res.status).toBe(200);
    expect(res.body.userIds.sort()).toEqual([whale, regular].sort());
    expect(res.body.rejected.sort()).toEqual([stranger, unpaid, cancelled, blockedBuyer, gone].sort());
  });

  it("listed buyers drop out of suggestions", async () => {
    const res = await get("/api/social/close-friends/suggestions", seller);
    expect(res.body.suggestions).toEqual([]);
  });

  it("the paid-order rule is per seller: another seller can't add my buyer", async () => {
    const res = await send("PUT", "/api/social/close-friends", otherSeller, { userIds: [whale] });
    expect(res.body.userIds).toEqual([]);
    expect(res.body.rejected).toEqual([whale]);
  });

  it("accepts the mobile client's { friendIds } shape and mirrors friendIds / skipped", async () => {
    const res = await send("PUT", "/api/social/close-friends", seller, { friendIds: [whale, stranger] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, friendIds: [whale], userIds: [whale], skipped: [stranger] });
    const list = await get("/api/social/close-friends", seller);
    expect(list.body.friendIds).toEqual([whale]);
  });
});

describe("a top buyer on the list sees the seller's Close Friends story", () => {
  it("closeFriendsOnly story reaches the added buyer but not other buyers", async () => {
    await send("PUT", "/api/social/close-friends", seller, { userIds: [whale] });
    const cf = await send("POST", "/api/social/stories", seller, {
      media: [{ type: "photo", imageUri: "https://img.test/cf.jpg", overlays: [] }],
      privacy: { visibility: "public", closeFriendsOnly: true },
    });
    expect(cf.status).toBe(201);
    const ids = async (u: string) => (await get(`/api/social/stories/user/${seller}`, u)).body.map((s: any) => s.id);
    expect(await ids(whale)).toContain(cf.body.id);
    expect(await ids(regular)).not.toContain(cf.body.id);
    expect(await ids(stranger)).not.toContain(cf.body.id);

    // the non-following close friend gets the CF story only, never the seller's follower-only public stories
    const pub = await send("POST", "/api/social/stories", seller, {
      media: [{ type: "photo", imageUri: "https://img.test/pub.jpg", overlays: [] }],
      privacy: { visibility: "public" },
    });
    expect(await ids(whale)).toEqual([cf.body.id]);
    expect((await ids(regular)).sort()).toEqual([pub.body.id]);

    // and the seller shows up in their stories tray with just that story
    const tray = (await get("/api/social/stories/following", whale)).body.find((e: any) => e.authorId === seller);
    expect(tray).toMatchObject({ storyIds: [cf.body.id], closeFriendsOnly: true });
    const strangerTray = (await get("/api/social/stories/following", stranger)).body;
    expect(strangerTray.find((e: any) => e.authorId === seller)).toBeUndefined();
  });

  it("removing the buyer from the list removes access", async () => {
    await send("PUT", "/api/social/close-friends", seller, { userIds: [] });
    expect((await get(`/api/social/stories/user/${seller}`, whale)).body).toEqual([]);
    const tray = (await get("/api/social/stories/following", whale)).body;
    expect(tray.find((e: any) => e.authorId === seller)).toBeUndefined();
  });
});
