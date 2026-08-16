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
import { BG, CARD, BORDER, FG, MUTED, PURPLE } from '@/lib/theme';
import { useApi } from '@/lib/api';

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
  const primary = PURPLE;

  const api    = useApi();
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [people,  setPeople]  = useState<PersonResult[]>([]);
  const [searching, setSearching] = useState(false);
  const topPad = Platform.OS === 'web' ? 24 : insets.top;

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setPeople([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const base = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
        const [brandRes, peopleData] = await Promise.allSettled([
          fetch(`${base}/api/public/search?q=${encodeURIComponent(q)}&limit=20`),
          api.social.search(q, 10),
        ]);
        if (!cancelled) {
          if (brandRes.status === 'fulfilled' && brandRes.value.ok) {
            const data = await brandRes.value.json();
            setResults(data.results ?? []);
          } else {
            setResults(searchCatalogue(q));
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
  }, [query]);

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
      </View>

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
                        <Text style={[styles.followingBadgeText, { color: primary }]}>Following</Text>
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
  followingBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 10, borderWidth: 1, borderColor: PURPLE,
  },
  followingBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});
