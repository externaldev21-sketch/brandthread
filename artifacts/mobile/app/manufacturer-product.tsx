/**
 * Manufacturer Product Detail — full quantity price-tier table, MOQ,
 * customization options, lead time and sample price for one catalog product.
 * Params: manufacturerId, productId
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { Header } from '@/components/layout';
import { EmptyState, PrimaryButton, StatusBadge } from '@/components/BrandthreadUI';
import { formatCents } from '@/lib/money';
import { getManufacturerProduct, type ManufacturerProduct } from '@/services/manufacturerCatalog';

export default function ManufacturerProductScreen() {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeS(theme), [theme]);
  const router = useRouter();
  const { manufacturerId, productId } = useLocalSearchParams<{ manufacturerId: string; productId: string }>();

  const [product, setProduct] = useState<ManufacturerProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    if (!manufacturerId || !productId) { setLoading(false); return; }
    setLoading(true);
    setError(false);
    getManufacturerProduct(manufacturerId, productId)
      .then((p) => setProduct(p ?? null))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [manufacturerId, productId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={s.root}>
      <Header title={product?.name ?? 'Product'} onBack={() => router.back()} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={theme.accent} /></View>
      ) : error || !product ? (
        <EmptyState icon="alert-circle" title="Product unavailable" description="This catalog product could not be loaded." action={{ label: 'Retry', onPress: load }} />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.scroll}>
          {product.images.length > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={s.gallery}>
              {product.images.map((uri, index) => <Image key={`${uri}-${index}`} source={{ uri }} style={s.galleryImage} />)}
            </ScrollView>
          ) : (
            <View style={[s.gallery, s.galleryFallback]}><Feather name="package" size={ICON.xxl} color={theme.subtle} /></View>
          )}

          <View style={s.body}>
            <View style={s.titleRow}>
              <Text style={s.title}>{product.name}</Text>
              {product.category ? <StatusBadge label={product.category} variant="purple" small /> : null}
            </View>
            {!!product.description && <Text style={s.description}>{product.description}</Text>}

            <View style={s.statsGrid}>
              <View style={s.statItem}>
                <Feather name="package" size={ICON.sm} color={theme.text} />
                <Text style={s.statLabel}>MOQ</Text>
                <Text style={s.statValue}>{product.moq.toLocaleString('en-US')} units</Text>
              </View>
              <View style={s.statItem}>
                <Feather name="clock" size={ICON.sm} color={theme.text} />
                <Text style={s.statLabel}>Lead time</Text>
                <Text style={s.statValue}>{product.leadTimeDays} days</Text>
              </View>
              <View style={s.statItem}>
                <Feather name="scissors" size={ICON.sm} color={theme.text} />
                <Text style={s.statLabel}>Sample price</Text>
                <Text style={s.statValue}>{product.samplePriceLabel ?? formatCents(product.samplePriceCents)}</Text>
              </View>
            </View>

            <Text style={s.sectionTitle}>Quantity Pricing</Text>
            {product.priceTiers.length === 0 ? (
              <Text style={s.hint}>No tiered pricing published yet — request a quote for a price.</Text>
            ) : (
              <View style={s.tierTable}>
                <View style={[s.tierRow, s.tierHeaderRow]}>
                  <Text style={[s.tierCell, s.tierHeaderText, { flex: 1.4 }]}>Quantity</Text>
                  <Text style={[s.tierCell, s.tierHeaderText]}>Unit Price</Text>
                </View>
                {product.priceTiers.map((tier) => (
                  <View key={tier.id} style={s.tierRow}>
                    <Text style={[s.tierCell, { flex: 1.4 }]}>
                      {tier.minQuantity.toLocaleString('en-US')}{tier.maxQuantity ? `–${tier.maxQuantity.toLocaleString('en-US')}` : '+'} units
                    </Text>
                    <Text style={[s.tierCell, s.tierPrice]}>{formatCents(tier.unitPriceCents)}</Text>
                  </View>
                ))}
              </View>
            )}

            {product.customizationOptions.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Customization Options</Text>
                <View style={s.chipRow}>
                  {product.customizationOptions.map((opt) => (
                    <View key={opt} style={s.chip}><Text style={s.chipText}>{opt}</Text></View>
                  ))}
                </View>
              </>
            )}
          </View>
        </ScrollView>
      )}

      {product && (
        <View style={s.footer}>
          <PrimaryButton
            label="Request Quote for this Product"
            icon="file-text"
            onPress={() => router.push(`/quote-request?manufacturerId=${product.manufacturerId}&productId=${product.id}` as never)}
          />
        </View>
      )}
    </View>
  );
}

const makeS = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: SP.xxl },
  gallery: { height: 220, backgroundColor: theme.cardElevated },
  galleryImage: { width: 360, height: 220 },
  galleryFallback: { alignItems: 'center', justifyContent: 'center' },
  body: { padding: SP.md, gap: SP.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  title: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text, flex: 1 },
  description: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, lineHeight: 20 },
  statsGrid: { flexDirection: 'row', gap: SP.sm, marginTop: SP.xs },
  statItem: { flex: 1, backgroundColor: theme.cardGlass, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, padding: SP.sm, alignItems: 'center', gap: 3 },
  statLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },
  statValue: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text, textAlign: 'center' },
  sectionTitle: { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text, marginTop: SP.md },
  hint: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },
  tierTable: { borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' },
  tierRow: { flexDirection: 'row', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderTopWidth: 1, borderTopColor: theme.border },
  tierHeaderRow: { borderTopWidth: 0, backgroundColor: theme.cardElevated },
  tierHeaderText: { fontFamily: FONT.semibold, color: theme.muted, fontSize: FS.xs, textTransform: 'uppercase', letterSpacing: 0.4 },
  tierCell: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text },
  tierPrice: { fontFamily: FONT.bold, textAlign: 'right' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chip: { paddingHorizontal: SP.sm, paddingVertical: SP.xs, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.cardGlass },
  chipText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.text },
  footer: { padding: SP.md, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.background },
});
