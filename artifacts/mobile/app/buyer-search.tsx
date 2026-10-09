/**
 * Search — rebuilt to mirror Instagram's own search flow 1:1 (Mobbin
 * "Instagram iOS Searching Instagram" + "Instagram iOS Clearing search
 * history"; layout/spacing/hierarchy/copy/interactions match those flows,
 * only color/font/icon are Brandthread's). Same data sources as before
 * (api.public.search, api.social.search, lib/discoverFeed's composeDiscoverPosts) —
 * this PR replaces the UI only.
 *
 * States, in the order Instagram's own flow moves through them:
 *   1. Unfocused, empty query   — a browse grid (Explore-style) + search
 *      field + add-person icon.
 *   2. Focused, empty query     — Cancel appears; "Recent" header + "See
 *      all" + recent-search rows (server-side history — see lib/api.ts'
 *      api.public.recent/removeRecent/clearRecent/log).
 *   3. Typing                   — live suggestion list: the query itself
 *      (search icon) first, then matching accounts.
 *   4. Submitted                — tabs (For you / Accounts / Products /
 *      Tags / Brands) + tab content.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useReportSheet } from '@/components/safety/ReportSheet';
import { useAuth } from '@clerk/expo';
import { type SearchResult } from '@/lib/searchData';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { FONT, GUTTER, GRID_MAX_WIDTH, RADIUS } from '@/lib/theme';
import { ResponsiveContainer, useGridColumns } from '@/components/layout';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { pickAvatarColor } from '@/lib/avatarColors';
import { ProductTile } from '@/components/search/ProductTile';
import { ShopByCategoryRail } from '@/components/discover/DiscoverShopRails';
import { useDiscoveryShelves } from '@/hooks/useDiscoveryShelves';
import { PersonRow, type SearchPerson } from '@/components/search/PersonRow';
import { BrandRow, type SearchBrandRow } from '@/components/search/BrandRow';
import { TagRow, type SearchTag } from '@/components/search/TagRow';
import { TrendingTags } from '@/components/search/TrendingTags';
import { hashtagHref, normalizeTag } from '@/lib/hashtagText';
import { RecentSearchRow } from '@/components/search/RecentSearchRow';
import { SegmentedTabs, type SearchTabKey } from '@/components/search/SegmentedTabs';
import { VideoTile } from '@/components/search/VideoTile';
import { FASHION_PREVIEW_POSTS } from '@/app/(tabs)/feed';
import { DiscoverGrid } from '@/components/discover/DiscoverGrid';
import { DiscoverPostViewer } from '@/components/discover/DiscoverPostViewer';
import { DiscoverSafetyMenu } from '@/components/discover/DiscoverSafetyMenu';
import { ShopProductSheet, type ShopSheetSelection } from '@/components/ShopProductSheet';
import { composeDiscoverPosts, type DiscoverPost } from '@/lib/discoverFeed';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { EmptyState as OneLineEmptyState } from '@/components/ui/EmptyState';
import { FilterSheet } from '@/components/search/FilterSheet';
import { countActiveFilters, filtersToApiOptions, type SearchFacets, type SearchFilters } from '@/lib/searchFilters';

type ProductResult = Extract<SearchResult, { kind: 'product' }>;
type BrandResult = Extract<SearchResult, { kind: 'brand' }>;
type VideoResult = Extract<SearchResult, { kind: 'video' }>;

const DEBOUNCE_MS = 150;

// Filters live for the app session only (module scope): they survive leaving
// and re-opening Search, and reset on a fresh launch. Never written to storage.
let sessionFilters: SearchFilters = {};
const VIDEO_GRID_GAP = 8;

/** Small, clearly-fictional preview accounts so the Users tab is demoable
 * under ?bt_preview=buyer with no live backend. Only shown when the real
 * `api.social.search` call fails or returns nothing while in preview mode. */
