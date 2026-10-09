/**
 * Pure helpers for the seller analytics report endpoints (product stats,
 * threads and videos, audience, goals, advanced, export). No DB / Express
 * imports so every rule here can be unit tested without a database.
 *
 * Ranges are the Dashboard's own pills — Today / Week / Month / Year / All —
 * and every window is anchored to the seller's LOCAL calendar (tz offset in
 * minutes east of UTC), reusing the same analyticsTime helpers as
 * GET /api/analytics/home so the two surfaces can never disagree on what
 * "today" or "this week" means.
 */
import crypto from "node:crypto";
import {
  DAY_MS,
  addLocalMonths,
  capEndAtNow,
  floorToLocalMonth,
  floorToLocalStep,
  floorToLocalWeek,
  floorToLocalYear,
  previousPeriod,
} from "./analyticsTime";

/** Smallest group of people a reported audience bucket may describe. */
export const K_ANONYMITY_MIN = 5;

export const INSIGHT_RANGES = ["today", "week", "month", "year", "all"] as const;
export type InsightRange = (typeof INSIGHT_RANGES)[number];
export type BucketStep = "1 hour" | "1 day" | "1 week" | "1 month";

export function parseInsightRange(raw: unknown): InsightRange {
  return typeof raw === "string" && (INSIGHT_RANGES as readonly string[]).includes(raw) ? (raw as InsightRange) : "today";
}

export interface RangeWindow {
  range: InsightRange;
  start: Date;
  end: Date;
  step: BucketStep;
  /** The immediately preceding period of the same length; null for "all". */
  previous: { start: Date; end: Date } | null;
}

const HOUR_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/**
 * [start, end) window for a range in the caller's local calendar, capped at
 * "now" so no future bucket is ever drawn — identical rules to /analytics/home:
 *  - today: local calendar day, hourly buckets
 *  - week:  Sunday-first calendar week, daily buckets
 *  - month: calendar month, daily buckets
 *  - year:  calendar year, monthly buckets
 *  - all:   from `anchor` (first order / account creation) to now; daily,
 *           weekly or monthly buckets depending on account age.
 */
export function rangeWindow(range: InsightRange, now: Date, tzOffsetMinutes: number, anchor?: Date | null): RangeWindow {
  const today = floorToLocalStep(now, DAY_MS, tzOffsetMinutes);
  const todayEnd = capEndAtNow(new Date(today.getTime() + DAY_MS), now, { stepMs: HOUR_MS, tzOffsetMinutes });
  const weekStart = floorToLocalWeek(now, tzOffsetMinutes);
  const weekEnd = capEndAtNow(new Date(weekStart.getTime() + WEEK_MS), now, { stepMs: DAY_MS, tzOffsetMinutes });
  const monthStart = floorToLocalMonth(now, tzOffsetMinutes);
  const currentMonthEnd = addLocalMonths(monthStart, 1, tzOffsetMinutes);
  const monthEnd = capEndAtNow(currentMonthEnd, now, { stepMs: DAY_MS, tzOffsetMinutes });
  const yearStart = floorToLocalYear(now, tzOffsetMinutes);
  const yearEnd = capEndAtNow(addLocalMonths(yearStart, 12, tzOffsetMinutes), now, { currentBucketEnd: currentMonthEnd, tzOffsetMinutes });

  let start: Date;
  let end: Date;
  let step: BucketStep;
  switch (range) {
    case "week": start = weekStart; end = weekEnd; step = "1 day"; break;
    case "month": start = monthStart; end = monthEnd; step = "1 day"; break;
    case "year": start = yearStart; end = yearEnd; step = "1 month"; break;
    case "all": {
      const from = anchor && anchor.getTime() < now.getTime() ? anchor : now;
      const ageDays = Math.max(0, (now.getTime() - from.getTime()) / DAY_MS);
      if (ageDays < 60) { start = floorToLocalStep(from, DAY_MS, tzOffsetMinutes); end = todayEnd; step = "1 day"; }
      else if (ageDays < 365) { start = floorToLocalWeek(from, tzOffsetMinutes); end = weekEnd; step = "1 week"; }
      else { start = floorToLocalMonth(from, tzOffsetMinutes); end = currentMonthEnd; step = "1 month"; }
      break;
    }
    default: start = today; end = todayEnd; step = "1 hour";
  }
  if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 1);
  return { range, start, end, step, previous: range === "all" ? null : previousPeriod(start, end) };
}

/** Percentage change vs the previous period, one decimal; null when there is no previous figure to compare against. */
export function deltaPct(current: number, previous: number | null | undefined): number | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous) || !Number.isFinite(current)) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Percentage rounded to one decimal; null when the denominator is 0. Never above 100. */
export function conversionPct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  const pct = (Math.max(0, numerator) / denominator) * 100;
  return Math.round(Math.min(100, pct) * 10) / 10;
}

export interface FunnelCounts { views: number; addToCarts: number; purchases: number }

export function funnelRates(c: FunnelCounts) {
  return {
    viewToCartPct: conversionPct(c.addToCarts, c.views),
    cartToPurchasePct: conversionPct(c.purchases, c.addToCarts),
    viewToPurchasePct: conversionPct(c.purchases, c.views),
  };
}

/**
 * k-anonymity: drop any bucket describing fewer than `k` distinct people.
 * Returns the kept buckets plus how many were hidden (counts only, never the
 * hidden buckets' labels or sizes).
 */
