import { describe, expect, it } from 'vitest';
import { formatCents, formatDeductionCents } from './money';

describe('formatDeductionCents', () => {
  it('renders zero as a plain $0.00, never negative zero', () => {
    expect(formatDeductionCents(0)).toBe('$0.00');
    expect(formatDeductionCents(-0)).toBe('$0.00');
  });

  it('renders a deduction as negative whichever sign it is passed with', () => {
    expect(formatDeductionCents(320)).toBe('-$3.20');
    expect(formatDeductionCents(-320)).toBe('-$3.20');
    expect(formatDeductionCents(123_456)).toBe('-$1,234.56');
  });

  it('keeps formatCents unchanged for zero', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(-0)).toBe('$0.00');
  });

  it('rejects non-integer cents', () => {
    expect(() => formatDeductionCents(1.5)).toThrow();
  });
});
