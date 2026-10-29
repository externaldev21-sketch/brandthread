import { afterEach, describe, expect, it } from 'vitest';
import { previewDropHype } from './previewSellerDrops';

const originalTz = process.env.TZ;

describe('previewDropHype series dates (audit)', () => {
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('labels one consecutive calendar day per entry across a DST change', () => {
    process.env.TZ = 'America/New_York';
    // 00:30 the day after the spring-forward night (Mar 8 2026 was 23h long).
    const now = new Date(2026, 2, 9, 0, 30);
    const hype = previewDropHype('preview-drop-field-shell', 'demo', now)!;
    const dates = hype.series.map((p) => p.date);
    expect(dates[dates.length - 1]).toBe('2026-03-09');
    expect(dates).toEqual(['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09']);
  });
});
