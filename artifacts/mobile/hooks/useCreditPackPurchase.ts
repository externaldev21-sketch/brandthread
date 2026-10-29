import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useApi } from '@/lib/api';
import { useRevenueCat } from '@/lib/revenueCat';
import { invalidateAiCredits } from '@/hooks/useAiCredits';
import { STORE_PRODUCT_FOR_PACK, buildCreditsReturnUrl, type AiCreditPack, type AiCreditsOverview } from '@/lib/aiCredits';

export type CreditPackPurchaseResult = 'purchased' | 'redirected' | 'cancelled' | 'failed';

/**
 * The one AI credit pack purchase path, shared by the AI credits screen and
 * every "out of credits" top-up button.
 *  - iOS / Android: the pack's store consumable through RevenueCat; its
 *    webhook credits the pack, so this polls the balance briefly for it.
 *  - Web: Stripe Checkout; the page leaves and comes back to
 *    /ai-credits?paymentReturn=1, which verifies the session.
 * Failures alert here; a closed store sheet is not a failure.
 */
export function useCreditPackPurchase() {
  const api = useApi();
  const rc = useRevenueCat();
  const native = Platform.OS !== 'web';
  const [buyingId, setBuyingId] = useState<string | null>(null);

  const canBuy = useCallback((o: Pick<AiCreditsOverview, 'packs' | 'purchase'> | null | undefined): boolean =>
    !!o && o.packs.length > 0 && (native ? rc.available : o.purchase.stripe), [native, rc.available]);

  const buyPack = useCallback(async (pack: AiCreditPack, balanceBefore: number): Promise<CreditPackPurchaseResult> => {
    if (buyingId) return 'cancelled';
    setBuyingId(pack.id);
    try {
      if (native) {
        await rc.purchaseCreditPack(STORE_PRODUCT_FOR_PACK[pack.id]!);
        // The store charge has gone through: a failed balance read from here
        // on is not a failed purchase (alerting one invites paying twice).
        for (let i = 0; i < 8; i += 1) {
          await new Promise((r) => setTimeout(r, 1500));
          const o = await api.aiCredits.get().catch(() => null);
          if ((o?.balance ?? 0) > balanceBefore) break;
        }
        invalidateAiCredits();
        return 'purchased';
      }
      const returnUrl = buildCreditsReturnUrl(window.location.origin);
      const { url } = await api.aiCredits.checkout(pack.id, returnUrl);
      if (!url) throw new Error('no url');
      window.location.assign(url);
      return 'redirected';
    } catch (e: any) {
      const cancelled = e?.userCancelled === true || /cancel/i.test(String(e?.message ?? ''));
      if (cancelled) return 'cancelled';
      Alert.alert('Purchase failed', 'Could not complete the purchase. Please try again.');
      return 'failed';
    } finally {
      setBuyingId(null);
    }
  }, [api, buyingId, native, rc]);

  return { canBuy, buyPack, buyingId };
}
