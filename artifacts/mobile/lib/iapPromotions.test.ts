import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import {
  IAP_PROMO_TIERS_CENTS,
  confirmNativePromotion,
  featuredProductId,
  nativePromotionsEnabled,
  nearestPromoTierCents,
  promoProductId,
} from './iapPromotions';

describe('native promotion rail', () => {
  // QA-0001/0003: native must never depend on a build flag to avoid Stripe.
  it('is always on for iOS and Android, and off on web', () => {
    expect(nativePromotionsEnabled('ios')).toBe(true);
    expect(nativePromotionsEnabled('android')).toBe(true);
    expect(nativePromotionsEnabled('web')).toBe(false);
  });

  it('maps Featured lengths to their store products', () => {
    expect(featuredProductId(3)).toBe('brandthread_featured_3d');
    expect(featuredProductId(14)).toBe('brandthread_featured_14d');
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
