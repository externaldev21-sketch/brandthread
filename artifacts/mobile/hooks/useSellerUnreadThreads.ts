import { useCallback, useState } from 'react';
import { useAuth } from '@clerk/expo';
import { useFocusEffect } from 'expo-router';

import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { getSellerPreviewConversations } from '@/lib/previewInbox';
import { countUnreadBuyerThreads } from '@/lib/sellerDashboardStats';

/** Same cadence as the inbox's own conversation poll (app/seller-inbox.tsx). */
const POLL_MS = 30_000;

/**
 * Unread buyer threads for the seller's Messages shortcut badge (dashboard top
 * bar, own profile). Real GET /api/conversations, refetched on focus and every
 * 30s while focused, so reading a thread and coming back clears it. The
 * signed-out preview counts the seeded demo thread only under `&demo=1`.
 */
export function useSellerUnreadThreads(): number {
  const { isSignedIn } = useAuth();
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!isSignedIn) {
      setCount(isSellerDevPreview() && isPreviewDemoMode() ? countUnreadBuyerThreads(getSellerPreviewConversations()) : 0);
      return;
    }
    try {
      const { getConversations } = await import('@/services/socialService');
      setCount(countUnreadBuyerThreads(await getConversations()));
    } catch {
      // Keep the last known count rather than flashing it away offline.
    }
  }, [isSignedIn]);

  useFocusEffect(useCallback(() => {
    void load();
    const id = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(id);
  }, [load]));

  return count;
}
