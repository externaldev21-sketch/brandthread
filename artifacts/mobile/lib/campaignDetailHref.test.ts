import { describe, expect, it } from 'vitest';
import { campaignDetailHref } from './campaignDetailHref';

describe('campaignDetailHref', () => {
  it('opens the results screen for the tapped email or push send', () => {
    expect(campaignDetailHref({ type: 'email', campaignId: 'e 1' })).toBe('/email-campaign-results?id=e%201');
    expect(campaignDetailHref({ type: 'push', campaignId: 'p1' })).toBe('/seller-push-broadcast-results?id=p1');
  });
  it('has no destination for channels without a detail screen', () => {
    expect(campaignDetailHref({ type: 'sms', campaignId: 's1' })).toBeNull();
    expect(campaignDetailHref({ type: 'automation', campaignId: 'a1' })).toBeNull();
    expect(campaignDetailHref({ type: 'email', campaignId: '' })).toBeNull();
  });
});
