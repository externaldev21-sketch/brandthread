/**
 * "Best time to drop": when a seller's followers are active, bucketed by
 * weekday x hour in the seller's timezone over the last 28 days. Pure — the
 * route loads (follower, UTC hour) activity pairs and this file buckets,
 * ranks and applies k-anonymity.
 *
 * Each slot counts distinct followers seen active in that local weekday/hour,
 * so one very active follower can't drag the suggestion around.
 */

export const ACTIVITY_WINDOW_DAYS = 28;
/** Below this many distinct active followers nothing is returned. */
export const MIN_ACTIVE_FOLLOWERS = 20;
export const TOP_SLOT_COUNT = 3;

export interface ActivityPair {
  userId: string;
  /** Start of a UTC hour in which the follower did something. */
  hourUtc: Date;
}

export interface ActivitySlot {
  /** 0 = Sunday … 6 = Saturday, in `timeZone`. */
  weekday: number;
  /** 0–23, in `timeZone`. */
  hour: number;
  followers: number;
}

export type FollowerActivitySummary =
  | {
      status: "ok";
      timeZone: string;
      days: number;
      activeFollowers: number;
      minActiveFollowers: number;
      /** grid[weekday][hour] = distinct active followers in that local slot. */
      grid: number[][];
      /** Distinct active followers per weekday (any hour). */
      byWeekday: number[];
      top: ActivitySlot[];
    }
  | {
      status: "not_enough_activity";
      timeZone: string;
      days: number;
      activeFollowers: null;
      minActiveFollowers: number;
      grid: null;
      byWeekday: null;
      top: [];
    };

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local weekday + hour of an instant in an IANA zone (DST-aware via Intl). */
export function localWeekdayHour(at: Date, timeZone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hr = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  return { weekday: WEEKDAY_INDEX[wd] ?? 0, hour: hr % 24 };
}

export function summarizeFollowerActivity(
  pairs: ActivityPair[],
  timeZone: string,
  minActiveFollowers: number = MIN_ACTIVE_FOLLOWERS,
): FollowerActivitySummary {
  const active = new Set(pairs.map((p) => p.userId));
  if (active.size < minActiveFollowers) {
    return {
      status: "not_enough_activity", timeZone, days: ACTIVITY_WINDOW_DAYS,
      activeFollowers: null, minActiveFollowers, grid: null, byWeekday: null, top: [],
    };
  }

  // Every pair is the start of a UTC hour, so at most 28*24 distinct instants; convert each once.
  const localByHour = new Map<number, { weekday: number; hour: number }>();
  const slotUsers: Array<Array<Set<string>>> = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => new Set<string>()));
  const dayUsers: Array<Set<string>> = Array.from({ length: 7 }, () => new Set<string>());
  for (const p of pairs) {
    const key = p.hourUtc.getTime();
    let local = localByHour.get(key);
    if (!local) { local = localWeekdayHour(p.hourUtc, timeZone); localByHour.set(key, local); }
    slotUsers[local.weekday][local.hour].add(p.userId);
    dayUsers[local.weekday].add(p.userId);
  }

  const grid = slotUsers.map((row) => row.map((s) => s.size));
  const slots: ActivitySlot[] = [];
  grid.forEach((row, weekday) => row.forEach((followers, hour) => { if (followers > 0) slots.push({ weekday, hour, followers }); }));
  // Most followers first; ties go to the earlier slot in the week so the answer is stable.
  slots.sort((a, b) => b.followers - a.followers || a.weekday - b.weekday || a.hour - b.hour);

  return {
    status: "ok", timeZone, days: ACTIVITY_WINDOW_DAYS,
    activeFollowers: active.size, minActiveFollowers,
    grid, byWeekday: dayUsers.map((s) => s.size),
    top: slots.slice(0, TOP_SLOT_COUNT),
  };
}
