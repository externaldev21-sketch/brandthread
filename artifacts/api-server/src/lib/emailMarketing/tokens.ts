/**
 * Signed, purpose-bound tokens for email-marketing links (unsubscribe, double
 * opt-in confirm). The raw value is the random per-subscriber token stored in
 * email_subscribers.unsubscribe_token; the signature lets the public endpoints
 * reject forged or mistyped links before touching the database, and stops a
 * confirm token from being replayed as an unsubscribe token (and vice versa).
 */
import crypto from "node:crypto";

export type TokenPurpose = "unsub" | "confirm";

export function newRawToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function tokenSecret(): string | null {
  const secret = (process.env.EMAIL_TOKEN_SECRET || process.env.SESSION_SECRET || "").trim();
  return secret.length >= 8 ? secret : null;
}

function mac(purpose: TokenPurpose, raw: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${purpose}:${raw}`).digest("base64url").slice(0, 32);
}

export function signToken(purpose: TokenPurpose, raw: string, secret = tokenSecret()): string {
  if (!secret) throw new Error("EMAIL_TOKEN_SECRET / SESSION_SECRET is not configured");
  return `${raw}.${mac(purpose, raw, secret)}`;
}

/** Returns the raw token when the signature is valid for `purpose`, otherwise null. */
export function verifyToken(purpose: TokenPurpose, token: unknown, secret = tokenSecret()): string | null {
  if (!secret || typeof token !== "string" || token.length > 200) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const raw = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(mac(purpose, raw, secret));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  return raw;
}

/** Non-reversible IP fingerprint kept as GDPR consent evidence instead of the raw address. */
export function hashIp(ip: string | undefined, secret = tokenSecret()): string | null {
  if (!ip || !secret) return null;
  return crypto.createHmac("sha256", secret).update(`ip:${ip}`).digest("hex").slice(0, 32);
}
