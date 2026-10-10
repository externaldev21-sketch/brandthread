import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ useApi: () => ({}) }));

import { compareRows, keyDifferences, nextTierForProducts, productCapCopy, productHeadline, type PlanTier } from './planTiers';
import { DEFAULT_SELLER_PLAN_CONFIG, parseSellerPlanConfig } from './sellerPlanConfig';

// The shape GET /api/config/seller-plans sends (Revenue P0, #766).
const wire = (id: string, amountCents: number, productLimit: number | null, staffSeats: number | null, aiCreditsMonthly: number, emailSendsMonthly: number | null, tier: 0 | 1 | 2) => ({
  id, name: id.charAt(0).toUpperCase() + id.slice(1), amountCents, interval: 'month', productLimit, staffSeats, aiCreditsMonthly,
  features: {
    analytics: (['basic', 'advanced', 'full'] as const)[tier], analyticsExport: tier === 2, liveSelling: tier > 0, dropsEscrow: tier > 0,
    emailSendsMonthly, boostFeatured: tier > 0, customDomain: tier > 0, manufacturerHub: tier > 0,
    payoutSpeed: tier === 2 ? 'faster' : 'standard', prioritySupport: tier === 2,
  },
});
const serverPlans = {
  trialDays: 7,
  reminderDaysBefore: 2,
  commissionPercent: 5,
  plans: [
    wire('starter', 1999, 10, 1, 100, 0, 0),
    wire('growth', 4900, 50, 3, 500, 5000, 1),
    wire('pro', 12900, null, null, 2000, 25000, 2),
  ],
};

const cfg = parseSellerPlanConfig(serverPlans);
const [starter, growth, pro] = cfg.tiers as [PlanTier, PlanTier, PlanTier];

describe('plan cards come only from the shared config', () => {
  it('reads prices, caps and features from the server', () => {
    expect(cfg.tiers.map((t) => [t.id, t.amountCents, t.limits.activeProducts])).toEqual([
      ['starter', 1999, 10], ['growth', 4900, 50], ['pro', 12900, null],
    ]);
    expect(cfg.commissionPercent).toBe(5);
  });

  it('the product count is the headline', () => {
    expect(productHeadline(starter.limits)).toBe('List up to 10 products');
    expect(productHeadline(growth.limits)).toBe('List up to 50 products');
    expect(productHeadline(pro.limits)).toBe('Unlimited products');
    expect(productHeadline({ activeProducts: 1 })).toBe('List up to 1 product');
  });

  it("changing the config changes the cards (Dev's 5 / 15 / unlimited)", () => {
    const alt = parseSellerPlanConfig({ ...serverPlans, plans: serverPlans.plans.map((p, i) => ({ ...p, productLimit: [5, 15, null][i] })) });
    expect(alt.tiers.map((t) => productHeadline(t.limits))).toEqual(['List up to 5 products', 'List up to 15 products', 'Unlimited products']);
  });

  it('4–5 key differences per card: seats, analytics, AI credits, then what the tier unlocks', () => {
    expect(keyDifferences(starter, null)).toEqual(['1 staff seat', 'Basic analytics', '100 AI credits a month']);
    expect(keyDifferences(growth, starter)).toEqual([
      '3 staff seats', 'Advanced analytics', '500 AI credits a month',
      'Live selling, drops and pre-orders, custom domain', 'Manufacturer Hub, boost slots',
    ]);
    expect(keyDifferences(pro, growth)).toEqual([
      'Unlimited staff seats', 'Full analytics and export', '2,000 AI credits a month', 'Priority support, faster payouts',
    ]);
    for (const [tier, below] of [[starter, null], [growth, starter], [pro, growth]] as const) {
      expect(keyDifferences(tier, below).length).toBeLessThanOrEqual(5);
    }
  });

  it('"Compare all features" has every difference, in tier order', () => {
    const rows = compareRows(cfg.tiers, cfg.commissionPercent);
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.values]));
    expect(byLabel['Active products']).toEqual(['10', '50', 'Unlimited']);
    expect(byLabel['Staff seats']).toEqual(['1', '3', 'Unlimited']);
    expect(byLabel['Live selling']).toEqual([false, true, true]);
    expect(byLabel['Marketing emails a month']).toEqual(['—', '5,000', '25,000']);
    expect(byLabel['Payout speed']).toEqual(['Standard', 'Standard', 'Faster']);
    expect(byLabel['Priority support']).toEqual([false, false, true]);
    expect(byLabel['Commission per sale']).toEqual(['5%', '5%', '5%']);
  });

  it('per-plan commission from the server wins (so the table matches what checkout charges)', () => {
    const perPlan = parseSellerPlanConfig({ ...serverPlans, commissionPercent: undefined, plans: serverPlans.plans.map((p, i) => ({ ...p, commissionPercent: [5, 4, 3][i] })) });
    const row = compareRows(perPlan.tiers, perPlan.commissionPercent).find((r) => r.label === 'Commission per sale');
    expect(row?.values).toEqual(['5%', '4%', '3%']);
  });

  it('never invents a value the server did not send (AI credits never become "unlimited")', () => {
    const partial = parseSellerPlanConfig({ ...serverPlans, plans: serverPlans.plans.map((p) => ({ id: p.id, amountCents: p.amountCents, productLimit: p.productLimit, staffSeats: p.staffSeats, aiCreditsMonthly: null })) });
    expect(partial.tiers[0].limits).toEqual({ activeProducts: 10, staffSeats: 1 });
    expect(keyDifferences(partial.tiers[0], null)).toEqual(['1 staff seat']);
    expect(compareRows(partial.tiers, null).map((r) => r.label)).toEqual(['Active products', 'Staff seats']);
  });

  it('falls back to the bundled tiers when the server sends no limits', () => {
    const old = parseSellerPlanConfig({ plans: [{ id: 'starter', amountCents: 1999 }, { id: 'growth', amountCents: 4900 }, { id: 'pro', amountCents: 12900 }] });
    expect(old.tiers.map((t) => t.limits.activeProducts)).toEqual([10, 50, null]);
    expect(old.tiers.map((t) => t.amountCents)).toEqual([1999, 4900, 12900]);
    expect(DEFAULT_SELLER_PLAN_CONFIG.tiers.map((t) => t.limits.activeProducts)).toEqual([10, 50, null]);
  });
});

describe('publish-at-cap upgrade sheet', () => {
  it("uses Dev's sentence with the numbers from config", () => {
    expect(productCapCopy(cfg.tiers, 'starter', 10)).toMatchObject({
      body: "You've listed 10 of 10 products on Starter. Upgrade to Growth to list up to 50. You can still save this as a draft.",
      next: { id: 'growth' },
    });
    expect(productCapCopy(cfg.tiers, 'growth', 50)?.body).toBe(
      "You've listed 50 of 50 products on Growth. Upgrade to Pro to list unlimited products. You can still save this as a draft.",
    );
  });
  it('no sheet on an unlimited plan', () => {
    expect(productCapCopy(cfg.tiers, 'pro', 999)).toBeNull();
    expect(nextTierForProducts(cfg.tiers, 'pro')).toBeNull();
  });
});
