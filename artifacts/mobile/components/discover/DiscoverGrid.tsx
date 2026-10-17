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
 *
 * Paging (hooks/useDiscoverFeed.ts): new pages only ever append rows below
 * the ones on screen, the footer shows a small spinner while one loads and an
 * inline retry if it fails, and the empty state renders only when the caller
 * says the first page was truly empty (`showEmpty`), never mid-refresh or
 * after an error. Tiles sit on a 16pt gutter with a 3pt gap (audit #41).
 */
import React, { forwardRef, useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';
import { EmptyState, SectionHeader } from '@/components/reframe';
import { X_GUTTER, X_SPACE, X_TYPE, xColors } from '@/constants/reframe';
import { ThemedRefreshControl } from '@/components/ui';
import { EditorialTile, type EditorialTileItem } from './EditorialTile';
import { DiscoverTileView, DiscoverTileSkeleton } from './DiscoverTileView';
import { DiscoverPeopleRow } from './DiscoverPeopleRow';
import { DiscoverShopTheLookRail } from './DiscoverShopTheLookRail';
import { DiscoverTrendingBrandsRail } from './DiscoverTrendingBrandsRail';
import { ShopByCategoryRail, TrendingProductsRail } from './DiscoverShopRails';
import type { DiscoveryCategory } from '@/lib/discoveryShelves';
import type { DiscoverPost, DiscoverPersonSuggestion, DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';
import { buildGridRows, type GridRow } from '@/lib/discoverGridPacking';

export type { GridRow } from '@/lib/discoverGridPacking';

/** Inner gap between tiles (IG Explore's ~2-4pt) and the outer page gutter. */
export const GRID_GAP = 3;
export const GRID_GUTTER = X_GUTTER;
const GAP = GRID_GAP;

/** Tile geometry shared with the first-load skeleton so the two line up exactly. */
export function gridGeometry(width: number) {
  const cell = Math.floor((width - GRID_GUTTER * 2 - GAP * 2) / 3);
  // 3:4 portrait (width:height) — the whole outfit fits, not a near-square
  // crop. The 2x2 feature spans two rows at the same ratio: doubling both
  // dimensions and adding the row gap keeps width:height at 3:4.
  const cellHeight = Math.round((cell * 4) / 3);
  return { cell, cellHeight, big: cell * 2 + GAP, bigHeight: cellHeight * 2 + GAP };
}

function RailHeader({ title, sub }: { title: string; sub?: string }) {
  return <SectionHeader title={title} subtitle={sub} inset={false} />;
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
  /** Rendered after the last row (and the load-more spinner). */
  ListFooterExtra?: React.ReactElement | null;
  /** Pull-to-refresh; current tiles stay on screen while it runs. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Only when true is "Nothing to show yet" rendered. Defaults to `!loading` for older callers. */
  showEmpty?: boolean;
  /** A failed refresh / next page: tiles stay, a small inline retry shows. */
  error?: 'first' | 'refresh' | 'more' | null;
  onRetry?: () => void;
  /** More pages are coming: hold back a trailing partial row so it never re-packs under the user. */
  holdIncompleteRow?: boolean;
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
  refreshing = false,
  onRefresh,
  showEmpty,
  error = null,
  onRetry,
  holdIncompleteRow = false,
}, ref) {
  const { theme } = useAppTheme();
  const c = xColors(theme);
  const { width } = useWindowDimensions();
  const { cell, cellHeight, big, bigHeight } = gridGeometry(width);

  const packed = useMemo(() => {
    if (!holdIncompleteRow || posts.length < 3) return posts;
    const rem = posts.length % 3;
    return rem === 0 ? posts : posts.slice(0, posts.length - rem);
  }, [posts, holdIncompleteRow]);

  const flatIndexOf = useMemo(() => {
    const map = new Map<string, number>();
    posts.forEach((p, idx) => map.set(p.id, idx));
    return map;
  }, [posts]);

  // Stable per-tile handlers (the parent's are inline arrows), so memoized
  // tiles already on screen don't re-render when a page is appended.
  const latest = useRef({ onTilePress, onTileLongPress, flatIndexOf });
  latest.current = { onTilePress, onTileLongPress, flatIndexOf };
  const handleTilePress = useCallback((post: DiscoverPost) => {
    latest.current.onTilePress(post, latest.current.flatIndexOf.get(post.id) ?? 0);
  }, []);
  const handleTileLongPress = useCallback((post: DiscoverPost) => latest.current.onTileLongPress(post), []);

  const rows = useMemo(() => {
    if (loading) {
      return [0, 1, 2].map((i): GridRow => ({ key: `skeleton-${i}`, type: 'normal', tiles: [] }));
    }
    return buildGridRows(packed, {
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
    packed,
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
      // Ask for the next page about a screen early so it lands before the end.
      onEndReachedThreshold={1}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={contentContainerStyle}
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={11}
      refreshControl={onRefresh ? <ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined}
      ListHeaderComponent={(
        <>
          {typeof ListHeaderComponent === 'function'
            ? React.createElement(ListHeaderComponent)
            : ListHeaderComponent ?? null}
          {(error === 'refresh' || (error === 'first' && posts.length > 0)) && onRetry ? (
            <InlineRetry label="Couldn't refresh." onRetry={onRetry} color={c.secondary} actionColor={c.text} testID="discover-refresh-retry" />
          ) : null}
          {/* Breathing room between the header divider and the first tiles (audit #39). */}
          <View style={styles.topSpacer} />
        </>
      )}
      ListEmptyComponent={
        error === 'first' && onRetry ? (
          <EmptyState
            tone="error"
            message="Couldn't load Discover. Check your connection and try again."
            actionLabel="Try again"
            onAction={onRetry}
            testID="discover-first-load-error"
          />
        ) : (showEmpty ?? !loading) ? (
          <EmptyState
            title="Nothing to show yet"
            message="Posts from buyers and brands will show up here as the community grows."
            testID="discover-empty-state"
          />
        ) : null
      }
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
                  onPress={handleTilePress}
                  onLongPress={handleTileLongPress}
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
                onPress={handleTilePress}
                onLongPress={handleTileLongPress}
              />
              <View style={{ gap: GAP }}>
                {row.small.map((post) => (
                  <DiscoverTileView
                    key={post.id}
                    post={post}
                    width={cell}
                    height={cellHeight}
                    onPress={handleTilePress}
                    onLongPress={handleTileLongPress}
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
          <View style={{ marginVertical: X_SPACE[8], paddingHorizontal: X_GUTTER }}>
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
      ListFooterComponent={(loadingMore || error === 'more' || ListFooterExtra) ? (
        <>
          {loadingMore ? (
            <View style={styles.footerLoading} testID="discover-load-more-spinner">
              <ActivityIndicator size="small" color={c.secondary} />
            </View>
          ) : null}
          {error === 'more' && onRetry ? (
            <InlineRetry label="Couldn't load more." onRetry={onRetry} color={c.secondary} actionColor={c.text} testID="discover-load-more-retry" />
          ) : null}
          {ListFooterExtra ?? null}
        </>
      ) : null}
    />
  );
});

function InlineRetry({ label, onRetry, color, actionColor, testID }: { label: string; onRetry: () => void; color: string; actionColor: string; testID?: string }) {
  return (
    <View style={styles.retryRow}>
      <Text style={[styles.retryText, { color }]}>{label}</Text>
      <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry" hitSlop={8} testID={testID}>
        <Text style={[styles.retryText, styles.retryAction, { color: actionColor }]}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP, paddingHorizontal: GRID_GUTTER },
  topSpacer: { height: X_SPACE[12] },
  footerLoading: { paddingVertical: SP.lg, alignItems: 'center', justifyContent: 'center', minHeight: 56 },
  retryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: X_SPACE[8],
    paddingHorizontal: GRID_GUTTER, paddingVertical: X_SPACE[12],
  },
  retryText: { ...X_TYPE.meta },
  retryAction: { fontFamily: FONT.bold },
});
