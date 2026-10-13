import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import crypto from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";
import { db, orders, smsMessages, smsPhoneVerifications, users } from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "" }));
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => { req.clerkUserId = auth.userId; next(); },
}));

const RUN = crypto.randomBytes(6).toString("hex");
const BUYER = `sms-buyer-${RUN}`;
const OTHER = `sms-other-${RUN}`;
const SELLER = `sms-seller-${RUN}`;
const PHONE = `+1555${String(crypto.randomInt(1_000_000, 9_999_999))}`;
const TOKEN = "test-auth-token";
const sent: Array<{ to: string; body: string }> = [];
let server: Server;
let base = "";
let orderId = "";

function twilioOk() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const p = new URLSearchParams(init.body as string);
    sent.push({ to: p.get("To")!, body: p.get("Body")! });
    return new Response(JSON.stringify({ sid: `SM${sent.length}` }), { status: 201 });
  });
}

beforeAll(async () => {
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
  vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
  vi.stubEnv("TWILIO_FROM_NUMBER", "+15005550006");
  vi.stubEnv("PUBLIC_API_URL", "https://api.brandthread.test");
  await db.insert(users).values([
    { clerkId: BUYER, email: `${BUYER}@test.local`, name: "Sms Buyer", role: "buyer", accountType: "buyer", quietHoursTimezone: "America/New_York" },
    { clerkId: OTHER, email: `${OTHER}@test.local`, name: "Other Buyer", role: "buyer", accountType: "buyer" },
    { clerkId: SELLER, email: `${SELLER}@test.local`, name: "Seller", role: "seller", accountType: "seller", brandName: "Kith Test" },
  ]);
  const [order] = await db.insert(orders).values({
    ownerId: SELLER, buyerId: BUYER, orderNumber: `SMS-${RUN}`, totalCents: 1000, subtotalCents: 1000,
    trackingNumber: "9400100000000000000000", carrier: "usps",
  }).returning({ id: orders.id });
  orderId = order.id;

  const { default: prefsRouter } = await import("../notification-prefs-sms");
  const { default: twilioRouter } = await import("../webhooks-twilio");
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/api/notification-prefs/sms", prefsRouter);
  app.use("/api/webhooks/twilio", twilioRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(smsMessages).where(inArray(smsMessages.userId, [BUYER, OTHER]));
  await db.delete(smsPhoneVerifications).where(inArray(smsPhoneVerifications.userId, [BUYER, OTHER]));
  await db.delete(orders).where(eq(orders.id, orderId));
  await db.delete(users).where(inArray(users.clerkId, [BUYER, OTHER, SELLER]));
  await new Promise((resolve) => server.close(resolve));
  vi.unstubAllEnvs();
});

beforeEach(() => {
  sent.length = 0;
  vi.unstubAllGlobals();
});

// Our own server is called with the real fetch; only Twilio is faked.
const realFetch = globalThis.fetch;
function stubTwilio() {
  const twilio = twilioOk();
  vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
    String(url).startsWith("https://api.twilio.com/") ? twilio(url, init) : realFetch(url, init));
  return twilio;
}

