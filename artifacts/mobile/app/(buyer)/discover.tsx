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
import { Alert, Animated, FlatList, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BrandsYouMightLikeRow, useBrandsYouMightLike } from '@/components/discover/BrandsYouMightLikeRow';
import { useTabBarClearance } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useReportSheet } from '@/components/safety/ReportSheet';
import { useBlockAction } from '@/lib/useBlockAction';
import { useApi } from '@/hooks/useApi';
import { SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useAuth } from '@clerk/expo';
import { ListSkeleton, ResponsiveContainer } from '@/components/layout';
import { DiscoverSearchHeader } from '@/components/discover/DiscoverSearchHeader';
import { DiscoverSearchOverlay, type BarRect } from '@/components/discover/search/DiscoverSearchOverlay';
import { EmptyState } from '@/components/reframe';
import { X_GUTTER, X_SPACE } from '@/constants/reframe';
import { useScrollReset } from '@/hooks/useScrollReset';
import { useThreadRefresh } from '@/components/ui/ThreadRefresh';
import { isPreviewCatalogEnabled, getPreviewCatalog, getPreviewCatalogByDemand } from '@/lib/previewCatalog';
import type { EditorialTileItem } from '@/components/discover/EditorialTile';
import { DiscoverFilterRow, type DiscoverFilterKey } from '@/components/discover/DiscoverFilterRow';
import { DiscoverGrid, GRID_GAP, GRID_GUTTER, gridGeometry } from '@/components/discover/DiscoverGrid';
import { RecentlyViewedRow } from '@/components/RecentlyViewedRow';
import { DiscoverSafetyMenu } from '@/components/discover/DiscoverSafetyMenu';
import { DiscoverBrandCard } from '@/components/discover/DiscoverBrandCard';
import { DiscoverFeaturedRail, useFeaturedBrands } from '@/components/discover/DiscoverFeaturedRail';
import { DiscoverTileSkeleton } from '@/components/discover/DiscoverTileView';
import { DiscoverPersonCard } from '@/components/discover/DiscoverPersonCard';
import { DiscoverDropCalendarItem } from '@/components/discover/DiscoverDropCalendarItem';
import { buildDropCalendarItems } from '@/lib/dropCalendar';
import { RisingBrandsSection } from '@/components/discover/RisingBrands';
import { ShopProductSheet, type ShopSheetSelection } from '@/components/ShopProductSheet';
import { useDiscoveryShelves } from '@/hooks/useDiscoveryShelves';
import { getFriendSuggestions, muteUser } from '@/services/socialService';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { measureTipTargetFrom, useTipTarget } from '@/components/first-run-tips/tipTargets';
import { FirstWeekCard, useFirstWeek } from '@/components/FirstWeekCard';
import { SponsoredAdCard } from '@/components/ads/SponsoredAdCard';
import { useFeedAds } from '@/hooks/useFeedAds';
import { sponsoredAnchors, type SponsoredFeedItem } from '@/lib/feedAds';
import { BUYER_DISCOVER_GESTURE } from '@/lib/firstRunTips/content';
import {
  composeDiscoverBrands, composeDiscoverPeople, composeDiscoverDrops, discoverPostTargetId,
  type DiscoverPost, type DiscoverBrandCard as BrandCardData, type DiscoverPersonSuggestion, type DiscoverDrop,
} from '@/lib/discoverFeed';
import { useScreenInteractive } from '@/lib/perf';
import { DISCOVER_KEYS, loadHighDemand, loadJustDropped } from '@/lib/discoverTabData';
import { useStickyState } from '@/lib/stickyState';
import { useDiscoverFeed } from '@/hooks/useDiscoverFeed';
import { hapticLight } from '@/lib/haptics';
import { prefetchImage } from '@/lib/prefetch';
import { setDiscoverAnchorPost } from '@/lib/discoverPlayerQueue';
import { isPreviewDemoMode } from '@/lib/devPreview';

