/**
 * Search — Instagram-style entry flow (Mobbin "Instagram iOS Searching
 * Instagram" + "Clearing search history") with TikTok-style results depth:
 * one unified endpoint (api.public.searchAll → GET /api/public/search/all)
 * returns ranked Products, Brands, People and Posts; a "Top" tab shows the
 * best of each, and every type has its own paginated tab.
 *
 * States:
 *   1. Unfocused, empty query   — category chips, recent searches + trending
 *      brands above the Explore browse grid.
 *   2. Focused, empty query     — Cancel appears; trending tags, Recent (kept
 *      on-device — lib/recentSearches — and merged with the signed-in
 *      server history), trending brands, shop-by-category.
 *   3. Typing                   — live suggestion list: the query itself
 *      (search icon) first, then matching brands and people.
 *   4. Submitted                — tabs (Top / Products / Brands / People /
 *      Posts / Tags) + tab content. A category chip filters product results;
 *      a chip with no query browses that category's products.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  useWindowDimensions, ActivityIndicator,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useReportSheet } from '@/components/safety/ReportSheet';
import { useBlockAction } from '@/lib/useBlockAction';
import { useAuth } from '@clerk/expo';
import { type SearchResult } from '@/lib/searchData';
import { useApi, type SearchAllSectionKey } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { AnimatedEntrance, EmptyState } from '@/components/BrandthreadUI';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { FONT, GUTTER, GRID_MAX_WIDTH, RADIUS } from '@/lib/theme';
import { ResponsiveContainer, useGridColumns } from '@/components/layout';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { pickAvatarColor } from '@/lib/avatarColors';
import { ProductTile } from '@/components/search/ProductTile';
import { ShopByCategoryRail } from '@/components/discover/DiscoverShopRails';
import { useDiscoveryShelves } from '@/hooks/useDiscoveryShelves';
import { PersonRow, type SearchPerson } from '@/components/search/PersonRow';
import { BrandRow, type SearchBrandRow } from '@/components/search/BrandRow';
import { TagRow, type SearchTag } from '@/components/search/TagRow';
import { TrendingTags } from '@/components/search/TrendingTags';
import { TrendingBrands } from '@/components/search/TrendingBrands';
import { CategoryChips, SEARCH_CHIPS } from '@/components/search/CategoryChips';
import { hashtagHref, normalizeTag } from '@/lib/hashtagText';
import { RecentSearchRow } from '@/components/search/RecentSearchRow';
import { SegmentedTabs, type SearchTabKey } from '@/components/search/SegmentedTabs';
import { VideoTile } from '@/components/search/VideoTile';
import { FASHION_PREVIEW_POSTS } from '@/app/(tabs)/feed';
import { DiscoverGrid } from '@/components/discover/DiscoverGrid';
import { DiscoverPostViewer } from '@/components/discover/DiscoverPostViewer';
import { DiscoverSafetyMenu } from '@/components/discover/DiscoverSafetyMenu';
import { ShopProductSheet, type ShopSheetSelection } from '@/components/ShopProductSheet';
import { composeDiscoverPosts, discoverPostTargetId, type DiscoverPost } from '@/lib/discoverFeed';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { profileVideosHref } from '@/lib/profileNavigation';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { FilterSheet } from '@/components/search/FilterSheet';
import { countActiveFilters, filtersToApiOptions, type SearchFacets, type SearchFilters } from '@/lib/searchFilters';
import { addRecentSearch, loadRecentSearches, mergeRecent, removeRecentSearch } from '@/lib/recentSearches';
import { appendPage, SECTION_LABELS } from '@/lib/searchResults';

type ProductResult = Extract<SearchResult, { kind: 'product' }>;
type VideoResult = Extract<SearchResult, { kind: 'video' }>;
type BrandItem = SearchBrandRow & { sellerId: string };
type PersonItem = SearchPerson & { id: string };

type TypeList<T> = { items: T[]; hasMore: boolean; nextOffset: number | null; loading: boolean; loaded: boolean };
type TabLists = {
  products: TypeList<ProductResult>;
  brands: TypeList<BrandItem>;
  people: TypeList<PersonItem>;
  posts: TypeList<VideoResult>;
};
type TopSections = { products: ProductResult[]; brands: BrandItem[]; people: PersonItem[]; posts: VideoResult[]; order: SearchAllSectionKey[] };

const emptyList = <T,>(): TypeList<T> => ({ items: [], hasMore: false, nextOffset: null, loading: false, loaded: false });
const emptyTabLists = (): TabLists => ({ products: emptyList(), brands: emptyList(), people: emptyList(), posts: emptyList() });
const EMPTY_TOP: TopSections = { products: [], brands: [], people: [], posts: [], order: [] };

const DEBOUNCE_MS = 150;
const PAGE_SIZE = 20;
/** Start the next page this far (px) before the end of the scroll content. */
const LOAD_MORE_THRESHOLD = 600;

// Filters live for the app session only (module scope): they survive leaving
// and re-opening Search, and reset on a fresh launch. Never written to storage.
let sessionFilters: SearchFilters = {};
const VIDEO_GRID_GAP = 8;

/** Small, clearly-fictional preview accounts so the People tab is demoable
 * under ?bt_preview=buyer with no live backend. Only shown when the real
 * search call fails or returns nothing while in preview mode. */
