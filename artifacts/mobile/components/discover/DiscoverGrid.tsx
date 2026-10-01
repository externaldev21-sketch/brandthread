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
import { ShopByCategoryRail, TrendingProductsRail } from './DiscoverShopRails';
import type { DiscoveryCategory } from '@/lib/discoveryShelves';
import type { DiscoverPost, DiscoverPersonSuggestion, DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';
import { buildGridRows, type GridRow } from '@/lib/discoverGridPacking';

export type { GridRow } from '@/lib/discoverGridPacking';

const GAP = 1;

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
  trendingProducts?: any[];
  shopCategories?: DiscoveryCategory[];
  onSeeAllTrendingProducts?: () => void;
  onSeeAllTrendingBrands?: () => void;
  people?: DiscoverPersonSuggestion[];
  showRails?: boolean;
  onEndReached?: () => void;
  onTilePress: (post: DiscoverPost, flatIndex: number) => void;
  onTileLongPress: (post: DiscoverPost) => void;
  contentContainerStyle?: object;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement;
  /** Rendered after the last row (and the load-more skeleton). */
  ListFooterExtra?: React.ReactElement | null;
}>(function DiscoverGrid({
  posts,
  loading,
  loadingMore,
  justDroppedItems = [],
  highDemandItems = [],
  shopTheLookPosts = [],
  onOpenShopTheLook,
  trendingBrands = [],
  trendingProducts = [],
  shopCategories = [],
  onSeeAllTrendingProducts,
  onSeeAllTrendingBrands,
  people = [],
  showRails = true,
  onEndReached,
  onTilePress,
  onTileLongPress,
  contentContainerStyle,
  ListHeaderComponent,
  ListFooterExtra,
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
      hasTrendingProducts: trendingProducts.length > 0,
      hasShopCategories: shopCategories.length > 0,
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
    trendingProducts.length,
    shopCategories.length,
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
          return <DiscoverTrendingBrandsRail brands={trendingBrands} onSeeAll={onSeeAllTrendingBrands} />;
        }
        if (row.kind === 'shopTheLook') {
          return <DiscoverShopTheLookRail posts={shopTheLookPosts} onPress={onOpenShopTheLook ?? (() => {})} />;
        }
        if (row.kind === 'trendingProducts') {
          return <TrendingProductsRail products={trendingProducts} onSeeAll={onSeeAllTrendingProducts} />;
        }
        if (row.kind === 'shopByCategory') {
          return <ShopByCategoryRail categories={shopCategories} />;
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
      ListFooterComponent={(loadingMore || ListFooterExtra) ? (
        <>
          {loadingMore ? (
            <View style={styles.footerLoading}>
              <TileRailSkeleton />
            </View>
          ) : null}
          {ListFooterExtra ?? null}
        </>
      ) : null}
    />
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  footerLoading: { paddingHorizontal: SP.md, paddingVertical: SP.md },
});
