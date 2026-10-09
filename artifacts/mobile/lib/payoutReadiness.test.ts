import { describe, expect, it } from 'vitest';
import { payoutsMissingForPublish } from './payoutReadiness';

const active = { connected: true, chargesEnabled: true, payoutsEnabled: true, status: 'active', verified: true, providerConfigured: true };

describe('payoutsMissingForPublish (BT-206)', () => {
  it('warns a seller who has not finished payouts', () => {
    expect(payoutsMissingForPublish({ ...active, connected: false, chargesEnabled: false, payoutsEnabled: false, status: 'not_connected' })).toBe(true);
    expect(payoutsMissingForPublish({ ...active, chargesEnabled: false, status: 'pending' })).toBe(true);
  });

  it('stays quiet for a ready seller, an unknown status, or no payment provider', () => {
    expect(payoutsMissingForPublish(active)).toBe(false);
    expect(payoutsMissingForPublish(null)).toBe(false);
    expect(payoutsMissingForPublish({ ...active, connected: false, status: 'not_connected', providerConfigured: false })).toBe(false);
  });
});
