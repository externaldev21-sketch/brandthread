/**
 * The For You / Fits Explore grid — 3 columns, 1pt gaps, every ~5th tile a
 * 2x2 feature (Instagram Explore's real packing pattern: a big tile plus two
 * small tiles stacked beside it, consuming one 2-row block). Every tile is
 * portrait 3:4 (width:height) so a full-length fashion photo or video fits
 * without its head or feet being chopped off (item 46) — the 2x2 feature
 * spans two rows at the same 3:4 ratio since doubling both dimensions plus
 * the row gap preserves it. "Just Dropped" and "High Demand" rails are
 * inserted as full-width rows after the first couple of grid rows, and a
 * "People with your style" row every ~20 tiles — all inside one FlatList so
 * scroll position and infinite-scroll stay simple.
 */
import React, { forwardRef, useMemo } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { EmptyState } from '@/components/BrandthreadUI';
import { EditorialTile, TileRailSkeleton, type EditorialTileItem } from './EditorialTile';
import { DiscoverTileView, DiscoverTileSkeleton } from './DiscoverTileView';
import { DiscoverPeopleRow } from './DiscoverPeopleRow';
import { DiscoverShopTheLookRail } from './DiscoverShopTheLookRail';
import { DiscoverTrendingBrandsRail } from './DiscoverTrendingBrandsRail';
import type { DiscoverPost, DiscoverPersonSuggestion, DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';
import { buildGridRows, type GridRow } from '@/lib/discoverGridPacking';
import type { SponsoredFeedItem } from '@/lib/feedAds';

export type { GridRow } from '@/lib/discoverGridPacking';

const GAP = 1;

type SponsoredRow = { key: string; type: 'sponsored'; item: SponsoredFeedItem };
type Row = GridRow | SponsoredRow;

/** Puts each Sponsored row right after the grid row holding the post it follows. */
function withSponsoredRows(rows: GridRow[], anchors: ReadonlyArray<{ afterId: string; item: SponsoredFeedItem }>): Row[] {
  if (anchors.length === 0) return rows;
  const byPost = new Map(anchors.map((a) => [a.afterId, a.item]));
  const out: Row[] = [];
  for (const row of rows) {
    out.push(row);
    const ids = row.type === 'normal' ? row.tiles.map((t) => t.id)
      : row.type === 'feature' ? [row.big.id, ...row.small.map((t) => t.id)]
      : [];
    for (const id of ids) {
      const item = byPost.get(id);
      if (item) out.push({ key: item.id, type: 'sponsored', item });
    }
  }
  return out;
}

function RailHeader({ title, sub }: { title: string; sub?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={[TYPE_SCALE.headline, { color: theme.text }]}>{title}</Text>
      {!!sub && <Text style={[TYPE_SCALE.footnote, { color: theme.muted, marginTop: 2 }]}>{sub}</Text>}
    </View>
  );
}

const EMPTY_SPONSORED: ReadonlyArray<{ afterId: string; item: SponsoredFeedItem }> = [];

export const DiscoverGrid = forwardRef<FlatList<Row>, {
  posts: DiscoverPost[];
  loading: boolean;
  loadingMore?: boolean;
  justDroppedItems?: EditorialTileItem[];
  highDemandItems?: EditorialTileItem[];
  shopTheLookPosts?: DiscoverPost[];
  onOpenShopTheLook?: (post: DiscoverPost) => void;
  trendingBrands?: BrandCardData[];
  people?: DiscoverPersonSuggestion[];
  showRails?: boolean;
  onEndReached?: () => void;
  onTilePress: (post: DiscoverPost, flatIndex: number) => void;
  onTileLongPress: (post: DiscoverPost) => void;
  contentContainerStyle?: object;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement;
  /** Sponsored ads (hooks/useFeedAds), each placed after the row holding `afterId`. */
  sponsored?: ReadonlyArray<{ afterId: string; item: SponsoredFeedItem }>;
  renderSponsored?: (item: SponsoredFeedItem) => React.ReactElement;
}>(function DiscoverGrid({
  posts,
  loading,
  loadingMore,
  justDroppedItems = [],
  highDemandItems = [],
  shopTheLookPosts = [],
  onOpenShopTheLook,
  trendingBrands = [],
  people = [],
  showRails = true,
  onEndReached,
  onTilePress,
  onTileLongPress,
  contentContainerStyle,
  ListHeaderComponent,
  sponsored = EMPTY_SPONSORED,
  renderSponsored,
}, ref) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - GAP * 2) / 3);
  // 3:4 portrait (width:height) — the whole outfit fits, not a near-square
  // crop. The 2x2 feature spans two rows at the same ratio: doubling both
  // dimensions and adding the row gap keeps width:height at 3:4.
  const cellHeight = Math.round((cell * 4) / 3);
  const big = cell * 2 + GAP;
  const bigHeight = cellHeight * 2 + GAP;

  const flatIndexOf = useMemo(() => {
    const map = new Map<string, number>();
    posts.forEach((p, idx) => map.set(p.id, idx));
    return map;
  }, [posts]);

  const rows = useMemo((): Row[] => {
    if (loading) {
      return [0, 1, 2].map((i): GridRow => ({ key: `skeleton-${i}`, type: 'normal', tiles: [] }));
    }
    return withSponsoredRows(buildGridRows(posts, {
      showRails,
      hasJustDropped: justDroppedItems.length > 0,
      hasHighDemand: highDemandItems.length > 0,
      hasTrendingBrands: trendingBrands.length > 0,
      hasShopTheLook: shopTheLookPosts.length > 0,
      hasPeople: people.length > 0,
    }), renderSponsored ? sponsored : EMPTY_SPONSORED);
  }, [
    sponsored,
    renderSponsored,
    posts,
    loading,
    showRails,
    justDroppedItems.length,
    highDemandItems.length,
    trendingBrands.length,
    shopTheLookPosts.length,
    people.length,
  ]);

  return (
    <FlatList
      ref={ref}
      data={rows}
      keyExtractor={(row) => row.key}
      onEndReached={loading ? undefined : onEndReached}
      onEndReachedThreshold={0.6}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={contentContainerStyle}
      ListHeaderComponent={ListHeaderComponent}
      ListEmptyComponent={!loading ? (
        <EmptyState
          icon="activity"
          illustration="trending"
          title="Nothing to show yet"
          description="Posts from buyers and brands will show up here as the community grows."
        />
      ) : null}
      renderItem={({ item: row }) => {
        if (loading) {
          return (
            <View style={styles.row}>
              {[0, 1, 2].map((col) => <DiscoverTileSkeleton key={col} width={cell} height={cellHeight} />)}
            </View>
          );
        }
        if (row.type === 'sponsored') {
          return renderSponsored ? renderSponsored(row.item) : null;
        }
        if (row.type === 'normal') {
          return (
            <View style={styles.row}>
              {row.tiles.map((post) => (
                <DiscoverTileView
                  key={post.id}
                  post={post}
                  width={cell}
                  height={cellHeight}
                  onPress={() => onTilePress(post, flatIndexOf.get(post.id) ?? 0)}
                  onLongPress={() => onTileLongPress(post)}
                />
              ))}
            </View>
          );
        }
        if (row.type === 'feature') {
          return (
            <View style={styles.row}>
              <DiscoverTileView
                post={row.big}
                width={big}
                height={bigHeight}
                onPress={() => onTilePress(row.big, flatIndexOf.get(row.big.id) ?? 0)}
                onLongPress={() => onTileLongPress(row.big)}
              />
              <View style={{ gap: GAP }}>
                {row.small.map((post) => (
                  <DiscoverTileView
                    key={post.id}
                    post={post}
                    width={cell}
                    height={cellHeight}
                    onPress={() => onTilePress(post, flatIndexOf.get(post.id) ?? 0)}
                    onLongPress={() => onTileLongPress(post)}
                  />
                ))}
              </View>
            </View>
          );
        }
        if (row.type === 'people') {
          return <DiscoverPeopleRow people={people} />;
        }
        if (row.kind === 'trendingBrands') {
          return <DiscoverTrendingBrandsRail brands={trendingBrands} />;
        }
        if (row.kind === 'shopTheLook') {
          return <DiscoverShopTheLookRail posts={shopTheLookPosts} onPress={onOpenShopTheLook ?? (() => {})} />;
        }
        // Rail row (Just Dropped / High Demand)
        const items = row.kind === 'justDropped' ? justDroppedItems : highDemandItems;
        return (
          <View style={{ marginVertical: SP.md, paddingHorizontal: SP.md }}>
            <RailHeader
              title={row.kind === 'justDropped' ? 'Just Dropped' : 'High Demand'}
              sub={row.kind === 'justDropped' ? 'Fresh from sellers you follow' : 'Moving fast across the platform'}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
              {items.map((item) => <EditorialTile key={item.id} item={item} theme={theme} />)}
            </ScrollView>
          </View>
        );
      }}
      ListFooterComponent={loadingMore ? (
        <View style={styles.footerLoading}>
          <TileRailSkeleton />
        </View>
      ) : null}
    />
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  footerLoading: { paddingHorizontal: SP.md, paddingVertical: SP.md },
});
