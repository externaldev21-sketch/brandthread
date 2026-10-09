/**
 * Pure scheduling logic for the seller "away" auto-reply. No DB, no clock
 * reads — everything takes `now` so it is exhaustively unit-testable.
 *
 * Modes:
 *   - "always":        away whenever the feature is enabled. The away window
 *                      is identified by the moment settings were last saved,
 *                      so re-saving (or re-enabling) starts a fresh window.
 *   - "outside_hours": away whenever local time (in `timezone`) is outside
 *                      the weekly business hours. Business hours are per
 *                      weekday (`openDays` bitmask, bit 0 = Sunday) between
 *                      `openMinute` and `closeMinute` (minutes from local
 *                      midnight). closeMinute < openMinute means the hours
 *                      run overnight into the next day; equal means open all
 *                      day. The away window is identified by the instant the
 *                      current closed period began, so every buyer message in
 *                      the same closed period shares one window key.
 */

export type AwayMode = "always" | "outside_hours";

export interface AwaySettings {
  enabled: boolean;
  message: string;
  mode: AwayMode;
  timezone: string;
  openDays: number;
  openMinute: number;
  closeMinute: number;
  /** When the settings row was last saved — the "always" window identity. */
  updatedAt: Date;
}

export interface AwayState {
  away: boolean;
  /** Stable id of the current away window; null when not away. */
  windowKey: string | null;
}

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
export const ALL_DAYS_MASK = 0b1111111;

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: number; // 0 = Sunday
  minute: number; // minutes from local midnight
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(at: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: WEEKDAYS[get("weekday")] ?? 0,
    minute: (Number(get("hour")) % 24) * 60 + Number(get("minute")),
  };
}

/** Offset (ms) of `timeZone` from UTC at instant `at`. */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minute / 60), p.minute % 60);
  return asUtc - Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS;
}

/** UTC instant for local wall-clock `minute` on the local calendar day
 *  (year, month, day) in `timeZone`. Handles DST by re-checking the offset. */
export function zonedToUtc(
  year: number, month: number, day: number, minute: number, timeZone: string,
): number {
  const naive = Date.UTC(year, month - 1, day, 0, 0) + minute * MINUTE_MS;
  let guess = naive - zoneOffsetMs(new Date(naive), timeZone);
  guess = naive - zoneOffsetMs(new Date(guess), timeZone);
  return guess;
}

function dayIsOpen(mask: number, weekday: number): boolean {
  return (mask & (1 << weekday)) !== 0;
}

interface Interval { start: number; end: number }

/** Business-hour intervals (UTC ms) that start on the local days surrounding
 *  `now` (two days back through one day ahead covers overnight spill). */
function businessIntervals(s: AwaySettings, now: Date): Interval[] {
  const today = localParts(now, s.timezone);
  const out: Interval[] = [];
  for (let back = 3; back >= -1; back--) {
    // Calendar-day arithmetic on the local date via a UTC-noon anchor.
    const anchor = new Date(Date.UTC(today.year, today.month - 1, today.day, 12) - back * DAY_MS);
    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth() + 1;
    const d = anchor.getUTCDate();
    const weekday = anchor.getUTCDay();
    if (!dayIsOpen(s.openDays, weekday)) continue;
    const start = zonedToUtc(y, m, d, s.openMinute, s.timezone);
    let end: number;
    if (s.closeMinute === s.openMinute) {
      end = start + DAY_MS; // open all day
    } else if (s.closeMinute > s.openMinute) {
      end = zonedToUtc(y, m, d, s.closeMinute, s.timezone);
    } else {
      const next = new Date(anchor.getTime() + DAY_MS);
      end = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), s.closeMinute, s.timezone);
    }
    out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function getAwayState(s: AwaySettings, now: Date): AwayState {
  if (!s.enabled) return { away: false, windowKey: null };

  if (s.mode === "always") {
    return { away: true, windowKey: `always:${s.updatedAt.getTime()}` };
  }

  const t = now.getTime();
  const intervals = businessIntervals(s, now);
  if (intervals.some((i) => i.start <= t && t < i.end)) {
    return { away: false, windowKey: null };
  }
  // The current closed period began when the latest interval ended (if no
  // interval ended recently — e.g. no open days at all — it is one
  // continuous window).
  const ended = intervals.filter((i) => i.end <= t).map((i) => i.end);
  if (ended.length === 0) return { away: true, windowKey: "closed" };
  return { away: true, windowKey: `closed:${Math.max(...ended)}` };
}

// ─── Settings validation (used by the PUT route) ────────────────────────────

export const AWAY_MESSAGE_MAX = 1000;

export interface AwayInput {
  enabled?: unknown;
  message?: unknown;
  mode?: unknown;
  timezone?: unknown;
  openDays?: unknown;
  openMinute?: unknown;
  closeMinute?: unknown;
}

export type AwayValidation =
  | { ok: true; value: Omit<AwaySettings, "updatedAt"> }
  | { ok: false; error: string };

const isMinute = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1440;

export function validateAwayInput(input: AwayInput): AwayValidation {
  const enabled = input.enabled === true;
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const mode = input.mode ?? "always";
  if (mode !== "always" && mode !== "outside_hours") {
    return { ok: false, error: "mode must be 'always' or 'outside_hours'." };
  }
  if (message.length > AWAY_MESSAGE_MAX) {
    return { ok: false, error: `Away message must be ${AWAY_MESSAGE_MAX} characters or fewer.` };
  }
  if (enabled && !message) {
    return { ok: false, error: "Write an away message before turning it on." };
  }
  const timezone = input.timezone ?? "UTC";
  if (!isValidTimezone(timezone)) return { ok: false, error: "Unknown timezone." };
  const openDays = input.openDays ?? 62;
  if (typeof openDays !== "number" || !Number.isInteger(openDays) || openDays < 0 || openDays > ALL_DAYS_MASK) {
    return { ok: false, error: "openDays must be a 7-bit day mask." };
  }
  const openMinute = input.openMinute ?? 540;
  const closeMinute = input.closeMinute ?? 1020;
  if (!isMinute(openMinute) || !isMinute(closeMinute)) {
    return { ok: false, error: "Hours must be minutes from midnight (0-1439)." };
  }
  return { ok: true, value: { enabled, message, mode, timezone, openDays, openMinute, closeMinute } };
}

/** Pure guard for "should this incoming message trigger an auto-reply at
 *  all?" — separated from the DB so the loop/automation rules are testable. */
export function shouldConsiderAutoReply(args: {
  senderIsAutomated: boolean;
  senderId: string;
  sellerId: string;
  conversationIsRequest: boolean;
  isAgentSender: boolean;
}): boolean {
  if (args.senderIsAutomated) return false; // never answer an automated message
  if (args.senderId === args.sellerId) return false; // seller's own messages never trigger it
  if (args.isAgentSender) return false; // never answer the Brandthread Agent
  if (args.conversationIsRequest) return false; // never bypass request acceptance
  return true;
}
