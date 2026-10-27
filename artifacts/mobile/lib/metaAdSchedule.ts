/**
 * Pure validation for the Meta ad builder's Schedule section and interest
 * search (app/meta-ads-setup.tsx). Kept free of react-native imports so
 * vitest runs it directly.
 *
 * The API re-checks the same rules (api-server src/lib/metaAdsSchedule.ts)
 * and refuses a bad flight when the draft is saved; checking here lets the
 * screen show an inline field error and block Launch first.
 */
import { startOfToday, ymdToDate } from '@/lib/dateTimeField';

/** Furthest a scheduled start may be: one year from today. */
export const META_AD_MAX_LEAD_DAYS = 365;
/** Longest flight, start day to end day. */
export const META_AD_MAX_FLIGHT_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface MetaAdScheduleInput {
  startNow: boolean;
  /** `YYYY-MM-DD`, or '' when unset. Ignored when `startNow`. */
  startDate: string;
  /** `YYYY-MM-DD`, or '' when there is no end date. */
  endDate: string;
  /** Lifetime budgets need an end date (Meta spreads the budget over the flight). */
  budgetType?: 'daily' | 'lifetime';
}

export interface MetaAdScheduleErrors {
  startDate: string | null;
  endDate: string | null;
}

/** Latest allowed start day (local midnight). */
export function metaAdLatestStart(now: Date = new Date()): Date {
  const today = startOfToday(now);
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + META_AD_MAX_LEAD_DAYS);
}

export function validateMetaAdSchedule(input: MetaAdScheduleInput, now: Date = new Date()): MetaAdScheduleErrors {
  const today = startOfToday(now);
  const latest = metaAdLatestStart(now);
  let startError: string | null = null;
  let start: Date | null = null;

  if (!input.startNow) {
    const raw = input.startDate.trim();
    start = ymdToDate(raw);
    if (!raw) startError = 'Choose a start date, or turn on Start now.';
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !start) startError = 'Enter a real date as YYYY-MM-DD.';
    else if (start.getTime() < today.getTime()) startError = 'Start date can’t be in the past.';
    else if (start.getTime() > latest.getTime()) startError = 'Start date must be within a year from today.';
  }

  let endError: string | null = null;
  const rawEnd = input.endDate.trim();
  if (rawEnd) {
    const end = ymdToDate(rawEnd);
    const startDay = !input.startNow && start && !startError ? start : today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawEnd) || !end) endError = 'Enter a real date as YYYY-MM-DD.';
    else if (end.getTime() <= startDay.getTime()) {
      endError = input.startNow ? 'End date must be after today.' : 'End date must be after the start date.';
    } else if (Math.round((end.getTime() - startDay.getTime()) / DAY_MS) > META_AD_MAX_FLIGHT_DAYS) {
      endError = `Ads can run for up to ${META_AD_MAX_FLIGHT_DAYS} days.`;
    }
  } else if (input.budgetType === 'lifetime') {
    endError = 'A lifetime budget needs an end date.';
  }

  return { startDate: startError, endDate: endError };
}

export function isMetaAdScheduleValid(errors: MetaAdScheduleErrors): boolean {
  return !errors.startDate && !errors.endDate;
}

/** Latest end day the picker offers for a given start (local midnight). */
export function metaAdLatestEnd(startDate: string, startNow: boolean, now: Date = new Date()): Date {
  const start = (!startNow && ymdToDate(startDate)) || startOfToday(now);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + META_AD_MAX_FLIGHT_DAYS);
}

/**
 * The ISO times sent to the API for a valid schedule. A start day is local
 * midnight — or "now" when that is today, so it is never in the past — and an
 * end day runs to the end of that local day. Undefined means start now / no end.
 */
export function metaAdScheduleTimes(
  input: Pick<MetaAdScheduleInput, 'startNow' | 'startDate' | 'endDate'>,
  now: Date = new Date(),
): { startTime?: string; endTime?: string } {
  const startDay = input.startNow ? null : ymdToDate(input.startDate.trim());
  const endDay = ymdToDate(input.endDate.trim());
  const start = startDay ? new Date(Math.max(startDay.getTime(), now.getTime())) : null;
  const end = endDay ? new Date(endDay.getFullYear(), endDay.getMonth(), endDay.getDate(), 23, 59, 59) : null;
  return {
    ...(start ? { startTime: start.toISOString() } : {}),
    ...(end ? { endTime: end.toISOString() } : {}),
  };
}

/** How many interest suggestions to show under the search field. */
export const META_INTEREST_RESULT_LIMIT = 12;
/** How many interests a seller can add to one ad's audience. */
export const META_INTEREST_MAX_SELECTED = 10;

/**
 * Tidy Meta's interest search results for display: drop blank names, any
 * already-selected interest, and duplicates (by id, then by case-insensitive
 * name), then cap the list. Returns nothing once the selection is full.
 */
export function tidyInterestResults<T extends { id: string; name: string }>(
  results: readonly T[],
  selected: readonly { id: string; name: string }[],
  limit: number = META_INTEREST_RESULT_LIMIT,
): T[] {
  if (selected.length >= META_INTEREST_MAX_SELECTED) return [];
  const seenIds = new Set(selected.map((s) => s.id));
  const seenNames = new Set(selected.map((s) => s.name.trim().toLowerCase()));
  const out: T[] = [];
  for (const r of results) {
    const name = (r.name ?? '').trim();
    const key = name.toLowerCase();
    if (!r.id || !name || seenIds.has(r.id) || seenNames.has(key)) continue;
    seenIds.add(r.id);
    seenNames.add(key);
    out.push(name === r.name ? r : { ...r, name });
    if (out.length >= limit) break;
  }
  return out;
}
