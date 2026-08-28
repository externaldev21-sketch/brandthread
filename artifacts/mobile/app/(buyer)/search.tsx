import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Platform, TextInput, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { searchCatalogue, SEARCH_BRANDS, type SearchResult } from '@/lib/searchData';
import { BG, CARD, BORDER, FG, MUTED } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { useAppTheme } from '@/contexts/AppThemeContext';

type PersonResult = {
  userId: string; name: string; username: string | null;
  handle: string; initials: string; color: string;
  bio: string | null; isFollowing: boolean;
};

const RECENT_SEARCHES = ['Vault Studio', 'Archive Hoodie', 'Coldform'];

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
  const [query,   setQuery]   = useState('');
  const [sort, setSort] = useState<string>(''); // '', 'relevance', 'price_asc', 'price_desc', 'newest'
  const [minPrice, setMinPrice] = useState<string>('');
  const [maxPrice, setMaxPrice] = useState<string>('');
  const [category, setCategory] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [people,  setPeople]  = useState<PersonResult[]>([]);
  const [searching, setSearching] = useState(false);
  const topPad = Platform.OS === 'web' ? 24 : insets.top;

  const hasActiveFilters = sort !== '' || minPrice !== '' || maxPrice !== '' || category !== '';

  const clearFilters = () => {
    setSort('');
    setMinPrice('');
    setMaxPrice('');
    setCategory('');
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 && !hasActiveFilters) { setResults([]); setPeople([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const minPriceCents = minPrice ? Math.floor(parseFloat(minPrice) * 100) : undefined;
        const maxPriceCents = maxPrice ? Math.floor(parseFloat(maxPrice) * 100) : undefined;

        const [brandRes, peopleData] = await Promise.allSettled([
          api.public.search({
            q,
            sort: sort || undefined,
            minPriceCents: !isNaN(minPriceCents as number) ? minPriceCents : undefined,
            maxPriceCents: !isNaN(maxPriceCents as number) ? maxPriceCents : undefined,
            category: category || undefined,
            limit: 20
          }),
          api.social.search(q, 10),
        ]);
        if (!cancelled) {
          if (brandRes.status === 'fulfilled') {
            setResults(brandRes.value.results ?? []);
          } else {
            let fallback = searchCatalogue(q);
            if (sort === 'price_asc' || sort === 'price_desc') {
               fallback.sort((a, b) => {
                 const pa = a.kind === 'product' ? parseFloat(a.price.replace(/[^0-9.]/g, '')) : 0;
                 const pb = b.kind === 'product' ? parseFloat(b.price.replace(/[^0-9.]/g, '')) : 0;
                 return sort === 'price_asc' ? pa - pb : pb - pa;
               });
            }
            setResults(fallback);
          }
          if (peopleData.status === 'fulfilled') {
            setPeople(peopleData.value as PersonResult[]);
          } else {
            setPeople([]);
          }
          setSearching(false);
        }
      } catch {
        if (!cancelled) { setResults(searchCatalogue(q)); setPeople([]); setSearching(false); }
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, sort, minPrice, maxPrice, category]);

  function goToBrand() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push('/(buyer)/feed' as never);
  }

  function handleResultPress(r: SearchResult) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
            setShowFilters(!showFilters);
          }}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Toggle filters"
        >
          <Feather name="sliders" size={20} color={hasActiveFilters ? primary : fg} />
        </TouchableOpacity>
      </View>

      {showFilters && (
        <View style={[styles.filterPanel, { backgroundColor: card, borderBottomColor: border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <SortChip label="Relevance" active={!sort} onPress={() => setSort('')} />
            <SortChip label="Price: Low-High" active={sort === 'price_asc'} onPress={() => setSort('price_asc')} />
            <SortChip label="Price: High-Low" active={sort === 'price_desc'} onPress={() => setSort('price_desc')} />
            <SortChip label="Newest" active={sort === 'newest'} onPress={() => setSort('newest')} />
          </ScrollView>
          <View style={styles.filterRow}>
            <TextInput
              style={[styles.filterInput, { color: fg, borderColor: border }]}
              placeholder="Min $"
              placeholderTextColor={muted}
              keyboardType="numeric"
              value={minPrice}
              onChangeText={setMinPrice}
            />
            <TextInput
              style={[styles.filterInput, { color: fg, borderColor: border }]}
              placeholder="Max $"
              placeholderTextColor={muted}
              keyboardType="numeric"
              value={maxPrice}
              onChangeText={setMaxPrice}
            />
            <TextInput
              style={[styles.filterInput, { color: fg, borderColor: border }]}
              placeholder="Category"
              placeholderTextColor={muted}
              value={category}
              onChangeText={setCategory}
            />
          </View>
          {hasActiveFilters && (
            <TouchableOpacity onPress={clearFilters} style={styles.clearBtn}>
              <Text style={[styles.clearBtnText, { color: primary }]}>Clear All</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        {query.trim().length === 0 ? (
          <>
            <Text style={[styles.sectionLabel, { color: muted }]}>RECENT</Text>
            {RECENT_SEARCHES.map((term) => (
              <TouchableOpacity
                key={term}
                style={styles.row}
                activeOpacity={0.7}
                onPress={() => setQuery(term)}
              >
                <Feather name="clock" size={16} color={muted} />
                <Text style={[styles.rowText, { color: fg }]}>{term}</Text>
              </TouchableOpacity>
            ))}

            <Text style={[styles.sectionLabel, { color: muted, marginTop: 8 }]}>SUGGESTED BRANDS</Text>
            {SEARCH_BRANDS.slice(0, 5).map((b) => (
              <TouchableOpacity
                key={b.id}
                style={styles.row}
                activeOpacity={0.7}
                onPress={goToBrand}
                accessibilityRole="button"
                accessibilityLabel={`Open ${b.name}`}
              >
                <View style={[styles.avatar, { backgroundColor: b.color }]}>
                  <Text style={styles.avatarText}>{b.initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowText, { color: fg }]}>{b.name}</Text>
                  <Text style={[styles.rowSub, { color: muted }]}>{b.handle}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </>
        ) : searching ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={primary} />
        ) : results.length === 0 && people.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIconRing, { borderColor: border }]}>
              <Feather name="search" size={28} color={muted} />
            </View>
            <Text style={[styles.emptyLabel, { color: muted }]}>No results for "{query}"</Text>
          </View>
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
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push({
                        pathname: '/buyer-other-profile' as any,
                        params: {
                          userId:   p.userId,
                          name:     p.name,
                          handle:   p.handle,
                          initials: p.initials,
                          color:    p.color,
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

            {/* ── Brands & products ──────────────────────────────── */}
            {results.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: muted, marginTop: people.length > 0 ? 8 : 0 }]}>
                  BRANDS & DROPS
                </Text>
                {results.map((r: SearchResult) => (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.row}
                    activeOpacity={0.7}
                    onPress={() => handleResultPress(r)}
                    accessibilityRole="button"
                    accessibilityLabel={r.kind === 'brand' ? `Open ${r.name}` : `Open ${r.name} by ${r.brand}`}
                  >
                    <View style={[styles.avatar, { backgroundColor: r.color }]}>
                      <Text style={styles.avatarText}>{r.initials}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowText, { color: fg }]}>{r.name}</Text>
                      <Text style={[styles.rowSub, { color: muted }]}>
                        {r.kind === 'brand' ? r.handle : `${r.brand} · ${r.price}`}
                      </Text>
                    </View>
                    {r.kind === 'product' && (
                      <Text style={[styles.priceTag, { color: primary }]}>{r.price}</Text>
                    )}
                  </TouchableOpacity>
                ))}
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
  emptyState: { alignItems: 'center', paddingTop: 80, gap: 14 },
  emptyIconRing: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyLabel: { fontSize: 13.5, fontFamily: 'Inter_400Regular' },
  followingBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  followingBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  filterPanel: { padding: 16, borderBottomWidth: 1 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, marginRight: 8 },
  filterChipText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  filterInput: { flex: 1, height: 36, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, fontSize: 14, fontFamily: 'Inter_400Regular' },
  clearBtn: { alignSelf: 'flex-end', paddingVertical: 4 },
  clearBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});
