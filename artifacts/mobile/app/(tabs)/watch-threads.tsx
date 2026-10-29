/**
 * Watch Threads — the seller Studio menu's first card.
 *
 * The real buyer Threads feed (exactly buyer Home's FeedScreen, see
 * app/(buyer)/index.tsx), as a hidden tab of the seller tab group, so the
 * seller browses, comments, saves and buys as their own seller account:
 *  - the seller tab bar (and Studio / AI circles) stays on screen, one tap
 *    from Dashboard, Products, Orders or Profile (Dev: "I don't want it to
 *    just disappear and have no tab bar");
 *  - the tab navigator keeps visited scenes mounted (detachInactiveScreens
 *    false + RetainedScene), so leaving and coming back lands on the same
 *    post, not the top of the feed (Dev: "let's keep it back here where it's
 *    at");
 *  - Back returns to the tab they came from (backBehavior "history").
 */
import React, { useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import FeedScreen from './feed';
import { goBackOr } from '@/lib/navigation/goBackOr';

export default function WatchThreadsScreen() {
  const router = useRouter();
  const handleBack = useCallback(() => goBackOr(router, '/(tabs)'), [router]);

  return (
    <>
      <StatusBar style="light" />
      <FeedScreen showFashionPreview onBack={handleBack} overSellerTabBar />
    </>
  );
}
