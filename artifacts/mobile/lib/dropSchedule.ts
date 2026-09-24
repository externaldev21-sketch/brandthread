/**
 * Timezone-aware scheduling helpers for seller drop creation.
 *
 * The seller picks a launch date/time as a "wall clock" reading in their
 * chosen IANA timezone (e.g. "2:00 PM America/New_York"). The server only
 * ever stores/compares UTC instants, so the picker's wall-clock value must be
 * converted to the correct UTC instant before it's sent as `releaseAt`.
 *
 * There is no dayjs/luxon/date-fns in this repo, so this is implemented with
 * `Intl.DateTimeFormat` + `Date.UTC` arithmetic, which correctly accounts for
 * DST and non-whole-hour offsets (e.g. Asia/Kolkata is UTC+5:30).
 */

export interface WallClockDate {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

/**
 * Returns the target timezone's offset from UTC, in minutes, evaluated at
 * the given UTC timestamp (offset varies across DST transitions, which is
 * why this takes a timestamp rather than being a fixed constant per zone).
 * Positive means the zone is ahead of UTC (e.g. +330 for Asia/Kolkata).
 */
export function getTimeZoneOffsetMinutes(utcTimestampMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcTimestampMs));
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const asIfUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return (asIfUtc - utcTimestampMs) / 60000;
}

/**
 * Converts a wall-clock date/time in `timeZone` to the correct UTC instant.
 * Two-pass: the first pass estimates the offset by treating the wall clock
 * as if it were already UTC, then re-checks the offset at the resulting
 * instant (this second pass matters right around a DST transition, where
 * the offset a few hours apart can differ).
 */
export function zonedTimeToUtc(wallClock: WallClockDate, timeZone: string): Date {
  const naiveUtcMs = Date.UTC(
    wallClock.year,
    wallClock.month - 1,
    wallClock.day,
    wallClock.hour,
    wallClock.minute,
    wallClock.second ?? 0,
  );

  const offset1 = getTimeZoneOffsetMinutes(naiveUtcMs, timeZone);
  const candidateMs = naiveUtcMs - offset1 * 60000;

  const offset2 = getTimeZoneOffsetMinutes(candidateMs, timeZone);
  const finalMs = offset2 === offset1 ? candidateMs : naiveUtcMs - offset2 * 60000;

  return new Date(finalMs);
}

/** A short curated fallback list of common IANA zones, used only if
 * `Intl.supportedValuesOf('timeZone')` is unavailable in the JS engine. */
export const COMMON_TIME_ZONES: string[] = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'Africa/Cairo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
];

/** Returns the full IANA timezone list where supported, else the curated fallback. */
export function listSupportedTimeZones(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported === 'function') {
      const zones = supported('timeZone');
      if (Array.isArray(zones) && zones.length > 0) return zones;
    }
  } catch {
    // fall through to curated list
  }
  return COMMON_TIME_ZONES;
}
