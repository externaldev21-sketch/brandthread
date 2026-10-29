/**
 * Watch Threads — the seller Studio menu's first card.
 *
 * The real buyer Threads feed (exactly buyer Home's FeedScreen, see
 * app/(buyer)/index.tsx) pushed on the root stack over the seller app, so
 * the seller browses, comments, saves and buys as their own seller account
 * without being switched into the buyer tab shell. Back pops to where they
 * opened it from (the Studio menu's "tile → back ⇒ menu" return applies).
 */
import React, { useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import FeedScreen from './(tabs)/feed';
import { goBackOr } from '@/lib/navigation/goBackOr';

export default function WatchThreadsScreen() {
  const router = useRouter();
  const handleBack = useCallback(() => goBackOr(router, '/(tabs)'), [router]);

  return (
    <>
      <StatusBar style="light" />
      <FeedScreen showFashionPreview onBack={handleBack} />
    </>
  );
}
