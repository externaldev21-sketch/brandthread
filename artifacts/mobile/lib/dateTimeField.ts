/**
 * Pure helpers behind components/ui/NativeDateTimeField.tsx.
 *
 * Screens keep storing dates the way they always have (`YYYY-MM-DD`,
 * `HH:MM`, `YYYY-MM-DD HH:MM` wall-clock strings or ISO instants); these
 * convert between those strings and the `Date` the native picker wants, in
 * the device's local time. Kept free of react-native imports so vitest runs
 * them directly.
 */

export type DateTimeFieldMode = 'date' | 'time' | 'datetime';

const pad = (n: number) => String(n).padStart(2, '0');

function validDate(d: Date | null | undefined): d is Date {
  return !!d && !Number.isNaN(d.getTime());
}

/** `YYYY-MM-DD` → local midnight Date, or null when blank/invalid (rejects 2025-02-30). */
export function ymdToDate(value: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((value ?? '').trim());
  if (!m) return null;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** Local Date → `YYYY-MM-DD`. */
export function dateToYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `MM/DD/YYYY` (the sign-up date-of-birth format, lib/ageGate.ts) → local Date, or null. */
export function mdyToDate(value: string | null | undefined): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((value ?? '').trim());
  return m ? ymdToDate(`${m[3]}-${m[1]}-${m[2]}`) : null;
}

/** Local Date → `MM/DD/YYYY`. */
export function dateToMdy(d: Date): string {
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}

/** `HH:MM` (24h) → today's Date at that time (or on `base`'s day), or null when blank/invalid. */
export function hmToDate(value: string | null | undefined, base: Date = new Date()): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim());
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0);
  return d;
}

/** Local Date → `HH:MM` (24h). */
export function dateToHm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `YYYY-MM-DD HH:MM` (or `T` separator) → local Date, or null when blank/invalid. */
export function ymdHmToDate(value: string | null | undefined): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}:\d{2})/.exec((value ?? '').trim());
  if (!m) return null;
  const day = ymdToDate(m[1]);
  return day ? hmToDate(m[2], day) : null;
}

/** Local Date → `YYYY-MM-DD HH:MM`. */
export function dateToYmdHm(d: Date): string {
  return `${dateToYmd(d)} ${dateToHm(d)}`;
}

/** ISO instant (or any Date-parseable string) → Date, or null when blank/invalid. */
export function isoToDate(value: string | null | undefined): Date | null {
  if (!value || !value.trim()) return null;
  const d = new Date(value);
  return validDate(d) ? d : null;
}

/** Value attribute for the web `<input type="date|time|datetime-local">`. */
export function toWebInputValue(d: Date | null, mode: DateTimeFieldMode): string {
  if (!validDate(d)) return '';
  if (mode === 'date') return dateToYmd(d);
  if (mode === 'time') return dateToHm(d);
  return `${dateToYmd(d)}T${dateToHm(d)}`;
}

/**
 * Parse what a web `<input>` (or the plain-text fallback) produced. For time
 * mode the date part comes from `base` so editing the time keeps the day.
 */
export function fromWebInputValue(raw: string, mode: DateTimeFieldMode, base: Date | null = null): Date | null {
  const value = raw.trim();
  if (!value) return null;
  if (mode === 'date') {
    const day = ymdToDate(value);
    if (!day) return null;
    if (validDate(base)) day.setHours(base.getHours(), base.getMinutes(), 0, 0);
    return day;
  }
  if (mode === 'time') return hmToDate(value, validDate(base) ? base : new Date());
  return ymdHmToDate(value);
}

/** Local midnight today — the usual `minimumDate` for a future date. */
export function startOfToday(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Keep `d` inside [min, max]. */
export function clampDate(d: Date, min?: Date | null, max?: Date | null): Date {
  if (validDate(min) && d.getTime() < min.getTime()) return new Date(min.getTime());
  if (validDate(max) && d.getTime() > max.getTime()) return new Date(max.getTime());
  return d;
}

/**
 * The value an empty field starts from when tapped: now (on the next quarter
 * hour for time modes, local midnight for dates), kept inside the bounds.
 */
export function defaultPickerValue(mode: DateTimeFieldMode, min?: Date | null, max?: Date | null, now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  if (mode === 'date') {
    d.setHours(0, 0, 0, 0);
  } else {
    d.setSeconds(0, 0);
    const rem = d.getMinutes() % 15;
    if (rem) d.setMinutes(d.getMinutes() + (15 - rem));
  }
  return clampDate(d, min, max);
}

/** Merge a picked calendar day (from `day`) with the time of day of `time`. */
export function mergeDayAndTime(day: Date, time: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes(), 0, 0);
}

/** How the value reads in the row's pill on Android, web text and the fallback ("Oct 12, 2026", "9:30 AM"). */
export function formatFieldValue(d: Date | null, mode: DateTimeFieldMode, locale?: string): string {
  if (!validDate(d)) return '';
  const date = d.toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  if (mode === 'date') return date;
  if (mode === 'time') return time;
  return `${date}, ${time}`;
}
