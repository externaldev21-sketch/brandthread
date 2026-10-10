/**
 * Seller marketing email goes out from its own sender, never the address
 * that carries sign-in codes, password resets and order email. A spammy
 * campaign's complaints and bounces then land on the marketing domain's
 * reputation, not on MAIL_FROM.
 *
 *   MARKETING_MAIL_FROM        required, e.g. "Brandthread Shops <shops@news.brandthread.app>"
 *                              (a subdomain verified in Resend on its own)
 *   MARKETING_RESEND_API_KEY   optional: a separate Resend account / key for it;
 *                              falls back to RESEND_API_KEY
 *
 * Until MARKETING_MAIL_FROM is set — or if it uses the same domain as
 * MAIL_FROM — campaigns are off (EMAIL_NOT_CONFIGURED); everything else in
 * the email tools still works.
 */
import { Resend } from "resend";
import { logger } from "../logger";
import type { RawEmailResult } from "../mailer";

let cachedClient: Resend | null = null;
let cachedKey: string | undefined;

function domainOf(from: string | undefined): string | null {
  if (!from) return null;
  const match = from.match(/<([^>]+)>/);
  const address = (match ? match[1] : from).trim().toLowerCase();
  const at = address.lastIndexOf("@");
  return at > 0 ? address.slice(at + 1) : null;
}

export function marketingFrom(env: Record<string, string | undefined> = process.env): { name: string | null; address: string } | null {
  const raw = env.MARKETING_MAIL_FROM?.trim();
  const domain = domainOf(raw);
  if (!raw || !domain) return null;
  const transactional = domainOf(env.MAIL_FROM?.trim() || env.RESEND_FROM_EMAIL?.trim() || "no-reply@brandthread.app");
  if (domain === transactional) return null; // same reputation as auth mail: refuse
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  return match ? { name: match[1].trim() || null, address: match[2].trim() } : { name: null, address: raw };
}

function apiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.MARKETING_RESEND_API_KEY?.trim() || env.RESEND_API_KEY?.trim() || undefined;
}

export function isMarketingMailerConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(apiKey(env) && marketingFrom(env));
}

function client(): Resend | null {
  const key = apiKey();
  if (!key) return null;
  if (!cachedClient || cachedKey !== key) {
    cachedClient = new Resend(key);
    cachedKey = key;
  }
  return cachedClient;
}

/** "Store Name <shops@news…>": the store's name on the marketing address. */
export function marketingFromHeader(fromName: string | null | undefined, env: Record<string, string | undefined> = process.env): string | null {
  const from = marketingFrom(env);
  if (!from) return null;
  const name = (fromName || from.name || "").replace(/[<>"]/g, "").trim();
  return name ? `${name} <${from.address}>` : from.address;
}

export async function sendMarketingEmail(options: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  fromName?: string | null;
  replyTo?: string | null;
  headers?: Record<string, string>;
}): Promise<RawEmailResult> {
  const from = marketingFromHeader(options.fromName);
  const resend = client();
  if (!from || !resend) return { ok: false, error: "MARKETING_MAIL_FROM is not set", retryable: false };
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: [options.to],
      subject: options.subject,
      html: options.html,
      ...(options.text ? { text: options.text } : {}),
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
    });
    if (error) {
      const status = (error as { statusCode?: number | null }).statusCode ?? 0;
      const name = String((error as { name?: string }).name ?? "");
      logger.error({ err: error }, "Marketing email send failed");
      return {
        ok: false,
        error: String((error as { message?: string }).message ?? name ?? "send failed").slice(0, 300),
        retryable: status === 429 || status >= 500 || name === "rate_limit_exceeded",
      };
    }
    return { ok: true, id: data?.id ?? null };
  } catch (err) {
    logger.error({ err }, "Marketing email request failed");
    return { ok: false, error: "Email provider request failed", retryable: true };
  }
}