const PREVIEW_ACCOUNTS: SearchPerson[] = [
  { userId: 'preview-buyer-1', name: 'Casey Rivera', username: 'caseyrivera', handle: '@caseyrivera', initials: 'CR', color: pickAvatarColor('preview-buyer-1'), bio: 'Thrifted fits daily', isFollowing: false, accountType: 'buyer', verified: false, roleTag: 'Buyer' },
  { userId: 'preview-buyer-2', name: 'Priya Nandan', username: 'priyan', handle: '@priyan', initials: 'PN', color: pickAvatarColor('preview-buyer-2'), bio: null, isFollowing: false, accountType: 'buyer', verified: true, roleTag: 'Buyer' },
  { userId: 'preview-seller-1', name: 'Atelier Noire', username: 'ateliernoire', handle: '@ateliernoire', initials: 'AN', color: pickAvatarColor('preview-seller-1'), bio: 'Midnight tailoring', isFollowing: false, accountType: 'seller', verified: true, roleTag: 'Atelier Noire' },
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

/** #tag extraction from a video result's own caption, filtered to the
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
  const { isSignedIn } = useAuth();
  const inputRef = useRef<TextInput>(null);
  const previewMode = isBuyerDevPreview();

  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const [activeTab, setActiveTab] = useState<SearchTabKey>('forYou');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [people, setPeople] = useState<SearchPerson[]>([]);
  const [serverTags, setServerTags] = useState<SearchTag[]>([]);
  const [followPending, setFollowPending] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [filters, setFiltersState] = useState<SearchFilters>(sessionFilters);
  const [facets, setFacets] = useState<SearchFacets | null>(null);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const activeFilterCount = countActiveFilters(filters);
  const setFilters = useCallback((next: SearchFilters) => { sessionFilters = next; setFiltersState(next); }, []);
  const trimmedQuery = query.trim();

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
  // tapped (Mobbin "Instagram iOS Searching Instagram"). The pre-rebuild
  // screen auto-focused; that's part of what this PR replaces.

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

  // Recent searches are per account (a protected endpoint): never asked for
  // signed out, including the web preview.
  const loadRecent = useCallback(() => {
    if (!isSignedIn) { setRecentSearches([]); return; }
    api.public.recent(10)
      .then(({ recent }) => setRecentSearches(recent.map((r) => r.query)))
      .catch(() => setRecentSearches([]));
  }, [api, isSignedIn]);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  // Trending searches (public): real logged queries once there's volume,
  // otherwise the top categories and brands.
  const [trendingSearches, setTrendingSearches] = useState<string[]>([]);
  useEffect(() => {
    if (isBuyerDevPreview() && !isSignedIn) return;
    let cancelled = false;
    api.public.trending(5)
      .then(({ trending }) => { if (!cancelled) setTrendingSearches(trending.map((t) => t.term).filter(Boolean)); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, isSignedIn]);

  function removeRecent(term: string) {
    hapticSelection();
    setRecentSearches((current) => current.filter((t) => t !== term));
    api.public.removeRecent(term).catch(() => {});
  }

  const performSearch = useCallback(async (term: string) => {
    const [productRes, peopleRes, tagRes] = await Promise.allSettled([
      api.public.search({ q: term, limit: 30, facets: true, ...filtersToApiOptions(filters) }),
      api.social.search(term, 20),
      previewMode ? Promise.resolve({ tags: [] as SearchTag[] }) : Promise.resolve().then(() => api.hashtags.search(term, 12)),
    ]);
    setServerTags(tagRes.status === 'fulfilled' ? tagRes.value.tags : []);
    setResults(productRes.status === 'fulfilled' ? productRes.value.results ?? [] : []);
    if (productRes.status === 'fulfilled' && productRes.value.facets) setFacets(productRes.value.facets);
    else if (productRes.status !== 'fulfilled') setFacets(null);
    let peopleResult = peopleRes.status === 'fulfilled' ? (peopleRes.value as unknown as SearchPerson[]) : [];
    if (peopleResult.length === 0 && previewMode) {
      const q = term.toLowerCase();
      peopleResult = PREVIEW_ACCOUNTS.filter((p) => p.name.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q));
    }
    setPeople(peopleResult);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewMode, filters]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setResults([]);
      setPeople([]);
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
  }, [query, performSearch]);

  const productResultsRaw = useMemo(() => results.filter((r): r is ProductResult => r.kind === 'product'), [results]);
  const brandResultsRaw = useMemo(() => results.filter((r): r is BrandResult => r.kind === 'brand'), [results]);
  const videoResultsRaw = useMemo(() => results.filter((r): r is VideoResult => r.kind === 'video'), [results]);
  // Blend in bundled preview posts/products when the live API has nothing
  // for this query — matched against name/author/brand, not just caption.
  const videoResults = videoResultsRaw.length > 0 ? videoResultsRaw
    : (trimmedQuery.length > 0 ? PREVIEW_VIDEOS.filter((v) => matchesAny([v.caption, v.authorName, v.authorHandle], trimmedQuery)) : []);
  const productResults = productResultsRaw.length > 0 ? productResultsRaw
    : (trimmedQuery.length > 0 && activeFilterCount === 0 ? PREVIEW_PRODUCTS.filter((p) => matchesAny([p.name, p.brand], trimmedQuery)) : []);
  const brandRows: SearchBrandRow[] = brandResultsRaw.map((b) => ({ id: b.id, name: b.name, handle: (b as any).handle ?? '', color: b.color, initials: b.initials }));
  // Server-side hashtag search first (real post counts), then tags derived
  // from the matched captions for anything the index does not know yet.
  const tagRows = useMemo(() => {
    const merged = new Map<string, SearchTag>();
    for (const t of serverTags) merged.set(t.tag, t);
    for (const t of deriveTags(videoResults, trimmedQuery)) {
      const key = normalizeTag(t.tag);
      if (key && !merged.has(key)) merged.set(key, { tag: key, postCount: t.postCount });
    }
    return [...merged.values()];
  }, [serverTags, videoResults, trimmedQuery]);

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

  function goToVideo(video: VideoResult) {
    hapticPrimaryAction();
    router.push({ pathname: '/buyer-other-profile' as any, params: { userId: video.authorId, postId: video.postId } });
  }

  function handleResultPress(r: ProductResult | BrandResult) {
    hapticPrimaryAction();
    if (r.kind === 'brand' && (r as any).sellerId) {
      goToBrand((r as any).sellerId);
    } else if (r.kind === 'product' && (r as any).productId) {
      goToProduct((r as any).productId);
    }
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
    const setFollowing = (value: boolean) =>
      setPeople((prev) => prev.map((p) => (p.userId === person.userId ? { ...p, isFollowing: value } : p)));
    setFollowPending((prev) => ({ ...prev, [person.userId]: true }));
    // Optimistic, like every other Follow button: flip now, roll back on failure.
    setFollowing(!wasFollowing);
    hapticPrimaryAction();
    try {
      let requested = false;
      if (wasFollowing) await api.social.unfollow(person.userId);
      else requested = (await api.social.follow(person.userId))?.status === 'requested';
      // A private account only received a follow request — not following yet.
      if (requested) setFollowing(false);
    } catch {
      setFollowing(wasFollowing);
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
    setActiveTab('forYou');
    setSubmitted(true);
    setFieldFocused(false);
    inputRef.current?.blur();
    api.public.log(trimmed).catch(() => {});
    loadRecent();
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
    setSubmitted(false);
    setFieldFocused(false);
    inputRef.current?.blur();
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
          <View key={item.id}>
            <ProductTile item={item} accent={primary} width={gridCardWidth} onPress={() => handleResultPress(item)} />
          </View>
        ))}
      </View>
    </ResponsiveContainer>
  );

  const videoGrid = (items: VideoResult[]) => (
    <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
      <View style={styles.videoGrid} onLayout={onGridLayout}>
        {items.map((item, index) => (
          <View key={item.id}>
            <VideoTile item={item} width={videoGridCardWidth} onPress={() => goToVideo(item)} />
          </View>
        ))}
      </View>
    </ResponsiveContainer>
  );

  const personRows = (items: SearchPerson[]) => items.map((p) => (
    <PersonRow key={p.userId} person={p} loading={!!followPending[p.userId]} onPress={() => handlePersonPress(p)} onToggleFollow={() => handleToggleFollow(p)} />
  ));

  const brandRowList = (items: SearchBrandRow[]) => items.map((b) => (
    <BrandRow key={b.id} brand={b} onPress={() => goToBrand((brandResultsRaw.find((r) => r.id === b.id) as any)?.sellerId)} />
  ));

  function renderNoResults() {
    // One line + one action (BRANDTHREAD_DESIGN.md "Copy").
    if (activeFilterCount > 0 && activeTab === 'products') {
      return (
        <View testID="buyer-search-no-results">
          <OneLineEmptyState title="No products match these filters." action={{ label: 'Clear filters', onPress: () => setFilters({}) }} />
        </View>
      );
    }
    return (
      <View testID="buyer-search-no-results">
        <OneLineEmptyState title={`No results for "${trimmedQuery}".`} action={{ label: 'Clear search', onPress: handleCancel }} />
      </View>
    );
  }

  // ── Live suggestions while typing — query row (search icon) first, then
  //    matching accounts, per the Mobbin reference exactly. Tapping any row
  //    submits directly (no separate "fill" affordance — Instagram doesn't
  //    have one either). ──────────────────────────────────────────────────
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
    for (const p of people.slice(0, 5)) {
      rows.push({
        key: `u-${p.userId}`, icon: 'user',
        avatar: { uri: p.avatarUrl ?? null, color: p.color, initials: p.initials },
        title: bold(p.name), subtitle: p.handle,
        onSubmit: () => handlePersonPress(p),
      });
    }
    return rows.slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, people]);

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

  function renderRecent() {
    return (
      <View testID="buyer-search-recent">
        <TrendingTags onPress={openHashtag} />
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionLabel, { paddingHorizontal: 0 }]}>Recent</Text>
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
          recentSearches.slice(0, 5).map((term) => (
            <RecentSearchRow key={term} term={term} onPress={() => submitTerm(term)} onRemove={() => removeRecent(term)} />
          ))
        )}
        {trendingSearches.length > 0 && (
          <View testID="buyer-search-trending">
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, { paddingHorizontal: 0 }]}>Trending searches</Text>
            </View>
            {trendingSearches.map((term) => (
              <RecentSearchRow key={`trending-${term}`} term={term} icon="trending-up" onPress={() => submitTerm(term)} />
            ))}
          </View>
        )}
      </View>
    );
  }

  function renderTabContent() {
    if (activeTab === 'accounts') {
      if (people.length === 0 && brandRows.length === 0) return renderNoResults();
      return <View>{personRows(people)}{brandRowList(brandRows)}</View>;
    }
    if (activeTab === 'products') {
      return (
        <View>
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
          {productResults.length === 0 ? renderNoResults() : productGrid(productResults)}
        </View>
      );
    }
    if (activeTab === 'tags') {
      if (tagRows.length === 0) {
        return (
          <View testID="buyer-search-tags-empty">
            <OneLineEmptyState title="No tags found." />
          </View>
        );
      }
      return <View>{tagRows.map((t) => <TagRow key={t.tag} tag={t} onPress={() => openHashtag(t.tag)} />)}</View>;
    }
    if (activeTab === 'brands') {
      if (brandRows.length === 0) return renderNoResults();
      return <View>{brandRowList(brandRows)}</View>;
    }

    // For you — an Accounts section (up to 5 rows) then a posts grid, per
    // the Mobbin reference. "View counts" don't exist in our data model
    // (the real video-search endpoint returns likesCount, not a view
    // count) — the grid honestly shows likes instead of a fabricated
    // view-count overlay.
    const totalCount = productResults.length + people.length + videoResults.length;
    if (totalCount === 0) return renderNoResults();
    const topPeople = people.slice(0, 5);
    return (
      <View>
        {topPeople.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>People</Text>
            {personRows(topPeople)}
          </View>
        )}
        {videoResults.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>Posts</Text>
            {videoGrid(videoResults)}
          </View>
        )}
      </View>
    );
  }

  // ── Header: back chevron always visible; the trailing element is either
  //    an add-person icon (idle, unfocused, empty) or a Cancel button
  //    (focused / typing / submitted) — matching the Mobbin reference's own
  //    Cancel-on-focus behavior. ────────────────────────────────────────
  const showCancel = fieldFocused || trimmedQuery.length > 0 || submitted;

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

      {trimmedQuery.length === 0 && !fieldFocused ? (
        <DiscoverGrid
          posts={browsePosts}
          loading={browseLoading}
          showRails={false}
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
        >
          {trimmedQuery.length === 0 ? (
            <>
              {renderRecent()}
              <ShopByCategoryRail categories={shopShelves.categories} />
            </>
          ) : !submitted ? (
            renderSuggestions()
          ) : (
            <>
              <View style={styles.tabsRow}>
                <SegmentedTabs active={activeTab} onChange={setActiveTab} />
              </View>
              <View testID="buyer-search-results-state" accessibilityLabel={`Search results for ${query}`}>
                {renderTabContent()}
              </View>
            </>
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
              targetId: safetyMenuPost.id,
              label: 'Post',
              ownerId: safetyMenuPost.authorId,
              ownerName: safetyMenuPost.authorName,
            });
            setSafetyMenuPost(null);
          }}
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
    backgroundColor: '#1C1C1E',
    borderWidth: 0,
  },
  // Focused state stays the same pill as unfocused — no border/box appears.
  // Only a very subtle fill change signals focus (the browser's own default
  // outline is separately suppressed via WEB_INPUT_RESET on the TextInput).
  fieldFocused: { backgroundColor: '#1C1C1E' },
  fieldInput: { flex: 1, minWidth: 0, ...TYPE_SCALE.body, padding: 0 },
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
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xs + 3,
  },
  suggestionAvatar: { width: 28, height: 28, borderRadius: RADII.avatar },
  suggestionIconWrap: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  suggestionAvatarText: { fontSize: 11, fontFamily: FONT.bold, color: '#FFFFFF' },
});
