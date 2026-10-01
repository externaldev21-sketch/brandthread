/**
 * Contact-sync hashing (pure). Address-book entries are normalized and hashed
 * ON DEVICE; only the hashes are ever sent to the server. The scheme MUST stay
 * byte-identical to artifacts/api-server/src/lib/contactHashes.ts (shared test
 * vectors in both suites):
 *   hash = SHA-256_hex( `bt:v1:${kind}:${normalized}` )
 *   email -> trimmed + lowercased; phone -> E.164
 */
export type ContactKind = 'email' | 'phone';
export type Sha256Hex = (input: string) => Promise<string>;

export const MAX_HASHES_PER_REQUEST = 2000;
/** Hard cap on hashes per sync (3 requests) so a huge address book cannot hammer the endpoint. */
export const MAX_HASHES_PER_SYNC = MAX_HASHES_PER_REQUEST * 3;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().toLowerCase();
  return v.length <= 254 && EMAIL_RE.test(v) ? v : null;
}

export function normalizePhone(raw: string | null | undefined, defaultCallingCode = '1'): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const hasPlus = v.startsWith('+');
  let digits = v.replace(/\D/g, '');
  if (!hasPlus && digits.startsWith('00')) digits = digits.slice(2);
  else if (!hasPlus) {
    digits = digits.replace(/^0+/, '');
    if (!(digits.startsWith(defaultCallingCode) && digits.length > 10)) digits = defaultCallingCode + digits;
  }
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

export interface ContactPoints { emails: string[]; phones: string[] }

/** Normalizes, dedupes and hashes contact points. Order: emails then phones. */
export async function hashContactPoints(
  points: ContactPoints,
  sha256Hex: Sha256Hex,
  defaultCallingCode = '1',
): Promise<string[]> {
  const emails = new Set<string>();
  for (const e of points.emails) { const n = normalizeEmail(e); if (n) emails.add(n); }
  const phones = new Set<string>();
  for (const p of points.phones) { const n = normalizePhone(p, defaultCallingCode); if (n) phones.add(n); }
  const inputs = [
    ...[...emails].map((v) => `bt:v1:email:${v}`),
    ...[...phones].map((v) => `bt:v1:phone:${v}`),
  ].slice(0, MAX_HASHES_PER_SYNC);
  const hashes = await Promise.all(inputs.map((i) => sha256Hex(i)));
  return [...new Set(hashes)];
}

export function chunkHashes(hashes: string[], size = MAX_HASHES_PER_REQUEST): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < hashes.length; i += size) out.push(hashes.slice(i, i + size));
  return out;
}

/** Hash of one phone number (for the optional "find me by phone" opt-in). */
export async function hashPhone(raw: string, sha256Hex: Sha256Hex, defaultCallingCode = '1'): Promise<string | null> {
  const n = normalizePhone(raw, defaultCallingCode);
  return n ? sha256Hex(`bt:v1:phone:${n}`) : null;
}
