/**
 * Native (iOS / Android) rail for Boost and Create-ad (App Store 3.1.1).
 *
 * On a native build, paid promotion is bought as a RevenueCat consumable
 * through the store's own purchase sheet; Stripe Checkout stays on web. The
 * rail is OFF unless EXPO_PUBLIC_IAP_PROMOTIONS=1 is set in the build (after
 * the store products below exist), so nothing changes or crashes until Dev
 * flips it. Product ids mirror artifacts/api-server/src/lib/iapPromotions.ts.
 */
import { Platform } from 'react-native';

export type PromoKind = 'boost' | 'ad_campaign';

/** Whole-dollar budget tiers sold natively, in cents. All are existing budget steps. */
export const IAP_PROMO_TIERS_CENTS = [500, 1000, 2500, 5000, 10000, 25000, 50000] as const;

const PREFIX: Record<PromoKind, string> = {
  boost: 'brandthread_boost_',
  ad_campaign: 'brandthread_ad_',
};

export function promoProductId(kind: PromoKind, cents: number): string {
  return `${PREFIX[kind]}${Math.round(cents / 100)}`;
}

/** Closest sellable tier to a chosen budget (ties round up). */
export function nearestPromoTierCents(cents: number): number {
  let best: number = IAP_PROMO_TIERS_CENTS[0];
  for (const tier of IAP_PROMO_TIERS_CENTS) {
    const d = Math.abs(tier - cents);
    const bd = Math.abs(best - cents);
    if (d < bd || (d === bd && tier > best)) best = tier;
  }
  return best;
}

export function nativePromotionsEnabled(
  os: string = Platform.OS,
  flag: string | undefined = process.env.EXPO_PUBLIC_IAP_PROMOTIONS,
): boolean {
  return (os === 'ios' || os === 'android') && flag === '1';
}

/** True when the store purchase sheet was dismissed by the user (not an error). */
export function isPurchaseCancelled(err: unknown): boolean {
  const e = err as { userCancelled?: boolean; code?: string } | null;
  return !!e && (e.userCancelled === true || e.code === '1');
}

/**
 * RevenueCat can lag the store by a few seconds, so the server may not see the
 * purchase on the first verify. Retry a few times; if it still is not there the
 * RevenueCat webhook grants it, and the screen's existing "payment pending"
 * state covers the gap. Never throws.
 */
export async function confirmNativePromotion(
  verify: () => Promise<unknown>,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const attempts = opts.attempts ?? 4;
  const delayMs = opts.delayMs ?? 1500;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    try {
      await verify();
      return true;
    } catch {
      if (i < attempts - 1) await sleep(delayMs);
    }
  }
  return false;
}
