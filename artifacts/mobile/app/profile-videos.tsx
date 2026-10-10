/**
 * Full-screen video player scoped to one creator (profile grid tap) or to the
 * videos featuring one product (product detail "Featured in").
 *
 * This is the SAME feed player as the main Thread feed (app/(tabs)/feed.tsx) —
 * same pages, like / comment / repost / save / share rail, and shop sheet →
 * product detail → checkout — opened at the tapped video, swiping only through
 * that creator's (or product's) videos.
 *
 * Params: source=creator|product, id, startPostId?, title?
 */
import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useExpandFromTileOverlay } from '@/components/ExpandFromTileOverlay';
import { useLocalSearchParams } from 'expo-router';
import FeedScreen from './(tabs)/feed';
import { EmptyState } from '@/components/BrandthreadUI';

export default function ProfileVideosScreen() {
  const params = useLocalSearchParams<{ source?: string; id?: string; startPostId?: string; title?: string; exactPost?: string }>();
  const source = params.source === 'product' ? 'product' : 'creator';
  const id = typeof params.id === 'string' ? params.id : '';
  const { width, height } = useWindowDimensions();
  // Zoom from the tapped grid tile into the full-screen player (the tile's
  // rect is handed over by ProfileVideoTile); no-op on deep links / back.
  const { overlay } = useExpandFromTileOverlay(
    typeof params.startPostId === 'string' ? params.startPostId : undefined,
    { x: 0, y: 0, width, height },
  );

  if (!id) {
    return <EmptyState icon="film" title="Video not found" description="This link is missing the creator or product it belongs to." />;
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="light" />
      <FeedScreen
        key={`${source}:${id}:${params.startPostId ?? ''}`}
        creatorFeed={{
          source,
          id,
          startPostId: typeof params.startPostId === 'string' ? params.startPostId : undefined,
          title: typeof params.title === 'string' ? params.title : undefined,
          exactPost: params.exactPost === '1',
        }}
      />
      {overlay}
    </View>
  );
}
