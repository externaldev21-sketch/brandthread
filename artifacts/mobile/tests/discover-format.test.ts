import { describe, expect, it } from 'vitest';
import { formatDropCountdown, formatDropDate, formatVideoDuration, mutualsLine } from '@/lib/discoverFormat';

describe('formatVideoDuration', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(formatVideoDuration(42)).toBe('0:42');
    expect(formatVideoDuration(185)).toBe('3:05');
    expect(formatVideoDuration(3729)).toBe('1:02:09');
  });
  it('is null when unknown', () => {
    expect(formatVideoDuration(undefined)).toBeNull();
    expect(formatVideoDuration(0)).toBeNull();
    expect(formatVideoDuration(Number.NaN)).toBeNull();
  });
});

describe('mutualsLine', () => {
  it('keeps a real "Followed by" reason', () => {
    expect(mutualsLine({ reason: 'Followed by Ana + 2 others', mutualCount: 3 })).toBe('Followed by Ana + 2 others');
  });
  it('falls back to the count when only the count is known', () => {
    expect(mutualsLine({ reason: 'Suggested for you', mutualCount: 1 })).toBe('1 mutual');
    expect(mutualsLine({ reason: 'Suggested for you', mutualCount: 4 })).toBe('4 mutuals');
  });
  it('omits the line without real mutual data', () => {
    expect(mutualsLine({ reason: 'Suggested for you' })).toBeNull();
    expect(mutualsLine({ reason: 'New on Brandthread', mutualCount: 0 })).toBeNull();
  });
});

describe('formatDropCountdown', () => {
  const now = Date.parse('2026-09-18T12:00:00Z');
  it('pads hours and minutes', () => {
    expect(formatDropCountdown('2026-09-20T16:09:00Z', now)).toBe('2d 04h 09m');
    expect(formatDropCountdown('2026-09-18T16:09:00Z', now)).toBe('04h 09m');
    expect(formatDropCountdown('2026-09-18T12:09:30Z', now)).toBe('09m');
  });
  it('is null when past or missing', () => {
    expect(formatDropCountdown('2026-09-18T11:00:00Z', now)).toBeNull();
    expect(formatDropCountdown(null, now)).toBeNull();
  });
});

describe('formatDropDate', () => {
  it('formats month, padded day and 24h time', () => {
    const iso = new Date(2026, 8, 5, 9, 7).toISOString();
    expect(formatDropDate(iso)).toBe('Sep 05 · 09:07');
  });
  it('is null when missing or invalid', () => {
    expect(formatDropDate(undefined)).toBeNull();
    expect(formatDropDate('nope')).toBeNull();
  });
});
