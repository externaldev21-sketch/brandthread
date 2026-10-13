/**
 * Items 100-103: device timezone on token registration, quiet hours in the
 * recipient's local time, rich (image) pushes, the seller "Ship now"
 * category and the exact app-icon badge on every published push.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, notificationDeliveries, notificationsFeed, pushTokens, users } from "@workspace/db";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = req.header("x-test-user-id");
    next();
  },
}));

const sfx = crypto.randomBytes(5).toString("hex");
const id = (name: string) => `prb-${sfx}-${name}`;
const SELLER = id("seller");
const LA_BUYER = id("la");
const allUserIds = [SELLER, LA_BUYER];
const tok = (name: string) => `ExponentPushToken[prb-${sfx}-${name}]`;
const IMAGE = "https://cdn.example.com/products/hoodie.jpg";

type SentMessage = Record<string, any>;
const sent: SentMessage[] = [];
let server: Server;
let base = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("https://exp.host/")) {
      const messages = JSON.parse(init.body) as SentMessage[];
      sent.push(...messages);
      return new Response(JSON.stringify({ data: messages.map((_, i) => ({ status: "ok", id: `t-${i}` })) }), { status: 200 });
    }
    if (!url.startsWith("http://127.0.0.1")) throw new Error(`Unexpected network call: ${url}`);
    return realFetch(input, init);
  });

  await db.insert(users).values(allUserIds.map((clerkId) => ({
    clerkId,
    email: `${clerkId}@test.local`,
    name: clerkId,
    username: clerkId.replace(/[^a-z0-9]/gi, "").slice(0, 28),
    role: "buyer",
    accountType: clerkId === SELLER ? "seller" : "buyer",
  })));
  await db.insert(pushTokens).values([
    { userId: SELLER, token: tok("seller"), platform: "ios" },
    { userId: LA_BUYER, token: tok("la"), platform: "ios" },
  ]);

  const { default: pushRouter } = await import("../push");
  const app = express();
  app.use(express.json());
  app.use("/api/push", pushRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  vi.useRealTimers();
  sent.length = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.userId, allUserIds));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.userId, allUserIds));
  await db.delete(pushTokens).where(inArray(pushTokens.userId, allUserIds));
  await db.delete(users).where(inArray(users.clerkId, allUserIds));
});

async function register(as: string, body: unknown) {
  const r = await fetch(`${base}/api/push/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user-id": as },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() as any };
}

describe("POST /api/push/register timezone", () => {
  it("stores a valid device timezone for quiet hours", async () => {
    const r = await register(LA_BUYER, { token: tok("la"), platform: "expo", timezone: "America/Los_Angeles" });
    expect(r.status).toBe(200);
    const [row] = await db.select({ tz: users.quietHoursTimezone }).from(users).where(eq(users.clerkId, LA_BUYER));
    expect(row?.tz).toBe("America/Los_Angeles");
  });

  it("rejects an unknown timezone and leaves the stored one alone", async () => {
    const r = await register(LA_BUYER, { token: tok("la"), timezone: "Mars/Olympus" });
    expect(r.status).toBe(400);
    const [row] = await db.select({ tz: users.quietHoursTimezone }).from(users).where(eq(users.clerkId, LA_BUYER));
    expect(row?.tz).toBe("America/Los_Angeles");
  });

  it("still registers without a timezone (older app builds)", async () => {
    const r = await register(LA_BUYER, { token: tok("la"), platform: "expo" });
    expect(r.status).toBe(200);
  });
});

describe("quiet hours 23:00-08:00 in America/Los_Angeles", () => {
  it("suppresses a push at 23:30 local and sends one at 08:05 local", async () => {
    await db.update(users).set({ quietHoursStart: "23:00", quietHoursEnd: "08:00", quietHoursTimezone: "America/Los_Angeles" })
      .where(eq(users.clerkId, LA_BUYER));
    const { sendPushToUser } = await import("../../lib/push");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-16T07:30:00Z")); // 23:30 PST
    expect(await sendPushToUser(LA_BUYER, { title: "Shipped", body: "On its way" }, "order")).toBe(false);
    expect(sent).toHaveLength(0);

    vi.setSystemTime(new Date("2026-01-16T16:05:00Z")); // 08:05 PST
    expect(await sendPushToUser(LA_BUYER, { title: "Shipped", body: "On its way" }, "order")).toBe(true);
    expect(sent.map((m) => m.to)).toEqual([tok("la")]);

    await db.update(users).set({ quietHoursStart: null, quietHoursEnd: null }).where(eq(users.clerkId, LA_BUYER));
  });
});

describe("publishNotification push payload", () => {
  it("carries the exact unread badge, the product image and the Ship now category", async () => {
    // Two existing unread rows, one read row and one muted row.
    await db.insert(notificationsFeed).values([
      { userId: SELLER, category: "orders", type: "seed_unread", title: "a", body: "" },
      { userId: SELLER, category: "orders", type: "seed_unread", title: "b", body: "" },
      { userId: SELLER, category: "orders", type: "seed_read", title: "c", body: "", isRead: true },
      { userId: SELLER, category: "orders", type: "seed_muted", title: "d", body: "", isMuted: true },
    ]);
    const { publishNotification, countUnreadFeedNotifications } = await import("../notifications-feed");
    expect(await countUnreadFeedNotifications(SELLER)).toBe(2);

    await publishNotification({
      userId: SELLER,
      category: "orders",
      type: "new_order_received",
      title: "New order!",
      body: "Order #1042 for $48.00 is ready to review.",
      targetId: crypto.randomUUID(),
      targetType: "order",
      targetImageUrl: IMAGE,
      pushSound: "order_received.wav",
      pushChannelId: "orders",
      pushCategoryId: "new_order",
    });

    expect(sent).toHaveLength(1);
    const message = sent[0]!;
    expect(message).toMatchObject({
      to: tok("seller"),
      title: "New order!",
      badge: 3,
      sound: "order_received.wav",
      channelId: "orders",
      categoryId: "new_order",
      richContent: { image: IMAGE },
      mutableContent: true,
    });
    expect(message.data).toMatchObject({ type: "new_order_received", targetType: "order", imageUrl: IMAGE });
    expect(await countUnreadFeedNotifications(SELLER)).toBe(3);
  });

  it("never forwards a non-https thumbnail", async () => {
    const { publishNotification } = await import("../notifications-feed");
    await publishNotification({
      userId: SELLER,
      category: "orders",
      type: "new_order_received",
      title: "New order!",
      targetId: crypto.randomUUID(),
      targetType: "order",
      targetImageUrl: "http://cdn.example.com/insecure.jpg",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.richContent).toBeUndefined();
    expect(sent[0]!.mutableContent).toBeUndefined();
    expect(sent[0]!.badge).toBe(4);
  });
});
