/**
 * Bundle detail — a seller's product bundle, as a buyer buys it.
 *
 * Route: /bundle-detail?bundleId=<uuid>  (pushed from the product page's
 * "Bundle & save" card and the storefront's Bundles row)
 *
 * Lists every item of the bundle with its own price, lets the buyer pick a
 * size where the seller left it open (Blue Apron's "Choose your servings ·
 * Required" groups on Mobbin, reskinned), and adds the whole bundle to the
 * bag from a sticky footer ("Add — $x", same reference). Every item becomes
 * its own cart line tagged with the bundle; checkout applies the bundle
 * price server-side (api-server lib/money/bundlePricing.ts).
 *
 * Public data only (GET /api/bundles/public/bundle/:id), so it works signed
 * out and in the web preview.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CachedImage } from '@/components/CachedImage';
import { StickyFooter } from '@/components/layout';
import { Button, Chip, ErrorState } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi, type PublicBundle, type PublicBundleItem } from '@/lib/api';
import { bundleSelectionTotals, missingBundleSelections, resolveBundleVariant, variantLabel } from '@/lib/bundleCart';
import { formatCents } from '@/lib/money';
import { profileHref } from '@/lib/profileNavigation';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { addBundleToCart } from '@/services/cartService';

export default function BundleDetailScreen() {
  const { bundleId } = useLocalSearchParams<{ bundleId?: string }>();
  const router = useRouter();
  const api = useApi();
  const { theme } = useAppTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);

  const [bundle, setBundle] = useState<PublicBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selections, setSelections] = useState<Record<string, string | undefined>>({});
  const [touched, setTouched] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!bundleId) { setFailed(true); setLoading(false); return; }
    setLoading(true);
    setFailed(false);
    try {
      setBundle(await api.bundles.publicGet(String(bundleId)));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [api, bundleId]);

  useEffect(() => { void load(); }, [load]);

  const totals = bundle ? bundleSelectionTotals(bundle, selections) : null;
  const missing = bundle ? missingBundleSelections(bundle, selections) : [];

  const select = (item: PublicBundleItem, variantId: string) => {
    Haptics.selectionAsync();
    setAdded(false);
    setSelections((prev) => ({ ...prev, [item.id]: variantId }));
  };

  const add = async () => {
    if (!bundle) return;
    if (added) { router.push('/(buyer)/cart' as never); return; }
    setTouched(true);
    if (missing.length > 0) {
      setError(`Choose a size for ${missing[0].productName}.`);
      return;
    }
    setError(null);
    setAdding(true);
    try {
      const result = await addBundleToCart(bundle, selections);
      if (!result.success) { setError(result.message ?? 'This bundle can’t be added right now.'); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdded(true);
    } catch {
      setError('This bundle can’t be added right now.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <View style={st.root}>
      <ScreenHeader title="Bundle" />
      {loading ? null : failed || !bundle ? (
        <ErrorState
          message="This bundle isn’t available right now."
          onRetry={() => void load()}
          retryLabel="Try again"
          style={{ flex: 1 }}
        />
      ) : (
        <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={st.content} showsVerticalScrollIndicator={false} testID="bundle-detail-scroll">
            <Text style={st.title}>{bundle.name}</Text>
            {bundle.sellerName ? (
              <TouchableOpacity
                onPress={() => router.push(profileHref({ userId: bundle.sellerId, accountType: 'seller' }) as never)}
                accessibilityRole="link"
                accessibilityLabel={`View seller ${bundle.sellerName}`}
              >
                <Text style={st.seller}>{bundle.sellerName}</Text>
              </TouchableOpacity>
            ) : null}
            <View style={st.priceRow}>
              <Text style={st.price}>{formatCents(totals!.priceCents)}</Text>
              <Text style={st.was}>{formatCents(totals!.itemsCents)}</Text>
              {totals!.savingsCents > 0 ? (
                <View style={st.saveChip}><Text style={st.saveText}>Save {formatCents(totals!.savingsCents)}</Text></View>
              ) : null}
            </View>
            {bundle.description?.trim() ? <Text style={st.description}>{bundle.description.trim()}</Text> : null}

            <Text style={st.sectionLabel}>
              {`In this bundle · ${bundle.items.reduce((n, i) => n + i.quantity, 0)} items`}
            </Text>
            {bundle.items.map((item, index) => {
              const chosen = resolveBundleVariant(item, selections);
              const needsChoice = !item.variantId && item.variants.length > 1;
              const unanswered = touched && needsChoice && !selections[item.id];
              return (
                <View key={item.id} style={[st.item, index > 0 && st.itemDivider]} testID={`bundle-item-${item.id}`}>
                  <TouchableOpacity
                    style={st.itemRow}
                    activeOpacity={0.8}
                    onPress={() => router.push({ pathname: '/buyer-product-detail' as never, params: { productId: item.productId } } as never)}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${item.productName}`}
                  >
                    <View style={st.thumb}>
                      {item.image ? (
                        <CachedImage source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.image} />
                      ) : (
                        <Feather name="image" size={20} color={theme.muted} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={st.itemName} numberOfLines={2}>{item.productName}</Text>
                      <Text style={st.itemMeta}>
                        {[
                          item.quantity > 1 ? `${item.quantity} ×` : null,
                          formatCents(chosen?.priceCents ?? item.priceCents),
                          !needsChoice && chosen ? variantLabel(chosen) : null,
                        ].filter(Boolean).join(' ')}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color={theme.muted} />
                  </TouchableOpacity>
                  {needsChoice ? (
                    <View style={st.choice}>
                      <View style={st.choiceHeader}>
                        <Text style={st.choiceLabel}>Choose size</Text>
                        <Text style={[st.required, unanswered && { color: theme.text }]}>Required</Text>
                      </View>
                      <View style={st.chips}>
                        {item.variants.map((variant) => (
                          <Chip
                            key={variant.id}
                            label={variantLabel(variant)}
                            selected={selections[item.id] === variant.id}
                            onPress={() => select(item, variant.id)}
                            testID={`bundle-variant-${variant.id}`}
                          />
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          <StickyFooter>
            {error ? <Text style={st.error} accessibilityLiveRegion="polite">{error}</Text> : null}
            <Button
              label={added ? 'In your bag · View bag' : `Add bundle — ${formatCents(totals!.priceCents)}`}
              icon={added ? 'check' : 'shopping-bag'}
              onPress={() => void add()}
              loading={adding}
              disabled={adding}
              fullWidth
              testID="bundle-add"
            />
          </StickyFooter>
        </>
      )}
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },
  content: { paddingHorizontal: SP.md, paddingBottom: SP.xl },
  title: { fontFamily: FONT.bold, fontSize: FS.xl, color: theme.text, marginTop: SP.sm },
  seller: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted, marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.sm },
  price: { fontFamily: FONT.bold, fontSize: FS.lg, color: theme.text },
  was: { fontFamily: FONT.medium, fontSize: FS.base, color: theme.subtle, textDecorationLine: 'line-through' },
  saveChip: { borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 2 },
  saveText: { fontFamily: FONT.semibold, fontSize: FS.meta, color: theme.text },
  description: { fontFamily: FONT.regular, fontSize: FS.base, lineHeight: 22, color: theme.muted, marginTop: SP.md },
  sectionLabel: {
    fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.muted, textTransform: 'uppercase', letterSpacing: 0.4,
    marginTop: SP.lg, marginBottom: SP.sm,
  },
  item: { paddingVertical: SP.md },
  itemDivider: { borderTopWidth: 1, borderTopColor: theme.borderSubtle },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  thumb: {
    width: 72, height: 90, borderRadius: RADIUS.sm, overflow: 'hidden', backgroundColor: theme.cardElevated,
    alignItems: 'center', justifyContent: 'center',
  },
  itemName: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text },
  itemMeta: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted, marginTop: 4 },
  choice: { marginTop: SP.md },
  choiceHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: SP.sm },
  choiceLabel: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, textTransform: 'uppercase', letterSpacing: 0.4 },
  required: { fontFamily: FONT.medium, fontSize: FS.meta, color: theme.subtle },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  error: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted, marginBottom: SP.sm, textAlign: 'center' },
});
