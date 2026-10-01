import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { db, notificationsFeed, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));
const pushes = vi.hoisted(() => ({ calls: [] as Array<{ userId: string; category?: string }> }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.clerkUserId = auth.userId;
    next();
  },
}));

vi.mock("../../lib/push", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/push")>();
  return {
    ...actual,
    sendPushToUser: async (userId: string, _payload: unknown, category?: string) => {
      pushes.calls.push({ userId, category });
      return true;
    },
  };
});

const suffix = crypto.randomBytes(8).toString("hex");
const buyerId = `notif-channels-buyer-${suffix}`;
let server: Server;
let base = "";

async function putPrefs(body: unknown) {
  return fetch(`${base}/api/notification-prefs`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await db.insert(users).values({
    clerkId: buyerId,
    email: `${buyerId}@test.local`,
    name: "Channel Buyer",
    role: "buyer",
    accountType: "buyer",
  });
  auth.userId = buyerId;
  const { default: prefsRouter } = await import("../notification-prefs");
  const app = express();
  app.use(express.json());
  app.use("/api/notification-prefs", prefsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(notificationsFeed).where(eq(notificationsFeed.userId, buyerId));
  await db.delete(users).where(eq(users.clerkId, buyerId));
  await new Promise((resolve) => server.close(resolve));
});

describe("notification channel preferences", () => {
  it("returns per-channel defaults", async () => {
    const res = await fetch(`${base}/api/notification-prefs`);
    const body = await res.json() as any;
    expect(body.channels.push.order_updates).toBe(true);
    expect(body.channels.inApp.messages).toBe(true);
    expect(body.channels.email.order_updates).toBe(true);
    expect(body.channels.email.friend_activity).toBe(false);
  });

  it("stores email and in-app switches without touching push", async () => {
    const res = await putPrefs({ channels: { email: { order_updates: false }, inApp: { messages: false } } });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.channels.email.order_updates).toBe(false);
    expect(body.channels.inApp.messages).toBe(false);
    expect(body.channels.push.messages).toBe(true);
  });

  it("rejects unknown channels and types", async () => {
    expect((await putPrefs({ channels: { sms: { messages: true } } })).status).toBe(400);
    expect((await putPrefs({ channels: { email: { new_orders: true } } })).status).toBe(400);
    expect((await putPrefs({ channels: { email: { messages: "yes" } } })).status).toBe(400);
  });

  it("keeps an in-app-off type out of the feed but still pushes it", async () => {
    const { publishNotification } = await import("../notifications-feed");
    pushes.calls.length = 0;
    await publishNotification({
      userId: buyerId, category: "messages", type: "new_message",
      title: "New message", body: "hi", targetId: crypto.randomUUID(), targetType: "conversation",
    });
    const rows = await db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, buyerId));
    expect(rows).toHaveLength(0);
    expect(pushes.calls).toEqual([{ userId: buyerId, category: "message" }]);
  });

  it("writes the feed row when in-app is on", async () => {
    const { publishNotification } = await import("../notifications-feed");
    await publishNotification({
      userId: buyerId, category: "orders", type: "order_shipped",
      title: "Shipped", body: "on its way", targetId: "order-1", targetType: "order",
    });
    const rows = await db.select().from(notificationsFeed).where(eq(notificationsFeed.userId, buyerId));
    expect(rows).toHaveLength(1);
  });
});
