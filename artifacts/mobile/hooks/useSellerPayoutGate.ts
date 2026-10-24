import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@clerk/expo';

import { useApi } from '@/lib/api';
import { isSellerDevPreview } from '@/lib/devPreview';
import type { PayoutGateState } from '@/lib/payoutGate';

/**
 * Reads GET /api/products/payout-gate, refreshed whenever the screen regains
 * focus. A signed-out ?bt_preview=seller session resolves to ready — the
 * same bypass app/payouts.tsx and app/payout-setup.tsx use.
 */
export function useSellerPayoutGate(enabled = true): PayoutGateState & { refresh: () => Promise<void>; markNotReady: () => void } {
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const preview = isSellerDevPreview() && (!isLoaded || !isSignedIn);
  const [state, setState] = useState<PayoutGateState>({ ready: null, liveProductCount: 0 });

  const refresh = useCallback(async () => {
    if (preview) {
      setState({ ready: true, liveProductCount: 0 });
      return;
    }
    if (!enabled) return;
    try {
      const next = await api.products.payoutGate();
      setState({ ready: next.ready === true, liveProductCount: Number(next.liveProductCount) || 0 });
    } catch {
      // Unknown readiness never blocks the UI; the server still enforces the gate.
    }
  }, [api, enabled, preview]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  const markNotReady = useCallback(() => setState((prev) => ({ ...prev, ready: false })), []);
  return { ...state, refresh, markNotReady };
}
