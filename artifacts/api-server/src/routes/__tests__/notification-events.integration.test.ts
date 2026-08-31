import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, inArray } from "drizzle-orm";
import { db, notificationDeliveries, notificationEvents, notificationsFeed } from "@workspace/db";

const suffix = crypto.randomBytes(6).toString("hex");
const userA = `notification-owner-a-${suffix}`;
const userB = `notification-owner-b-${suffix}`;
const authState = vi.hoisted(() => ({ clerkUserId: "" }));
const notificationIds: string[] = [];
const deliveryIds: string[] = [];

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.clerkUserId = authState.clerkUserId;
    next();
  },
  requirePlan: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let server: Server;
let base = "";

beforeAll(async () => {
  const feeds = await db.insert(notificationsFeed).values([
    { userId: userA, type: "test", title: "A", body: "A" },
    { userId: userB, type: "test", title: "B", body: "B" },
    { userId: userB, type: "campaign", title: "From A", body: "From A" },
  ]).returning({ id: notificationsFeed.id });
  notificationIds.push(...feeds.map((row) => row.id));

  const deliveries = await db.insert(notificationDeliveries).values([
    {
      notificationId: feeds[0].id,
      userId: userA,
      ownerId: userA,
      pushToken: `ExponentPushToken[a-${suffix}]`,
      status: "sent",
      providerStatus: "ok",
      providerResultAt: new Date(),
      sentAt: new Date(),
    },
    {
      notificationId: feeds[1].id,
      userId: userB,
      ownerId: userB,
      pushToken: `ExponentPushToken[b-${suffix}]`,
      status: "provider_error",
      providerStatus: "error",
      providerResultAt: new Date(),
    },
    {
      notificationId: feeds[2].id,
      userId: userB,
      ownerId: userA,
      pushToken: `ExponentPushToken[campaign-${suffix}]`,
      status: "provider_error",
      providerStatus: "error",
      providerResultAt: new Date(),
    },
  ]).returning({ id: notificationDeliveries.id });
  deliveryIds.push(...deliveries.map((row) => row.id));

  authState.clerkUserId = userA;
  const [{ default: notificationEventsRouter }, { default: analyticsRouter }] = await Promise.all([
    import("../notification-events"),
    import("../analytics"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.log = { error: vi.fn() };
    next();
  });
  app.use("/api/notifications", notificationEventsRouter);
  app.use("/api/analytics", analyticsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(notificationEvents).where(inArray(notificationEvents.notificationId, notificationIds));
  await db.delete(notificationDeliveries).where(inArray(notificationDeliveries.id, deliveryIds));
  await db.delete(notificationsFeed).where(inArray(notificationsFeed.id, notificationIds));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("notification event ownership and analytics", () => {
  it("records an authenticated event idempotently", async () => {
    authState.clerkUserId = userA;
    const body = { notificationId: notificationIds[0], eventType: "tap" };
    const first = await fetch(`${base}/api/notifications/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const second = await fetch(`${base}/api/notifications/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(await first.json()).toEqual({ ok: true, recorded: true });
    expect(await second.json()).toEqual({ ok: true, recorded: false });

    const rows = await db.select({ id: notificationEvents.id }).from(notificationEvents).where(and(
      eq(notificationEvents.userId, userA),
      eq(notificationEvents.notificationId, notificationIds[0]),
      eq(notificationEvents.eventType, "tap"),
    ));
    expect(rows).toHaveLength(1);
  });

  it("does not let another account record an event for the notification", async () => {
    authState.clerkUserId = userB;
    const response = await fetch(`${base}/api/notifications/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationId: notificationIds[0], eventType: "open" }),
    });
    expect(response.status).toBe(404);
  });

  it("returns aggregate-only delivery counts scoped to the active owner", async () => {
    authState.clerkUserId = userB;
    const eventResponse = await fetch(`${base}/api/notifications/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationId: notificationIds[2], eventType: "tap" }),
    });
    expect(eventResponse.status).toBe(200);

    authState.clerkUserId = userA;
    const response = await fetch(`${base}/api/analytics/notifications`);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.providerResults).toBe(2);
    expect(body.providerErrors).toBe(1);
    expect(body.tap).toBe(2);
    expect(JSON.stringify(body)).not.toContain(userB);
    expect(JSON.stringify(body)).not.toContain("ExponentPushToken");
  });
});