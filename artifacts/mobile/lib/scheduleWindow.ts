/**
 * Active dates for discount codes and automatic sales: the seller picks a
 * wall-clock date + time in a time zone (default: the device's), the server
 * stores the UTC instant plus that zone (`scheduleTimeZone`).
 *
 * Rows saved before time pickers existed have no zone and hold UTC midnight
 * of the date the seller typed; those read back as 12:00 AM on that date.
 */
import { zonedTimeToUtc } from '@/lib/dropSchedule';

export interface WallClockFields { date: string; time: string }

function pad(n: number) { return String(n).padStart(2, '0'); }

export function deviceTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

/** A date-only value from before time pickers: no stored zone, exactly UTC midnight. */
export function isLegacyDateOnly(iso: string, storedZone: string | null | undefined): boolean {
  if (storedZone) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime())
    && d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}

/** The wall-clock reading of `instant` in `zone`, as YYYY-MM-DD / HH:MM. */
export function wallClockInZone(instant: Date, zone: string): WallClockFields {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return { date: `${m.year}-${m.month}-${m.day}`, time: `${m.hour === '24' ? '00' : m.hour}:${m.minute}` };
}

/** Form fields for a stored instant (null when unset). */
export function fieldsFromStored(iso: string | null | undefined, storedZone: string | null | undefined, zone: string): WallClockFields | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (isLegacyDateOnly(iso, storedZone)) return { date: d.toISOString().slice(0, 10), time: '00:00' };
  return wallClockInZone(d, storedZone || zone);
}

export function parseFields(date: string, time: string) {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!dm || !tm) return null;
  const year = Number(dm[1]), month = Number(dm[2]), day = Number(dm[3]);
  const hour = Number(tm[1]), minute = Number(tm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  // Reject impossible days (e.g. Feb 30) rather than rolling them over.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1) return null;
  return { year, month, day, hour, minute };
}

/** UTC instant for a wall-clock date + time in `zone`, or null if the fields don't parse. */
export function instantFromFields(date: string, time: string, zone: string): Date | null {
  const parts = parseFields(date, time);
  return parts ? zonedTimeToUtc(parts, zone) : null;
}

/** Now, rounded down to the half hour, in `zone` (matches the picker's time chips). */
export function defaultStartFields(zone: string, now = new Date()): WallClockFields {
  const f = wallClockInZone(now, zone);
  const [h, m] = f.time.split(':').map(Number);
  return { date: f.date, time: `${pad(h)}:${m < 30 ? '00' : '30'}` };
}

/** Same time `days` later (calendar arithmetic on the wall clock). */
export function addDays(fields: WallClockFields, days: number): WallClockFields {
  const [y, mo, d] = fields.date.split('-').map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d + days));
  return { date: `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`, time: fields.time };
}

/** Short zone name at an instant, e.g. "EDT", "GMT+5:30". */
export function zoneAbbreviation(zone: string, at = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName');
    return part?.value ?? zone;
  } catch {
    return zone;
  }
}

/** "Oct 20, 2026, 9:00 AM EDT"; date-only legacy values stay "Oct 20, 2026". */
export function formatScheduleInstant(iso: string, storedZone: string | null | undefined, zone = deviceTimeZone()): string {
  const d = new Date(iso);
  if (isLegacyDateOnly(iso, storedZone)) {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  const tz = storedZone || zone;
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  return `${date}, ${time} ${zoneAbbreviation(tz, d)}`;
}

/** State behind the "Active dates" form section (components/discounts/ActiveDatesFields). */
export interface ScheduleForm {
  startDate: string; startTime: string;
  hasEnd: boolean; endDate: string; endTime: string;
  zone: string;
  /** The stored start was empty ("active immediately"); stays empty unless the seller picks a start. */
  startWasEmpty: boolean;
  startTouched: boolean;
  /** Anything in the section changed; an untouched section sends nothing so saved values never drift. */
  touched: boolean;
}

export function scheduleFormFromStored(
  startsAt: string | null | undefined, endsAt: string | null | undefined, storedZone: string | null | undefined,
  now = new Date(),
): ScheduleForm {
  const zone = storedZone || deviceTimeZone();
  const start = fieldsFromStored(startsAt, storedZone, zone) ?? defaultStartFields(zone, now);
  const end = fieldsFromStored(endsAt, storedZone, zone);
  const endDefault = end ?? addDays(start, 7);
  return {
    startDate: start.date, startTime: start.time,
    hasEnd: !!end, endDate: endDefault.date, endTime: endDefault.time,
    zone, startWasEmpty: !startsAt, startTouched: false, touched: false,
  };
}

export type SchedulePayload =
  | { error: string }
  | { values: { startsAt?: string | null; endsAt?: string | null; scheduleTimeZone?: string } };

export function schedulePayload(f: ScheduleForm): SchedulePayload {
  const start = instantFromFields(f.startDate, f.startTime, f.zone);
  if (!start) return { error: 'Choose a start date and time.' };
  const end = f.hasEnd ? instantFromFields(f.endDate, f.endTime, f.zone) : null;
  if (f.hasEnd && !end) return { error: 'Choose an end date and time.' };
  if (end && end.getTime() <= start.getTime()) return { error: 'The end must be after the start.' };
  if (!f.touched) return { values: {} };
  return {
    values: {
      startsAt: f.startWasEmpty && !f.startTouched ? null : start.toISOString(),
      endsAt: end ? end.toISOString() : null,
      scheduleTimeZone: f.zone,
    },
  };
}

/** One-line summary for the form's summary card. */
export function scheduleSummary(f: ScheduleForm): string {
  const immediate = f.startWasEmpty && !f.startTouched;
  if (immediate && !f.hasEnd) return 'Active immediately, no end date';
  // Abbreviation at each instant, so a window crossing a DST change reads "EDT" → "EST".
  const abbrAt = (date: string, time: string) =>
    zoneAbbreviation(f.zone, instantFromFields(date, time, f.zone) ?? new Date());
  const startPart = immediate ? 'Starts immediately' : `Starts ${formatFields(f.startDate, f.startTime)} ${abbrAt(f.startDate, f.startTime)}`;
  const endPart = f.hasEnd ? `Ends ${formatFields(f.endDate, f.endTime)} ${abbrAt(f.endDate, f.endTime)}` : 'No end date';
  return `${startPart} · ${endPart}`;
}

/** "Mon, Oct 13 · 9:30 AM" for a form's wall-clock fields (empty when they don't parse). */
export function formatFields(date: string, time: string): string {
  const p = parseFields(date, time);
  if (!p) return '';
  const asUtc = new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute));
  const day = asUtc.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const clock = asUtc.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  return `${day} · ${clock}`;
}
