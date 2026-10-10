import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ useApi: () => ({}) }));

import {
  DEFAULT_SELLER_PLAN_CONFIG,
  chargeDateLabel,
  formatPlanPrice,
  parseSellerPlanConfig,
  trialCopy,
  trialDaysFromIntro,
  usesNativeCheckout,
} from './sellerPlanConfig';

describe('trial copy (must match the behavior exactly)', () => {
  it("is Dev's exact sentence with the date 7 days out", () => {
    expect(trialCopy(7, 2, new Date(2026, 9, 13))).toBe(
      "Free for 7 days. You won't be charged until Oct 20. We'll remind you 2 days before. Cancel anytime.",
    );
  });
  it('rolls across month ends', () => {
    expect(chargeDateLabel(7, new Date(2026, 9, 28))).toBe('Nov 4');
  });
  it('singular forms', () => {
    expect(trialCopy(1, 1, new Date(2026, 0, 1))).toBe(
      "Free for 1 day. You won't be charged until Jan 2. We'll remind you 1 day before. Cancel anytime.",
    );
  });
});

describe('config parsing', () => {
  it('defaults to a 7-day trial with a reminder 2 days before', () => {
    expect(DEFAULT_SELLER_PLAN_CONFIG.trialDays).toBe(7);
    expect(DEFAULT_SELLER_PLAN_CONFIG.reminderDaysBefore).toBe(2);
  });
  it('takes the server values and rejects junk', () => {
    const cfg = parseSellerPlanConfig({ trialDays: 14, reminderDaysBefore: 3, checkoutMode: 'web', plans: [
      { id: 'starter', amountCents: 1900 }, { id: 'growth', amountCents: 6900 }, { id: 'pro', amountCents: 14900 },
    ] });
    expect(cfg).toMatchObject({ trialDays: 14, reminderDaysBefore: 3, checkoutMode: 'web' });
    expect(cfg.plans[1].amountCents).toBe(6900);
    const junk = parseSellerPlanConfig({ trialDays: 'x', checkoutMode: 'paypal', plans: [{ id: 'gold', amountCents: 1 }] });
    expect(junk).toEqual(DEFAULT_SELLER_PLAN_CONFIG);
    expect(parseSellerPlanConfig(null)).toEqual(DEFAULT_SELLER_PLAN_CONFIG);
  });
  it('formats prices', () => {
    expect(formatPlanPrice(2900)).toBe('$29');
    expect(formatPlanPrice(1950)).toBe('$19.50');
  });
});

describe('store intro offers', () => {
  it('reads a free week or days as a trial', () => {
    expect(trialDaysFromIntro({ price: 0, priceString: '$0.00', periodNumberOfUnits: 1, periodUnit: 'WEEK' })).toBe(7);
    expect(trialDaysFromIntro({ priceString: 'Free', price: 0, periodNumberOfUnits: 7, periodUnit: 'DAY' })).toBe(7);
  });
  it('a paid intro or a month-long offer is not treated as this trial', () => {
    expect(trialDaysFromIntro({ price: 0.99, priceString: '$0.99', periodNumberOfUnits: 1, periodUnit: 'WEEK' })).toBeNull();
    expect(trialDaysFromIntro({ price: 0, priceString: '$0.00', periodNumberOfUnits: 1, periodUnit: 'MONTH' })).toBeNull();
    expect(trialDaysFromIntro(null)).toBeNull();
  });
});

describe('checkout mode flag', () => {
  it('auto = in-app purchase on native, web checkout on web', () => {
    expect(usesNativeCheckout('ios', 'auto')).toBe(true);
    expect(usesNativeCheckout('android', 'native')).toBe(true);
    expect(usesNativeCheckout('web', 'auto')).toBe(false);
    expect(usesNativeCheckout('ios', 'web')).toBe(false);
  });
});
