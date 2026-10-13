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
  if (!Number.isSafeInteger(cents)) throw new Error('Money amount must be a safe integer number of cents.');
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100).toLocaleString('en-US');
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}$${whole}.${fraction}`;
}

/**
 * Display money the way the app says it (docs/VOICE.md): "$1,240" for whole
 * amounts, "$12.50" when there are cents. Input is integer cents. Use for
 * prices, totals and stats on screen; receipts and checkout line items keep
 * fmtCents so every line shows its cents and the sum visibly adds up.
 * @example formatMoney(124000) → "$1,240"   formatMoney(1250) → "$12.50"
 */
export function formatMoney(cents: number): string {
  const full = fmtCents(cents);
  return full.endsWith('.00') ? full.slice(0, -3) : full;
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

/**
 * Relative day the way the app says it (docs/VOICE.md): "now", "5m", "2h",
 * "Yesterday", "Mar 4", and "Mar 4, 2025" once it's a different year.
 * Hours within today (and the first 6 hours across midnight), then calendar
 * days. Future dates fall back to the short date.
 */
export function fmtRelativeDay(value: string | number | Date, now: number | Date = Date.now()): string {
  const d = new Date(value);
  const then = d.getTime();
  if (!Number.isFinite(then)) return '';
  const current = new Date(now);
  const diffMin = Math.floor((current.getTime() - then) / 60_000);
  if (diffMin >= 0 && diffMin < 1) return 'now';
  if (diffMin >= 1 && diffMin < 60) return `${diffMin}m`;
  const startOfToday = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  if (diffMin >= 60 && then >= startOfToday) return `${Math.floor(diffMin / 60)}h`;
  const startOfYesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1).getTime();
  if (diffMin >= 60 && then >= startOfYesterday) {
    // Just after midnight, a post from 11pm still reads "2h", not "Yesterday".
    return diffMin < 6 * 60 ? `${Math.floor(diffMin / 60)}h` : 'Yesterday';
  }
  const sameYear = d.getFullYear() === current.getFullYear();
  return d.toLocaleDateString('en-US', sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
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

// Human-readable compact counts ("1.2K", "4.8M") live in
// lib/compactFormat.ts's formatCompactCount — the one shared helper for
// follower/view/like counts and everything else in this family.

// ─── Names ──────────────────────────────────────────────────────────────────

/**
 * Derives avatar initials from the SAME display name shown next to the
 * avatar, so the two can never disagree (e.g. avatar showing "BT" while the
 * name text next to it reads something else entirely). Always pass the
 * exact string being rendered as the name — never a separate first/last
 * name pair that might be blank while the display name falls back to a
 * username or brand name.
 * @example getInitials('Your Brandthread store') → "YB"
 * @example getInitials('') → "?"
 */
export function getInitials(name: string | undefined | null, fallback = '?'): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return fallback;
  const initials = trimmed
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return initials || fallback;
}
