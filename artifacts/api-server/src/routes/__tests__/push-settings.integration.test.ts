/**
 * Instagram-style notification settings + multi-account push, against the
 * real Postgres (migration 281) and the real routes / push chokepoint. Expo's
 * push API is replaced by a stubbed fetch that records what would be sent.
 *
 *  - "Pause all" for a chosen duration stops pushes (the Activity row is still written)
 *  - per-type Off / From profiles I follow / From everyone
 *  - the same device token registered for two signed-in accounts keeps both,
 *    labels each push with its account, and carries accountId for tap-to-switch
 *  - registration prunes accounts no longer signed in on the device
 *  - new reviews and missed calls produce pushes
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { db, users, pushTokens, follows, notificationsFeed, notificationDeliveries } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: () => void) => {
    const actingAs = req.headers["x-test-acting-as"];
    if (!actingAs) { res.status(401).json({ error: "Unauthorized" }); return; }
    req.clerkUserId = actingAs;
    next();
  },
  requirePlan: () => (_req: any, _res: any, next: () => void) => next(),
}));

const A = `pst-a-${process.pid}`;
const B = `pst-b-${process.pid}`;
const FAN = `pst-fan-${process.pid}`;
const STRANGER = `pst-stranger-${process.pid}`;
const ALL = [A, B, FAN, STRANGER];
const DEVICE = `ExponentPushToken[pst-${process.pid}]`;
const DEVICE2 = `ExponentPushToken[pst2-${process.pid}]`;

let server: Server;
let baseUrl = "";
const sent: any[] = [];
const realFetch = globalThis.fetch;

function as(userId: string, path: string, init: RequestInit = {}) {
  return realFetch(`${baseUrl}${path}`, { ...init, headers: { ...init.headers, "x-test-acting-as": userId, "Content-Type": "application/json" } });
}

async function cleanup() {
  await db.delete(pushTokens).where(inArray(pushTokens.userId, ALL));
  await db.delete(pushTokens).where(inArray(pushTokens.token, [DEVICE, DEVICE2]));
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, ALL));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, ALL));
  await db.delete(follows).where(inArray(follows.followerId, ALL));
  await db.delete(users).where(inArray(users.clerkId, ALL));
}

describe("push settings + multi-account push", () => {
  let sendPushToUser: typeof import("../../lib/push").sendPushToUser;

  beforeAll(async () => {
    vi.stubGlobal("fetch", async (url: any, init?: any) => {
      if (String(url).startsWith("https://exp.host/")) {
        const body = JSON.parse(String(init?.body ?? "[]"));
        sent.push(...body);
        return new Response(JSON.stringify({ data: body.map(() => ({ status: "ok", id: `t-${Math.random()}` })) }), { status: 200 });
      }
      return realFetch(url, init);
    });
    ({ sendPushToUser } = await import("../../lib/push"));
    const { default: prefsRouter } = await import("../notification-prefs");
    const { default: pushRouter } = await import("../push");
    const app = express();
    app.use(express.json());
    app.use("/api/notification-prefs", prefsRouter);
    app.use("/api/push", pushRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    sent.length = 0;
    await cleanup();
    await db.insert(users).values([
      { clerkId: A, email: `${A}@example.test`, name: "Ana", displayName: "Ana", username: `ana${process.pid}`, accountType: "buyer", onboardingComplete: true },
      { clerkId: B, email: `${B}@example.test`, name: "Bo Shop", displayName: "Bo Shop", username: `boshop${process.pid}`, accountType: "seller", onboardingComplete: true },
      { clerkId: FAN, email: `${FAN}@example.test`, name: "Fan", displayName: "Fan", accountType: "buyer", onboardingComplete: true },
      { clerkId: STRANGER, email: `${STRANGER}@example.test`, name: "Stranger", displayName: "Stranger", accountType: "buyer", onboardingComplete: true },
    ]);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await cleanup();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it("returns the Instagram-style settings for the account type", async () => {
    const buyer = await (await as(A, "/api/notification-prefs")).json() as any;
    expect(buyer.pausedUntil).toBeNull();
    expect(buyer.pushTypes).toMatchObject({ likes: "everyone", comments: "everyone", shipped: "everyone", delivered: "everyone" });
    expect(buyer.pushTypes.new_orders).toBeUndefined();
    const seller = await (await as(B, "/api/notification-prefs")).json() as any;
    expect(seller.pushTypes).toMatchObject({ new_orders: "everyone", payouts: "everyone", reviews: "everyone", manufacturer_messages: "everyone" });
    expect(seller.pushTypes.shipped).toBeUndefined();
  });

  it("validates and stores per-type values and the pause", async () => {
    expect((await as(A, "/api/notification-prefs", { method: "PUT", body: JSON.stringify({ pushTypes: { likes: "maybe" } }) })).status).toBe(400);
    expect((await as(A, "/api/notification-prefs", { method: "PUT", body: JSON.stringify({ pushTypes: { new_followers: "following" } }) })).status).toBe(400);
    expect((await as(A, "/api/notification-prefs", { method: "PUT", body: JSON.stringify({ pushTypes: { payouts: "off" } }) })).status).toBe(400); // seller-only
    expect((await as(A, "/api/notification-prefs", { method: "PUT", body: JSON.stringify({ pause: { minutes: 7 } }) })).status).toBe(400);

    const saved = await (await as(A, "/api/notification-prefs", { method: "PUT", body: JSON.stringify({ pushTypes: { likes: "following", messages: "off" }, pause: { minutes: 60 } }) })).json() as any;
    expect(saved.pushTypes).toMatchObject({ likes: "following", messages: "off" });
    const until = new Date(saved.pausedUntil).getTime();
    expect(until).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect(until).toBeLessThan(Date.now() + 61 * 60_000);
    // Booleans stay booleans in `categories` (pushType:* values aren't leaked there).
    expect(Object.values(saved.categories).every((v) => typeof v === "boolean")).toBe(true);

    const resumed = await (await as(A, "/api/notification-prefs", { method: "PUT", body: JSON.stringify({ pause: null }) })).json() as any;
    expect(resumed.pausedUntil).toBeNull();
  });

  it("turning a type on clears the old coarse switch that would still block it", async () => {
    await as(A, "/api/notification-prefs", { method: "PUT", body: JSON.stringify({ categories: { order_updates: false } }) });
    await as(A, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE, platform: "ios" }) });
    expect(await sendPushToUser(A, { title: "s", body: "", data: { type: "order_shipped" } }, "order")).toBe(false);
    const saved = await (await as(A, "/api/notification-prefs", { method: "PUT", body: JSON.stringify({ pushTypes: { shipped: "everyone" } }) })).json() as any;
    expect(saved.categories.order_updates).toBe(true);
    expect(await sendPushToUser(A, { title: "s", body: "", data: { type: "order_shipped" } }, "order")).toBe(true);
  });

  it("Pause all stops pushes until it ends", async () => {
    await as(A, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE, platform: "ios" }) });
    await as(A, "/api/notification-prefs", { method: "PUT", body: JSON.stringify({ pause: { minutes: 15 } }) });
    expect(await sendPushToUser(A, { title: "Hi", body: "x", data: { type: "new_follower" } }, "social")).toBe(false);
    expect(sent).toHaveLength(0);
    await db.update(users).set({ pushPausedUntil: new Date(Date.now() - 1000) }).where(eq(users.clerkId, A));
    expect(await sendPushToUser(A, { title: "Hi", body: "x", data: { type: "new_follower" } }, "social")).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("Off and From profiles I follow filter by notification type", async () => {
    await as(A, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE, platform: "ios" }) });
    await as(A, "/api/notification-prefs", { method: "PUT", body: JSON.stringify({ pushTypes: { comments: "off", likes: "following" } }) });
    await db.insert(follows).values({ followerId: A, followingId: FAN });

    expect(await sendPushToUser(A, { title: "c", body: "", data: { type: "post_comment", actorId: FAN } }, "social")).toBe(false);
    expect(await sendPushToUser(A, { title: "like from stranger", body: "", data: { type: "post_like", actorId: STRANGER } }, "social")).toBe(false);
    expect(await sendPushToUser(A, { title: "like from fan", body: "", data: { type: "post_like", actorId: FAN } }, "social")).toBe(true);
    // Types without a setting are unaffected.
    expect(await sendPushToUser(A, { title: "follow", body: "", data: { type: "new_follower", actorId: STRANGER } }, "social")).toBe(true);
    expect(sent.map((m) => m.title)).toEqual(["like from fan", "follow"]);
  });

  it("one device signed in to two accounts gets both accounts' pushes, labelled, with accountId", async () => {
    await as(A, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE, platform: "ios", accountIds: [A, B] }) });
    await as(B, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE, platform: "ios", accountIds: [A, B] }) });
    const rows = await db.select({ userId: pushTokens.userId }).from(pushTokens).where(eq(pushTokens.token, DEVICE));
    expect(rows.map((r) => r.userId).sort()).toEqual([A, B].sort());

    await sendPushToUser(B, { title: "New order", body: "#1001", data: { type: "new_order_received" } }, "order");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: DEVICE, title: "New order", subtitle: `@boshop${process.pid}` });
    expect(sent[0].data.accountId).toBe(B);
  });

  it("labels Android pushes in the title (no subtitle there) and leaves single-account devices alone", async () => {
    await as(A, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE2, platform: "android", accountIds: [A, B] }) });
    await as(B, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE2, platform: "android", accountIds: [A, B] }) });
    await sendPushToUser(A, { title: "Shipped", body: "", data: { type: "order_shipped" } }, "order");
    expect(sent[0].title).toBe(`@ana${process.pid} · Shipped`);
    expect(sent[0].subtitle).toBeUndefined();

    sent.length = 0;
    await as(A, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE2, platform: "android", accountIds: [A] }) });
    await sendPushToUser(A, { title: "Shipped", body: "", data: { type: "order_shipped" } }, "order");
    expect(sent[0].title).toBe("Shipped");
    expect(sent[0].data.accountId).toBe(A);
  });

  it("registration prunes accounts that are no longer signed in on the device", async () => {
    await as(A, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE, platform: "ios", accountIds: [A, B] }) });
    await as(B, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE, platform: "ios", accountIds: [A, B] }) });
    // B signed out on this device; A re-registers listing only itself.
    await as(A, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE, platform: "ios", accountIds: [A] }) });
    const rows = await db.select({ userId: pushTokens.userId }).from(pushTokens).where(eq(pushTokens.token, DEVICE));
    expect(rows.map((r) => r.userId)).toEqual([A]);
    // An older build (no accountIds) hands the device over, as before.
    await as(B, "/api/push/register", { method: "POST", body: JSON.stringify({ token: DEVICE, platform: "ios" }) });
    const after = await db.select({ userId: pushTokens.userId }).from(pushTokens).where(eq(pushTokens.token, DEVICE));
    expect(after.map((r) => r.userId)).toEqual([B]);
  });
});
