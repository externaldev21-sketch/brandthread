import { describe, expect, it } from 'vitest';
import { addBusinessDays, formatRefundDate, refundExpectedDate, refundExpectedLabel } from './refundEta';

// Local-time constructors so the weekday math doesn't depend on the runner's zone.
const at = (y: number, m: number, d: number, h = 15, min = 40) => new Date(y, m - 1, d, h, min);

describe('addBusinessDays', () => {
  it('skips weekends', () => {
    // Fri Oct 9 2026 + 1 business day = Mon Oct 12
    expect(addBusinessDays(at(2026, 10, 9), 1).getDate()).toBe(12);
    // Sat Oct 10 + 1 = Mon Oct 12
    expect(addBusinessDays(at(2026, 10, 10), 1).getDate()).toBe(12);
    // Tue Oct 13 + 10 = Tue Oct 27
    expect(addBusinessDays(at(2026, 10, 13), 10).getDate()).toBe(27);
  });

  it('keeps the time of day and ignores negative counts', () => {
    const out = addBusinessDays(at(2026, 10, 13, 9, 5), 3);
    expect([out.getHours(), out.getMinutes()]).toEqual([9, 5]);
    expect(addBusinessDays(at(2026, 10, 13), -4).getDate()).toBe(13);
  });
});

describe('refundExpectedDate', () => {
  it('is 10 business days after the refund was issued', () => {
    expect(refundExpectedDate(at(2026, 10, 13))?.getDate()).toBe(27);
    // Across a month end: Fri Oct 23 + 10 = Fri Nov 6
    const d = refundExpectedDate(at(2026, 10, 23));
    expect([d?.getMonth(), d?.getDate()]).toEqual([10, 6]);
  });

  it('is null for missing or bad dates', () => {
    expect(refundExpectedDate(null)).toBeNull();
    expect(refundExpectedDate(undefined)).toBeNull();
    expect(refundExpectedDate('not a date')).toBeNull();
  });
});

describe('refundExpectedLabel', () => {
  it('reads "Expected by <date>" in the given locale', () => {
    const now = at(2026, 10, 13);
    expect(refundExpectedLabel(at(2026, 10, 13), now, 'en-US')).toBe('Expected by Oct 27');
    expect(refundExpectedLabel(at(2026, 10, 13), now, 'en-GB')).toBe('Expected by 27 Oct');
  });

  it('adds the year only when it differs', () => {
    expect(formatRefundDate(at(2027, 1, 4), at(2026, 12, 21), 'en-US')).toBe('Jan 4, 2027');
    expect(refundExpectedLabel(null)).toBeNull();
  });
});
