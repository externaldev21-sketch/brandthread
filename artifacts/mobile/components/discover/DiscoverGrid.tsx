/**
 * The For You / Fits Explore grid — 3 columns, 2pt gaps, every ~5th tile a
 * 2x2 feature (Instagram Explore's real packing pattern: a big tile plus two
 * small tiles stacked beside it, consuming one 2-row block). "Just Dropped"
 * and "High Demand" rails are inserted as full-width rows after the first
 * couple of grid rows, and a "People with your style" row every ~20 tiles —
 * all inside one FlatList so scroll position and infinite-scroll stay simple.
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

export type { GridRow } from '@/lib/discoverGridPacking';

const GAP = 2;

function RailHeader({ title, sub }: { title: string; sub?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={[TYPE_SCALE.headline, { color: theme.text }]}>{title}</Text>
      {!!sub && <Text style={[TYPE_SCALE.footnote, { color: theme.muted, marginTop: 2 }]}>{sub}</Text>}
    </View>
  );
}

export const DiscoverGrid = forwardRef<FlatList<GridRow>, {
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
}, ref) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - GAP * 2) / 3);
  const big = cell * 2 + GAP;

  const flatIndexOf = useMemo(() => {
    const map = new Map<string, number>();
    posts.forEach((p, idx) => map.set(p.id, idx));
    return map;
  }, [posts]);

  const rows = useMemo(() => {
    if (loading) {
      return [0, 1, 2].map((i): GridRow => ({ key: `skeleton-${i}`, type: 'normal', tiles: [] }));
    }
    return buildGridRows(posts, {
      showRails,
      hasJustDropped: justDroppedItems.length > 0,
      hasHighDemand: highDemandItems.length > 0,
      hasTrendingBrands: trendingBrands.length > 0,
      hasShopTheLook: shopTheLookPosts.length > 0,
      hasPeople: people.length > 0,
    });
  }, [
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
              {[0, 1, 2].map((col) => <DiscoverTileSkeleton key={col} width={cell} height={cell} />)}
            </View>
          );
        }
        if (row.type === 'normal') {
          return (
            <View style={styles.row}>
              {row.tiles.map((post) => (
                <DiscoverTileView
                  key={post.id}
                  post={post}
                  width={cell}
                  height={cell}
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
                height={big}
                onPress={() => onTilePress(row.big, flatIndexOf.get(row.big.id) ?? 0)}
                onLongPress={() => onTileLongPress(row.big)}
              />
              <View style={{ gap: GAP }}>
                {row.small.map((post) => (
                  <DiscoverTileView
                    key={post.id}
                    post={post}
                    width={cell}
                    height={cell}
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