// First visit with nothing cached: hold the skeleton until the grid AND
// every rail that sits above/inside it have settled (or this cap passes),
// then cross-fade once — instead of skeleton → empty → rails popping in one
// by one and shoving the grid down. Once revealed, never gate again this
// session, even if the screen remounts.
const FIRST_REVEAL_CAP_MS = 2500;
const REVEAL_FADE_MS = 200;
const NATIVE_DRIVER = Platform.OS !== 'web';
let discoverRevealedThisSession = false;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const listRef = useScrollReset<FlatList<any>>(true, false);
  const tabBarClearance = useTabBarClearance();
  const router = useRouter();
  const { openReport } = useReportSheet();
  const blockUser = useBlockAction();
  const api = useApi();
  const { theme } = useAppTheme();
  const { isSignedIn, userId } = useAuth();

  const [filter, setFilter] = useState<DiscoverFilterKey>('forYou');
  // First-run tip target: the scrolling list/grid the swipe-up hint
  // describes. Reads the list's existing ref after layout — no new ref,
  // prop, or layout change on the list itself.
  const discoverTipTarget = useTipTarget('buyer-discover');
  useEffect(() => {
    const t = setTimeout(() => measureTipTargetFrom('buyer-discover', () => listRef.current), 400);
    return () => clearTimeout(t);
  }, [filter, listRef]);
  const [refreshing, setRefreshing] = useState(false);

  // Every list below is sticky (lib/stickyState.ts): a remount — or a first
  // visit after lib/appStartPrefetch.ts warmed it — paints the last-known
  // content on frame one. `loading` is only ever true when there is truly
  // nothing to show; background refetches never flip it back on.
  //
  // Rails, shared by the For You grid. Errors quietly drop the rail (it
  // simply doesn't get inserted into the grid) rather than blocking the
  // whole screen — the grid's own posts are the primary content.
  const [justDroppedItems, setJustDroppedItems, hadJustDropped] = useStickyState<EditorialTileItem[]>(DISCOVER_KEYS.justDropped, [], { persist: true });
  const [justDroppedSettled, setJustDroppedSettled] = useState(hadJustDropped);

  const [highDemandItems, setHighDemandItems, hadHighDemand] = useStickyState<EditorialTileItem[]>(DISCOVER_KEYS.highDemand, [], { persist: true });
  const [highDemandSettled, setHighDemandSettled] = useState(hadHighDemand);

  const [people, setPeople, hadPeople] = useStickyState<DiscoverPersonSuggestion[]>(DISCOVER_KEYS.people, [], { persist: true });
  const [peopleLoading, setPeopleLoading] = useState(!hadPeople);

  // For You / Fits grids (kept separate so switching filters doesn't refetch).
  // Cursor-paged over GET /api/public/discover: pages append, refresh keeps
  // the tiles until new ones arrive, errors keep the tiles + inline retry —
  // see hooks/useDiscoverFeed.ts and lib/discoverPaging.ts.
  const forYou = useDiscoverFeed({ api, isSignedIn: !!isSignedIn, filter: 'forYou', cacheKey: DISCOVER_KEYS.forYou, persist: true });
  const fits = useDiscoverFeed({ api, isSignedIn: !!isSignedIn, filter: 'fits', cacheKey: DISCOVER_KEYS.fits, enabled: filter === 'fits' });
  const forYouPosts = forYou.posts;
  const forYouLoading = forYou.state.loadingFirst;
  const [hadForYou] = useState(() => forYou.state.loadedOnce);
  useScreenInteractive('discover', !forYouLoading);

  const [brands, setBrands, hadBrands] = useStickyState<BrandCardData[]>(DISCOVER_KEYS.brands, [], { persist: true });
  // Top slice of the same real brand data the Brands filter's own grid
  // shows — the For You rail is deliberately not a separate ranking.
  // Real trending ranking (recent orders / follows / saves) leads the rail
  // once any brand has signals; until then the rail keeps this same slice.
  const shelves = useDiscoveryShelves();
  const trendingBrands = useMemo(
    () => (shelves.trendingBrands.length > 0 ? shelves.trendingBrands.slice(0, 8) : brands.slice(0, 8)),
    [brands, shelves.trendingBrands],
  );
  const [brandsLoading, setBrandsLoading] = useState(!hadBrands);

  const [drops, setDrops, hadDrops] = useStickyState<DiscoverDrop[]>(DISCOVER_KEYS.drops, []);
  const [dropsLoading, setDropsLoading] = useState(!hadDrops);
  const dropsFetched = useRef(false);
  const [dropsError, setDropsError] = useState(false);

  // Header rails above the grid — lifted here so the first reveal can wait
  // for them instead of letting each one push the grid down as it lands.
  const featured = useFeaturedBrands();
  const brandsYouMightLike = useBrandsYouMightLike();

  const [shopSelection, setShopSelection] = useState<ShopSheetSelection | null>(null);
  const [safetyMenuPost, setSafetyMenuPost] = useState<DiscoverPost | null>(null);
  // Set when the menu came from long-pressing a grid tile: it then shows as
  // the long-press preview menu, and tapping the preview opens the post.
  const [safetyMenuOpen, setSafetyMenuOpen] = useState<(() => void) | null>(null);

  // In-place search (TikTok-style): tapping the bar opens the search overlay
  // over this screen, starting from the tapped bar's rect — no route push.
  // `/buyer-search?q=` deep links land here as `?search=1&q=`.
  const rootRef = useRef<View>(null);
  const searchBarRef = useRef<View>(null);
  const [search, setSearch] = useState<{ from: BarRect | null; q?: string } | null>(null);
  const searchParams = useLocalSearchParams<{ search?: string; q?: string }>();

  const openSearch = useCallback(() => {
    const bar = searchBarRef.current;
    const root = rootRef.current;
    if (!bar || !root) { setSearch({ from: null }); return; }
    bar.measureInWindow((x, y, width, height) => {
      root.measureInWindow((rx, ry) => {
        setSearch({ from: width > 0 ? { x: x - rx, y: y - ry, width, height } : null });
      });
    });
  }, []);

  useEffect(() => {
    if (searchParams.search !== '1') return;
    const q = typeof searchParams.q === 'string' && searchParams.q.trim() ? searchParams.q.trim() : undefined;
    setSearch({ from: null, q });
    router.setParams({ search: undefined, q: undefined } as never);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams.search, searchParams.q]);
  // Keeps the last post while the safety menu slides closed, so it animates
  // out instead of unmounting the instant the selection clears.
  const lastSafetyMenuPost = useRef<DiscoverPost | null>(null);
  if (safetyMenuPost) lastSafetyMenuPost.current = safetyMenuPost;
  const menuPost = safetyMenuPost ?? lastSafetyMenuPost.current;

  const fetchJustDropped = useCallback(async () => {
    try {
      setJustDroppedItems(await loadJustDropped(api));
    } catch {
      // Rail simply doesn't render — see comment on the state above.
    } finally {
      setJustDroppedSettled(true);
    }
  }, [api, setJustDroppedItems]);

  const fetchHighDemand = useCallback(async () => {
    try {
      setHighDemandItems(await loadHighDemand(api));
    } catch {
      // Rail simply doesn't render — see comment on the state above.
    } finally {
      setHighDemandSettled(true);
    }
  }, [api, setHighDemandItems]);

  const fetchPeople = useCallback(async () => {
    try {
      setPeople(await composeDiscoverPeople({ getFriendSuggestions }));
    } finally {
      setPeopleLoading(false);
    }
  }, [setPeople]);

  const fetchBrands = useCallback(async () => {
    try {
      setBrands(await composeDiscoverBrands({ api, isSignedIn: !!isSignedIn }));
    } finally {
      setBrandsLoading(false);
    }
  }, [api, isSignedIn, setBrands]);

  const fetchDrops = useCallback(async () => {
    dropsFetched.current = true;
    try {
      setDrops(await composeDiscoverDrops({ api }));
      setDropsError(false);
    } catch {
      setDropsError(true);
    } finally {
      setDropsLoading(false);
    }
  }, [api, setDrops]);

  useEffect(() => {
    fetchJustDropped();
    fetchHighDemand();
    fetchPeople();
    // Same fetch the Brands filter's own grid uses (composeDiscoverBrands) —
    // the "Trending Brands" rail below is just the top slice of that same
    // real data, not a second brand data source.
    fetchBrands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (filter === 'drops' && !dropsFetched.current) fetchDrops();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // ── First reveal ──────────────────────────────────────────────────────────
  // Cached content (a remount, or the app-start warmer got here first) is
  // shown immediately with no skeleton at all. Otherwise the skeleton stays
  // up until everything that shapes the For You layout has settled, the
  // first screenful of tile images has been fetched, or the cap passes.
  const [revealed, setRevealed] = useState(() => discoverRevealedThisSession || hadForYou);
  const [revealCapHit, setRevealCapHit] = useState(false);
  const [imagesWarm, setImagesWarm] = useState(false);
  useEffect(() => {
    if (revealed) return;
    const t = setTimeout(() => setRevealCapHit(true), FIRST_REVEAL_CAP_MS);
    return () => clearTimeout(t);
  }, [revealed]);
  useEffect(() => {
    if (revealed || forYouLoading) return;
    let alive = true;
    const uris = forYouPosts.slice(0, 9).map((p) => p.imageUri).filter((u): u is string => !!u);
    if (uris.length === 0) { setImagesWarm(true); return; }
    uris.forEach((u) => prefetchImage(u));
    import('expo-image')
      .then(({ Image }) => Image.prefetch(uris, { cachePolicy: 'memory-disk' }))
      .catch(() => {})
      .finally(() => { if (alive) setImagesWarm(true); });
    return () => { alive = false; };
  }, [revealed, forYouLoading, forYouPosts]);
  const firstLoadSettled = !forYouLoading && justDroppedSettled && highDemandSettled && !peopleLoading
    && !brandsLoading && shelves.settled && featured.settled && brandsYouMightLike.settled && imagesWarm;
  useEffect(() => {
    if (!revealed && (firstLoadSettled || revealCapHit)) {
      discoverRevealedThisSession = true;
      setRevealed(true);
    }
  }, [revealed, firstLoadSettled, revealCapHit]);
  useEffect(() => {
    if (revealed) discoverRevealedThisSession = true;
  }, [revealed]);

  // Skeleton overlay that fades out over the real content (same header,
  // same tile size), so there is never a blank frame between the two.
  const [skeletonMounted, setSkeletonMounted] = useState(!revealed);
  const skeletonOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!revealed || !skeletonMounted) return;
    Animated.timing(skeletonOpacity, { toValue: 0, duration: REVEAL_FADE_MS, useNativeDriver: NATIVE_DRIVER })
      .start(() => setSkeletonMounted(false));
  }, [revealed, skeletonMounted, skeletonOpacity]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    hapticLight();
    // Stale-while-revalidate: every list keeps what it shows until its new
    // data lands; nothing is cleared up front.
    Promise.all([
      fetchJustDropped(), fetchHighDemand(), fetchPeople(), shelves.reload(),
      filter === 'fits' ? fits.refresh() : forYou.refresh(),
      filter === 'brands' ? fetchBrands() : Promise.resolve(),
      filter === 'drops' ? fetchDrops() : Promise.resolve(),
    ]).finally(() => setRefreshing(false));
  }, [filter, shelves.reload, fetchJustDropped, fetchHighDemand, fetchPeople, forYou.refresh, fits.refresh, fetchBrands, fetchDrops]);

  const { refreshControl: threadRefresh, indicator: threadRefreshIndicator } = useThreadRefresh(refreshing, handleRefresh);

  // TikTok-style: a tile opens the real Threads feed on that post, then the
  // feed's own content after it (app/discover-player.tsx?postId=). Pushed on
  // the root stack, so back lands on this tab with its scroll position intact.
  function openViewer(post: DiscoverPost) {
    hapticLight();
    const postId = setDiscoverAnchorPost(post);
    // Demo preview is URL-only (lib/devPreview.ts): carry it over so preview
    // tiles open the preview feed, same as Home shows it.
    const preview = isPreviewDemoMode() ? '&bt_preview=buyer&demo=1' : '';
    router.push(`/discover-player?postId=${encodeURIComponent(postId)}${preview}` as never);
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

  // Sponsored ads in the For You grid: 1 per 6 posts, never first (server-placed).
  const feedAds = useFeedAds({ surface: 'discover', organic: forYouPosts, enabled: filter === 'forYou' && !forYouLoading });
  const forYouSponsored = useMemo(() => sponsoredAnchors(feedAds.items, (p) => p.id), [feedAds.items]);
  const renderSponsored = useCallback((item: SponsoredFeedItem) => (
    <SponsoredAdCard variant="card" ad={item.ad} onViewable={feedAds.confirmImpression} onPress={feedAds.openAd} />
  ), [feedAds.confirmImpression, feedAds.openAd]);

  const shopTheLookPosts = useMemo(
    () => forYouPosts.filter((p) => (p.productTags?.length ?? 0) > 0).slice(0, 12),
    [forYouPosts],
  );

  function removePostFromLists(authorId: string, onlyPostId?: string) {
    const hide = (id: string, author: string) => (onlyPostId ? id === onlyPostId : author === authorId);
    forYou.removeWhere(hide);
    fits.removeWhere(hide);
  }

  const firstWeek = useFirstWeek();
  const header = (
    <>
      <DiscoverSearchHeader
        title="Discover"
        onSearchPress={openSearch}
        searchBarRef={searchBarRef}
        searchBarHidden={!!search}
        beforeSearch={<DiscoverFilterRow active={filter} onChange={setFilter} />}
        onBellPress={isSignedIn ? () => router.push('/(buyer)/inbox' as never) : undefined}
      />
      {filter === 'forYou' && firstWeek.visible && firstWeek.state && (
        <View style={{ paddingHorizontal: SP.md, paddingVertical: SP.sm }}>
          <FirstWeekCard state={firstWeek.state} onDismiss={firstWeek.dismiss} />
        </View>
      )}
      {filter === 'forYou' && <DiscoverFeaturedRail brands={featured.brands} threads={featured.threads} />}
      {filter === 'forYou' && <BrandsYouMightLikeRow state={brandsYouMightLike} />}
    </>
  );

  const skeletonHeader = (
    <>
      <DiscoverSearchHeader
        title="Discover"
        onSearchPress={() => router.push('/buyer-search' as never)}
        beforeSearch={<DiscoverFilterRow active={filter} onChange={setFilter} />}
        onBellPress={isSignedIn ? () => router.push('/(buyer)/inbox' as never) : undefined}
      />
    </>
  );
  // Brands: "Rising this week" sits at the top, above the existing grid
  // (renders nothing when fewer than 3 brands qualify).
  const brandsHeader = (
    <>
      {header}
      <RisingBrandsSection />
    </>
  );

  return (
    <View ref={rootRef} style={{ flex: 1, backgroundColor: theme.background }}>
      {filter === 'forYou' && (
        <DiscoverGrid
          ref={listRef as never}
          layout="masonry"
          posts={forYouPosts}
          loading={forYouLoading && revealed}
          loadingMore={forYou.state.loadingMore}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          showEmpty={forYou.showEmpty}
          error={forYou.state.error}
          onRetry={forYou.retry}
          holdIncompleteRow={!forYou.state.reachedEnd}
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
          sponsored={forYouSponsored}
          renderSponsored={renderSponsored}
          onEndReached={forYou.loadMore}
          onTilePress={(post) => openViewer(post)}
          onTileLongPress={(post) => {
            setSafetyMenuOpen(() => () => openViewer(post));
            setSafetyMenuPost(post);
          }}
          bottomClearance={tabBarClearance}
          ListHeaderComponent={header as never}
          ListFooterExtra={<RecentlyViewedRow style={{ paddingHorizontal: SP.md, marginTop: SP.lg }} />}
          refreshControl={threadRefresh}
        />
      )}

      {filter === 'fits' && (
        <DiscoverGrid
          ref={listRef as never}
          posts={fits.posts}
          loading={fits.state.loadingFirst}
          loadingMore={fits.state.loadingMore}
          refreshing={refreshing}
          onRefresh={handleRefresh}
          showEmpty={fits.showEmpty}
          error={fits.state.error}
          onRetry={fits.retry}
          holdIncompleteRow={!fits.state.reachedEnd}
          showRails={false}
          people={people}
          onEndReached={fits.loadMore}
          onTilePress={(post) => openViewer(post)}
          onTileLongPress={(post) => {
            setSafetyMenuOpen(() => () => openViewer(post));
            setSafetyMenuPost(post);
          }}
          contentContainerStyle={{ paddingBottom: tabBarClearance }}
          ListHeaderComponent={header as never}
          refreshControl={threadRefresh}
        />
      )}

      {filter === 'brands' && (
        <FlatList
          ref={listRef as never}
          data={brands}
          keyExtractor={(b) => b.id}
          numColumns={2}
          columnWrapperStyle={{ gap: X_SPACE[12], paddingHorizontal: X_GUTTER }}
          contentContainerStyle={{ gap: X_SPACE[12], paddingBottom: tabBarClearance }}
          ListHeaderComponent={brandsHeader}
          refreshControl={threadRefresh}
          renderItem={({ item }) => <DiscoverBrandCard brand={item} variant="tile" />}
          ListEmptyComponent={brandsLoading ? (
            <ResponsiveContainer style={{ paddingHorizontal: SP.md, marginTop: SP.md }}>
              <ListSkeleton rows={3} />
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No brands yet" message="Brands will show up here as sellers join." />
          )}
        />
      )}

      {filter === 'people' && (
        <FlatList
          ref={listRef as never}
          data={people}
          keyExtractor={(p) => p.userId}
          numColumns={2}
          columnWrapperStyle={{ gap: X_SPACE[12], paddingHorizontal: X_GUTTER }}
          contentContainerStyle={{ gap: X_SPACE[12], paddingBottom: tabBarClearance }}
          ListHeaderComponent={header}
          refreshControl={threadRefresh}
          renderItem={({ item }) => <DiscoverPersonCard person={item} />}
          ListEmptyComponent={peopleLoading ? (
            <ResponsiveContainer style={{ paddingHorizontal: SP.md, marginTop: SP.md }}>
              <ListSkeleton rows={4} />
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No suggestions yet" message="Follow a few brands and buyers to get suggestions." />
          )}
        />
      )}

      {filter === 'drops' && (
        <FlatList
          ref={listRef as never}
          data={buildDropCalendarItems(drops)}
          keyExtractor={(d) => d.key}
          contentContainerStyle={{ paddingBottom: tabBarClearance }}
          ListHeaderComponent={header}
          refreshControl={threadRefresh}
          renderItem={({ item }) => <DiscoverDropCalendarItem item={item} />}
          ListEmptyComponent={dropsLoading ? (
            <ResponsiveContainer style={{ paddingHorizontal: SP.md }}>
              <ListSkeleton rows={4} />
            </ResponsiveContainer>
          ) : (
            <EmptyState
              title={dropsError ? "Couldn't load drops" : 'No drops yet'}
              message={dropsError ? 'Check your connection and try again.' : 'Upcoming drops from sellers will show up here.'}
              action={dropsError ? { label: 'Try again', onPress: () => { void fetchDrops(); } } : undefined}
            />
          )}
        />
      )}

      {threadRefreshIndicator}
      {skeletonMounted && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: skeletonOpacity, backgroundColor: theme.background }]}
          pointerEvents={revealed ? 'none' : 'auto'}
          testID="discover-first-load-skeleton"
        >
          {skeletonHeader}
          <DiscoverGridSkeleton />
        </Animated.View>
      )}

      {shopSelection && (
        <ShopProductSheet
          selection={shopSelection}
          onClose={() => setShopSelection(null)}
          reduceMotion={null}
        />
      )}

      {menuPost && (
        <DiscoverSafetyMenu
          visible={!!safetyMenuPost}
          authorName={menuPost.authorName}
          postId={menuPost.id}
          preview={safetyMenuOpen ? {
            imageUri: menuPost.imageUri,
            title: menuPost.authorName,
            subtitle: menuPost.authorHandle,
            avatarUri: menuPost.authorAvatarUrl,
            body: menuPost.imageUri ? null : menuPost.caption,
          } : undefined}
          onOpen={safetyMenuOpen ?? undefined}
          onNotInterested={() => removePostFromLists(menuPost.authorId, menuPost.id)}
          onMute={() => {
            const target = menuPost;
            muteUser({
              userId: target.authorId,
              name: target.authorName,
              handle: target.authorHandle,
              initials: target.authorInitials,
              color: target.authorColor,
            })
              .then(() => removePostFromLists(target.authorId))
              .catch(() => Alert.alert("Couldn't mute", 'Try again.'));
          }}
          onReport={() => {
            openReport({
              targetType: 'post',
              targetId: discoverPostTargetId(menuPost.id),
              label: 'Post',
              ownerId: menuPost.authorId,
              ownerName: menuPost.authorName,
            });
          }}
          onClose={() => { setSafetyMenuPost(null); setSafetyMenuOpen(null); }}
          onBlock={isSignedIn && menuPost.authorId !== userId && !menuPost.authorId.startsWith('preview-') ? () => {
            const author = menuPost;
            void blockUser({ userId: author.authorId, name: author.authorName }).then((done) => {
              if (done) removePostFromLists(author.authorId);
            });
          } : undefined}
        />
      )}
      <FirstRunTip
        id="buyer-discover"
        variant="gesture"
        contentReady
        gesture={{ ...BUYER_DISCOVER_GESTURE, target: discoverTipTarget }}
      />
      {search && (
        <DiscoverSearchOverlay
          key={search.q ?? 'search'}
          from={search.from}
          initialQuery={search.q}
          onClosed={() => setSearch(null)}
        />
      )}
    </View>
  );
}


/** Full-screen version of DiscoverGrid's own loading rows — same 3-column,
 *  16pt-gutter, 3pt-gap, 3:4 tiles — so the cross-fade lands on identical geometry. */
function DiscoverGridSkeleton() {
  const { width, height } = useWindowDimensions();
  const { cell, cellHeight } = gridGeometry(width);
  const rows = Math.max(3, Math.ceil(height / cellHeight));
  return (
    <View style={{ overflow: 'hidden', flex: 1, paddingTop: X_SPACE[12] }}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={{ flexDirection: 'row', gap: GRID_GAP, marginBottom: GRID_GAP, paddingHorizontal: GRID_GUTTER }}>
          {[0, 1, 2].map((c) => <DiscoverTileSkeleton key={c} width={cell} height={cellHeight} />)}
        </View>
      ))}
    </View>
  );
}
