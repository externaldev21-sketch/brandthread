import { describe, expect, it } from 'vitest';

import { creditLabel } from '../officialCredit';
import { clearCarouselMemory, rememberSlide, rememberedSlide } from '../carouselMemory';
import { defaultSpreadStart, isValidCreditHandle, moveItem, normalizeCreditHandle, scheduleTimes, MAX_BULK_ITEMS } from '../officialUpload';

describe('creditLabel', () => {
  it('formats handle, name, or both', () => {
    expect(creditLabel({ handle: 'galoreyyz', name: null }, 'video')).toBe('Video: @galoreyyz');
    expect(creditLabel({ handle: 'iammjonahdavid', name: 'Bully Monday' }, 'video')).toBe('Video: @iammjonahdavid · Bully Monday');
    expect(creditLabel({ handle: null, name: 'LoneChryst / LCT' }, 'photos')).toBe('Photos: LoneChryst / LCT');
    expect(creditLabel({ handle: '@lonechryst', name: null }, 'photos')).toBe('Photos: @lonechryst');
  });
});

describe('carousel slide memory', () => {
  it('remembers the slide per post, shared by feed loop copies, clamped to the slide count', () => {
    clearCarouselMemory();
    expect(rememberedSlide('p1', 6)).toBe(0);
    rememberSlide('p1', 2);
    expect(rememberedSlide('p1', 6)).toBe(2);
    expect(rememberedSlide('p1__loop2', 6)).toBe(2);
    expect(rememberedSlide('p1', 2)).toBe(1);
    expect(rememberedSlide('p2', 6)).toBe(0);
  });
});

describe('bulk upload helpers', () => {
  const now = Date.parse('2026-10-15T12:07:00Z');

  it('publishes everything now, or spreads one Thread every N hours', () => {
    expect(scheduleTimes(3, { kind: 'now' }, now)).toEqual([null, null, null]);
    const start = Date.parse('2026-10-15T14:00:00Z');
    expect(scheduleTimes(3, { kind: 'spread', everyHours: 24, startAt: start }, now)).toEqual([
      '2026-10-15T14:00:00.000Z', '2026-10-16T14:00:00.000Z', '2026-10-17T14:00:00.000Z',
    ]);
  });

  it('handles the 10-Thread starter set and refuses spreads past the server window', () => {
    const times = scheduleTimes(10, { kind: 'spread', everyHours: 12, startAt: defaultSpreadStart(now) }, now);
    expect(times).toHaveLength(10);
    expect(new Set(times).size).toBe(10);
    expect(MAX_BULK_ITEMS).toBeGreaterThanOrEqual(10);
    expect(() => scheduleTimes(MAX_BULK_ITEMS, { kind: 'spread', everyHours: 24 * 5, startAt: now }, now)).toThrow(/75 days/);
  });

  it('never schedules inside the 5-minute minimum lead', () => {
    const [first] = scheduleTimes(1, { kind: 'spread', everyHours: 3, startAt: now }, now);
    expect(Date.parse(first!) - now).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it('normalises and validates credit handles', () => {
    expect(normalizeCreditHandle(' @Factorieofficial ')).toBe('factorieofficial');
    expect(normalizeCreditHandle('')).toBeUndefined();
    expect(isValidCreditHandle('movrrs')).toBe(true);
    expect(isValidCreditHandle('iam.mjonah_david')).toBe(true);
    expect(isValidCreditHandle('bad handle!')).toBe(false);
  });

  it('reorders slides by drag', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
});
