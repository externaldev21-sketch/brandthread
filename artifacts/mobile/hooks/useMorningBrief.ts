import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { useApi } from '@/hooks/useApi';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import {
  buildPreviewMorningBrief,
  deviceTimeZone,
  dismissMorningBriefFor,
  readMorningBriefPrefs,
  shouldShowMorningBrief,
  turnOffMorningBrief,
  type MorningBrief,
} from '@/lib/morningBrief';
import { allPreviewSellerOrders } from '@/lib/previewSellerOrders';
import { getPreviewSellerProducts } from '@/lib/previewSellerProducts';

function previewBrief(): MorningBrief | null {
  if (!isPreviewDemoMode()) return null; // fresh preview: no orders, no card
  const now = new Date();
  const products = getPreviewSellerProducts().map((p) => ({
    id: p.id,
    name: p.name,
    stocks: p.variants.length > 0 ? p.variants.map((v) => v.inventoryQuantity) : [p.inventory.totalStock],
  }));
  return buildPreviewMorningBrief(now, allPreviewSellerOrders(now), products);
}

/**
 * The seller's morning brief plus this device's dismiss / turn-off state.
 * Refetched on focus, so a brief left open overnight is replaced by the new
 * day's one. The signed-out web preview never calls the API.
 */
export function useMorningBrief(userId: string | null | undefined, storeContextTick = 0) {
  const api = useApi();
  const prefsUser = userId ?? (isSellerDevPreview() ? 'preview-seller' : null);
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [prefs, setPrefs] = useState<{ dismissedDate: string | null; off: boolean } | null>(null);

  useEffect(() => {
    let active = true;
    setPrefs(null);
    if (!prefsUser) return;
    void readMorningBriefPrefs(prefsUser).then((next) => { if (active) setPrefs(next); });
    return () => { active = false; };
  }, [prefsUser]);

  const load = useCallback(async () => {
    if (isSellerDevPreview()) {
      setBrief(previewBrief());
      return;
    }
    if (!userId) return;
    try {
      setBrief(await api.seller.morningBrief(deviceTimeZone()));
    } catch {
      // Not worth an error banner: the card simply doesn't show.
      setBrief(null);
    }
  }, [api, userId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    if (storeContextTick > 0) {
      setBrief(null);
      void load();
    }
  }, [load, storeContextTick]);

  const dismiss = useCallback(() => {
    if (!brief || !prefsUser) return;
    setPrefs((p) => ({ off: p?.off ?? false, dismissedDate: brief.date }));
    void dismissMorningBriefFor(prefsUser, brief.date);
  }, [brief, prefsUser]);

  const turnOff = useCallback(() => {
    if (!prefsUser) return;
    setPrefs((p) => ({ dismissedDate: p?.dismissedDate ?? null, off: true }));
    void turnOffMorningBrief(prefsUser);
  }, [prefsUser]);

  // Prefs not read yet: stay hidden rather than flash a dismissed card.
  const visible = prefs !== null && shouldShowMorningBrief(brief, { now: new Date(), ...prefs });

  return { brief, visible, dismiss, turnOff };
}
