/**
 * "Buy the set" — a seller bundle holding this product, on the product page.
 *
 * Layout copies Amazon's "Frequently bought together" block 1:1, reskinned:
 * thumbnails joined by "+", "Total price" with the items' price struck
 * through, one "Add all N to Bag" button, then the included items, each with
 * a check.
 *
 * Self-contained: fetches GET /api/bundles/public/product/:id (public, works
 * signed out) and renders nothing when there is no bundle. The prices shown
 * are what checkout charges: the server takes the difference off when the
 * whole set is in the bag (api-server lib/bundles), so the saving shows in
 * checkout's totals. "Add all" goes through the same local-first cart as the
 * page (services/cartService.addToCart). An item the seller didn't pin to one
 * variant, with more than one in stock, asks for its size first, in the same
 * picker sheet as Complete the fit.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { CachedImage } from '@/components/CachedImage';
import { BottomSheet } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { useApi, type PublicProductBundle } from '@/lib/api';
import { isPreviewDemoMode } from '@/lib/devPreview';
import { getPreviewBuyerProduct, isPreviewProductId } from '@/lib/previewProducts';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { addToCart } from '@/services/cartService';
import type { BuyerProduct, BuyerProductVariant } from '@/services/cartTypes';

interface OfferItem {
  productId: string;
  name: string;
  image: string | null;
  priceCents: number;
  quantity: number;
  product: BuyerProduct;
  /** Variants this item can be bought as (one when pinned). */
  choices: BuyerProductVariant[];
}

interface Offer {
  id: string;
  name: string;
  bundlePriceCents: number;
  itemsTotalCents: number;
  items: OfferItem[];
}

function fromApi(b: PublicProductBundle): Offer {
  return {
    id: b.id,
    name: b.name,
    bundlePriceCents: b.bundlePriceCents,
    itemsTotalCents: b.itemsTotalCents,
    items: b.items.map((item) => {
      const variants: BuyerProductVariant[] = item.variants.map((v) => ({
        id: v.id,
        title: [v.size, v.color].filter(Boolean).join(' / ') || 'Default',
        optionValues: [],
        priceCents: v.priceCents,
        inventoryQuantity: v.stock,
        isAvailable: item.isPreOrder || v.stock >= item.quantity,
        imageUri: item.image ?? undefined,
      }));
      const product: BuyerProduct = {
        id: item.productId,
        sellerId: b.sellerId,
        sellerName: 'Independent Seller',
        sellerHandle: '',
        name: item.name,
        description: '',
        priceCents: item.priceCents,
        imageUris: item.image ? [item.image] : [],
        category: 'apparel',
        isPreOrder: item.isPreOrder,
        cancellationPolicy: '',
        refundPolicy: '',
        options: [],
        variants,
        isActive: true,
        tags: [],
      };
      return {
        productId: item.productId, name: item.name, image: item.image, priceCents: item.priceCents,
        quantity: item.quantity, product, choices: variants.filter((v) => v.isAvailable),
      };
    }),
  };
}

/** &demo=1 preview only: a coat + boots set from the seeded catalog. */
function demoOffer(productId: string): Offer | null {
  const ids = ['preview-product-01', 'preview-product-11'];
  if (!ids.includes(productId)) return null;
  const products = [productId, ...ids.filter((id) => id !== productId)].map(getPreviewBuyerProduct);
  if (products.some((p) => !p)) return null;
  const items = (products as BuyerProduct[]).map((p) => ({
    productId: p.id, name: p.name, image: p.imageUris[0] ?? null, priceCents: p.priceCents,
    quantity: 1, product: p, choices: p.variants.filter((v) => v.isAvailable),
  }));
  const itemsTotalCents = items.reduce((sum, i) => sum + i.priceCents, 0);
  return { id: 'preview-bundle-01', name: 'The coat and boots', bundlePriceCents: itemsTotalCents - 6000, itemsTotalCents, items };
}

