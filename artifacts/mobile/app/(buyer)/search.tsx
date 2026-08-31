import React, { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, TextInput, Image as RNImage, Modal, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@clerk/expo';
import { type SearchResult } from '@/lib/searchData';
import { BG, CARD, BORDER, FG, MUTED } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { reportNetworkError } from '@/lib/networkNotice';
import { EmptyState, SearchResultsSkeleton } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

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
  const bg      = BG;
  const card    = CARD;
  const border  = BORDER;
  const fg      = FG;
  const muted   = MUTED;
  const { theme } = useAppTheme();
  const primary = theme.accent;
  const primaryDim = theme.accentDim;

  const api    = useApi();
  const { userId } = useAuth();
  const [query,   setQuery]   = useState('');
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [searchFocused, setSearchFocused] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);
  const topPad = Platform.OS === 'web' ? 24 : insets.top;
  const recentKey = `bt:buyer-search-recent:${userId ?? 'anon'}`;

  const hasActiveFilters = sort !== '' || minPrice !== '' || maxPrice !== '' || category !== '';
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
      setSearchError(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
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
        if (brandRes.status === 'rejected' && peopleData.status === 'rejected') {
          const error = brandRes.reason ?? peopleData.reason;
          setSearchError('Search could not load. Check your connection and try again.');
          reportNetworkError(error, () => setRetryNonce((value) => value + 1));
        }
        setSearching(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  // Query/filter changes and explicit retries are the only search triggers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sort, minPrice, maxPrice, category, retryNonce, hasActiveFilters]);

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(buyer)/feed' as never);
  }

  function handleResultPress(r: SearchResult) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    rememberSearch(query || r.name);
    if (r.kind === 'brand' && (r as any).sellerId) {
      router.push({ pathname: '/seller-profile' as any, params: { sellerId: (r as any).sellerId } });
    } else if (r.kind === 'product' && (r as any).productId) {
      router.push({ pathname: '/buyer-product-detail' as any, params: { productId: (r as any).productId } });
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
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="chevron-left" size={26} color={fg} />
        </TouchableOpacity>
        <View style={[styles.searchBar, { backgroundColor: card, borderColor: border }]}>
          <Feather name="search" size={16} color={muted} />
          <TextInput
            style={[styles.searchInput, { color: fg }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search brands and drops"
            placeholderTextColor={muted}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onSubmitEditing={() => rememberSearch(query)}
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <Feather name="x-circle" size={16} color={muted} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            openFilters();
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Open search filters"
        >
          <Feather name="sliders" size={20} color={hasActiveFilters ? primary : fg} />
        </TouchableOpacity>
      </View>

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

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        {query.trim().length === 0 ? (
          <>
            {searchFocused && recentSearches.length > 0 ? (
              <Text style={[styles.sectionLabel, { color: muted }]}>RECENT</Text>
            ) : null}
            {searchFocused && recentSearches.map((term) => (
              <TouchableOpacity
                key={term}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => {
                  rememberSearch(term);
                  setQuery(term);
                }}
              >
                <Feather name="clock" size={16} color={muted} />
                <Text style={[styles.rowText, { color: fg }]}>{term}</Text>
              </TouchableOpacity>
            ))}

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
          </>
        ) : searchError ? (
          <EmptyState
            icon="wifi-off"
            title="The thread slipped."
            description={searchError}
            action={{ label: 'Try search again', icon: 'refresh-cw', onPress: () => setRetryNonce((value) => value + 1) }}
          />
        ) : (
          <>
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
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
  avatarText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  editorialHeader: { marginTop: 18, paddingHorizontal: 16, paddingBottom: 14, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  editorialTitle: { fontSize: 21, fontFamily: 'Inter_700Bold', letterSpacing: -0.45 },
  masonryGrid: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12 },
  masonryColumn: { flex: 1, gap: 18 },
  masonryCard: { flex: 1 },
  masonryMedia: { width: '100%', minHeight: 145, maxHeight: 280, borderRadius: 18, overflow: 'hidden', justifyContent: 'flex-end' },
  masonryFallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.14)' },
  masonryInitials: { color: '#FFFFFF', fontSize: 36, fontFamily: 'Inter_700Bold', opacity: 0.9 },
  masonryFallbackLine: { width: 42, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.54)', marginTop: 10 },
  masonryPrice: { alignSelf: 'flex-start', backgroundColor: 'rgba(4,4,7,0.78)', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6, margin: 9 },
  masonryPriceText: { color: '#FFFFFF', fontSize: 12, fontFamily: 'Inter_700Bold' },
  masonryName: { color: FG, fontSize: 14, lineHeight: 18, fontFamily: 'Inter_700Bold', marginTop: 8 },
  masonryBrandRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  masonryBrandDot: { width: 15, height: 15, borderRadius: 8 },
  masonryBrand: { color: MUTED, fontSize: 11, fontFamily: 'Inter_500Medium', flex: 1 },
  followingBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  followingBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.62)' },
  filterSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, paddingHorizontal: 18, paddingTop: 10 },
  sheetHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: 18 },
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
