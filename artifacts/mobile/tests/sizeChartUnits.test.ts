import { describe, expect, it } from 'vitest';
import { chartSummary, convertSizeChartUnit } from '@/lib/sizeChartUnits';

const chart = { unit: 'inches' as const, columns: ['Chest', 'Fit'], rows: [{ size: 'M', values: ['38-40', 'Relaxed'] }] };

describe('sizeChartUnits', () => {
  it('converts numbers and ranges, leaves text', () => {
    expect(convertSizeChartUnit(chart, 'cm').rows[0].values).toEqual(['96.5-101.5', 'Relaxed']);
  });
  it('is a no-op for the same unit', () => {
    expect(convertSizeChartUnit(chart, 'inches').rows).toEqual(chart.rows);
  });
  it('summarises with correct plurals', () => {
    expect(chartSummary(chart)).toBe('1 size · 2 measurements');
  });
});
