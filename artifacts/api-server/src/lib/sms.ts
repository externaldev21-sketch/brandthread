/**
 * Opt-in SMS order updates over Twilio Programmable Messaging.
 *
 * Built fully behind env: without TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN and a
 * sender (TWILIO_MESSAGING_SERVICE_SID preferred, else TWILIO_FROM_NUMBER)
 * `smsEnabled()` is false, no network call is ever made and the client hides
 * the feature entirely. Nothing in here throws to its callers: failures are
 * logged and recorded on the sms_messages row.
 *
 * Talks to the Messages REST resource with fetch (no SDK dependency):
 *   POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
 *
 * Consent (TCPA): a buyer opts in explicitly in Settings > Notifications >
 * Text messages, confirms the number with a one-time code, and then receives
 * one confirmation text carrying the HELP/STOP disclosure. Inbound STOP/START/
 * HELP keywords are handled by routes/webhooks-twilio.ts.
 *
 * Order texts are transactional and only go out between 8am and 9pm in the
 * recipient's time zone; outside that window the row is stored as 'deferred'
 * and jobs/smsDeferredSend.ts sends it once the window opens.
 */
import crypto from "node:crypto";
import { and, eq, lte, sql } from "drizzle-orm";
import { db, orders, returns, smsMessages, users } from "@workspace/db";
import { logger } from "./logger";

// ─── Config ──────────────────────────────────────────────────────────────────

type SmsConfig = {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string | null;
  fromNumber: string | null;
};

function readConfig(): SmsConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null;
  const fromNumber = process.env.TWILIO_FROM_NUMBER?.trim() || null;
  if (!accountSid || !authToken || (!messagingServiceSid && !fromNumber)) return null;
  return { accountSid, authToken, messagingServiceSid, fromNumber };
}

/** True only when the account SID, auth token and a sender are all configured. */
export function smsEnabled(): boolean {
  return readConfig() !== null;
}

export function twilioAuthToken(): string | null {
  return process.env.TWILIO_AUTH_TOKEN?.trim() || null;
}

// ─── Phone numbers ───────────────────────────────────────────────────────────

/**
 * Normalises user input to E.164. Bare 10-digit numbers are treated as US/CA
 * (+1); anything else must carry its country code.
 */
export function normalizeE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : null;
  }
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

// ─── Sending ─────────────────────────────────────────────────────────────────

export type SendResult = { ok: true; sid: string } | { ok: false; error: string; code?: number };

/** Twilio error 21610: the recipient replied STOP to this sender. */
export const TWILIO_UNSUBSCRIBED = 21610;

/** Sends one text. Never throws; returns ok:false (without any fetch) when SMS is off. */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const config = readConfig();
  if (!config) return { ok: false, error: "sms_disabled" };
  const params = new URLSearchParams({ To: to, Body: body });
  if (config.messagingServiceSid) params.set("MessagingServiceSid", config.messagingServiceSid);
  else if (config.fromNumber) params.set("From", config.fromNumber);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { sid?: string; code?: number; message?: string };
    if (!res.ok || !json.sid) {
      const error = `twilio_${json.code ?? res.status}${json.message ? `: ${json.message}` : ""}`.slice(0, 500);
      logger.warn({ status: res.status, code: json.code }, "Twilio SMS send failed");
      return { ok: false, error, code: json.code };
    }
    return { ok: true, sid: json.sid };
  } catch (err) {
    logger.warn({ err }, "Twilio SMS send threw");
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 500) : "network_error" };
  }
}

/** A carrier-level STOP means our stored consent is stale: clear it. */
async function markOptedOutByPhone(phone: string, now = new Date()): Promise<void> {
  await db.update(users)
    .set({ smsOrderUpdates: false, smsOptedOutAt: now })
    .where(and(eq(users.smsPhone, phone), eq(users.smsOrderUpdates, true)));
}

/**
 * Sends and logs a non-order text (confirmation, verification code). Never
 * throws. Returns whether Twilio accepted it.
 */
export async function sendLoggedSms(input: { userId: string; kind: string; to: string; body: string }): Promise<SendResult> {
  const result = await sendSms(input.to, input.body);
  try {
    await db.insert(smsMessages).values({
      userId: input.userId, kind: input.kind, toPhone: input.to,
      // A verification code is never stored in the log.
      body: input.kind === "verify" ? "" : input.body,
      twilioSid: result.ok ? result.sid : null,
      status: result.ok ? "sent" : "failed",
      error: result.ok ? null : result.error,
    });
    if (!result.ok && result.code === TWILIO_UNSUBSCRIBED) await markOptedOutByPhone(input.to);
  } catch (err) {
    logger.warn({ err, kind: input.kind }, "Could not record SMS");
  }
  return result;
}