const PREVIEW_ACCOUNTS: PersonItem[] = [
  { id: 'preview-buyer-1', userId: 'preview-buyer-1', name: 'Casey Rivera', username: 'caseyrivera', handle: '@caseyrivera', initials: 'CR', color: pickAvatarColor('preview-buyer-1'), bio: 'Thrifted fits daily', isFollowing: false, accountType: 'buyer', verified: false, roleTag: 'Buyer' },
  { id: 'preview-buyer-2', userId: 'preview-buyer-2', name: 'Priya Nandan', username: 'priyan', handle: '@priyan', initials: 'PN', color: pickAvatarColor('preview-buyer-2'), bio: null, isFollowing: false, accountType: 'buyer', verified: true, roleTag: 'Buyer' },
];

function mapPreviewPostToVideo(post: (typeof FASHION_PREVIEW_POSTS)[number]): VideoResult {
  return {
    id: post.id,
    kind: 'video',
    postId: post.id,
    caption: post.caption,
    thumbnailUrl: post.videoPosterUri ?? null,
    videoUrl: post.mediaUris[0] ?? '',
    authorId: post.sellerId ?? post.id,
    authorName: post.creator,
    authorHandle: post.handle,
    authorAvatarUrl: null,
    color: post.avatarColor,
    initials: post.initials,
    likesCount: post.likes,
  };
}

const PREVIEW_VIDEOS: VideoResult[] = FASHION_PREVIEW_POSTS.map(mapPreviewPostToVideo);

function mapPreviewPostToProduct(post: (typeof FASHION_PREVIEW_POSTS)[number]): ProductResult | null {
  if (!post.productId || !post.productName) return null;
  const priceCents = post.productTags?.[0]?.priceCents
    ?? (Math.round(parseFloat(String(post.productPrice ?? '0').replace(/[^0-9.]/g, '')) * 100) || 0);
  return {
    id: post.productId,
    kind: 'product',
    productId: post.productId,
    brand: post.creator,
    name: post.productName,
    priceCents,
    color: post.avatarColor,
    initials: post.initials,
    imageUri: post.videoPosterUri ?? null,
  } as ProductResult;
}

// Only entries with an actual product attached (not every fashion-preview
// post tags one) back the "Shop" preview fallback below.
const PREVIEW_PRODUCTS: ProductResult[] = FASHION_PREVIEW_POSTS
  .map(mapPreviewPostToProduct)
  .filter((p): p is ProductResult => p !== null);

/** Case-insensitive substring match against any of several fields. */
function matchesAny(fields: Array<string | null | undefined>, query: string): boolean {
  const q = query.toLowerCase();
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}

/** Bundled preview rows for one type, used only in preview mode when the API has nothing. */
function previewFallback(key: SearchAllSectionKey, query: string): any[] {
  if (!query) return [];
  if (key === 'products') return PREVIEW_PRODUCTS.filter((p) => matchesAny([p.name, p.brand], query));
  if (key === 'posts') return PREVIEW_VIDEOS.filter((v) => matchesAny([v.caption, v.authorName, v.authorHandle], query));
  if (key === 'people') return PREVIEW_ACCOUNTS.filter((p) => matchesAny([p.name, p.handle], query));
  return [];
}

/** #tag extraction from a post result's own caption, filtered to the
 *  active query — see TagRow's own comment on why this is derived
 *  client-side rather than backed by a dedicated hashtag-search endpoint. */
