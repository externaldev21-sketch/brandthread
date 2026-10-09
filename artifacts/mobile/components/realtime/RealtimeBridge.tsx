/**
 * App-wide realtime listener (mounted once in app/_layout.tsx). Keeps the
 * per-user messages socket open while signed in and applies the events that
 * don't belong to one screen: a new order recounts the seller's Orders tab
 * badge through its existing store (lib/orderBadgeStore.ts), so the tab bar
 * — whose own code is untouched — re-renders straight away.
 */
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { refreshSellerOrderBadge } from '@/lib/sellerOrderBadge';
import { useRealtimeEvents } from '@/lib/realtime/conversationRealtime';

export function RealtimeBridge(): null {
  const { userId, isSignedIn } = useAuth();
  const api = useApi();
  useRealtimeEvents((event) => {
    if (event.type === 'order.created' && userId) {
      void refreshSellerOrderBadge(userId, () => api.orders.list());
    }
  }, !!isSignedIn && !!userId);
  return null;
}
