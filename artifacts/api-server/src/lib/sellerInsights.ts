/**
 * Pure helpers for the seller insights endpoints (product funnel, audience,
 * best time to post, goals, export). No DB / Express imports so every rule here
 * can be unit tested without a database.
 */
import crypto from "node:crypto";
import { DAY_MS } from "./analyticsTime";

/** Smallest group of people a reported audience bucket may describe. */
export const K_ANONYMITY_MIN = 5;

export const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type InsightRange = keyof typeof RANGE_DAYS;

export function parseInsightRange(raw: unknown): InsightRange {
  return typeof raw === "string" && raw in RANGE_DAYS ? (raw as InsightRange) : "30d";
}

/**
 * [start, end) window covering the last `days` LOCAL calendar days including
 * today (today is partial), aligned to local midnight in the caller's tz.
 */
export function rangeWindow(range: InsightRange, now: Date, tzOffsetMinutes: number): { start: Date; end: Date } {
  const days = RANGE_DAYS[range];
  const localMs = now.getTime() + tzOffsetMinutes * 60_000;
  const localMidnight = Math.floor(localMs / DAY_MS) * DAY_MS;
  const start = new Date(localMidnight - (days - 1) * DAY_MS - tzOffsetMinutes * 60_000);
  return { start, end: new Date(now.getTime() + 1) };
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

// ── Best time to post ────────────────────────────────────────────────────────

export type HeatGrid = number[][]; // [dayOfWeek 0=Sun..6][hour 0..23]

export function emptyGrid(): HeatGrid {
  return Array.from({ length: 7 }, () => Array<number>(24).fill(0));
}

/** Buckets UTC timestamps into local day-of-week x hour counts. */
export function buildHeatmap(timestamps: Iterable<Date>, tzOffsetMinutes: number): HeatGrid {
  const grid = emptyGrid();
  for (const ts of timestamps) {
    const local = new Date(ts.getTime() + tzOffsetMinutes * 60_000);
    grid[local.getUTCDay()][local.getUTCHours()] += 1;
  }
  return grid;
}

export interface Slot { day: number; hour: number; count: number }

/** Below this many total engagement events no slot is recommended. */
export const MIN_EVENTS_FOR_RECOMMENDATION = 30;

/**
 * Top N day/hour slots by engagement. Ties break toward the earlier day then
 * hour so the result is deterministic. Returns [] when the sample is too small
 * to say anything honest.
 */
export function rankSlots(grid: HeatGrid, n = 3, minTotal = MIN_EVENTS_FOR_RECOMMENDATION): Slot[] {
  const slots: Slot[] = [];
  let total = 0;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const count = grid[d]?.[h] ?? 0;
    total += count;
    if (count > 0) slots.push({ day: d, hour: h, count });
  }
  if (total < minTotal) return [];
  slots.sort((a, b) => b.count - a.count || a.day - b.day || a.hour - b.hour);
  return slots.slice(0, n);
}

// ── Goals ────────────────────────────────────────────────────────────────────

export const GOAL_METRICS = ["revenue", "orders"] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];

/** Local calendar month [start, end) containing `now`, plus its length in days. */
export function monthWindow(now: Date, tzOffsetMinutes: number) {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1) - tzOffsetMinutes * 60_000);
  const end = new Date(Date.UTC(y, m + 1, 1) - tzOffsetMinutes * 60_000);
  return { start, end, daysInMonth: Math.round((end.getTime() - start.getTime()) / DAY_MS) };
}

export interface GoalPacing {
  progressPct: number;
  remaining: number;
  expectedToDate: number;
  projected: number | null;
  projectedPct: number | null;
  status: "achieved" | "on_track" | "behind" | "not_started";
}

/**
 * Pace projection: straight-line extrapolation of month-to-date actual over the
 * elapsed fraction of the month. Before any time has elapsed there is no
 * projection.
 */
export function goalPacing(actual: number, target: number, now: Date, month: { start: Date; end: Date }): GoalPacing {
  const total = month.end.getTime() - month.start.getTime();
  const elapsed = Math.min(total, Math.max(0, now.getTime() - month.start.getTime()));
  const frac = total > 0 ? elapsed / total : 0;
  const progressPct = target > 0 ? Math.round((actual / target) * 1000) / 10 : 0;
  const expectedToDate = Math.round(target * frac);
  const projected = frac > 0 ? Math.round(actual / frac) : null;
  const projectedPct = projected !== null && target > 0 ? Math.round((projected / target) * 1000) / 10 : null;
  let status: GoalPacing["status"];
  if (actual >= target) status = "achieved";
  else if (frac === 0 || (actual === 0 && elapsed < DAY_MS)) status = "not_started";
  else status = projected !== null && projected >= target ? "on_track" : "behind";
  return { progressPct, remaining: Math.max(0, target - actual), expectedToDate, projected, projectedPct, status };
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
