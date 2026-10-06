import { describe, expect, it } from 'vitest';
import { freeTrialDays, manageOrCancelLine } from '@/lib/trialOffer';

describe('freeTrialDays', () => {
  it('reads the length from the store offer', () => {
    expect(freeTrialDays({ price: 0, periodUnit: 'DAY', periodNumberOfUnits: 5 })).toBe(5);
    expect(freeTrialDays({ price: 0, periodUnit: 'WEEK', periodNumberOfUnits: 1 })).toBe(7);
    expect(freeTrialDays({ price: 0, periodUnit: 'month', periodNumberOfUnits: 1 })).toBe(30);
  });
  it('is null without a free intro offer', () => {
    expect(freeTrialDays(null)).toBeNull();
    expect(freeTrialDays({ price: 0.99, periodUnit: 'MONTH', periodNumberOfUnits: 1 })).toBeNull();
    expect(freeTrialDays({ price: 0, periodUnit: 'UNKNOWN', periodNumberOfUnits: 1 })).toBeNull();
  });
});

describe('manageOrCancelLine', () => {
  it('names the right place per platform', () => {
    expect(manageOrCancelLine('ios')).toContain('App Store');
    expect(manageOrCancelLine('android')).toContain('Google Play');
    expect(manageOrCancelLine('web')).not.toMatch(/App Store|Google Play/);
  });
});
