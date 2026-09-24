import { describe, expect, it } from 'vitest';
import { formatCentsCompact, formatCompactCount } from '@/lib/compactFormat';
import { computeMetricChange } from '@/lib/sellerMetricChange';

describe('formatCentsCompact', () => {
  it('shows the exact amount under $1,000, never truncated', () => {
    expect(formatCentsCompact(0)).toBe('$0.00');
    expect(formatCentsCompact(84200)).toBe('$842.00');
    expect(formatCentsCompact(99999)).toBe('$999.99');
  });

  it('compacts thousands and millions instead of truncating', () => {
    expect(formatCentsCompact(1_240_000)).toBe('$12.4K'); // $12,400.00
    expect(formatCentsCompact(120_000_000)).toBe('$1.2M'); // $1,200,000.00
    expect(formatCentsCompact(1_000_000_000_00)).toBe('$1.0B');
  });

  it('drops the decimal once the compact value reaches 3 digits, to stay short', () => {
    expect(formatCentsCompact(1_230_000)).toBe('$12.3K'); // $12,300.00 -> 1 decimal
    expect(formatCentsCompact(12_300_000)).toBe('$123K'); // $123,000.00 -> 0 decimals
  });

  it('handles negative amounts (refund-heavy periods)', () => {
    expect(formatCentsCompact(-1_240_000)).toBe('-$12.4K');
  });
});

describe('formatCompactCount', () => {
  it('shows exact counts under 1,000', () => {
    expect(formatCompactCount(0)).toBe('0');
    expect(formatCompactCount(842)).toBe('842');
  });

  it('compacts large counts', () => {
    expect(formatCompactCount(8400)).toBe('8.4K');
    expect(formatCompactCount(1_200_000)).toBe('1.2M');
  });
});

describe('computeMetricChange', () => {
  it('reports flat with 0% when nothing changed', () => {
    expect(computeMetricChange(500, 500)).toEqual({ direction: 'flat', percent: 0 });
    expect(computeMetricChange(0, 0)).toEqual({ direction: 'flat', percent: 0 });
  });

  it('computes a real up/down percent against the previous period', () => {
    expect(computeMetricChange(150, 100)).toEqual({ direction: 'up', percent: 50 });
    expect(computeMetricChange(50, 100)).toEqual({ direction: 'down', percent: -50 });
  });

  it('reports "New" (null percent) rather than a fabricated percentage when the previous period was zero', () => {
    const change = computeMetricChange(200, 0);
    expect(change.direction).toBe('up');
    expect(change.percent).toBeNull();
  });

  it('rounds to one decimal place', () => {
    expect(computeMetricChange(133, 100).percent).toBe(33);
    expect(computeMetricChange(101, 3)).toMatchObject({ direction: 'up' });
  });
});
