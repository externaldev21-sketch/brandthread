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

// ─── Locale-aware formatting (device locale + time zone) ─────────────────────
//
// New code should prefer these over the fixed en-US helpers above. They
// follow the device's locale and time zone, so an en-US device sees exactly
// what the helpers above print (e.g. "$12.50", "Aug 18, 2026") while other
// regions get their own conventions. Formatters are cached per locale/options.

type DateInput = string | number | Date;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** The device locale as the JS engine resolves it (e.g. "en-US"), falling back to "en-US". */
export function getDeviceLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  } catch {
    return 'en-US';
  }
}

/** The device IANA time zone (e.g. "America/New_York"), or undefined when unknown. */
export function getDeviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

const numberFormatCache = new Map<string, Intl.NumberFormat>();
function currencyFormatter(currency: string, locale: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  let fmt = numberFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
    numberFormatCache.set(key, fmt);
  }
  return fmt;
}

/**
 * Formats an amount in MINOR units (cents for USD, yen for JPY) in its currency.
 * @example formatMoney(1250) → "$12.50" (en-US)   formatMoney(1250, 'EUR', 'de-DE') → "12,50 €"
 */
export function formatMoney(amountMinor: number, currency = 'USD', locale?: string): string {
  const code = (currency || 'USD').toUpperCase();
  try {
    const fmt = currencyFormatter(code, locale ?? getDeviceLocale());
    const digits = fmt.resolvedOptions().maximumFractionDigits ?? 2;
    return fmt.format(amountMinor / 10 ** digits);
  } catch {
    // Unknown currency code or no Intl support: plain, unambiguous fallback.
    const value = (amountMinor / 100).toFixed(2);
    return code === 'USD' ? `$${value}` : `${code} ${value}`;
  }
}

/** Formats an amount in MAJOR units (dollars, euros). Prefer formatMoney with integer minor units for money math. */
export function formatMoneyMajor(amount: number, currency = 'USD', locale?: string): string {
  const code = (currency || 'USD').toUpperCase();
  try {
    return currencyFormatter(code, locale ?? getDeviceLocale()).format(amount);
  } catch {
    return code === 'USD' ? `$${amount.toFixed(2)}` : `${code} ${amount.toFixed(2)}`;
  }
}

const dateFormatCache = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let fmt = dateFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, options);
    dateFormatCache.set(key, fmt);
  }
  return fmt;
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };

/**
 * Formats a date in the device locale and time zone. Defaults to a short date
 * ("Aug 18, 2026" on en-US); pass Intl options for other shapes. Returns ""
 * for an invalid date.
 */
export function formatDate(value: DateInput, options: Intl.DateTimeFormatOptions = SHORT_DATE, locale?: string): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const timeZone = options.timeZone ?? getDeviceTimeZone();
  try {
    return dateFormatter(locale ?? getDeviceLocale(), timeZone ? { ...options, timeZone } : options).format(d);
  } catch {
    return d.toDateString();
  }
}

/** Short date plus time ("Aug 18, 2026, 3:42 PM" on en-US) in the device locale and time zone. */
export function formatDateTime(value: DateInput, locale?: string): string {
  return formatDate(value, { ...SHORT_DATE, hour: 'numeric', minute: '2-digit' }, locale);
}

/**
 * Compact relative time ("5m ago", "3h ago", "2d ago" on en-US), then a short
 * date after a week. Uses Intl.RelativeTimeFormat when the engine has it.
 */
export function formatRelative(value: DateInput, now: number = Date.now(), locale?: string): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = Math.floor((now - d.getTime()) / 60_000);
  const loc = locale ?? getDeviceLocale();
  const Rtf = typeof Intl !== 'undefined' ? Intl.RelativeTimeFormat : undefined;
  const rel = (n: number, unit: Intl.RelativeTimeFormatUnit, fallback: string): string => {
    try {
      return Rtf ? new Rtf(loc, { style: 'narrow', numeric: 'always' }).format(-n, unit) : fallback;
    } catch {
      return fallback;
    }
  };
  if (diffMin < 1) {
    try {
      return Rtf ? new Rtf(loc, { numeric: 'auto' }).format(0, 'second') : 'just now';
    } catch {
      return 'just now';
    }
  }
  if (diffMin < 60) return rel(diffMin, 'minute', `${diffMin}m ago`);
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return rel(diffH, 'hour', `${diffH}h ago`);
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return rel(diffD, 'day', `${diffD}d ago`);
  return formatDate(d, SHORT_DATE, loc);
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
