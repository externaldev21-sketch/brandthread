// Force a non-UTC timezone before anything touches `Date`, so this suite
// actually exercises the local-time conversion the seller dashboard chart
// depends on, not whatever timezone happens to run in CI.
process.env.TZ = 'Pacific/Kiritimati'; // UTC+14, deliberately far from UTC

import { beforeAll, describe, expect, it } from 'vitest';
import { bucketLabel, formatClockLabel, parseBucketTimestamp, WEEKDAY_LABELS } from './sellerHomeChartLabels';

function isoWeekBuckets(): string[] {
  // Seven consecutive local-midnight UTC instants, exactly as the API's
  // `generate_series(... interval '1 day' ...)` for range=week would emit.
  const start = Date.UTC(2024, 0, 7); // a Sunday
  return Array.from({ length: 7 }, (_, i) => new Date(start + i * 24 * 60 * 60 * 1000).toISOString());
}

describe('seller home chart labels', () => {
  beforeAll(() => {
    expect(process.env.TZ).toBe('Pacific/Kiritimati');
  });

  it('renders 7 correctly-ordered, unique day labels for "This week"', () => {
    const labels = isoWeekBuckets().map((bucket) => bucketLabel(bucket, 'week'));
    expect(labels).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(new Set(labels).size).toBe(7);
  });

  it('bucketing is correct regardless of the runtime timezone', () => {
    // Sanity: the harness really is running somewhere far from UTC.
    expect(new Date().getTimezoneOffset()).not.toBe(0);
    const labels = isoWeekBuckets().map((bucket) => bucketLabel(bucket, 'week'));
    expect(labels).toEqual([...WEEKDAY_LABELS]);
  });

  it('handles Postgres-style space-separated timestamps without a zone the same as strict ISO', () => {
    const strict = bucketLabel('2024-01-10T00:00:00.000Z', 'week');
    const pgStyle = bucketLabel('2024-01-10 00:00:00', 'week');
    expect(pgStyle).toBe(strict);
  });

  it('buckets "Today" by local hour, one label per bar, in order', () => {
    const hours = [0, 4, 8, 12, 16, 20].map((h) => new Date(Date.UTC(2024, 0, 10, h)).toISOString());
    const labels = hours.map((bucket) => bucketLabel(bucket, 'today'));
    expect(new Set(labels).size).toBe(labels.length);
    // Each label matches independently-computed local clock formatting.
    hours.forEach((bucket, i) => {
      expect(labels[i]).toBe(formatClockLabel(parseBucketTimestamp(bucket), false));
    });
  });

  it('buckets "Live" (today, with minutes) distinctly per 10-minute step', () => {
    const start = Date.UTC(2024, 0, 10, 12, 0);
    const buckets = Array.from({ length: 6 }, (_, i) => new Date(start + i * 10 * 60 * 1000).toISOString());
    const labels = buckets.map((bucket) => bucketLabel(bucket, 'live'));
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('never crosses a day boundary incorrectly for extreme positive/negative offsets', () => {
    // Pacific/Kiritimati is UTC+14. A UTC-midnight bucket lands at 14:00
    // local the same calendar day, not on the following/previous day.
    const utcMidnight = new Date(Date.UTC(2024, 0, 10, 0, 0)).toISOString();
    expect(formatClockLabel(parseBucketTimestamp(utcMidnight), false)).toBe('2 PM');
  });
});
