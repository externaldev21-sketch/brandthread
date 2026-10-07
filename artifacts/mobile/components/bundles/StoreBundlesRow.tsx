/**
 * Storefront "Bundles" row — a seller's active bundles above their products
 * grid (seller profile, Products tab). Public data
 * (GET /api/bundles/public/:sellerId); renders nothing when the seller has
 * no buyable bundle. A card opens the bundle screen (app/bundle-detail.tsx).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi, type PublicBundle } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { bundleHref } from './BundleSaveSection';

const CARD_WIDTH = 220;

export function StoreBundlesRow({ sellerId }: { sellerId: string | null | undefined }) {
  const api = useApi();
  const router = useRouter();
  const { theme } = useAppTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  const [bundles, setBundles] = useState<PublicBundle[]>([]);

  useEffect(() => {
    let cancelled = false;
    setBundles([]);
    if (!sellerId) return () => { cancelled = true; };
    api.bundles.publicList(sellerId)
      .then((rows) => { if (!cancelled) setBundles(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setBundles([]); });
    return () => { cancelled = true; };
  }, [api, sellerId]);

  if (bundles.length === 0) return null;
  return (
    <View style={st.root} testID="store-bundles-row">
      <Text style={st.header} accessibilityRole="header">Bundles</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.rail}>
        {bundles.map((bundle) => {
          const images = bundle.items.map((item) => item.image).filter((uri): uri is string => !!uri).slice(0, 3);
          return (
            <TouchableOpacity
              key={bundle.id}
              style={st.card}
              activeOpacity={0.85}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(bundleHref(bundle.id) as never); }}
              accessibilityRole="button"
              accessibilityLabel={`${bundle.name}, ${formatCents(bundle.bundlePriceCents)}, save ${formatCents(bundle.savingsCents)}`}
              testID={`store-bundle-${bundle.id}`}
            >
              <View style={st.collage}>
                {images.length === 0 ? (
                  <View style={[st.tile, st.empty]}><Feather name="package" size={20} color={theme.muted} /></View>
                ) : images.map((uri, index) => (
                  <View key={`${uri}-${index}`} style={st.tile}>
                    <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={uri} />
                  </View>
                ))}
              </View>
              <Text style={st.name} numberOfLines={1}>{bundle.name}</Text>
              <Text style={st.meta} numberOfLines={1}>
                {`${bundle.items.reduce((n, i) => n + i.quantity, 0)} items`}
              </Text>
              <View style={st.priceRow}>
                <Text style={st.price}>{formatCents(bundle.bundlePriceCents)}</Text>
                <Text style={st.was}>{formatCents(bundle.itemsTotalCents)}</Text>
                <Text style={st.save}>Save {formatCents(bundle.savingsCents)}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { paddingTop: SP.sm, paddingBottom: SP.md },
  header: {
    fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4,
    paddingHorizontal: SP.md, marginBottom: SP.sm,
  },
  rail: { paddingHorizontal: SP.md, gap: SP.md },
  card: { width: CARD_WIDTH },
  collage: { flexDirection: 'row', gap: 2, height: 132, borderRadius: RADIUS.md, overflow: 'hidden', backgroundColor: theme.cardElevated },
  tile: { flex: 1, backgroundColor: theme.cardElevated },
  empty: { alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, marginTop: SP.sm },
  meta: { fontFamily: FONT.medium, fontSize: FS.meta, color: theme.muted, marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: SP.xs + 2, marginTop: 4 },
  price: { fontFamily: FONT.bold, fontSize: FS.sm, color: theme.text },
  was: { fontFamily: FONT.medium, fontSize: FS.meta, color: theme.subtle, textDecorationLine: 'line-through' },
  save: { fontFamily: FONT.semibold, fontSize: FS.meta, color: theme.text },
});

export default StoreBundlesRow;
