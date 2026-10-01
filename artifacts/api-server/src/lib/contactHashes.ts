import { createHash } from "node:crypto";

/**
 * Contact-sync hashing + input validation (pure, unit-tested).
 *
 * The client hashes address-book entries ON DEVICE and sends only hashes; the
 * server never sees raw contacts. The scheme MUST stay byte-identical to
 * artifacts/mobile/lib/contactHashing.ts (shared test vectors in both suites):
 *
 *   hash = SHA-256_hex( `bt:v1:${kind}:${normalizedValue}` )
 *   email  -> trimmed + lowercased
 *   phone  -> E.164 ("+" followed by 8-15 digits)
 */
export type ContactKind = "email" | "phone";

export const MAX_CONTACT_HASHES = 2000;
const HASH_RE = /^[0-9a-f]{64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  return v.length <= 254 && EMAIL_RE.test(v) ? v : null;
}

/** Best-effort E.164. Numbers without a country prefix use `defaultCallingCode` (digits, no "+"). */
export function normalizePhone(raw: string | null | undefined, defaultCallingCode = "1"): string | null {
  let v = (raw ?? "").trim();
  if (!v) return null;
  const hasPlus = v.startsWith("+");
  let digits = v.replace(/\D/g, "");
  if (!hasPlus && digits.startsWith("00")) digits = digits.slice(2);
  else if (!hasPlus) {
    digits = digits.replace(/^0+/, "");
    // National-format number: prepend the default calling code unless it already leads.
    if (!(digits.startsWith(defaultCallingCode) && digits.length > 10)) digits = defaultCallingCode + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export function hashContact(kind: ContactKind, normalized: string): string {
  return createHash("sha256").update(`bt:v1:${kind}:${normalized}`).digest("hex");
}

export function isValidContactHash(value: unknown): value is string {
  return typeof value === "string" && HASH_RE.test(value);
}

export type ParsedHashList =
  | { ok: true; hashes: string[] }
  | { ok: false; status: 400 | 413; error: string };

/** Validates a client-supplied hash array: shape, lowercase-hex, dedupes, max 2000. */
export function parseHashList(input: unknown): ParsedHashList {
  if (!Array.isArray(input)) return { ok: false, status: 400, error: "hashes must be an array" };
  if (input.length > MAX_CONTACT_HASHES) {
    return { ok: false, status: 413, error: `Send at most ${MAX_CONTACT_HASHES} contacts at a time.` };
  }
  const out = new Set<string>();
  for (const h of input) {
    if (!isValidContactHash(h)) return { ok: false, status: 400, error: "hashes must be SHA-256 hex digests" };
    out.add(h);
  }
  return { ok: true, hashes: [...out] };
}

/** Reduces matched rows to unique user ids, dropping self and blocked/excluded ids. Order preserved. */
export function resolveMatchedUserIds(
  rows: Array<{ userId: string }>,
  selfId: string,
  excluded: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const { userId } of rows) {
    if (userId === selfId || excluded.has(userId) || seen.has(userId)) continue;
    seen.add(userId);
    ids.push(userId);
  }
  return ids;
}

export function contactSyncEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(1|true|on|yes)$/i.test((env.CONTACT_SYNC_ENABLED ?? "").trim());
}
