/**
 * Wave 1 / s07 audit regressions:
 *  - POST /api/notifications/events accepts push-only notification ids that
 *    are not uuids (e.g. "new-login/<session>") instead of a uuid-cast 500
 *  - /api/buyer/notifications/:id routes and /actors answer 4xx for non-uuid ids
 *  - SMS code verification claims each attempt atomically, so parallel
 *    guesses can't get past the 5-attempt limit
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, notificationDeliveries, notificationEvents, smsMessages, smsPhoneVerifications, users } from "@workspace/db";
import { hashVerificationCode } from "../../lib/sms";

const suffix = crypto.randomBytes(6).toString("hex");
const userId = `w1-s07-notif-${suffix}`;
const pushOnlyId = `new-login/sess_${suffix}`;
const auth = vi.hoisted(() => ({ userId: "" }));

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => { req.clerkUserId = auth.userId; next(); },
}));

let server: Server;
let base = "";

const call = (path: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, {
  method,
  headers: body === undefined ? undefined : { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

beforeAll(async () => {
  auth.userId = userId;
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "test-auth-token");
  vi.stubEnv("TWILIO_FROM_NUMBER", "+15005550006");
  await db.insert(users).values({ clerkId: userId, email: `${userId}@test.local`, name: "Notif", role: "buyer", accountType: "buyer" });
  await db.insert(notificationDeliveries).values({
    notificationId: pushOnlyId, userId, ownerId: userId, pushToken: `ExponentPushToken[w1-${suffix}]`, status: "sent",
  });

  const [{ default: eventsRouter }, { default: feedRouter }, { default: smsRouter }] = await Promise.all([
    import("../notification-events"),
    import("../notifications-feed"),
    import("../notification-prefs-sms"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.log = { error: () => undefined, warn: () => undefined }; next(); });
  app.use("/api/notifications", eventsRouter);
  app.use("/api/buyer/notifications", feedRouter);
  app.use("/api/notification-prefs/sms", smsRouter);
  app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: "internal" });
  });
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(notificationEvents).where(eq(notificationEvents.userId, userId));
  await db.delete(notificationDeliveries).where(eq(notificationDeliveries.userId, userId));
  await db.delete(smsPhoneVerifications).where(eq(smsPhoneVerifications.userId, userId));
  await db.delete(smsMessages).where(eq(smsMessages.userId, userId));
  await db.delete(users).where(inArray(users.clerkId, [userId]));
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  vi.unstubAllEnvs();
});

describe("notification events for push-only ids", () => {
  it("records an open for a delivery whose id is not a uuid", async () => {
    const response = await call("/api/notifications/events", "POST", { notificationId: pushOnlyId, eventType: "open" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, recorded: true });
  });

  it("still 404s an unknown non-uuid id", async () => {
    const response = await call("/api/notifications/events", "POST", { notificationId: "stable:nope", eventType: "tap" });
    expect(response.status).toBe(404);
  });
});

describe("feed routes with malformed ids", () => {
  it("answer 4xx rather than a database error", async () => {
    expect((await call("/api/buyer/notifications/not-a-uuid/read", "PATCH", {})).status).toBe(404);
    expect((await call("/api/buyer/notifications/not-a-uuid/unread", "PATCH", {})).status).toBe(404);
    expect((await call("/api/buyer/notifications/not-a-uuid", "DELETE")).status).toBe(404);
    expect((await call("/api/buyer/notifications/actors?ids=not-a-uuid")).status).toBe(400);
  });
});

describe("SMS code verification attempts", () => {
  it("allows at most five guesses even when they arrive together", async () => {
    const phone = `+1555${String(crypto.randomInt(1_000_000, 9_999_999))}`;
    const code = "424242";
    await db.insert(smsPhoneVerifications).values({
      userId, phone, codeHash: hashVerificationCode(userId, phone, code), attempts: 0,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    const guesses = await Promise.all(Array.from({ length: 20 }, () =>
      call("/api/notification-prefs/sms/verify", "POST", { code: "111111" })));
    const wrong = guesses.filter((r) => r.status === 400).length;
    const locked = guesses.filter((r) => r.status === 410).length;
    expect(wrong).toBe(5);
    expect(locked).toBe(15);

    // The real code no longer works once the attempts are spent.
    expect((await call("/api/notification-prefs/sms/verify", "POST", { code })).status).toBe(410);
    const [row] = await db.select({ enabled: users.smsOrderUpdates }).from(users).where(eq(users.clerkId, userId));
    expect(row.enabled).not.toBe(true);
  });
});
