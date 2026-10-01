import { describe, expect, it } from 'vitest';
import {
  commissionSummary, findPlanPerk, formatFeeRate, monthLabel, proUpgradeHref, wantsProHighlight,
  type PerksResponse,
} from './proPerks';

const perks: PerksResponse = {
  currentPlan: 'starter',
  hasAdvancedAnalytics: false,
  plans: [
    { planId: 'starter', name: 'Brandthread Starter Plan', amountCents: 2900, platformFeeBps: 500, monthlyAiCredits: 50, advancedAnalytics: false },
    { planId: 'growth', name: 'Brandthread Growth Plan', amountCents: 7900, platformFeeBps: 400, monthlyAiCredits: 150, advancedAnalytics: false },
    { planId: 'pro', name: 'Brandthread Pro Plan', amountCents: 19900, platformFeeBps: 300, monthlyAiCredits: 600, advancedAnalytics: true },
  ],
};

describe('formatFeeRate', () => {
  it('formats whole and fractional percentages', () => {
    expect(formatFeeRate(500)).toBe('5%');
    expect(formatFeeRate(300)).toBe('3%');
    expect(formatFeeRate(350)).toBe('3.5%');
    expect(formatFeeRate(325)).toBe('3.25%');
  });
});

describe('commissionSummary', () => {
  it('lists each plan rate from the server perks', () => {
    expect(commissionSummary(perks)).toBe('5% Starter · 4% Growth · 3% Pro');
  });
  it('is null until perks load', () => {
    expect(commissionSummary(null)).toBeNull();
    expect(commissionSummary({ ...perks, plans: [] })).toBeNull();
  });
});

describe('findPlanPerk', () => {
  it('finds a plan or returns null', () => {
    expect(findPlanPerk(perks, 'pro')?.monthlyAiCredits).toBe(600);
    expect(findPlanPerk(perks, 'scale')).toBeNull();
    expect(findPlanPerk(null, 'pro')).toBeNull();
  });
});

describe('proUpgradeHref / wantsProHighlight', () => {
  it('routes to the existing plans screen with Pro highlighted', () => {
    expect(proUpgradeHref('analytics-advanced')).toBe('/plans?highlight=pro&source=analytics-advanced');
    expect(proUpgradeHref('a b')).toBe('/plans?highlight=pro&source=a%20b');
  });
  it('only highlights on the pro value', () => {
    expect(wantsProHighlight('pro')).toBe(true);
    expect(wantsProHighlight(['pro'])).toBe(true);
    expect(wantsProHighlight('growth')).toBe(false);
    expect(wantsProHighlight(undefined)).toBe(false);
  });
});

describe('monthLabel', () => {
  it('abbreviates a YYYY-MM key', () => {
    expect(monthLabel('2026-01')).toBe('Jan');
    expect(monthLabel('2026-12')).toBe('Dec');
    expect(monthLabel('bad')).toBe('bad');
  });
});
