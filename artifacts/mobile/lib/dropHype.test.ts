import { describe, expect, it } from 'vitest';
import { formatDayKey, isUpcomingDrop } from './dropHype';
import { previewDropHype, previewSellerDrops } from './previewSellerDrops';

const NOW = new Date(2026, 9, 13, 12, 0, 0);

describe('drop hype helpers', () => {
  it('treats future releases and undated draft/active drops as upcoming', () => {
    expect(isUpcomingDrop({ status: 'active', releaseAt: new Date(2026, 9, 14).toISOString() }, NOW)).toBe(true);
    expect(isUpcomingDrop({ status: 'closed', releaseAt: new Date(2026, 9, 14).toISOString() }, NOW)).toBe(true);
    expect(isUpcomingDrop({ status: 'active', releaseAt: new Date(2026, 9, 12).toISOString() }, NOW)).toBe(false);
    expect(isUpcomingDrop({ status: 'draft', releaseAt: null }, NOW)).toBe(true);
    expect(isUpcomingDrop({ status: 'active' }, NOW)).toBe(true);
    expect(isUpcomingDrop({ status: 'fulfilled', releaseAt: null }, NOW)).toBe(false);
  });

  it('formats day keys without a timezone shift', () => {
    expect(formatDayKey('2026-10-03')).toBe('Oct 3');
  });

  it('preview: demo has upcoming and past drops with a consistent cumulative series; fresh has none', () => {
    const drops = previewSellerDrops('demo', NOW);
    expect(drops.filter((d) => isUpcomingDrop(d, NOW)).length).toBe(2);
    expect(drops.filter((d) => !isUpcomingDrop(d, NOW)).length).toBe(2);
    const hype = previewDropHype('preview-drop-night-shift', 'demo', NOW)!;
    expect(hype.total).toBe(hype.series[hype.series.length - 1].cumulative);
    expect(hype.today).toBeGreaterThan(0);
    expect(hype.followers).toBeLessThanOrEqual(hype.total);
    for (let i = 1; i < hype.series.length; i++) expect(hype.series[i].cumulative).toBeGreaterThanOrEqual(hype.series[i - 1].cumulative);
    expect(previewSellerDrops('fresh', NOW)).toEqual([]);
    expect(previewDropHype('preview-drop-night-shift', 'fresh', NOW)).toBeNull();
  });
});
