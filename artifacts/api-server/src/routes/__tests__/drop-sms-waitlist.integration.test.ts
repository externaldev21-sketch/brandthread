/**
 * Drop SMS waitlist end to end against a real database:
 * public page data + signup (validation, dedupe, re-consent), the seller's
 * once-only "drop is live" text blast (unconfigured 503, opt-out exclusion,
 * concurrent claim), and the signed Twilio STOP/START webhook.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import crypto from "node:crypto";
import { db, drops, dropSmsBlasts, dropSmsWaitlist, users } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { computeTwilioSignature } from "../../lib/sms";

const RUN = crypto.randomBytes(4).toString("hex");
const SELLER = `test-sms-seller-${RUN}`;
const HANDLE = `smsdrop_${RUN}`;
const SUSPENDED = `test-sms-susp-${RUN}`;
const SUSPENDED_HANDLE = `smssusp_${RUN}`;
const EMPTY = `test-sms-empty-${RUN}`;
const EMPTY_HANDLE = `smsempty_${RUN}`;
// Unique client IP per run so DB-backed rate-limit buckets never carry over.
const CLIENT_IP = `10.${parseInt(RUN.slice(0, 2), 16)}.${parseInt(RUN.slice(2, 4), 16)}.${parseInt(RUN.slice(4, 6), 16)}`;

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = SELLER; next(); },
}));
vi.mock("../../middlewares/requireRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../middlewares/requireRole")>()),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

let server: Server;
let base: string;
let upcomingDropId = "";
let liveDropId = "";
const dropIds: string[] = [];
const realFetch = globalThis.fetch;
const twilioCalls: Array<{ to: string; body: string }> = [];
let twilioFailAll = false;

function stubTwilio(): void {
  vi.stubGlobal("fetch", async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith("https://api.twilio.com/")) {
      const form = new URLSearchParams(init?.body);
      twilioCalls.push({ to: form.get("To")!, body: form.get("Body")! });
      if (twilioFailAll) return new Response(JSON.stringify({ code: 20003 }), { status: 401 });
      return new Response(JSON.stringify({ sid: `SM${twilioCalls.length}` }), { status: 201 });
    }
    return realFetch(input, init);
  });
}

function configureTwilio(): void {
  vi.stubEnv("TWILIO_ACCOUNT_SID", "ACtest");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "twilio-test-token");
  vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MGtest");
}

async function call(method: string, path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Forwarded-For": CLIENT_IP },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* xml */ }
  return { status: res.status, body: json, text };
}

async function twilioInbound(params: Record<string, string>, signature?: string) {
  const path = "/api/webhooks/twilio/sms";
  const sig = signature ?? computeTwilioSignature("twilio-test-token", `${base}${path}`, params);
  const res = await realFetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig },
    body: new URLSearchParams(params).toString(),
  });
  return { status: res.status, text: await res.text() };
}

