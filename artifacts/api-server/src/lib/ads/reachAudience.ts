/**
 * DB half of the reach estimate: measures the real reachable audience for a
 * campaign's targeting and applies the honest floor (./reachEstimate.ts).
 *
 * Targeting today is "every signed-in buyer except the advertiser" — the same
 * pool /api/ads/serve delivers to — so the audience is the count of buyer
 * accounts in good standing, and the daily-active share comes from
 * users.last_active_at (touched on authenticated requests).
 */
import { and, isNull, ne, or, sql } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { reachConfig, resolveAudience, type ReachModel } from "./reachEstimate";

const CACHE_MS = 10 * 60 * 1000;
let cached: { at: number; measured: { total: number; dailyActive: number } } | null = null;

async function measureBuyerAudience(now: Date): Promise<{ total: number; dailyActive: number }> {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      dailyActive: sql<number>`count(*) FILTER (WHERE ${users.lastActiveAt} >= ${dayAgo})::int`,
    })
    .from(users)
    .where(and(
      or(isNull(users.accountType), ne(users.accountType, "seller")),
      isNull(users.deletedAt),
      isNull(users.suspendedAt),
    ));
  return { total: Number(row?.total ?? 0), dailyActive: Number(row?.dailyActive ?? 0) };
}

/** The live reach model (platform CPM + measured-or-floor audience). Cached for 10 minutes. */
export async function loadReachModel(now: Date = new Date()): Promise<ReachModel> {
  const config = reachConfig();
  if (!cached || now.getTime() - cached.at > CACHE_MS) {
    cached = { at: now.getTime(), measured: await measureBuyerAudience(now) };
  }
  // The advertiser is never in their own audience.
  const measured = { total: Math.max(0, cached.measured.total - 1), dailyActive: cached.measured.dailyActive };
  return {
    cpmCents: config.cpmCents,
    audience: resolveAudience(measured, { total: config.floorTotal, dailyActive: config.floorDailyActive }),
  };
}

/** Test hook. */
export function resetReachModelCache(): void {
  cached = null;
}
