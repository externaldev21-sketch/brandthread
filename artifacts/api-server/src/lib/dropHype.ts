/**
 * Drop hype: how a drop's notify-me waitlist grew before release, for the
 * seller-only screen (GET /api/drops/:id/hype). Reads only
 * drop_alert_subscriptions (dropId, userId, createdAt); daily buckets are
 * the seller's local calendar days (tz = minutes east of UTC, the same
 * convention as /api/analytics/home).
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export interface HypePoint { date: string; cumulative: number }

const DAY_MS = 86_400_000;

/** "YYYY-MM-DD" of `at` on the seller's local calendar. */
export function localDateKey(at: Date, tzOffsetMinutes: number): string {
  return new Date(at.getTime() + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Daily counts → a gap-free cumulative series from the first signup day
 * through `todayKey` (inclusive). Empty input → empty series. Days after
 * `todayKey` (clock skew) are folded into today.
 */
export function buildCumulativeSeries(daily: Array<{ date: string; count: number }>, todayKey: string): HypePoint[] {
  const counts = new Map<string, number>();
  for (const d of daily) {
    const key = d.date > todayKey ? todayKey : d.date;
    counts.set(key, (counts.get(key) ?? 0) + Number(d.count));
  }
  if (counts.size === 0) return [];
  const first = [...counts.keys()].sort()[0];
  const out: HypePoint[] = [];
  let running = 0;
  for (let day = first; day <= todayKey; day = addDays(day, 1)) {
    running += counts.get(day) ?? 0;
    out.push({ date: day, cumulative: running });
  }
  return out;
}

export interface DropHype {
  total: number;
  today: number;
  /** Of `total`, how many follow the seller (the rest found the drop some other way). */
  followers: number;
  series: HypePoint[];
}

export async function loadDropHype(dropId: string, sellerId: string, tzOffsetMinutes: number, now = new Date()): Promise<DropHype> {
  const tz = Math.trunc(tzOffsetMinutes);
  const [dailyResult, followerResult] = await Promise.all([
    db.execute(sql`
      SELECT to_char((created_at + make_interval(mins => ${tz}))::date, 'YYYY-MM-DD') AS date,
             count(*)::int AS count
        FROM drop_alert_subscriptions
       WHERE drop_id = ${dropId}
       GROUP BY 1
       ORDER BY 1
    `),
    db.execute(sql`
      SELECT count(*)::int AS n
        FROM drop_alert_subscriptions s
       WHERE s.drop_id = ${dropId}
         AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = s.user_id AND f.following_id = ${sellerId})
    `),
  ]);
  const daily = ((dailyResult as any).rows as Array<{ date: string; count: number }>).map((r) => ({ date: r.date, count: Number(r.count) }));
  const todayKey = localDateKey(now, tz);
  const series = buildCumulativeSeries(daily, todayKey);
  const total = series.length ? series[series.length - 1].cumulative : 0;
  const today = daily.filter((d) => d.date >= todayKey).reduce((sum, d) => sum + d.count, 0);
  const followers = Number(((followerResult as any).rows[0]?.n) ?? 0);
  return { total, today, followers, series };
}
