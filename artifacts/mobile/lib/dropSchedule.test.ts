import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '@/lib/dropSchedule';

describe('zonedTimeToUtc', () => {
  it('converts a wall-clock time in Asia/Kolkata (UTC+5:30, non-whole-hour offset)', () => {
    // 2:00 PM IST on 2026-06-15 should be 08:30 UTC the same day.
    const utc = zonedTimeToUtc(
      { year: 2026, month: 6, day: 15, hour: 14, minute: 0 },
      'Asia/Kolkata',
    );
    expect(utc.toISOString()).toBe('2026-06-15T08:30:00.000Z');
  });

  it('converts a wall-clock time in America/New_York during DST (UTC-4)', () => {
    // July is EDT (UTC-4). 10:00 AM EDT -> 14:00 UTC.
    const utc = zonedTimeToUtc(
      { year: 2026, month: 7, day: 15, hour: 10, minute: 0 },
      'America/New_York',
    );
    expect(utc.toISOString()).toBe('2026-07-15T14:00:00.000Z');
  });

  it('converts a wall-clock time in America/New_York outside DST (UTC-5)', () => {
    // January is EST (UTC-5). 10:00 AM EST -> 15:00 UTC.
    const utc = zonedTimeToUtc(
      { year: 2026, month: 1, day: 15, hour: 10, minute: 0 },
      'America/New_York',
    );
    expect(utc.toISOString()).toBe('2026-01-15T15:00:00.000Z');
  });

  it('converts a wall-clock time in UTC unchanged', () => {
    const utc = zonedTimeToUtc(
      { year: 2026, month: 3, day: 1, hour: 9, minute: 30 },
      'UTC',
    );
    expect(utc.toISOString()).toBe('2026-03-01T09:30:00.000Z');
  });

  it('converts a wall-clock time in Asia/Tokyo (UTC+9, no DST)', () => {
    const utc = zonedTimeToUtc(
      { year: 2026, month: 12, day: 25, hour: 20, minute: 0 },
      'Asia/Tokyo',
    );
    expect(utc.toISOString()).toBe('2026-12-25T11:00:00.000Z');
  });
});
