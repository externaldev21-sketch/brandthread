import { formatCents } from '@/lib/money';

/** Scales a positive magnitude to a K/M/B suffix, e.g. 12_400 -> "12.4K". */
function scaleWithSuffix(magnitude: number): string {
  const units: Array<[number, string]> = [[1_000_000_000, 'B'], [1_000_000, 'M'], [1_000, 'K']];
  for (const [threshold, suffix] of units) {
    if (magnitude >= threshold) {
      const scaled = magnitude / threshold;
      const digits = scaled >= 100 ? 0 : 1;
      return `${scaled.toFixed(digits)}${suffix}`;
    }
  }
  return String(Math.round(magnitude));
}

/**
 * Compact currency for a big, bold dashboard number that must never truncate:
 * under $1,000 shows the exact amount ($842.00); at or above it, a compact
 * form ($12.4K, $1.2M). Pair with the exact value (formatCents) for a
 * long-press/tap reveal.
 */
export function formatCentsCompact(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const dollars = Math.abs(cents) / 100;
  if (dollars < 1000) return formatCents(cents);
  return `${sign}$${scaleWithSuffix(dollars)}`;
}

/**
 * One decimal place, scaled by threshold, with its suffix — but only when
 * the rounded result still fits under 1000 in that unit (e.g. 999.95K must
 * not render as "1000.0K"); returns null to signal the caller should retry
 * one unit up instead.
 */
function tryScale(magnitude: number, threshold: number, suffix: string): string | null {
  const fixed = (magnitude / threshold).toFixed(1);
  if (parseFloat(fixed) >= 1000) return null;
  return `${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}${suffix}`;
}

/**
 * Instagram/TikTok-style compact count, guaranteed to never overflow a
 * fixed-width stat cell: exact value with commas under 10,000, then K/M/B
 * with at most one decimal (trailing .0 dropped). A value whose rounded K
 * (or M) form would hit 1000 promotes to the next unit instead of showing
 * e.g. "1000.0K" (see formatCompactCount.test.ts for the exact edge cases).
 * This is the single source of truth for every count in the app — likes,
 * comments, shares, view/viewer counts, and follower/following/post totals.
 */
export function formatCompactCount(value: number | null | undefined): string {
  const sign = Number(value) < 0 ? '-' : '';
  const magnitude = Math.max(0, Math.floor(Math.abs(Number(value) || 0)));
  if (magnitude < 10_000) return `${sign}${magnitude.toLocaleString('en-US')}`;
  const scaled = magnitude < 1_000_000
    ? tryScale(magnitude, 1_000, 'K') ?? tryScale(magnitude, 1_000_000, 'M') ?? tryScale(magnitude, 1_000_000_000, 'B')
    : magnitude < 1_000_000_000
      ? tryScale(magnitude, 1_000_000, 'M') ?? tryScale(magnitude, 1_000_000_000, 'B')
      : tryScale(magnitude, 1_000_000_000, 'B');
  return `${sign}${scaled ?? String(magnitude)}`;
}
