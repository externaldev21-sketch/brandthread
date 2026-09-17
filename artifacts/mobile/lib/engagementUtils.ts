/**
 * Pure engagement utility functions — no React Native dependency.
 * Extracted so they can be unit-tested in a Node vitest environment.
 */

/**
 * Formats a raw count into a compact display string.
 * - < 1000: exact number ("42")
 * - 1000–999999: "X.XK" or "XK" ("1.5K", "10K")
 * - ≥ 1000000: "X.XM"
 */
export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 >= 100 ? 1 : 0)}K`;
  return String(n);
}

/** UUID v4 detector used to guard API calls against non-UUID local IDs. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUUID(id: string): boolean {
  return UUID_RE.test(id);
}
