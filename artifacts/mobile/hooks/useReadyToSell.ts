import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useApi } from '@/hooks/useApi';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { buildDemoReadyToSell, buildFreshReadyToSell, type ReadyToSellResponse } from '@/lib/readyToSell';

/**
 * The dashboard's "Get ready to sell" checklist plus whether the seller has a
 * paid plan (for the "Select a plan" card under it). Refetched on focus so a
 * step finished elsewhere ticks off on return. The signed-out web preview
 * never calls the API: fresh shows 0 / 6 and no plan; `&demo=1` a seller
 * part-way through on a plan.
 */
export function useReadyToSell() {
  const api = useApi();
  const [data, setData] = useState<ReadyToSellResponse | null>(null);
  const [hasPlan, setHasPlan] = useState<boolean | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (isSellerDevPreview()) {
      const demo = isPreviewDemoMode();
      setData(demo ? buildDemoReadyToSell() : buildFreshReadyToSell());
      setHasPlan(demo);
      return;
    }
    try {
      setData(await api.seller.launchChecklist.readyToSell());
      setError(false);
    } catch {
      setError(true);
    }
    api.seller.subscription.status()
      .then((s) => setHasPlan(['active', 'trialing', 'past_due'].includes(String(s.status))))
      .catch(() => setHasPlan(null));
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return { data, hasPlan, error, reload: load };
}
