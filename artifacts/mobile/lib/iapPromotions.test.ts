import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import {
  IAP_PROMO_TIERS_CENTS,
  confirmNativePromotion,
  nativePromotionsEnabled,
  nearestPromoTierCents,
  promoProductId,
} from './iapPromotions';

describe('native promotion rail', () => {
  it('is off on web and whenever the flag is unset', () => {
    expect(nativePromotionsEnabled('web', '1')).toBe(false);
    expect(nativePromotionsEnabled('ios', undefined)).toBe(false);
    expect(nativePromotionsEnabled('ios', '0')).toBe(false);
    expect(nativePromotionsEnabled('ios', '1')).toBe(true);
    expect(nativePromotionsEnabled('android', '1')).toBe(true);
  });

  it('maps budgets to the product ids Dev creates in the stores', () => {
    expect(promoProductId('boost', 2500)).toBe('brandthread_boost_25');
    expect(promoProductId('ad_campaign', 50000)).toBe('brandthread_ad_500');
  });

  it('snaps any budget to a sellable tier', () => {
    expect(nearestPromoTierCents(2500)).toBe(2500);
    expect(nearestPromoTierCents(3000)).toBe(2500);
    expect(nearestPromoTierCents(4000)).toBe(5000);
    expect(nearestPromoTierCents(100000)).toBe(50000);
    for (const c of [500, 700, 1500, 7500, 20000]) {
      expect(IAP_PROMO_TIERS_CENTS as readonly number[]).toContain(nearestPromoTierCents(c));
    }
  });

  it('retries verification, then gives up without throwing', async () => {
    const sleep = vi.fn(async () => {});
    const flaky = vi.fn().mockRejectedValueOnce(new Error('404')).mockResolvedValue({});
    expect(await confirmNativePromotion(flaky, { sleep })).toBe(true);
    expect(flaky).toHaveBeenCalledTimes(2);
    const dead = vi.fn().mockRejectedValue(new Error('502'));
    expect(await confirmNativePromotion(dead, { attempts: 3, sleep })).toBe(false);
    expect(dead).toHaveBeenCalledTimes(3);
  });
});
