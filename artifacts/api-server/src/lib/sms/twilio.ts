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
