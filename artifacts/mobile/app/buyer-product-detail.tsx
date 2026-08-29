/**
 * Brandthread Buyer Product Detail
 * Variant selection, add to cart, buy now.
 */
import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image, RefreshControl,
  Animated, Dimensions, PanResponder,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { formatCents } from '@/lib/money';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  addToCart, createBuyNowSession, replaceCartItemVariant,
  getCart,
} from '@/services/cartService';
import { BuyerProduct, BuyerProductOption, BuyerProductVariant, CheckoutAttribution } from '@/services/cartTypes';
import { useApi } from '@/hooks/useApi';
import { invalidateSellerPaymentStatusCache } from '@/lib/api';
import { useAuth } from '@clerk/expo';
import {
  BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE, ON_DARK,
  SUCCESS, SUCCESS_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  GOLD,
  GRAD_SUCCESS_G,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';

function useChrome() {
  const colors = useColors();
  const { theme } = useAppTheme();
  return {
    theme, PURPLE: colors.primary, PURPLE_LIGHT: theme.accentLight, PURPLE_DIM: colors.accent,
    CYAN: theme.secondary, CYAN_DIM: theme.secondaryDim,
    BORDER_ACTIVE: `${theme.accent}73`, BORDER_FOCUS: `${theme.secondary}80`,
    GRAD_PRIMARY: theme.primaryGradient,
    SHADOW_PURPLE: { shadowColor: theme.shadowColor, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  };
}

// ─── API → BuyerProduct adapter ───────────────────────────────────────────────
// Converts a raw row from GET /api/public/products/:id to the BuyerProduct
// shape expected by addToCart. Variant UUIDs from the DB are preserved so the
// checkout server can look them up correctly.

function adaptApiProductToBuyerProduct(row: any): BuyerProduct {
  const apiVariants: any[] = row.variants ?? [];

  // Derive options from unique size / color values across all variants
  const sizes  = [...new Set<string>(apiVariants.map((v: any) => v.size).filter(Boolean))] as string[];
  const colors = [...new Set<string>(apiVariants.map((v: any) => v.color).filter(Boolean))] as string[];

  const options: BuyerProductOption[] = [];
  if (sizes.length  > 0) options.push({ id: 'opt_size',  name: 'Size',  values: sizes.map (s => ({ id: `size_${s}`,  label: s })) });
  if (colors.length > 0) options.push({ id: 'opt_color', name: 'Color', values: colors.map(c => ({ id: `color_${c}`, label: c })) });

  const firstImage: string | undefined = (row.images ?? [])[0];

  const variants: BuyerProductVariant[] = apiVariants.map((v: any) => {
    const ovs: { optionId: string; valueId: string }[] = [];
    if (v.size)  ovs.push({ optionId: 'opt_size',  valueId: `size_${v.size}`  });
    if (v.color) ovs.push({ optionId: 'opt_color', valueId: `color_${v.color}` });
    return {
      id:                v.id,
      title:             [v.size, v.color].filter(Boolean).join(' / ') || 'Default',
      optionValues:      ovs,
      priceCents:        v.priceCents ?? 0,
      inventoryQuantity: v.stock ?? 0,
      isAvailable:       (v.stock ?? 0) > 0,
      imageUri:          firstImage,
    };
  });

  const lowestPrice = variants.length > 0 ? Math.min(...variants.map(v => v.priceCents)) : 0;

  return {
    id:                 row.id,
    sellerId:           row.ownerId,
    sellerName:         row.sellerDisplayName ?? 'Independent Seller',
    sellerHandle:       '',
    name:               row.name,
    description:        row.description ?? '',
    priceCents:         lowestPrice,
    imageUris:          row.images ?? [],
    category:           row.category ?? 'apparel',
    isPreOrder:           row.isPreOrder           ?? false,
    preOrderClosingDate:  row.preOrderClosingDate ? new Date(row.preOrderClosingDate).toISOString() : undefined,
    preOrderEstShipDate:  row.preOrderEstShipDate ? new Date(row.preOrderEstShipDate).toISOString() : undefined,
    cancellationPolicy:   'All sales final. Returns accepted only for damaged or incorrect items.',
    refundPolicy:       'Contact the seller within 7 days of delivery to start a return.',
    options,
    variants,
    isActive:           true,
    tags:               row.tags ?? [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPrice = formatCents;
const GALLERY_WIDTH = Dimensions.get('window').width;
const GALLERY_HEIGHT = Math.min(520, Math.max(430, GALLERY_WIDTH * 1.22));

function renderStars(rating: number): string {
  const full = Math.round(Math.max(0, Math.min(5, rating)));
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function findVariant(product: BuyerProduct, selections: Record<string, string>): BuyerProductVariant | null {
  const optionIds = product.options.map(o => o.id);
  if (Object.keys(selections).length < optionIds.length) return null;
  return product.variants.find(v =>
    optionIds.every(optId => {
      const valueId = selections[optId];
      return v.optionValues.some(ov => ov.optionId === optId && ov.valueId === valueId);
    })
  ) ?? null;
}

function isVariantComboAvailable(
  product: BuyerProduct,
  optionId: string,
  valueId: string,
  otherSelections: Record<string, string>,
): boolean {
  const candidate = { ...otherSelections, [optionId]: valueId };
  const filledOptionIds = Object.keys(candidate);
  return product.variants.some(v =>
    v.isAvailable &&
    filledOptionIds.every(oid => v.optionValues.some(ov => ov.optionId === oid && ov.valueId === candidate[oid]))
  );
}

function ZoomableGalleryImage({ uri }: { uri: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const currentScale = useRef(1);
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const [zoomed, setZoomed] = useState(false);

  const distance = (touches: readonly any[]) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const resetZoom = () => {
    currentScale.current = 1;
    setZoomed(false);
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
  };

  const responder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: event => event.nativeEvent.touches.length === 2,
    onMoveShouldSetPanResponderCapture: event => event.nativeEvent.touches.length === 2,
    onPanResponderGrant: event => {
      pinchStartDistance.current = distance(event.nativeEvent.touches);
      pinchStartScale.current = currentScale.current;
    },
    onPanResponderMove: event => {
      const nextDistance = distance(event.nativeEvent.touches);
      if (!pinchStartDistance.current || !nextDistance) return;
      const nextScale = Math.max(1, Math.min(3.5, pinchStartScale.current * nextDistance / pinchStartDistance.current));
      currentScale.current = nextScale;
      scale.setValue(nextScale);
    },
    onPanResponderRelease: () => {
      if (currentScale.current < 1.06) resetZoom();
      else setZoomed(true);
    },
    onPanResponderTerminate: () => {
      if (currentScale.current < 1.06) resetZoom();
    },
  })).current;

  return (
    <View style={{ width: GALLERY_WIDTH, height: GALLERY_HEIGHT, overflow: 'hidden' }} {...responder.panHandlers}>
      <Animated.Image
        source={{ uri }}
        style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]}
        resizeMode="cover"
        accessibilityLabel="Product photo. Pinch with two fingers to zoom."
      />
      {zoomed && (
        <TouchableOpacity style={galleryStyles.resetZoom} onPress={resetZoom} accessibilityRole="button">
          <Feather name="minimize-2" size={14} color={ON_DARK} />
          <Text style={galleryStyles.resetZoomText}>Reset</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const galleryStyles = StyleSheet.create({
  gallery: { width: GALLERY_WIDTH, height: GALLERY_HEIGHT, backgroundColor: CARD, position: 'relative' },
  galleryEmpty: { alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  emptyText: { color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm },
  galleryShade: {
    position: 'absolute', left: 0, right: 0, bottom: 0, height: 96,
    backgroundColor: 'rgba(0,0,0,0.17)',
  },
  galleryMeta: {
    position: 'absolute', left: SP.md, bottom: SP.md, flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: 'rgba(0,0,0,0.58)',
  },
  galleryMetaText: { color: ON_DARK, fontFamily: FONT.medium, fontSize: FS.xs },
  dots: { position: 'absolute', bottom: 21, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  dot: { height: 6, borderRadius: 3, backgroundColor: ON_DARK },
  resetZoom: {
    position: 'absolute', right: SP.md, bottom: 56, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: 'rgba(0,0,0,0.65)',
  },
  resetZoomText: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.xs },
});

function ProductGallery({ imageUris }: { imageUris: string[] }) {
  const images = imageUris.filter(Boolean);
  const scrollX = useRef(new Animated.Value(0)).current;

  if (!images.length) {
    return (
      <View style={[galleryStyles.gallery, galleryStyles.galleryEmpty]}>
        <Feather name="image" size={ICON.xxl} color={MUTED} />
        <Text style={galleryStyles.emptyText}>Product image unavailable</Text>
      </View>
    );
  }

  return (
    <View style={galleryStyles.gallery}>
      <Animated.FlatList
        data={images}
        keyExtractor={(uri, index) => `${uri}-${index}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => <ZoomableGalleryImage uri={item} />}
        getItemLayout={(_, index) => ({ length: GALLERY_WIDTH, offset: GALLERY_WIDTH * index, index })}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
      />
      <View style={galleryStyles.galleryShade} pointerEvents="none" />
      <View style={galleryStyles.galleryMeta} pointerEvents="none">
        <Feather name="maximize-2" size={13} color={ON_DARK} />
        <Text style={galleryStyles.galleryMetaText}>Pinch to zoom</Text>
      </View>
      {images.length > 1 && (
        <View style={galleryStyles.dots} pointerEvents="none">
          {images.map((_, index) => {
            const width = scrollX.interpolate({
              inputRange: [(index - 1) * GALLERY_WIDTH, index * GALLERY_WIDTH, (index + 1) * GALLERY_WIDTH],
              outputRange: [6, 22, 6],
              extrapolate: 'clamp',
            });
            const opacity = scrollX.interpolate({
              inputRange: [(index - 1) * GALLERY_WIDTH, index * GALLERY_WIDTH, (index + 1) * GALLERY_WIDTH],
              outputRange: [0.45, 1, 0.45],
              extrapolate: 'clamp',
            });
            return <Animated.View key={index} style={[galleryStyles.dot, { width, opacity }]} />;
          })}
        </View>
      )}
    </View>
  );
}

// ─── Option Picker ────────────────────────────────────────────────────────────

function OptionPicker({ product, option, selections, onSelect }: {
  product: BuyerProduct;
  option: BuyerProduct['options'][0];
  selections: Record<string, string>;
  onSelect: (optionId: string, valueId: string) => void;
}) {
  const { theme } = useAppTheme();
  const op = makeOptionStyles(theme);
  const isColor = option.name.toLowerCase() === 'color';
  return (
    <View style={op.root}>
      <View style={op.labelRow}>
        <Text style={op.optionName}>{option.name}</Text>
        {selections[option.id] && (
          <Text style={op.selectedLabel}>
            {option.values.find(v => v.id === selections[option.id])?.label}
          </Text>
        )}
      </View>
      <View style={op.chips}>
        {option.values.map(val => {
          const isSelected = selections[option.id] === val.id;
          const { [option.id]: _ignored, ...rest } = selections;
          const available = isVariantComboAvailable(product, option.id, val.id, rest);

          if (isColor && val.colorHex) {
            return (
              <TouchableOpacity
                key={val.id}
                style={[
                  op.colorSwatch,
                  isSelected && op.colorSwatchSelected,
                  !available && op.unavail,
                ]}
                onPress={() => { if (available) { Haptics.selectionAsync(); onSelect(option.id, val.id); } }}
                activeOpacity={0.8}
              >
                <View style={[op.colorDot, { backgroundColor: val.colorHex }]} />
                {!available && <View style={op.slashOverlay}><Text style={op.slash}>✕</Text></View>}
              </TouchableOpacity>
            );
          }

          return (
            <TouchableOpacity
              key={val.id}
              style={[
                op.chip,
                isSelected && op.chipSelected,
                !available && op.chipUnavail,
              ]}
              onPress={() => { if (available) { Haptics.selectionAsync(); onSelect(option.id, val.id); } }}
              activeOpacity={0.8}
              disabled={!available}
            >
              <Text style={[op.chipText, isSelected && op.chipTextSelected, !available && op.chipTextUnavail]}>
                {val.label}
              </Text>
              {!available && <View style={op.unavailLine} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const makeOptionStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = theme.accentDim;
  return StyleSheet.create({
  root: { marginBottom: SP.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
  optionName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  selectedLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: PURPLE_LIGHT },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD_ELEVATED, minWidth: 44, alignItems: 'center',
    overflow: 'hidden',
  },
  chipSelected: { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  chipUnavail: { opacity: 0.45 },
  chipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  chipTextSelected: { color: PURPLE_LIGHT },
  chipTextUnavail: { textDecorationLine: 'line-through' },
  unavailLine: { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: RED },
  colorSwatch: {
    width: 40, height: 40, borderRadius: RADIUS.sm,
    borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchSelected: { borderColor: PURPLE },
  colorDot: { width: 28, height: 28, borderRadius: RADIUS.xs },
  unavail: { opacity: 0.4 },
  slashOverlay: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  slash: { fontSize: 18, color: RED, fontFamily: FONT.bold },
  });
};

// ─── Quantity Selector ────────────────────────────────────────────────────────

function QtySelector({ qty, max, onDec, onInc }: { qty: number; max: number; onDec: () => void; onInc: () => void }) {
  return (
    <View style={qs.root}>
      <Text style={qs.label}>Qty</Text>
      <View style={qs.ctrl}>
        <TouchableOpacity style={qs.btn} onPress={onDec} disabled={qty <= 1} activeOpacity={0.7}>
          <Feather name="minus" size={15} color={qty <= 1 ? SUBTLE : FG} />
        </TouchableOpacity>
        <Text style={qs.val}>{qty}</Text>
        <TouchableOpacity style={qs.btn} onPress={onInc} disabled={qty >= max} activeOpacity={0.7}>
          <Feather name="plus" size={15} color={qty >= max ? SUBTLE : FG} />
        </TouchableOpacity>
      </View>
      {max <= 5 && <Text style={qs.stock}>{max} left</Text>}
    </View>
  );
}
const qs = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  label: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  ctrl: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.sm },
  btn: { paddingVertical: 8, paddingHorizontal: 6 },
  val: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, minWidth: 24, textAlign: 'center' },
  stock: { fontSize: FS.xs, fontFamily: FONT.medium, color: ORANGE },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerProductDetailScreen() {
  const { theme, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM, BORDER_ACTIVE, BORDER_FOCUS, GRAD_PRIMARY, SHADOW_PURPLE } = useChrome();
  const s = makeStyles(theme);
  const wl = makeWaitlistStyles(theme);
  const { productId, sourcePostId, sourceTagId, editVariantId, editCartItemId } = useLocalSearchParams<{
    productId?: string;
    sourcePostId?: string;
    sourceTagId?: string;
    editVariantId?: string;
    editCartItemId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api    = useApi();
  const { isSignedIn } = useAuth();

  const [product, setProduct] = useState<BuyerProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [addingToCart, setAddingToCart] = useState(false);
  const [buyingNow, setBuyingNow] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [sellerPaymentReady, setSellerPaymentReady] = useState<boolean | null>(null);
  const [sellerPaymentReason, setSellerPaymentReason] = useState<string | null>(null);
  const [sellerVacationMessage, setSellerVacationMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [productReviews, setProductReviews] = useState<any[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  // Waitlist & pre-order reservation state
  const [waitlistJoined,  setWaitlistJoined]  = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [reserved,        setReserved]        = useState(false);
  const [reserveLoading,  setReserveLoading]  = useState(false);
  const [sizeChartOpen,   setSizeChartOpen]   = useState(false);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setSellerPaymentReady(null);
    setSellerPaymentReason(null);

    (async () => {
      try {
        let prod: BuyerProduct | null = null;
        let paymentStatus: { ready: boolean; reason?: string } | null = null;

        if (productId) {
          // Load the live product from the public API.
          // DB product UUIDs from the discover feed carry real variant IDs
          // so the checkout server can look them up correctly.
          try {
            const row = await api.publicProducts.get(productId);
            if (row && !row.error) {
              setSellerVacationMessage(
                row.sellerVacationMode
                  ? row.sellerVacationMessage ?? 'This seller is currently away and is not accepting purchases.'
                  : null,
              );
              // Adapt the product and check payment readiness together as soon
              // as the product supplies the seller ID. A payment-status failure
              // is non-fatal: Buy Now performs its own safety check on tap.
              [prod, paymentStatus] = await Promise.all([
                Promise.resolve(adaptApiProductToBuyerProduct(row)),
                row.ownerId && isSignedIn
                  ? api.buyer.sellerPaymentStatus(row.ownerId).catch(() => null)
                  : Promise.resolve(null),
              ]);
            }
          } catch { /* API unavailable — product will show as not found */ }
        }
        // productName-only navigation is not supported; all entry points
        // must supply a productId so real variant data is loaded.

        if (!cancelled) {
          setProduct(prod);
          if (paymentStatus) {
            setSellerPaymentReady(paymentStatus.ready);
            setSellerPaymentReason(paymentStatus.reason ?? null);
          }
        }
      } catch {}
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [productId]);

  useEffect(() => {
    if (!product || !editVariantId) return;
    const cartVariant = product.variants.find(candidate => candidate.id === editVariantId);
    if (!cartVariant) return;
    setSelections(Object.fromEntries(cartVariant.optionValues.map(value => [value.optionId, value.valueId])));
  }, [product, editVariantId]);

  useEffect(() => {
    if (!product?.id) return;
    api.reviews.forProduct(product.id)
      .then((data: any) => {
        setProductReviews(data.reviews ?? []);
        setAvgRating(data.avgRating ?? 0);
        setReviewCount(data.totalCount ?? 0);
      })
      .catch(() => {});
  }, [product?.id]);

  async function handleRefresh() {
    if (!product?.sellerId) return;
    setRefreshing(true);
    if (isSignedIn) invalidateSellerPaymentStatusCache(product.sellerId);
    try {
      if (isSignedIn) {
        const status = await api.buyer.sellerPaymentStatus(product.sellerId);
        setSellerPaymentReady(status.ready);
        setSellerPaymentReason(status.reason ?? null);
      }
    } catch {
      // Keep the existing readiness state visible if a manual refresh loses
      // connectivity; Buy Now still performs its own check before checkout.
    } finally {
      setRefreshing(false);
    }
  }

  // Check waitlist status when selected variant changes
  useEffect(() => {
    if (!product || !isSignedIn) return;
    const v = findVariant(product, selections);
    if (!v?.id || v.isAvailable) { setWaitlistJoined(false); return; }
    (api as any).waitlist?.check?.(v.id)
      ?.then((d: any) => setWaitlistJoined(d?.joined ?? false))
      ?.catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, JSON.stringify(selections), isSignedIn]);

  // Check reservation status for pre-order products
  useEffect(() => {
    if (!product?.id || !product.isPreOrder || !isSignedIn) { setReserved(false); return; }
    (api as any).buyer?.checkReservation?.(product.id)
      ?.then((d: any) => setReserved(d?.reserved ?? false))
      ?.catch(() => {});
  }, [product?.id, product?.isPreOrder, isSignedIn]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
        <Feather name="alert-circle" size={ICON.xxl} color={MUTED} />
        <Text style={{ color: MUTED, marginTop: SP.md, fontFamily: FONT.regular, textAlign: 'center' }}>
          Product not found or no longer available.
        </Text>
        <TouchableOpacity style={{ marginTop: SP.md }} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.semibold }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const variant = findVariant(product, selections);
  const variantPrice = variant?.priceCents ?? product.priceCents;
  const variantCompare = variant?.compareAtPriceCents ?? product.compareAtPriceCents;
  const hasDiscount = variantCompare && variantCompare > variantPrice;
  const savingsAmt = hasDiscount ? variantCompare! - variantPrice : 0;
  const allSelected = product.options.length > 0 && Object.keys(selections).length === product.options.length;
  const inStock = variant ? variant.isAvailable && variant.inventoryQuantity > 0 : true;
  const maxQty = variant ? Math.max(1, variant.inventoryQuantity) : 10;
  const paymentUnavailable = sellerPaymentReady === false;

  function handleSelect(optionId: string, valueId: string) {
    setSelections(prev => {
      const updated = { ...prev, [optionId]: valueId };
      // Reset qty if max changed
      const newVariant = findVariant(product!, updated);
      if (newVariant && qty > newVariant.inventoryQuantity) setQty(1);
      return updated;
    });
    setAddedToCart(false);
  }

  const attribution: CheckoutAttribution = {
    sourcePostId: sourcePostId,
    sourceTagId: sourceTagId,
    channel: sourcePostId ? 'thread' : 'discover',
  };

  async function handleJoinWaitlist() {
    if (!product || !variant) return;
    if (!isSignedIn) {
      router.replace('/sign-in' as never);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setWaitlistLoading(true);
    try {
      await (api as any).waitlist.join(product.id, variant.id);
      setWaitlistJoined(true);
      Alert.alert("You're on the waitlist", "We'll notify you the moment this drops back in stock.");
    } catch { Alert.alert('Error', 'Could not join waitlist. Please try again.'); }
    finally { setWaitlistLoading(false); }
  }

  async function handleReserve() {
    if (!product) return;
    if (!isSignedIn) {
      router.replace('/sign-in' as never);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReserveLoading(true);
    try {
      await (api as any).buyer.reserve(product.id);
      setReserved(true);
      Alert.alert('Reserved!', "Spot secured. We'll notify you once production is confirmed.");
    } catch { Alert.alert('Error', 'Could not reserve. Please try again.'); }
    finally { setReserveLoading(false); }
  }

  async function handleAddToCart() {
    if (!allSelected) {
      Alert.alert('Select Options', 'Please select all options before adding to cart.');
      return;
    }
    if (!variant) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAddingToCart(true);
    const result = editCartItemId
      ? await replaceCartItemVariant(editCartItemId, product!, variant, qty)
      : await addToCart({ product: product!, variant, quantity: qty, attribution });
    setAddingToCart(false);
    if (result.success) {
      setAddedToCart(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Alert.alert('Cannot Add to Cart', result.message ?? 'Please try again.');
    }
  }

  async function handleBuyNow() {
    if (sellerVacationMessage) {
      Alert.alert('Seller is away', sellerVacationMessage);
      return;
    }
    if (!allSelected) {
      Alert.alert('Select Options', 'Please select all options before continuing.');
      return;
    }
    if (!variant) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBuyingNow(true);
    try {
      // Check seller payment readiness before entering checkout
      const sellerId = product!.sellerId;
      if (sellerId && isSignedIn) {
        try {
          const status = await api.buyer.sellerPaymentStatus(sellerId);
          if (!status.ready) {
            Alert.alert(
              'Payments Unavailable',
              status.reason ?? 'This seller can\'t accept payments right now. Please try again later.',
              [{ text: 'OK' }],
            );
            setBuyingNow(false);
            return;
          }
        } catch {
          Alert.alert('Unable to verify payments', 'We could not confirm this seller can accept payments. Check your connection and try again.');
          setBuyingNow(false);
          return;
        }
      }

      const cart = await getCart();
      await createBuyNowSession(product!, variant, qty, cart);
      router.push('/buyer-checkout?source=buynow' as never);
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
    setBuyingNow(false);
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={PURPLE}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 144 }}
      >
        {/* Immersive product gallery */}
        <View style={s.imageArea}>
          <ProductGallery imageUris={product.imageUris} />
          {/* Back button */}
          <TouchableOpacity style={[s.backBtn, { top: insets.top + SP.sm }]} onPress={() => router.back()} activeOpacity={0.8}>
            <Feather name="chevron-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          {/* Cart button */}
          <TouchableOpacity
            style={[s.cartBtn, { top: insets.top + SP.sm }]}
            onPress={() => router.push('/(buyer)/cart' as never)}
            activeOpacity={0.8}
          >
            <Feather name="shopping-bag" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>

        <View style={s.body}>
          {/* Badges */}
          <View style={s.badgeRow}>
            {product.isPreOrder && (
              <View style={s.preOrderBadge}>
                <Feather name="clock" size={12} color={CYAN} />
                <Text style={s.preOrderBadgeText}>PRE-ORDER</Text>
              </View>
            )}
            {hasDiscount && (
              <View style={s.saleBadge}>
                <Text style={s.saleBadgeText}>SALE</Text>
              </View>
            )}
          </View>

          {/* Title & Seller */}
          <Text style={s.productName}>{product.name}</Text>
          <TouchableOpacity style={s.sellerRow} onPress={() => router.push(('/seller-profile?id=' + product.sellerId) as never)} activeOpacity={0.7}>
            <View style={s.sellerAvatar}><Text style={s.sellerInitial}>{product.sellerName.charAt(0)}</Text></View>
            <Text style={s.sellerName}>{product.sellerName}</Text>
            <Text style={s.sellerHandle}>{product.sellerHandle}</Text>
            <Feather name="chevron-right" size={14} color={MUTED} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push(('/ip-report?listingId=' + encodeURIComponent(product.id)) as never)}
            accessibilityRole="button"
            accessibilityLabel="Report intellectual property infringement"
            style={{ alignSelf: 'flex-start', marginBottom: SP.md }}
          >
            <Text style={{ color: MUTED, fontFamily: FONT.medium, fontSize: FS.xs, textDecorationLine: 'underline' }}>Report intellectual property infringement</Text>
          </TouchableOpacity>
           {paymentUnavailable && (
             <View style={s.paymentWarningBanner} accessibilityRole="alert">
               <Feather name="alert-triangle" size={ICON.xs} color={ORANGE} />
               <View style={s.paymentWarningCopy}>
                 <Text style={s.paymentWarningTitle}>Payments unavailable</Text>
                 <Text style={s.paymentWarningText}>
                   {sellerPaymentReason ?? "This seller can't accept payments right now."} You can still add this item to your cart.
                 </Text>
               </View>
             </View>
           )}
          {sellerVacationMessage && (
            <View style={s.vacationBanner} accessibilityRole="alert">
              <Feather name="sun" size={ICON.sm} color={ORANGE} />
              <View style={{ flex: 1 }}>
                <Text style={s.vacationTitle}>Seller is away</Text>
                <Text style={s.vacationText}>{sellerVacationMessage}</Text>
              </View>
            </View>
          )}

          {/* Price */}
          <View style={s.priceRow}>
            <Text style={[s.price, hasDiscount ? s.priceSale : undefined]}>{formatCents(variantPrice)}</Text>
            {hasDiscount && <Text style={s.comparePrice}>{fmtPrice(variantCompare!)}</Text>}
            {hasDiscount && <Text style={s.savings}>Save {fmtPrice(savingsAmt)}</Text>}
          </View>

          {/* Pre-order info */}
          {product.isPreOrder && (
            <View style={s.preOrderCard}>
              <View style={s.preOrderRow}>
                <Feather name="clock" size={ICON.sm} color={CYAN} />
                <Text style={s.preOrderTitle}>Pre-Order Item</Text>
              </View>
              {product.preOrderClosingDate && (
                <Text style={s.preOrderDetail}>
                  Pre-order closes: {new Date(product.preOrderClosingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </Text>
              )}
              {product.preOrderEstShipDate && (
                <Text style={s.preOrderDetail}>
                  Est. ship date: {new Date(product.preOrderEstShipDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </Text>
              )}
              <Text style={s.preOrderDisclaimer}>
                Production and ship dates are estimates and may change. You will be notified of any updates.
              </Text>
            </View>
          )}

          {/* Divider */}
          <View style={s.divider} />

          {/* Options */}
          {product.options.map(option => (
            <OptionPicker
              key={option.id}
              product={product}
              option={option}
              selections={selections}
              onSelect={handleSelect}
            />
          ))}

          {/* Stock status */}
          {allSelected && variant && (
            <View style={s.stockRow}>
              <View style={[s.stockDot, { backgroundColor: variant.isAvailable ? SUCCESS : RED }]} />
              <Text style={[s.stockText, { color: variant.isAvailable ? SUCCESS : RED }]}>
                {variant.isAvailable
                  ? variant.inventoryQuantity <= 5
                    ? `Only ${variant.inventoryQuantity} left in stock`
                    : 'In stock'
                  : 'Out of stock — select another option'
                }
              </Text>
            </View>
          )}

          {/* Waitlist — shown when selected variant is OOS and not pre-order */}
          {allSelected && variant && !variant.isAvailable && !product.isPreOrder && (
            <TouchableOpacity
              style={[wl.btn, waitlistJoined && wl.joined]}
              onPress={waitlistJoined ? undefined : handleJoinWaitlist}
              disabled={waitlistLoading || waitlistJoined}
              activeOpacity={0.8}
            >
              {waitlistLoading ? (
                <ActivityIndicator size="small" color={PURPLE_LIGHT} />
              ) : (
                <>
                  <Feather name={waitlistJoined ? 'check' : 'bell'} size={14} color={waitlistJoined ? SUCCESS : PURPLE_LIGHT} />
                  <Text style={[wl.text, waitlistJoined && { color: SUCCESS }]}>
                    {waitlistJoined ? "You're on the waitlist" : 'Notify me when back in stock'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Quantity */}
          {allSelected && inStock && (
            <View style={{ marginVertical: SP.md }}>
              <QtySelector
                qty={qty}
                max={maxQty}
                onDec={() => setQty(q => Math.max(1, q - 1))}
                onInc={() => setQty(q => Math.min(maxQty, q + 1))}
              />
            </View>
          )}

          {/* Description */}
          <View style={s.divider} />
          <Text style={s.descTitle}>About this piece</Text>
          <Text style={s.desc}>{product.description}</Text>

          {/* Policies */}
          <View style={s.divider} />
          <PolicyRow icon="refresh-ccw" label="Returns" value={product.refundPolicy} />
          <PolicyRow icon="x-circle" label="Cancellation" value={product.cancellationPolicy} />

          {/* Size Chart — expandable table */}
          {!!(product as any).sizeChart && (
            <>
              <View style={s.divider} />
              <TouchableOpacity
                style={sz.toggle}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSizeChartOpen(o => !o); }}
                activeOpacity={0.7}
              >
                <Text style={sz.label}>Size Chart</Text>
                <Feather name={sizeChartOpen ? 'chevron-up' : 'chevron-down'} size={16} color={MUTED} />
              </TouchableOpacity>
              {sizeChartOpen && <SizeChartViewer chart={(product as any).sizeChart} />}
            </>
          )}

          {/* Reviews */}
          <View style={s.divider} />
          <Text style={s.reviewsHeader}>Customer Reviews</Text>
          {reviewCount === 0 ? (
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, marginBottom: SP.md }}>
              No reviews yet
            </Text>
          ) : (
            <>
              <View style={s.ratingRow}>
                <Text style={s.ratingAvg}>{avgRating.toFixed(1)}</Text>
                <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: GOLD }}>
                  {renderStars(avgRating)}
                </Text>
                <Text style={s.ratingCount}>({reviewCount} review{reviewCount !== 1 ? 's' : ''})</Text>
              </View>
              {productReviews.slice(0, 5).map((r: any) => (
                <View key={r.id} style={s.reviewRow}>
                  <Text style={s.reviewStars}>{renderStars(r.rating)}</Text>
                  {r.body ? <Text style={s.reviewBody}>{r.body}</Text> : null}
                  <Text style={s.reviewDate}>
                    {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
              ))}
            </>
          )}

          {/* Related Products */}
          <View style={s.divider} />
          <Text style={s.reviewsHeader}>You Might Also Like</Text>
          <RelatedProducts productId={product.id} />

        </View>
      </ScrollView>

      {/* Persistent purchase bar remains visible while product content scrolls. */}
      <View
        style={[s.actionBar, { paddingBottom: insets.bottom + SP.sm }]}
        accessibilityRole="toolbar"
        accessibilityLabel="Product purchase actions"
      >
        {addedToCart ? (
          <TouchableOpacity
            style={s.viewCartBtn}
            onPress={() => router.push('/(buyer)/cart' as never)}
            activeOpacity={0.85}
          >
            <LinearGradient colors={[...GRAD_SUCCESS_G]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionGrad}>
              <Feather name="shopping-bag" size={18} color={ON_DARK} />
              <Text style={s.actionBtnText}>View Cart</Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.addToCartBtn, (!allSelected || !inStock) && s.btnDisabled]}
            onPress={handleAddToCart}
            activeOpacity={0.85}
            disabled={addingToCart || !inStock}
          >
            {addingToCart ? (
              <ActivityIndicator color={PURPLE_LIGHT} size="small" />
            ) : (
              <>
                <Feather name="shopping-bag" size={18} color={allSelected && inStock ? PURPLE_LIGHT : SUBTLE} />
                <Text style={[s.addToCartText, (!allSelected || !inStock) && { color: SUBTLE }]}>
                  {!allSelected ? 'Select Options' : !inStock ? 'Out of Stock' : 'Add to Cart'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {product.isPreOrder ? (
          <TouchableOpacity
            style={s.buyNowBtn}
            onPress={handleReserve}
            disabled={reserveLoading || reserved}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={reserved ? [CARD_ELEVATED, CARD_ELEVATED] : [PURPLE_DIM, PURPLE_DIM]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[s.actionGrad, { borderWidth: 1, borderColor: reserved ? SUCCESS + '44' : PURPLE + '44' }]}
            >
              {reserveLoading ? (
                <ActivityIndicator color={PURPLE_LIGHT} size="small" />
              ) : (
                <Text style={[s.actionBtnText, { color: reserved ? SUCCESS : PURPLE_LIGHT }]}>
                  {reserved ? 'Reserved ✓' : 'Reserve (No Charge)'}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.buyNowBtn, (!allSelected || !inStock || paymentUnavailable) && s.btnDisabled]}
            onPress={handleBuyNow}
            activeOpacity={0.85}
            disabled={buyingNow || !inStock || !allSelected || paymentUnavailable}
            accessibilityLabel={paymentUnavailable ? 'Payments unavailable' : !allSelected ? 'Select options' : !inStock ? 'Out of stock' : 'Buy now'}
            accessibilityState={{ disabled: buyingNow || !inStock || !allSelected || paymentUnavailable }}
          >
            <LinearGradient
              colors={allSelected && inStock && !paymentUnavailable ? [...GRAD_PRIMARY] : [CARD_ELEVATED, CARD_ELEVATED]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={s.actionGrad}
            >
              {buyingNow ? (
                <ActivityIndicator color={ON_DARK} size="small" />
              ) : (
                <Text style={[s.actionBtnText, (!allSelected || !inStock || paymentUnavailable) && { color: SUBTLE }]}>
                  {paymentUnavailable ? 'Payments unavailable' : !allSelected ? 'Select Options' : !inStock ? 'Out of Stock' : 'Buy Now'}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Size Chart Viewer ────────────────────────────────────────────────────────

interface SizeChart { columns: string[]; rows: { size: string; values: string[] }[]; unit?: string; notes?: string }

function SizeChartViewer({ chart }: { chart: SizeChart }) {
  const { theme } = useAppTheme();
  const sch = makeSizeChartStyles(theme);
  if (!chart?.columns?.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: SP.sm }}>
      <View>
        <View style={sch.row}>
          <View style={[sch.cell, sch.sizeCell, sch.headerCell]}>
            <Text style={sch.headerText}>Size</Text>
          </View>
          {chart.columns.map((col, i) => (
            <View key={i} style={[sch.cell, sch.headerCell]}>
              <Text style={sch.headerText}>{col}{chart.unit ? ` (${chart.unit})` : ''}</Text>
            </View>
          ))}
        </View>
        {(chart.rows ?? []).map((row, ri) => (
          <View key={ri} style={[sch.row, ri % 2 === 0 && sch.altRow]}>
            <View style={[sch.cell, sch.sizeCell]}>
              <Text style={sch.sizeText}>{row.size}</Text>
            </View>
            {row.values.map((v, ci) => (
              <View key={ci} style={sch.cell}>
                <Text style={sch.valueText}>{v || '—'}</Text>
              </View>
            ))}
          </View>
        ))}
        {chart.notes ? <Text style={sch.notes}>{chart.notes}</Text> : null}
      </View>
    </ScrollView>
  );
}

function RelatedProducts({ productId }: { productId: string }) {
  const { theme } = useAppTheme();
  const api = useApi();
  const router = useRouter();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.publicProducts.related(productId, 5)
      .then((data) => {
        if (!cancelled) {
          setProducts(data.filter((p: any) => p.id !== productId).slice(0, 4));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) { setError(true); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [productId, api, router]);

  if (loading) {
    return (
      <View style={{ paddingVertical: SP.xl, alignItems: 'center' }}>
        <ActivityIndicator color={theme.accent} size="small" />
      </View>
    );
  }

  if (error || products.length === 0) {
    return (
      <View style={{ paddingVertical: SP.md }}>
        <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE }}>
          {error ? 'Unable to load related products.' : 'No related products found.'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.md }} contentContainerStyle={{ paddingHorizontal: SP.md, gap: SP.md }}>
      {products.map((p) => {
        let lowestPriceCents = 0;
        if (p.variants && p.variants.length > 0) {
          lowestPriceCents = p.variants.reduce((min: number, v: any) => Math.min(min, v.priceCents ?? 0), p.variants[0].priceCents ?? 0);
        } else if (p.priceCents) {
          lowestPriceCents = p.priceCents;
        }

        return (
          <TouchableOpacity
            key={p.id}
            style={{ width: 140 }}
            activeOpacity={0.8}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push({ pathname: '/buyer-product-detail' as any, params: { productId: p.id } });
            }}
          >
            <View style={{ width: 140, height: 180, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md, overflow: 'hidden', marginBottom: SP.sm }}>
              {(p.images && p.images[0]) ? (
                <Image source={{ uri: p.images[0] }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="image" size={24} color={MUTED} />
                </View>
              )}
            </View>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG }} numberOfLines={1}>{p.name}</Text>
            <Text style={{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 }} numberOfLines={1}>
              {p.sellerDisplayName || 'Independent Seller'}
            </Text>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.bold, color: FG, marginTop: 4 }}>{formatCents(lowestPriceCents)}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const makeSizeChartStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE_DIM = theme.accentDim, PURPLE_LIGHT = theme.accentLight;
  return StyleSheet.create({
  row:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER },
  altRow:     { backgroundColor: CARD_ELEVATED },
  cell:       { width: 72, paddingVertical: 8, paddingHorizontal: 4, justifyContent: 'center' },
  sizeCell:   { width: 52 },
  headerCell: { backgroundColor: PURPLE_DIM },
  headerText: { fontFamily: FONT.semibold, fontSize: 10, color: PURPLE_LIGHT, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.4 },
  sizeText:   { fontFamily: FONT.semibold, fontSize: FS.xs, color: FG, textAlign: 'center' },
  valueText:  { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, textAlign: 'center' },
  notes:      { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, marginTop: SP.sm, lineHeight: 17 },
  });
};

// ─────────────────────────────────────────────────────────────────────────────

function PolicyRow({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  return (
    <View style={pr.root}>
      <Feather name={icon} size={14} color={MUTED} />
      <View style={{ flex: 1 }}>
        <Text style={pr.label}>{label}</Text>
        <Text style={pr.value}>{value}</Text>
      </View>
    </View>
  );
}
const pr = StyleSheet.create({
  root: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.md },
  label: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  value: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 2, lineHeight: 17 },
});

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM, BORDER_ACTIVE, BORDER_FOCUS, SHADOW_PURPLE } = {
    PURPLE: theme.accent, PURPLE_LIGHT: theme.accentLight, PURPLE_DIM: theme.accentDim, CYAN: theme.secondary, CYAN_DIM: theme.secondaryDim,
    BORDER_ACTIVE: `${theme.accent}73`, BORDER_FOCUS: `${theme.secondary}80`,
    SHADOW_PURPLE: { shadowColor: theme.shadowColor, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  };
  return StyleSheet.create({
  imageArea: { height: GALLERY_HEIGHT, backgroundColor: CARD, position: 'relative' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  imagePlaceholderText: { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', paddingHorizontal: SP.lg },
  backBtn: {
    position: 'absolute', left: SP.md, width: 40, height: 40,
    borderRadius: RADIUS.pill, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  cartBtn: {
    position: 'absolute', right: SP.md, width: 40, height: 40,
    borderRadius: RADIUS.pill, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  body: { padding: SP.md },
  badgeRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.sm },
  preOrderBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CYAN_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  preOrderBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: CYAN, letterSpacing: 0.4 },
  saleBadge: { backgroundColor: RED_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  saleBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: RED, letterSpacing: 0.4 },
  productName: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, marginBottom: SP.sm, lineHeight: 28 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginBottom: SP.md },
  sellerAvatar: { width: 24, height: 24, borderRadius: RADIUS.pill, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  sellerInitial: { fontSize: FS.xs, fontFamily: FONT.bold, color: PURPLE_LIGHT },
  sellerName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  sellerHandle: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  paymentWarningBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SP.xs,
    marginBottom: SP.md,
    backgroundColor: ORANGE_DIM,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: ORANGE + '44',
    paddingHorizontal: SP.sm,
    paddingVertical: SP.sm,
  },
  paymentWarningCopy: { flex: 1, gap: 2 },
  paymentWarningTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: ORANGE },
  paymentWarningText: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 17 },
  vacationBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
    borderWidth: 1, borderColor: `${ORANGE}66`, backgroundColor: `${ORANGE}12`,
    borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md,
  },
  vacationTitle: { color: ORANGE, fontFamily: FONT.bold, fontSize: FS.sm, marginBottom: 3 },
  vacationText: { color: FG, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  price: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  priceSale: { color: SUCCESS },
  comparePrice: { fontSize: FS.base, fontFamily: FONT.regular, color: SUBTLE, textDecorationLine: 'line-through' },
  savings: { fontSize: FS.sm, fontFamily: FONT.semibold, color: SUCCESS },
  preOrderCard: { backgroundColor: CYAN_DIM, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: `${CYAN}40`, marginBottom: SP.md, gap: 4 },
  preOrderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  preOrderTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: CYAN },
  preOrderDetail: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  preOrderDisclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 4, lineHeight: 17 },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.md },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm },
  stockDot: { width: 8, height: 8, borderRadius: 4 },
  stockText: { fontSize: FS.sm, fontFamily: FONT.medium },
  descTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  desc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 22 },
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.md,
    backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER,
  },
  addToCartBtn: {
    flex: 1, height: COMP.buttonH, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
  },
  addToCartText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  buyNowBtn: { flex: 1, borderRadius: RADIUS.md, overflow: 'hidden' },
  viewCartBtn: { flex: 2, borderRadius: RADIUS.md, overflow: 'hidden' },
  actionGrad: { height: COMP.buttonH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  actionBtnText: { fontSize: FS.sm, fontFamily: FONT.bold, color: ON_DARK },
  btnDisabled: { opacity: 0.5 },
  reviewsHeader: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  reviewRow: { marginBottom: SP.md, paddingBottom: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  reviewStars: { fontSize: FS.sm, fontFamily: FONT.regular, color: GOLD, marginBottom: 2 },
  reviewBody: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
  reviewDate: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  ratingAvg: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  ratingCount: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  });
};

// Waitlist button styles
const makeWaitlistStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE_DIM = theme.accentDim, PURPLE_LIGHT = theme.accentLight, BORDER_ACTIVE = `${theme.accent}73`;
  return StyleSheet.create({
  btn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, marginTop: SP.sm, paddingVertical: SP.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  joined: { borderColor: SUCCESS + '44', backgroundColor: 'transparent' },
  text:   { fontFamily: FONT.medium, fontSize: FS.sm, color: PURPLE_LIGHT },
  });
};

// Size chart toggle styles
const sz = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.sm },
  label:  { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
});