beforeAll(async () => {
  await db.insert(users).values([
    { clerkId: SELLER, email: `${SELLER}@example.test`, name: "Test Seller", username: HANDLE, brandName: "Nova <Studio>", accountType: "seller" },
    { clerkId: SUSPENDED, email: `${SUSPENDED}@example.test`, name: "Susp", username: SUSPENDED_HANDLE, accountType: "seller", suspendedAt: new Date() },
    { clerkId: EMPTY, email: `${EMPTY}@example.test`, name: "Empty", username: EMPTY_HANDLE, brandName: "Empty Co", accountType: "seller" },
  ]);
  const [upcoming] = await db.insert(drops).values({
    ownerId: SELLER, name: "Summer Capsule", type: "pre-made", status: "active",
    releaseAt: new Date(Date.now() + 2 * 864e5), heroImageUrl: "https://cdn.test/hero.jpg", launchTimezone: "America/New_York",
  }).returning({ id: drops.id });
  upcomingDropId = upcoming.id;
  dropIds.push(upcoming.id);

  const { default: dropWaitlistPublicRouter } = await import("../drop-waitlist-public");
  const { default: webhooksTwilioRouter } = await import("../webhooks-twilio");
  const { default: dropsRouter } = await import("../drops");
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use("/api/public/drop-waitlist", dropWaitlistPublicRouter);
  app.use("/api/webhooks/twilio", webhooksTwilioRouter);
  app.use("/api/drops", dropsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  twilioCalls.length = 0;
  twilioFailAll = false;
});

afterAll(async () => {
  await db.delete(dropSmsWaitlist).where(inArray(dropSmsWaitlist.sellerId, [SELLER, SUSPENDED, EMPTY]));
  await db.delete(dropSmsBlasts).where(inArray(dropSmsBlasts.dropId, dropIds));
  await db.delete(drops).where(inArray(drops.id, dropIds));
  await db.delete(users).where(inArray(users.clerkId, [SELLER, SUSPENDED, EMPTY]));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("public drop waitlist page data", () => {
  it("returns the brand and its next upcoming drop, case-insensitive", async () => {
    const res = await call("GET", `/api/public/drop-waitlist/${HANDLE.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(res.body.brand).toEqual({ name: "Nova <Studio>", handle: HANDLE, avatarUrl: null });
    expect(res.body.state).toBe("upcoming");
    expect(res.body.waitlistOpen).toBe(true);
    expect(res.body.drop).toMatchObject({ id: upcomingDropId, name: "Summer Capsule", heroImageUrl: "https://cdn.test/hero.jpg", launchTimezone: "America/New_York" });
    expect(res.body.consentText).toBe("By joining you agree to get texts from Nova <Studio> via Brandthread about this drop. Msg & data rates may apply. Reply STOP to opt out.");
  });

  it("still opens the waitlist when the brand has no drop", async () => {
    const res = await call("GET", `/api/public/drop-waitlist/${EMPTY_HANDLE}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ state: "none", drop: null, waitlistOpen: true });
    expect(res.body.consentText).toContain("about their next drop");
  });

  it("404s unknown, malformed and suspended handles", async () => {
    expect((await call("GET", `/api/public/drop-waitlist/nobody_${RUN}`)).status).toBe(404);
    expect((await call("GET", "/api/public/drop-waitlist/a")).status).toBe(404);
    expect((await call("GET", `/api/public/drop-waitlist/${SUSPENDED_HANDLE}`)).status).toBe(404);
  });
});

describe("joining the waitlist", () => {
  it("validates consent and phone", async () => {
    const noConsent = await call("POST", `/api/public/drop-waitlist/${HANDLE}`, { phone: "4155550101" });
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.code).toBe("CONSENT_REQUIRED");
    const badPhone = await call("POST", `/api/public/drop-waitlist/${HANDLE}`, { phone: "12345", consent: true });
    expect(badPhone.status).toBe(400);
    expect(badPhone.body.code).toBe("INVALID_PHONE");
    const unknown = await call("POST", `/api/public/drop-waitlist/nobody_${RUN}`, { phone: "4155550101", consent: true });
    expect(unknown.status).toBe(404);
  });

  it("stores the normalized number with the server's consent text, once per brand", async () => {
    const first = await call("POST", `/api/public/drop-waitlist/${HANDLE}`, { phone: "(415) 555-0101", consent: true });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ ok: true, phone: "+1 ••• ••• 0101" });
    const again = await call("POST", `/api/public/drop-waitlist/${HANDLE}`, { phone: "+1 415 555 0101", consent: true });
    expect(again.status).toBe(200);
    await call("POST", `/api/public/drop-waitlist/${HANDLE}`, { phone: "4155550102", consent: true });
    await call("POST", `/api/public/drop-waitlist/${HANDLE}`, { phone: "7700 900123", countryCode: "+44", consent: true });

    const rows = await db.select().from(dropSmsWaitlist).where(eq(dropSmsWaitlist.sellerId, SELLER));
    expect(rows.map((r) => r.phoneE164).sort()).toEqual(["+14155550101", "+14155550102", "+447700900123"]);
    const row = rows.find((r) => r.phoneE164 === "+14155550101")!;
    expect(row.dropId).toBe(upcomingDropId);
    expect(row.consentText).toContain("texts from Nova <Studio> via Brandthread about this drop");
    expect(Object.keys(row)).not.toContain("ip");
  });

  it("ignores honeypot submissions", async () => {
    const res = await call("POST", `/api/public/drop-waitlist/${HANDLE}`, { phone: "4155550199", consent: true, company: "bot" });
    expect(res.status).toBe(200);
    const rows = await db.select().from(dropSmsWaitlist)
      .where(and(eq(dropSmsWaitlist.sellerId, SELLER), eq(dropSmsWaitlist.phoneE164, "+14155550199")));
    expect(rows).toHaveLength(0);
  });
});

describe("Twilio inbound STOP/START webhook", () => {
  it("rejects a bad signature and 503s when SMS isn't configured", async () => {
    expect((await twilioInbound({ From: "+14155550102", Body: "STOP" })).status).toBe(503);
    configureTwilio();
    expect((await twilioInbound({ From: "+14155550102", Body: "STOP" }, "bogus")).status).toBe(403);
  });

  it("opts a number out on STOP and back in on START", async () => {
    configureTwilio();
    const stop = await twilioInbound({ From: "+14155550102", Body: " stop ", MessageSid: "SMx" });
    expect(stop.status).toBe(200);
    expect(stop.text).toContain("<Response></Response>");
    let [row] = await db.select().from(dropSmsWaitlist)
      .where(and(eq(dropSmsWaitlist.sellerId, SELLER), eq(dropSmsWaitlist.phoneE164, "+14155550102")));
    expect(row.optedOutAt).not.toBeNull();

    await twilioInbound({ From: "+14155550102", Body: "START" });
    [row] = await db.select().from(dropSmsWaitlist)
      .where(and(eq(dropSmsWaitlist.sellerId, SELLER), eq(dropSmsWaitlist.phoneE164, "+14155550102")));
    expect(row.optedOutAt).toBeNull();

    // Leave it opted out for the blast exclusion test below.
    await twilioInbound({ From: "+14155550102", Body: "UNSUBSCRIBE" });
  });
});

