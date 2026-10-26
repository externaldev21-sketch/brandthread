/**
 * Discover tile tap-through — TikTok's Discover → player.
 *
 * `postId` (Discover): the real Threads feed — exactly buyer Home's
 * FeedScreen (app/(buyer)/index.tsx), same header, data and interactions —
 * opened on the tapped post, then its normal For You content after it.
 * Pushed on the root stack (the same pop-in as any card), so back pops
 * straight to Discover, which keeps its scroll position (useScrollReset
 * resetOnReturn = false there).
 *
 * `q` (profile grids' demo tiles): the creatorFeed player over the
 * lib/discoverPlayerQueue token the tile tap parked its grid under.
 */
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams } from 'expo-router';
import FeedScreen from './(tabs)/feed';

export default function DiscoverPlayerScreen() {
  const params = useLocalSearchParams<{ q?: string; postId?: string }>();
  const postId = typeof params.postId === 'string' ? params.postId : '';
  const token = typeof params.q === 'string' ? params.q : '';

  return (
    <>
      <StatusBar style="light" />
      {postId ? (
        <FeedScreen key={postId} showFashionPreview anchorPostId={postId} />
      ) : (
        <FeedScreen
          key={token}
          creatorFeed={{ source: 'discover', id: token, title: 'Discover' }}
        />
      )}
    </>
  );
}
