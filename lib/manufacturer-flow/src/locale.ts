/**
 * Currency, country and time-zone helpers for an international supply side.
 *
 * Money moves in US dollars (the platform's Stripe settlement currency);
 * Stripe converts to the manufacturer's bank currency at payout. The UI always
 * labels amounts with an explicit currency code so nobody mistakes "$" for
 * their local dollar.
 */

export const SETTLEMENT_CURRENCY = "USD";

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "PYG", "UGX", "XAF", "XOF"]);

export function minorUnitDivisor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100;
}

/**
 * Formats integer minor units. `US$1,250.00` for USD so the currency is
 * unambiguous for international readers.
 */
export function formatMoney(minorUnits: number, currency: string = SETTLEMENT_CURRENCY, locale = "en-US"): string {
  const code = currency.toUpperCase();
  const value = minorUnits / minorUnitDivisor(code);
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "symbol",
    }).format(value);
    // en-US renders USD as a bare "$"; make it explicit.
    return code === "USD" && formatted.startsWith("$") ? `US${formatted}` : formatted;
  } catch {
    return `${code} ${value.toFixed(minorUnitDivisor(code) === 1 ? 0 : 2)}`;
  }
}

export type CountryInfo = { name: string; code: string; currency: string; timeZone: string };

/** Major apparel-manufacturing countries plus key buyer markets. */
export const COUNTRIES: readonly CountryInfo[] = [
  { name: "Bangladesh", code: "BD", currency: "BDT", timeZone: "Asia/Dhaka" },
  { name: "Cambodia", code: "KH", currency: "KHR", timeZone: "Asia/Phnom_Penh" },
  { name: "China", code: "CN", currency: "CNY", timeZone: "Asia/Shanghai" },
  { name: "Hong Kong", code: "HK", currency: "HKD", timeZone: "Asia/Hong_Kong" },
  { name: "India", code: "IN", currency: "INR", timeZone: "Asia/Kolkata" },
  { name: "Indonesia", code: "ID", currency: "IDR", timeZone: "Asia/Jakarta" },
  { name: "Japan", code: "JP", currency: "JPY", timeZone: "Asia/Tokyo" },
  { name: "Malaysia", code: "MY", currency: "MYR", timeZone: "Asia/Kuala_Lumpur" },
  { name: "Myanmar", code: "MM", currency: "MMK", timeZone: "Asia/Yangon" },
  { name: "Pakistan", code: "PK", currency: "PKR", timeZone: "Asia/Karachi" },
  { name: "Philippines", code: "PH", currency: "PHP", timeZone: "Asia/Manila" },
  { name: "South Korea", code: "KR", currency: "KRW", timeZone: "Asia/Seoul" },
  { name: "Sri Lanka", code: "LK", currency: "LKR", timeZone: "Asia/Colombo" },
  { name: "Taiwan", code: "TW", currency: "TWD", timeZone: "Asia/Taipei" },
  { name: "Thailand", code: "TH", currency: "THB", timeZone: "Asia/Bangkok" },
  { name: "Vietnam", code: "VN", currency: "VND", timeZone: "Asia/Ho_Chi_Minh" },
  { name: "Turkey", code: "TR", currency: "TRY", timeZone: "Europe/Istanbul" },
  { name: "Portugal", code: "PT", currency: "EUR", timeZone: "Europe/Lisbon" },
  { name: "Italy", code: "IT", currency: "EUR", timeZone: "Europe/Rome" },
  { name: "Spain", code: "ES", currency: "EUR", timeZone: "Europe/Madrid" },
  { name: "France", code: "FR", currency: "EUR", timeZone: "Europe/Paris" },
  { name: "Germany", code: "DE", currency: "EUR", timeZone: "Europe/Berlin" },
  { name: "Poland", code: "PL", currency: "PLN", timeZone: "Europe/Warsaw" },
  { name: "Romania", code: "RO", currency: "RON", timeZone: "Europe/Bucharest" },
  { name: "Bulgaria", code: "BG", currency: "BGN", timeZone: "Europe/Sofia" },
  { name: "United Kingdom", code: "GB", currency: "GBP", timeZone: "Europe/London" },
  { name: "Morocco", code: "MA", currency: "MAD", timeZone: "Africa/Casablanca" },
  { name: "Tunisia", code: "TN", currency: "TND", timeZone: "Africa/Tunis" },
  { name: "Egypt", code: "EG", currency: "EGP", timeZone: "Africa/Cairo" },
  { name: "Ethiopia", code: "ET", currency: "ETB", timeZone: "Africa/Addis_Ababa" },
  { name: "Kenya", code: "KE", currency: "KES", timeZone: "Africa/Nairobi" },
  { name: "South Africa", code: "ZA", currency: "ZAR", timeZone: "Africa/Johannesburg" },
  { name: "Mexico", code: "MX", currency: "MXN", timeZone: "America/Mexico_City" },
  { name: "Guatemala", code: "GT", currency: "GTQ", timeZone: "America/Guatemala" },
  { name: "Honduras", code: "HN", currency: "HNL", timeZone: "America/Tegucigalpa" },
  { name: "Colombia", code: "CO", currency: "COP", timeZone: "America/Bogota" },
  { name: "Peru", code: "PE", currency: "PEN", timeZone: "America/Lima" },
  { name: "Brazil", code: "BR", currency: "BRL", timeZone: "America/Sao_Paulo" },
  { name: "United States", code: "US", currency: "USD", timeZone: "America/Los_Angeles" },
  { name: "Canada", code: "CA", currency: "CAD", timeZone: "America/Toronto" },
  { name: "Australia", code: "AU", currency: "AUD", timeZone: "Australia/Sydney" },
];

