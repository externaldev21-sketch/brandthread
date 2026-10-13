import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  activityMutes, blocks, db, follows, notificationDeliveries, notificationEvents,
  notificationsFeed, orders, pushTokens, sellerPushBroadcasts, users,
} from "@workspace/db";
import { PAST_BUYER_RECIPIENT_CAP, resolvePastBuyerAudience } from "../../lib/sellerPushBroadcast";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
}));
vi.mock("../../middlewares/requireRole", () => ({
  requirePermission: () => (_req: any, _res: any, next: () => void) => next(),
}));
vi.mock("../../middlewares/rateLimit", () => ({
  rateLimit: () => (_req: any, _res: any, next: () => void) => next(),
}));

const sfx = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `spp-${sfx}-${name}`;
const SELLER = id("seller");
const RACE_SELLER = id("race");
const tok = (name: string) => `ExponentPushToken[spp-${sfx}-${name}]`;

// Buyers of SELLER with a live order. Only ok1/ok2 pass the opt-outs; only ok1
// opted in to promotional pushes, so only ok1 gets a device push.
const buyerNames = ["ok1", "ok2", "pushoff", "prefoff", "blockedme", "iblocked", "muted"] as const;
const otherNames = ["cancelledonly", "fan", "otherbuyer", "r1", "r2"] as const;
const allUserIds = [SELLER, RACE_SELLER, ...buyerNames.map(id), ...otherNames.map(id)];

let server: Server;
let base = "";
const pushed: string[] = [];
let n = 0;

