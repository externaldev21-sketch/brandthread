import { describe, expect, it, vi } from 'vitest';
import { pollSubscriptionStatus } from './pollSubscriptionStatus';

describe('pollSubscriptionStatus', () => {
  it('retries an initially stale subscription until checkout becomes live', async () => {
    const loadStatus = vi.fn()
      .mockResolvedValueOnce({ plan: 'starter', status: 'none' })
      .mockResolvedValueOnce({ plan: 'growth', status: 'trialing' });
    const wait = vi.fn().mockResolvedValue(undefined);

    const matched = await pollSubscriptionStatus<{ plan: string; status: string }>({
      loadStatus,
      shouldStop: (status) =>
        status.plan === 'growth'
        && (status.status === 'trialing' || status.status === 'active'),
      wait,
    });

    expect(matched).toBe(true);
    expect(loadStatus).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});