/**
 * Outbound SMS through Twilio's REST API (plain fetch, no SDK).
 *
 * Env (server only): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and a sender:
 * TWILIO_MESSAGING_SERVICE_SID (preferred, carries the A2P 10DLC campaign) or
 * TWILIO_FROM_NUMBER. Missing any of them turns SMS off: smsEnabled() is false
 * and sendSms resolves {sent:false, reason:'not_configured'}. Never throws.
 */
import { logger } from "../logger";

export type SmsResult =
  | { sent: true; sid: string }
  | { sent: false; reason: "not_configured" | "invalid_number" | "api_error" };

type TwilioConfig = { accountSid: string; authToken: string; from: string | null; messagingServiceSid: string | null };

function config(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim() || null;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim() || null;
  if (!accountSid || !authToken || (!from && !messagingServiceSid)) return null;
  return { accountSid, authToken, from, messagingServiceSid };
}

export function smsEnabled(): boolean {
  return config() !== null;
}

/** One SMS. Twilio splits long bodies itself; callers keep bodies short. */
export async function sendSms(to: string, body: string, fetchImpl: typeof fetch = fetch): Promise<SmsResult> {
  const cfg = config();
  if (!cfg) return { sent: false, reason: "not_configured" };
  if (!/^\+[1-9]\d{7,14}$/.test(to)) return { sent: false, reason: "invalid_number" };
  const form = new URLSearchParams({ To: to, Body: body });
  if (cfg.messagingServiceSid) form.set("MessagingServiceSid", cfg.messagingServiceSid);
  else form.set("From", cfg.from!);
  try {
    const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { sid?: string; code?: number; message?: string } | null;
    if (!res.ok || !json?.sid) {
      logger.warn({ status: res.status, code: json?.code, message: json?.message }, "Twilio SMS send failed");
      return { sent: false, reason: "api_error" };
    }
    return { sent: true, sid: json.sid };
  } catch (err) {
    logger.warn({ err }, "Twilio SMS request failed");
    return { sent: false, reason: "api_error" };
  }
}

/**
 * Twilio Programmable Messaging over plain REST (no SDK). The feature is OFF
 * unless all three env vars are set:
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID
 * Sending through a Messaging Service lets Twilio pick the sender number and
 * apply its built-in STOP/START opt-out handling at the carrier level.
 */
import crypto from "node:crypto";

export interface SmsConfig {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string;
}

export function getSmsConfig(): SmsConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID?.trim();
  if (!accountSid || !authToken || !messagingServiceSid) return null;
  return { accountSid, authToken, messagingServiceSid };
}

export function isSmsConfigured(): boolean {
  return getSmsConfig() !== null;
}

export type SendSmsResult =
  | { ok: true; sid: string | null }
  | { ok: false; status: number; code: number | null };

const SEND_TIMEOUT_MS = 10_000;

export async function sendWaitlistSms(to: string, body: string, config = getSmsConfig()): Promise<SendSmsResult> {
  if (!config) return { ok: false, status: 503, code: null };
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const form = new URLSearchParams({ To: to, MessagingServiceSid: config.messagingServiceSid, Body: body });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as { sid?: string; code?: number } | null;
    if (!res.ok) return { ok: false, status: res.status, code: typeof data?.code === "number" ? data.code : null };
    return { ok: true, sid: typeof data?.sid === "string" ? data.sid : null };
  } catch {
    return { ok: false, status: 0, code: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Twilio request signature: base64(HMAC-SHA1(authToken, url + each POST
 * param name+value, params sorted by name)).
 */
export function computeTwilioSignature(authToken: string, url: string, params: Record<string, unknown>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => {
      const value = params[key];
      const values = Array.isArray(value) ? value : [value];
      return acc + values.map((v) => `${key}${v == null ? "" : String(v)}`).join("");
    }, url);
  return crypto.createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export function isValidTwilioSignature(
  authToken: string,
  signature: unknown,
  urls: string[],
  params: Record<string, unknown>,
): boolean {
  if (typeof signature !== "string" || !signature) return false;
  const provided = Buffer.from(signature);
  return urls.some((url) => {
    const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
  });
}
