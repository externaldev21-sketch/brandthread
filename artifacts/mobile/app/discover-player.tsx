/**
 * Discover tile tap-through — TikTok's Discover → player.
 *
 * This is the SAME feed player as the Threads home feed (app/(tabs)/feed.tsx)
 * — same pages, video with sound, like / comment / save / share rail, caption
 * block and shop sheet — opened at the tapped Discover post and swiping on
 * through the rest of that grid (then Threads For You). Back pops straight
 * to Discover, which keeps its scroll position (useScrollReset resetOnReturn
 * = false there).
 *
 * Params: q = the lib/discoverPlayerQueue token the tile tap parked its grid under.
 */
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams } from 'expo-router';
import FeedScreen from './(tabs)/feed';

export default function DiscoverPlayerScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const token = typeof params.q === 'string' ? params.q : '';

  return (
    <>
      <StatusBar style="light" />
      <FeedScreen
        key={token}
        creatorFeed={{ source: 'discover', id: token, title: 'Discover' }}
      />
    </>
  );
}
