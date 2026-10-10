/**
 * "Complete the fit" — the seller-curated rail under a product page.
 *
 * Self-contained: fetches its own data (GET /api/product-pairings/public/:id,
 * works signed out) and renders nothing when the seller hasn't paired
 * anything. Cards follow the circular "+" quick-add rail used by Blue Apron /
 * Yami product pages (Mobbin). "+" adds through the same local-first cart the
 * product page uses (services/cartService.addToCart); a product with more than
 * one purchasable variant opens a small variant picker first.
 *
 * Bundle pricing is intentionally NOT shown here: checkout does not apply
 * bundle prices today, so a "save $X" row would be a promise the cart breaks.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { BottomSheet } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useApi, type PublicPairedProduct } from '@/lib/api';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { getPreviewBuyerProduct, getPreviewRelatedProducts, isPreviewProductId } from '@/lib/previewProducts';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { addToCart } from '@/services/cartService';
import type { BuyerProduct, BuyerProductVariant } from '@/services/cartTypes';

interface RailItem {
  id: string;
  name: string;
  image: string | null;
  priceCents: number;
  product: BuyerProduct | null; // null when sold out / nothing to add
}

function toBuyerProduct(p: PublicPairedProduct): BuyerProduct {
  const variants: BuyerProductVariant[] = p.variants.map((v) => ({
    id: v.id,
    title: [v.size, v.color].filter(Boolean).join(' / ') || 'Default',
    optionValues: [],
    priceCents: v.priceCents,
    inventoryQuantity: v.stock,
    isAvailable: p.isPreOrder || v.stock > 0,
    imageUri: p.image ?? undefined,
  }));
  return {
    id: p.id,
    sellerId: p.sellerId,
    sellerName: p.sellerName ?? 'Independent Seller',
    sellerHandle: '',
    name: p.name,
    description: '',
    priceCents: p.priceCents,
    imageUris: p.images,
    category: 'apparel',
    isPreOrder: p.isPreOrder,
    cancellationPolicy: '',
    refundPolicy: '',
    options: [],
    variants,
    isActive: true,
    tags: [],
  };
}

function fromApi(rows: PublicPairedProduct[]): RailItem[] {
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    image: p.image,
    priceCents: p.priceCents,
    product: p.available ? toBuyerProduct(p) : null,
  }));
}

function demoItems(productId: string): RailItem[] {
  return getPreviewRelatedProducts(productId, 4).map((p) => {
    const bp = getPreviewBuyerProduct(p.id);
    return {
      id: p.id,
      name: p.name,
      image: p.images?.[0] ?? null,
      priceCents: p.priceCents,
      product: bp && bp.variants.some((v) => v.isAvailable) ? bp : null,
    };
  });
}

export function CompleteTheFit({ productId }: { productId: string }) {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const [items, setItems] = useState<RailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addedId, setAddedId] = useState<string | null>(null);
  const [picking, setPicking] = useState<RailItem | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (isPreviewProductId(productId)) {
      // Preview catalog ids never exist on the server: demo data only when asked for.
      setItems(isPreviewDemoMode() ? demoItems(productId) : []);
      setLoading(false);
      return () => { cancelled = true; };
    }
    api.productPairings.publicList(productId)
      .then((rows) => { if (!cancelled) setItems(Array.isArray(rows) ? fromApi(rows) : []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId, api]);

  const add = useCallback(async (item: RailItem, variant: BuyerProductVariant) => {
    if (!item.product) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const result = await addToCart({ product: item.product, variant, quantity: 1 });
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setMessage(null);
      setAddedId(item.id);
      setTimeout(() => setAddedId((cur) => (cur === item.id ? null : cur)), 2000);
    } else {
      setMessage(result.message ?? 'Could not add to bag.');
    }
  }, []);

  const onQuickAdd = useCallback((item: RailItem) => {
    const buyable = item.product?.variants.filter((v) => v.isAvailable) ?? [];
    if (buyable.length === 0) return;
    if (buyable.length === 1) { void add(item, buyable[0]); return; }
    setPicking(item);
  }, [add]);

  const s = useMemo(() => makeStyles(colors), [colors]);

  if (loading) return null;
  if (items.length === 0) return null;

  const pickVariants = picking?.product?.variants.filter((v) => v.isAvailable) ?? [];

  return (
    <View testID="complete-the-fit">
      <View style={s.divider} />
      <Text style={s.header} accessibilityRole="header">Complete the fit</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -SP.md }}
        contentContainerStyle={{ paddingHorizontal: SP.md, gap: SP.md }}
      >
        {items.map((item) => {
          const added = addedId === item.id;
          return (
            <View key={item.id} style={s.card}>
              <TouchableOpacity
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`View ${item.name}`}
                onPress={() => router.push({ pathname: '/buyer-product-detail' as any, params: { productId: item.id } })}
              >
                <View style={s.thumb}>
                  {item.image ? (
                    <CachedImage source={{ uri: item.image }} style={{ width: '100%', height: '100%' }} contentFit="cover" recyclingKey={item.image} />
                  ) : (
                    <View style={s.thumbEmpty}><Icon name="image" size={24} color={colors.mutedForeground} /></View>
                  )}
                </View>
              </TouchableOpacity>
              {item.product ? (
                <TouchableOpacity
                  style={[s.addBtn, added && s.addBtnDone]}
                  onPress={() => onQuickAdd(item)}
                  accessibilityRole="button"
                  accessibilityLabel={added ? `${item.name} added to bag` : `Add ${item.name} to bag`}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Icon name={added ? 'check' : 'plus'} size={16} color={added ? colors.primaryForeground : colors.foreground} />
                </TouchableOpacity>
              ) : null}
              <Text style={s.name} numberOfLines={2}>{item.name}</Text>
              <Text style={s.price}>{item.product ? formatCents(item.priceCents) : 'Sold out'}</Text>
            </View>
          );
        })}
      </ScrollView>
      {message ? <Text style={s.error}>{message}</Text> : null}

      <BottomSheet visible={!!picking} onClose={() => setPicking(null)}>
        <View style={{ padding: SP.md }}>
          <Text style={s.sheetTitle}>{picking?.name}</Text>
          {pickVariants.map((v) => (
            <TouchableOpacity
              key={v.id}
              style={s.variantRow}
              accessibilityRole="button"
              accessibilityLabel={`Add ${v.title}`}
              onPress={() => { const target = picking; setPicking(null); if (target) void add(target, v); }}
            >
              <Text style={s.variantTitle}>{v.title}</Text>
              <Text style={s.variantPrice}>{formatCents(v.priceCents)}</Text>
            </TouchableOpacity>
          ))}
          {pickVariants.length === 0 ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      </BottomSheet>
    </View>
  );
}

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  divider: { height: 1, backgroundColor: c.border, marginVertical: SP.md },
  header: { fontSize: FS.sm, fontFamily: FONT.semibold, color: c.mutedForeground, marginBottom: SP.sm },
  card: { width: 140 },
  thumb: { width: 140, height: 180, backgroundColor: c.card, borderRadius: RADIUS.md, overflow: 'hidden', marginBottom: SP.sm },
  thumbEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  addBtn: {
    position: 'absolute', top: 180 - 36 - 8 + 0, right: 8,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: c.background, borderWidth: 1, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center',
  },
  addBtnDone: { backgroundColor: c.primary, borderColor: c.primary },
  name: { fontSize: FS.sm, fontFamily: FONT.semibold, color: c.foreground, lineHeight: 18, minHeight: 36 },
  price: { fontSize: FS.sm, fontFamily: FONT.bold, color: c.foreground, marginTop: 2 },
  error: { fontSize: FS.sm, fontFamily: FONT.medium, color: c.mutedForeground, marginTop: SP.sm },
  sheetTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: c.foreground, marginBottom: SP.sm },
  variantRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  variantTitle: { fontSize: FS.base, fontFamily: FONT.medium, color: c.foreground },
  variantPrice: { fontSize: FS.base, fontFamily: FONT.semibold, color: c.foreground },
});
