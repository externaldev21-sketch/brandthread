/**
 * Server-side check of a Meta campaign's flight dates, so a past start or an
 * end before the start is refused when the draft is saved instead of failing
 * on Meta at launch. Mirrors artifacts/mobile/lib/metaAdSchedule.ts (the app
 * sends a picked start day as local midnight — or "now" for today — and an
 * end day as the end of that local day).
 */

/** Longest flight the app offers. */
export const META_MAX_FLIGHT_DAYS = 90;
/** Furthest ahead a scheduled start may be. */
export const META_MAX_START_LEAD_DAYS = 365;
/** Clock skew + autosave delay allowed on a start the app computed as "now". */
const START_GRACE_MS = 15 * 60 * 1000;
/** Meta needs lifetime-budget ad sets to run at least a day. */
const LIFETIME_MIN_FLIGHT_MS = 24 * 60 * 60 * 1000;
const MIN_FLIGHT_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ParsedSchedule =
  | { ok: true; startTime: Date | null; endTime: Date | null }
  | { ok: false; error: string };

function parseDate(value: unknown): Date | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "invalid" : d;
}

/**
 * Validates startTime / endTime (ISO strings, or empty for "start now" / "no
 * end"). The flight cap counts the end day itself, so a 90-day flight picked
 * as whole days (start midnight → end 23:59 of day 90) is allowed.
 */
export function validateMetaSchedule(
  input: { startTime?: unknown; endTime?: unknown; budgetType?: string },
  now: Date = new Date(),
): ParsedSchedule {
  const start = parseDate(input.startTime);
  const end = parseDate(input.endTime);
  if (start === "invalid") return { ok: false, error: "startTime must be an ISO date" };
  if (end === "invalid") return { ok: false, error: "endTime must be an ISO date" };

  if (start && start.getTime() < now.getTime() - START_GRACE_MS) {
    return { ok: false, error: "Start date can't be in the past." };
  }
  if (start && start.getTime() > now.getTime() + META_MAX_START_LEAD_DAYS * DAY_MS) {
    return { ok: false, error: "Start date must be within a year from today." };
  }

  const effectiveStart = start ?? now;
  if (input.budgetType === "lifetime" && !end) {
    return { ok: false, error: "A lifetime budget needs an end date." };
  }
  if (end) {
    if (end.getTime() <= effectiveStart.getTime()) {
      return { ok: false, error: start ? "End date must be after the start date." : "End date must be in the future." };
    }
    const minFlight = input.budgetType === "lifetime" ? LIFETIME_MIN_FLIGHT_MS : MIN_FLIGHT_MS;
    if (end.getTime() - effectiveStart.getTime() < minFlight) {
      return {
        ok: false,
        error: input.budgetType === "lifetime"
          ? "A lifetime budget needs to run for at least a day."
          : "The ad needs to run for at least an hour.",
      };
    }
    if (end.getTime() - effectiveStart.getTime() > (META_MAX_FLIGHT_DAYS + 1) * DAY_MS) {
      return { ok: false, error: `Ads can run for up to ${META_MAX_FLIGHT_DAYS} days.` };
    }
  }
  return { ok: true, startTime: start, endTime: end };
}
