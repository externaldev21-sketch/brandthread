/**
 * Weekly seller summary — timing and numbers. Sent Monday between 9 and 10am
 * in the seller's own time zone (users.quiet_hours_timezone, UTC if unset),
 * once per ISO week. Numbers cover the 7 days before the send.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { WeeklySummary } from "./emails";

function localParts(now: Date, timeZone: string): { weekday: string; hour: number; year: number; month: number; day: number } {
  let tz = timeZone;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { tz = "UTC"; }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: get("weekday"), hour: Number(get("hour")), year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}

/** Monday, 9:00–9:59 local. */
export function isWeeklySummaryHour(now: Date, timeZone: string | null | undefined): boolean {
  const p = localParts(now, timeZone || "UTC");
  return p.weekday === "Mon" && p.hour === 9;
}

/** ISO week of the seller's local date, e.g. 2026-W42. */
export function isoWeekKey(now: Date, timeZone: string | null | undefined): string {
  const p = localParts(now, timeZone || "UTC");
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNum = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function weekLabel(now: Date): string {
  const start = new Date(now.getTime() - 7 * 86_400_000);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${fmt(start)} – ${fmt(new Date(now.getTime() - 86_400_000))}`;
}

function rowsOf<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? []) as T[];
}

export async function buildWeeklySummary(sellerId: string, now: Date): Promise<WeeklySummary> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [sales] = rowsOf<{ orders: number; cents: number }>(await db.execute(sql`
    SELECT count(*)::int AS orders, coalesce(sum(total_cents - refunded_cents), 0)::int AS cents
    FROM orders
    WHERE owner_id = ${sellerId} AND paid_at >= ${since} AND paid_at < ${now} AND status <> 'cancelled'
  `));
  const [toShip] = rowsOf<{ n: number }>(await db.execute(sql`
    SELECT count(*)::int AS n FROM orders
    WHERE owner_id = ${sellerId} AND paid_at IS NOT NULL AND status IN ('pending', 'processing')
  `));
  const [visits] = rowsOf<{ n: number }>(await db.execute(sql`
    SELECT count(*)::int AS n FROM store_visits WHERE seller_id = ${sellerId} AND created_at >= ${since} AND created_at < ${now}
  `));
  const [top] = rowsOf<{ name: string; units: number }>(await db.execute(sql`
    SELECT oi.product_name AS name, sum(oi.quantity)::int AS units
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.owner_id = ${sellerId} AND o.paid_at >= ${since} AND o.paid_at < ${now} AND o.status <> 'cancelled'
    GROUP BY oi.product_name ORDER BY units DESC, name ASC LIMIT 1
  `));
  const [active] = rowsOf<{ n: number }>(await db.execute(sql`
    SELECT count(*)::int AS n FROM products WHERE owner_id = ${sellerId} AND status = 'active' AND deleted_at IS NULL
  `));
  return {
    salesCents: Number(sales?.cents ?? 0),
    orderCount: Number(sales?.orders ?? 0),
    toShipCount: Number(toShip?.n ?? 0),
    visits: Number(visits?.n ?? 0),
    topProduct: top && top.name ? { name: top.name, units: Number(top.units) } : null,
    activeProducts: Number(active?.n ?? 0),
  };
}