// ─── Copy ────────────────────────────────────────────────────────────────────

export const SMS_DISCLOSURE = "Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

export const CONFIRMATION_SMS =
  `Brandthread: You're signed up for order update texts. ${SMS_DISCLOSURE}`;

export const HELP_SMS =
  "Brandthread order updates. Manage texts in the app under Settings > Notifications > Text messages. "
  + SMS_DISCLOSURE;


export function verificationSms(code: string): string {
  return `Brandthread: Your code is ${code}. It expires in 10 minutes.`;
}

export type OrderSmsKind = "shipped" | "out_for_delivery" | "delivered" | "refunded";

export type OrderSmsContext = {
  orderNumber?: string | null;
  storeName?: string | null;
  trackingUrl?: string | null;
  amountCents?: number | null;
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function composeOrderSms(kind: OrderSmsKind, ctx: OrderSmsContext): string {
  const order = `Your order${ctx.orderNumber ? ` #${ctx.orderNumber}` : ""}${ctx.storeName ? ` from ${ctx.storeName}` : ""}`;
  switch (kind) {
    case "shipped":
      return `Brandthread: ${order} shipped.${ctx.trackingUrl ? ` Track: ${ctx.trackingUrl}` : ""}`;
    case "out_for_delivery":
      return `Brandthread: ${order} is out for delivery today.`;
    case "delivered":
      return `Brandthread: ${order} was delivered.`;
    case "refunded":
      return ctx.amountCents && ctx.amountCents > 0
        ? `Brandthread: A ${money(ctx.amountCents)} refund for ${order.charAt(0).toLowerCase()}${order.slice(1)} was issued.`
        : `Brandthread: A refund for ${order.charAt(0).toLowerCase()}${order.slice(1)} was issued.`;
  }
}

// ─── Send window (8am-9pm recipient local time) ──────────────────────────────

export const SEND_WINDOW_START_HOUR = 8;
export const SEND_WINDOW_END_HOUR = 21;

function validZone(tz: string | null | undefined): string | null {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/**
 * Time zones the window must hold in. A real stored zone wins. The column
 * defaults to 'UTC', which usually means "never set", so for a +1 number we
 * require the window to be open on both US coasts (11am-9pm Eastern).
 */
export function recipientZones(tz: string | null | undefined, phone: string): string[] {
  const zone = validZone(tz);
  if (zone && zone !== "UTC" && zone !== "Etc/UTC") return [zone];
  if (phone.startsWith("+1")) return ["America/New_York", "America/Los_Angeles"];
  return ["UTC"];
}

function localHour(now: Date, tz: string): number {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" }).format(now);
  return Number(hour) % 24;
}

export function withinSendWindow(now: Date, zones: string[]): boolean {
  return zones.every((tz) => {
    const h = localHour(now, tz);
    return h >= SEND_WINDOW_START_HOUR && h < SEND_WINDOW_END_HOUR;
  });
}

/** The first moment (on a 15-minute grid, within 48h) the window is open in every zone. */
export function nextSendWindow(now: Date, zones: string[]): Date {
  const step = 15 * 60 * 1000;
  let t = new Date(Math.ceil(now.getTime() / step) * step);
  for (let i = 0; i < 48 * 4; i += 1) {
    if (withinSendWindow(t, zones)) return t;
    t = new Date(t.getTime() + step);
  }
  return new Date(now.getTime() + 12 * 60 * 60 * 1000);
}

// ─── Order texts ─────────────────────────────────────────────────────────────

export type OrderSmsOutcome = "disabled" | "not_opted_in" | "not_found" | "duplicate" | "deferred" | "sent" | "failed" | "error";

/**
 * The single hook every buyer order-status publish point goes through (via
 * notifySmsForNotification). Checks smsEnabled() + the buyer's opt-in, then
 * sends (or defers) exactly one text per (order, kind). Never throws.
 */
export async function notifyOrderSms(
  userId: string, orderId: string, kind: OrderSmsKind, ctx: OrderSmsContext = {}, now = new Date(),
): Promise<OrderSmsOutcome> {
  if (!smsEnabled()) return "disabled";
  try {
    const [user] = await db.select({
      phone: users.smsPhone, optedIn: users.smsOrderUpdates, tz: users.quietHoursTimezone,
    }).from(users).where(eq(users.clerkId, userId)).limit(1);
    if (!user?.optedIn || !user.phone) return "not_opted_in";

    const [order] = await db.select({
      orderNumber: orders.orderNumber, ownerId: orders.ownerId, buyerId: orders.buyerId,
      carrier: orders.carrier, trackingNumber: orders.trackingNumber,
    }).from(orders).where(eq(orders.id, orderId)).limit(1);
    // Only the order's own buyer is ever texted about it.
    if (!order || order.buyerId !== userId) return "not_found";

    let storeName = ctx.storeName ?? null;
    if (!storeName && order.ownerId) {
      const [seller] = await db.select({ brandName: users.brandName, name: users.name })
        .from(users).where(eq(users.clerkId, order.ownerId)).limit(1);
      storeName = seller?.brandName || seller?.name || null;
    }
    let trackingUrl = ctx.trackingUrl ?? null;
    if (!trackingUrl && kind === "shipped" && order.trackingNumber) {
      // Lazy: lib/delivery imports the notification feed, which imports this module.
      const { carrierTrackingUrl } = await import("./delivery/buyerView");
      trackingUrl = carrierTrackingUrl(order.carrier, order.trackingNumber);
    }
    const body = composeOrderSms(kind, {
      orderNumber: ctx.orderNumber ?? order.orderNumber, storeName, trackingUrl, amountCents: ctx.amountCents,
    });

    const zones = recipientZones(user.tz, user.phone);
    const open = withinSendWindow(now, zones);
    const [row] = await db.insert(smsMessages).values({
      userId, orderId, kind, toPhone: user.phone, body,
      status: open ? "pending" : "deferred",
      sendAfter: open ? null : nextSendWindow(now, zones),
    }).onConflictDoNothing().returning({ id: smsMessages.id });
    if (!row) return "duplicate";
    if (!open) return "deferred";
    return await deliverRow(row.id, user.phone, body);
  } catch (err) {
    logger.warn({ err, orderId, kind }, "Order SMS failed");
    return "error";
  }
}

async function deliverRow(id: string, to: string, body: string): Promise<"sent" | "failed"> {
  const result = await sendSms(to, body);
  await db.update(smsMessages).set({
    status: result.ok ? "sent" : "failed",
    twilioSid: result.ok ? result.sid : null,
    error: result.ok ? null : result.error,
    toPhone: to,
    updatedAt: new Date(),
  }).where(eq(smsMessages.id, id));
  if (!result.ok && result.code === TWILIO_UNSUBSCRIBED) await markOptedOutByPhone(to);
  return result.ok ? "sent" : "failed";
}

/** Sends deferred order texts whose window has opened. Used by jobs/smsDeferredSend.ts. */
export async function sendDueDeferredSms(now = new Date()): Promise<{ sent: number; skipped: number; rescheduled: number }> {
  const stats = { sent: 0, skipped: 0, rescheduled: 0 };
  if (!smsEnabled()) return stats;
  const due = await db.select().from(smsMessages)
    .where(and(eq(smsMessages.status, "deferred"), lte(smsMessages.sendAfter, now)))
    .limit(200);
  for (const row of due) {
    try {
      const [user] = await db.select({
        phone: users.smsPhone, optedIn: users.smsOrderUpdates, tz: users.quietHoursTimezone,
      }).from(users).where(eq(users.clerkId, row.userId)).limit(1);
      if (!user?.optedIn || !user.phone) {
        await db.update(smsMessages).set({ status: "skipped", error: "opted_out", updatedAt: now })
          .where(and(eq(smsMessages.id, row.id), eq(smsMessages.status, "deferred")));
        stats.skipped += 1;
        continue;
      }
      const zones = recipientZones(user.tz, user.phone);
      if (!withinSendWindow(now, zones)) {
        await db.update(smsMessages).set({ sendAfter: nextSendWindow(now, zones), updatedAt: now })
          .where(and(eq(smsMessages.id, row.id), eq(smsMessages.status, "deferred")));
        stats.rescheduled += 1;
        continue;
      }
      // Claim the row so a second worker can never send it too.
      const [claimed] = await db.update(smsMessages).set({ status: "pending", updatedAt: now })
        .where(and(eq(smsMessages.id, row.id), eq(smsMessages.status, "deferred")))
        .returning({ id: smsMessages.id });
      if (!claimed) continue;
      if ((await deliverRow(row.id, user.phone, row.body)) === "sent") stats.sent += 1;
    } catch (err) {
      logger.warn({ err, smsId: row.id }, "Deferred SMS send failed");
    }
  }
  return stats;
}

// ─── Notification hook ───────────────────────────────────────────────────────

const KIND_BY_NOTIFICATION_TYPE: Record<string, OrderSmsKind> = {
  order_shipped: "shipped",
  order_out_for_delivery: "out_for_delivery",
  order_delivered: "delivered",
  order_auto_refunded: "refunded",
  return_refunded: "refunded",
};

export function smsKindForNotification(type: string): OrderSmsKind | null {
  return KIND_BY_NOTIFICATION_TYPE[type] ?? null;
}

/**
 * Called from publishNotification for every notification; a cheap no-op
 * unless SMS is configured and the type is a buyer order-status update.
 * Resolves return ids to their order so a return refund texts once per order.
 */
export async function notifySmsForNotification(n: {
  userId: string; type: string; targetId?: string; targetType?: string;
}): Promise<void> {
  if (!smsEnabled()) return;
  const kind = smsKindForNotification(n.type);
  if (!kind || !n.targetId) return;
  try {
    let orderId: string | null = null;
    let amountCents: number | null = null;
    if (n.type === "return_refunded") {
      const [ret] = await db.select({ orderId: returns.orderId, refund: returns.refundAmountCents })
        .from(returns).where(eq(returns.id, n.targetId)).limit(1);
      orderId = ret?.orderId ?? null;
      amountCents = ret?.refund ?? null;
    } else if (/^[0-9a-f-]{36}$/i.test(n.targetId)) {
      orderId = n.targetId;
    }
    if (!orderId) return;
    await notifyOrderSms(n.userId, orderId, kind, { amountCents });
  } catch (err) {
    logger.warn({ err, type: n.type }, "SMS hook failed");
  }
}

// ─── Verification codes ──────────────────────────────────────────────────────

export function hashVerificationCode(userId: string, phone: string, code: string): string {
  return crypto.createHash("sha256").update(`${userId}:${phone}:${code}`).digest("hex");
}

export function generateVerificationCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Codes sent to this user in the last hour (rate limit for the opt-in flow). */
export async function recentVerificationCount(userId: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(smsMessages)
    .where(and(eq(smsMessages.userId, userId), eq(smsMessages.kind, "verify"), sql`${smsMessages.createdAt} >= ${since}`));
  return row?.n ?? 0;
}

// ─── Inbound webhook ─────────────────────────────────────────────────────────

/**
 * X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + concat(sorted(key + value)))).
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, unknown>): string {
  const data = Object.keys(params).sort().reduce((acc, key) => {
    const value = params[key];
    const values = Array.isArray(value) ? value : [value];
    return acc + values.map((v) => `${key}${v ?? ""}`).join("");
  }, url);
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function validateTwilioSignature(
  authToken: string, signature: string | undefined | null, url: string, params: Record<string, unknown>,
): boolean {
  if (!signature) return false;
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

export type InboundKeyword = "stop" | "start" | "help" | null;

export function classifyKeyword(body: unknown): InboundKeyword {
  if (typeof body !== "string") return null;
  const word = body.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (STOP_WORDS.has(word)) return "stop";
  if (START_WORDS.has(word)) return "start";
  if (HELP_WORDS.has(word)) return "help";
  return null;
}

/**
 * Applies an inbound keyword. STOP clears consent for every account using the
 * number; START restores it only for accounts that had opted in before.
 * Returns the reply to send back as TwiML (null = no reply).
 */
export async function handleInboundSms(from: string, body: unknown, now = new Date()): Promise<{ keyword: InboundKeyword; reply: string | null }> {
  const keyword = classifyKeyword(body);
  const phone = normalizeE164(from) ?? from;
  if (keyword === "stop") {
    await db.update(users).set({ smsOrderUpdates: false, smsOptedOutAt: now })
      .where(eq(users.smsPhone, phone));
    return { keyword, reply: null };
  }
  if (keyword === "start") {
    await db.update(users).set({ smsOrderUpdates: true, smsOptedInAt: now, smsOptedOutAt: null })
      .where(and(eq(users.smsPhone, phone), sql`${users.smsOptedInAt} IS NOT NULL`));
    return { keyword, reply: null };
  }
  if (keyword === "help") return { keyword, reply: HELP_SMS };
  return { keyword, reply: null };
}

export function twiml(message: string | null): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${escape(message)}</Message>` : ""}</Response>`;
}
