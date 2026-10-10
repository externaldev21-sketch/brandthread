import { describe, expect, it } from 'vitest';
import {
  clampDate, dateToMdy, dateToHm, dateToYmd, dateToYmdHm, defaultPickerValue, formatFieldValue,
  fromWebInputValue, hmToDate, isoToDate, mdyToDate, mergeDayAndTime, startOfToday, toWebInputValue, ymdHmToDate, ymdToDate,
} from '@/lib/dateTimeField';

describe('dateTimeField string <-> Date helpers', () => {
  it('round-trips YYYY-MM-DD in local time', () => {
    const d = ymdToDate('2026-10-12');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(9);
    expect(d!.getDate()).toBe(12);
    expect(d!.getHours()).toBe(0);
    expect(dateToYmd(d!)).toBe('2026-10-12');
  });

  it('rejects blank and impossible dates', () => {
    expect(ymdToDate('')).toBeNull();
    expect(ymdToDate(null)).toBeNull();
    expect(ymdToDate('12/10/2026')).toBeNull();
    expect(ymdToDate('2025-02-30')).toBeNull();
    expect(ymdToDate('2025-13-01')).toBeNull();
  });

  it('accepts the date part of an ISO string', () => {
    expect(dateToYmd(ymdToDate('2026-03-04T10:00:00Z')!)).toBe('2026-03-04');
  });

  it('round-trips MM/DD/YYYY birthdays', () => {
    expect(dateToMdy(mdyToDate('04/09/1998')!)).toBe('04/09/1998');
    expect(dateToYmd(mdyToDate('12/31/2000')!)).toBe('2000-12-31');
    expect(mdyToDate('02/30/2001')).toBeNull();
    expect(mdyToDate('4/9/1998')).toBeNull();
    expect(mdyToDate('')).toBeNull();
  });

  it('round-trips HH:MM on the base day', () => {
    const base = new Date(2026, 0, 5, 22, 10);
    const d = hmToDate('9:05', base)!;
    expect(d.getDate()).toBe(5);
    expect(dateToHm(d)).toBe('09:05');
    expect(hmToDate('24:00')).toBeNull();
    expect(hmToDate('12:60')).toBeNull();
    expect(hmToDate('noon')).toBeNull();
  });

  it('round-trips YYYY-MM-DD HH:MM with either separator', () => {
    expect(dateToYmdHm(ymdHmToDate('2026-11-01 18:30')!)).toBe('2026-11-01 18:30');
    expect(dateToYmdHm(ymdHmToDate('2026-11-01T07:00')!)).toBe('2026-11-01 07:00');
    expect(ymdHmToDate('2026-11-01')).toBeNull();
  });

  it('parses ISO instants and rejects garbage', () => {
    expect(isoToDate('2026-01-01T00:00:00Z')!.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(isoToDate('nope')).toBeNull();
    expect(isoToDate('  ')).toBeNull();
  });
});

describe('web input values', () => {
  const d = new Date(2026, 4, 7, 8, 45);
  it('formats per mode', () => {
    expect(toWebInputValue(d, 'date')).toBe('2026-05-07');
    expect(toWebInputValue(d, 'time')).toBe('08:45');
    expect(toWebInputValue(d, 'datetime')).toBe('2026-05-07T08:45');
    expect(toWebInputValue(null, 'date')).toBe('');
  });

  it('parses per mode, keeping the other half from base', () => {
    const date = fromWebInputValue('2026-06-01', 'date', d)!;
    expect(dateToYmdHm(date)).toBe('2026-06-01 08:45');
    const time = fromWebInputValue('17:15', 'time', d)!;
    expect(dateToYmdHm(time)).toBe('2026-05-07 17:15');
    expect(dateToYmdHm(fromWebInputValue('2026-06-01T09:00', 'datetime')!)).toBe('2026-06-01 09:00');
    expect(fromWebInputValue('', 'date')).toBeNull();
    expect(fromWebInputValue('bad', 'time')).toBeNull();
  });
});

describe('picker defaults and bounds', () => {
  const min = new Date(2026, 0, 10);
  const max = new Date(2026, 0, 20);
  it('clamps into [min, max]', () => {
    expect(clampDate(new Date(2026, 0, 1), min, max).getTime()).toBe(min.getTime());
    expect(clampDate(new Date(2026, 1, 1), min, max).getTime()).toBe(max.getTime());
    const mid = new Date(2026, 0, 15);
    expect(clampDate(mid, min, max)).toBe(mid);
    expect(clampDate(mid)).toBe(mid);
  });

  it('starts date mode at local midnight and time modes on the next quarter hour', () => {
    const now = new Date(2026, 0, 15, 9, 7, 30);
    expect(dateToYmdHm(defaultPickerValue('date', null, null, now))).toBe('2026-01-15 00:00');
    expect(dateToYmdHm(defaultPickerValue('datetime', null, null, now))).toBe('2026-01-15 09:15');
    expect(dateToYmdHm(defaultPickerValue('time', null, null, new Date(2026, 0, 15, 9, 45)))).toBe('2026-01-15 09:45');
    expect(defaultPickerValue('date', min, max, new Date(2025, 0, 1)).getTime()).toBe(min.getTime());
  });

  it('startOfToday is local midnight', () => {
    expect(dateToYmdHm(startOfToday(new Date(2026, 6, 4, 13, 2)))).toBe('2026-07-04 00:00');
  });

  it('merges a day with a time of day', () => {
    expect(dateToYmdHm(mergeDayAndTime(new Date(2026, 2, 3, 23, 59), new Date(2020, 0, 1, 6, 30)))).toBe('2026-03-03 06:30');
  });
});

describe('formatFieldValue', () => {
  const d = new Date(2026, 9, 12, 21, 5);
  it('formats en-US values like the system compact button', () => {
    expect(formatFieldValue(d, 'date', 'en-US')).toBe('Oct 12, 2026');
    expect(formatFieldValue(d, 'time', 'en-US')).toMatch(/^9:05\sPM$/);
    expect(formatFieldValue(d, 'datetime', 'en-US')).toMatch(/^Oct 12, 2026, 9:05\sPM$/);
    expect(formatFieldValue(null, 'date')).toBe('');
  });
});
