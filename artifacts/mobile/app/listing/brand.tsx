/**
 * Brand picker — Vinted's: a "Find a brand" search field over a plain list,
 * with the typed text offered as a custom brand when nothing matches. The
 * seller's own store brand is listed first (Brandthread sellers usually list
 * their own label).
 */
import React from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ListChoiceRow } from '@/components/listing/ListingRows';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { FONT, FS, SP } from '@/lib/theme';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { updateListing, useListing } from '@/lib/listing/listingStore';

const POPULAR_BRANDS = [
  'Unbranded', 'Vintage', 'Adidas', 'Arc’teryx', 'Carhartt', 'Champion', 'Converse', 'Dickies', 'Gap', 'H&M',
  'Levi’s', 'Nike', 'Patagonia', 'Polo Ralph Lauren', 'Stüssy', 'Supreme', 'The North Face', 'Uniqlo', 'Zara',
];

export default function ListingBrandScreen() {
  useHideTabBar();
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const form = useListing();
  const [query, setQuery] = React.useState('');
  const [ownBrand, setOwnBrand] = React.useState<string | null>(null);

  React.useEffect(() => {
    api.seller.getProfile()
      .then(p => setOwnBrand(p?.brandName?.trim() || null))
      .catch(() => {});
  }, [api]);

  const q = query.trim().toLowerCase();
  const all = [ownBrand, ...POPULAR_BRANDS].filter((b, i, arr): b is string => !!b && arr.indexOf(b) === i);
  const matches = q ? all.filter(b => b.toLowerCase().includes(q)) : all;
  const exact = all.some(b => b.toLowerCase() === q);

  function choose(brand: string) {
    updateListing({ brand });
    router.back();
  }

  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]} testID="listing-brand-screen">
      <ScreenHeader title="Brand" />
      <View style={styles.searchWrap}>
        <View style={[styles.search, { backgroundColor: theme.borderSubtle }]}>
          <Feather name="search" size={18} color={theme.muted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a brand"
            placeholderTextColor={theme.subtle}
            selectionColor={theme.text}
            autoCorrect={false}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => { if (query.trim()) choose(query.trim()); }}
            style={[styles.searchInput, { color: theme.text }]}
            testID="listing-brand-search"
          />
        </View>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        {q && !exact ? (
          <ListChoiceRow label={`Use “${query.trim()}”`} onPress={() => choose(query.trim())} testID="listing-brand-custom" />
        ) : null}
        {matches.map(b => (
          <ListChoiceRow key={b} label={b} selected={form.brand === b} onPress={() => choose(b)} testID={`listing-brand-${b}`} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  searchWrap: { paddingHorizontal: SP.md, paddingBottom: SP.sm },
  search: { height: 40, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: FS.base, fontFamily: FONT.regular, paddingVertical: 0 },
  content: { paddingBottom: 48 },
});
