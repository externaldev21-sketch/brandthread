/**
 * The For You / Fits Explore grid — 3 columns, 1pt gaps, every ~5th tile a
 * 2x2 feature (Instagram Explore's real packing pattern: a big tile plus two
 * small tiles stacked beside it, consuming one 2-row block). Every tile is
 * portrait 3:4 (width:height) so a full-length fashion photo or video fits
 * without its head or feet being chopped off (item 46) — the 2x2 feature
 * spans two rows at the same 3:4 ratio since doubling both dimensions plus
 * the row gap preserves it. "Just Dropped" and "High Demand" rails are
 * inserted as full-width rows after the first couple of grid rows, and a
 * "People with your style" row every ~20 tiles — all inside one FlashList so
 * scroll position and infinite-scroll stay simple. Rows recycle by type
 * (getItemType), so a tile row is only ever reused as another tile row.
 */
import React, { forwardRef, useCallback, useMemo, useRef } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { RefreshControlProps } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SP } from '@/lib/theme';
import { EmptyState, SectionHeader } from '@/components/reframe';
import { X_GUTTER, X_SPACE } from '@/constants/reframe';
import { EditorialTile, TileRailSkeleton, type EditorialTileItem } from './EditorialTile';
import { DiscoverTileView, DiscoverTileSkeleton } from './DiscoverTileView';
import { DiscoverPeopleRow } from './DiscoverPeopleRow';
import { DiscoverShopTheLookRail } from './DiscoverShopTheLookRail';
import { DiscoverTrendingBrandsRail } from './DiscoverTrendingBrandsRail';
import { ShopByCategoryRail, TrendingProductsRail } from './DiscoverShopRails';
import type { DiscoveryCategory } from '@/lib/discoveryShelves';
import type { DiscoverPost, DiscoverPersonSuggestion, DiscoverBrandCard as BrandCardData } from '@/lib/discoverFeed';
import { buildGridRows, type GridRow } from '@/lib/discoverGridPacking';
import type { SponsoredFeedItem } from '@/lib/feedAds';
import { buildMasonrySections, splitMasonryColumns, tileAspectRatio, type MasonrySection } from '@/lib/discoverMasonry';
import { DiscoverSectionHeader } from './DiscoverSectionHeader';
import { DiscoverMasonryTile, DiscoverMasonryTileSkeleton, MASONRY_CAPTION_HEIGHT } from './DiscoverMasonryTile';
import { DiscoverTrendingNowRail } from './DiscoverTrendingNowRail';
import { ThemedRefreshControl } from '@/components/ui/ThemedRefreshControl';

export type { GridRow } from '@/lib/discoverGridPacking';

export const GRID_GAP = 3;
const GAP = GRID_GAP;
export const GRID_GUTTER = 16;
export function gridGeometry(width: number) {
  const cell = Math.floor((width - GRID_GUTTER * 2 - GAP * 2) / 3);
  const cellHeight = Math.round(cell * 4 / 3);
  return { cell, cellHeight, big: cell * 2 + GAP, bigHeight: cellHeight * 2 + GAP };
}

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
  return <SectionHeader title={title} subtitle={sub} inset={false} />;
}
// Masonry (For You): Pinterest's narrow outer margin and gutter.
const MASONRY_SIDE = SP.sm;
const MASONRY_GUTTER = SP.sm;
const MASONRY_ROW_GAP = 14;
const SKELETON_ASPECTS = [3 / 4, 2 / 3, 1, 4 / 5, 2 / 3, 3 / 4];

const EMPTY_SPONSORED: ReadonlyArray<{ afterId: string; item: SponsoredFeedItem }> = [];