describe("drop is live text blast", () => {
  it("previews the waitlist without sending", async () => {
    const res = await call("GET", `/api/drops/${upcomingDropId}/sms-blast`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      handle: HANDLE,
      publicUrl: `https://brandthread.app/@${HANDLE}/drop`,
      waitlistCount: 2, // 0102 is opted out
      smsConfigured: false,
      dropLive: false,
      blast: null,
    });
    expect(res.body.message).toBe(`Nova <Studio>: Summer Capsule is live. Shop now: https://brandthread.app/drops/${upcomingDropId} Reply STOP to opt out.`);
  });

  it("returns 503 SMS_NOT_CONFIGURED when Twilio keys are missing", async () => {
    const res = await call("POST", `/api/drops/${upcomingDropId}/sms-blast`, {});
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("SMS_NOT_CONFIGURED");
  });

  it("refuses a drop that isn't live yet", async () => {
    configureTwilio();
    const res = await call("POST", `/api/drops/${upcomingDropId}/sms-blast`, {});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("DROP_NOT_LIVE");
  });

  it("the public page switches to the live drop and closes signup", async () => {
    const [live] = await db.insert(drops).values({
      ownerId: SELLER, name: "Live Now", type: "pre-made", status: "active", releaseAt: new Date(Date.now() - 60_000),
    }).returning({ id: drops.id });
    liveDropId = live.id;
    dropIds.push(live.id);
    const page = await call("GET", `/api/public/drop-waitlist/${HANDLE}`);
    expect(page.body).toMatchObject({ state: "live", waitlistOpen: false, drop: { id: liveDropId } });
    const join = await call("POST", `/api/public/drop-waitlist/${HANDLE}`, { phone: "4155550150", consent: true });
    expect(join.status).toBe(409);
    expect(join.body.code).toBe("DROP_LIVE");
  });

  it("releases the claim when every send fails so the seller can retry", async () => {
    configureTwilio();
    stubTwilio();
    twilioFailAll = true;
    const res = await call("POST", `/api/drops/${liveDropId}/sms-blast`, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ recipients: 2, sent: 0, failed: 2 });
    const claims = await db.select().from(dropSmsBlasts).where(eq(dropSmsBlasts.dropId, liveDropId));
    expect(claims).toHaveLength(0);
  });

  it("texts every non-opted-out number exactly once, even when sent twice at once", async () => {
    configureTwilio();
    stubTwilio();
    const [a, b] = await Promise.all([
      call("POST", `/api/drops/${liveDropId}/sms-blast`, {}),
      call("POST", `/api/drops/${liveDropId}/sms-blast`, {}),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const ok = a.status === 200 ? a : b;
    expect(ok.body).toMatchObject({ recipients: 2, sent: 2, failed: 0 });
    expect(twilioCalls.map((c) => c.to).sort()).toEqual(["+14155550101", "+447700900123"]);
    expect(twilioCalls[0].body).toBe(`Nova <Studio>: Live Now is live. Shop now: https://brandthread.app/drops/${liveDropId} Reply STOP to opt out.`);

    const again = await call("POST", `/api/drops/${liveDropId}/sms-blast`, {});
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ALREADY_SENT");

    const preview = await call("GET", `/api/drops/${liveDropId}/sms-blast`);
    expect(preview.body.dropLive).toBe(true);
    expect(preview.body.blast).toMatchObject({ status: "sent", recipientCount: 2, sentCount: 2, failedCount: 0 });
  });

  it("re-signup after an opt-out re-consents", async () => {
    await db.update(drops).set({ status: "closed" }).where(eq(drops.id, liveDropId));
    const res = await call("POST", `/api/public/drop-waitlist/${HANDLE}`, { phone: "415-555-0102", consent: true });
    expect(res.status).toBe(200);
    const [row] = await db.select().from(dropSmsWaitlist)
      .where(and(eq(dropSmsWaitlist.sellerId, SELLER), eq(dropSmsWaitlist.phoneE164, "+14155550102")));
    expect(row.optedOutAt).toBeNull();
  });
});
