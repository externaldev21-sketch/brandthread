/** Thread Cash — platform-funded, non-cash reward credit. Types shared between
 *  lib/api.ts and the wallet / check-in UI. */

export type ThreadCashConfig = {
  dailyAmountCents: number;
  streakBonusCents: number;
  streakBonusDays: number;
  graceHours: number;
  expiryDays: number | null;
  maxRedemptionPerOrderCents: number | null;
};

export type ThreadCashStreakState = {
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string | null;
  timezone: string;
  alreadyCheckedInToday: boolean;
  dayInCycle: number;
  streakBonusDays?: number;
};

export type ThreadCashStatus = {
  balanceCents: number;
  config: ThreadCashConfig;
  streak: ThreadCashStreakState;
};

export type ThreadCashCheckInResult = {
  ok: true;
  earnedCents: number;
  streakBonusCents: number;
  streakBroken: boolean;
  balanceCents: number;
  streak: ThreadCashStreakState;
};

export type ThreadCashEntry = {
  id: string;
  buyerId: string;
  amountCents: number;
  source:
    | 'daily_checkin' | 'streak_bonus' | 'redemption' | 'checkout_spend'
    | 'refund_credit' | 'expiry' | 'admin_adjustment' | 'send_sent' | 'send_received';
  referenceId: string | null;
  note: string | null;
  createdAt: string;
};
