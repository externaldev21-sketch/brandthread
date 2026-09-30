import { describe, expect, it } from 'vitest';
import { buildPreviewSellerAnalytics, type PreviewSellerChartRange } from './previewSellerChartData';
import { bucketLabel } from './sellerHomeChartLabels';

// A fixed "now" so bucket counts/labels are deterministic regardless of when
// the suite runs. Sep 29 2026 matches the date this bug was reported on.
const NOW = new Date(2026, 8, 29, 15, 30); // local: Sep 29 2026, 3:30pm

const RANGES: PreviewSellerChartRange[] = ['today', 'week', 'month', 'year', 'all'];

describe('buildPreviewSellerAnalytics — fresh mode (zero-state)', () => {
  for (const range of RANGES) {
    it(`${range}: every bucket is a flat $0 baseline, never fabricated activity`, () => {
      const data = buildPreviewSellerAnalytics(range, 'fresh', NOW);
      expect(data.totalCents).toBe(0);
      expect(data.netCents).toBe(0);
      expect(data.orderCount).toBe(0);
      expect(data.visitorCount).toBe(0);
      expect(data.previous).toEqual({ totalCents: 0, netCents: 0, orderCount: 0, visitorCount: 0 });
      expect(data.buckets.length).toBeGreaterThan(0);
      for (const bucket of data.buckets) {
        expect(bucket.totalCents).toBe(0);
        expect(bucket.netCents).toBe(0);
        expect(bucket.orderCount).toBe(0);
        expect(bucket.visitorCount).toBe(0);
      }
    });
  }

  it('still produces correct, range-appropriate x-axis labels even though the data is flat', () => {
    const week = buildPreviewSellerAnalytics('week', 'fresh', NOW);
    const weekLabels = week.buckets.map((b) => bucketLabel(b.bucket, 'week'));
    // Sunday-first calendar week — the app's convention, not ISO Monday-first.
    expect(weekLabels).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

    const year = buildPreviewSellerAnalytics('year', 'fresh', NOW);
    const yearLabels = year.buckets.map((b) => bucketLabel(b.bucket, 'year'));
    // NOW is Sep 2026, so the calendar year so far is Jan..Sep — 9 distinct
    // months, never the same one repeated, and never a future month.
    expect(yearLabels).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']);
  });
});

describe('buildPreviewSellerAnalytics — demo mode (populated)', () => {
  it('produces a real, non-zero total with a real previous-period comparison', () => {
    for (const range of RANGES) {
      const data = buildPreviewSellerAnalytics(range, 'demo', NOW);
      expect(data.totalCents).toBeGreaterThan(0);
      expect(data.orderCount).toBeGreaterThan(0);
      expect(data.previous.totalCents).toBeGreaterThan(0);
    }
  });

  it('the data series actually differs in shape between ranges (not the same dataset redrawn)', () => {
    const perRange = RANGES.map((range) => buildPreviewSellerAnalytics(range, 'demo', NOW).buckets.map((b) => b.totalCents));
    // Bucket counts differ per range granularity.
    expect(new Set(perRange.map((series) => series.length)).size).toBeGreaterThan(1);
    // No two ranges produce an identical value series.
    const serialized = perRange.map((series) => JSON.stringify(series));
    expect(new Set(serialized).size).toBe(serialized.length);
  });

  it('is deterministic — same range/mode/now always yields the same series (no Math.random jitter)', () => {
    const a = buildPreviewSellerAnalytics('month', 'demo', NOW);
    const b = buildPreviewSellerAnalytics('month', 'demo', NOW);
    expect(a.buckets).toEqual(b.buckets);
    expect(a.totalCents).toBe(b.totalCents);
  });

  it('"today" produces 24 distinct hourly buckets forming a real intraday curve, not a flat repeat', () => {
    const data = buildPreviewSellerAnalytics('today', 'demo', NOW);
    expect(data.buckets).toHaveLength(24);
    const values = data.buckets.map((b) => b.totalCents);
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it('"year" produces the calendar year so far (Jan..current month), never a trailing 12-month window or a future month', () => {
    const data = buildPreviewSellerAnalytics('year', 'demo', NOW);
    // NOW is Sep 2026 — Jan through Sep is 9 months, not 12; Oct-Dec haven't
    // happened yet and must never be drawn.
    expect(data.buckets).toHaveLength(9);
    const labels = data.buckets.map((b) => bucketLabel(b.bucket, 'year'));
    expect(labels).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']);
    expect(new Set(labels).size).toBe(9); // never the same month repeated
  });

  it('"month" produces one bucket per day of the current calendar month, labeled "Mon D"', () => {
    const data = buildPreviewSellerAnalytics('month', 'demo', NOW);
    expect(data.buckets).toHaveLength(30); // September has 30 days
    const labels = data.buckets.map((b) => bucketLabel(b.bucket, 'month'));
    expect(labels).toEqual(Array.from({ length: 30 }, (_, i) => `Sep ${i + 1}`));
  });

  it('"week" produces Sunday through Saturday of the current calendar week (Sunday-first)', () => {
    const data = buildPreviewSellerAnalytics('week', 'demo', NOW);
    expect(data.buckets).toHaveLength(7);
    const labels = data.buckets.map((b) => bucketLabel(b.bucket, 'week'));
    expect(labels).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('trafficSources rows always sum to visitorCount, and sharePercent is always derived from that same total', () => {
    for (const range of RANGES) {
      const data = buildPreviewSellerAnalytics(range, 'demo', NOW);
      const rowSum = data.trafficSources.reduce((sum, row) => sum + row.count, 0);
      expect(rowSum).toBe(data.visitorCount);
      for (const row of data.trafficSources) {
        const expectedShare = data.visitorCount > 0 ? Math.round((row.count / data.visitorCount) * 1000) / 10 : 0;
        expect(row.sharePercent).toBe(expectedShare);
      }
    }
  });
});
