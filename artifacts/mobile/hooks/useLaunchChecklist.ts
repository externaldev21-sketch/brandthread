import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useApi } from '@/hooks/useApi';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { buildDemoLaunchChecklist, buildFreshLaunchChecklist, type LaunchChecklistResponse } from '@/lib/launchChecklist';

/**
 * The seller's server-derived launch checklist, refetched whenever the screen
 * regains focus so a step finished elsewhere ticks off on return. The signed-out
 * web preview never calls the API: it shows a brand-new account's checklist, or
 * the demo checklist with `&demo=1`.
 */
export function useLaunchChecklist() {
  const api = useApi();
  const [checklist, setChecklist] = useState<LaunchChecklistResponse | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (isSellerDevPreview()) {
      setChecklist(isPreviewDemoMode() ? buildDemoLaunchChecklist() : buildFreshLaunchChecklist());
      return;
    }
    try {
      setChecklist(await api.seller.launchChecklist.get());
      setError(false);
    } catch {
      setError(true);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const dismiss = useCallback(async () => {
    setChecklist((c) => (c ? { ...c, dismissed: true } : c));
    if (isSellerDevPreview()) return;
    try {
      await api.seller.launchChecklist.dismiss();
    } catch {
      void load();
    }
  }, [api, load]);

  return { checklist, error, reload: load, dismiss };
}
