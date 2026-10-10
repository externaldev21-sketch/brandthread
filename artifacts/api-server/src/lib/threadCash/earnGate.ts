/**
 * The gate every Thread Cash REWARD passes before it is paid (daily
 * check-in, active-time claim, streak bonus, referral credit, any promo
 * grant). Three independent checks, all failing closed:
 *
 *  1. Kill switch — THREAD_CASH_EARN_ENABLED (env) AND the 'threadCash'
 *     feature flag, plus (unless THREAD_CASH_EARN_WITHOUT_CHECKOUT_SPEND)
 *     the 'threadCashCheckoutDiscount' flag, so no reward liability piles
 *     up while it can't be spent. Checked BEFORE a transaction opens (it
 *     reads flags on the shared pool).
 *  2. Monthly budget — reward credit issued this calendar month (UTC) may
 *     not exceed min(bps × trailing-30-day GMV, absolute cap). Taken under
 *     one global advisory lock, always the LAST lock a transaction takes, so
 *     concurrent awards can't jointly overshoot it.
 *  3. Per-device cap — at most N accounts per device earn the daily reward
 *     in a rolling 24h, across every account signed in on that phone.
 *
 * Config: ./rewardsConfig.ts.
 */
import { createHash } from "node:crypto";
import { and, eq, gt, gte, inArray, isNotNull, lte, ne, notInArray, sql } from "drizzle-orm";
import { db, orders, threadCashDeviceRewards, threadCashEntries } from "@workspace/db";
import { ThreadCashError, isFeatureEnabled } from "./wallet";
import {
  budgetPeriodStart, monthlyRewardsBudgetCents, rewardsPolicy, type ThreadCashRewardsPolicy,
} from "./rewardsConfig";

type DbExecutor = Pick<typeof db, "select" | "insert" | "update" | "execute">;

/** Ledger sources that are platform-funded reward credit, counted against the budget. */
export const REWARD_SOURCES = ["daily_checkin", "streak_bonus", "referral", "admin_adjustment"] as const;

/** Order statuses that never count toward GMV. */
const NON_GMV_ORDER_STATUSES = ["cancelled", "refunded", "refund_pending"];

const DAY_MS = 86_400_000;

export type EarnPauseReason = "earn_disabled" | "thread_cash_off" | "checkout_spend_off";

/** Why rewards are paused right now, or null when they may be paid. */
export async function threadCashEarnPauseReason(
  policy: ThreadCashRewardsPolicy = rewardsPolicy(),
  flagEnabled: (key: string) => Promise<boolean> = (key) => isFeatureEnabled(key),
): Promise<EarnPauseReason | null> {
  if (!policy.earnEnabled) return "earn_disabled";
  if (!(await flagEnabled("threadCash"))) return "thread_cash_off";
  if (!policy.earnWithoutCheckoutSpend && !(await flagEnabled("threadCashCheckoutDiscount"))) {
    return "checkout_spend_off";
  }
  return null;
}

export async function assertThreadCashEarnAllowed(policy: ThreadCashRewardsPolicy = rewardsPolicy()): Promise<void> {
  const reason = await threadCashEarnPauseReason(policy);
  if (reason) {
    throw new ThreadCashError("Thread Cash rewards are paused right now.", 503, "THREAD_CASH_EARN_PAUSED");
  }
}

// ─── Monthly budget ─────────────────────────────────────────────────────────

export async function gmvLast30DaysCents(executor: DbExecutor, now: Date): Promise<number> {
  const [row] = await executor.select({
    total: sql<string>`COALESCE(SUM(${orders.totalCents}), 0)`,
  }).from(orders).where(and(
    isNotNull(orders.paidAt),
    gte(orders.paidAt, new Date(now.getTime() - 30 * DAY_MS)),
    lte(orders.paidAt, now),
    notInArray(orders.status, NON_GMV_ORDER_STATUSES),
  ));
  return Number(row?.total ?? 0);
}

export async function rewardsIssuedSinceCents(executor: DbExecutor, since: Date): Promise<number> {
  const [row] = await executor.select({
    total: sql<string>`COALESCE(SUM(${threadCashEntries.amountCents}), 0)`,
  }).from(threadCashEntries).where(and(
    inArray(threadCashEntries.source, [...REWARD_SOURCES]),
    gt(threadCashEntries.amountCents, 0),
    gte(threadCashEntries.createdAt, since),
  ));
  return Number(row?.total ?? 0);
}