export const DiscoverGrid = forwardRef<FlashListRef<Row>, {
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
  /** Explicit scroll-end room for the floating navigation, including web. */
  bottomClearance?: number;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement;
  /** Rendered after the last row (and the load-more skeleton). */
  ListFooterExtra?: React.ReactElement | null;
  /** Sponsored ads (hooks/useFeedAds), each placed after the row holding `afterId`. */
  sponsored?: ReadonlyArray<{ afterId: string; item: SponsoredFeedItem }>;
  renderSponsored?: (item: SponsoredFeedItem) => React.ReactElement;
  /** Pull-to-refresh control for the grid. */
  refreshControl?: React.ReactElement<RefreshControlProps>;
  refreshing?: boolean;
  onRefresh?: () => void;
  showEmpty?: boolean;
  error?: 'first' | 'refresh' | 'more' | null;
  onRetry?: () => void;
  holdIncompleteRow?: boolean;
  /**
   * 'explore' (default) is the 3-column Instagram Explore grid; 'masonry' is
   * the Pinterest-style staggered 2-column For You grid with "Trending now"
   * (trending products) leading it.
   */
  layout?: 'explore' | 'masonry';
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
  bottomClearance = 0,
  ListHeaderComponent,
  ListFooterExtra,
  sponsored = EMPTY_SPONSORED,
  renderSponsored,
  refreshControl,
  refreshing = false,
  onRefresh,
  showEmpty,
  error = null,
  onRetry,
  holdIncompleteRow = false,
  layout = 'explore',
}, ref) {
  const { theme } = useAppTheme();
  const { width } = useWindowDimensions();
  const cell = Math.floor((width - GRID_GUTTER * 2 - GAP * 2) / 3);
  // 3:4 portrait (width:height) — the whole outfit fits, not a near-square
  // crop. The 2x2 feature spans two rows at the same ratio: doubling both
  // dimensions and adding the row gap keeps width:height at 3:4.
  const cellHeight = Math.round((cell * 4) / 3);
  const big = cell * 2 + GAP;
  const bigHeight = cellHeight * 2 + GAP;
  // Half-width cells for a re-packed 2-column trailing row (see
  // balanceTrailingRow) — same 3:4 ratio, spans the full grid width.
  const half = Math.floor((cell * 3 + GAP * 2 - GAP) / 2);
  const halfHeight = Math.round((half * 4) / 3);

  const flatIndexOf = useMemo(() => {
    const map = new Map<string, number>();
    posts.forEach((p, idx) => map.set(p.id, idx));
    return map;
  }, [posts]);

  const masonry = layout === 'masonry';
  const packed = useMemo(() => {
    const columns = masonry ? 2 : 3;
    if (!holdIncompleteRow || posts.length < columns) return posts;
    const rem = posts.length % columns;
    return rem ? posts.slice(0, posts.length - rem) : posts;
  }, [holdIncompleteRow, posts, masonry]);
  const latest = useRef({ onTilePress, onTileLongPress, flatIndexOf });
  latest.current = { onTilePress, onTileLongPress, flatIndexOf };
  const handleTilePress = useCallback((post: DiscoverPost) => latest.current.onTilePress(post, latest.current.flatIndexOf.get(post.id) ?? 0), []);
  const handleTileLongPress = useCallback((post: DiscoverPost) => latest.current.onTileLongPress(post), []);
  const rows = useMemo((): Row[] => {
    if (loading) {
      return [0, 1, 2].map((i): GridRow => ({ key: `skeleton-${i}`, type: 'normal', tiles: [] }));
    }
    return withSponsoredRows(buildGridRows(packed, {
      showRails,
      hasJustDropped: justDroppedItems.length > 0,
      hasHighDemand: highDemandItems.length > 0,
      hasTrendingBrands: trendingBrands.length > 0,
      hasShopTheLook: shopTheLookPosts.length > 0,
      // In masonry the trending products lead the grid as "Trending now"
      // instead of a rail further down — never both.
      hasTrendingProducts: !masonry && trendingProducts.length > 0,
      hasShopCategories: shopCategories.length > 0,
      hasPeople: people.length > 0,
    }), renderSponsored ? sponsored : EMPTY_SPONSORED);
  }, [
    sponsored,
    renderSponsored,
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
    masonry,
  ]);

  const masonryColumnWidth = (width - MASONRY_SIDE * 2 - MASONRY_GUTTER) / 2;
  const masonrySections = useMemo((): MasonrySection[] => {
    if (!masonry || loading) return [];
    return buildMasonrySections(rows, { trendingNow: trendingProducts.length > 0 });
  }, [masonry, loading, rows, trendingProducts.length]);

  /** Rails and the people row — identical in both layouts. */
  function renderRail(row: Exclude<Row, { type: 'normal' } | { type: 'feature' }>) {
    if (row.type === 'sponsored') return renderSponsored ? renderSponsored(row.item) : null;
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
      return <ShopByCategoryRail categories={shopCategories} discoverHeader />;
    }
    // Rail row (Just Dropped / High Demand)
    const items = row.kind === 'justDropped' ? justDroppedItems : highDemandItems;
    return (
      <View style={{ marginVertical: SP.md, paddingHorizontal: SP.md }}>
        <DiscoverSectionHeader title={row.kind === 'justDropped' ? 'Just Dropped' : 'High Demand'} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          {items.map((item) => <EditorialTile key={item.id} item={item} theme={theme} />)}
        </ScrollView>
      </View>
    );
  }

  const hideCreatorRows = useMemo(() => posts.length > 0 && !!posts[0].authorId &&
    posts.every(post => post.authorId === posts[0].authorId), [posts]);

  function renderMasonryBlock(posts: DiscoverPost[]) {
    const imageHeightOf = (post: DiscoverPost) => Math.round(masonryColumnWidth / tileAspectRatio(post));
    const cols = splitMasonryColumns(posts, (post) => imageHeightOf(post) + (hideCreatorRows ? 0 : MASONRY_CAPTION_HEIGHT), MASONRY_ROW_GAP);
    const column = (list: DiscoverPost[]) => (
      <View style={{ width: masonryColumnWidth, gap: MASONRY_ROW_GAP }}>
        {list.map((post) => (
          <DiscoverMasonryTile
            key={post.id}
            post={post}
            width={masonryColumnWidth}
            imageHeight={imageHeightOf(post)}
            showCreator={!hideCreatorRows}
            onPress={() => onTilePress(post, flatIndexOf.get(post.id) ?? 0)}
            onLongPress={() => onTileLongPress(post)}
          />
        ))}
      </View>
    );
    return (
      <View style={styles.masonryBlock}>
        {column(cols.left)}
        {column(cols.right)}
      </View>
    );
  }

  const retry = (label: string) => (
    <View style={{ padding: SP.md, alignItems: 'center', gap: 8 }}>
      <Text style={{ color: theme.muted }}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry" hitSlop={8} onPress={onRetry}>
        <Text style={{ color: theme.text }}>Retry</Text>
      </Pressable>
    </View>
  );
  const listHeader = (
    <>
      {typeof ListHeaderComponent === 'function' ? React.createElement(ListHeaderComponent) : ListHeaderComponent ?? null}
      {(error === 'refresh' || (error === 'first' && posts.length > 0)) && onRetry ? retry("Couldn't refresh.") : null}
      <View style={{ height: 12 }} />
    </>
  );
  const listFooter = (loadingMore || error === 'more' || ListFooterExtra || bottomClearance > 0) ? (
    <>
      {loadingMore ? (
        <View style={styles.footerLoading}>
          <ActivityIndicator size="small" color={theme.muted} />
        </View>
      ) : null}
      {error === 'more' && onRetry ? retry("Couldn't load more.") : null}
      {ListFooterExtra ?? null}
      {bottomClearance > 0 ? <View style={{ height: bottomClearance }} testID="discover-bottom-clearance" /> : null}
    </>
  ) : null;
  const listEmpty = error === 'first' && onRetry ? retry("Couldn't load Discover.") : (showEmpty ?? !loading) ? (
    <EmptyState
      title="Nothing to show yet"
      message="Posts from buyers and brands will show up here as the community grows."
    />
  ) : null;

  if (masonry) {
    const data: Array<MasonrySection | { key: string; type: 'skeleton' }> = loading
      ? [{ key: 'masonry-skeleton', type: 'skeleton' }]
      : masonrySections;
    return (
      <FlashList
        ref={ref as never}
        data={data}
        keyExtractor={(section) => section.key}
        onEndReached={loading ? undefined : onEndReached}
        onEndReachedThreshold={0.6}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={contentContainerStyle}
        refreshControl={refreshControl ?? (onRefresh ? <ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined)}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        renderItem={({ item: section }) => {
          if (section.type === 'skeleton') {
            const left = SKELETON_ASPECTS.filter((_, i) => i % 2 === 0);
            const right = SKELETON_ASPECTS.filter((_, i) => i % 2 === 1);
            return (
              <View style={styles.masonryBlock}>
                {[left, right].map((aspects, col) => (
                  <View key={col} style={{ width: masonryColumnWidth, gap: MASONRY_ROW_GAP }}>
                    {aspects.map((a, i) => (
                      <DiscoverMasonryTileSkeleton key={i} width={masonryColumnWidth} imageHeight={Math.round(masonryColumnWidth / a)} />
                    ))}
                  </View>
                ))}
              </View>
            );
          }
          if (section.type === 'trendingNow') {
            return <DiscoverTrendingNowRail products={trendingProducts} onSeeAll={onSeeAllTrendingProducts} />;
          }
          if (section.type === 'masonry') return renderMasonryBlock(section.posts);
          return renderRail(section);
        }}
        ListFooterComponent={listFooter}
      />
    );
  }

  return (
    <FlashList
      ref={ref as never}
      data={rows}
      keyExtractor={gridRowKey}
      getItemType={loading ? skeletonRowType : gridRowType}
      // FlatList semantics: no auto scroll-anchoring when rows change above.
      maintainVisibleContentPosition={MVCP_OFF}
      onEndReached={loading ? undefined : onEndReached}
      onEndReachedThreshold={0.6}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={contentContainerStyle}
      refreshControl={refreshControl ?? (onRefresh ? <ThemedRefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined)}
      ListHeaderComponent={listHeader}
      ListEmptyComponent={listEmpty}
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
                  width={row.cols === 2 ? half : cell}
                  height={row.cols === 2 ? halfHeight : cellHeight}
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
        return renderRail(row);
      }}
      ListFooterComponent={listFooter}
    />
  );
});

const MVCP_OFF = { disabled: true } as const;
const gridRowKey = (row: Row) => row.key;
const skeletonRowType = () => 'skeleton';
const gridRowType = (row: Row) => (row.type === 'rail' ? `rail-${row.kind}` : row.type);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP, paddingHorizontal: GRID_GUTTER },
  footerLoading: { paddingHorizontal: SP.md, paddingVertical: SP.md },
  masonryBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: MASONRY_GUTTER, paddingHorizontal: MASONRY_SIDE, marginBottom: MASONRY_ROW_GAP },
});
