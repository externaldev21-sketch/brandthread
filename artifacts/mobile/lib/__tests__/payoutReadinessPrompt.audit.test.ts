import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, Alert: { alert: vi.fn() } }));

import { confirmPublishWithoutPayouts } from '../payoutReadinessPrompt';

afterEach(() => vi.useRealTimers());

describe('confirmPublishWithoutPayouts', () => {
  it('leaves no 4s fallback timer behind once the status has answered', async () => {
    vi.useFakeTimers();
    const ready = { connected: true, chargesEnabled: true, payoutsEnabled: true, status: 'active', verified: true, providerConfigured: true };
    const api = { seller: { connect: { status: vi.fn(async () => ready) } } };
    await expect(confirmPublishWithoutPayouts(api, { push: vi.fn() })).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still clears the timer when the status call fails', async () => {
    vi.useFakeTimers();
    const api = { seller: { connect: { status: vi.fn(async () => { throw new Error('offline'); }) } } };
    await expect(confirmPublishWithoutPayouts(api, { push: vi.fn() })).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
