/**
 * Thread Cash weekly quests (DB side). Calendar math lives in ./weeklyQuestsWeek.
 *
 * Apple-safe by construction: every quest is a free action, and progress is
 * counted on the server from rows the server itself wrote (check-in awards,
 * heartbeats it received, saves and follows that still exist). Nothing the
 * client reports is trusted, and nothing involves a purchase.
 *
 * The reward is one thread_cash_entries row per buyer per local ISO week,
 * carrying the idempotency key `weekly_quests:<buyerId>:<weekKey>` (unique
 * partial index on thread_cash_entries), so a retried or concurrent claim can
 * never pay twice. Same shape as creditReferralCash in lib/referrals/rewards.ts.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, threadCashConfig, threadCashEntries, threadCashStreaks } from "@workspace/db";
import { assertThreadCashNotFrozen, getBalanceCents, ThreadCashError } from "./wallet";
import { assertThreadCashEarnAllowed, reserveRewardsBudget } from "./earnGate";
import { postRewardIssued } from "./liability";
import {
  DEFAULT_WEEKLY_QUEST_REWARD_CENTS,
  WEEKLY_QUESTS,
  WEEKLY_QUEST_SOURCE,
  computeWeekStreak,
  weekWindow,
  weeklyQuestIdempotencyKey,
  type WeekWindow,
  type WeeklyQuestId,
} from "./weeklyQuestsWeek";

type Executor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export type WeeklyQuestProgress = { id: WeeklyQuestId; title: string; progress: number; target: number };

export type WeeklyQuestsStatus = {
  weekKey: string;
  endsAt: string;
  quests: WeeklyQuestProgress[];
  rewardCents: number;
  claimed: boolean;
  weekStreak: number;
};

function rows<T>(result: unknown): T[] {
  return ((result as { rows?: T[] }).rows ?? (result as T[])) as T[];
}

async function loadTimeZone(executor: Executor, buyerId: string): Promise<string | null> {
  const [row] = await executor
    .select({ timezone: threadCashStreaks.timezone })
    .from(threadCashStreaks)
    .where(eq(threadCashStreaks.buyerId, buyerId))
    .limit(1);
  return row?.timezone ?? null;
}

export async function getWeeklyQuestRewardCents(executor: Executor = db): Promise<number> {
  const [row] = await executor
    .select({ cents: threadCashConfig.weeklyQuestRewardCents })
    .from(threadCashConfig)
    .where(eq(threadCashConfig.id, "default"))
    .limit(1);
  const cents = row?.cents;
  return typeof cents === "number" && Number.isInteger(cents) && cents > 0 ? cents : DEFAULT_WEEKLY_QUEST_REWARD_CENTS;
}

/** Distinct local dates this week the server paid a daily reward or received a heartbeat. */
async function countOpenDays(executor: Executor, buyerId: string, week: WeekWindow): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COUNT(*)::int AS n FROM (
      SELECT reference_id AS d FROM thread_cash_entries
       WHERE buyer_id = ${buyerId} AND source = 'daily_checkin'
         AND reference_id BETWEEN ${week.startDate} AND ${week.endDate}
      UNION
      SELECT local_date AS d FROM thread_cash_heartbeats
       WHERE buyer_id = ${buyerId} AND heartbeat_count > 0
         AND local_date BETWEEN ${week.startDate} AND ${week.endDate}
    ) days`);
  return Number(rows<{ n: number }>(result)[0]?.n ?? 0);
}

/**
 * Products saved this week that are still saved. saved_items is unique per
 * (user, target), so unsave + resave leaves one row and can't inflate this.
 * created_at is a timestamp without time zone written by now(); comparing it
 * to a timestamptz reads it in the session zone, the same zone that wrote it.
 */
async function countSavedProducts(executor: Executor, buyerId: string, week: WeekWindow): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COUNT(DISTINCT target_id)::int AS n FROM saved_items
     WHERE user_id = ${buyerId} AND item_type = 'product'
       AND created_at >= ${week.startsAt.toISOString()}::timestamptz
       AND created_at <  ${week.endsAt.toISOString()}::timestamptz`);
  return Number(rows<{ n: number }>(result)[0]?.n ?? 0);
}