async function call(method: string, path: string, as: string, body?: unknown) {
  const r = await fetch(`${base}/api/seller/push-broadcasts${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as any, headers: r.headers };
}

const realFetch = globalThis.fetch;
const order = (ownerId: string, buyerId: string | null, minutesAgo: number, status = "processing") => ({
  ownerId, buyerId, orderNumber: `spp-${sfx}-${++n}`, status, totalCents: 1000, subtotalCents: 1000,
  createdAt: new Date(Date.now() - minutesAgo * 60_000),
});

beforeAll(async () => {
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://exp.host/")) {
      const messages = JSON.parse(init.body) as { to: string }[];
      for (const m of messages) pushed.push(m.to);
      return new Response(JSON.stringify({ data: messages.map((_, i) => ({ status: "ok", id: `t-${i}` })) }), { status: 200 });
    }
    if (!url.startsWith("http://127.0.0.1")) throw new Error(`Unexpected network call: ${url}`);
    return realFetch(input, init);
  });

  await db.insert(users).values(allUserIds.map((clerkId) => ({
    clerkId, email: `${clerkId}@test.local`, name: clerkId, displayName: clerkId === SELLER ? "Atelier Test" : clerkId,
    username: clerkId.replace(/[^a-z0-9]/gi, "").slice(0, 28), role: "buyer",
    accountType: clerkId === SELLER || clerkId === RACE_SELLER ? "seller" : "buyer",
    promoPushOptIn: clerkId !== id("ok2"),
  })));
  await db.update(users).set({ pushEnabled: false }).where(eq(users.clerkId, id("pushoff")));
  await db.update(users).set({ notificationPreferences: { seller_announcements: false } as any }).where(eq(users.clerkId, id("prefoff")));
  await db.insert(blocks).values([
    { blockerId: id("blockedme"), blockedId: SELLER },
    { blockerId: SELLER, blockedId: id("iblocked") },
  ]);
  await db.insert(activityMutes).values({ userId: id("muted"), muteKey: `actor:${SELLER}` });

  await db.insert(orders).values([
    // ok1 is the most recent buyer, then ok2, then the rest.
    ...buyerNames.map((b, i) => order(SELLER, id(b), 10 + i * 10)),
    order(SELLER, id("ok1"), 5000), // a second order doesn't double-count
    order(SELLER, id("cancelledonly"), 5, "cancelled"),
    order(SELLER, null, 5), // guest checkout: no account to notify
    order(RACE_SELLER, id("otherbuyer"), 5),
    order(RACE_SELLER, id("r1"), 6),
    order(RACE_SELLER, id("r2"), 7),
  ].map((o) => (o.buyerId === null ? { ...o, guestEmail: `g-${sfx}@test.local` } : o)));
  // A follower who never bought: only in the follower audience.
  await db.insert(follows).values({ followerId: id("fan"), followingId: SELLER });

  await db.insert(pushTokens).values([...buyerNames, ...otherNames].map((nm) => ({ userId: id(nm), token: tok(nm), platform: "ios" })));

  const { default: router } = await import("../seller-push-broadcasts");
  const app = express();
  app.use(express.json());
  app.use("/api/seller/push-broadcasts", router);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
  const feed = await db.select({ id: notificationsFeed.id }).from(notificationsFeed).where(inArray(notificationsFeed.userId, allUserIds));
  const feedIds = feed.map((f) => f.id);
  if (feedIds.length) {
    await db.delete(notificationEvents).where(inArray(notificationEvents.notificationId, feedIds));
    await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.notificationId, feedIds));
  }
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, allUserIds));
  await db.delete(sellerPushBroadcasts).where(like(sellerPushBroadcasts.sellerId, `spp-${sfx}-%`));
  await db.delete(orders).where(like(orders.orderNumber, `spp-${sfx}-%`));
  await db.delete(activityMutes).where(inArray(activityMutes.userId, allUserIds));
  await db.delete(blocks).where(inArray(blocks.blockerId, allUserIds));
  await db.delete(follows).where(inArray(follows.followingId, allUserIds));
  await db.delete(pushTokens).where(inArray(pushTokens.userId, allUserIds));
  await db.delete(users).where(inArray(users.clerkId, allUserIds));
});

describe("seller push to past buyers", () => {
  it("reports the past-buyer audience and its own window alongside the follower push", async () => {
    const r = await call("GET", "/", SELLER);
    expect(r.status).toBe(200);
    expect(r.body.audience).toEqual({ followers: 1, recipients: 1 });
    expect(r.body.pastBuyers).toEqual({
      canSendNow: true, nextSendAt: null,
      audience: { buyers: buyerNames.length, eligible: 2, recipients: 2, cap: PAST_BUYER_RECIPIENT_CAP },
    });
    expect(PAST_BUYER_RECIPIENT_CAP).toBe(2000);
  });

  it("previews the real audience without sending", async () => {
    const r = await call("POST", "/preview", SELLER, { audience: "past_buyers", title: "Thank you", body: "10% off your next order." });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ audienceType: "past_buyers", canSendNow: true, nextSendAt: null });
    expect(r.body.audience.recipients).toBe(2);
    expect(pushed).toHaveLength(0);
    expect(await db.select().from(sellerPushBroadcasts).where(eq(sellerPushBroadcasts.sellerId, SELLER))).toHaveLength(0);
  });

  it("rejects an unknown audience", async () => {
    const r = await call("POST", "/preview", SELLER, { audience: "everyone", title: "Hi", body: "There" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_AUDIENCE");
  });

  it("sends only to opted-in past buyers; the device push also needs promotional consent", async () => {
    const r = await call("POST", "/", SELLER, { audience: "past_buyers", title: "Thank you", body: "10% off your next order." });
    expect(r.status).toBe(201);
    expect(r.body.delivery).toMatchObject({ recipients: 2, sent: 2, skipped: 5 });
    expect(r.body.broadcast).toMatchObject({ audience: "past_buyers", recipientCount: 2, status: "sent" });
    expect(new Date(r.body.nextSendAt).getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);

    const feed = await db.select({ userId: notificationsFeed.userId }).from(notificationsFeed)
      .where(and(eq(notificationsFeed.actorId, SELLER), eq(notificationsFeed.title, "Thank you")));
    expect(feed.map((f) => f.userId).sort()).toEqual([id("ok1"), id("ok2")].sort());
    // ok2 never opted in to promotional pushes: in-app only.
    expect(pushed).toEqual([tok("ok1")]);
    for (const nm of ["pushoff", "prefoff", "blockedme", "iblocked", "muted", "cancelledonly", "fan", "otherbuyer"]) {
      expect(pushed).not.toContain(tok(nm));
    }
  });

  it("enforces one past-buyer message per 7 days without blocking the follower push", async () => {
    const again = await call("POST", "/", SELLER, { audience: "past_buyers", title: "Again", body: "Too soon" });
    expect(again.status).toBe(429);
    expect(again.body).toMatchObject({ code: "BROADCAST_RATE_LIMITED", audienceType: "past_buyers" });
    expect(Number(again.headers.get("retry-after"))).toBeGreaterThan(6.9 * 86_400);

    const status = await call("GET", "/", SELLER);
    expect(status.body.pastBuyers.canSendNow).toBe(false);
    expect(status.body.canSendNow).toBe(true);

    const followers = await call("POST", "/", SELLER, { title: "For followers", body: "Drop Friday" });
    expect(followers.status).toBe(201);
    expect(followers.body.delivery.recipients).toBe(1);
    expect(followers.body.broadcast.audience).toBe("followers");
  });

  it("reopens once the last past-buyer message is older than 7 days", async () => {
    await db.update(sellerPushBroadcasts)
      .set({ createdAt: new Date(Date.now() - 7 * 86_400_000 - 5_000) })
      .where(and(eq(sellerPushBroadcasts.sellerId, SELLER), eq(sellerPushBroadcasts.audience, "past_buyers")));
    const status = await call("GET", "/", SELLER);
    expect(status.body.pastBuyers.canSendNow).toBe(true);
    expect(status.body.canSendNow).toBe(false); // the follower push sent above still holds its 24h window
  });

  it("lets exactly one of many concurrent past-buyer sends through", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      call("POST", "/", RACE_SELLER, { audience: "past_buyers", title: `Race ${i}`, body: "Concurrent send" })));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 429)).toHaveLength(9);
    expect(await db.select().from(sellerPushBroadcasts).where(eq(sellerPushBroadcasts.sellerId, RACE_SELLER))).toHaveLength(1);
    const feed = await db.select({ userId: notificationsFeed.userId }).from(notificationsFeed).where(eq(notificationsFeed.actorId, RACE_SELLER));
    expect(feed.map((f) => f.userId).sort()).toEqual([id("otherbuyer"), id("r1"), id("r2")].sort());
  });

  it("caps recipients, keeping the most recent buyers", async () => {
    const a = await resolvePastBuyerAudience(RACE_SELLER, 2);
    expect(a).toMatchObject({ buyers: 3, eligible: 3, cap: 2 });
    expect(a.recipientIds).toEqual([id("otherbuyer"), id("r1")]);
  });

  it("counts opens per broadcast, keeping a same-window follower push apart", async () => {
    const list = (await call("GET", "/", SELLER)).body.history as any[];
    const pb = list.find((h) => h.audience === "past_buyers");
    const [row] = await db.select({ id: notificationsFeed.id }).from(notificationsFeed)
      .where(and(eq(notificationsFeed.userId, id("ok1")), eq(notificationsFeed.title, "Thank you")));
    await db.insert(notificationEvents).values({
      notificationId: row!.id, userId: id("ok1"), ownerId: SELLER, eventType: "open", eventKey: `spp-${sfx}-open`,
    });
    // The past-buyer row was moved 7 days back above; move its feed rows too.
    await db.update(notificationsFeed).set({ createdAt: new Date(Date.now() - 7 * 86_400_000) as any })
      .where(and(eq(notificationsFeed.actorId, SELLER), eq(notificationsFeed.title, "Thank you")));
    const r = await call("GET", `/${pb.id}`, SELLER);
    expect(r.body).toMatchObject({ audience: "past_buyers", recipientCount: 2, opened: 1 });
    const fol = list.find((h) => h.audience === "followers");
    expect((await call("GET", `/${fol.id}`, SELLER)).body.opened).toBe(0);
  });
});
