import { describe, expect, it } from 'vitest';
import {
  annualPackageFor, annualPriceCents, canOfferYearly, hasNativeAnnualOffering, yearlyDisplayFor,
} from './billingInterval';
import { SELLER_PLANS } from './sellerPlans';

const plan = (id: string) => SELLER_PLANS.find((p) => p.id === id)!;
const pkg = (identifier: string, priceString = '$1') => ({ identifier, product: { priceString, pricePerMonthString: null } });

describe('yearly billing (2 months free)', () => {
  it('charges 10 × monthly, matching the server', () => {
    expect(annualPriceCents(plan('starter'))).toBe(29_000);
    expect(annualPriceCents(plan('growth'))).toBe(79_000);
    expect(annualPriceCents(plan('pro'))).toBe(199_000);
  });

  it('shows the yearly price and the per-month equivalent', () => {
    expect(yearlyDisplayFor(plan('starter'))).toEqual({ price: '$290', period: '/yr', note: '$24.17/mo billed yearly' });
    expect(yearlyDisplayFor(plan('growth'))).toEqual({ price: '$790', period: '/yr', note: '$65.83/mo billed yearly' });
    expect(yearlyDisplayFor(plan('pro'))).toEqual({ price: '$1,990', period: '/yr', note: '$165.83/mo billed yearly' });
  });

  it('offers yearly on native only when the offering has every annual package', () => {
    const monthly = [pkg('$bt_starter'), pkg('$bt_growth'), pkg('$bt_pro')];
    const annual = [pkg('$bt_starter_annual'), pkg('$bt_growth_annual'), pkg('$bt_pro_annual', '$1,990.00')];
    expect(canOfferYearly('web', [])).toBe(true);
    expect(canOfferYearly('ios', monthly)).toBe(false);
    expect(canOfferYearly('ios', [...monthly, ...annual.slice(0, 2)])).toBe(false);
    expect(hasNativeAnnualOffering([...monthly, ...annual])).toBe(true);
    expect(canOfferYearly('android', [...monthly, ...annual])).toBe(true);
    expect(annualPackageFor([...monthly, ...annual], 'pro')?.product.priceString).toBe('$1,990.00');
  });
});
