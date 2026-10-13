import { describe, expect, it } from 'vitest';
import { analyticsSummary } from './analyticsSummary';

describe('analyticsSummary', () => {
  it('leads with sales and the change on the previous period', () => {
    expect(analyticsSummary({ range: 'week', revenueCents: 124_000, revenueChangePct: 12.4, visits: 900 }))
      .toBe('This week you made $1,240.00, up 12% on last week.');
    expect(analyticsSummary({ range: 'today', revenueCents: 5_000, revenueChangePct: -30, visits: 10 }))
      .toBe('Today you made $50.00, down 30% on yesterday.');
  });

  it('says "about the same" for a change that rounds to 0', () => {
    expect(analyticsSummary({ range: 'month', revenueCents: 1_000, revenueChangePct: 0.3, visits: 1 }))
      .toBe('This month you made $10.00, about the same as last month.');
  });

  it('drops the comparison when there is none', () => {
    expect(analyticsSummary({ range: 'all', revenueCents: 1_000, revenueChangePct: 50, visits: 1 })).toBe('So far you made $10.00.');
    expect(analyticsSummary({ range: 'week', revenueCents: 1_000, visits: 1 })).toBe('This week you made $10.00.');
  });

  it('counts visits when nothing sold yet', () => {
    expect(analyticsSummary({ range: 'week', revenueCents: 0, visits: 1 })).toBe('1 visit this week, no sales yet.');
    expect(analyticsSummary({ range: 'today', revenueCents: 0, visits: 1200 })).toBe('1,200 visits today, no sales yet.');
  });

  it('says nothing when there is nothing to say', () => {
    expect(analyticsSummary({ range: 'week', revenueCents: 0, visits: 0 })).toBeNull();
  });
});
