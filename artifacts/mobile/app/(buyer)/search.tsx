import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, useWindowDimensions, Animated as RNAnimated, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { type SearchResult, type TrendingTerm, type SuggestedBrand, type SuggestedProduct, type SearchCategory } from '@/lib/searchData';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { AnimatedEntrance, EmptyState } from '@/components/BrandthreadUI';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useBuyerSearch } from '@/contexts/BuyerSearchContext';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { FONT, GUTTER, GRID_MAX_WIDTH } from '@/lib/theme';
import { GridSkeleton, ResponsiveContainer, useGridColumns } from '@/components/layout';
import { Chip, ListRow, SkeletonBlock, ThemedRefreshControl } from '@/components/ui';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { PRESS_DURATION_MS, PRESS_SCALE } from '@/constants/motion';
import { hapticPrimaryAction, hapticSelection, hapticToggle } from '@/lib/haptics';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { ProductTile } from '@/components/search/ProductTile';
import { PersonRow, type SearchPerson } from '@/components/search/PersonRow';
import { SegmentedTabs, type SearchTabKey } from '@/components/search/SegmentedTabs';
import { VideoTile } from '@/components/search/VideoTile';
import { CategoryTile } from '@/components/search/CategoryTile';
import { BrandCard } from '@/components/search/BrandCard';
import { FilterSheet, countActiveFilters, type SearchFilters } from '@/components/search/FilterSheet';

