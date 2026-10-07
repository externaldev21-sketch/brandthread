/**
 * "Bundle & save" — the product page's bundle offer.
 *
 * Self-contained: fetches the active bundles that include this product
 * (GET /api/bundles/public/by-product/:id, public, works signed out) and
 * renders nothing when there are none. Layout follows the "frequently bought
 * together" pattern (Amazon / Yami product pages on Mobbin): thumbnails
 * joined by "+", the bundle price against the items' own total, the saving,
 * and one "Add bundle" action. A bundle whose items need a size opens the
 * bundle screen to choose; otherwise every item goes in the bag at once.
 * Checkout applies the bundle price server-side (lib/money/bundlePricing.ts).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { Button } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useApi, type PublicBundle } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { isPreviewProductId } from '@/lib/previewProducts';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { addBundleToCart } from '@/services/cartService';

export function bundleHref(bundleId: string): string {
  return `/bundle-detail?bundleId=${encodeURIComponent(bundleId)}`;
}

export function BundleSaveSection({ productId, dividerStyle, headerStyle, onAdded }: {
  productId: string;
  dividerStyle?: object;
  headerStyle?: object;
  /** Called after a bundle went into the bag (e.g. to bump the cart badge). */
  onAdded?: () => void;
}) {
  const api = useApi();
  const [bundles, setBundles] = useState<PublicBundle[]>([]);

  useEffect(() => {
    let cancelled = false;
    setBundles([]);
    if (!productId || isPreviewProductId(productId)) return () => { cancelled = true; };
    api.bundles.publicByProduct(productId)
      .then((rows) => { if (!cancelled) setBundles(Array.isArray(rows) ? rows.slice(0, 2) : []); })
      .catch(() => { if (!cancelled) setBundles([]); });
    return () => { cancelled = true; };
  }, [api, productId]);

  if (bundles.length === 0) return null;
  return (
    <View testID="product-bundle-section">
      <View style={dividerStyle} />
      <Text style={headerStyle} accessibilityRole="header">Bundle & save</Text>
      <View style={{ gap: SP.md }}>
        {bundles.map((bundle) => <BundleOfferCard key={bundle.id} bundle={bundle} onAdded={onAdded} />)}
      </View>
    </View>
  );
}

export function BundleOfferCard({ bundle, onAdded }: { bundle: PublicBundle; onAdded?: () => void }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const st = useMemo(() => makeStyles(theme), [theme]);
  const [state, setState] = useState<'idle' | 'adding' | 'added'>('idle');
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(bundleHref(bundle.id) as never);
  };

  const add = async () => {
    if (bundle.needsSelection) { open(); return; }
    setError(null);
    setState('adding');
    try {
      const result = await addBundleToCart(bundle, {});
      if (!result.success) {
        setError(result.message ?? 'This bundle can’t be added right now.');
        setState('idle');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setState('added');
      onAdded?.();
      setTimeout(() => setState('idle'), 2200);
    } catch {
      setError('This bundle can’t be added right now.');
      setState('idle');
    }
  };

  return (
    <View style={st.card} testID={`bundle-offer-${bundle.id}`}>
      <TouchableOpacity activeOpacity={0.85} onPress={open} accessibilityRole="button" accessibilityLabel={`View bundle ${bundle.name}`}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.thumbs}>
          {bundle.items.map((item, index) => (
            <View key={item.id} style={st.thumbRow}>
              {index > 0 ? <Feather name="plus" size={14} color={theme.muted} style={st.plus} /> : null}
              <View style={st.thumbCol}>
                <View style={st.thumb}>
                  {item.image ? (
                    <CachedImage source={{ uri: item.image }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={item.image} />
                  ) : (
                    <Feather name="image" size={18} color={theme.muted} />
                  )}
                  {item.quantity > 1 ? (
                    <View style={st.qtyBadge}><Text style={st.qtyText}>×{item.quantity}</Text></View>
                  ) : null}
                </View>
                <Text style={st.thumbName} numberOfLines={1}>{item.productName}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <Text style={st.name} numberOfLines={1}>{bundle.name}</Text>
        <View style={st.priceRow}>
          <Text style={st.price}>{formatCents(bundle.bundlePriceCents)}</Text>
          <Text style={st.was}>{formatCents(bundle.itemsTotalCents)}</Text>
          <View style={st.saveChip}>
            <Text style={st.saveText}>Save {formatCents(bundle.savingsCents)}</Text>
          </View>
        </View>
      </TouchableOpacity>
      {error ? <Text style={st.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button
        label={state === 'added' ? 'Added to bag' : bundle.needsSelection ? 'Choose sizes' : 'Add bundle'}
        icon={state === 'added' ? 'check' : 'shopping-bag'}
        onPress={() => void add()}
        loading={state === 'adding'}
        disabled={state === 'adding'}
        variant="secondary"
        fullWidth
        accessibilityHint={bundle.needsSelection ? 'Opens the bundle to choose sizes' : `Adds all ${bundle.items.length} items at the bundle price`}
        style={{ marginTop: SP.md }}
        testID={`bundle-add-${bundle.id}`}
      />
    </View>
  );
}

const THUMB = 64;

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  card: { borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.md, padding: SP.md, backgroundColor: theme.card },
  thumbs: { alignItems: 'flex-start', paddingBottom: SP.sm },
  thumbRow: { flexDirection: 'row', alignItems: 'flex-start' },
  plus: { marginHorizontal: SP.xs, marginTop: THUMB * 1.25 / 2 - 7 },
  thumbCol: { width: THUMB },
  thumb: {
    width: THUMB, height: THUMB * 1.25, borderRadius: RADIUS.sm, overflow: 'hidden',
    backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center',
  },
  qtyBadge: { position: 'absolute', right: 4, bottom: 4, borderRadius: RADIUS.pill, paddingHorizontal: 6, paddingVertical: 1, backgroundColor: theme.background },
  qtyText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: theme.text },
  thumbName: { fontFamily: FONT.medium, fontSize: FS.meta, color: theme.muted, marginTop: 4 },
  name: { fontFamily: FONT.semibold, fontSize: FS.base, color: theme.text, marginTop: SP.xs },
  priceRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SP.sm, marginTop: 4 },
  price: { fontFamily: FONT.bold, fontSize: FS.base, color: theme.text },
  was: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.subtle, textDecorationLine: 'line-through' },
  saveChip: { borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 2 },
  saveText: { fontFamily: FONT.semibold, fontSize: FS.meta, color: theme.text },
  error: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.muted, marginTop: SP.sm },
});

export default BundleSaveSection;
