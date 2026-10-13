/**
 * Pure helpers for GET /api/seller/morning-brief: the seller's local calendar
 * day from an IANA time zone, and the one-suggestion priority rule. No DB or
 * Express imports, so the day-boundary math and the priority order are unit
 * tested without a database.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/** An unshipped paid order becomes a suggestion once it has waited this long. */
export const SHIP_SUGGESTION_AFTER_MS = 2 * DAY_MS;
/** Look-back window for "sold N in the last 30 days" and best sellers. */
export const SALES_WINDOW_DAYS = 30;
/** A best seller with this many or fewer left always counts as low, whatever its threshold. */
export const DEFAULT_LOW_STOCK_LEFT = 3;

/**
 * Returns `raw` when it is a time zone this runtime understands, else "UTC".
 * The same check guards every later `Intl` call, so a bad `?tz=` can never
 * throw inside the route.
 */
export function resolveTimeZone(raw: unknown): string {
  if (typeof raw !== "string") return "UTC";
  const tz = raw.trim();
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") % 24, minute: get("minute"), second: get("second") };
}

/** Milliseconds the zone is ahead of UTC at instant `at`. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The seller-local calendar date at `at`, as YYYY-MM-DD. */
export function localDateString(at: Date, timeZone: string): string {
  const p = localParts(at, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Shifts a YYYY-MM-DD date by whole calendar days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/**
 * The UTC instant of local midnight on `date` in `timeZone`. Two passes so a
 * DST change between UTC midnight and local midnight still lands exactly.
 */
export function zonedMidnightUtc(date: string, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let guess = wall - zoneOffsetMs(new Date(wall), timeZone);
  guess = wall - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** Seller-local today plus the UTC window [start, end) of seller-local yesterday. */
export function briefWindow(now: Date, timeZone: string): { date: string; yesterdayStart: Date; yesterdayEnd: Date } {
  const date = localDateString(now, timeZone);
  return {
    date,
    yesterdayStart: zonedMidnightUtc(addDays(date, -1), timeZone),
    yesterdayEnd: zonedMidnightUtc(date, timeZone),
  };
}

export type SuggestionKind = "restock" | "ship" | "low_stock";

export interface MorningBriefSuggestion {
  kind: SuggestionKind;
  title: string;
  detail: string;
  target: { type: "product" | "order"; id: string };
}

export interface SoldOutCandidate { productId: string; name: string; unitsSold30d: number }
export interface LateOrderCandidate { orderId: string; orderNumber: string; paidAt: Date }
export interface LowStockCandidate { productId: string; name: string; unitsSold30d: number; stockLeft: number; threshold: number }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Picks the ONE suggestion, in priority order:
 *  1. a sold-out active product that still sold in the last 30 days (most units first);
 *  2. the oldest paid order waiting more than two days to ship;
 *  3. a best seller (last 30 days) at or below its low-stock threshold, or at
 *     most three left.
 * Callers pass candidates already filtered to this seller; this only ranks.
 */
export function pickSuggestion(input: {
  now: Date;
  soldOut: SoldOutCandidate[];
  lateOrders: LateOrderCandidate[];
  lowStock: LowStockCandidate[];
}): MorningBriefSuggestion | null {
  const soldOut = input.soldOut
    .filter((p) => p.unitsSold30d > 0)
    .sort((a, b) => b.unitsSold30d - a.unitsSold30d)[0];
  if (soldOut) {
    return {
      kind: "restock",
      title: `Restock ${soldOut.name}`,
      detail: `Sold out. It sold ${soldOut.unitsSold30d} in the last 30 days.`,
      target: { type: "product", id: soldOut.productId },
    };
  }

  const late = input.lateOrders
    .filter((o) => input.now.getTime() - o.paidAt.getTime() > SHIP_SUGGESTION_AFTER_MS)
    .sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())[0];
  if (late) {
    const days = Math.floor((input.now.getTime() - late.paidAt.getTime()) / DAY_MS);
    return {
      kind: "ship",
      title: `Ship ${late.orderNumber}`,
      detail: `${plural(days, "day")} waiting.`,
      target: { type: "order", id: late.orderId },
    };
  }

  const low = input.lowStock
    .filter((p) => p.unitsSold30d > 0 && p.stockLeft > 0 && p.stockLeft <= Math.max(p.threshold, DEFAULT_LOW_STOCK_LEFT))
    .sort((a, b) => b.unitsSold30d - a.unitsSold30d)[0];
  if (low) {
    return {
      kind: "low_stock",
      title: `${low.name} has ${low.stockLeft} left`,
      detail: `It sold ${low.unitsSold30d} in the last 30 days.`,
      target: { type: "product", id: low.productId },
    };
  }

  return null;
}
