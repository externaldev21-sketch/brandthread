import { useCallback, useEffect, useState } from 'react';

import { useApi } from '@/hooks/useApi';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { buildPreviewMilestone, readPreviewSeen, writePreviewSeen, type SellerMilestone } from '@/lib/milestones';
import { PREVIEW_SELLER_IDENTITY } from '@/lib/previewIdentity';
import { allPreviewSellerOrders } from '@/lib/previewSellerOrders';
import { getPreviewSellerProducts } from '@/lib/previewSellerProducts';

async function previewMilestone(): Promise<SellerMilestone | null> {
  if (!isPreviewDemoMode()) return null; // fresh preview: no sales, no milestone
  const now = new Date();
  const milestone = buildPreviewMilestone(allPreviewSellerOrders(now), {
    storeName: PREVIEW_SELLER_IDENTITY.brandName,
    handle: PREVIEW_SELLER_IDENTITY.username,
    productImageUrl: getPreviewSellerProducts()[0]?.media[0]?.uri ?? null,
  }, now);
  if (!milestone) return null;
  return (await readPreviewSeen()) === milestone.key ? null : milestone;
}

/**
 * The seller's highest unseen milestone, asked for once per dashboard mount
 * and store switch (the server records new ones lazily on this call). Once
 * shown and then shared or closed, `markSeen` retires it for good.
 */
export function useMilestone(userId: string | null | undefined, storeContextTick = 0) {
  const api = useApi();
  const [milestone, setMilestone] = useState<SellerMilestone | null>(null);

  useEffect(() => {
    let active = true;
    setMilestone(null);
    const load = async () => {
      if (isSellerDevPreview()) return previewMilestone();
      if (!userId) return null;
      return api.seller.milestones.next().catch(() => null);
    };
    void load().then((next) => { if (active) setMilestone(next ?? null); });
    return () => { active = false; };
  }, [api, storeContextTick, userId]);

  const markSeen = useCallback(() => {
    if (!milestone) return;
    setMilestone(null);
    if (isSellerDevPreview()) {
      void writePreviewSeen(milestone.key);
      return;
    }
    void api.seller.milestones.seen(milestone.key).catch(() => {});
  }, [api, milestone]);

  return { milestone, markSeen };
}
