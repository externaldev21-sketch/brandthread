/**
 * Demo-preview ad campaign (lib/demoAdCampaign.ts): it replays the engine's
 * hourly pacing, so it must read "on pace", grow as time passes (the trickle),
 * never overspend, and use the store name on the Sponsored slot.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-asset', () => ({ Asset: { fromModule: () => ({ uri: 'https://cdn.test/demo.jpg' }) } }));
vi.mock('../../assets/videos/fashion_runway_04.jpg', () => ({ default: 1 }));

import { demoAdCampaignResults, demoFeedAd } from '../demoAdCampaign';

describe('demo ad campaign', () => {
  it('is mid-delivery and on pace with the even line', () => {
    const { campaign, results } = demoAdCampaignResults();
    expect(campaign.status).toBe('active');
    expect(campaign.budgetCents).toBe(13_000 * 7);
    expect(results.pacing?.status).toBe('on_pace');
    expect(results.spentCents).toBeGreaterThan(0);
    expect(results.spentCents).toBeLessThan(results.budgetCents);
    expect(results.hourly?.length).toBeGreaterThan(24);
  });

  it('trickles: spend grows as time passes, an hour at a time, never all at once', () => {
    const now = Date.now();
    const a = demoAdCampaignResults(now).results;
    const b = demoAdCampaignResults(now + 30 * 60_000).results;
    const c = demoAdCampaignResults(now + 3 * 3_600_000).results;
    expect(b.spentCents).toBeGreaterThan(a.spentCents);
    expect(c.spentCents).toBeGreaterThan(b.spentCents);
    const hourly = a.pacing!.hourlyBudgetCents;
    expect(c.spentCents - a.spentCents).toBeLessThanOrEqual(hourly * 3 * 1.4);
  });

  it('the Sponsored slot shows the store name, not a person', () => {
    expect(demoFeedAd('for_you', 5)).toMatchObject({ label: 'Sponsored', afterIndex: 5, seller: { displayName: 'Okafor Studio' } });
  });
});
