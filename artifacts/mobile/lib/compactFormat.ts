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

/** Compact plain count (orders, visitors): 8_400 -> "8.4K". */
export function formatCompactCount(value: number): string {
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  if (magnitude < 1000) return `${sign}${Math.round(magnitude)}`;
  return `${sign}${scaleWithSuffix(magnitude)}`;
}
