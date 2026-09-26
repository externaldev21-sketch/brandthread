/**
 * Thread Cash daily check-in / streak math. Pure and timezone-aware: "today"
 * is always the buyer's own calendar day, never a UTC day boundary, so a
 * buyer in Tokyo and one in Los Angeles each get exactly one check-in per
 * their own midnight-to-midnight.
 */

export type ThreadCashConfig = {
  dailyAmountCents: number;
  streakBonusCents: number;
  streakBonusDays: number;
  /** Extra hours of tolerance for a missed day before the streak resets. */
  graceHours: number;
  /** null = Thread Cash never expires (the product default). */
  expiryDays: number | null;
  /** null = a redemption can cover up to the full order total. */
  maxRedemptionPerOrderCents: number | null;
  /** Anti-farming: rolling-24h caps and eligibility for sending to a friend. */
  dailySendCapCents: number;
  dailyReceiveCapCents: number;
  minAccountAgeHoursForSend: number;
  maxCheckInsPerDevicePerDay: number;
};

export const DEFAULT_THREAD_CASH_CONFIG: ThreadCashConfig = {
  dailyAmountCents: 10,
  streakBonusCents: 100,
  streakBonusDays: 7,
  graceHours: 6,
  expiryDays: null,
  maxRedemptionPerOrderCents: null,
  dailySendCapCents: 2000,
  dailyReceiveCapCents: 5000,
  minAccountAgeHoursForSend: 24,
  maxCheckInsPerDevicePerDay: 3,
};

export type StreakState = {
  currentStreak: number;
  longestStreak: number;
  /** Buyer-local YYYY-MM-DD of the last successful check-in, or null. */
  lastCheckInDate: string | null;
};

export const EMPTY_STREAK_STATE: StreakState = {
  currentStreak: 0,
  longestStreak: 0,
  lastCheckInDate: null,
};

export type CheckInResult = {
  alreadyCheckedInToday: boolean;
  streakBroken: boolean;
  earnedCents: number;
  streakBonusCents: number;
  state: StreakState;
  /** 1-indexed day-in-cycle for a 7-day streak row UI (1..streakBonusDays). */
  dayInCycle: number;
};

/** The buyer-local calendar date for `date`, formatted YYYY-MM-DD. */
export function localDateString(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    // An unrecognized/invalid IANA zone must never crash a check-in.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

function toUTCDayNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

/** Whole calendar days between two YYYY-MM-DD strings (b - a). */
function daysBetween(a: string, b: string): number {
  return toUTCDayNumber(b) - toUTCDayNumber(a);
}

/**
 * Computes the result of a check-in attempt at `now` (server time) for a
 * buyer whose reported IANA timezone is `timeZone`. Never mutates its
 * inputs; callers persist `state` and award `earnedCents`/`streakBonusCents`
 * only when `!alreadyCheckedInToday`.
 */
export function computeCheckIn(
  state: StreakState,
  config: ThreadCashConfig,
  now: Date,
  timeZone: string,
): CheckInResult {
  const today = localDateString(now, timeZone);

  if (state.lastCheckInDate === today) {
    return {
      alreadyCheckedInToday: true,
      streakBroken: false,
      earnedCents: 0,
      streakBonusCents: 0,
      state,
      dayInCycle: cycleDay(state.currentStreak, config.streakBonusDays),
    };
  }

  const gapDays = state.lastCheckInDate ? daysBetween(state.lastCheckInDate, today) : null;
  // One missed day is always tolerated; graceHours adds further tolerance
  // (e.g. 24h grace = one additional missed day) before the streak resets.
  const allowedGapDays = 1 + Math.floor(Math.max(0, config.graceHours) / 24);
  const isConsecutive = gapDays !== null && gapDays >= 1 && gapDays <= allowedGapDays;
  const streakBroken = gapDays !== null && !isConsecutive;

  const currentStreak = isConsecutive || gapDays === null ? state.currentStreak + 1 : 1;
  const longestStreak = Math.max(state.longestStreak, currentStreak);
  const streakBonusDays = Math.max(1, config.streakBonusDays);
  const streakBonusCents = currentStreak % streakBonusDays === 0 ? config.streakBonusCents : 0;

  return {
    alreadyCheckedInToday: false,
    streakBroken,
    earnedCents: config.dailyAmountCents,
    streakBonusCents,
    state: { currentStreak, longestStreak, lastCheckInDate: today },
    dayInCycle: cycleDay(currentStreak, streakBonusDays),
  };
}

function cycleDay(streak: number, streakBonusDays: number): number {
  if (streak <= 0) return 1;
  const day = streak % streakBonusDays;
  return day === 0 ? streakBonusDays : day;
}