export function findCountry(value: string | null | undefined): CountryInfo | null {
  if (!value) return null;
  const needle = value.trim().toLowerCase();
  return COUNTRIES.find((country) => country.name.toLowerCase() === needle || country.code.toLowerCase() === needle) ?? null;
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** "GMT+7", "GMT-5", "GMT+5:30" for a zone at a given instant. */
export function timeZoneOffsetLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** "3:42 PM" in the given zone. */
export function localClock(timeZone: string, at: Date = new Date(), locale = "en-US"): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(at);
  } catch {
    return "";
  }
}

/** "Their time: 3:42 PM (GMT+7)" style label used in chat headers and profiles. */
export function localTimeLabel(timeZone: string | null | undefined, at: Date = new Date()): string | null {
  if (!isValidTimeZone(timeZone)) return null;
  return `${localClock(timeZone, at)} local time (${timeZoneOffsetLabel(timeZone, at)})`;
}

/** Hours between two zones at an instant; positive when `other` is ahead. */
export function hoursAhead(viewerTimeZone: string, otherTimeZone: string, at: Date = new Date()): number | null {
  if (!isValidTimeZone(viewerTimeZone) || !isValidTimeZone(otherTimeZone)) return null;
  const offsetMinutes = (tz: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
  };
  return (offsetMinutes(otherTimeZone) - offsetMinutes(viewerTimeZone)) / 60;
}

/** Whether it is a reasonable hour (8am–8pm) to expect a reply in a zone. */
export function isWorkingHours(timeZone: string, at: Date = new Date()): boolean {
  try {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(at));
    return hour >= 8 && hour < 20;
  } catch {
    return true;
  }
}

/**
 * Tracker timestamp: "Sep 22, 3:42 PM GMT+7" in the viewer's zone (or an
 * explicit zone), always with the offset so both sides read the same instant.
 */
export function formatTimestamp(value: string | Date, options: { timeZone?: string; locale?: string } = {}): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const timeZone = options.timeZone && isValidTimeZone(options.timeZone) ? options.timeZone : undefined;
  const base: Intl.DateTimeFormatOptions = { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  // Older mobile ICU builds (Hermes on some Android versions) lack "shortOffset".
  for (const timeZoneName of ["shortOffset", "short", undefined] as const) {
    try {
      return new Intl.DateTimeFormat(options.locale ?? "en-US", { ...base, ...(timeZoneName ? { timeZoneName } : {}) }).format(date);
    } catch { /* try the next, simpler format */ }
  }
  return date.toISOString();
}
