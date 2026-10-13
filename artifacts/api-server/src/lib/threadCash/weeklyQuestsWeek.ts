/**
 * Weekly quests: the calendar math, kept pure (no DB, no clock) so it can be
 * unit-tested directly. A quest week is the buyer's local ISO week, Monday
 * 00:00 to the next Monday 00:00 in their IANA timezone (UTC when unknown).
 */

export const WEEKLY_QUEST_SOURCE = "weekly_quests";
/** Used when `thread_cash_config.weekly_quest_reward_cents` is NULL or the row is missing. */
export const DEFAULT_WEEKLY_QUEST_REWARD_CENTS = 50;

export type WeeklyQuestId = "open_days" | "save_products" | "follow_brands";

export type WeeklyQuestDefinition = { id: WeeklyQuestId; title: string; target: number };

/** All three are free actions; none involves a purchase or a paid feature. */
export const WEEKLY_QUESTS: readonly WeeklyQuestDefinition[] = [
  { id: "open_days", title: "Open Brandthread on 3 days", target: 3 },
  { id: "save_products", title: "Save 3 pieces", target: 3 },
  { id: "follow_brands", title: "Follow 2 brands", target: 2 },
];

export type WeekWindow = {
  /** ISO week key, e.g. "2026-W42". */
  weekKey: string;
  /** Buyer-local Monday, YYYY-MM-DD. */
  startDate: string;
  /** Buyer-local Sunday, YYYY-MM-DD. */
  endDate: string;
  /** Instant of the local Monday 00:00. */
  startsAt: Date;
  /** Instant of the next local Monday 00:00 (exclusive end). */
  endsAt: Date;
  timeZone: string;
};

export function weeklyQuestIdempotencyKey(buyerId: string, weekKey: string): string {
  return `weekly_quests:${buyerId}:${weekKey}`;
}

/** The zone itself when Intl accepts it, else "UTC". */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return "UTC";
  }
}

function parts(date: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function dateFromParts(y: number, m: number, d: number): string {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
}

function toUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  const t = new Date(toUtcMs(date) + days * 86_400_000);
  return dateFromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Buyer-local calendar date, YYYY-MM-DD. */
export function localDate(now: Date, timeZone: string): string {
  const p = parts(now, timeZone);
  return dateFromParts(p.year, p.month, p.day);
}

/** Monday (YYYY-MM-DD) of the ISO week containing `date`. */
export function mondayOf(date: string): string {
  const dow = new Date(toUtcMs(date)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

/** ISO week key ("YYYY-Www") for the week starting on `monday`. */
export function isoWeekKey(monday: string): string {
  // The ISO week-year is the year that week's Thursday falls in.
  const thursday = addDays(monday, 3);
  const year = Number(thursday.slice(0, 4));
  const jan4Monday = mondayOf(`${pad(year, 4)}-01-04`);
  const week = Math.round((toUtcMs(monday) - toUtcMs(jan4Monday)) / (7 * 86_400_000)) + 1;
  return `${pad(year, 4)}-W${pad(week)}`;
}

/** Monday (YYYY-MM-DD) of an ISO week key. Throws on a malformed key. */
export function mondayOfWeekKey(weekKey: string): string {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) throw new Error(`Invalid week key: ${weekKey}`);
  const jan4Monday = mondayOf(`${match[1]}-01-04`);
  return addDays(jan4Monday, (Number(match[2]) - 1) * 7);
}

export function previousWeekKey(weekKey: string): string {
  return isoWeekKey(addDays(mondayOfWeekKey(weekKey), -7));
}

/**
 * The instant at which it is 00:00 on `date` in `timeZone`. Two passes of
 * offset correction handle DST; if local midnight doesn't exist (a zone that
 * springs forward at midnight) this lands on the first instant after it.
 */
export function zonedMidnight(date: string, timeZone: string): Date {
  const wall = toUtcMs(date);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess += wall - asUtc;
  }
  return new Date(guess);
}

export function weekWindow(now: Date, rawTimeZone: string | null | undefined): WeekWindow {
  const timeZone = resolveTimeZone(rawTimeZone);
  const startDate = mondayOf(localDate(now, timeZone));
  const nextMonday = addDays(startDate, 7);
  return {
    weekKey: isoWeekKey(startDate),
    startDate,
    endDate: addDays(startDate, 6),
    startsAt: zonedMidnight(startDate, timeZone),
    endsAt: zonedMidnight(nextMonday, timeZone),
    timeZone,
  };
}

/**
 * Consecutive ISO weeks with the reward claimed, ending at the current week
 * when it is claimed, otherwise at last week (an unclaimed current week
 * hasn't broken the run yet).
 */
export function computeWeekStreak(claimedWeekKeys: Iterable<string>, currentWeekKey: string): number {
  const claimed = new Set(claimedWeekKeys);
  let key = claimed.has(currentWeekKey) ? currentWeekKey : previousWeekKey(currentWeekKey);
  let streak = 0;
  while (claimed.has(key)) {
    streak++;
    key = previousWeekKey(key);
  }
  return streak;
}
