import { describe, expect, it } from 'vitest';
import { DEMO_PERKS } from './proPerks';
import {
  CANCEL_REASONS,
  formatPlanLimit,
  isNativeStorePlan,
  lostFeatures,
  lowerPlanId,
  planChangeRows,
  planDateLine,
  planDirection,
  planFacts,
  planPriceLabel,
  planState,
  planStatusBadge,
  productCapWarning,
  prorationNote,
  type PlanBillingStatus,
} from './sellerPlanBilling';
import { demoBillingStatus, demoInvoices } from './previewBilling';

const base: PlanBillingStatus = {
  plan: 'growth', status: 'active', trialEnd: null, renewsOn: 'Nov 9, 2026',
  amountCents: 7900, paymentMethodLabel: 'Visa ···· 4242', cancelAtPeriodEnd: false, effectiveProvider: 'stripe',
};

describe('plan state and status copy', () => {
  it('treats no / ended subscriptions as no plan', () => {
    for (const status of ['none', 'canceled', 'incomplete_expired', 'expired']) {
      expect(planState({ ...base, status })).toBe('none');
    }
    expect(planState(null)).toBe('none');
  });

  it('shows Active + renews, Trial ends, and Cancels on', () => {
    expect(planStatusBadge(planState(base))).toBe('Active');
    expect(planDateLine(base)).toBe('Renews on Nov 9, 2026');

    const trial = { ...base, status: 'trialing', trialEnd: 'Oct 14, 2026' };
    expect(planState(trial)).toBe('trialing');
    expect(planDateLine(trial)).toBe('Trial ends Oct 14, 2026');

    const cancelling = { ...base, cancelAtPeriodEnd: true };
    expect(planState(cancelling)).toBe('cancelling');
    expect(planDateLine(cancelling)).toBe('Cancels on Nov 9, 2026');

    expect(planState({ ...base, status: 'past_due' })).toBe('past_due');
    expect(planStatusBadge('past_due')).toBe('Payment failed');
  });

  it('flags App Store / Google Play plans', () => {
    expect(isNativeStorePlan({ ...base, effectiveProvider: 'revenuecat' })).toBe(true);
    expect(isNativeStorePlan(base)).toBe(false);
  });
});

describe('plan prices and facts come from perks / the catalogue', () => {
  it('reads prices from perks with the catalogue as fallback', () => {
    expect(planPriceLabel('growth', DEMO_PERKS)).toBe('$79');
    expect(planPriceLabel('pro', null)).toBe('$199');
  });

  it('formats limits', () => {
    expect(formatPlanLimit(null)).toBe('Unlimited');
    expect(formatPlanLimit(0)).toBe('None');
    expect(formatPlanLimit(25)).toBe('25');
    expect(formatPlanLimit(undefined)).toBeNull();
  });

  it('lists commission, AI credits, products and seats for the current plan', () => {
    const growth = DEMO_PERKS.plans.find((p) => p.planId === 'growth')!;
    expect(planFacts(growth)).toEqual([
      { label: 'Commission', value: '4% per sale' },
      { label: 'AI credits', value: '4,000 per month' },
      { label: 'Products', value: 'Unlimited' },
      { label: 'Team seats', value: '3' },
    ]);
    expect(planFacts(null)).toEqual([]);
  });
});

describe('plan changes', () => {
  it('knows upgrades from downgrades', () => {
    expect(planDirection('growth', 'pro')).toBe('upgrade');
    expect(planDirection('growth', 'starter')).toBe('downgrade');
    expect(planDirection('scale', 'pro')).toBe('same');
  });

  it('only lists what changes', () => {
    expect(planChangeRows('growth', 'starter', DEMO_PERKS)).toEqual([
      { label: 'Price', from: '$79/mo', to: '$29/mo' },
      { label: 'Commission', from: '4%', to: '5%' },
      { label: 'AI credits', from: '4,000/mo', to: '1,000/mo' },
      { label: 'Products', from: 'Unlimited', to: '25' },
      { label: 'Team seats', from: '3', to: 'None' },
    ]);
    expect(planChangeRows('growth', 'pro', null)).toEqual([{ label: 'Price', from: '$79/mo', to: '$199/mo' }]);
  });

  it('lists the tools a downgrade gives up', () => {
    expect(lostFeatures('growth', 'starter')).toEqual([
      'AI logos, mockups, product photography, and lifestyle imagery',
      'Background removal and replacement',
      'Manufacturer Hub sourcing and production workflows',
    ]);
    expect(lostFeatures('pro', 'starter')).toHaveLength(7);
    expect(lostFeatures('starter', 'pro')).toEqual([]);
  });

  it('warns about the lower plan product cap only when it shrinks', () => {
    expect(productCapWarning('growth', 'starter', DEMO_PERKS)).toContain('up to 25 live products');
    expect(productCapWarning('starter', 'growth', DEMO_PERKS)).toBeNull();
    expect(productCapWarning('growth', 'starter', null)).toBeNull();
  });

  it('explains proration', () => {
    expect(prorationNote('upgrade', 'active', 'pro', DEMO_PERKS)).toContain('$199/month');
    expect(prorationNote('downgrade', 'active', 'starter', DEMO_PERKS)).toContain('credited');
    expect(prorationNote('upgrade', 'trialing', 'pro', DEMO_PERKS)).toContain('trial continues');
  });

  it('offers the next plan down when cancelling', () => {
    expect(lowerPlanId('pro')).toBe('growth');
    expect(lowerPlanId('growth')).toBe('starter');
    expect(lowerPlanId('starter')).toBeNull();
  });
});

describe('cancel reasons and preview data', () => {
  it('uses the server reason ids', () => {
    expect(CANCEL_REASONS.map((r) => r.id)).toEqual([
      'just_testing', 'not_enough_sales', 'closing_business', 'switching_platform',
      'too_expensive', 'missing_features', 'hard_to_set_up', 'other',
    ]);
  });

  it('demo preview is an active Growth plan with paid invoices', () => {
    const status = demoBillingStatus(new Date('2026-10-09T12:00:00Z'));
    expect(planState(status)).toBe('active');
    expect(status.plan).toBe('growth');
    expect(demoInvoices()).toHaveLength(3);
  });
});
