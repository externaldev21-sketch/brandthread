/**
 * Rising brands this week (Discover > Brands, GET /api/public/brands/rising).
 *
 * Opted-in sellers (users.rising_brands_opt_in) ranked by order growth:
 * paid, non-cancelled orders in the last 7 days vs the 7 days before.
 * A seller needs at least 5 orders this week and growth above zero.
 * growth% = (cur - prev) / max(prev, 1).
 *
 * The response carries the percent only. Absolute order counts never leave
 * the server: they are used for the threshold and the tiebreak, then dropped.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export const RISING_MIN_ORDERS = 5;
export const RISING_LIMIT = 10;
const DAY_MS = 86_400_000;

export interface RisingCandidate {
  sellerId: string;
  username: string | null;
  brandName: string;
  logoUrl: string | null;
  cur: number;
  prev: number;
}

export interface RisingBrand {
  rank: number;
  sellerId: string;
  username: string | null;
  brandName: string;
  logoUrl: string | null;
  growthPct: number;
}

/** Whole-number percent; +400 means five times last week's orders. */
export function growthPct(cur: number, prev: number): number {
  return Math.round(((cur - prev) / Math.max(prev, 1)) * 100);
}

/**
 * Filters to the qualifying sellers and ranks them: growth first, then this
 * week's orders (a bigger week wins a tie), then name, then id for a stable
 * order. Ranks are 1..n with no gaps.
 */
export function rankRisingBrands(rows: readonly RisingCandidate[], limit = RISING_LIMIT): RisingBrand[] {
  return rows
    .filter((r) => r.cur >= RISING_MIN_ORDERS && r.cur > r.prev)
    .map((r) => ({ ...r, pct: growthPct(r.cur, r.prev), exact: (r.cur - r.prev) / Math.max(r.prev, 1) }))
    .sort((a, b) => b.exact - a.exact
      || b.cur - a.cur
      || a.brandName.localeCompare(b.brandName)
      || a.sellerId.localeCompare(b.sellerId))
    .slice(0, limit)
    .map((r, i) => ({
      rank: i + 1,
      sellerId: r.sellerId,
      username: r.username,
      brandName: r.brandName,
      logoUrl: r.logoUrl,
      growthPct: r.pct,
    }));
}

/** Only public http(s) images; private /objects/ paths are never exposed. */
function publicImage(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) if (c && /^https?:\/\//i.test(c)) return c;
  return null;
}

export async function computeRisingBrands(now: Date = new Date()): Promise<{ brands: RisingBrand[]; weekOf: string }> {
  const weekStart = new Date(now.getTime() - 7 * DAY_MS);
  const prevStart = new Date(now.getTime() - 14 * DAY_MS);
  const res = await db.execute(sql`
    SELECT
      u.clerk_id, u.username, u.brand_name, u.display_name, u.logo_url, u.profile_image_url, u.avatar_url,
      COUNT(*) FILTER (WHERE o.paid_at >= ${weekStart})::int AS cur,
      COUNT(*) FILTER (WHERE o.paid_at <  ${weekStart})::int AS prev
    FROM users u
    JOIN orders o ON o.owner_id = u.clerk_id
    WHERE u.rising_brands_opt_in = true
      AND u.account_type IN ('seller', 'both')
      AND u.suspended_at IS NULL
      AND u.deleted_at IS NULL
      AND u.deletion_requested_at IS NULL
      AND u.policy_restricted = false
      AND o.paid_at IS NOT NULL
      AND o.paid_at >= ${prevStart}
      AND o.paid_at < ${now}
      AND o.status <> 'cancelled'
    GROUP BY u.clerk_id, u.username, u.brand_name, u.display_name, u.logo_url, u.profile_image_url, u.avatar_url
    HAVING COUNT(*) FILTER (WHERE o.paid_at >= ${weekStart}) >= ${RISING_MIN_ORDERS}
  `);
  const rows: RisingCandidate[] = (((res as any).rows ?? []) as any[]).map((r) => ({
    sellerId: String(r.clerk_id),
    username: r.username ?? null,
    brandName: (r.brand_name || r.display_name || r.username || "Brand") as string,
    logoUrl: publicImage(r.logo_url, r.profile_image_url, r.avatar_url),
    cur: Number(r.cur) || 0,
    prev: Number(r.prev) || 0,
  }));
  return { brands: rankRisingBrands(rows), weekOf: weekStart.toISOString().slice(0, 10) };
}
