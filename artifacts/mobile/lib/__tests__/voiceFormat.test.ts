import { describe, expect, it } from 'vitest';
import { formatMoney, fmtRelativeDay } from '../format';

describe('formatMoney', () => {
  it('drops .00 on whole amounts and keeps the thousands comma', () => {
    expect(formatMoney(124000)).toBe('$1,240');
    expect(formatMoney(0)).toBe('$0');
    expect(formatMoney(100_000_000)).toBe('$1,000,000');
  });

  it('keeps cents when there are cents', () => {
    expect(formatMoney(1250)).toBe('$12.50');
    expect(formatMoney(5)).toBe('$0.05');
  });

  it('signs negatives', () => {
    expect(formatMoney(-300)).toBe('-$3');
    expect(formatMoney(-1999)).toBe('-$19.99');
  });
});

describe('fmtRelativeDay', () => {
  // Local time so the calendar boundaries hold in any CI time zone.
  const now = new Date(2026, 9, 13, 15, 0, 0);
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  it('reads now, minutes and hours today', () => {
    expect(fmtRelativeDay(ago(0), now)).toBe('now');
    expect(fmtRelativeDay(ago(5), now)).toBe('5m');
    expect(fmtRelativeDay(ago(120), now)).toBe('2h');
    expect(fmtRelativeDay(new Date(2026, 9, 13, 0, 30), now)).toBe('14h');
  });

  it('reads Yesterday for the previous calendar day', () => {
    expect(fmtRelativeDay(new Date(2026, 9, 12, 9, 0), now)).toBe('Yesterday');
  });

  it('keeps hours just after midnight', () => {
    const lateNight = new Date(2026, 9, 14, 1, 0);
    expect(fmtRelativeDay(new Date(2026, 9, 13, 23, 0), lateNight)).toBe('2h');
  });

  it('reads a short date after that, with the year once it changes', () => {
    expect(fmtRelativeDay(new Date(2026, 2, 4, 12, 0), now)).toBe('Mar 4');
    expect(fmtRelativeDay(new Date(2025, 2, 4, 12, 0), now)).toBe('Mar 4, 2025');
  });

  it('returns an empty string for an invalid date', () => {
    expect(fmtRelativeDay('not a date', now)).toBe('');
  });
});
