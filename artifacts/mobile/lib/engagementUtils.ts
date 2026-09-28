/**
 * Pure engagement utility functions — no React Native dependency.
 * Extracted so they can be unit-tested in a Node vitest environment.
 */

/**
 * Formats a raw count into a compact, Instagram/TikTok-style display string.
 * - 0 (or negative/non-finite): "" — callers keep the count label mounted
 *   with its normal layout space, just with nothing visible in it, so
 *   nothing shifts when a count goes from >0 back to 0.
 * - < 1000: exact number ("42", "999")
 * - 1000–9999: comma-grouped, exact ("1,203", "9,900")
 * - 10000–999999: "X.XK" / "XK", truncated (not rounded) to one decimal —
 *   "12.4K" stays "12.4K" rather than rounding up to "12.5K", matching how
 *   IG/TikTok counters read.
 * - ≥ 1000000: "X.XM" / "XM", same truncation.
 */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1_000) return String(Math.trunc(n));
  if (n < 10_000) return Math.trunc(n).toLocaleString('en-US');
  const unit = n < 1_000_000 ? 1_000 : 1_000_000;
  const suffix = n < 1_000_000 ? 'K' : 'M';
  const truncated = Math.floor((n / unit) * 10) / 10;
  const formatted = Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(1);
  return `${formatted}${suffix}`;
}

/** UUID v4 detector used to guard API calls against non-UUID local IDs. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUUID(id: string): boolean {
  return UUID_RE.test(id);
}
