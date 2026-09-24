import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, ActivityIndicator, RefreshControl, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { type SearchResult, type TrendingTerm, type SuggestedBrand, type SuggestedProduct } from '@/lib/searchData';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { EmptyState } from '@/components/BrandthreadUI';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { CachedImage } from '@/components/CachedImage';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useBuyerSearch } from '@/contexts/BuyerSearchContext';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { FONT, FS, GUTTER, GRID_MAX_WIDTH } from '@/lib/theme';
import { GridSkeleton, ResponsiveContainer, useGridColumns } from '@/components/layout';
import { ProductTile } from '@/components/search/ProductTile';
import { PersonRow, type SearchPerson } from '@/components/search/PersonRow';
import { SegmentedTabs, type SearchTabKey } from '@/components/search/SegmentedTabs';

type PersonResult = SearchPerson;
type ProductResult = Extract<SearchResult, { kind: 'product' }>;
type BrandResult = Extract<SearchResult, { kind: 'brand' }>;

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
  // Filters were removed entirely from this screen. The tab bar's filter
  // button still calls `requestFilters()` and reads `activeFilterCount`
  // (owned elsewhere, not touched here) — this screen simply never listens
  // for `filtersRequest` and never raises `activeFilterCount`, so the button
  // becomes an inert no-op without any change to the tab bar or context.
  const { query, setQuery, submitRequest, keyboardHeight } = useBuyerSearch();
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

  // Results scroll clear of the floating bar, and of the keyboard while the
  // bar rides above it.
  const bottomSpacerStyle = useAnimatedStyle(() => ({
    height: barInset + keyboardHeight.value + 16,
  }));
  const productResults = useMemo(() => results.filter((result): result is ProductResult => result.kind === 'product'), [results]);
  const brandResults   = useMemo(() => results.filter((result): result is BrandResult => result.kind === 'brand'), [results]);

  // Fixed-column product grid (2 on phone, 3-4 on iPad) with an even gutter —
  // measured from the grid's own laid-out width so it also works inside the
  // centered ResponsiveContainer column on iPad.
  const gridColumns = useGridColumns({ phone: 2, tablet: 3, tabletLandscape: 4 });
  const { width: winWidth } = useWindowDimensions();
  const [gridWidth, setGridWidth] = useState(0);
  const fallbackGridWidth = Math.min(winWidth, GRID_MAX_WIDTH) - GUTTER * 2;
  const effectiveGridWidth = gridWidth > 0 ? gridWidth : fallbackGridWidth;
  const gridCardWidth = Math.max(1, (effectiveGridWidth - GUTTER * (gridColumns - 1)) / gridColumns);

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
    Haptics.selectionAsync().catch(() => {});
    setRecentSearches([]);
    AsyncStorage.removeItem(recentKey).catch(() => {});
  }

  function removeRecentSearch(term: string) {
    Haptics.selectionAsync().catch(() => {});
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

  // ── Debounced instant search ─────────────────────────────────────────────
  const performSearch = useCallback(async (term: string) => {
    const [productRes, peopleRes] = await Promise.allSettled([
      api.public.search({ q: term, limit: 20 }),
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

  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    const q = query.trim();
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const tasks: Promise<unknown>[] = [];
    if (q.length >= 1) tasks.push(performSearch(q));
    tasks.push(
      api.public.trending(8).then((res) => setTrending(res?.trending ?? [])).catch(() => {}),
      api.public.suggested(8).then((res) => {
        setSuggestedBrands(res?.brands ?? []);
        setSuggestedProducts(res?.products ?? []);
      }).catch(() => {}),
    );
    Promise.allSettled(tasks).finally(() => setRefreshing(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, performSearch]);

  function goToBrand(sellerId?: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (sellerId) {
      router.push({ pathname: '/seller-profile' as any, params: { sellerId } });
    } else {
      router.navigate('/(buyer)/discover' as never);
    }
  }

  function goToProduct(productId: string) {
    push({ pathname: '/thread-product-detail' as any, params: { productId } } as never);
  }

  function handleResultPress(r: SearchResult) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
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

  const productGrid = (items: ProductResult[]) => (
    <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
      <View
        style={styles.grid}
        onLayout={({ nativeEvent }) => {
          const nextWidth = Math.round(nativeEvent.layout.width);
          if (nextWidth > 0 && nextWidth !== gridWidth) setGridWidth(nextWidth);
        }}
      >
        {items.map((item) => (
          <ProductTile
            key={item.id}
            item={item}
            accent={primary}
            width={gridCardWidth}
            onPress={() => handleResultPress(item)}
          />
        ))}
      </View>
    </ResponsiveContainer>
  );

  const brandRows = (items: BrandResult[]) => items.map((r) => (
    <TouchableOpacity
      key={r.id}
      style={styles.row}
      activeOpacity={0.7}
      onPress={() => handleResultPress(r)}
      accessibilityRole="button"
      accessibilityLabel={`Open ${r.name}`}
    >
      <View style={[styles.avatar, { backgroundColor: r.color }]}>
        <Text style={styles.avatarText}>{r.initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowText, { color: fg }]} numberOfLines={1}>{r.name}</Text>
        <Text style={[styles.rowSub, { color: muted }]} numberOfLines={1}>{r.handle}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={muted} />
    </TouchableOpacity>
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

  function renderNoResults() {
    return (
      <View testID="buyer-search-no-results">
        <EmptyState
          compact
          icon="search"
          title="No results — yet."
          description={`We couldn't find anything for "${trimmedQuery}". Try a broader term.`}
        />
        {noResultsFallbackTerms.length > 0 && (
          <View style={styles.tryChips}>
            {noResultsFallbackTerms.map((term) => (
              <TouchableOpacity
                key={term}
                style={[styles.tryChip, { borderColor: theme.border, backgroundColor: theme.card }]}
                activeOpacity={0.75}
                onPress={() => submitTerm(term)}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${term}`}
              >
                <Text style={[styles.tryChipText, { color: fg }]}>{term}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  }

  function renderLoading() {
    return (
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginTop: 16 }}>
        <GridSkeleton columns={gridColumns} cardWidth={gridCardWidth} rows={2} gap={GUTTER} />
      </ResponsiveContainer>
    );
  }

  function renderTabContent() {
    const totalCount = results.length + people.length;
    if (searching && totalCount === 0) return renderLoading();

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

    // Top — a smart-mixed short list of a few of each kind.
    if (totalCount === 0) return renderNoResults();
    const topPeople = people.slice(0, 3);
    const topBrands = brandResults.slice(0, 3);
    const topProducts = productResults.slice(0, 6);
    return (
      <View>
        {topPeople.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: muted }]}>PEOPLE</Text>
            {personRows(topPeople)}
          </>
        )}
        {topBrands.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: muted }]}>BRANDS</Text>
            {brandRows(topBrands)}
          </>
        )}
        {topProducts.length > 0 && (
          <>
            <Text style={[styles.sectionLabel, { color: muted }]}>PRODUCTS</Text>
            {productGrid(topProducts)}
          </>
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: topPad + 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={primary}
            colors={[primary]}
          />
        }
      >
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: fg }]} accessibilityRole="header">Search</Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            {trimmedQuery.length === 0
              ? 'Brands, pieces and people on Brandthread'
              : `Showing matches for "${trimmedQuery}"`}
          </Text>
        </View>

        {trimmedQuery.length === 0 ? (
          <View testID="buyer-search-empty-state" accessibilityLabel="Search is empty">
            {recentSearches.length > 0 && (
              <>
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
                {recentSearches.map((term) => (
                  <View key={term} style={styles.row}>
                    <TouchableOpacity
                      style={styles.recentTouchArea}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Search for ${term}`}
                      onPress={() => submitTerm(term)}
                    >
                      <Feather name="clock" size={16} color={muted} />
                      <Text style={[styles.rowText, { color: fg, flex: 1 }]} numberOfLines={1}>{term}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => removeRecentSearch(term)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${term} from recent searches`}
                    >
                      <Feather name="x" size={16} color={muted} />
                    </TouchableOpacity>
                  </View>
                ))}
              </>
            )}

            {(trendingLoading || trending.length > 0) && (
              <>
                <Text style={[styles.sectionLabel, { color: muted, marginTop: 8 }]}>TRENDING</Text>
                {trendingLoading ? (
                  <ActivityIndicator style={{ marginLeft: 16, marginTop: 4 }} color={primary} />
                ) : (
                  <View style={styles.tryChips}>
                    {trending.map((t, index) => (
                      <TouchableOpacity
                        key={`${t.term}-${index}`}
                        style={[styles.tryChip, { borderColor: theme.border, backgroundColor: theme.card }]}
                        activeOpacity={0.75}
                        onPress={() => submitTerm(t.term)}
                        accessibilityRole="button"
                        accessibilityLabel={`Search for ${t.term}`}
                      >
                        <Feather name={t.type === 'brand' ? 'trending-up' : 'hash'} size={12} color={primary} />
                        <Text style={[styles.tryChipText, { color: fg }]}>{t.term}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}

            {(suggestedLoading || suggestedBrands.length > 0) && (
              <>
                <Text style={[styles.sectionLabel, { color: muted, marginTop: 8 }]}>BRANDS TO FOLLOW</Text>
                {suggestedLoading ? (
                  <ActivityIndicator style={{ marginLeft: 16, marginTop: 4 }} color={primary} />
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.brandAvatarRow}>
                    {suggestedBrands.map((b) => (
                      <TouchableOpacity
                        key={b.id}
                        style={styles.brandAvatarItem}
                        activeOpacity={0.75}
                        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); goToBrand(b.sellerId); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Visit ${b.name}`}
                      >
                        <View style={[styles.brandAvatar, { backgroundColor: b.color }]}>
                          <Text style={styles.avatarText}>{b.initials}</Text>
                        </View>
                        <Text style={[styles.brandAvatarName, { color: fg }]} numberOfLines={1}>{b.name}</Text>
                        {b.followerCount > 0 && (
                          <Text style={[styles.brandAvatarSub, { color: muted }]} numberOfLines={1}>
                            {b.followerCount} {b.followerCount === 1 ? 'follower' : 'followers'}
                          </Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </>
            )}

            {(suggestedLoading || suggestedProducts.length > 0) && (
              <>
                <Text style={[styles.sectionLabel, { color: muted, marginTop: 8 }]}>DISCOVER SOMETHING NEW</Text>
                {suggestedLoading ? (
                  renderLoading()
                ) : (
                  <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
                    <View
                      style={styles.grid}
                      onLayout={({ nativeEvent }) => {
                        const nextWidth = Math.round(nativeEvent.layout.width);
                        if (nextWidth > 0 && nextWidth !== gridWidth) setGridWidth(nextWidth);
                      }}
                    >
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
              </>
            )}

            <Text style={[styles.sectionLabel, { color: muted, marginTop: 8 }]}>DISCOVER</Text>
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => goToBrand()}
            >
              <Feather name="compass" size={17} color={primary} />
              <Text style={[styles.rowText, { color: fg }]}>Browse trending brands and drops</Text>
              <Feather name="chevron-right" size={17} color={muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <SegmentedTabs active={activeTab} onChange={setActiveTab} />
            <View testID="buyer-search-results-state" accessibilityLabel={`Search results for ${query}`}>
              {renderTabContent()}
            </View>
          </>
        )}
        <Animated.View style={bottomSpacerStyle} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  titleBlock: { paddingHorizontal: 16, paddingBottom: 6 },
  title: { fontSize: FS.h2, fontFamily: FONT.bold, letterSpacing: -0.6 },
  subtitle: { fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 4 },
  sectionHeaderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  sectionAction: { fontSize: FS.sm, fontFamily: FONT.semibold, paddingTop: 16, paddingBottom: 6 },
  tryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8 },
  tryChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center',
  },
  tryChipText: { fontSize: FS.sm, fontFamily: FONT.medium },
  sectionLabel: {
    fontSize: 11.5, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.4,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 11,
  },
  recentTouchArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  rowSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: theme.onAccent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GUTTER },
  brandAvatarRow: { flexDirection: 'row', gap: 16, paddingHorizontal: 16, paddingVertical: 4 },
  brandAvatarItem: { alignItems: 'center', width: 74 },
  brandAvatar: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  brandAvatarName: { fontSize: 12, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  brandAvatarSub: { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 1 },
});
