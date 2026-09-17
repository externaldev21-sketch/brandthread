/**
 * Canonical profile URL helpers for Brandthread profile sharing.
 *
 * Public production origin: https://brandthread.app
 * Canonical profile URL:    https://brandthread.app/u/{normalizedUsername}
 *
 * Rules:
 * - Normalize username to lowercase alphanumeric + underscores only.
 * - Minimum 3 chars, maximum 30 chars.
 * - Never fabricate URLs from display names, Clerk IDs, or fallback slugs.
 * - A missing / invalid username returns null — callers must gate on this.
 */

export const BRANDTHREAD_ORIGIN = 'https://brandthread.app';

/**
 * Normalise a raw username string coming from the server:
 * lowercase, strip any characters that are not [a-z0-9_].
 * Returns the normalised form, or null if the result fails validation.
 */
export function normalizeUsername(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (normalized.length < 3 || normalized.length > 30) return null;
  return normalized;
}

/**
 * Build the exact canonical profile URL.
 * Returns null when username is missing or invalid — never returns a guessed URL.
 */
export function buildCanonicalProfileUrl(rawUsername: string | null | undefined): string | null {
  const username = normalizeUsername(rawUsername);
  if (!username) return null;
  return `${BRANDTHREAD_ORIGIN}/u/${username}`;
}

/**
 * Validate that a normalized username string meets the format requirements.
 * 3–30 chars, letters, digits, underscores only.
 */
export function isValidNormalizedUsername(username: string): boolean {
  return /^[a-z0-9_]{3,30}$/.test(username);
}
