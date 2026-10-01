/**
 * Etsy Open API v3 configuration. The whole integration is feature-flagged by
 * env: when any required value is missing `etsyConfig()` returns null and
 * nothing Etsy-related runs (the provider list reports it as disabled).
 *
 *   ETSY_API_KEY               "keystring" from etsy.com/developers/your-apps
 *   ETSY_SHARED_SECRET         "shared secret" from the same app page
 *   ETSY_REDIRECT_URI          https://<api host>/api/product-import/etsy/callback
 *                              (must be registered as a Callback URL on the Etsy app)
 *   ETSY_TOKEN_ENCRYPTION_KEY  base64 32-byte key for token encryption at rest;
 *                              falls back to SHOPIFY_TOKEN_ENCRYPTION_KEY when unset
 */
import crypto from "node:crypto";

export const ETSY_SCOPES = ["listings_r", "shops_r"] as const;
export const ETSY_AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
export const ETSY_API_BASE = "https://api.etsy.com/v3";

export type EtsyConfig = { apiKey: string; sharedSecret: string; redirectUri: string };

export function etsyConfig(env: NodeJS.ProcessEnv = process.env): EtsyConfig | null {
  const apiKey = env.ETSY_API_KEY?.trim();
  const sharedSecret = env.ETSY_SHARED_SECRET?.trim();
  const redirectUri = env.ETSY_REDIRECT_URI?.trim();
  if (!apiKey || !sharedSecret || !redirectUri) return null;
  if (!etsyEncryptionKey(env)) return null;
  return { apiKey, sharedSecret, redirectUri };
}

export function etsyEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.ETSY_TOKEN_ENCRYPTION_KEY?.trim() || env.SHOPIFY_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

/** Reason shown to the seller only (never to buyers) when Etsy is off. */
export const ETSY_DISABLED_REASON = "Etsy import isn't enabled on this server.";

// ─── PKCE helpers (RFC 7636) ────────────────────────────────────────────────

export function newCodeVerifier(): string {
  return crypto.randomBytes(48).toString("base64url");
}

export function codeChallengeFor(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function buildEtsyAuthorizeUrl(cfg: EtsyConfig, state: string, verifier: string): string {
  const url = new URL(ETSY_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.apiKey);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", ETSY_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ─── Token encryption at rest (AES-256-GCM, same scheme as shopifyCrypto) ───

function requireKey(): Buffer {
  const key = etsyEncryptionKey();
  if (!key) throw new Error("ETSY_TOKEN_ENCRYPTION_KEY is not configured");
  return key;
}

export function encryptEtsySecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", requireKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}

export function decryptEtsySecret(encoded: string): string {
  const [ivB64, tagB64, dataB64] = encoded.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", requireKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
