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

export default function BuyerLiveRedirect() {
  const { streamId } = useLocalSearchParams<{ streamId?: string }>();
  return <Redirect href={liveHref({ streamId: typeof streamId === 'string' ? streamId : null }) as never} />;
}
