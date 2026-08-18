/**
 * Brandthread — shared formatting utilities
 *
 * Single source of truth for how the app displays:
 *   • Currency (dollar amounts)
 *   • Dates
 *   • Percentages
 *   • Compact numbers
 *
 * Import from here rather than using `.toFixed(2)`, `toLocaleString()`,
 * or ad-hoc string templates scattered across screens.
 */

// ─── Currency ──────────────────────────────────────────────────────────────────

const _currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const _currencyFmt0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format a dollar amount with 2 decimal places.
 * Input is dollars (not cents).
 * @example fmtCurrency(12.5) → "$12.50"
 */
export function fmtCurrency(dollars: number): string {
  return _currencyFmt.format(dollars);
}

/**
 * Format a dollar amount with no decimal places (for large rounded figures).
 * @example fmtCurrencyInt(1234) → "$1,234"
 */
export function fmtCurrencyInt(dollars: number): string {
  return _currencyFmt0.format(dollars);
}

/**
 * Convert cents to a formatted dollar string.
 * @example fmtCents(1250) → "$12.50"
 */
export function fmtCents(cents: number): string {
  return fmtCurrency(cents / 100);
}

// ─── Dates ────────────────────────────────────────────────────────────────────

/**
 * Short date: "Aug 18, 2026"
 * Use for order dates, created-at stamps.
 */
export function fmtDate(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Long date: "August 18, 2026"
 * Use for estimated ship dates, deadlines.
 */
export function fmtDateLong(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/**
 * Date + time: "Aug 18, 2026 at 3:42 PM"
 */
export function fmtDateTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${date} at ${time}`;
}

/**
 * Relative time: "2 hours ago", "3 days ago", "just now"
 */
export function fmtRelative(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD}d ago`;
  return fmtDate(d);
}

// ─── Percentages ──────────────────────────────────────────────────────────────

/**
 * Format a percentage with 1 decimal place.
 * @example fmtPercent(42.3) → "42.3%"
 */
export function fmtPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a percentage change with sign.
 * @example fmtChangePct(3.5) → "+3.5%"   fmtChangePct(-2) → "-2.0%"
 */
export function fmtChangePct(value: number, decimals = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

// ─── Compact numbers ──────────────────────────────────────────────────────────

/**
 * Compact integer with thousands separators.
 * @example fmtCount(12345) → "12,345"
 */
export function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * Human-readable compact: "1.2K", "4.8M"
 * Use for follower counts, view counts, etc.
 */
export function fmtCompact(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}
