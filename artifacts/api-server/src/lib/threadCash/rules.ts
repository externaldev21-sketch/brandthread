/**
 * Thread Cash rules, in one place: what earns, what expires, and every cap
 * that bounds spending or sending. Pure (no DB, no clock) so the wallet, the
 * checkout hook, the API and the tests all read the same definitions.
 */
import type { ThreadCashConfig } from "./streaks";

/** Ledger sources that put new value in a buyer's pocket as a reward. */
export const EARN_SOURCES = ["daily_checkin", "streak_bonus"] as const;

/**
 * Positive ledger sources that never expire. `live_gift` is a seller's
 * cashable earnings, not a buyer reward credit, so it is outside the
 * expiry policy entirely.
 */
export const NON_EXPIRING_CREDIT_SOURCES: ReadonlySet<string> = new Set(["live_gift"]);

/** Sources whose negative amount is the buyer cashing out, never reward spend. */
export const CASH_OUT_SOURCES: ReadonlySet<string> = new Set(["cash_out"]);

/** Days before an expiry that the buyer is warned. */
export const EXPIRY_WARNING_DAYS = 7;

export function isExpiringCreditSource(source: string): boolean {
  return !NON_EXPIRING_CREDIT_SOURCES.has(source);
}

/** `expiryDays` as an active policy: a positive integer, else never. */
export function activeExpiryDays(config: Pick<ThreadCashConfig, "expiryDays">): number | null {
  const days = config.expiryDays;
  return typeof days === "number" && Number.isInteger(days) && days > 0 ? days : null;
}

export function computeExpiresAt(earnedAt: Date, expiryDays: number | null): Date | null {
  if (expiryDays == null) return null;
  return new Date(earnedAt.getTime() + expiryDays * 86_400_000);
}

// ─── Spend caps ─────────────────────────────────────────────────────────────

export type SpendCapInput = {
  balanceCents: number;
  /** What the order costs before Thread Cash (after other discounts). */
  orderRemainingCents: number;
  maxRedemptionPerOrderCents: number | null;
  /** The card charge must stay at least this big (Stripe minimum). */
  minRemainderCents: number;
};

/** The most Thread Cash that can be applied to one order right now. */
export function maxRedeemableCents(input: SpendCapInput): number {
  const byOrder = Math.max(0, input.orderRemainingCents - Math.max(1, input.minRemainderCents));
  const byCap = input.maxRedemptionPerOrderCents != null
    ? Math.max(0, input.maxRedemptionPerOrderCents)
    : Number.POSITIVE_INFINITY;
  const cap = Math.min(Math.max(0, input.balanceCents), byOrder, byCap);
  return Number.isFinite(cap) ? Math.floor(cap) : 0;
}

/** Null when `amountCents` is within the per-order cap, else the reason. */
export function redemptionCapViolation(
  amountCents: number,
  maxRedemptionPerOrderCents: number | null,
): { maxCents: number; message: string } | null {
  if (maxRedemptionPerOrderCents == null || amountCents <= maxRedemptionPerOrderCents) return null;
  return {
    maxCents: maxRedemptionPerOrderCents,
    message: `You can apply up to $${(maxRedemptionPerOrderCents / 100).toFixed(2)} of Thread Cash per order.`,
  };
}

// ─── Published earn rules ───────────────────────────────────────────────────

export type ThreadCashRules = {
  earn: {
    dailyCents: number;
    streakBonusCents: number;
    streakBonusDays: number;
    maxCheckInsPerDevicePerDay: number;
  };
  spend: { maxRedemptionPerOrderCents: number | null };
  send: { dailySendCapCents: number; dailyReceiveCapCents: number; minAccountAgeHours: number };
  expiry: { expiryDays: number | null; warningDays: number };
};

/** The rules exactly as the wallet enforces them, for the API and the UI. */
export function describeRules(config: ThreadCashConfig): ThreadCashRules {
  return {
    earn: {
      dailyCents: config.dailyAmountCents,
      streakBonusCents: config.streakBonusCents,
      streakBonusDays: config.streakBonusDays,
      maxCheckInsPerDevicePerDay: config.maxCheckInsPerDevicePerDay,
    },
    spend: { maxRedemptionPerOrderCents: config.maxRedemptionPerOrderCents },
    send: {
      dailySendCapCents: config.dailySendCapCents,
      dailyReceiveCapCents: config.dailyReceiveCapCents,
      minAccountAgeHours: config.minAccountAgeHoursForSend,
    },
    expiry: { expiryDays: activeExpiryDays(config), warningDays: EXPIRY_WARNING_DAYS },
  };
}
