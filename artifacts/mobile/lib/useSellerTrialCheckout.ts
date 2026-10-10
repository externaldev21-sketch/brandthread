/**
 * Starts the seller's free trial for a plan, using whatever checkout is wired
 * (lib/sellerPlanConfig.ts checkoutMode):
 *  - native (iOS/Android, default): the App Store / Google Play subscription
 *    sheet through RevenueCat. The store collects the card and runs the trial.
 *  - web: Stripe Checkout with a card on file (POST
 *    /api/seller/subscription/checkout), then waits for the subscription to
 *    show as trialing when the person comes back to the app.
 * Payment wiring and the server plan gate belong to the payments code; this
 * hook only drives them and reports back.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import { useApi } from '@/lib/api';
import { useRevenueCat } from '@/lib/revenueCat';
import { SELLER_PACKAGE_IDS, type SellerPlanId } from '@/lib/sellerBilling';
import {
  formatPlanPrice,
  trialDaysFromIntro,
  useSellerPlanConfig,
  usesNativeCheckout,
} from '@/lib/sellerPlanConfig';

const LIVE = new Set(['trialing', 'active']);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useSellerTrialCheckout({ onActive }: { onActive: () => void }) {
  const api = useApi();
  const config = useSellerPlanConfig();
  const rc = useRevenueCat();
  const native = usesNativeCheckout(Platform.OS, config.checkoutMode);
  const [busy, setBusy] = useState(false);
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedRef = useRef(false);
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;

  const pkgFor = useCallback((id: SellerPlanId) => rc.packages.find((p) => p.identifier === SELLER_PACKAGE_IDS[id]), [rc.packages]);

  /** Monthly price as the store or Stripe will charge it. Null while native prices load. */
  const priceLabel = useCallback((id: SellerPlanId): string | null => {
    if (native) return pkgFor(id)?.product.priceString ?? null;
    const cents = config.plans.find((p) => p.id === id)?.amountCents;
    return cents ? formatPlanPrice(cents) : null;
  }, [config.plans, native, pkgFor]);

  /** Free-trial days for this plan, or null when no free trial is on offer. */
  const trialDays = useCallback((id: SellerPlanId): number | null => {
    if (!native) return config.trialDays;
    return trialDaysFromIntro(pkgFor(id)?.product.introPrice as never);
  }, [config.trialDays, native, pkgFor]);

  const pollUntilLive = useCallback(async (attempts: number): Promise<boolean> => {
    for (let i = 0; i < attempts; i++) {
      try {
        const status = await api.seller.subscription.status();
        if (LIVE.has(status.status)) return true;
      } catch { /* retry */ }
      await sleep(1500);
    }
    return false;
  }, [api]);

  // Web checkout opens Stripe in another tab/browser; finish when they return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !openedRef.current) return;
      openedRef.current = false;
      setAwaitingReturn(true);
      void pollUntilLive(8).then((live) => {
        setAwaitingReturn(false);
        setBusy(false);
        if (live) onActiveRef.current();
        else setError("Checkout wasn't finished. Pick a plan to start your free trial.");
      });
    });
    return () => sub.remove();
  }, [pollUntilLive]);

  /** If a trial or plan is already running (e.g. finished in another tab), skip ahead. */
  const checkExisting = useCallback(async () => {
    try {
      const status = await api.seller.subscription.status();
      if (LIVE.has(status.status)) onActiveRef.current();
    } catch { /* not subscribed yet */ }
  }, [api]);

  const start = useCallback(async (id: SellerPlanId) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (native) {
        const pkg = pkgFor(id);
        if (!rc.available || !pkg) throw new Error('Subscriptions are unavailable right now. Try again in a moment.');
        await rc.purchase(pkg);
        await pollUntilLive(4);
        setBusy(false);
        onActiveRef.current();
        return;
      }
      const { url } = await api.seller.subscription.checkout(id);
      openedRef.current = true;
      await Linking.openURL(url);
    } catch (e: any) {
      setBusy(false);
      if (e?.userCancelled) return;
      setError(e?.message || "Checkout couldn't start. Check your connection and try again.");
    }
  }, [api, busy, native, pkgFor, pollUntilLive, rc]);

  const restore = useCallback(async () => {
    setError(null);
    try {
      await rc.restore();
      if (await pollUntilLive(2)) onActiveRef.current();
      else setError('No subscription to restore on this account.');
    } catch (e: any) {
      setError(e?.message || "Purchases couldn't be restored. Try again.");
    }
  }, [pollUntilLive, rc]);

  return { config, native, priceLabel, trialDays, start, restore, checkExisting, busy: busy || awaitingReturn, error };
}
