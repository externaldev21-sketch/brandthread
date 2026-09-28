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

/**
 * Diffs a count's formatted display strings for TickingCount's odometer
 * roll (components/ui/TickingCount.tsx) — split out here, alongside
 * formatCount, so it's unit-testable without a react-native import.
 *
 * - 'none': the formatted string didn't change — no animation.
 * - 'chars': same length before/after — a per-character diff, so only the
 *   characters that actually differ roll (the ordinary "+1/-1 on a
 *   small-to-medium number" case — "1,203" -> "1,204", "12.3K" -> "12.4K").
 * - 'whole': length changed (a threshold crossed, e.g. "999" -> "1,000",
 *   or the blank/non-blank edge at 0) — the whole label rolls as one unit,
 *   since there's no shared column to diff per character against.
 */
export type CountDiff =
  | { kind: 'none'; text: string }
  | { kind: 'chars'; text: string; prevText: string; direction: 1 | -1; diffs: boolean[] }
  | { kind: 'whole'; text: string; prevText: string; direction: 1 | -1 };

export function diffCount(value: number, prevValue: number): CountDiff {
  const text = formatCount(value);
  const prevText = formatCount(prevValue);
  if (text === prevText) return { kind: 'none', text };
  const direction: 1 | -1 = value >= prevValue ? 1 : -1;
  if (text.length !== prevText.length) return { kind: 'whole', text, prevText, direction };
  const diffs = text.split('').map((c, i) => c !== prevText[i]);
  return { kind: 'chars', text, prevText, direction, diffs };
}

/** UUID v4 detector used to guard API calls against non-UUID local IDs. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUUID(id: string): boolean {
  return UUID_RE.test(id);
}
