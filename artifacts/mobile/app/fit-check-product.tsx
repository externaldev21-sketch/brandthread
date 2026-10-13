/**
 * Link a fit check to a product you bought — Instagram "Tag people" pattern
 * (search field over a result list; tap a row to tag, Done returns), with the
 * list limited to products the server verified you purchased
 * (GET /api/fits/purchased-products). Linking: PUT /api/fits/fit-checks/:postId.
 *
 * Route: /fit-check-product?postId=…&current=<productId?>
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SearchBar } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { fitsErrorMessage } from '@/lib/fits';
import { fitsService, type FitProduct } from '@/services/fitsService';
import { RADII } from '@/constants/radii';
import { FONT, FS, SP } from '@/lib/theme';

export default function FitCheckProductScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ postId?: string; current?: string }>();
  const postId = typeof params.postId === 'string' ? params.postId : '';
  const [products, setProducts] = useState<FitProduct[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(typeof params.current === 'string' ? params.current : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fitsService.purchasedProducts()
      .then((r) => { if (!cancelled) setProducts(r.products); })
      .catch(() => { if (!cancelled) { setProducts([]); setError('Couldn’t load your purchases.'); } });
    return () => { cancelled = true; };
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!products) return [];
    return q ? products.filter((p) => `${p.name} ${p.brandName ?? ''}`.toLowerCase().includes(q)) : products;
  }, [products, query]);

  const choose = useCallback(async (product: FitProduct) => {
    if (busy || !postId) return;
    setBusy(product.id);
    setError(null);
    try {
      await fitsService.linkFitCheck(postId, product.id);
      setSelected(product.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      goBackOr(router);
    } catch (err) {
      setError(fitsErrorMessage(err, 'Couldn’t link this product. Try again.'));
    } finally {
      setBusy(null);
    }
  }, [busy, postId, router]);

  return (
    <View style={styles.root}>
      <ScreenHeader title="Tag product" onBack={() => goBackOr(router)} />
      <View style={styles.search}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search your purchases" />
      </View>
      {error ? <Text style={styles.error} testID="fit-check-error">{error}</Text> : null}
      {products === null ? (
        <View style={styles.center}><ActivityIndicator color={theme.text} /></View>
      ) : products.length === 0 && !error ? (
        <View style={styles.center}><Text style={styles.muted}>Products you buy show up here.</Text></View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + SP.lg }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => void choose(item)}
              disabled={!!busy}
              accessibilityRole="button"
              accessibilityLabel={item.name}
              accessibilityState={{ selected: selected === item.id }}
              testID={`fit-check-product-${item.id}`}
            >
              <View style={styles.image}>
                {item.imageUrl ? <CachedImage source={{ uri: item.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
              </View>
              <View style={styles.text}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                {item.brandName ? <Text style={styles.brand} numberOfLines={1}>{item.brandName}</Text> : null}
              </View>
              {busy === item.id ? <ActivityIndicator color={theme.text} />
                : selected === item.id ? <Feather name="check" size={20} color={theme.text} /> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  search: { paddingHorizontal: SP.md, paddingBottom: SP.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  muted: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  error: { color: theme.error ?? theme.text, fontFamily: FONT.medium, fontSize: FS.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  image: { width: 48, height: 48, borderRadius: RADII.input, overflow: 'hidden', backgroundColor: theme.surface },
  text: { flex: 1 },
  name: { color: theme.text, fontFamily: FONT.semibold, fontSize: FS.base },
  brand: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
});
