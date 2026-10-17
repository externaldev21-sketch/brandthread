/**
 * Store Settings helpers shared by the seller store routes:
 *  - store password hashing (scrypt + per-password salt; plaintext never stored)
 *  - storefront slug validation (the slug is the real public store URL)
 *  - stripping secrets / private settings from storefront rows before they
 *    leave the server.
 */
import crypto from "crypto";

// ─── Store password ─────────────────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;

export const STORE_PASSWORD_MIN = 4;
export const STORE_PASSWORD_MAX = 128;

/** Returns an error message for an unacceptable store password, or null. */
export function validateStorePassword(password: unknown): string | null {
  if (typeof password !== "string") return "password must be a string";
  if (password.length < STORE_PASSWORD_MIN) return `Store password must be at least ${STORE_PASSWORD_MIN} characters`;
  if (password.length > STORE_PASSWORD_MAX) return `Store password must be at most ${STORE_PASSWORD_MAX} characters`;
  return null;
}

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (err, key) => {
      if (err) reject(err); else resolve(key);
    });
  });
}

/** Hash format: `scrypt$<N>$<r>$<p>$<salt b64url>$<hash b64url>`. */
export async function hashStorePassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** Constant-time check of a candidate password against a stored hash. */
export async function verifyStorePassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || typeof password !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64url");
  const key = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      password, Buffer.from(saltB64, "base64url"), expected.length,
      { N: Number(n), r: Number(r), p: Number(p) },
      (err, k) => (err ? reject(err) : resolve(k)),
    );
  }).catch(() => null);
  return !!key && key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

// ─── Store slug ─────────────────────────────────────────────────────────────

export const STORE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const RESERVED_STORE_SLUGS = new Set([
  "admin", "api", "app", "www", "mail", "email", "help", "support", "status",
  "blog", "docs", "store", "stores", "shop", "shops", "site", "sites",
  "brandthread", "login", "logout", "signin", "signup", "register", "account",
  "accounts", "settings", "billing", "checkout", "cart", "static", "assets",
  "cdn", "dev", "staging", "test", "preview", "public", "root", "system",
  "official", "security", "legal", "terms", "privacy", "about", "new",
]);

/**
 * Normalizes and validates a storefront slug: lowercase a-z, 0-9 and hyphens,
 * 3-40 chars, no leading/trailing/double hyphen, not a reserved word.
 */
export function validateStoreSlug(input: unknown): { ok: true; slug: string } | { ok: false; error: string } {
  if (typeof input !== "string") return { ok: false, error: "slug must be a string" };
  const slug = input.trim().toLowerCase();
  if (slug.length < 3 || slug.length > 40) return { ok: false, error: "Store URL must be 3-40 characters" };
  if (!STORE_SLUG_RE.test(slug) || slug.includes("--")) {
    return { ok: false, error: "Use only lowercase letters, numbers and single hyphens (not at the start or end)" };
  }
  if (RESERVED_STORE_SLUGS.has(slug)) return { ok: false, error: "That store URL is reserved. Try another." };
  return { ok: true, slug };
}

// ─── Response shaping ───────────────────────────────────────────────────────

/** Keys of storeSettings that are safe to show on the public storefront. */
const PUBLIC_STORE_SETTING_KEYS = ["currency", "language", "measurementUnit"] as const;

type Row = Record<string, unknown> & { storePasswordHash?: string | null };

/** Seller-facing view of a storefront row: never exposes the password hash. */
export function toOwnerStorefront<T extends Row>(row: T): Omit<T, "storePasswordHash"> & { hasStorePassword: boolean } {
  const { storePasswordHash, ...rest } = row;
  const settings = rest.storeSettings;
  if (settings && typeof settings === "object" && !Array.isArray(settings) && "storePassword" in settings) {
    const { storePassword: _drop, ...safe } = settings as Record<string, unknown>;
    (rest as Record<string, unknown>).storeSettings = safe;
  }
  return { ...rest, hasStorePassword: !!storePasswordHash };
}

/**
 * Public (buyer-facing) view: strips secrets, preview-link state and private
 * store settings (contact emails, checkout/notification toggles, password).
 * Blacklist on top-level keys so new public fields added elsewhere still flow.
 */
export function toPublicStorefront<T extends Row>(row: T): Record<string, unknown> {
  const {
    storePasswordHash: _hash,
    sharePreviewTokenHash: _token,
    sharePreviewRevokedAt: _revoked,
    setupChecklist: _checklist,
    onboarding: _onboarding,
    ...rest
  } = row as Record<string, unknown>;
  const settings = (row.storeSettings && typeof row.storeSettings === "object" ? row.storeSettings : {}) as Record<string, unknown>;
  const publicSettings: Record<string, unknown> = {};
  for (const key of PUBLIC_STORE_SETTING_KEYS) {
    if (key in settings) publicSettings[key] = settings[key];
  }
  return { ...rest, storeSettings: publicSettings, passwordProtected: !!row.storePasswordHash && settings.passwordProtected === true };
}

/** Removes keys that must never be persisted inside the storeSettings JSON. */
export function sanitizeStoreSettingsInput(settings: Record<string, unknown>): Record<string, unknown> {
  const { storePassword: _pw, hasStorePassword: _has, ...rest } = settings;
  return rest;
}

/** Whether a real custom-domain routing + SSL provider is wired up. */
export function customDomainRoutingEnabled(): boolean {
  return process.env.CUSTOM_DOMAIN_ROUTING_ENABLED === "true";
}
