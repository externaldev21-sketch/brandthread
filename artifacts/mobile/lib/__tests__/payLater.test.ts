import { describe, expect, it } from 'vitest';
import { payLaterInstallments, payLaterLine, payLaterSheetNote, showPayLater } from '../payLater';

describe('payLater', () => {
  it('splits into 4 payments, first absorbs the remainder', () => {
    expect(payLaterInstallments(9_500)).toEqual([2_375, 2_375, 2_375, 2_375]);
    expect(payLaterInstallments(9_501)).toEqual([2_376, 2_375, 2_375, 2_375]);
    expect(payLaterInstallments(48_003).reduce((a, b) => a + b, 0)).toBe(48_003);
  });

  it('shows only for an eligible seller at or over the minimum', () => {
    const on = { eligible: true, minCents: 7_500 };
    expect(showPayLater(on, 7_499)).toBe(false);
    expect(showPayLater(on, 7_500)).toBe(true);
    expect(showPayLater(on, 48_000)).toBe(true);
    expect(showPayLater({ eligible: false, minCents: 7_500 }, 48_000)).toBe(false);
    expect(showPayLater(null, 48_000)).toBe(false);
    expect(showPayLater(on, 0)).toBe(false);
  });

  it('copy', () => {
    expect(payLaterLine(9_500)).toBe('or 4 interest-free payments of $23.75 with Klarna or Afterpay');
    expect(payLaterSheetNote(7_500)).toContain('orders of $75 or more');
    expect(payLaterSheetNote(7_550)).toContain('orders of $75.50 or more');
  });
});
