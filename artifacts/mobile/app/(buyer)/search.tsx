import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, TextInput, Image as RNImage, Modal, Pressable, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { type SearchResult } from '@/lib/searchData';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { EmptyState, SearchResultsSkeleton } from '@/components/BrandthreadUI';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { CachedImage } from '@/components/CachedImage';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useBuyerSearch } from '@/contexts/BuyerSearchContext';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { FONT, FS } from '@/lib/theme';

type PersonResult = {
  userId: string; name: string; username: string | null;
  handle: string; initials: string; color: string;
  bio: string | null; isFollowing: boolean;
};

type ProductResult = Extract<SearchResult, { kind: 'product' }>;

function MasonryCard({ item, accent, onPress }: {
  item: ProductResult;
  accent: string;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const styles = makeStyles(theme);
  const [aspectRatio, setAspectRatio] = useState(0.82);

  useEffect(() => {
    if (!item.imageUri) return;
    RNImage.getSize(item.imageUri, (width, height) => {
      if (width > 0 && height > 0) setAspectRatio(Math.max(0.62, Math.min(1.24, width / height)));
    });
  }, [item.imageUri]);

  return (
    <TouchableOpacity style={styles.masonryCard} onPress={onPress} activeOpacity={0.88}>
      <View style={[styles.masonryMedia, { aspectRatio, backgroundColor: item.color }]}>
        {item.imageUri ? (
          <CachedImage source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={styles.masonryFallback}>
            <Text style={styles.masonryInitials}>{item.initials}</Text>
            <View style={styles.masonryFallbackLine} />
          </View>
        )}
        <View style={styles.masonryPrice}>
          <Text style={styles.masonryPriceText}>{formatCents(item.priceCents)}</Text>
        </View>
      </View>
      <Text style={styles.masonryName} numberOfLines={2}>{item.name}</Text>
      <View style={styles.masonryBrandRow}>
        <View style={[styles.masonryBrandDot, { backgroundColor: item.color }]} />
        <Text style={styles.masonryBrand} numberOfLines={1}>{item.brand}</Text>
        <Feather name="bookmark" size={13} color={accent} />
      </View>
    </TouchableOpacity>
  );
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Deep links may still pass ?q=; the tab bar's inline field owns the text.
  const { q: linkQuery } = useLocalSearchParams<{ q?: string }>();
  const { push } = useThreadPull();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const bg      = theme.background;
  const card    = theme.card;
  const border  = theme.border;
  const fg      = theme.text;
  const muted   = theme.muted;
  const primary = theme.accent;
  const primaryDim = theme.accentDim;

  const api    = useApi();
  const { userId } = useAuth();
  const {
    query, setQuery, filtersRequest, submitRequest, setActiveFilterCount, keyboardHeight,
  } = useBuyerSearch();
  const barInset = useBuyerTabBarInset();
  const [sort, setSort] = useState<string>(''); // '', 'relevance', 'price_asc', 'price_desc', 'newest'
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);
  const [draftSort, setDraftSort] = useState('');
  const [draftMinPrice, setDraftMinPrice] = useState('');
  const [draftMaxPrice, setDraftMaxPrice] = useState('');
  const [draftCategory, setDraftCategory] = useState('');

  const [results, setResults] = useState<SearchResult[]>([]);
  const [people,  setPeople]  = useState<PersonResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const topPad = Platform.OS === 'web' ? 24 : insets.top;
  const recentKey = `bt:buyer-search-recent:${userId ?? 'anon'}`;

  const hasActiveFilters = sort !== '' || minPrice !== '' || maxPrice !== '' || category !== '';

  useEffect(() => {
    if (typeof linkQuery === 'string' && linkQuery.length > 0) setQuery(linkQuery);
  }, [linkQuery, setQuery]);

  // Open only when the tab bar's filter button asks, never on first mount.
  const handledFiltersRequest = useRef(filtersRequest);
  useEffect(() => {
    if (filtersRequest === handledFiltersRequest.current) return;
    handledFiltersRequest.current = filtersRequest;
    openFilters();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersRequest]);

  const handledSubmitRequest = useRef(submitRequest);
  useEffect(() => {
    if (submitRequest === handledSubmitRequest.current) return;
    handledSubmitRequest.current = submitRequest;
    rememberSearch(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitRequest]);

  const activeFilterCount = [sort, minPrice || maxPrice, category].filter(Boolean).length;
  useEffect(() => {
    setActiveFilterCount(activeFilterCount);
  }, [activeFilterCount, setActiveFilterCount]);

  // Results scroll clear of the floating bar, and of the keyboard while the
  // bar rides above it.
  const bottomSpacerStyle = useAnimatedStyle(() => ({
    height: barInset + keyboardHeight.value + 16,
  }));
  const productResults = useMemo(() => results.filter((result): result is ProductResult => result.kind === 'product'), [results]);
  const brandResults = useMemo(() => results.filter(result => result.kind === 'brand'), [results]);
  const productColumns = useMemo(() => [
    productResults.filter((_, index) => index % 2 === 0),
    productResults.filter((_, index) => index % 2 === 1),
  ], [productResults]);

  const clearFilters = () => {
    setSort('');
    setMinPrice('');
    setMaxPrice('');
    setCategory('');
  };
  const openFilters = () => {
    setDraftSort(sort);
    setDraftMinPrice(minPrice);
    setDraftMaxPrice(maxPrice);
    setDraftCategory(category);
    setShowFilters(true);
  };
  const applyFilters = () => {
    setSort(draftSort);
    setMinPrice(draftMinPrice);
    setMaxPrice(draftMaxPrice);
    setCategory(draftCategory);
    setShowFilters(false);
  };
  const clearDraftFilters = () => {
    setDraftSort('');
    setDraftMinPrice('');
    setDraftMaxPrice('');
    setDraftCategory('');
  };

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

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1 && !hasActiveFilters) {
      setResults([]);
      setPeople([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const minPriceCents = minPrice ? parseDecimalToCents(minPrice) : undefined;
      const maxPriceCents = maxPrice ? parseDecimalToCents(maxPrice) : undefined;
      const [brandRes, peopleData] = await Promise.allSettled([
        api.public.search({
          q,
          sort: sort || undefined,
          minPriceCents: minPriceCents ?? undefined,
          maxPriceCents: maxPriceCents ?? undefined,
          category: category || undefined,
          limit: 20,
        }),
        api.social.search(q, 10),
      ]);
      if (!cancelled) {
        setResults(brandRes.status === 'fulfilled' ? brandRes.value.results ?? [] : []);
        setPeople(peopleData.status === 'fulfilled' ? peopleData.value as PersonResult[] : []);
        setSearching(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  // Query/filter changes and explicit retries are the only search triggers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort, minPrice, maxPrice, category, hasActiveFilters]);

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const value of [
      ...people.flatMap((person) => [person.name, person.handle]),
      ...results.map((result) => result.name),
    ]) {
      const term = value?.trim();
      const key = term?.toLowerCase();
      if (!term || !key || seen.has(key)) continue;
      seen.add(key);
      values.push(term);
      if (values.length === 6) break;
    }
    return values;
  }, [people, results]);

  function goToBrand() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    router.navigate('/(buyer)/discover' as never);
  }

  function clearRecentSearches() {
    Haptics.selectionAsync().catch(() => {});
    setRecentSearches([]);
    AsyncStorage.removeItem(recentKey).catch(() => {});
  }

  function handleResultPress(r: SearchResult) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    rememberSearch(query || r.name);
    if (r.kind === 'brand' && (r as any).sellerId) {
      router.push({ pathname: '/seller-profile' as any, params: { sellerId: (r as any).sellerId } });
    } else if (r.kind === 'product' && (r as any).productId) {
      push({ pathname: '/thread-product-detail' as any, params: { productId: (r as any).productId } } as never);
    } else {
      goToBrand();
    }
  }

  const SortChip = ({ label, active, onPress }: { label: string, active: boolean, onPress: () => void }) => (
    <TouchableOpacity
      style={[styles.filterChip, { borderColor: active ? primary : border, backgroundColor: active ? primaryDim : 'transparent' }]}
      onPress={() => { Haptics.selectionAsync(); onPress(); }}
    >
      <Text style={[styles.filterChipText, { color: active ? primary : fg }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: bg }}>
      <Modal
        visible={showFilters}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setShowFilters(false)}
      >
        <KeyboardAvoidingView style={styles.modalRoot} behavior="padding">
          <Pressable
            style={styles.sheetBackdrop}
            onPress={() => setShowFilters(false)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss search filters"
          />
          <View style={[styles.filterSheet, { backgroundColor: card, borderColor: border, paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <View>
                <Text style={[styles.sheetTitle, { color: fg }]}>Filter and sort</Text>
                <Text style={[styles.sheetSubtitle, { color: muted }]}>Changes apply when you tap Apply.</Text>
              </View>
              <TouchableOpacity onPress={() => setShowFilters(false)} style={styles.sheetClose} accessibilityLabel="Close filters">
                <Feather name="x" size={20} color={muted} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.filterLabel, { color: muted }]}>SORT BY</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 18 }} keyboardShouldPersistTaps="handled">
              <SortChip label="Relevance" active={!draftSort} onPress={() => setDraftSort('')} />
              <SortChip label="Price: Low-High" active={draftSort === 'price_asc'} onPress={() => setDraftSort('price_asc')} />
              <SortChip label="Price: High-Low" active={draftSort === 'price_desc'} onPress={() => setDraftSort('price_desc')} />
              <SortChip label="Newest" active={draftSort === 'newest'} onPress={() => setDraftSort('newest')} />
            </ScrollView>
            <Text style={[styles.filterLabel, { color: muted }]}>PRODUCT FILTERS</Text>
            <View style={styles.filterRow}>
              <TextInput style={[styles.filterInput, { color: fg, borderColor: border }]} placeholder="Min $" placeholderTextColor={muted} keyboardType="numeric" value={draftMinPrice} onChangeText={setDraftMinPrice} />
              <TextInput style={[styles.filterInput, { color: fg, borderColor: border }]} placeholder="Max $" placeholderTextColor={muted} keyboardType="numeric" value={draftMaxPrice} onChangeText={setDraftMaxPrice} />
            </View>
            <TextInput style={[styles.filterInput, styles.categoryInput, { color: fg, borderColor: border }]} placeholder="Category" placeholderTextColor={muted} value={draftCategory} onChangeText={setDraftCategory} />
            <View style={styles.sheetActions}>
              <TouchableOpacity onPress={clearDraftFilters} style={[styles.sheetAction, { borderColor: border }]} accessibilityRole="button">
                <Text style={[styles.clearBtnText, { color: fg }]}>Clear all</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={applyFilters} style={[styles.sheetAction, { backgroundColor: primary, borderColor: primary }]} accessibilityRole="button">
                <Text style={[styles.applyText, { color: theme.onAccent }]}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: topPad + 12 }}
      >
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: fg }]} accessibilityRole="header">Search</Text>
          <Text style={[styles.subtitle, { color: muted }]}>
            {query.trim().length === 0
              ? 'Brands, pieces and people on Brandthread'
              : `Showing matches for “${query.trim()}”`}
          </Text>
        </View>
        {query.trim().length === 0 ? (
          <View testID="buyer-search-empty-state" accessibilityLabel="Search is empty">
            {recentSearches.length > 0 ? (
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionLabel, { color: muted, paddingHorizontal: 0 }]}>RECENT</Text>
                <TouchableOpacity
                  onPress={clearRecentSearches}
                  accessibilityRole="button"
                  accessibilityLabel="Clear recent searches"
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={[styles.sectionAction, { color: fg }]}>Clear</Text>
                </TouchableOpacity>
              </View>
            ) : null}
            {recentSearches.map((term) => (
              <TouchableOpacity
                key={term}
                style={styles.row}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Search for ${term}`}
                onPress={() => {
                  rememberSearch(term);
                  setQuery(term);
                }}
              >
                <Feather name="clock" size={16} color={muted} />
                <Text style={[styles.rowText, { color: fg, flex: 1 }]} numberOfLines={1}>{term}</Text>
                <Feather name="arrow-up-left" size={15} color={muted} />
              </TouchableOpacity>
            ))}

            <Text style={[styles.sectionLabel, { color: muted, marginTop: 8 }]}>TRY</Text>
            <View style={styles.tryChips}>
              {SEARCH_STARTERS.map((term) => (
                <TouchableOpacity
                  key={term}
                  style={[styles.tryChip, { borderColor: border, backgroundColor: card }]}
                  activeOpacity={0.75}
                  onPress={() => { Haptics.selectionAsync().catch(() => {}); setQuery(term); }}
                  accessibilityRole="button"
                  accessibilityLabel={`Search for ${term}`}
                >
                  <Text style={[styles.tryChipText, { color: fg }]}>{term}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.sectionLabel, { color: muted, marginTop: 8 }]}>DISCOVER</Text>
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={goToBrand}
            >
              <Feather name="compass" size={17} color={primary} />
              <Text style={[styles.rowText, { color: fg }]}>Browse trending brands and drops</Text>
              <Feather name="chevron-right" size={17} color={muted} />
            </TouchableOpacity>
          </View>
        ) : (
          <View testID="buyer-search-results-state" accessibilityLabel={`Search results for ${query}`}>
            {suggestions.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { color: muted }]}>SUGGESTIONS</Text>
                {suggestions.map((term) => (
                  <TouchableOpacity
                    key={term}
                    style={styles.row}
                    activeOpacity={0.7}
                    onPress={() => {
                      rememberSearch(term);
                      setQuery(term);
                    }}
                  >
                    <Feather name="search" size={16} color={muted} />
                    <Text style={[styles.rowText, { color: fg }]}>{term}</Text>
                    <Feather name="arrow-up-left" size={15} color={muted} />
                  </TouchableOpacity>
                ))}
              </>
            ) : null}
            {searching && results.length === 0 && people.length === 0 ? (
              <SearchResultsSkeleton />
            ) : !searching && results.length === 0 && people.length === 0 ? (
              <EmptyState
                compact
                icon="search"
                title="No exact match — yet."
                description={`We couldn’t find “${query}”. Try a broader phrase or clear a filter to uncover more.`}
                action={hasActiveFilters ? { label: 'Clear filters', icon: 'x', onPress: clearFilters } : undefined}
              />
            ) : (
              <>
                {/* ── People section ─────────────────────────────────── */}
                {people.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { color: muted }]}>PEOPLE</Text>
                    {people.map((p: PersonResult) => (
                      <TouchableOpacity
                        key={p.userId}
                        style={styles.row}
                        activeOpacity={0.7}
                        onPress={() => {
                          rememberSearch(query || p.name);
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          router.push({
                            pathname: '/buyer-other-profile' as any,
                            params: {
                              userId: p.userId,
                              name: p.name,
                              handle: p.handle,
                              initials: p.initials,
                              color: p.color,
                            },
                          });
                        }}
                      >
                        <View style={[styles.avatar, { backgroundColor: p.color }]}>
                          <Text style={styles.avatarText}>{p.initials}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.rowText, { color: fg }]}>{p.name}</Text>
                          <Text style={[styles.rowSub, { color: muted }]}>
                            {p.handle}{p.bio ? `  ·  ${p.bio.slice(0, 40)}` : ''}
                          </Text>
                        </View>
                        {p.isFollowing && (
                          <View style={styles.followingBadge}>
                            <Text style={[styles.followingBadge, { borderColor: primary }, styles.followingBadgeText, { color: primary }]}>Following</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    ))}
                  </>
                )}
                {brandResults.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { color: muted, marginTop: people.length > 0 ? 8 : 0 }]}>
                      BRANDS
                    </Text>
                    {brandResults.map((r) => (
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
                          <Text style={[styles.rowText, { color: fg }]}>{r.name}</Text>
                          <Text style={[styles.rowSub, { color: muted }]}>{r.handle}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
                {productResults.length > 0 && (
                  <>
                    <View style={styles.editorialHeader}>
                      <View>
                        <Text style={[styles.sectionLabel, { color: muted, paddingHorizontal: 0, paddingBottom: 3 }]}>DISCOVERED FOR YOU</Text>
                        <Text style={[styles.editorialTitle, { color: fg }]}>{productResults.length} pieces worth a look</Text>
                      </View>
                      <Feather name="grid" size={18} color={primary} />
                    </View>
                    <View style={styles.masonryGrid}>
                      {productColumns.map((column, columnIndex) => (
                        <View style={styles.masonryColumn} key={columnIndex}>
                          {column.map(item => (
                            <MasonryCard
                              key={item.id}
                              item={item}
                              accent={primary}
                              onPress={() => handleResultPress(item)}
                            />
                          ))}
                        </View>
                      ))}
                    </View>
                  </>
                )}
              </>
            )}
          </View>
        )}
        <Animated.View style={bottomSpacerStyle} />
      </ScrollView>
    </View>
  );
}

// Starter queries, not results: they only prefill the field.
const SEARCH_STARTERS = ['Outerwear', 'Denim', 'Knitwear', 'Sneakers', 'Accessories', 'Vintage'] as const;

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
  tryChip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  tryChipText: { fontSize: FS.sm, fontFamily: FONT.medium },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1,
  },
  searchBar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 38,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', padding: 0 },
  sectionLabel: {
    fontSize: 11.5, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.4,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 11,
  },
  rowText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  rowSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  priceTag: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: theme.onAccent },
  editorialHeader: { marginTop: 18, paddingHorizontal: 16, paddingBottom: 14, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  editorialTitle: { fontSize: 21, fontFamily: 'Inter_700Bold', letterSpacing: -0.45 },
  masonryGrid: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12 },
  masonryColumn: { flex: 1, gap: 18 },
  masonryCard: { flex: 1 },
  masonryMedia: { width: '100%', minHeight: 145, maxHeight: 280, borderRadius: 18, overflow: 'hidden', justifyContent: 'flex-end' },
  masonryFallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.background}24` },
  masonryInitials: { color: theme.onAccent, fontSize: 36, fontFamily: 'Inter_700Bold', opacity: 0.9 },
  masonryFallbackLine: { width: 42, height: 2, borderRadius: 1, backgroundColor: `${theme.onAccent}8A`, marginTop: 10 },
  masonryPrice: { alignSelf: 'flex-start', backgroundColor: `${theme.background}C7`, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6, margin: 9 },
  masonryPriceText: { color: theme.onAccent, fontSize: 12, fontFamily: 'Inter_700Bold' },
  masonryName: { color: theme.text, fontSize: 14, lineHeight: 18, fontFamily: 'Inter_700Bold', marginTop: 8 },
  masonryBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  masonryBrandDot: { width: 15, height: 15, borderRadius: 8 },
  masonryBrand: { color: theme.muted, fontSize: 11, fontFamily: 'Inter_500Medium', flex: 1 },
  followingBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  followingBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: `${theme.background}9E` },
  filterSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 18, paddingTop: 10 },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: 18 },
  sheetTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  sheetTitle: { fontSize: 21, fontFamily: 'Inter_700Bold' },
  sheetSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 3 },
  sheetClose: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  filterLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8, marginBottom: 9 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, marginRight: 8 },
  filterChipText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  filterInput: { flex: 1, height: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 14, fontFamily: 'Inter_400Regular' },
  categoryInput: { flex: 0, marginBottom: 22 },
  sheetActions: { flexDirection: 'row', gap: 10 },
  sheetAction: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  clearBtn: { alignSelf: 'flex-end', paddingVertical: 4 },
  clearBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
