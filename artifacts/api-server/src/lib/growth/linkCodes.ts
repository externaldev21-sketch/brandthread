import crypto from "node:crypto";

/** Lowercase, no look-alikes (no 0/o/1/i/l). 31 symbols. */
export const LINK_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const LINK_CODE_LENGTH = 8;

const CODE_RE = /^[abcdefghjkmnpqrstuvwxyz23456789]{6,12}$/;

export function generateLinkCode(
  length = LINK_CODE_LENGTH,
  randomInt: (max: number) => number = (max) => crypto.randomInt(max),
): string {
  let out = "";
  for (let i = 0; i < length; i++) out += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  return out;
}

/** Normalise user/URL input to the stored form, or null when it cannot be a code. */
export function normalizeLinkCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return CODE_RE.test(code) ? code : null;
}

/**
 * Generate a code that `isTaken` reports free. Collisions are astronomically
 * unlikely (31^8), but the DB unique index is the real guarantee; callers also
 * retry on a unique violation.
 */
export async function generateUniqueLinkCode(
  isTaken: (code: string) => Promise<boolean>,
  maxAttempts = 8,
  gen: () => string = () => generateLinkCode(),
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const code = gen();
    if (!(await isTaken(code))) return code;
  }
  // Extremely unlikely: widen the code so the next attempt cannot collide with short ones.
  return generateLinkCode(LINK_CODE_LENGTH + 2);
}
