/**
 * Discover — where buyers discover PEOPLE and BRANDS.
 *
 * Rebuilt from the previous commerce-only editorial page into an Instagram
 * Explore / TikTok Discover-style grid, per Mobbin references:
 *   - Explore grid, 3 cols + periodic 2x2 feature tile:
 *     https://mobbin.com/screens/09675c3d-91fb-4d71-a2e1-f41fab098867 (Instagram)
 *   - Post detail viewer (like/comment/share/save):
 *     https://mobbin.com/screens/c5be0cd7-9185-48c0-92df-7ff3e4530983 (Instagram)
 *   - Suggested people row with Follow pill:
 *     https://mobbin.com/screens/b0953c8a-b220-4f36-9a33-386cd308b158 (TikTok)
 *   - Filter pill row, right fade, active = white pill / black text:
 *     Pinterest-style category chips, matched against this app's own
 *     SegmentedTabs (components/search/SegmentedTabs.tsx) pattern.
 *   - "Shop the look" pill on a tagged photo post:
 *     https://mobbin.com/screens/3a51c82f-62f5-4ebd-b00a-72066021ee52 (Depop)
 *
 * Home (app/(tabs)/feed.tsx) stays seller videos. Discover is now community
 * + brands: a For You grid mixing buyer posts and brand posts, a Fits filter
 * (buyer posts only), a Brands grid, a People list and a Drops list.
 *
 * Scope note (this is PR A of a two-PR split, per the owner's own request):
 * the For You mix is composed client-side from existing endpoints — public
 * Trending for brand/seller posts, friend activity for buyer posts, no new
 * backend. A dedicated ranking endpoint is PR B. Buyers never tag products
 * (owner correction) — "Shop the look" only appears on posts that carry a
 * seller product tag.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { BrandsYouMightLikeRow } from '@/components/discover/BrandsYouMightLikeRow';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useRouter } from 'expo-router';
import { useReportSheet } from '@/components/safety/ReportSheet';
import { useApi } from '@/hooks/useApi';
import { SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useAuth } from '@clerk/expo';
import { ListSkeleton, ResponsiveContainer } from '@/components/layout';
import { DiscoverSearchHeader } from '@/components/discover/DiscoverSearchHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { useScrollReset } from '@/hooks/useScrollReset';
import { ThemedRefreshControl } from '@/components/ui';
import { hapticLight } from '@/lib/haptics';
import { isPreviewCatalogEnabled, getPreviewCatalog, getPreviewCatalogByDemand } from '@/lib/previewCatalog';
import type { EditorialTileItem } from '@/components/discover/EditorialTile';
import { DiscoverFilterRow, type DiscoverFilterKey } from '@/components/discover/DiscoverFilterRow';
import { DiscoverGrid } from '@/components/discover/DiscoverGrid';
import { RecentlyViewedRow } from '@/components/RecentlyViewedRow';
import { DiscoverPostViewer } from '@/components/discover/DiscoverPostViewer';
import { DiscoverSafetyMenu } from '@/components/discover/DiscoverSafetyMenu';
import { DiscoverBrandCard } from '@/components/discover/DiscoverBrandCard';
import { DiscoverFeaturedRail } from '@/components/discover/DiscoverFeaturedRail';
import { DiscoverPersonCard } from '@/components/discover/DiscoverPersonCard';
import { DiscoverDropRow } from '@/components/discover/DiscoverDropRow';
import { ShopProductSheet, type ShopSheetSelection } from '@/components/ShopProductSheet';
import { useDiscoveryShelves } from '@/hooks/useDiscoveryShelves';
import { getFriendSuggestions, muteUser } from '@/services/socialService';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { BUYER_DISCOVER_GESTURE } from '@/lib/firstRunTips/content';
import {
  composeDiscoverPosts, composeDiscoverBrands, composeDiscoverPeople, composeDiscoverDrops,
  type DiscoverPost, type DiscoverBrandCard as BrandCardData, type DiscoverPersonSuggestion, type DiscoverDrop,
} from '@/lib/discoverFeed';
import { useScreenInteractive } from '@/lib/perf';

interface LiveProduct {
  id: string;
  name: string;
  sellerDisplayName?: string;
  images?: string[] | null;
  cutoutUri?: string | null;
  currentPriceCents?: number | null;
  claimedUnits?: number;
  remainingUnits?: number;
  demandCount?: number | null;
  endsAt?: string | null;
  tags?: string[];
  variants?: Array<{ priceCents?: number }>;
}

function pickImage(cutoutUri?: string | null, images?: string[] | null): string | undefined {
  return cutoutUri ?? (images ?? [])[0] ?? undefined;
}

function mapToEditorialTile(prefix: string, row: LiveProduct, i: number): EditorialTileItem {
  const fallbackPrice = (row.variants ?? [])[0]?.priceCents ?? null;
  const remaining = typeof row.remainingUnits === 'number' ? row.remainingUnits : 0;
  return {
    id: `${prefix}_${row.id ?? i}`,
    productId: row.id,
    brand: row.sellerDisplayName ?? 'Seller',
    name: row.name,
    imageUri: pickImage(row.cutoutUri, row.images),
    initials: (row.name ?? 'P')[0].toUpperCase(),
    priceCents: row.currentPriceCents ?? fallbackPrice,
    isUrgent: remaining > 0 && remaining <= 4,
    endsAt: row.endsAt,
  };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const listRef = useScrollReset<FlatList<any>>(true, false);
  const barInset = useBuyerTabBarInset();
  const router = useRouter();
  const { openReport } = useReportSheet();
  const api = useApi();
  const { theme } = useAppTheme();
  const { isSignedIn } = useAuth();

  const [filter, setFilter] = useState<DiscoverFilterKey>('forYou');
  const [refreshing, setRefreshing] = useState(false);

  // Rails, shared by the For You grid. Errors quietly drop the rail (it
  // simply doesn't get inserted into the grid) rather than blocking the
  // whole screen — the grid's own posts are the primary content.
  const [justDroppedItems, setJustDroppedItems] = useState<EditorialTileItem[]>([]);
  const [, setJustDroppedLoading] = useState(true);

  const [highDemandItems, setHighDemandItems] = useState<EditorialTileItem[]>([]);
  const [, setHighDemandLoading] = useState(true);

  const [people, setPeople] = useState<DiscoverPersonSuggestion[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);

  // For You / Fits grid state (kept separate so switching filters doesn't refetch).
  const [forYouPosts, setForYouPosts] = useState<DiscoverPost[]>([]);
  const [forYouLoading, setForYouLoading] = useState(true);
  useScreenInteractive('discover', !forYouLoading);
  const [forYouLoadingMore, setForYouLoadingMore] = useState(false);
  const forYouLimit = useRef(30);

  const [fitsPosts, setFitsPosts] = useState<DiscoverPost[]>([]);
  const [fitsLoading, setFitsLoading] = useState(true);
  const [fitsLoadingMore, setFitsLoadingMore] = useState(false);
  const fitsLimit = useRef(30);

  const [brands, setBrands] = useState<BrandCardData[]>([]);
  // Top slice of the same real brand data the Brands filter's own grid
  // shows — the For You rail is deliberately not a separate ranking.
  // Real trending ranking (recent orders / follows / saves) leads the rail
  // once any brand has signals; until then the rail keeps this same slice.
  const shelves = useDiscoveryShelves();
  const trendingBrands = useMemo(
    () => (shelves.trendingBrands.length > 0 ? shelves.trendingBrands.slice(0, 8) : brands.slice(0, 8)),
    [brands, shelves.trendingBrands],
  );
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [brandsFetched, setBrandsFetched] = useState(false);

  const [drops, setDrops] = useState<DiscoverDrop[]>([]);
  const [dropsLoading, setDropsLoading] = useState(true);
  const [dropsFetched, setDropsFetched] = useState(false);

  const [viewer, setViewer] = useState<{ posts: DiscoverPost[]; startIndex: number } | null>(null);
  const [shopSelection, setShopSelection] = useState<ShopSheetSelection | null>(null);
  const [safetyMenuPost, setSafetyMenuPost] = useState<DiscoverPost | null>(null);

  const fetchJustDropped = useCallback(async () => {
    setJustDroppedLoading(true);
    try {
      const rows = await api.publicProducts.list({ limit: 8 });
      let safe: LiveProduct[] = Array.isArray(rows) ? rows : [];
      if (safe.length === 0 && isPreviewCatalogEnabled()) safe = getPreviewCatalog();
      setJustDroppedItems(safe.map((row, i) => mapToEditorialTile('jd', row, i)));
    } catch {
      // Rail simply doesn't render — see comment on the state above.
    } finally {
      setJustDroppedLoading(false);
    }
  }, [api]);

  const fetchHighDemand = useCallback(async () => {
    setHighDemandLoading(true);
    try {
      const rows = await api.publicProducts.highDemand(6);
      let safe: LiveProduct[] = Array.isArray(rows) ? rows : [];
      if (safe.length === 0 && isPreviewCatalogEnabled()) safe = getPreviewCatalogByDemand(6);
      setHighDemandItems(safe.map((row, i) => mapToEditorialTile('hd', row, i)));
    } catch {
      // Rail simply doesn't render — see comment on the state above.
    } finally {
      setHighDemandLoading(false);
    }
  }, [api]);

  const fetchPeople = useCallback(async () => {
    setPeopleLoading(true);
    try {
      setPeople(await composeDiscoverPeople({ getFriendSuggestions }));
    } finally {
      setPeopleLoading(false);
    }
  }, []);

  const fetchForYou = useCallback(async (append = false) => {
    if (append) setForYouLoadingMore(true); else setForYouLoading(true);
    try {
      const rows = await composeDiscoverPosts({ api, isSignedIn: !!isSignedIn, filter: 'forYou', limit: forYouLimit.current });
      setForYouPosts(rows);
    } finally {
      if (append) setForYouLoadingMore(false); else setForYouLoading(false);
    }
  }, [api, isSignedIn]);

  const fetchFits = useCallback(async (append = false) => {
    if (append) setFitsLoadingMore(true); else setFitsLoading(true);
    try {
      const rows = await composeDiscoverPosts({ api, isSignedIn: !!isSignedIn, filter: 'fits', limit: fitsLimit.current });
      setFitsPosts(rows);
    } finally {
      if (append) setFitsLoadingMore(false); else setFitsLoading(false);
    }
  }, [api, isSignedIn]);

  const fetchBrands = useCallback(async () => {
    setBrandsLoading(true);
    try {
      setBrands(await composeDiscoverBrands({ api, isSignedIn: !!isSignedIn }));
    } finally {
      setBrandsLoading(false);
      setBrandsFetched(true);
    }
  }, [api, isSignedIn]);

  const fetchDrops = useCallback(async () => {
    setDropsLoading(true);
    try {
      setDrops(await composeDiscoverDrops({ api }));
    } finally {
      setDropsLoading(false);
      setDropsFetched(true);
    }
  }, [api]);

  useEffect(() => {
    fetchJustDropped();
    fetchHighDemand();
    fetchPeople();
    fetchForYou();
    // Same fetch the Brands filter's own grid uses (composeDiscoverBrands) —
    // the "Trending Brands" rail below is just the top slice of that same
    // real data, not a second brand data source.
    fetchBrands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (filter === 'fits' && fitsPosts.length === 0 && fitsLoading) fetchFits();
    if (filter === 'brands' && !brandsFetched) fetchBrands();
    if (filter === 'drops' && !dropsFetched) fetchDrops();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    hapticLight();
    forYouLimit.current = 30;
    fitsLimit.current = 30;
    Promise.all([
      fetchJustDropped(), fetchHighDemand(), fetchPeople(), shelves.reload(),
      filter === 'fits' ? fetchFits() : fetchForYou(),
      filter === 'brands' ? fetchBrands() : Promise.resolve(),
      filter === 'drops' ? fetchDrops() : Promise.resolve(),
    ]).finally(() => setRefreshing(false));
  }, [filter, shelves.reload, fetchJustDropped, fetchHighDemand, fetchPeople, fetchForYou, fetchFits, fetchBrands, fetchDrops]);

  function openViewer(post: DiscoverPost, flatIndex: number, allPosts: DiscoverPost[]) {
    hapticLight();
    setViewer({ posts: allPosts, startIndex: flatIndex });
  }

  function openShopTheLook(post: DiscoverPost) {
    const tags = post.productTags ?? [];
    if (tags.length === 0) return;
    setShopSelection({
      postId: post.id,
      postSellerId: post.authorAccountType === 'seller' ? post.authorId : undefined,
      tags,
      activeTagIndex: 0,
    });
  }

  const shopTheLookPosts = useMemo(
    () => forYouPosts.filter((p) => (p.productTags?.length ?? 0) > 0).slice(0, 12),
    [forYouPosts],
  );

  function removePostFromLists(authorId: string, onlyPostId?: string) {
    const filterFn = (p: DiscoverPost) => (onlyPostId ? p.id !== onlyPostId : p.authorId !== authorId);
    setForYouPosts((prev) => prev.filter(filterFn));
    setFitsPosts((prev) => prev.filter(filterFn));
  }

  const header = (
    <>
      <DiscoverSearchHeader
        title="Discover"
        onSearchPress={() => router.push('/buyer-search' as never)}
        onBellPress={isSignedIn ? () => router.push('/(buyer)/inbox' as never) : undefined}
      />
      <DiscoverFilterRow active={filter} onChange={setFilter} />
      {filter === 'forYou' && <DiscoverFeaturedRail />}
      {filter === 'forYou' && <BrandsYouMightLikeRow />}
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {filter === 'forYou' && (
        <DiscoverGrid
          ref={listRef}
          posts={forYouPosts}
          loading={forYouLoading}
          loadingMore={forYouLoadingMore}
          justDroppedItems={justDroppedItems}
          trendingBrands={trendingBrands}
          trendingProducts={shelves.trendingProducts}
          shopCategories={shelves.categories}
          onSeeAllTrendingProducts={() => router.push('/buyer-trending?type=products' as never)}
          onSeeAllTrendingBrands={shelves.trendingBrands.length > 0 ? () => router.push('/buyer-trending?type=brands' as never) : undefined}
          highDemandItems={highDemandItems}
          shopTheLookPosts={shopTheLookPosts}
          onOpenShopTheLook={openShopTheLook}
          people={people}
          onEndReached={() => {
            if (forYouLoadingMore || forYouLoading || forYouLimit.current >= 120) return;
            forYouLimit.current += 30;
            fetchForYou(true);
          }}
          onTilePress={(post, idx) => openViewer(post, idx, forYouPosts)}
          onTileLongPress={setSafetyMenuPost}
          contentContainerStyle={{ paddingBottom: barInset + SP.md }}
          ListHeaderComponent={header as never}
          ListFooterExtra={<RecentlyViewedRow style={{ paddingHorizontal: SP.md, marginTop: SP.lg }} />}
        />
      )}

      {filter === 'fits' && (
        <DiscoverGrid
          ref={listRef}
          posts={fitsPosts}
          loading={fitsLoading}
          loadingMore={fitsLoadingMore}
          showRails={false}
          people={people}
          onEndReached={() => {
            if (fitsLoadingMore || fitsLoading || fitsLimit.current >= 120) return;
            fitsLimit.current += 30;
            fetchFits(true);
          }}
          onTilePress={(post, idx) => openViewer(post, idx, fitsPosts)}
          onTileLongPress={setSafetyMenuPost}
          contentContainerStyle={{ paddingBottom: barInset + SP.md }}
          ListHeaderComponent={header as never}
        />
      )}

      {filter === 'brands' && (
        <FlatList
          ref={listRef as never}
          data={brands}
          keyExtractor={(b) => b.id}
          numColumns={2}
          columnWrapperStyle={{ gap: SP.sm, paddingHorizontal: SP.md }}
          contentContainerStyle={{ gap: SP.sm, paddingBottom: barInset + SP.md }}
          ListHeaderComponent={header}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={({ item }) => <DiscoverBrandCard brand={item} />}
          ListEmptyComponent={brandsLoading ? (
            <ResponsiveContainer style={{ paddingHorizontal: SP.md, marginTop: SP.md }}>
              <ListSkeleton rows={3} />
            </ResponsiveContainer>
          ) : (
            <View style={{ paddingHorizontal: SP.md, marginTop: SP.md }}>
              <EmptyState icon="shopping-bag" title="No brands yet" description="Brands will show up here as sellers join." />
            </View>
          )}
        />
      )}

      {filter === 'people' && (
        <FlatList
          ref={listRef as never}
          data={people}
          keyExtractor={(p) => p.userId}
          numColumns={2}
          columnWrapperStyle={{ gap: SP.sm, paddingHorizontal: SP.md }}
          contentContainerStyle={{ gap: SP.sm, paddingBottom: barInset + SP.md }}
          ListHeaderComponent={header}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={({ item }) => <DiscoverPersonCard person={item} />}
          ListEmptyComponent={peopleLoading ? (
            <ResponsiveContainer style={{ paddingHorizontal: SP.md, marginTop: SP.md }}>
              <ListSkeleton rows={4} />
            </ResponsiveContainer>
          ) : (
            <View style={{ paddingHorizontal: SP.md, marginTop: SP.md }}>
              <EmptyState icon="users" illustration="friends" title="No suggestions yet" description="Follow a few brands and buyers to get suggestions." />
            </View>
          )}
        />
      )}

      {filter === 'drops' && (
        <FlatList
          ref={listRef as never}
          data={drops}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ paddingTop: SP.md, paddingBottom: barInset + SP.md }}
          ListHeaderComponent={header}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={({ item }) => <DiscoverDropRow drop={item} />}
          ListEmptyComponent={dropsLoading ? (
            <ResponsiveContainer style={{ paddingHorizontal: SP.md }}>
              <ListSkeleton rows={4} />
            </ResponsiveContainer>
          ) : (
            <View style={{ paddingHorizontal: SP.md }}>
              <EmptyState icon="zap" title="No drops yet" description="Upcoming drops from sellers will show up here." />
            </View>
          )}
        />
      )}

      {viewer && (
        <DiscoverPostViewer
          posts={viewer.posts}
          startIndex={viewer.startIndex}
          onClose={() => setViewer(null)}
          onOpenShopTheLook={openShopTheLook}
          onSafetyMenu={setSafetyMenuPost}
        />
      )}

      {shopSelection && (
        <ShopProductSheet
          selection={shopSelection}
          onClose={() => setShopSelection(null)}
          reduceMotion={null}
        />
      )}

      {safetyMenuPost && (
        <DiscoverSafetyMenu
          visible
          authorName={safetyMenuPost.authorName}
          onNotInterested={() => removePostFromLists(safetyMenuPost.authorId, safetyMenuPost.id)}
          onMute={() => {
            muteUser({
              userId: safetyMenuPost.authorId,
              name: safetyMenuPost.authorName,
              handle: safetyMenuPost.authorHandle,
              initials: safetyMenuPost.authorInitials,
              color: safetyMenuPost.authorColor,
            }).catch(() => {});
            removePostFromLists(safetyMenuPost.authorId);
          }}
          onReport={() => {
            openReport({
              targetType: 'post',
              targetId: safetyMenuPost.id,
              label: 'Post',
              ownerId: safetyMenuPost.authorId,
              ownerName: safetyMenuPost.authorName,
            });
          }}
          onClose={() => setSafetyMenuPost(null)}
        />
      )}
      <FirstRunTip
        id="buyer-discover"
        variant="gesture"
        contentReady
        gesture={BUYER_DISCOVER_GESTURE}
      />
    </View>
  );
}

