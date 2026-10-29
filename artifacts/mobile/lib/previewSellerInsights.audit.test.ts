import { describe, expect, it } from 'vitest';
import { previewBuckets } from './previewSellerInsights';

describe('previewBuckets week range (audit)', () => {
  it('keeps the days of a week that started last month in last month', () => {
    // Thu Oct 1 2026: the week began Sun Sep 27.
    const now = new Date(2026, 9, 1, 12);
    const { starts, window } = previewBuckets('week', now);
    expect(starts.map((d) => [d.getMonth(), d.getDate()])).toEqual([[8, 27], [8, 28], [8, 29], [8, 30], [9, 1]]);
    expect(starts.every((d) => d.getTime() <= now.getTime())).toBe(true);
    expect(new Date(window.start).getDate()).toBe(27);
  });
});