export function applyKAnonymity<T extends { people: number }>(buckets: T[], k = K_ANONYMITY_MIN): { shown: T[]; hiddenBuckets: number } {
  const shown = buckets.filter((b) => b.people >= k);
  return { shown, hiddenBuckets: buckets.length - shown.length };
}

/** Normalises a shipping address into a location label, or null if unusable. */
export function locationLabel(addr: { country?: unknown; state?: unknown } | null | undefined): { country: string; region: string | null } | null {
  const country = typeof addr?.country === "string" ? addr.country.trim().toUpperCase() : "";
  if (!country || country.length > 56) return null;
  const regionRaw = typeof addr?.state === "string" ? addr.state.trim().toUpperCase() : "";
  return { country, region: regionRaw && regionRaw.length <= 56 ? regionRaw : null };
}

// ── Devices ──────────────────────────────────────────────────────────────────

export const DEVICES = ["ios", "android", "web"] as const;
export type Device = (typeof DEVICES)[number];

/** The client-declared device when valid, else a User-Agent sniff, else null. */
export function resolveDevice(declared: unknown, userAgent: unknown): Device | null {
  if (typeof declared === "string" && (DEVICES as readonly string[]).includes(declared)) return declared as Device;
  if (typeof userAgent !== "string" || !userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod|cfnetwork|darwin/.test(ua) && !/android/.test(ua)) return "ios";
  if (/android|okhttp/.test(ua)) return "android";
  if (/mozilla|chrome|safari|firefox|edg/.test(ua)) return "web";
  return null;
}

// ── Goals ────────────────────────────────────────────────────────────────────

export const GOAL_METRICS = ["revenue", "orders", "visits", "followers", "units"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
export const GOAL_PERIODS = ["week", "month", "quarter", "year"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

/** Local calendar window [start, end) of the period containing `now`. */
export function goalWindow(period: GoalPeriod, now: Date, tzOffsetMinutes: number): { start: Date; end: Date } {
  if (period === "week") {
    const start = floorToLocalWeek(now, tzOffsetMinutes);
    return { start, end: new Date(start.getTime() + WEEK_MS) };
  }
  if (period === "year") {
    const start = floorToLocalYear(now, tzOffsetMinutes);
    return { start, end: addLocalMonths(start, 12, tzOffsetMinutes) };
  }
  const monthStart = floorToLocalMonth(now, tzOffsetMinutes);
  if (period === "quarter") {
    const local = new Date(monthStart.getTime() + tzOffsetMinutes * 60_000);
    const quarterStartMonth = Math.floor(local.getUTCMonth() / 3) * 3;
    const start = addLocalMonths(monthStart, quarterStartMonth - local.getUTCMonth(), tzOffsetMinutes);
    return { start, end: addLocalMonths(start, 3, tzOffsetMinutes) };
  }
  return { start: monthStart, end: addLocalMonths(monthStart, 1, tzOffsetMinutes) };
}

/** Kept for callers that still think in months (export of legacy goals). */
export function monthWindow(now: Date, tzOffsetMinutes: number) {
  const { start, end } = goalWindow("month", now, tzOffsetMinutes);
  return { start, end, daysInMonth: Math.round((end.getTime() - start.getTime()) / DAY_MS) };
}

export interface GoalPacing {
  progressPct: number;
  remaining: number;
  expectedToDate: number;
  projected: number | null;
  projectedPct: number | null;
  daysLeft: number;
  status: "achieved" | "on_track" | "behind" | "not_started";
}

/**
 * Pace projection: straight-line extrapolation of period-to-date actual over
 * the elapsed fraction of the period. Before any time has elapsed there is no
 * projection.
 */
export function goalPacing(actual: number, target: number, now: Date, window: { start: Date; end: Date }): GoalPacing {
  const total = window.end.getTime() - window.start.getTime();
  const elapsed = Math.min(total, Math.max(0, now.getTime() - window.start.getTime()));
  const frac = total > 0 ? elapsed / total : 0;
  const progressPct = target > 0 ? Math.round((actual / target) * 1000) / 10 : 0;
  const expectedToDate = Math.round(target * frac);
  const projected = frac > 0 ? Math.round(actual / frac) : null;
  const projectedPct = projected !== null && target > 0 ? Math.round((projected / target) * 1000) / 10 : null;
  const daysLeft = Math.max(0, Math.ceil((window.end.getTime() - now.getTime()) / DAY_MS));
  let status: GoalPacing["status"];
  if (actual >= target) status = "achieved";
  else if (frac === 0 || (actual === 0 && elapsed < DAY_MS)) status = "not_started";
  else status = projected !== null && projected >= target ? "on_track" : "behind";
  return { progressPct, remaining: Math.max(0, target - actual), expectedToDate, projected, projectedPct, daysLeft, status };
}

// ── Hashing ──────────────────────────────────────────────────────────────────

/** Per-seller salted viewer hash: stable for one seller, uncorrelatable across sellers. */
export function viewerKeyFor(sellerId: string, userId: string): string {
  return crypto.createHash("sha256").update(`bt-seller-analytics:${sellerId}:${userId}`).digest("hex");
}

// ── Export rendering ─────────────────────────────────────────────────────────

export interface ExportTable {
  title: string;
  fields: string[];
  headers: string[];
  rows: Record<string, unknown>[];
  note?: string;
}

/** Human label for a range, used in export headers and filenames. */
export function rangeLabel(range: InsightRange): string {
  return { today: "Today", week: "This week", month: "This month", year: "This year", all: "All time" }[range];
}