export type RewardsBudgetStatus = {
  periodStart: string;
  gmv30dCents: number;
  budgetCents: number;
  issuedCents: number;
  remainingCents: number;
};

export async function getRewardsBudgetStatus(
  executor: DbExecutor = db,
  now = new Date(),
  policy: ThreadCashRewardsPolicy = rewardsPolicy(),
): Promise<RewardsBudgetStatus> {
  const periodStart = budgetPeriodStart(now);
  const [gmv30dCents, issuedCents] = await Promise.all([
    gmvLast30DaysCents(executor, now),
    rewardsIssuedSinceCents(executor, periodStart),
  ]);
  const budgetCents = monthlyRewardsBudgetCents(gmv30dCents, policy);
  return {
    periodStart: periodStart.toISOString(),
    gmv30dCents,
    budgetCents,
    issuedCents,
    remainingCents: Math.max(0, budgetCents - issuedCents),
  };
}

/**
 * Claims `amountCents` of this month's budget inside `tx`; the caller then
 * inserts the reward rows in the same transaction. Throws when it would
 * overshoot. Must be the last advisory lock the transaction takes.
 */
export async function reserveRewardsBudget(
  tx: DbExecutor,
  amountCents: number,
  now = new Date(),
  policy: ThreadCashRewardsPolicy = rewardsPolicy(),
): Promise<void> {
  if (amountCents <= 0) return;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('thread-cash-rewards-budget'))`);
  const status = await getRewardsBudgetStatus(tx, now, policy);
  if (amountCents > status.remainingCents) {
    throw new ThreadCashError(
      "Thread Cash rewards are paused for the rest of this month.",
      503,
      "THREAD_CASH_REWARDS_BUDGET_EXHAUSTED",
    );
  }
}

// ─── Per-device cap ─────────────────────────────────────────────────────────

/** The app's install id (a random UUID it keeps on the device); anything else is rejected. */
export function normalizeDeviceId(deviceId: unknown): string | null {
  if (typeof deviceId !== "string") return null;
  const trimmed = deviceId.trim().toLowerCase();
  return /^[a-z0-9-]{16,128}$/.test(trimmed) ? trimmed : null;
}

export function deviceRewardKey(deviceId: string): string {
  return createHash("sha256").update(`bt-thread-cash-device:${deviceId}`).digest("hex");
}

/**
 * Rejects a daily reward when `deviceMaxAccountsPerDay` OTHER accounts on
 * this device already earned one in the last 24h, then records this one.
 * A missing/invalid device id fails closed: without it the per-person cap
 * can't be enforced.
 */
export async function claimDeviceReward(
  tx: DbExecutor,
  input: { buyerId: string; deviceId: unknown; localDate: string; now?: Date },
  policy: ThreadCashRewardsPolicy = rewardsPolicy(),
): Promise<void> {
  const deviceId = normalizeDeviceId(input.deviceId);
  if (!deviceId) {
    throw new ThreadCashError("Update the app to keep earning Thread Cash.", 400, "THREAD_CASH_DEVICE_REQUIRED");
  }
  const deviceKey = deviceRewardKey(deviceId);
  const now = input.now ?? new Date();
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thread-cash-device:${deviceKey}`}))`);
  const [row] = await tx.select({
    accounts: sql<string>`COUNT(DISTINCT ${threadCashDeviceRewards.buyerId})`,
  }).from(threadCashDeviceRewards).where(and(
    eq(threadCashDeviceRewards.deviceKey, deviceKey),
    ne(threadCashDeviceRewards.buyerId, input.buyerId),
    gt(threadCashDeviceRewards.createdAt, new Date(now.getTime() - DAY_MS)),
  ));
  if (Number(row?.accounts ?? 0) >= policy.deviceMaxAccountsPerDay) {
    throw new ThreadCashError(
      "Thread Cash was already earned on this device today.",
      429,
      "THREAD_CASH_DEVICE_CHECKIN_CAP",
    );
  }
  await tx.insert(threadCashDeviceRewards)
    .values({ deviceKey, buyerId: input.buyerId, localDate: input.localDate, createdAt: now })
    .onConflictDoNothing();
}
