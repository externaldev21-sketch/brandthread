import { describe, expect, it } from 'vitest';
import { isCommissionInRange, stepCommission } from './commissionRange';

describe('commission stepper range', () => {
  it('steps one whole percent and stops at 5 and 10', () => {
    expect(stepCommission(10, 1)).toBe(10);
    expect(stepCommission(10, -1)).toBe(9);
    expect(stepCommission(5, -1)).toBe(5);
    expect(stepCommission(5, 1)).toBe(6);
  });
  it('moves a legacy out-of-range rate to the nearest bound on the first tap', () => {
    expect(stepCommission(15, -1)).toBe(10);
    expect(stepCommission(15, 1)).toBe(10);
    expect(stepCommission(2, 1)).toBe(5);
    expect(stepCommission(0, -1)).toBe(5);
  });
  it('moves a fractional rate to the next whole percent', () => {
    expect(stepCommission(7.5, 1)).toBe(8);
    expect(stepCommission(7.5, -1)).toBe(7);
  });
  it('knows the range', () => {
    expect(isCommissionInRange(5)).toBe(true);
    expect(isCommissionInRange(10)).toBe(true);
    expect(isCommissionInRange(10.5)).toBe(false);
    expect(isCommissionInRange(4)).toBe(false);
  });
});
