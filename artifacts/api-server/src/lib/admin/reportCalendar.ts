/**
 * Calendar helpers for the internal admin numbers (dashboard "Today", the
 * Monday email). Everything is computed in one reporting time zone so "today"
 * and "last week" mean the same thing on the dashboard and in the email.
 *
 * ADMIN_REPORT_TIMEZONE (IANA name) sets it; default America/Chicago.
 */

export const DEFAULT_REPORT_TIMEZONE = "America/Chicago";
const DAY_MS = 86_400_000;

export function reportTimeZone(raw = process.env.ADMIN_REPORT_TIMEZONE): string {
  const tz = raw?.trim();
  if (!tz) return DEFAULT_REPORT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return DEFAULT_REPORT_TIMEZONE;
  }
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number };

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of an instant in a time zone. */
export function zonedParts(at: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(at)) map[p.type] = p.value;
  return {
    year: Number(map.year), month: Number(map.month), day: Number(map.day),
    hour: Number(map.hour), minute: Number(map.minute), second: Number(map.second),
    weekday: WEEKDAYS[map.weekday] ?? 0,
  };
}

/** The instant of local midnight on the given calendar date in `tz` (DST-safe). */
export function zonedMidnight(year: number, month: number, day: number, tz: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  // Two passes settle the offset even when midnight sits next to a DST change.
  let instant = guess;
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(instant), tz);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    instant += guess - wall;
  }
  return new Date(instant);
}

/** Local midnight that starts the day containing `at`. */
export function startOfZonedDay(at: Date, tz: string): Date {
  const p = zonedParts(at, tz);
  return zonedMidnight(p.year, p.month, p.day, tz);
}

/** Local midnight `days` calendar days after the day starting at `dayStart`. */
export function addZonedDays(dayStart: Date, days: number, tz: string): Date {
  const p = zonedParts(new Date(dayStart.getTime() + 12 * 3_600_000), tz);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day) + days * DAY_MS);
  return zonedMidnight(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), tz);
}

/** Today so far, and the same stretch of yesterday (Stripe's "Today vs yesterday"). */
export function todayWindows(now: Date, tz: string) {
  const todayStart = startOfZonedDay(now, tz);
  const yesterdayStart = addZonedDays(todayStart, -1, tz);
  const elapsed = now.getTime() - todayStart.getTime();
  return {
    today: { from: todayStart, to: now },
    yesterdaySameTime: { from: yesterdayStart, to: new Date(yesterdayStart.getTime() + elapsed) },
  };
}

/**
 * The last full Monday–Sunday week before `now`, the week before it, and an ISO
 * week key ("2026-W41") naming the reported week, used to send the Monday email
 * exactly once.
 */
export function lastFullWeek(now: Date, tz: string) {
  const todayStart = startOfZonedDay(now, tz);
  const weekday = zonedParts(now, tz).weekday; // 0 = Sunday
  const sinceMonday = (weekday + 6) % 7;
  const thisMonday = addZonedDays(todayStart, -sinceMonday, tz);
  const lastMonday = addZonedDays(thisMonday, -7, tz);
  const prevMonday = addZonedDays(lastMonday, -7, tz);
  return {
    week: { from: lastMonday, to: thisMonday },
    previous: { from: prevMonday, to: lastMonday },
    key: isoWeekKey(lastMonday, tz),
  };
}

export function isoWeekKey(dayInWeek: Date, tz: string): string {
  const p = zonedParts(dayInWeek, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Local calendar date key ("2026-10-13") of an instant. */
export function zonedDateKey(at: Date, tz: string): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
