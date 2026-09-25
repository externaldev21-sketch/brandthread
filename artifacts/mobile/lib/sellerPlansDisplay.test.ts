import { describe, expect, it } from 'vitest';
import { SELLER_PLANS } from './sellerPlans';
import {
  comparisonRows,
  displayPriceFor,
  formatDollars,
  planIncludesFeature,
  PLAN_FAQ,
} from './sellerPlansDisplay';

describe('formatDollars', () => {
  it('formats whole and fractional dollar amounts', () => {
    expect(formatDollars(2900)).toBe('$29');
    expect(formatDollars(2905)).toBe('$29.05');
  });
});

describe('displayPriceFor', () => {
  const starter = SELLER_PLANS.find((p) => p.id === 'starter')!;

  it('shows only the real monthly price — no yearly projection', () => {
    const result = displayPriceFor(starter);
    expect(result.price).toBe(starter.priceLabel);
    expect(result.period).toBe('/mo');
    expect(result.note).toBeNull();
  });
});

describe('comparisonRows / planIncludesFeature', () => {
  it('lists every distinct feature once, in first-appearance order', () => {
    const rows = comparisonRows();
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('carries Starter features forward into Growth and Pro ("Everything in X")', () => {
    const starter = SELLER_PLANS.find((p) => p.id === 'starter')!;
    const growth = SELLER_PLANS.find((p) => p.id === 'growth')!;
    const pro = SELLER_PLANS.find((p) => p.id === 'pro')!;
    const starterOnlyFeature = starter.features.find((f) => !f.startsWith('Everything in'))!;

    expect(planIncludesFeature(starter, starterOnlyFeature)).toBe(true);
    expect(planIncludesFeature(growth, starterOnlyFeature)).toBe(true);
    expect(planIncludesFeature(pro, starterOnlyFeature)).toBe(true);
  });

  it('does not credit a lower tier with a higher tier\'s exclusive feature', () => {
    const starter = SELLER_PLANS.find((p) => p.id === 'starter')!;
    const pro = SELLER_PLANS.find((p) => p.id === 'pro')!;
    const proOnlyFeature = pro.features.find((f) => !f.startsWith('Everything in'))!;

    expect(planIncludesFeature(pro, proOnlyFeature)).toBe(true);
    expect(planIncludesFeature(starter, proOnlyFeature)).toBe(false);
  });
});

describe('PLAN_FAQ', () => {
  it('is non-empty and every entry has a question and an answer', () => {
    expect(PLAN_FAQ.length).toBeGreaterThan(0);
    for (const item of PLAN_FAQ) {
      expect(item.question.length).toBeGreaterThan(0);
      expect(item.answer.length).toBeGreaterThan(0);
    }
  });

  it('is honest that billing is monthly-only today (no fabricated annual checkout)', () => {
    const billing = PLAN_FAQ.find((item) => /monthly|yearly/i.test(item.question));
    expect(billing?.answer).toMatch(/billed monthly/i);
  });
});
