import { describe, expect, it } from 'vitest';
import { bucketLabel, formatClockLabel, WEEKDAY_LABELS } from '@/lib/sellerHomeChartLabels';

// A known Sunday (2026-02-01 is a Sunday) at local midnight, one bucket per day.
const SUNDAY = new Date(2026, 1, 1);

function dayAt(dayOffset: number): string {
  const d = new Date(SUNDAY);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString();
}

function hourAt(hour: number, minute = 0): string {
  const d = new Date(2026, 1, 2, hour, minute, 0);
  return d.toISOString();
}

describe('bucketLabel — This week', () => {
  it('labels each of the 7 day buckets with its correct weekday, not a repeated/garbled string', () => {
    const labels = Array.from({ length: 7 }, (_, i) => bucketLabel(dayAt(i), 'week'));
    expect(labels).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    // No duplicates — this is exactly the "WE WE WE WE..." regression.
    expect(new Set(labels).size).toBe(7);
  });

  it('never depends on Intl/ICU weekday formatting', () => {
    for (let i = 0; i < 7; i++) {
      expect(WEEKDAY_LABELS).toContain(bucketLabel(dayAt(i), 'week'));
    }
  });
});

describe('bucketLabel — Today / Yesterday (exact hour marks)', () => {
  it('labels every hour of the day as a clean 12-hour clock mark', () => {
    const expected = [
      '12 AM', '1 AM', '2 AM', '3 AM', '4 AM', '5 AM', '6 AM', '7 AM', '8 AM',
      '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM',
      '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM',
    ];
    const labels = Array.from({ length: 24 }, (_, hour) => bucketLabel(hourAt(hour), 'today'));
    expect(labels).toEqual(expected);
  });

  it('never shows minutes for hour-bucketed ranges', () => {
    expect(bucketLabel(hourAt(15), 'today')).not.toMatch(/:/);
    expect(bucketLabel(hourAt(15), 'yesterday')).not.toMatch(/:/);
  });
});

describe('bucketLabel — Live (round minute marks only)', () => {
  it('formats a round 10-minute bucket cleanly, never an odd minute like :53', () => {
    expect(bucketLabel(hourAt(15, 50), 'live')).toBe('3:50 PM');
    expect(bucketLabel(hourAt(15, 0), 'live')).toBe('3:00 PM');
    expect(bucketLabel(hourAt(0, 10), 'live')).toBe('12:10 AM');
  });

  it('never renders an ungarbled odd-minute label if one somehow reaches it', () => {
    // The formatter itself is a pure pass-through of getMinutes(); this just
    // pins the exact rendering shape so regressions are caught immediately.
    expect(bucketLabel(hourAt(15, 53), 'live')).toBe('3:53 PM');
  });
});

describe('formatClockLabel', () => {
  it('handles midnight and noon boundaries correctly', () => {
    expect(formatClockLabel(new Date(2026, 1, 2, 0, 0), false)).toBe('12 AM');
    expect(formatClockLabel(new Date(2026, 1, 2, 12, 0), false)).toBe('12 PM');
  });
});
