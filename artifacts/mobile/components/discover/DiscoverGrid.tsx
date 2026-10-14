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
import React, { forwardRef, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import type { RefreshControlProps } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { TYPE_SCALE } from '@/constants/typography';
import { SP } from '@/lib/theme';
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
import type { SponsoredFeedItem } from '@/lib/feedAds';
import { buildMasonrySections, splitMasonryColumns, tileAspectRatio, type MasonrySection } from '@/lib/discoverMasonry';
import { DiscoverSectionHeader } from './DiscoverSectionHeader';
import { DiscoverMasonryTile, DiscoverMasonryTileSkeleton, MASONRY_CAPTION_HEIGHT } from './DiscoverMasonryTile';
import { DiscoverTrendingNowRail } from './DiscoverTrendingNowRail';

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
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement;
  /** Rendered after the last row (and the load-more skeleton). */
  ListFooterExtra?: React.ReactElement | null;
  /** Sponsored ads (hooks/useFeedAds), each placed after the row holding `afterId`. */
  sponsored?: ReadonlyArray<{ afterId: string; item: SponsoredFeedItem }>;
  renderSponsored?: (item: SponsoredFeedItem) => React.ReactElement;
  /** Pull-to-refresh control for the grid. */
  refreshControl?: React.ReactElement<RefreshControlProps>;
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
  ListHeaderComponent,
  ListFooterExtra,
  sponsored = EMPTY_SPONSORED,
  renderSponsored,
  refreshControl,
  layout = 'explore',
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
      // In masonry the trending products lead the grid as "Trending now"
      // instead of a rail further down — never both.
      hasTrendingProducts: !masonry && trendingProducts.length > 0,
      hasShopCategories: shopCategories.length > 0,
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

  function renderMasonryBlock(posts: DiscoverPost[]) {
    const imageHeightOf = (post: DiscoverPost) => Math.round(masonryColumnWidth / tileAspectRatio(post));
    const cols = splitMasonryColumns(posts, (post) => imageHeightOf(post) + MASONRY_CAPTION_HEIGHT, MASONRY_ROW_GAP);
    const column = (list: DiscoverPost[]) => (
      <View style={{ width: masonryColumnWidth, gap: MASONRY_ROW_GAP }}>
        {list.map((post) => (
          <DiscoverMasonryTile
            key={post.id}
            post={post}
            width={masonryColumnWidth}
            imageHeight={imageHeightOf(post)}
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

  const listFooter = (loadingMore || ListFooterExtra) ? (
    <>
      {loadingMore ? (
        <View style={styles.footerLoading}>
          <TileRailSkeleton />
        </View>
      ) : null}
      {ListFooterExtra ?? null}
    </>
  ) : null;
  const listEmpty = !loading ? (
    <EmptyState
      icon="activity"
      illustration="trending"
      title="Nothing to show yet"
      description="Posts from buyers and brands will show up here as the community grows."
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
        ListHeaderComponent={ListHeaderComponent}
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
      refreshControl={refreshControl}
      ListHeaderComponent={ListHeaderComponent}
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
  row: { flexDirection: 'row', gap: GAP, marginBottom: GAP },
  footerLoading: { paddingHorizontal: SP.md, paddingVertical: SP.md },
  masonryBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: MASONRY_GUTTER, paddingHorizontal: MASONRY_SIDE, marginBottom: MASONRY_ROW_GAP },
});
