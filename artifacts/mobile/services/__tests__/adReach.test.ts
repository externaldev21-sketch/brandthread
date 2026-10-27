/**
 * Budget-true reach estimate (services/adReach.ts). The same expectations are
 * asserted against the server's copy (api-server lib/ads/__tests__/reachEstimate.test.ts)
 * so the live slider figure and the stored estimate can't drift apart.
 */
import { describe, expect, it } from 'vitest';
import {
  compactPeople, estimateCampaignReach, expectedReach, FALLBACK_REACH_MODEL, formatReachRange, reachablePool,
  type ReachModel,
} from '../adReach';

const model: ReachModel = FALLBACK_REACH_MODEL;
const reach = (dailyDollars: number, days: number, m: ReachModel = model) =>
  estimateCampaignReach({ totalBudgetCents: dailyDollars * 100 * days, durationDays: days, model: m });

describe('estimateCampaignReach', () => {
  it('$130/day for 25 days reaches far more people than $130/day for 2 days', () => {
    const short = reach(130, 2);
    const long = reach(130, 25);
    expect(short).toMatchObject({ low: 5069, high: 6550, impressions: 13_000 });
    expect(long).toMatchObject({ low: 20_935, high: 24_673, impressions: 162_500 });
    expect(long.low).toBeGreaterThan(short.high * 3);
  });

  it('grows with either slider and never shrinks', () => {
    let prev = 0;
    for (const days of [1, 2, 5, 10, 20, 30]) {
      const r = reach(50, days);
      expect(r.high).toBeGreaterThanOrEqual(prev);
      prev = r.high;
    }
    prev = 0;
    for (const daily of [5, 20, 100, 500, 1000]) {
      const r = reach(daily, 7);
      expect(r.high).toBeGreaterThanOrEqual(prev);
      prev = r.high;
    }
  });

  it('has diminishing returns: 10x the money does not buy 10x the people near saturation', () => {
    const base = reach(100, 10);
    const tenX = reach(1000, 10);
    expect(tenX.high / base.high).toBeLessThan(1.5);
    expect(tenX.high).toBeLessThanOrEqual(tenX.reachablePool);
    expect(tenX.saturation).toBeGreaterThan(0.99);
  });

  it('is roughly linear while far from saturation', () => {
    const a = reach(5, 1);
    const b = reach(10, 1);
    expect(b.high / a.high).toBeGreaterThan(1.8);
  });

  it('always returns a range with low <= high', () => {
    for (const [d, n] of [[5, 1], [130, 2], [1000, 30]] as const) {
      const r = reach(d, n);
      expect(r.low).toBeLessThanOrEqual(r.high);
      expect(r.low).toBeGreaterThan(0);
    }
  });

  it('a bigger measured audience raises the ceiling', () => {
    const big: ReachModel = { cpmCents: 2000, audience: { total: 400_000, dailyActive: 80_000, source: 'measured' } };
    expect(reach(1000, 30, big).high).toBeGreaterThan(reach(1000, 30).high * 5);
  });
});

describe('pool + exposure building blocks', () => {
  it('a longer flight sees more distinct people', () => {
    expect(reachablePool(model.audience, 1)).toBeCloseTo(4000, 6);
    expect(reachablePool(model.audience, 30)).toBeGreaterThan(24_000);
    expect(reachablePool(model.audience, 30)).toBeLessThanOrEqual(25_000);
  });

  it('expected reach never exceeds the pool', () => {
    expect(expectedReach(1e9, 1000)).toBeLessThanOrEqual(1000);
    expect(expectedReach(0, 1000)).toBe(0);
  });
});

describe('formatReachRange', () => {
  it('shows a compact range, never a precise number', () => {
    expect(formatReachRange({ low: 4210, high: 6880 })).toBe('4.2K–6.8K people');
    expect(formatReachRange({ low: 20_935, high: 24_673 })).toBe('20K–24K people');
    expect(formatReachRange({ low: 194, high: 300 })).toBe('190–300 people');
  });

  it('rounds down so the figure never overstates', () => {
    expect(compactPeople(6999)).toBe('6.9K');
    expect(compactPeople(1_299_999)).toBe('1.2M');
  });
});