/** Seller accounts (account_type seller/both) followed this week and still followed. */
async function countFollowedBrands(executor: Executor, buyerId: string, week: WeekWindow): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COUNT(DISTINCT f.following_id)::int AS n
      FROM follows f JOIN users u ON u.clerk_id = f.following_id
     WHERE f.follower_id = ${buyerId} AND f.following_id <> ${buyerId}
       AND u.account_type IN ('seller', 'both')
       AND f.created_at >= ${week.startsAt.toISOString()}::timestamptz
       AND f.created_at <  ${week.endsAt.toISOString()}::timestamptz`);
  return Number(rows<{ n: number }>(result)[0]?.n ?? 0);
}

async function claimedWeekKeys(executor: Executor, buyerId: string): Promise<string[]> {
  const found = await executor
    .select({ weekKey: threadCashEntries.referenceId })
    .from(threadCashEntries)
    .where(and(eq(threadCashEntries.buyerId, buyerId), eq(threadCashEntries.source, WEEKLY_QUEST_SOURCE)));
  return found.map((r) => r.weekKey).filter((k): k is string => typeof k === "string");
}

export async function getWeeklyQuestsStatus(
  buyerId: string,
  now = new Date(),
  executor: Executor = db,
): Promise<WeeklyQuestsStatus> {
  const week = weekWindow(now, await loadTimeZone(executor, buyerId));
  const [openDays, saves, follows, rewardCents, claimedKeys] = await Promise.all([
    countOpenDays(executor, buyerId, week),
    countSavedProducts(executor, buyerId, week),
    countFollowedBrands(executor, buyerId, week),
    getWeeklyQuestRewardCents(executor),
    claimedWeekKeys(executor, buyerId),
  ]);
  const counts: Record<WeeklyQuestId, number> = { open_days: openDays, save_products: saves, follow_brands: follows };
  return {
    weekKey: week.weekKey,
    endsAt: week.endsAt.toISOString(),
    quests: WEEKLY_QUESTS.map((q) => ({ id: q.id, title: q.title, target: q.target, progress: Math.min(q.target, counts[q.id]) })),
    rewardCents,
    claimed: claimedKeys.includes(week.weekKey),
    weekStreak: computeWeekStreak(claimedKeys, week.weekKey),
  };
}

export type WeeklyQuestsClaimResult = {
  created: boolean;
  amountCents: number;
  balanceCents: number;
  status: WeeklyQuestsStatus;
};

/**
 * Pays this week's reward once all quests are complete. Order: completion
 * check, then the freeze kill switch, then the idempotent insert. A repeat
 * claim (sequential or concurrent) inserts nothing and returns created=false.
 */
export async function claimWeeklyQuests(buyerId: string, now = new Date()): Promise<WeeklyQuestsClaimResult> {
  const status = await getWeeklyQuestsStatus(buyerId, now);
  if (!status.quests.every((q) => q.progress >= q.target)) {
    throw new ThreadCashError("Finish this week's quests first.", 409, "WEEKLY_QUESTS_INCOMPLETE");
  }
  await assertThreadCashEarnAllowed();
  const row = await db.transaction(async (tx) => {
    await assertThreadCashNotFrozen(tx, buyerId);
    const idempotencyKey = weeklyQuestIdempotencyKey(buyerId, status.weekKey);
    const [already] = await tx.select({ id: threadCashEntries.id }).from(threadCashEntries)
      .where(eq(threadCashEntries.idempotencyKey, idempotencyKey)).limit(1);
    if (already) return undefined;
    // Budget first, then the reward row (same order as every other reward):
    // weekly_quests counts toward the budget (earnGate REWARD_SOURCES), so
    // checking after the insert would count this reward against itself.
    await reserveRewardsBudget(tx, status.rewardCents);
    const [entry] = await tx
    .insert(threadCashEntries)
    .values({
      buyerId,
      amountCents: status.rewardCents,
      source: WEEKLY_QUEST_SOURCE,
      referenceId: status.weekKey,
      note: `Weekly quests (${status.weekKey})`,
      idempotencyKey,
    })
    .onConflictDoNothing()
    .returning({ id: threadCashEntries.id, amountCents: threadCashEntries.amountCents });
    if (entry) {
      // Commit the reward, the budget reservation and the liability together.
      await postRewardIssued(tx, { entryId: entry.id, buyerId, amountCents: entry.amountCents, source: WEEKLY_QUEST_SOURCE });
    }
    return entry;
  });
  const [balanceCents, keys] = await Promise.all([getBalanceCents(db, buyerId), claimedWeekKeys(db, buyerId)]);
  return {
    created: Boolean(row),
    amountCents: row?.amountCents ?? 0,
    balanceCents,
    status: { ...status, claimed: true, weekStreak: computeWeekStreak(keys, status.weekKey) },
  };
}
