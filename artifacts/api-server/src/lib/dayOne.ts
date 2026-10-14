/**
 * "Day 1": the first 100 distinct buyers of each brand keep a small,
 * permanent badge for that brand. Awarded in the same transaction that
 * creates a paid order (routes/webhooks.ts), so it follows real purchases
 * only; existing brands were backfilled from order history (migration 276).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, brandDayOneBuyers } from "@workspace/db";
import { profilesById } from "./safety";
import type { DbExecutor } from "./money/ledger";

export const DAY_ONE_LIMIT = 100;

/**
 * Gives `buyerId` the next Day 1 rank for `sellerId` if one is left. A
 * per-seller advisory lock serialises concurrent orders so ranks never skip
 * or collide; a repeat buyer is a no-op. Returns the rank, or null.
 */
export async function awardDayOne(tx: DbExecutor, sellerId: string, buyerId: string, orderId: string | null): Promise<number | null> {
  if (!sellerId || !buyerId || sellerId === buyerId) return null;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`day-one:${sellerId}`}))`);
  const [existing] = await tx.select({ rank: brandDayOneBuyers.rank }).from(brandDayOneBuyers)
    .where(and(eq(brandDayOneBuyers.sellerId, sellerId), eq(brandDayOneBuyers.buyerId, buyerId))).limit(1);
  if (existing) return existing.rank;
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(brandDayOneBuyers)
    .where(eq(brandDayOneBuyers.sellerId, sellerId));
  if (n >= DAY_ONE_LIMIT) return null;
  const rank = n + 1;
  await tx.insert(brandDayOneBuyers).values({ sellerId, buyerId, rank, orderId }).onConflictDoNothing();
  return rank;
}

/** Which of `userIds` are Day 1 for `sellerId`. */
export async function dayOneAmong(sellerId: string, userIds: string[], executor: DbExecutor = db): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!sellerId || ids.length === 0) return new Set();
  const rows = await executor.select({ buyerId: brandDayOneBuyers.buyerId }).from(brandDayOneBuyers)
    .where(and(eq(brandDayOneBuyers.sellerId, sellerId), inArray(brandDayOneBuyers.buyerId, ids)));
  return new Set(rows.map((r) => r.buyerId));
}

export type DayOneBrand = {
  sellerId: string;
  name: string;
  handle: string;
  initials: string;
  avatarUrl: string | null;
  rank: number;
  since: string;
};

/** The brands `buyerId` is Day 1 for, oldest first (public: the badge is shown in comments anyway). */
export async function dayOneBrandsFor(buyerId: string, executor: DbExecutor = db): Promise<DayOneBrand[]> {
  const rows = await executor
    .select({ sellerId: brandDayOneBuyers.sellerId, rank: brandDayOneBuyers.rank, since: brandDayOneBuyers.createdAt })
    .from(brandDayOneBuyers)
    .where(eq(brandDayOneBuyers.buyerId, buyerId))
    .orderBy(asc(brandDayOneBuyers.createdAt));
  const profiles = await profilesById(rows.map((r) => r.sellerId));
  return rows.flatMap((r) => {
    const p = profiles.get(r.sellerId);
    if (!p || p.deleted || p.suspended) return [];
    return [{ sellerId: r.sellerId, name: p.name, handle: p.handle, initials: p.initials, avatarUrl: p.avatarUrl, rank: r.rank, since: r.since.toISOString() }];
  });
}
