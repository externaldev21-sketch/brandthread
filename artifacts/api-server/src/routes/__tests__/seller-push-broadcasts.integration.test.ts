import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray, like } from "drizzle-orm";
import {
  activityMutes, blocks, db, follows, notificationDeliveries, notificationEvents,
  notificationsFeed, products, pushTokens, sellerPushBroadcasts, users,
} from "@workspace/db";

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
const id = (name: string) => `spb-${sfx}-${name}`;
const SELLER = id("seller");
const OTHER_SELLER = id("other");
const tok = (name: string) => `ExponentPushToken[spb-${sfx}-${name}]`;

const followerNames = ["ok1", "ok2", "pushoff", "prefoff", "blockedme", "iblocked", "quiet", "muted"] as const;
const allUserIds = [SELLER, OTHER_SELLER, ...followerNames.map(id), id("stranger")];

let server: Server;
let base = "";
const pushed: string[] = [];

async function call(method: string, path: string, as: string, body?: unknown) {
  const r = await fetch(`${base}/api/seller/push-broadcasts${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user-id": as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as any, headers: r.headers };
}

const realFetch = globalThis.fetch;

beforeAll(async () => {
  // Never hit the network: Expo's endpoint is answered locally, everything else is the loopback test server.
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
    username: clerkId.replace(/[^a-z0-9]/gi, "").slice(0, 28), role: "buyer", accountType: clerkId === SELLER || clerkId === OTHER_SELLER ? "seller" : "buyer",
  })));
  await db.update(users).set({ pushEnabled: false }).where(eq(users.clerkId, id("pushoff")));
  await db.update(users).set({ notificationPreferences: { seller_announcements: false } as any }).where(eq(users.clerkId, id("prefoff")));
  await db.update(users).set({ quietHoursStart: "00:00", quietHoursEnd: "23:59", quietHoursTimezone: "UTC" }).where(eq(users.clerkId, id("quiet")));

  await db.insert(follows).values(followerNames.map((n) => ({ followerId: id(n), followingId: SELLER })));
  await db.insert(blocks).values([
    { blockerId: id("blockedme"), blockedId: SELLER },
    { blockerId: SELLER, blockedId: id("iblocked") },
  ]);
  await db.insert(activityMutes).values({ userId: id("muted"), muteKey: `actor:${SELLER}` });
  await db.insert(pushTokens).values([...followerNames.map((n) => ({ userId: id(n), token: tok(n), platform: "ios" })),
    { userId: id("stranger"), token: tok("stranger"), platform: "ios" }]);

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
  await db.delete(sellerPushBroadcasts).where(like(sellerPushBroadcasts.sellerId, `spb-${sfx}-%`));
  await db.delete(products).where(like(products.ownerId, `spb-${sfx}-%`));
  await db.delete(activityMutes).where(inArray(activityMutes.userId, allUserIds));
  await db.delete(blocks).where(inArray(blocks.blockerId, allUserIds));
  await db.delete(follows).where(inArray(follows.followingId, allUserIds));
  await db.delete(pushTokens).where(inArray(pushTokens.userId, allUserIds));
  await db.delete(users).where(inArray(users.clerkId, allUserIds));
});

describe("seller follower push broadcasts", () => {
  it("previews the audience without sending or consuming the daily slot", async () => {
    const r = await call("POST", "/preview", SELLER, { title: "Drop Friday", body: "Doors open at 6pm." });
    expect(r.status).toBe(200);
    expect(r.body.audience).toEqual({ followers: followerNames.length, recipients: 3 });
    expect(r.body.canSendNow).toBe(true);
    expect(pushed).toHaveLength(0);
    const rows = await db.select().from(sellerPushBroadcasts).where(eq(sellerPushBroadcasts.sellerId, SELLER));
    expect(rows).toHaveLength(0);
  });

  it("rejects text that fails moderation without consuming the slot", async () => {
    const bad = await call("POST", "/", SELLER, { title: "Hey", body: "you are a f*cking idiot, kill yourself" });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe("CONTENT_REJECTED");
    expect((await call("GET", "/", SELLER)).body.canSendNow).toBe(true);
  });

  it("refuses a deep link to someone else's product", async () => {
    const [p] = await db.insert(products).values({ ownerId: OTHER_SELLER, name: "Not yours" }).returning({ id: products.id });
    const r = await call("POST", "/", SELLER, { title: "Look", body: "New thing", deeplinkType: "product", deeplinkId: p!.id });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("INVALID_LINK");
  });

  it("sends to eligible followers only: muted, disabled, blocked and quiet-hours followers get no push", async () => {
    const [mine] = await db.insert(products).values({ ownerId: SELLER, name: "My hoodie" }).returning({ id: products.id });
    const r = await call("POST", "/", SELLER, { title: "Drop Friday", body: "Doors open at 6pm.", deeplinkType: "product", deeplinkId: mine!.id });
    expect(r.status).toBe(201);
    expect(r.body.delivery).toMatchObject({ recipients: 3, sent: 3, skipped: 5 });
    expect(r.body.broadcast).toMatchObject({ recipientCount: 3, sentCount: 3, skippedCount: 5, status: "sent" });

    const feed = await db.select({ userId: notificationsFeed.userId, targetType: notificationsFeed.targetType, targetId: notificationsFeed.targetId })
      .from(notificationsFeed).where(eq(notificationsFeed.actorId, SELLER));
    expect(feed.map((f) => f.userId).sort()).toEqual([id("ok1"), id("ok2"), id("quiet")].sort());
    expect(feed.every((f) => f.targetType === "product" && f.targetId === mine!.id)).toBe(true);

    // Only the two followers outside quiet hours get a device push.
    expect(pushed.sort()).toEqual([tok("ok1"), tok("ok2")].sort());
    for (const skipped of ["pushoff", "prefoff", "blockedme", "iblocked", "muted", "quiet"]) {
      expect(pushed).not.toContain(tok(skipped));
    }
    expect(pushed).not.toContain(tok("stranger"));
  });

  it("enforces one broadcast per rolling 24h and reports when the next is allowed", async () => {
    const r = await call("POST", "/", SELLER, { title: "Again", body: "Too soon" });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("BROADCAST_RATE_LIMITED");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(86_000);
    const status = await call("GET", "/", SELLER);
    expect(status.body.canSendNow).toBe(false);
    expect(new Date(status.body.nextSendAt).getTime()).toBeGreaterThan(Date.now() + 23.9 * 3600_000);
    expect(status.body.history).toHaveLength(1);
  });

  it("reopens once the last broadcast is older than 24h", async () => {
    await db.update(sellerPushBroadcasts)
      .set({ createdAt: new Date(Date.now() - 24 * 3600_000 - 5_000) })
      .where(eq(sellerPushBroadcasts.sellerId, SELLER));
    expect((await call("GET", "/", SELLER)).body.canSendNow).toBe(true);
    const r = await call("POST", "/", SELLER, { title: "Next day", body: "A fresh announcement" });
    expect(r.status).toBe(201);
  });

  it("lets exactly one of many concurrent requests through", async () => {
    const before = pushed.length;
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      call("POST", "/", OTHER_SELLER, { title: `Race ${i}`, body: "Concurrent send" })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 429)).toHaveLength(9);
    const rows = await db.select().from(sellerPushBroadcasts).where(eq(sellerPushBroadcasts.sellerId, OTHER_SELLER));
    expect(rows).toHaveLength(1);
    expect(pushed.length).toBe(before); // OTHER_SELLER has no followers: nothing delivered twice
  });

  it("isolates history and results between sellers", async () => {
    const mineList = await call("GET", "/", SELLER);
    const otherList = await call("GET", "/", OTHER_SELLER);
    expect(mineList.body.history.every((h: any) => h.title !== undefined)).toBe(true);
    expect(otherList.body.history).toHaveLength(1);
    const mineId = mineList.body.history[0].id;
    expect((await call("GET", `/${mineId}`, OTHER_SELLER)).status).toBe(404);
    expect((await call("GET", `/${mineId}`, SELLER)).status).toBe(200);
  });

  it("reports opens from the notification_events pipeline", async () => {
    const latest = (await call("GET", "/", SELLER)).body.history[0];
    const [fb] = await db.select({ id: notificationsFeed.id }).from(notificationsFeed)
      .where(eq(notificationsFeed.userId, id("ok1")));
    await db.insert(notificationEvents).values({
      notificationId: fb!.id, userId: id("ok1"), ownerId: SELLER, eventType: "open", eventKey: `spb-${sfx}-open`,
    });
    const r = await call("GET", `/${latest.id}`, SELLER);
    expect(r.body.opened).toBeGreaterThanOrEqual(1);
    expect(r.body.recipientCount).toBe(3);
  });
});
