/**
 * Thread Cash rewards policy — every server-side limit on platform-funded
 * reward credit, in one pure module (env only, read lazily so tests and ops
 * can change it without a deploy of anything else). Unset or invalid values
 * fall back to the safe default: earning OFF, tight caps.
 *
 * Reward credit (daily check-in, streak bonus, referral, promo/admin credit,
 * and anything relayed from it by a send or Live gift) is spend-only: never
 * cashable, and it expires. Only money a person actually paid in can ever be
 * cashed out (./funding.ts).
 *
 *   THREAD_CASH_EARN_ENABLED                  "true" lets reward paths pay out. Kill switch:
 *                                             unset/anything else = no new rewards (default off).
 *                                             The 'threadCash' feature flag must ALSO be on.
 *   THREAD_CASH_EARN_WITHOUT_CHECKOUT_SPEND   "true" lets rewards accrue while the
 *                                             'threadCashCheckoutDiscount' flag is off (default
 *                                             off: no credit piles up that can't be spent).
 *   THREAD_CASH_REWARD_EXPIRY_DAYS            reward credit expires this many days after it is
 *                                             earned (default 90, 1–365). Paid funds never expire.
 *   THREAD_CASH_REWARDS_BUDGET_BPS_OF_GMV     monthly reward budget as basis points of the last
 *                                             30 days' GMV (default 100 = 1%, 0–10000).
 *   THREAD_CASH_REWARDS_MONTHLY_CAP_CENTS     absolute ceiling on that budget per calendar month
 *                                             (UTC) (default 50000 = $500).
 *   THREAD_CASH_DEVICE_MAX_ACCOUNTS_PER_DAY   how many accounts on one device may earn the daily
 *                                             reward in a rolling 24h (default 1, 1–8).
 *   THREAD_CASH_STREAK_BONUS_MAX_CENTS        ceiling on the streak bonus, whatever
 *                                             thread_cash_config says (default 25).
 *   THREAD_CASH_SEND_MIN_ACCOUNT_AGE_DAYS     sender account age before peer send (default 7).
 *   THREAD_CASH_SEND_DAILY_CAP_CENTS          per-sender rolling-24h send ceiling (default 1000).
 *   THREAD_CASH_RECEIVE_DAILY_CAP_CENTS       per-receiver rolling-24h receive ceiling (default 2000).
 */

export type ThreadCashRewardsPolicy = {
  earnEnabled: boolean;
  earnWithoutCheckoutSpend: boolean;
  rewardExpiryDays: number;
  budgetBpsOfGmv: number;
  monthlyCapCents: number;
  deviceMaxAccountsPerDay: number;
  streakBonusMaxCents: number;
  sendMinAccountAgeDays: number;
  sendDailyCapCents: number;
  receiveDailyCapCents: number;
};

export const DEFAULT_REWARDS_POLICY: ThreadCashRewardsPolicy = {
  earnEnabled: false,
  earnWithoutCheckoutSpend: false,
  rewardExpiryDays: 90,
  budgetBpsOfGmv: 100,
  monthlyCapCents: 50_000,
  deviceMaxAccountsPerDay: 1,
  streakBonusMaxCents: 25,
  sendMinAccountAgeDays: 7,
  sendDailyCapCents: 1_000,
  receiveDailyCapCents: 2_000,
};

function flag(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "true";
}

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function rewardsPolicy(env: NodeJS.ProcessEnv = process.env): ThreadCashRewardsPolicy {
  const d = DEFAULT_REWARDS_POLICY;
  return {
    earnEnabled: flag(env.THREAD_CASH_EARN_ENABLED),
    earnWithoutCheckoutSpend: flag(env.THREAD_CASH_EARN_WITHOUT_CHECKOUT_SPEND),
    rewardExpiryDays: int(env.THREAD_CASH_REWARD_EXPIRY_DAYS, d.rewardExpiryDays, 1, 365),
    budgetBpsOfGmv: int(env.THREAD_CASH_REWARDS_BUDGET_BPS_OF_GMV, d.budgetBpsOfGmv, 0, 10_000),
    monthlyCapCents: int(env.THREAD_CASH_REWARDS_MONTHLY_CAP_CENTS, d.monthlyCapCents, 0, 100_000_000),
    deviceMaxAccountsPerDay: int(env.THREAD_CASH_DEVICE_MAX_ACCOUNTS_PER_DAY, d.deviceMaxAccountsPerDay, 1, 8),
    streakBonusMaxCents: int(env.THREAD_CASH_STREAK_BONUS_MAX_CENTS, d.streakBonusMaxCents, 0, 10_000),
    sendMinAccountAgeDays: int(env.THREAD_CASH_SEND_MIN_ACCOUNT_AGE_DAYS, d.sendMinAccountAgeDays, 0, 365),
    sendDailyCapCents: int(env.THREAD_CASH_SEND_DAILY_CAP_CENTS, d.sendDailyCapCents, 0, 1_000_000),
    receiveDailyCapCents: int(env.THREAD_CASH_RECEIVE_DAILY_CAP_CENTS, d.receiveDailyCapCents, 0, 1_000_000),
  };
}

/**
 * The month's reward budget: `budgetBpsOfGmv` of the trailing-30-day GMV,
 * never more than `monthlyCapCents`. No GMV, no budget.
 */
export function monthlyRewardsBudgetCents(gmv30dCents: number, policy: ThreadCashRewardsPolicy): number {
  const byGmv = Math.floor((Math.max(0, gmv30dCents) * policy.budgetBpsOfGmv) / 10_000);
  return Math.max(0, Math.min(byGmv, policy.monthlyCapCents));
}

/** First instant of `now`'s calendar month, UTC — the budget period. */
export function budgetPeriodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
