/**
 * "Add to this order" on the order-confirmed screen. Mobbin reference: Wolt
 * Delivery "Add more for less" on its order-placed screen — a section with a
 * live "14:39 left", one line saying the extra rides with the order for no
 * delivery fee, product tiles, and one tap to add.
 *
 * While the server's offer is open (a few minutes after payment, card on
 * file, order not shipped) this takes the place of the "More from {Brand}"
 * row (`fallback`), so the same pieces never show twice. Tapping Add opens a
 * sheet with the size (if there's a choice), the card that will be charged
 * and one button. When the window closes, the fallback row comes back.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { CachedImage } from '@/components/CachedImage';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/hooks/useApi';
import { apiErrorMessage } from '@/lib/safety';
import { isPreviewCatalogEnabled } from '@/lib/previewCatalog';
import { isPreviewSellerId } from '@/lib/previewCheckout';
import { formatCents } from '@/lib/money';
import {
  cardLabel, formatTimeLeft, fromPrice,
  type AddOnOffer, type AddOnProduct, type AddOnVariant,
} from '@/lib/orderAddOn';
import { previewAddOnOffer } from '@/lib/orderAddOnPreview';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { TABULAR_NUMS } from '@/constants/typography';

function newClientKey(): string {
  return `addon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function AddToOrderOffer({ orderId, sellerId, fallback }: {
  orderId: string | null | undefined;
  sellerId: string;
  fallback: React.ReactNode;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [offer, setOffer] = useState<AddOnOffer | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<AddOnProduct | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  // Dev-web preview only: a seeded preview order (lib/previewCheckout.ts, never
  // in production) gets an offer built from the preview catalog.
  const demo = isPreviewSellerId(sellerId) && !!orderId?.startsWith('preview-order-') && isPreviewCatalogEnabled();

  useEffect(() => {
    let alive = true;
    if (!orderId) return;
    if (demo) {
      setOffer(previewAddOnOffer(orderId, sellerId));
      return;
    }
    if (isPreviewSellerId(sellerId)) return;
    api.orderAddOn.get(orderId)
      .then((data) => { if (alive && data?.products?.length) setOffer(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, [api, orderId, sellerId, demo]);

  const expiresMs = offer ? new Date(offer.expiresAt).getTime() : 0;
  const open = !!offer && expiresMs > now;
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);

  if (!offer || !open) return <>{fallback}</>;

  return (
    <View style={styles.section} testID="order-add-on">
      <View style={styles.headRow}>
        <Text style={[styles.heading, { color: theme.muted }]}>Add to this order</Text>
        <Text style={[styles.timeLeft, { color: theme.text }, TABULAR_NUMS]} testID="order-add-on-time-left">
          {formatTimeLeft(expiresMs - now)} left
        </Text>
      </View>
      <Text style={[styles.sub, { color: theme.muted }]}>Ships with your order. No shipping fee.</Text>
      <View style={styles.grid}>
        {offer.products.map((product) => {
          const isAdded = added.has(product.productId);
          return (
            <View key={product.productId} style={styles.tile}>
              <View style={[styles.thumb, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
                {product.imageUrl ? (
                  <CachedImage source={{ uri: product.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <Feather name="image" size={18} color={theme.subtle} />
                )}
              </View>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>{product.name}</Text>
              <Text style={[styles.price, { color: theme.muted }, TABULAR_NUMS]}>{formatCents(fromPrice(product))}</Text>
              <PressableScale
                onPress={() => {
                  if (isAdded) return;
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setPicked(product);
                }}
                style={[styles.addPill, isAdded ? { backgroundColor: 'transparent', borderColor: theme.border } : { backgroundColor: theme.text, borderColor: theme.text }]}
                accessibilityRole="button"
                accessibilityLabel={isAdded ? `${product.name} added` : `Add ${product.name}`}
                disabled={isAdded}
                rippleEnabled={false}
                testID={`order-add-on-add-${product.productId}`}
              >
                {isAdded ? <Feather name="check" size={13} color={theme.text} /> : null}
                <Text style={[styles.addLabel, { color: isAdded ? theme.text : theme.background }]}>{isAdded ? 'Added' : 'Add'}</Text>
              </PressableScale>
            </View>
          );
        })}
      </View>
      <AddSheet
        offer={offer}
        product={picked}
        demo={demo}
        onClose={() => setPicked(null)}
        onAdded={(productId) => {
          setAdded((prev) => new Set(prev).add(productId));
          setPicked(null);
        }}
      />
    </View>
  );
}

function AddSheet({ offer, product, demo, onClose, onAdded }: {
  offer: AddOnOffer;
  product: AddOnProduct | null;
  demo: boolean;
  onClose: () => void;
  onAdded: (productId: string) => void;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [variant, setVariant] = useState<AddOnVariant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per sheet opening, so a double tap or retry never charges twice.
  const clientKey = useRef(newClientKey());

  useEffect(() => {
    setVariant(product && product.variants.length === 1 ? product.variants[0] : null);
    setError(null);
    setBusy(false);
    clientKey.current = newClientKey();
  }, [product]);

  const card = cardLabel(offer.card);

  async function add() {
    if (!product || !variant || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!demo) {
        await api.orderAddOn.add(offer.orderId, {
          productId: product.productId, variantId: variant.variantId, clientKey: clientKey.current,
        });
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onAdded(product.productId);
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(apiErrorMessage(e, "We couldn't add this. You haven't been charged."));
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={!!product} onClose={onClose} testID="order-add-on-sheet">
      {product ? (
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={[styles.sheetThumb, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
              {product.imageUrl ? (
                <CachedImage source={{ uri: product.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sheetName, { color: theme.text }]} numberOfLines={2}>{product.name}</Text>
              <Text style={[styles.sheetPrice, { color: theme.text }, TABULAR_NUMS]}>
                {formatCents(variant?.priceCents ?? fromPrice(product))}
              </Text>
            </View>
          </View>

          {product.variants.length > 1 ? (
            <View style={styles.sizes}>
              {product.variants.map((v) => {
                const on = v.variantId === variant?.variantId;
                return (
                  <PressableScale
                    key={v.variantId}
                    onPress={() => { void Haptics.selectionAsync(); setVariant(v); }}
                    style={[styles.size, { borderColor: on ? theme.text : theme.border, backgroundColor: on ? theme.text : 'transparent' }]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Size ${v.label}`}
                    rippleEnabled={false}
                  >
                    <Text style={[styles.sizeLabel, { color: on ? theme.background : theme.text }]}>{v.label}</Text>
                  </PressableScale>
                );
              })}
            </View>
          ) : null}

          <Text style={[styles.note, { color: theme.muted }]}>
            {card ? `Plus tax. Charged to ${card}. Ships with your order.` : 'Plus tax. Ships with your order.'}
          </Text>
          {error ? <Text style={[styles.error, { color: theme.text }]} testID="order-add-on-error">{error}</Text> : null}
          <Button
            label={variant ? `Add for ${formatCents(variant.priceCents)}` : 'Select a size'}
            onPress={add}
            disabled={!variant || busy}
            loading={busy}
            testID="order-add-on-confirm"
          />
        </View>
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: SP.xs, marginBottom: SP.md },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 2 },
  heading: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 0.9, textTransform: 'uppercase' },
  timeLeft: { fontFamily: FONT.semibold, fontSize: FS.sm },
  sub: { fontFamily: FONT.regular, fontSize: FS.sm, marginBottom: SP.sm + 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm + 4 },
  tile: { width: 96 },
  thumb: { width: 96, height: 128, borderRadius: RADII.chip, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: 6 },
  name: { fontFamily: FONT.medium, fontSize: FS.sm },
  price: { fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: 2 },
  addPill: { marginTop: 6, height: 30, borderRadius: 15, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  addLabel: { fontFamily: FONT.semibold, fontSize: FS.sm },
  sheet: { paddingHorizontal: SP.md, paddingBottom: SP.md, gap: SP.md },
  sheetHead: { flexDirection: 'row', gap: SP.md, alignItems: 'center' },
  sheetThumb: { width: 64, height: 85, borderRadius: RADII.chip, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  sheetName: { fontFamily: FONT.semibold, fontSize: FS.md },
  sheetPrice: { fontFamily: FONT.semibold, fontSize: FS.md, marginTop: 4 },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  size: { minWidth: 52, height: 40, paddingHorizontal: SP.md, borderRadius: RADII.chip, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sizeLabel: { fontFamily: FONT.semibold, fontSize: FS.sm },
  note: { fontFamily: FONT.regular, fontSize: FS.sm },
  error: { fontFamily: FONT.medium, fontSize: FS.sm },
});
