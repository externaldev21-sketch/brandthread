/**
 * Is checkout live? Real money only moves when BOTH sides are set up:
 *  - the server: GET /api/public/checkout-config (STRIPE_SECRET_KEY,
 *    STRIPE_WEBHOOK_SECRET, CHECKOUT_ENABLED — api-server lib/checkoutConfig.ts)
 *  - the app: EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
 * Otherwise the bag and checkout show "Checkout isn't live yet" and never
 * charge or fake a charge. Apple Pay / Google Pay follow the server's
 * APPLE_PAY_ENABLED / GOOGLE_PAY_ENABLED on top of device support.
 */
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/lib/api';
import { stripePublishableKey } from '@/components/checkout/stripePaymentTypes';

import { CHECKING, OFF, resolveCheckoutLive, type CheckoutLive, type ServerConfig } from '@/lib/checkoutLiveState';

export type { CheckoutLive } from '@/lib/checkoutLiveState';

let cached: { at: number; value: CheckoutLive } | null = null;
let inflight: Promise<CheckoutLive> | null = null;
const TTL_MS = 60_000;

export function fetchCheckoutLive(): Promise<CheckoutLive> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
  const key = stripePublishableKey();
  if (!key) return Promise.resolve(OFF);
  inflight ??= fetch(`${API_BASE_URL}/api/public/checkout-config`)
    .then(r => (r.ok ? r.json() as Promise<ServerConfig> : null))
    .catch(() => null)
    .then(server => {
      const value = resolveCheckoutLive(key, server);
      // A failed request is not cached, so the next screen asks again.
      if (server) cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useCheckoutLive(): CheckoutLive {
  const [state, setState] = useState<CheckoutLive>(() => (cached ? cached.value : stripePublishableKey() ? CHECKING : OFF));
  useEffect(() => {
    let active = true;
    void fetchCheckoutLive().then(next => { if (active) setState(next); });
    return () => { active = false; };
  }, []);
  return state;
}

/** Test seam. */
export function resetCheckoutLiveCache(): void {
  cached = null;
  inflight = null;
}