type PersonResult = SearchPerson;
type ProductResult = Extract<SearchResult, { kind: 'product' }>;
type BrandResult = Extract<SearchResult, { kind: 'brand' }>;
type VideoResult = Extract<SearchResult, { kind: 'video' }>;

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Deep links may still pass ?q=; the tab bar's inline field owns the text.
  const { q: linkQuery } = useLocalSearchParams<{ q?: string }>();
  const { push } = useThreadPull();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const bg      = theme.background;
  const fg      = theme.text;
  const muted   = theme.muted;
  const primary = theme.accent;

  const api    = useApi();
  const { userId } = useAuth();
  const {
    query, setQuery, submitRequest, keyboardHeight,
    filtersRequest, activeFilterCount, setActiveFilterCount,
  } = useBuyerSearch();
  const barInset = useBuyerTabBarInset();

  const [activeTab, setActiveTab] = useState<SearchTabKey>('top');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [people,  setPeople]  = useState<PersonResult[]>([]);
  const [followPending, setFollowPending] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [trending, setTrending] = useState<TrendingTerm[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [suggestedBrands, setSuggestedBrands] = useState<SuggestedBrand[]>([]);
  const [suggestedProducts, setSuggestedProducts] = useState<SuggestedProduct[]>([]);
  const [suggestedLoading, setSuggestedLoading] = useState(true);
  const [categories, setCategories] = useState<SearchCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const topPad = Platform.OS === 'web' ? 24 : insets.top;
  const recentKey = `bt:buyer-search-recent:${userId ?? 'anon'}`;
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (typeof linkQuery === 'string' && linkQuery.length > 0) setQuery(linkQuery);
  }, [linkQuery, setQuery]);

  const handledSubmitRequest = useRef(submitRequest);
  useEffect(() => {
    if (submitRequest === handledSubmitRequest.current) return;
    handledSubmitRequest.current = submitRequest;
    rememberSearch(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitRequest]);

  // Reinstate the tab bar's filter button: it bumps `filtersRequest` on tap —
  // open the filter sheet in response, and keep `activeFilterCount` (the
  // badge on that same button) in sync with our own filter state.
  const handledFiltersRequest = useRef(filtersRequest);
  useEffect(() => {
    if (filtersRequest === handledFiltersRequest.current) return;
    handledFiltersRequest.current = filtersRequest;
    setFilterSheetVisible(true);
  }, [filtersRequest]);

  useEffect(() => {
    setActiveFilterCount(countActiveFilters(filters));
  }, [filters, setActiveFilterCount]);

  // Results scroll clear of the floating bar, and of the keyboard while the
  // bar rides above it.
  const bottomSpacerStyle = useAnimatedStyle(() => ({
    height: barInset + keyboardHeight.value + 16,
  }));
  const productResults = useMemo(() => results.filter((result): result is ProductResult => result.kind === 'product'), [results]);
  const brandResults   = useMemo(() => results.filter((result): result is BrandResult => result.kind === 'brand'), [results]);
  const videoResults   = useMemo(() => results.filter((result): result is VideoResult => result.kind === 'video'), [results]);

  // "Showing N results" — the settled-count line search results grids
  // (Zalando, Thrive Market) show above the tabs/filter row, so a query
  // reads as answered the moment it lands, before scanning any tiles.
  const resultsCountLabel = useMemo(() => {
    const count = activeTab === 'people' ? people.length
      : activeTab === 'brands' ? brandResults.length
      : activeTab === 'products' ? productResults.length
      : activeTab === 'videos' ? videoResults.length
      : results.length + people.length;
    return `${count.toLocaleString()} result${count === 1 ? '' : 's'}`;
  }, [activeTab, people.length, brandResults.length, productResults.length, videoResults.length, results.length]);

  // Fixed-column product grid (2 on phone, 3-4 on iPad) with an even gutter —
  // measured from the grid's own laid-out width so it also works inside the
  // centered ResponsiveContainer column on iPad. Reused for the video and
  // category grids, which reflow the same way on wide viewports.
  const gridColumns = useGridColumns({ phone: 2, tablet: 3, tabletLandscape: 4 });
  const { width: winWidth } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const fallbackGridWidth = Math.min(winWidth, GRID_MAX_WIDTH) - GUTTER * 2;
  const effectiveGridWidth = gridWidth > 0 ? gridWidth : fallbackGridWidth;
  const gridCardWidth = Math.max(1, (effectiveGridWidth - GUTTER * (gridColumns - 1)) / gridColumns);
  const onGridLayout = useCallback(({ nativeEvent }: { nativeEvent: { layout: { width: number } } }) => {
    const nextWidth = Math.round(nativeEvent.layout.width);
    if (nextWidth > 0 && nextWidth !== gridWidth) setGridWidth(nextWidth);
  }, [gridWidth]);

  // ── Recent searches ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(recentKey)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentSearches(parsed.filter((item): item is string => typeof item === 'string').slice(0, 5));
        }
      })
      .catch(() => {
        if (!cancelled) setRecentSearches([]);
      });
    return () => { cancelled = true; };
  }, [recentKey]);

  function rememberSearch(value: string) {
    const term = value.trim();
    if (!term) return;
    setRecentSearches((current) => {
      const next = [term, ...current.filter((item) => item.toLowerCase() !== term.toLowerCase())].slice(0, 5);
      AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function clearRecentSearches() {
    hapticSelection();
    setRecentSearches([]);
    AsyncStorage.removeItem(recentKey).catch(() => {});
  }

  function removeRecentSearch(term: string) {
    hapticSelection();
    setRecentSearches((current) => {
      const next = current.filter((item) => item.toLowerCase() !== term.toLowerCase());
      AsyncStorage.setItem(recentKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  // ── Empty-state trending + suggested content — loaded once, also used as ──
  // a "try one of these instead" fallback under a no-results state.
  useEffect(() => {
    let cancelled = false;
    setTrendingLoading(true);
    api.public.trending(8)
      .then((res) => { if (!cancelled) setTrending(res?.trending ?? []); })
      .catch(() => { if (!cancelled) setTrending([]); })
      .finally(() => { if (!cancelled) setTrendingLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setSuggestedLoading(true);
    api.public.suggested(8)
      .then((res) => {
        if (cancelled) return;
        setSuggestedBrands(res?.brands ?? []);
        setSuggestedProducts(res?.products ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestedBrands([]);
        setSuggestedProducts([]);
      })
      .finally(() => { if (!cancelled) setSuggestedLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCategoriesLoading(true);
    api.public.categories(8)
      .then((res) => { if (!cancelled) setCategories(res?.categories ?? []); })
      .catch(() => { if (!cancelled) setCategories([]); })
      .finally(() => { if (!cancelled) setCategoriesLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Debounced instant search ─────────────────────────────────────────────
  // Filters live in a ref so a filter change re-runs the in-flight query
  // without retriggering the debounce timer that guards every keystroke.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const performSearch = useCallback(async (term: string) => {
    const f = filtersRef.current;
    const [productRes, peopleRes] = await Promise.allSettled([
      api.public.search({
        q: term, limit: 30,
        sort: f.sort, category: f.category, size: f.size, brand: f.brand,
        minPriceCents: f.minPriceCents, maxPriceCents: f.maxPriceCents,
      }),
      api.social.search(term, 10),
    ]);
    setResults(productRes.status === 'fulfilled' ? productRes.value.results ?? [] : []);
    setPeople(peopleRes.status === 'fulfilled' ? (peopleRes.value as PersonResult[]) : []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, performSearch]);

  // Filters change while a query is already active — re-run immediately
  // rather than waiting for another keystroke.
  const isFirstFiltersRender = useRef(true);
  useEffect(() => {
    if (isFirstFiltersRender.current) { isFirstFiltersRender.current = false; return; }
    const q = query.trim();
    if (q.length < 1) return;
    let cancelled = false;
    setSearching(true);
    performSearch(q).finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    const q = query.trim();
    setRefreshing(true);
    hapticPrimaryAction();
    const tasks: Promise<unknown>[] = [];
    if (q.length >= 1) tasks.push(performSearch(q));
    tasks.push(
      api.public.trending(8).then((res) => setTrending(res?.trending ?? [])).catch(() => {}),
      api.public.suggested(8).then((res) => {
        setSuggestedBrands(res?.brands ?? []);
        setSuggestedProducts(res?.products ?? []);
      }).catch(() => {}),
      api.public.categories(8).then((res) => setCategories(res?.categories ?? [])).catch(() => {}),
    );
    Promise.allSettled(tasks).finally(() => setRefreshing(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, performSearch]);

  function goToBrand(sellerId?: string) {
    hapticPrimaryAction();
    if (sellerId) {
      router.push({ pathname: '/seller-profile' as any, params: { sellerId } });
    } else {
      router.navigate('/(buyer)/discover' as never);
    }
  }

  function goToProduct(productId: string) {
    push({ pathname: '/thread-product-detail' as any, params: { productId } } as never);
  }

  function goToVideo(video: VideoResult) {
    hapticPrimaryAction();
    rememberSearch(query || video.caption || video.authorName);
    // Opens the author's profile with their post — no dedicated single-video
    // route exists on the buyer side today, so this lands where "Worn in
    // these videos" (product-detail) already sends people for a tagged clip.
    router.push({ pathname: '/buyer-other-profile' as any, params: { userId: video.authorId, postId: video.postId } });
  }

  function handleResultPress(r: ProductResult | BrandResult) {
    hapticPrimaryAction();
    rememberSearch(query || r.name);
    if (r.kind === 'brand' && (r as any).sellerId) {
      goToBrand((r as any).sellerId);
    } else if (r.kind === 'product' && (r as any).productId) {
      goToProduct((r as any).productId);
    } else {
      goToBrand();
    }
  }

  function handlePersonPress(p: PersonResult) {
    rememberSearch(query || p.name);
    hapticPrimaryAction();
    router.push({
      pathname: '/buyer-other-profile' as any,
      params: { userId: p.userId, name: p.name, handle: p.handle, initials: p.initials, color: p.color },
    });
  }

  async function handleToggleFollow(person: PersonResult) {
    if (followPending[person.userId]) return;
    const wasFollowing = person.isFollowing;
    setFollowPending((prev) => ({ ...prev, [person.userId]: true }));
    try {
      if (wasFollowing) {
        await api.social.unfollow(person.userId);
      } else {
        await api.social.follow(person.userId);
      }
      setPeople((prev) => prev.map((p) => (p.userId === person.userId ? { ...p, isFollowing: !wasFollowing } : p)));
      hapticPrimaryAction();
    } catch {
      // Keep the previous state on failure — no destructive optimistic flip.
    } finally {
      setFollowPending((prev) => {
        const next = { ...prev };
        delete next[person.userId];
        return next;
      });
    }
  }

  function submitTerm(term: string) {
    rememberSearch(term);
    setQuery(term);
  }

  function submitCategory(category: string) {
    hapticSelection();
    setFilters((prev) => ({ ...prev, category }));
    submitTerm(category);
  }

  const productGrid = (items: ProductResult[]) => (
    <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
      <View style={styles.grid} onLayout={onGridLayout}>
        {items.map((item, index) => (
          <AnimatedEntrance key={item.id} delay={Math.min(index, 6) * 30}>
            <ProductTile
              item={item}
              accent={primary}
              width={gridCardWidth}
              onPress={() => handleResultPress(item)}
            />
          </AnimatedEntrance>
        ))}
      </View>
    </ResponsiveContainer>
  );

  const videoGrid = (items: VideoResult[]) => (
    <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
      <View style={styles.grid} onLayout={onGridLayout}>
        {items.map((item, index) => (
          <AnimatedEntrance key={item.id} delay={Math.min(index, 6) * 30}>
            <VideoTile item={item} width={gridCardWidth} onPress={() => goToVideo(item)} />
          </AnimatedEntrance>
        ))}
      </View>
    </ResponsiveContainer>
  );

  const brandRows = (items: BrandResult[]) => items.map((r) => (
    <PressRow key={r.id} onPress={() => handleResultPress(r)} accessibilityLabel={`Open ${r.name}`}>
      <View style={[styles.avatar, { backgroundColor: r.color }]}>
        <Text style={styles.avatarText}>{r.initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowText, { color: fg }]} numberOfLines={1}>{r.name}</Text>
        <Text style={[styles.rowSub, { color: muted }]} numberOfLines={1}>{r.handle}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={muted} />
    </PressRow>
  ));

  const personRows = (items: PersonResult[]) => items.map((p) => (
    <PersonRow
      key={p.userId}
      person={p}
      loading={!!followPending[p.userId]}
      onPress={() => handlePersonPress(p)}
      onToggleFollow={() => handleToggleFollow(p)}
    />
  ));

  const noResultsFallbackTerms = useMemo(() => {
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const t of [...trending.map((t) => t.term), ...suggestedBrands.map((b) => b.name)]) {
      const key = t?.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      terms.push(t.trim());
      if (terms.length === 6) break;
    }
    return terms;
  }, [trending, suggestedBrands]);

  // Related searches: other trending terms, excluding the current query —
  // a real-data heuristic (no hardcoded list) shown under a settled result set.
  const relatedSearchTerms = useMemo(() => {
    const q = trimmedQuery.toLowerCase();
    return trending
      .map((t) => t.term)
      .filter((t) => t.trim().toLowerCase() !== q)
      .slice(0, 6);
  }, [trending, trimmedQuery]);

  // ── Instant lightweight suggestions ──────────────────────────────────────
  // Shown the moment a couple of characters are typed, ahead of the full
  // tabbed grid — built from whatever the debounced fetch has already
  // returned (stale-while-revalidate), so it's on-screen before this fetch's
  // own 350ms debounce even resolves. Hands off to the full grid once
  // `searching` clears.
  type SuggestionRow = { key: string; icon: keyof typeof Feather.glyphMap; title: string; subtitle?: string; onPress: () => void };
  const suggestionRows = useMemo<SuggestionRow[]>(() => {
    if (!trimmedQuery) return [];
    const rows: SuggestionRow[] = [
      { key: 'q', icon: 'search', title: `Search for "${trimmedQuery}"`, onPress: () => submitTerm(trimmedQuery) },
    ];
    for (const b of brandResults.slice(0, 2)) {
      rows.push({ key: `b-${b.id}`, icon: 'tag', title: b.name, subtitle: 'Brand', onPress: () => handleResultPress(b) });
    }
    for (const p of productResults.slice(0, 3)) {
      rows.push({ key: `p-${p.id}`, icon: 'shopping-bag', title: p.name, subtitle: p.brand, onPress: () => handleResultPress(p) });
    }
    for (const person of people.slice(0, 2)) {
      rows.push({ key: `u-${person.userId}`, icon: 'user', title: person.name, subtitle: person.handle, onPress: () => handlePersonPress(person) });
    }
    return rows.slice(0, 7);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmedQuery, brandResults, productResults, people]);

  function renderInstantSuggestions() {
    if (suggestionRows.length <= 1) {
      // No cached results yet at all — a light row skeleton, not the heavier grid one.
      return (
        <View testID="buyer-search-instant-suggestions">
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.suggestionSkeletonRow}>
              <SkeletonBlock width={32} height={32} radius={RADII.chip} />
              <SkeletonBlock width={`${60 - i * 10}%`} height={14} />
            </View>
          ))}
        </View>
      );
    }
    return (
      <View testID="buyer-search-instant-suggestions">
        {suggestionRows.map((row) => (
          <ListRow
            key={row.key}
            icon={row.icon}
            iconColor={primary}
            title={row.title}
            subtitle={row.subtitle}
            onPress={row.onPress}
            style={styles.suggestionRow}
          />
        ))}
      </View>
    );
  }

  function renderNoResults() {
    return (
      <View testID="buyer-search-no-results">
        <EmptyState
          icon="search"
          title="No results — yet."
          description={`We couldn't find anything for "${trimmedQuery}". Try a broader term.`}
          action={{
            label: 'Clear search',
            icon: 'x-circle',
            onPress: () => setQuery(''),
          }}
        />
        {noResultsFallbackTerms.length > 0 && (
          <View style={styles.chipRow}>
            {noResultsFallbackTerms.map((term) => (
              <Chip
                key={term}
                label={term}
                selected={false}
                onPress={() => submitTerm(term)}
              />
            ))}
          </View>
        )}
      </View>
    );
  }

  function renderLoading() {
    return (
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginTop: SPACING.md }}>
        <GridSkeleton columns={gridColumns} cardWidth={gridCardWidth} rows={2} gap={GUTTER} />
      </ResponsiveContainer>
    );
  }

  function renderTabContent() {
    // Only called once `searching` has cleared — see the instant-suggestions
    // hand-off in the results-state render below.
    const totalCount = results.length + people.length;

    if (activeTab === 'people') {
      if (people.length === 0) return renderNoResults();
      return <View>{personRows(people)}</View>;
    }
    if (activeTab === 'brands') {
      if (brandResults.length === 0) return renderNoResults();
      return <View>{brandRows(brandResults)}</View>;
    }
    if (activeTab === 'products') {
      if (productResults.length === 0) return renderNoResults();
      return productGrid(productResults);
    }
    if (activeTab === 'videos') {
      if (videoResults.length === 0) return renderNoResults();
      return videoGrid(videoResults);
    }

    // Top — a smart-mixed short list of a few of each kind.
    if (totalCount === 0) return renderNoResults();
    const topPeople = people.slice(0, 3);
    const topBrands = brandResults.slice(0, 3);
    const topProducts = productResults.slice(0, 6);
    const topVideos = videoResults.slice(0, 4);
    return (
      <View>
        {topPeople.length > 0 && (
          <AnimatedEntrance>
            <Text style={[styles.sectionLabel, { color: muted }]}>PEOPLE</Text>
            {personRows(topPeople)}
          </AnimatedEntrance>
        )}
        {topBrands.length > 0 && (
          <AnimatedEntrance delay={40}>
            <Text style={[styles.sectionLabel, { color: muted }]}>BRANDS</Text>
            {brandRows(topBrands)}
          </AnimatedEntrance>
        )}
        {topProducts.length > 0 && (
          <AnimatedEntrance delay={80}>
            <Text style={[styles.sectionLabel, { color: muted }]}>PRODUCTS</Text>
            {productGrid(topProducts)}
          </AnimatedEntrance>
        )}
        {topVideos.length > 0 && (
          <AnimatedEntrance delay={120}>
            <Text style={[styles.sectionLabel, { color: muted }]}>VIDEOS</Text>
            {videoGrid(topVideos)}
          </AnimatedEntrance>
        )}
        {relatedSearchTerms.length > 0 && (
          <AnimatedEntrance delay={160}>
            <Text style={[styles.sectionLabel, { color: muted }]}>RELATED SEARCHES</Text>
            <View style={styles.relatedChipGrid}>
              {relatedSearchTerms.map((term) => (
                <TouchableOpacity
                  key={term}
                  onPress={() => submitTerm(term)}
                  style={[styles.relatedChip, { borderColor: theme.border, backgroundColor: theme.surface }]}
                  accessibilityRole="button"
                  accessibilityLabel={`Search ${term}`}
                >
                  <Feather name="search" size={12} color={muted} />
                  <Text style={[TYPE_SCALE.footnote, { color: fg, fontFamily: FONT.medium, flexShrink: 1 }]} numberOfLines={1}>{term}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </AnimatedEntrance>
        )}
      </View>
    );
  }

  const activeFilterChips = useMemo(() => {
    const chips: Array<{ key: keyof SearchFilters | 'price'; label: string; onClear: () => void }> = [];
    if (filters.category) {
      chips.push({ key: 'category', label: filters.category, onClear: () => setFilters((p) => ({ ...p, category: undefined })) });
    }
    if (filters.size) {
      chips.push({ key: 'size', label: `Size: ${filters.size}`, onClear: () => setFilters((p) => ({ ...p, size: undefined })) });
    }
    if (filters.brand) {
      const brandName = suggestedBrands.find((b) => b.sellerId === filters.brand)?.name ?? 'Brand';
      chips.push({ key: 'brand', label: brandName, onClear: () => setFilters((p) => ({ ...p, brand: undefined })) });
    }
    if (filters.minPriceCents !== undefined || filters.maxPriceCents !== undefined) {
      const min = filters.minPriceCents !== undefined ? `$${Math.round(filters.minPriceCents / 100)}` : null;
      const max = filters.maxPriceCents !== undefined ? `$${Math.round(filters.maxPriceCents / 100)}` : null;
      const label = min && max ? `${min} – ${max}` : max ? `Under ${max}` : `${min}+`;
      chips.push({ key: 'price', label, onClear: () => setFilters((p) => ({ ...p, minPriceCents: undefined, maxPriceCents: undefined })) });
    }
    if (filters.sort && filters.sort !== 'relevance') {
      const label = filters.sort === 'newest' ? 'Newest' : filters.sort === 'price_asc' ? 'Price: low to high' : 'Price: high to low';
      chips.push({ key: 'sort', label, onClear: () => setFilters((p) => ({ ...p, sort: undefined })) });
    }
    return chips;
  }, [filters, suggestedBrands]);

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: topPad + 12 }}
        refreshControl={
          <ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        <AnimatedEntrance>
          <View style={styles.titleBlock}>
            <Text style={[styles.title, { color: fg }]} accessibilityRole="header">Search</Text>
            <Text style={[styles.subtitle, { color: muted }]}>
              {trimmedQuery.length === 0
                ? 'Brands, pieces and people on Brandthread'
                : `Showing matches for "${trimmedQuery}"`}
            </Text>
          </View>
        </AnimatedEntrance>

        {trimmedQuery.length === 0 ? (
          <View testID="buyer-search-empty-state" accessibilityLabel="Search is empty">
            {recentSearches.length > 0 && (
              <AnimatedEntrance>
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionLabel, { color: muted, paddingHorizontal: 0 }]}>RECENT</Text>
                  <TouchableOpacity
                    onPress={clearRecentSearches}
                    accessibilityRole="button"
                    accessibilityLabel="Clear recent searches"
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Text style={[styles.sectionAction, { color: fg }]}>Clear all</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.chipRow}>
                  {recentSearches.map((term) => (
                    <Chip
                      key={term}
                      label={term}
                      selected={false}
                      icon="clock"
                      onPress={() => submitTerm(term)}
                      onRemove={() => removeRecentSearch(term)}
                      removeAccessibilityLabel={`Remove ${term} from recent searches`}
                    />
                  ))}
                </View>
              </AnimatedEntrance>
            )}

            {(trendingLoading || trending.length > 0) && (
              <AnimatedEntrance delay={30}>
                <Text style={[styles.sectionLabel, { color: muted, marginTop: SPACING.xs }]}>TRENDING</Text>
                {trendingLoading ? (
                  <View style={styles.chipRow}>
                    {[0, 1, 2, 3].map((i) => (
                      <SkeletonBlock key={i} width={72 + (i % 2) * 24} height={34} radius={RADII.pill} />
                    ))}
                  </View>
                ) : (
                  <View style={styles.chipRow}>
                    {trending.map((t, index) => (
                      <Chip
                        key={`${t.term}-${index}`}
                        label={t.term}
                        selected={false}
                        icon={t.type === 'brand' ? 'trending-up' : 'hash'}
                        iconColor={primary}
                        onPress={() => submitTerm(t.term)}
                      />
                    ))}
                  </View>
                )}
              </AnimatedEntrance>
            )}

            {(categoriesLoading || categories.length > 0) && (
              <AnimatedEntrance delay={60}>
                <Text style={[styles.sectionLabel, { color: muted, marginTop: SPACING.xs }]}>SEARCH BY CATEGORY</Text>
                {categoriesLoading ? (
                  <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
                    <View style={styles.grid} onLayout={onGridLayout}>
                      {[0, 1, 2, 3].map((i) => (
                        <SkeletonBlock key={i} width={gridCardWidth} height={gridCardWidth} radius={RADII.card} />
                      ))}
                    </View>
                  </ResponsiveContainer>
                ) : (
                  <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
                    <View style={styles.grid} onLayout={onGridLayout}>
                      {categories.map((c) => (
                        <CategoryTile
                          key={c.category}
                          item={c}
                          width={gridCardWidth}
                          onPress={() => submitCategory(c.category)}
                        />
                      ))}
                    </View>
                  </ResponsiveContainer>
                )}
              </AnimatedEntrance>
            )}

            {(suggestedLoading || suggestedBrands.length > 0) && (
              <AnimatedEntrance delay={90}>
                <Text style={[styles.sectionLabel, { color: muted, marginTop: SPACING.xs }]}>TRENDING BRANDS</Text>
                {suggestedLoading ? (
                  <View style={styles.brandCardRow}>
                    {[0, 1, 2].map((i) => (
                      <SkeletonBlock key={i} width={128} height={112} radius={RADII.card} />
                    ))}
                  </View>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.brandCardRow}>
                    {suggestedBrands.map((b) => (
                      <BrandCard
                        key={b.id}
                        brand={b}
                        width={128}
                        onPress={() => goToBrand(b.sellerId)}
                      />
                    ))}
                  </ScrollView>
                )}
              </AnimatedEntrance>
            )}

            {(suggestedLoading || suggestedProducts.length > 0) && (
              <AnimatedEntrance delay={120}>
                <Text style={[styles.sectionLabel, { color: muted, marginTop: SPACING.xs }]}>DISCOVER SOMETHING NEW</Text>
                {suggestedLoading ? (
                  renderLoading()
                ) : (
                  <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
                    <View style={styles.grid} onLayout={onGridLayout}>
                      {suggestedProducts.map((p) => (
                        <ProductTile
                          key={p.id}
                          item={p}
                          accent={primary}
                          width={gridCardWidth}
                          onPress={() => { rememberSearch(p.name); goToProduct(p.productId); }}
                        />
                      ))}
                    </View>
                  </ResponsiveContainer>
                )}
              </AnimatedEntrance>
            )}

            <AnimatedEntrance delay={150}>
              <Text style={[styles.sectionLabel, { color: muted, marginTop: SPACING.xs }]}>DISCOVER</Text>
              <ListRow
                icon="compass"
                iconColor={primary}
                title="Browse trending brands"
                chevron
                onPress={() => goToBrand()}
                style={styles.discoverRow}
              />
            </AnimatedEntrance>
          </View>
        ) : (
          <>
            {!searching && (
              <Text style={styles.resultsCount} numberOfLines={1}>{resultsCountLabel}</Text>
            )}

            {/* Tabs share a row with the Filters button instead of the button
                getting a whole row to itself below — a single icon-only
                circle here, same footprint as the tab pills, so it never
                wastes a full row of vertical space when there are no active
                filter chips to show underneath it. */}
            <View style={styles.tabsRow}>
              <View style={{ flex: 1 }}>
                <SegmentedTabs active={activeTab} onChange={setActiveTab} />
              </View>
              <TouchableOpacity
                onPress={() => { hapticSelection(); setFilterSheetVisible(true); }}
                style={[
                  styles.filterIconButton,
                  { borderColor: theme.border, backgroundColor: theme.surface },
                  activeFilterCount > 0 && { borderColor: primary },
                ]}
                accessibilityRole="button"
                accessibilityLabel={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
                testID="search-open-filters"
              >
                <Feather name="sliders" size={15} color={activeFilterCount > 0 ? primary : fg} />
                {activeFilterCount > 0 && (
                  <View style={[styles.filterCountBadge, { backgroundColor: primary }]}>
                    <Text style={styles.filterCountBadgeText}>{activeFilterCount}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            {activeFilterChips.length > 0 && (
              <View style={styles.filterBarRow}>
                {activeFilterChips.map((chip) => (
                  <Chip key={chip.key} label={chip.label} selected onPress={chip.onClear} onRemove={chip.onClear} removeAccessibilityLabel={`Clear ${chip.label} filter`} />
                ))}
              </View>
            )}

            <View testID="buyer-search-results-state" accessibilityLabel={`Search results for ${query}`}>
              {searching ? renderInstantSuggestions() : renderTabContent()}
            </View>
          </>
        )}
        <Animated.View style={bottomSpacerStyle} />
      </ScrollView>

      <FilterSheet
        visible={filterSheetVisible}
        onClose={() => setFilterSheetVisible(false)}
        value={filters}
        onApply={setFilters}
        categories={categories}
        brands={suggestedBrands}
      />
    </View>
  );
}

/**
 * Shared row press-feel for this screen's list rows (brand results, brand
 * avatar chips) — same PRESS_SCALE/PRESS_DURATION_MS motion tokens and
 * semantic haptic as `components/ui/ListRow` and `components/search/PersonRow`.
 */
function PressRow({
  children, onPress, accessibilityLabel, style, rowStyle,
}: {
  children: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  style?: React.ComponentProps<typeof View>['style'];
  rowStyle?: React.ComponentProps<typeof View>['style'];
}) {
  const scale = React.useRef(new RNAnimated.Value(1)).current;
  const nativeDriver = Platform.OS !== 'web';

  return (
    <Pressable
      onPress={() => { hapticToggle(); onPress(); }}
      onPressIn={() => RNAnimated.timing(scale, { toValue: PRESS_SCALE, duration: PRESS_DURATION_MS, useNativeDriver: nativeDriver }).start()}
      onPressOut={() => RNAnimated.spring(scale, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 6 }).start()}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={style}
    >
      <RNAnimated.View style={[localStyles.row, rowStyle, { transform: [{ scale }] }]}>
        {children}
      </RNAnimated.View>
    </Pressable>
  );
}

const localStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xs + 3,
  },
});

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  titleBlock: { paddingHorizontal: SCREEN_GUTTER, paddingBottom: SPACING.sm },
  title: { ...TYPE_SCALE.title1, letterSpacing: -0.8 },
  subtitle: { ...TYPE_SCALE.footnote, marginTop: SPACING.xxs },
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: SCREEN_GUTTER,
  },
  sectionAction: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, paddingTop: SPACING.md, paddingBottom: SPACING.xs - 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.xxs, paddingBottom: SPACING.xs },
  sectionLabel: {
    ...TYPE_SCALE.caption, letterSpacing: 0.4,
    paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.lg, paddingBottom: SPACING.xs,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xs + 3,
  },
  rowText: { ...TYPE_SCALE.body, fontFamily: FONT.medium },
  rowSub: { ...TYPE_SCALE.caption, marginTop: 2 },
  avatar: {
    width: 38, height: 38, borderRadius: RADII.avatar,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { ...TYPE_SCALE.footnote, fontFamily: FONT.bold, color: theme.onAccent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GUTTER },
  discoverRow: { paddingHorizontal: SCREEN_GUTTER },
  brandCardRow: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xxs },
  resultsCount: {
    ...TYPE_SCALE.caption, color: theme.muted, fontFamily: FONT.semibold,
    paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.xs, paddingBottom: SPACING.xxs,
  },
  tabsRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    paddingRight: SCREEN_GUTTER,
  },
  filterIconButton: {
    width: 44, height: 44, borderRadius: RADII.pill, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  filterCountBadge: {
    position: 'absolute', top: -2, right: -2,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
    alignItems: 'center', justifyContent: 'center',
  },
  // theme.onAccent, not a fixed white — several presets (e.g. monochrome,
  // silver) use a near-white accent, where white text would disappear.
  filterCountBadgeText: { fontSize: 10, fontFamily: FONT.bold, color: theme.onAccent },
  filterBarRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACING.xs,
    paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.xs, paddingBottom: SPACING.sm,
  },
  suggestionRow: { paddingHorizontal: SCREEN_GUTTER },
  suggestionSkeletonRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.sm,
    paddingHorizontal: SCREEN_GUTTER, paddingVertical: SPACING.xs + 3,
  },
  relatedChipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, paddingHorizontal: SCREEN_GUTTER },
  relatedChip: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xxs,
    borderWidth: 1, borderRadius: RADII.pill, paddingHorizontal: SPACING.sm, height: 36,
    minWidth: '46%', flexGrow: 1,
  },
});
