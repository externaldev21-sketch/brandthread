/**
 * Old show link (/buyer-live?streamId=…) — "X went live" notifications and
 * Activity rows still point here. There is one show viewer now
 * (app/live.tsx: Agora video, chat, the item being sold with Buy now,
 * report / block via More and a long-pressed message, targetType: 'live'
 * and targetType: 'live_comment'), so this only forwards to it, opened at
 * the same show.
 */
import React from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { liveHref } from '@/lib/live/useLiveDirectory';

// Preserve the existing winner-payment flow; ordinary show links use the
// unified viewer. Load the payment compatibility screen only when needed.
const AuctionCheckout = React.lazy(() => import('@/components/live/LiveAuctionCheckoutViewer'));

export default function BuyerLiveRedirect() {
  const { streamId, payAuction } = useLocalSearchParams<{ streamId?: string; payAuction?: string }>();
  if (payAuction) return <React.Suspense fallback={null}><AuctionCheckout /></React.Suspense>;
  return <Redirect href={liveHref({ streamId: typeof streamId === 'string' ? streamId : null }) as never} />;
}
