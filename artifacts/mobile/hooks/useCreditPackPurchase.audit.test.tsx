/**
 * Once the store purchase itself has gone through, a failed balance poll
 * afterwards must not be reported as "Purchase failed" (which invites the
 * buyer to pay a second time).
 */
import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const alertSpy = vi.fn();
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios ?? o.default }, Alert: { alert: (...a: unknown[]) => alertSpy(...a) } };
});

const purchaseCreditPack = vi.fn(async () => {});
vi.mock('@/lib/revenueCat', () => ({ useRevenueCat: () => ({ available: true, purchaseCreditPack }) }));

const get = vi.fn();
vi.mock('@/lib/api', () => ({ useApi: () => ({ aiCredits: { get, checkout: vi.fn() } }) }));
vi.mock('@/hooks/useAiCredits', () => ({ invalidateAiCredits: vi.fn() }));
vi.mock('@/lib/aiCredits', () => ({ STORE_PRODUCT_FOR_PACK: { small: 'credits_small' }, buildCreditsReturnUrl: () => '' }));

import { useCreditPackPurchase } from './useCreditPackPurchase';

type Hook = ReturnType<typeof useCreditPackPurchase>;

afterEach(() => { vi.useRealTimers(); alertSpy.mockReset(); get.mockReset(); });

describe('useCreditPackPurchase (native)', () => {
  it('reports a completed store purchase as purchased even if a balance poll fails', async () => {
    vi.useFakeTimers();
    get.mockRejectedValueOnce(new Error('network')).mockResolvedValue({ balance: 50 });
    let hook!: Hook;
    function Probe() { hook = useCreditPackPurchase(); return null; }
    act(() => { create(<Probe />); });

    let result: string | undefined;
    await act(async () => {
      const p = hook.buyPack({ id: 'small' } as never, 10).then((r) => { result = r; });
      await vi.advanceTimersByTimeAsync(1500 * 8 + 100);
      await p;
    });
    expect(purchaseCreditPack).toHaveBeenCalledWith('credits_small');
    expect(result).toBe('purchased');
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