function deriveTags(videos: VideoResult[], query: string): SearchTag[] {
  const counts = new Map<string, number>();
  const q = query.toLowerCase().replace(/^#/, '');
  for (const v of videos) {
    const matches = (v.caption ?? '').match(/#(\w+)/g) ?? [];
    for (const raw of matches) {
      const tag = raw.slice(1);
      if (q && !tag.toLowerCase().includes(q)) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, postCount]) => ({ tag, postCount }))
    .sort((a, b) => b.postCount - a.postCount);
}

export default function BuyerSearchScreen() {
  const router = useRouter();
  const { openReport } = useReportSheet();
  const blockUser = useBlockAction();
  const params = useLocalSearchParams<{ q?: string }>();
  const insets = useSafeAreaInsets();
  const { push } = useThreadPull();
  const shopShelves = useDiscoveryShelves({ categories: true, trending: false });
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const bg = theme.background;
  const fg = theme.text;
  const muted = theme.muted;
  const primary = theme.accent;

  const api = useApi();
  const { isSignedIn, userId } = useAuth();
  const inputRef = useRef<TextInput>(null);
  const previewMode = isBuyerDevPreview();
  const demoMode = previewMode && isPreviewDemoMode();

  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const [activeTab, setActiveTab] = useState<SearchTabKey>('top');
  const [style, setStyle] = useState<string | null>(null);
  const [top, setTop] = useState<TopSections>(EMPTY_TOP);
  const [tabLists, setTabLists] = useState<TabLists>(emptyTabLists);
  const [serverTags, setServerTags] = useState<SearchTag[]>([]);
  // Follow state the viewer changed on this screen, keyed by userId — a
  // person can appear in both the Top and People lists.
  const [followOverrides, setFollowOverrides] = useState<Record<string, boolean>>({});
  const [followPending, setFollowPending] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [filters, setFiltersState] = useState<SearchFilters>(sessionFilters);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const activeFilterCount = countActiveFilters(filters);
  const setFilters = useCallback((next: SearchFilters) => { sessionFilters = next; setFiltersState(next); }, []);
  const trimmedQuery = query.trim();
  // A chip with no query browses that category's products.
  const browsingChip = !trimmedQuery && !!style;
  const showResults = (submitted && trimmedQuery.length > 0) || browsingChip;
  const styleLabel = style ? SEARCH_CHIPS.find((c) => c.key === style)?.label ?? style : null;

  // Browse grid backing the unfocused entry state — the same "For You"
  // Explore composition Discover uses (Instagram's own search tab defaults
  // to its Explore grid too).
  const [browsePosts, setBrowsePosts] = useState<DiscoverPost[]>([]);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [viewer, setViewer] = useState<{ posts: DiscoverPost[]; startIndex: number } | null>(null);
  const [shopSelection, setShopSelection] = useState<ShopSheetSelection | null>(null);
  const [safetyMenuPost, setSafetyMenuPost] = useState<DiscoverPost | null>(null);

  const topPad = useHeaderTopInset();

  // Deliberately no auto-focus on mount — Instagram's own search tab opens
  // unfocused, showing its Explore grid, until the field is explicitly
  // tapped (Mobbin "Instagram iOS Searching Instagram").

  // A term handed in via ?q= (e.g. "See all" -> Recent Searches -> tap a
  // term navigates back here) submits immediately instead of just filling
  // the field.
  useEffect(() => {
    if (params.q) submitTerm(String(params.q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q]);

  useEffect(() => {
    let cancelled = false;
    composeDiscoverPosts({ api, isSignedIn: !!isSignedIn, filter: 'forYou', limit: 30 })
      .then((rows) => { if (!cancelled) setBrowsePosts(rows); })
      .catch(() => { if (!cancelled) setBrowsePosts([]); })
      .finally(() => { if (!cancelled) setBrowseLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recent searches: on-device list first, then the signed-in server history.
  const loadRecent = useCallback(async () => {
    const [local, server] = await Promise.all([
      loadRecentSearches(),
      isSignedIn
        ? api.public.recent(10).then(({ recent }) => recent.map((r) => r.query)).catch(() => [] as string[])
        : Promise.resolve([] as string[]),
    ]);
    setRecentSearches(mergeRecent(local, server));
  }, [api, isSignedIn]);

  useEffect(() => { void loadRecent(); }, [loadRecent]);

  function removeRecent(term: string) {
    hapticSelection();
    setRecentSearches((current) => current.filter((t) => t !== term));
    void removeRecentSearch(term);
    if (isSignedIn) api.public.removeRecent(term).catch(() => {});
  }

  const productFilterOptions = useMemo(() => {
    const o = filtersToApiOptions(filters) as Record<string, unknown>;
    return {
      category: o.category as string[] | undefined, size: o.size as string[] | undefined,
      color: o.color as string[] | undefined, brand: o.brand as string[] | undefined,
      inStock: o.inStock as boolean | undefined, sort: o.sort as string | undefined,
      minPriceCents: o.minPriceCents as number | undefined, maxPriceCents: o.maxPriceCents as number | undefined,
    };
  }, [filters]);

  // Bumped on every new query/chip/filter so a slow page from the previous
  // search can't land in the fresh lists.
  const searchGen = useRef(0);

  // ── Top overview (also feeds the live suggestions while typing) ─────────
  const performSearch = useCallback(async (term: string) => {
    const gen = ++searchGen.current;
    setTabLists(emptyTabLists());
    if (!term) { setTop(EMPTY_TOP); return; } // chip browse: the Products list loads itself
    const [topRes, tagRes, facetRes] = await Promise.allSettled([
      api.public.searchAll({ q: term, type: 'top', style, ...productFilterOptions }),
      previewMode ? Promise.resolve({ tags: [] as SearchTag[] }) : Promise.resolve().then(() => api.hashtags.search(term, 12)),
      // Facets for the filter sheet still come from the product search endpoint.
      Promise.resolve().then(() => api.public.search({ q: term, limit: 1, facets: true })),
    ]);
    if (gen !== searchGen.current) return;
    setServerTags(tagRes.status === 'fulfilled' ? tagRes.value.tags : []);
    if (facetRes.status === 'fulfilled' && facetRes.value?.facets) setFacets(facetRes.value.facets);
    const sections = topRes.status === 'fulfilled' ? topRes.value.sections : {};
    const pick = (key: SearchAllSectionKey) => {
      const rows = (sections[key]?.items ?? []) as any[];
      return rows.length === 0 && previewMode ? previewFallback(key, term) : rows;
    };
    const next: TopSections = {
      products: pick('products'), brands: pick('brands'), people: pick('people'), posts: pick('posts'),
      order: topRes.status === 'fulfilled' ? topRes.value.order : [],
    };
    if (next.order.length === 0) next.order = (['products', 'brands', 'people', 'posts'] as const).filter((k) => next[k].length > 0);
    setTop(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode, style, productFilterOptions]);

  useEffect(() => {
    const q = trimmedQuery;
    if (q.length < 1 && !style) {
      // Drop any search still in flight so its results can't land after the clear.
      searchGen.current += 1;
      setTop(EMPTY_TOP);
      setTabLists(emptyTabLists());
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      await performSearch(q);
      if (!cancelled) setSearching(false);
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, performSearch]);

  // ── Per-type tabs: first page on open, next page near the end of scroll ──
  const loadPage = useCallback(async (key: SearchAllSectionKey, reset: boolean) => {
    const current = tabLists[key];
    if (current.loading || (!reset && (!current.hasMore || current.nextOffset === null))) return;
    const offset = reset ? 0 : current.nextOffset ?? 0;
    const gen = searchGen.current;
    setTabLists((prev) => ({ ...prev, [key]: { ...prev[key], loading: true } }));
    try {
      const res = await api.public.searchAll({
        q: trimmedQuery, type: key, style, limit: PAGE_SIZE, offset,
        ...(key === 'products' ? productFilterOptions : {}),
      });
      if (gen !== searchGen.current) return;
      const page = (res.sections[key]?.items ?? []) as any[];
      const fallback = reset && page.length === 0 && previewMode ? previewFallback(key, trimmedQuery) : null;
      setTabLists((prev) => ({
        ...prev,
        [key]: {
          items: fallback ?? (reset ? page : appendPage(prev[key].items as any[], page)),
          hasMore: fallback ? false : !!res.sections[key]?.hasMore,
          nextOffset: fallback ? null : res.sections[key]?.nextOffset ?? null,
          loading: false,
          loaded: true,
        },
      }));
    } catch {
      if (gen !== searchGen.current) return;
      setTabLists((prev) => ({
        ...prev,
        [key]: reset && previewMode
          ? { items: previewFallback(key, trimmedQuery), hasMore: false, nextOffset: null, loading: false, loaded: true }
          : { ...prev[key], loading: false, loaded: true, hasMore: false },
      }));
    }
  }, [api, tabLists, trimmedQuery, style, productFilterOptions, previewMode]);

  const typeTab: SearchAllSectionKey | null = browsingChip ? 'products'
    : activeTab === 'top' || activeTab === 'tags' ? null : activeTab;

  useEffect(() => {
    if (!showResults || !typeTab || searching) return;
    const list = tabLists[typeTab];
    if (!list.loaded && !list.loading) void loadPage(typeTab, true);
  }, [showResults, typeTab, searching, tabLists, loadPage]);

  function handleScroll({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!showResults || !typeTab) return;
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - LOAD_MORE_THRESHOLD) {
      void loadPage(typeTab, false);
    }
  }

  const withFollow = useCallback((p: PersonItem): PersonItem => (
    p.userId in followOverrides ? { ...p, isFollowing: followOverrides[p.userId] } : p
  ), [followOverrides]);

  // Server-side hashtag search first (real post counts), then tags derived
  // from the matched captions for anything the index does not know yet.
  const tagRows = useMemo(() => {
    const merged = new Map<string, SearchTag>();
    for (const t of serverTags) merged.set(t.tag, t);
    for (const t of deriveTags([...top.posts, ...tabLists.posts.items], trimmedQuery)) {
      const key = normalizeTag(t.tag);
      if (key && !merged.has(key)) merged.set(key, { tag: key, postCount: t.postCount });
    }
    return [...merged.values()];
  }, [serverTags, top.posts, tabLists.posts.items, trimmedQuery]);

  function openHashtag(tag: string) {
    hapticPrimaryAction();
    router.push(hashtagHref(normalizeTag(tag)) as never);
  }

  const gridColumns = useGridColumns({ phone: 2, tablet: 3, tabletLandscape: 4 });
  const { width: winWidth } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const fallbackGridWidth = Math.min(winWidth, GRID_MAX_WIDTH) - GUTTER * 2;
  const effectiveGridWidth = gridWidth > 0 ? gridWidth : fallbackGridWidth;
  const gridCardWidth = Math.max(1, (effectiveGridWidth - GUTTER * (gridColumns - 1)) / gridColumns);
  const videoGridCardWidth = Math.max(1, (effectiveGridWidth - VIDEO_GRID_GAP * (gridColumns - 1)) / gridColumns);
  const onGridLayout = useCallback(({ nativeEvent }: { nativeEvent: { layout: { width: number } } }) => {
    const nextWidth = Math.round(nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== gridWidth) setGridWidth(nextWidth);
  }, [gridWidth]);

  function goToBrand(sellerId?: string) {
    hapticPrimaryAction();
    if (sellerId) router.push({ pathname: '/seller-profile' as any, params: { sellerId, src: 'search' } });
  }

  function goToProduct(productId: string) {
    push({ pathname: '/thread-product-detail' as any, params: { productId, src: 'search' } } as never);
  }

  // A video result's authorId is the post's userId (server: posts.userId) —
  // the same id the creator player loads (/api/public/users/:id/videos) and
  // checks the exact post against, so it opens straight on the tapped video.
  function goToVideo(video: VideoResult) {
    hapticPrimaryAction();
    router.push(profileVideosHref({
      source: 'creator', id: video.authorId, startPostId: video.postId, title: video.authorName, exactPost: true,
    }) as never);
  }

  function handleProductPress(r: ProductResult) {
    hapticPrimaryAction();
    if ((r as any).productId) goToProduct((r as any).productId);
  }

  function handlePersonPress(p: SearchPerson) {
    hapticPrimaryAction();
    if (p.accountType === 'seller') {
      router.push({ pathname: '/seller-profile' as any, params: { sellerId: p.userId, src: 'search' } });
    } else {
      router.push({
        pathname: '/buyer-other-profile' as any,
        params: { userId: p.userId, name: p.name, handle: p.handle, initials: p.initials, color: p.color },
      });
    }
  }

  async function handleToggleFollow(person: SearchPerson) {
    if (followPending[person.userId] || person.userId.startsWith('preview-')) return;
    const wasFollowing = person.isFollowing;
    setFollowPending((prev) => ({ ...prev, [person.userId]: true }));
    try {
      let requested = false;
      if (wasFollowing) await api.social.unfollow(person.userId);
      else requested = (await api.social.follow(person.userId))?.status === 'requested';
      // A private account only received a follow request — not following yet.
      setFollowOverrides((prev) => ({ ...prev, [person.userId]: !wasFollowing && !requested }));
      hapticPrimaryAction();
    } catch {
      // Keep previous state on failure.
    } finally {
      setFollowPending((prev) => {
        const next = { ...prev };
        delete next[person.userId];
        return next;
      });
    }
  }

  function submitTerm(term: string) {
    const trimmed = term.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setActiveTab('top');
    setSubmitted(true);
    setFieldFocused(false);
    inputRef.current?.blur();
    setRecentSearches((current) => mergeRecent([trimmed], current));
    void addRecentSearch(trimmed);
    if (isSignedIn) api.public.log(trimmed).catch(() => {});
  }

  function submit() {
    if (!trimmedQuery) return;
    submitTerm(trimmedQuery);
  }

  function handleChangeText(value: string) {
    setQuery(value);
    setSubmitted(false);
  }

  function handleCancel() {
    hapticSelection();
    setQuery('');
    setStyle(null);
    setSubmitted(false);
    setFieldFocused(false);
    inputRef.current?.blur();
  }

  function handleChipChange(next: string | null) {
    setStyle(next);
    if (next && !trimmedQuery) {
      setFieldFocused(false);
      inputRef.current?.blur();
    }
  }

  function openViewer(post: DiscoverPost, flatIndex: number, allPosts: DiscoverPost[]) {
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

  function removePostFromLists(authorId: string, onlyPostId?: string) {
    const filterFn = (p: DiscoverPost) => (onlyPostId ? p.id !== onlyPostId : p.authorId !== authorId);
    setBrowsePosts((prev) => prev.filter(filterFn));
  }

  const productGrid = (items: ProductResult[]) => (
    <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
      <View style={styles.grid} onLayout={onGridLayout}>
        {items.map((item, index) => (
          <AnimatedEntrance key={item.id} delay={Math.min(index, 6) * 30}>
            <ProductTile item={item} accent={primary} width={gridCardWidth} onPress={() => handleProductPress(item)} />
          </AnimatedEntrance>
        ))}
      </View>
    </ResponsiveContainer>
  );

  const videoGrid = (items: VideoResult[]) => (
    <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
      <View style={styles.videoGrid} onLayout={onGridLayout}>
        {items.map((item, index) => (
          <AnimatedEntrance key={item.id} delay={Math.min(index, 6) * 30}>
            <VideoTile item={item} width={videoGridCardWidth} onPress={() => goToVideo(item)} />
          </AnimatedEntrance>
        ))}
      </View>
    </ResponsiveContainer>
  );

  const personRows = (items: PersonItem[]) => items.map(withFollow).map((p) => (
    <PersonRow key={p.userId} person={p} loading={!!followPending[p.userId]} onPress={() => handlePersonPress(p)} onToggleFollow={() => handleToggleFollow(p)} />
  ));

  const brandRowList = (items: BrandItem[]) => items.map((b) => (
    <BrandRow key={b.id} brand={b} onPress={() => goToBrand(b.sellerId)} />
  ));

  function renderNoResults() {
    if (activeFilterCount > 0 && (activeTab === 'products' || browsingChip)) {
      return (
        <View testID="buyer-search-no-results">
          <EmptyState
            icon="sliders"
            title="No products match these filters"
            description="Try removing a filter to see more."
            action={{ label: 'Clear filters', icon: 'x-circle', onPress: () => setFilters({}) }}
          />
        </View>
      );
    }
    if (browsingChip) {
      return (
        <View testID="buyer-search-no-results">
          <EmptyState
            icon="tag"
            title={`No ${styleLabel} pieces yet`}
            description="Try another category."
            action={{ label: 'Clear category', icon: 'x-circle', onPress: () => setStyle(null) }}
          />
        </View>
      );
    }
    return (
      <View testID="buyer-search-no-results">
        <EmptyState
          icon="search"
          illustration="search"
          title={`No results for "${trimmedQuery}"`}
          description={style ? `Nothing in ${styleLabel} — try clearing the category.` : 'Try a different spelling or a broader term.'}
          action={{ label: 'Clear search', icon: 'x-circle', onPress: handleCancel }}
        />
      </View>
    );
  }

  // ── Live suggestions while typing — the query row (search icon) first,
  //    then matching brands and people. Tapping any row submits directly. ──
  type SuggestionRow = { key: string; icon: keyof typeof Feather.glyphMap; avatar?: { uri: string | null; color: string; initials: string }; title: React.ReactNode; subtitle?: string; onSubmit: () => void };
  const suggestionRows = useMemo<SuggestionRow[]>(() => {
    if (!trimmedQuery) return [];
    const bold = (text: string) => {
      const idx = text.toLowerCase().indexOf(trimmedQuery.toLowerCase());
      if (idx === -1) return text;
      return (
        <>
          {text.slice(0, idx)}
          <Text style={{ fontFamily: FONT.bold }}>{text.slice(idx, idx + trimmedQuery.length)}</Text>
          {text.slice(idx + trimmedQuery.length)}
        </>
      );
    };
    const rows: SuggestionRow[] = [
      { key: 'q', icon: 'search', title: bold(trimmedQuery), onSubmit: () => submitTerm(trimmedQuery) },
    ];
    for (const b of top.brands.slice(0, 3)) {
      rows.push({
        key: `b-${b.id}`, icon: 'shopping-bag',
        title: bold(b.name), subtitle: b.handle,
        onSubmit: () => goToBrand(b.sellerId),
      });
    }
    for (const p of top.people.slice(0, 4)) {
      rows.push({
        key: `u-${p.userId}`, icon: 'user',
        avatar: { uri: p.avatarUrl ?? null, color: p.color, initials: p.initials },
        title: bold(p.name), subtitle: p.handle,
        onSubmit: () => handlePersonPress(p),
      });
    }
    return rows.slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, top.brands, top.people]);

  function renderSuggestions() {
    return (
      <View testID="buyer-search-suggestions">
        {suggestionRows.map((row) => (
          <TouchableOpacity
            key={row.key}
            style={styles.suggestionRow}
            onPress={() => { hapticSelection(); row.onSubmit(); }}
            accessibilityRole="button"
          >
            {row.avatar ? (
              row.avatar.uri ? (
                <CachedImage source={{ uri: row.avatar.uri }} style={styles.suggestionAvatar} />
              ) : (
                <View style={[styles.suggestionAvatar, { backgroundColor: row.avatar.color, alignItems: 'center', justifyContent: 'center' }]}>
                  <Text style={styles.suggestionAvatarText}>{row.avatar.initials}</Text>
                </View>
              )
            ) : (
              <View style={[styles.suggestionAvatar, styles.suggestionIconWrap, { borderColor: theme.border }]}>
                <Feather name={row.icon} size={16} color={muted} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={[TYPE_SCALE.body, { color: fg }]} numberOfLines={1}>{row.title}</Text>
              {row.subtitle ? <Text style={[TYPE_SCALE.caption, { color: muted }]} numberOfLines={1}>{row.subtitle}</Text> : null}
            </View>
          </TouchableOpacity>
        ))}
        {searching && suggestionRows.length <= 1 && <ActivityIndicator style={{ marginTop: SPACING.md }} color={muted} />}
      </View>
    );
  }

  function renderRecentRows(max: number, { showEmpty }: { showEmpty: boolean }) {
    if (recentSearches.length === 0 && !showEmpty) return null;
    return (
      <View testID="buyer-search-recent">
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionLabel, { paddingHorizontal: 0 }]}>RECENT</Text>
          {recentSearches.length > 0 && (
            <TouchableOpacity onPress={() => router.push('/buyer-search-history' as never)} accessibilityRole="button" accessibilityLabel="See all recent searches" hitSlop={12}>
              <Text style={[styles.sectionAction, { color: fg }]}>See all</Text>
            </TouchableOpacity>
          )}
        </View>
        {recentSearches.length === 0 ? (
          <View style={{ paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.sm }}>
            <Text style={[TYPE_SCALE.footnote, { color: muted }]}>No recent searches</Text>
          </View>
        ) : (
          recentSearches.slice(0, max).map((term) => (
            <RecentSearchRow key={term} term={term} onPress={() => submitTerm(term)} onRemove={() => removeRecent(term)} />
          ))
        )}
      </View>
    );
  }

  function renderFocusedEmpty() {
    return (
      <View>
        <TrendingTags onPress={openHashtag} />
        {renderRecentRows(5, { showEmpty: true })}
        <TrendingBrands onPress={goToBrand} />
      </View>
    );
  }

  // Header above the unfocused Explore grid: empty query still surfaces
  // recent searches and trending brands, not just the grid.
  const browseHeader = (
    <View testID="buyer-search-browse-header">
      {renderRecentRows(3, { showEmpty: false })}
      <TrendingBrands onPress={goToBrand} max={4} />
      <Text style={styles.sectionLabel}>EXPLORE</Text>
    </View>
  );

  function renderFilterRow() {
    return (
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={styles.filterButton}
          onPress={() => { hapticSelection(); setFilterSheetOpen(true); }}
          accessibilityRole="button"
          accessibilityLabel={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
          testID="buyer-search-filter-button"
        >
          <Feather name="sliders" size={14} color={fg} />
          <Text style={[TYPE_SCALE.footnote, { color: fg, fontFamily: FONT.medium }]}>Filters</Text>
          {activeFilterCount > 0 && (
            <View style={[styles.filterBadge, { backgroundColor: fg }]} testID="buyer-search-filter-badge">
              <Text style={[styles.filterBadgeText, { color: bg }]}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        {activeFilterCount > 0 && (
          <TouchableOpacity
            onPress={() => { hapticSelection(); setFilters({}); }}
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            hitSlop={12}
            testID="buyer-search-filter-clear"
          >
            <Text style={[TYPE_SCALE.footnote, { color: muted, fontFamily: FONT.semibold }]}>Clear all</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  function renderListFooter(list: TypeList<unknown>) {
    if (list.loading) return <ActivityIndicator style={{ marginVertical: SPACING.lg }} color={muted} testID="buyer-search-loading-more" />;
    if (list.hasMore) {
      return (
        <TouchableOpacity onPress={() => typeTab && loadPage(typeTab, false)} accessibilityRole="button" style={styles.loadMore} testID="buyer-search-load-more">
          <Text style={[TYPE_SCALE.footnote, { color: fg, fontFamily: FONT.semibold }]}>Show more</Text>
        </TouchableOpacity>
      );
    }
    return null;
  }

  function sectionHeader(key: SearchAllSectionKey, hasMore: boolean) {
    return (
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionLabel, { paddingHorizontal: 0 }]}>{SECTION_LABELS[key]}</Text>
        {hasMore && (
          <TouchableOpacity onPress={() => { hapticSelection(); setActiveTab(key); }} accessibilityRole="button" accessibilityLabel={`See all ${key}`} hitSlop={12} testID={`search-see-all-${key}`}>
            <Text style={[styles.sectionAction, { color: fg }]}>See all</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  function renderTopSection(key: SearchAllSectionKey, index: number) {
    const items = top[key];
    if (items.length === 0) return null;
    // Always offer "See all" — the per-type tab pages past the Top slice.
    const body = key === 'products' ? productGrid(items as ProductResult[])
      : key === 'brands' ? brandRowList(items as BrandItem[])
      : key === 'people' ? personRows(items as PersonItem[])
      : videoGrid(items as VideoResult[]);
    return (
      <AnimatedEntrance key={key} delay={index * 40}>
        <View testID={`search-top-${key}`}>
          {sectionHeader(key, true)}
          {body}
        </View>
      </AnimatedEntrance>
    );
  }

  function renderTabContent() {
    if (browsingChip || activeTab === 'products') {
      const list = tabLists.products;
      return (
        <View>
          {browsingChip && <Text style={styles.sectionLabel}>{(styleLabel ?? '').toUpperCase()}</Text>}
          {renderFilterRow()}
          {list.items.length === 0
            ? (list.loaded && !list.loading ? renderNoResults() : <ActivityIndicator style={{ marginTop: SPACING.lg }} color={muted} />)
            : productGrid(list.items)}
          {list.items.length > 0 && renderListFooter(list)}
        </View>
      );
    }
    if (activeTab === 'brands' || activeTab === 'people' || activeTab === 'posts') {
      const list = tabLists[activeTab];
      if (list.items.length === 0) {
        return list.loaded && !list.loading ? renderNoResults() : <ActivityIndicator style={{ marginTop: SPACING.lg }} color={muted} />;
      }
      return (
        <View>
          {activeTab === 'brands' ? brandRowList(list.items as BrandItem[])
            : activeTab === 'people' ? personRows(list.items as PersonItem[])
            : <View style={{ paddingTop: SPACING.sm }}>{videoGrid(list.items as VideoResult[])}</View>}
          {renderListFooter(list)}
        </View>
      );
    }
    if (activeTab === 'tags') {
      if (tagRows.length === 0) {
        return (
          <View testID="buyer-search-tags-empty">
            <EmptyState icon="hash" title="No tags found" description="Try a different search term." />
          </View>
        );
      }
      return <View>{tagRows.map((t) => <TagRow key={t.tag} tag={t} onPress={() => openHashtag(t.tag)} />)}</View>;
    }

    // Top — the best slice of every type, best-matching section first
    // (server `order`), each with "See all" into its own paginated tab.
    if (top.order.length === 0) return searching ? <ActivityIndicator style={{ marginTop: SPACING.lg }} color={muted} /> : renderNoResults();
    return <View>{top.order.map((key, i) => renderTopSection(key, i))}</View>;
  }

  // ── Header: back chevron always visible; the trailing element is either
  //    an add-person icon (idle, unfocused, empty) or a Cancel button
  //    (focused / typing / submitted). ────────────────────────────────────
  const showCancel = fieldFocused || trimmedQuery.length > 0 || submitted || !!style;

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity
          onPress={() => goBackOr(router)}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="buyer-search-back"
        >
          <Feather name="chevron-left" size={26} color={fg} />
        </TouchableOpacity>
        {/* theme-exempt: fixed dark action per spec — see profile.tsx's
            #1f1f1f store-details fill for the same intentional pattern. */}
        <View style={[styles.field, fieldFocused && styles.fieldFocused]}>
          <Feather name="search" size={16} color="#9A9AA0" />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={handleChangeText}
            placeholder="Search"
            placeholderTextColor="#9A9AA0"
            style={[styles.fieldInput, { color: '#FFFFFF' }, WEB_INPUT_RESET]}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={submit}
            onFocus={() => setFieldFocused(true)}
            testID="buyer-search-field"
            maxFontSizeMultiplier={1.3}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => { hapticSelection(); setQuery(''); setSubmitted(false); inputRef.current?.focus(); }}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 2 }}
              testID="buyer-search-clear"
            >
              <Feather name="x-circle" size={16} color="#9A9AA0" />
            </TouchableOpacity>
          )}
        </View>
        {showCancel ? (
          <TouchableOpacity onPress={handleCancel} accessibilityRole="button" testID="buyer-search-cancel" style={styles.headerSideButton}>
            <Text style={[styles.headerSideButtonText, { color: fg }]}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => router.push('/(buyer)/friends' as never)}
            accessibilityRole="button"
            accessibilityLabel="Add friends"
            testID="buyer-search-add-person"
            style={styles.headerSideButton}
          >
            <Feather name="user-plus" size={22} color={fg} />
          </TouchableOpacity>
        )}
      </View>

      <CategoryChips value={style} onChange={handleChipChange} />

      {trimmedQuery.length === 0 && !fieldFocused && !style ? (
        <DiscoverGrid
          posts={browsePosts}
          loading={browseLoading}
          showRails={false}
          ListHeaderComponent={browseHeader}
          onTilePress={(post, idx) => openViewer(post, idx, browsePosts)}
          onTileLongPress={setSafetyMenuPost}
          contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xl }}
        />
      ) : (
        <ScrollView
          nativeID="buyer-search-scroll"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onScroll={handleScroll}
          scrollEventThrottle={200}
        >
          {showResults ? (
            <>
              {!browsingChip && (
                <View style={styles.tabsRow}>
                  <SegmentedTabs active={activeTab} onChange={setActiveTab} />
                </View>
              )}
              <View testID="buyer-search-results-state" accessibilityLabel={browsingChip ? `${styleLabel} products` : `Search results for ${query}`}>
                {renderTabContent()}
              </View>
            </>
          ) : trimmedQuery.length === 0 ? (
            <>
              {renderFocusedEmpty()}
              <ShopByCategoryRail categories={shopShelves.categories} />
            </>
          ) : (
            renderSuggestions()
          )}
          <View style={{ height: insets.bottom + SPACING.xl }} />
        </ScrollView>
      )}

      <FilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        value={filters}
        onApply={setFilters}
        facets={facets}
      />

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
          onClose={() => setSafetyMenuPost(null)}
          onNotInterested={() => { removePostFromLists(safetyMenuPost.authorId, safetyMenuPost.id); setSafetyMenuPost(null); }}
          onMute={() => { removePostFromLists(safetyMenuPost.authorId); setSafetyMenuPost(null); }}
          onReport={() => {
            openReport({
              targetType: 'post',
              targetId: discoverPostTargetId(safetyMenuPost.id),
              label: 'Post',
              ownerId: safetyMenuPost.authorId,
              ownerName: safetyMenuPost.authorName,
            });
            setSafetyMenuPost(null);
          }}
          onBlock={isSignedIn && safetyMenuPost.authorId !== userId && !safetyMenuPost.authorId.startsWith('preview-') ? () => {
            const author = safetyMenuPost;
            setSafetyMenuPost(null);
            // Leave the full-screen viewer: the author's post shouldn't stay up,
            // and the confirm must not open underneath it.
            setViewer(null);
            void blockUser({ userId: author.authorId, name: author.authorName }).then((done) => {
              if (done) removePostFromLists(author.authorId);
            });
          } : undefined}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SCREEN_GUTTER, paddingBottom: SPACING.sm, gap: SPACING.sm,
  },
  field: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    height: 36, borderRadius: RADIUS.sm,
    paddingLeft: SPACING.sm, paddingRight: 10,
    // theme-exempt: fixed dark fill per spec, same pattern as profile.tsx's
    // store-details section — regardless of light/dark theme.
    backgroundColor: '#1f1f1f',
    borderWidth: 0,
  },
  // Focused state stays the same pill as unfocused — no border/box appears.
  // Only a very subtle fill change signals focus (the browser's own default
  // outline is separately suppressed via WEB_INPUT_RESET on the TextInput).
  fieldFocused: { backgroundColor: 'rgba(255,255,255,0.10)' },
  fieldInput: { flex: 1, ...TYPE_SCALE.body, padding: 0 },
  headerSideButton: { minWidth: 24, alignItems: 'flex-end' },
  headerSideButtonText: { ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SCREEN_GUTTER,
  },
  sectionAction: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, paddingTop: SPACING.md, paddingBottom: SPACING.xs - 2 },
  // theme-exempt: fixed 70%-white on this page's fixed-dark chrome, same
  // intentional pattern as the field's #1f1f1f fill and the Follow pill.
  sectionLabel: {
    ...TYPE_SCALE.caption, fontSize: 11, letterSpacing: 1.2, fontFamily: FONT.semibold,
    color: 'rgba(255,255,255,0.7)',
    paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.lg, paddingBottom: 12,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GUTTER },
  videoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: VIDEO_GRID_GAP },
  tabsRow: { paddingTop: SPACING.xs },
  filterRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.sm, paddingBottom: SPACING.xs,
  },
  filterButton: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, height: 34,
    paddingHorizontal: SPACING.md, borderRadius: RADII.pill,
    borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface,
  },
  filterBadge: { minWidth: 18, height: 18, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  filterBadgeText: { fontSize: 11, fontFamily: FONT.bold },
  loadMore: { alignSelf: 'center', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xs + 3,
  },
  suggestionAvatar: { width: 28, height: 28, borderRadius: RADII.avatar },
  suggestionIconWrap: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  suggestionAvatarText: { fontSize: 11, fontFamily: FONT.bold, color: '#FFFFFF' },
});