export function BundleOffer({ productId }: { productId: string }) {
  const colors = useColors();
  const api = useApi();
  const router = useRouter();
  const [offer, setOffer] = useState<Offer | null>(null);
  // Items still waiting for a size, and the sizes picked so far.
  const [queue, setQueue] = useState<OfferItem[]>([]);
  const [picked, setPicked] = useState<Record<string, BuyerProductVariant>>({});
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOffer(null);
    if (isPreviewProductId(productId)) {
      // Preview catalog ids never exist on the server: demo data only when asked for.
      setOffer(isPreviewDemoMode() ? demoOffer(productId) : null);
      return () => { cancelled = true; };
    }
    api.bundles.forProduct(productId)
      .then((rows) => {
        if (cancelled) return;
        const offers = (Array.isArray(rows) ? rows : []).map(fromApi)
          .filter((o) => o.items.length > 0 && o.items.every((i) => i.choices.length > 0));
        setOffer(offers[0] ?? null);
      })
      .catch(() => { if (!cancelled) setOffer(null); });
    return () => { cancelled = true; };
  }, [productId, api]);

  const addAll = useCallback(async (target: Offer, choices: Record<string, BuyerProductVariant>) => {
    setBusy(true);
    setMessage(null);
    for (const item of target.items) {
      const variant = choices[item.productId] ?? item.choices[0];
      const result = await addToCart({ product: item.product, variant, quantity: item.quantity });
      if (!result.success) {
        setBusy(false);
        setMessage(result.message ?? `Could not add ${item.name} to bag.`);
        return;
      }
    }
    setBusy(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  }, []);

  const onAddAll = useCallback(() => {
    if (!offer || busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const needSize = offer.items.filter((i) => i.choices.length > 1);
    setPicked({});
    if (needSize.length === 0) { void addAll(offer, {}); return; }
    setQueue(needSize);
  }, [offer, busy, addAll]);

  const onPick = useCallback((variant: BuyerProductVariant) => {
    if (!offer) return;
    const [current, ...rest] = queue;
    if (!current) return;
    const next = { ...picked, [current.productId]: variant };
    setPicked(next);
    setQueue(rest);
    if (rest.length === 0) void addAll(offer, next);
  }, [offer, queue, picked, addAll]);

  const s = useMemo(() => makeStyles(colors), [colors]);

  if (!offer) return null;
  const count = offer.items.reduce((n, i) => n + i.quantity, 0);
  const picking = queue[0] ?? null;

  return (
    <View testID="bundle-offer">
      <View style={s.divider} />
      <Text style={s.header} accessibilityRole="header">Buy the set</Text>

      <View style={s.thumbRow}>
        {offer.items.map((item, index) => (
          <React.Fragment key={item.productId}>
            {index > 0 ? <Feather name="plus" size={16} color={colors.mutedForeground} /> : null}
            <TouchableOpacity
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`View ${item.name}`}
              disabled={item.productId === productId}
              onPress={() => router.push({ pathname: '/buyer-product-detail' as any, params: { productId: item.productId } })}
              style={s.thumb}
            >
              {item.image ? (
                <CachedImage source={{ uri: item.image }} style={{ width: '100%', height: '100%' }} contentFit="cover" recyclingKey={item.image} />
              ) : (
                <View style={s.thumbEmpty}><Feather name="image" size={20} color={colors.mutedForeground} /></View>
              )}
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>

      <Text style={s.totalLine}>
        <Text style={s.totalLabel}>Total price: </Text>
        <Text style={s.totalPrice}>{formatCents(offer.bundlePriceCents)}</Text>
        {'  '}
        <Text style={s.compare}>{formatCents(offer.itemsTotalCents)}</Text>
      </Text>

      <TouchableOpacity
        style={[s.button, added && s.buttonDone]}
        onPress={onAddAll}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={added ? `Added all ${count} to bag` : `Add all ${count} to bag`}
      >
        {busy ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <View style={s.buttonInner}>
            {added ? <Feather name="check" size={16} color={colors.primaryForeground} /> : null}
            <Text style={s.buttonText}>{added ? `Added all ${count} to Bag` : `Add all ${count} to Bag`}</Text>
          </View>
        )}
      </TouchableOpacity>
      {message ? <Text style={s.error}>{message}</Text> : null}

      <View style={{ marginTop: SP.sm }}>
        {offer.items.map((item) => (
          <View key={item.productId} style={s.itemRow}>
            <Feather name="check-square" size={16} color={colors.foreground} />
            <Text style={s.itemName} numberOfLines={2}>
              {item.productId === productId ? <Text style={s.thisItem}>This item: </Text> : null}
              {item.quantity > 1 ? `${item.quantity} × ` : ''}{item.name}
            </Text>
            <Text style={s.itemPrice}>{formatCents(item.priceCents * item.quantity)}</Text>
          </View>
        ))}
      </View>

      <BottomSheet visible={!!picking} onClose={() => setQueue([])}>
        <View style={{ padding: SP.md }}>
          <Text style={s.sheetTitle}>{picking?.name}</Text>
          {picking?.choices.map((v) => (
            <TouchableOpacity
              key={v.id}
              style={s.variantRow}
              accessibilityRole="button"
              accessibilityLabel={`Choose ${v.title}`}
              onPress={() => onPick(v)}
            >
              <Text style={s.variantTitle}>{v.title}</Text>
              <Text style={s.variantPrice}>{formatCents(v.priceCents)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </BottomSheet>
    </View>
  );
}

const THUMB = 88;

const makeStyles = (c: ReturnType<typeof useColors>) => StyleSheet.create({
  divider: { height: 1, backgroundColor: c.border, marginVertical: SP.md },
  header: { fontSize: FS.sm, fontFamily: FONT.semibold, color: c.mutedForeground, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  thumbRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SP.sm },
  thumb: { width: THUMB, height: THUMB, backgroundColor: c.card, borderRadius: RADIUS.md, overflow: 'hidden' },
  thumbEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  totalLine: { marginTop: SP.md },
  totalLabel: { fontSize: FS.base, fontFamily: FONT.medium, color: c.foreground },
  totalPrice: { fontSize: FS.base, fontFamily: FONT.bold, color: c.foreground },
  compare: { fontSize: FS.sm, fontFamily: FONT.medium, color: c.mutedForeground, textDecorationLine: 'line-through' },
  button: {
    marginTop: SP.sm, minHeight: 44, borderRadius: RADIUS.md,
    backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md,
  },
  buttonDone: { backgroundColor: c.foreground },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  buttonText: { fontSize: FS.base, fontFamily: FONT.semibold, color: c.primaryForeground },
  error: { fontSize: FS.sm, fontFamily: FONT.medium, color: c.mutedForeground, marginTop: SP.sm },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs },
  itemName: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: c.foreground },
  thisItem: { fontFamily: FONT.semibold },
  itemPrice: { fontSize: FS.sm, fontFamily: FONT.semibold, color: c.foreground },
  sheetTitle: { fontSize: FS.lg, fontFamily: FONT.bold, color: c.foreground, marginBottom: SP.sm },
  variantRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border,
  },
  variantTitle: { fontSize: FS.base, fontFamily: FONT.medium, color: c.foreground },
  variantPrice: { fontSize: FS.base, fontFamily: FONT.semibold, color: c.foreground },
});