async function api(path: string, method: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

describe("opt-in flow", () => {
  it("reports availability and starts off", async () => {
    auth.userId = BUYER;
    stubTwilio();
    const res = await api("/api/notification-prefs/sms", "GET");
    expect(res.body).toEqual({ available: true, phone: null, enabled: false });
  });

  it("texts a code, verifies it, opts in and sends one confirmation", async () => {
    auth.userId = BUYER;
    stubTwilio();
    const start = await api("/api/notification-prefs/sms", "PUT", { enabled: true, phone: PHONE });
    expect(start.status).toBe(200);
    expect(start.body.codeSentTo).toBe(PHONE);
    expect(start.body.enabled).toBe(false);
    const code = /code is (\d{6})/.exec(sent[0].body)?.[1];
    expect(code).toBeTruthy();

    const wrong = await api("/api/notification-prefs/sms/verify", "POST", { code: code === "000000" ? "111111" : "000000" });
    expect(wrong.status).toBe(400);

    const ok = await api("/api/notification-prefs/sms/verify", "POST", { code });
    expect(ok.body).toEqual({ available: true, phone: PHONE, enabled: true });
    expect(sent[1].body).toContain("Reply HELP for help, STOP to opt out");
    const [row] = await db.select().from(users).where(eq(users.clerkId, BUYER));
    expect(row.smsOptedInAt).toBeTruthy();
    const log = await db.select().from(smsMessages).where(eq(smsMessages.userId, BUYER));
    expect(log.find((r) => r.kind === "verify")?.body).toBe("");
  });

  it("reports unavailable and hides state when Twilio keys are missing", async () => {
    auth.userId = BUYER;
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    try {
      const res = await api("/api/notification-prefs/sms", "GET");
      expect(res.body.available).toBe(false);
      expect(res.body.enabled).toBe(false);
    } finally {
      vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
    }
  });
});

describe("order texts", () => {
  it("sends once per (order, kind) with the tracking link", async () => {
    const { notifyOrderSms } = await import("../../lib/sms");
    const twilio = stubTwilio();
    const noon = new Date("2026-07-01T16:00:00Z"); // noon New York
    expect(await notifyOrderSms(BUYER, orderId, "shipped", {}, noon)).toBe("sent");
    expect(await notifyOrderSms(BUYER, orderId, "shipped", {}, noon)).toBe("duplicate");
    expect(twilio).toHaveBeenCalledTimes(1);
    expect(sent[0]).toEqual({
      to: PHONE,
      body: `Brandthread: Your order #SMS-${RUN} from Kith Test shipped. Track: https://tools.usps.com/go/TrackConfirmAction?tLabels=9400100000000000000000`,
    });
  });

  it("never texts someone who isn't the order's buyer or hasn't opted in", async () => {
    const { notifyOrderSms } = await import("../../lib/sms");
    const twilio = stubTwilio();
    expect(await notifyOrderSms(OTHER, orderId, "delivered")).toBe("not_opted_in");
    expect(twilio).not.toHaveBeenCalled();
  });

  it("defers outside 8am-9pm and the job sends it when the window opens", async () => {
    const { notifyOrderSms } = await import("../../lib/sms");
    const { runSmsDeferredSend } = await import("../../jobs/smsDeferredSend");
    const twilio = stubTwilio();
    const lateNight = new Date("2026-07-02T03:00:00Z"); // 11pm New York
    expect(await notifyOrderSms(BUYER, orderId, "out_for_delivery", {}, lateNight)).toBe("deferred");
    expect(twilio).not.toHaveBeenCalled();
    const [row] = await db.select().from(smsMessages)
      .where(eq(smsMessages.orderId, orderId)).then((rows) => rows.filter((r) => r.kind === "out_for_delivery"));
    expect(row.status).toBe("deferred");
    expect(row.sendAfter?.toISOString()).toBe("2026-07-02T12:00:00.000Z");

    expect((await runSmsDeferredSend(new Date("2026-07-02T06:00:00Z"))).sent).toBe(0);
    const later = await runSmsDeferredSend(new Date("2026-07-02T12:05:00Z"));
    expect(later.sent).toBeGreaterThanOrEqual(1);
    expect(sent.some((m) => m.body.includes("is out for delivery today"))).toBe(true);
    const [after] = await db.select().from(smsMessages).where(eq(smsMessages.id, row.id));
    expect(after.status).toBe("sent");
  });

  it("goes through publishNotification's hook for order types", async () => {
    const { notifySmsForNotification } = await import("../../lib/sms");
    stubTwilio();
    await notifySmsForNotification({ userId: BUYER, type: "order_preparing", targetId: orderId });
    expect(sent).toHaveLength(0);
    // Delivered texts are window-gated; whichever happens, exactly one row exists.
    await notifySmsForNotification({ userId: BUYER, type: "order_delivered", targetId: orderId });
    await notifySmsForNotification({ userId: BUYER, type: "order_delivered", targetId: orderId });
    const rows = (await db.select().from(smsMessages).where(eq(smsMessages.orderId, orderId)))
      .filter((r) => r.kind === "delivered");
    expect(rows).toHaveLength(1);
  });
});

describe("inbound webhook", () => {
  async function inbound(params: Record<string, string>, signature?: string) {
    const { computeTwilioSignature } = await import("../../lib/sms");
    const sig = signature ?? computeTwilioSignature(TOKEN, "https://api.brandthread.test/api/webhooks/twilio/sms", params);
    return realFetch(`${base}/api/webhooks/twilio/sms`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig },
      body: new URLSearchParams(params).toString(),
    });
  }

  it("rejects a bad signature", async () => {
    const res = await inbound({ From: PHONE, Body: "STOP" }, "bm90LXJpZ2h0");
    expect(res.status).toBe(403);
    const [row] = await db.select().from(users).where(eq(users.clerkId, BUYER));
    expect(row.smsOrderUpdates).toBe(true);
  });

  it("STOP opts out, HELP replies, START opts back in", async () => {
    const stop = await inbound({ From: PHONE, Body: " stop " });
    expect(stop.status).toBe(200);
    expect(await stop.text()).toBe('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    let [row] = await db.select().from(users).where(eq(users.clerkId, BUYER));
    expect(row.smsOrderUpdates).toBe(false);
    expect(row.smsOptedOutAt).toBeTruthy();

    const { notifyOrderSms } = await import("../../lib/sms");
    const twilio = stubTwilio();
    expect(await notifyOrderSms(BUYER, orderId, "refunded")).toBe("not_opted_in");
    expect(twilio).not.toHaveBeenCalled();
    vi.unstubAllGlobals();

    const help = await inbound({ From: PHONE, Body: "HELP" });
    expect(await help.text()).toContain("Reply HELP for help, STOP to opt out");

    await inbound({ From: PHONE, Body: "START" });
    [row] = await db.select().from(users).where(eq(users.clerkId, BUYER));
    expect(row.smsOrderUpdates).toBe(true);
    expect(row.smsOptedOutAt).toBeNull();
  });

  it("turning off in the app clears consent", async () => {
    auth.userId = BUYER;
    const res = await api("/api/notification-prefs/sms", "PUT", { enabled: false });
    expect(res.body).toEqual({ available: true, phone: PHONE, enabled: false });
  });
});
