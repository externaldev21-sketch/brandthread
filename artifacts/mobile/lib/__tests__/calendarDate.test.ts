import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { formatCalendarDate, isCalendarDate } from '@/lib/calendarDate';

const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'America/Los_Angeles'; });
afterAll(() => { process.env.TZ = originalTz; });

describe('formatCalendarDate', () => {
  it('shows the stored day west of UTC (date-only string)', () => {
    expect(formatCalendarDate('2026-12-01', { month: 'short', day: 'numeric', year: 'numeric' })).toBe('Dec 1, 2026');
  });
  it('shows the stored day for midnight-UTC timestamps', () => {
    expect(formatCalendarDate('2026-12-01T00:00:00.000Z', { month: 'long', day: 'numeric', year: 'numeric' })).toBe('December 1, 2026');
  });
  it('does not flip the month on the 1st', () => {
    expect(formatCalendarDate('2026-12-01T00:00:00Z', { month: 'short', year: 'numeric' })).toBe('Dec 2026');
  });
  it('keeps real timestamps in the viewer zone', () => {
    // 03:00 UTC on Dec 2 is still Dec 1 in Los Angeles.
    expect(formatCalendarDate('2026-12-02T03:00:00.000Z')).toBe('Dec 1, 2026');
  });
  it('is empty for missing or invalid values', () => {
    expect(formatCalendarDate(undefined)).toBe('');
    expect(formatCalendarDate('not a date')).toBe('');
  });
  it('detects calendar dates', () => {
    expect(isCalendarDate('2026-11-01')).toBe(true);
    expect(isCalendarDate('2026-11-01T00:00:00.000Z')).toBe(true);
    expect(isCalendarDate('2026-11-01T10:00:00.000Z')).toBe(false);
  });
});

import { futureDateInputError, toDateInputValue } from '@/lib/calendarDate';

describe('date inputs', () => {
  it('round-trips the stored calendar day', () => {
    expect(toDateInputValue('2026-11-03T00:00:00.000Z')).toBe('2026-11-03');
    expect(toDateInputValue('2026-11-03')).toBe('2026-11-03');
    expect(toDateInputValue(null)).toBe('');
  });
  it('uses the local day for real timestamps', () => {
    expect(toDateInputValue('2026-11-04T03:00:00.000Z')).toBe('2026-11-03');
  });
  it('validates format, existence and the future', () => {
    const now = new Date(2026, 9, 6, 12);
    expect(futureDateInputError('', now)).toBeNull();
    expect(futureDateInputError('next week', now)).toBe('Use the format YYYY-MM-DD.');
    expect(futureDateInputError('2026-02-30', now)).toBe('That date doesn’t exist.');
    expect(futureDateInputError('2026-10-05', now)).toBe('Pick today or a later date.');
    expect(futureDateInputError('2026-10-06', now)).toBeNull();
    expect(futureDateInputError('2027-01-15', now)).toBeNull();
  });
});
