/**
 * Brandthread Buyer Product Detail
 * Variant selection, add to cart, buy now.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, RefreshControl,
  Animated, Dimensions, PanResponder, Easing, AccessibilityInfo,
} from 'react-native';
import { useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { formatCents } from '@/lib/money';
import { useColors } from '@/hooks/useColors';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import {
  addToCart, createBuyNowSession, replaceCartItemVariant,
  getCart,
} from '@/services/cartService';
import { BuyerProduct, BuyerProductOption, BuyerProductVariant, CheckoutAttribution } from '@/services/cartTypes';
import { useApi } from '@/hooks/useApi';
import { invalidateSellerPaymentStatusCache } from '@/lib/api';
import { reportHref } from '@/lib/safety';
import { trackAndRelayConversionEvent } from '@/lib/marketingPixels';
import { useAuth } from '@clerk/expo';
import {
  BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE, ON_DARK,
  SUCCESS, SUCCESS_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  GOLD,
  GRAD_SUCCESS_G,
  FONT, FS, SP, RADIUS, COMP, ICON, TYPE,
} from '@/lib/theme';
import { ResponsiveContainer, StickyFooter } from '@/components/layout';
import { CachedImage } from '@/components/CachedImage';
import { Button, IconButton, Chip, QuantityStepper, BottomSheet, Avatar, SuccessCheck } from '@/components/ui';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { hapticToggle, hapticPrimaryAction, hapticWarning } from '@/lib/haptics';
import { BuyerProtectionNote } from '@/components/BuyerProtectionNote';
import { ProductReviewsSection } from '@/components/ProductReviewsSection';
import { BundleSaveSection } from '@/components/bundles/BundleSaveSection';
import {
  messageSellerAboutProductHref, profileHref, profileVideosHref, resolveStoreVisitSource,
} from '@/lib/profileNavigation';
import { getPreviewBuyerProduct, getPreviewRelatedProducts, isPreviewProductId } from '@/lib/previewProducts';
import { isPreviewSellerId } from '@/lib/previewCheckout';
import { useCartBadgeBump } from '@/hooks/useCartBadgeBump';
import { useMeasuredTarget } from '@/hooks/useMeasuredTarget';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { BUYER_PRODUCT_DETAIL_SPOTLIGHT } from '@/lib/firstRunTips/content';
import {
  CART_FLIGHT_ITEM_SIZE, flightSourceFromRect, getCartFlightVector, measureCartTarget, measureWindowRect,
  shouldAnimateCartSuccess, type CartFlightPoint, type CartFlightSource,
} from '@/lib/cartFlight';

type ThemeAliases = {
  theme: AppThemePreset;
  BG: string; BORDER: string; CARD: string; CARD_ELEVATED: string;
  FG: string; MUTED: string; SUBTLE: string;
  RED: string; RED_DIM: string; SUCCESS: string; SUCCESS_DIM: string;
  ORANGE: string; ORANGE_DIM: string; GOLD: string;
};

function useThemeAliases(): ThemeAliases {
  const { theme } = useAppTheme();
  return {
    theme,
    BG: theme.background, BORDER: theme.border, CARD: theme.card, CARD_ELEVATED: theme.cardElevated,
    FG: theme.text, MUTED: theme.muted, SUBTLE: theme.subtle,
    RED: theme.error, RED_DIM: `${theme.error}26`, SUCCESS: theme.success, SUCCESS_DIM: `${theme.success}26`,
    ORANGE: theme.warning, ORANGE_DIM: `${theme.warning}26`, GOLD: theme.accent,
  };
}
import {
  ClaimedRemainingLabel,
  TimeRemainingLabel,
  UrgencyBar,
  DemandBadge,
  URGENCY_UNITS_THRESHOLD,
  HIGH_DEMAND_THRESHOLD,
} from '@/components/CommerceSignal';

function useChrome() {
  const colors = useColors();
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, GOLD } = useThemeAliases();
  return {
    theme, PURPLE: colors.primary, PURPLE_LIGHT: theme.accentLight, PURPLE_DIM: colors.accent,
    CYAN: theme.secondary, CYAN_DIM: theme.secondaryDim,
    BORDER_ACTIVE: `${theme.accent}73`, BORDER_FOCUS: `${theme.secondary}80`,
    GRAD_PRIMARY: theme.primaryGradient as readonly [string, string, ...string[]],
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
    sizeChartImageUrl:  row.sizeChartImageUrl ?? null,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPrice = formatCents;
const GALLERY_WIDTH = Dimensions.get('window').width;
// 3:4 — matches how product photos are now saved (cropped by the seller to
// 3:4 at upload time; see ShopProductSheet's ProductImageCarousel, fixed the
// same way in an earlier photo-audit pass).
const GALLERY_HEIGHT = GALLERY_WIDTH * 4 / 3;

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
        resizeMode="contain"
        accessibilityLabel="Product photo. Pinch with two fingers to zoom."
      />
      {zoomed && (
        <TouchableOpacity style={galleryStyles.resetZoom} onPress={resetZoom} accessibilityRole="button" accessibilityLabel="Reset product photo zoom">
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
  thumbRail: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  thumb: {
    width: 56, height: 56, borderRadius: RADIUS.sm, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
  },
  thumbImage: { width: '100%', height: '100%' },
});

function ProductGallery({ imageUris, accentColor }: { imageUris: string[]; accentColor: string }) {
  const images = imageUris.filter(Boolean);
  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef<Animated.FlatList<string>>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  if (!images.length) {
    return (
      <View style={[galleryStyles.gallery, galleryStyles.galleryEmpty]}>
        <Feather name="image" size={ICON.xxl} color={MUTED} />
        <Text style={galleryStyles.emptyText}>Product image unavailable</Text>
      </View>
    );
  }

  return (
    <View>
      <View style={galleryStyles.gallery}>
        <Animated.FlatList
          ref={listRef}
          data={images}
          keyExtractor={(uri, index) => `${uri}-${index}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          renderItem={({ item }) => <ZoomableGalleryImage uri={item} />}
          getItemLayout={(_, index) => ({ length: GALLERY_WIDTH, offset: GALLERY_WIDTH * index, index })}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
          onMomentumScrollEnd={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / GALLERY_WIDTH);
            setActiveIndex(Math.max(0, Math.min(images.length - 1, next)));
          }}
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

      {/* Thumbnail rail — tap a thumbnail to jump the main gallery to it */}
      {images.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={galleryStyles.thumbRail}
        >
          {images.map((uri, index) => (
            <TouchableOpacity
              key={`${uri}-${index}`}
              onPress={() => {
                listRef.current?.scrollToIndex({ index, animated: true });
                setActiveIndex(index);
              }}
              style={[galleryStyles.thumb, index === activeIndex && { borderColor: accentColor }]}
              accessibilityRole="button"
              accessibilityLabel={`View photo ${index + 1} of ${images.length}`}
              accessibilityState={{ selected: index === activeIndex }}
            >
              <CachedImage source={{ uri }} style={galleryStyles.thumbImage} contentFit="cover" />
            </TouchableOpacity>
          ))}
        </ScrollView>
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
  const { theme } = useThemeAliases();
  const op = makeOptionStyles(theme);
  const isColor = option.name.toLowerCase() === 'color';
  return (
    <View style={op.root}>
      <View style={op.labelRow}>
        <Text style={op.optionName}>{option.name}</Text>
        {selections[option.id] && (
          <Text style={op.selectedLabel} numberOfLines={1}>
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
                onPress={() => { if (available) { hapticToggle(); onSelect(option.id, val.id); } }}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityLabel={`${option.name}, ${val.label}${available ? '' : ', unavailable'}`}
                accessibilityState={{ selected: isSelected, disabled: !available }}
              >
                <View style={[op.colorDot, { backgroundColor: val.colorHex }]} />
                {!available && <View style={op.slashOverlay}><Text style={op.slash}>✕</Text></View>}
              </TouchableOpacity>
            );
          }

          return (
            <Chip
              key={val.id}
              label={val.label}
              selected={isSelected}
              disabled={!available}
              // A leading slash glyph makes "unavailable" a distinct shape,
              // not just a greyed-out label (Nike / GOAT / UNIQLO size-grid
              // convention) — see https://mobbin.com/screens/76430e6c-342a-42be-8fce-148ab5d9651e
              icon={available ? undefined : 'slash'}
              iconColor={theme.subtle}
              strikethrough={!available}
              accessibilityRole="radio"
              accessibilityLabel={`${option.name}, ${val.label}${available ? '' : ', sold out'}`}
              onPress={() => onSelect(option.id, val.id)}
              testID={`option-${option.id}-${val.id}`}
            />
          );
        })}
      </View>
    </View>
  );
}

const makeOptionStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent, PURPLE_LIGHT = theme.accentLight;
  const BORDER = theme.border;
  const RED = theme.error;
  return StyleSheet.create({
  root: { marginBottom: SPACING.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  optionName: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, color: theme.text },
  selectedLabel: { ...TYPE_SCALE.footnote, color: PURPLE_LIGHT, flexShrink: 1, marginLeft: SPACING.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  colorSwatch: {
    width: 44, height: 44, borderRadius: RADII.chip,
    borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchSelected: { borderColor: PURPLE },
  colorDot: { width: 28, height: 28, borderRadius: RADII.chip - 2 },
  unavail: { opacity: 0.4 },
  slashOverlay: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  slash: { fontSize: 18, color: RED, fontFamily: FONT.bold },
  });
};

// ─── Quantity Selector ────────────────────────────────────────────────────────
// Uses the shared QuantityStepper (components/ui); the "Qty" label and
// low-stock hint stay inline next to it exactly as before.

const qs = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  label: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  // Monochrome: urgency is carried by weight, not an orange tone.
  stock: { fontSize: FS.meta, fontFamily: FONT.semibold, color: FG },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerProductDetailScreen() {
  const { theme, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM, BORDER_ACTIVE, BORDER_FOCUS, GRAD_PRIMARY, SHADOW_PURPLE } = useChrome();
  const s = makeStyles(theme);
  const wl = makeWaitlistStyles(theme);
  const { productId, sourcePostId, sourceTagId, editVariantId, editCartItemId, src } = useLocalSearchParams<{
    productId?: string;
    sourcePostId?: string;
    sourceTagId?: string;
    editVariantId?: string;
    editCartItemId?: string;
    src?: string;
  }>();
  const router = useRouter();
  const pathname = usePathname();
  const { push, back } = useThreadPull();
  const usesThreadPull = pathname === '/thread-product-detail';
  const leaveProduct = () => usesThreadPull ? back() : goBackOr(router, '/(buyer)/discover');
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const api    = useApi();
  const { isSignedIn } = useAuth();

  const [product, setProduct] = useState<BuyerProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [addingToCart, setAddingToCart] = useState(false);
  const [buyingNow, setBuyingNow] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const { ref: actionBarRef, rect: actionBarRect, onLayout: actionBarOnLayout } = useMeasuredTarget();
  // Deliberate-choice confirmation sheet (View bag / Keep shopping) —
  // separate from `addedToCart` above, which only drives the transient
  // checkmark on the sticky action bar's icon button.
  const [showAddedSheet, setShowAddedSheet] = useState(false);
  const [sellerPaymentReady, setSellerPaymentReady] = useState<boolean | null>(null);
  const [sellerPaymentReason, setSellerPaymentReason] = useState<string | null>(null);
  const [sellerVacationMessage, setSellerVacationMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Track whether options were touched at least once (for required-option feedback)
  const [optionsTouched, setOptionsTouched] = useState(false);
  // Track added-to-bag confirmation to show a banner (auto-clears after 2s)
  const addedBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Waitlist & pre-order reservation state
  const [waitlistJoined,  setWaitlistJoined]  = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [reserved,        setReserved]        = useState(false);
  const [reserveLoading,  setReserveLoading]  = useState(false);
  const [sizeChartOpen,   setSizeChartOpen]   = useState(false);
  const [sizeGuideOpen,   setSizeGuideOpen]   = useState(false);

  // Add to cart → the product photo flies to the bag icon, which bumps and
  // shows the count (the feed / shop sheet pattern, #287 / #291).
  const [cartCount, setCartCount] = useState(0);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const { scale: cartPulse, bump: bumpCart } = useCartBadgeBump(reduceMotion);
  const cartTargetRef = useRef<View>(null);
  const galleryRef = useRef<View>(null);
  const cartFlyProgress = useRef(new Animated.Value(0)).current;
  const [flying, setFlying] = useState(false);
  const [flight, setFlight] = useState<{ source: CartFlightSource | null; target: CartFlightPoint } | null>(null);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then(enabled => { if (active) setReduceMotion(enabled); })
      .catch(() => { if (active) setReduceMotion(false); });
    void getCart().then(cart => {
      if (active) setCartCount(cart.items.reduce((sum, item) => sum + item.quantity, 0));
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  // ── Buyer demand signals ─────────────────────────────────────────────────
  // Populated from server-supplied fields on publicProducts.get() response only.
  // Values are never fabricated — zero means the server did not supply them.
  const [demandClaimedUnits,   setDemandClaimedUnits]   = useState<number>(0);
  const [demandRemainingUnits, setDemandRemainingUnits] = useState<number>(0);
  const [demandCount,          setDemandCount]          = useState<number | null>(null);
  const [demandEndsAt,         setDemandEndsAt]         = useState<string | null>(null);

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
              if (!cancelled) {
                setSellerVacationMessage(
                  row.sellerVacationMode
                    ? row.sellerVacationMessage ?? 'This seller is currently away and is not accepting purchases.'
                    : null,
                );
              }
              // Populate demand signals from server-supplied fields only.
              // Never fabricate these values.
              if (!cancelled) {
                setDemandClaimedUnits(typeof row.claimedUnits  === 'number' ? row.claimedUnits  : 0);
                setDemandRemainingUnits(typeof row.remainingUnits === 'number' ? row.remainingUnits : 0);
                setDemandCount(typeof row.demandCount === 'number' ? row.demandCount : null);
                setDemandEndsAt(row.endsAt ?? null);
              }
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
        // Dev-web preview only: a seeded `preview-product-*` has no catalog
        // row, so the real request fails. Build the same BuyerProduct from
        // the preview catalog (lib/previewProducts.ts; null for real ids and
        // in production) so the page, sizes, cart and checkout all run.
        if (!prod && isPreviewProductId(productId)) prod = getPreviewBuyerProduct(productId);
        // productName-only navigation is not supported; all entry points
        // must supply a productId so real variant data is loaded.

        if (!cancelled) {
          setProduct(prod);
          if (paymentStatus) {
            setSellerPaymentReady(paymentStatus.ready);
            setSellerPaymentReason(paymentStatus.reason ?? null);
          }
          // Best-effort — a failed view record should never affect the
          // product page itself, so no error handling beyond swallowing it.
          if (prod?.id && isSignedIn) api.buyer.recentlyViewed.record(prod.id).catch(() => {});
        }
      } catch {}
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [productId]);

  // Real per-source traffic tracking for the seller's own Dashboard — a
  // signed-out shopper's visit still counts, so this never gates on
  // isSignedIn. Fire-and-forget, never blocks this screen's own render.
  useEffect(() => {
    if (!product?.id || !product.sellerId) return;
    api.publicSellers
      .recordStoreVisit(product.sellerId, { source: resolveStoreVisitSource(src), productId: product.id })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, product?.sellerId]);

  // Meta Pixel + Conversions API — ViewContent, once per loaded product. This
  // is the real buyer-facing product page (product-detail.tsx is the seller's
  // own management view), so it's the correct place to fire ViewContent.
  useEffect(() => {
    if (!product?.id) return;
    void trackAndRelayConversionEvent(
      'ViewContent',
      { content_ids: [product.id], content_type: 'product', value: product.priceCents / 100, currency: 'usd' },
      { productId: product.id, valueCents: product.priceCents, currency: 'usd' },
    );
  }, [product?.id]);

  useEffect(() => {
    if (!product || !editVariantId) return;
    const cartVariant = product.variants.find(candidate => candidate.id === editVariantId);
    if (!cartVariant) return;
    setSelections(Object.fromEntries(cartVariant.optionValues.map(value => [value.optionId, value.valueId])));
  }, [product, editVariantId]);

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
    // Compact loading — small spinner in the content area, not a full-screen spinner.
    // The gallery placeholder stays visible so the layout doesn't jump.
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        {/* Gallery skeleton */}
        <View style={{ height: GALLERY_HEIGHT, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={PURPLE} size="large" />
          <Text style={{ color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.sm }}>Loading product…</Text>
        </View>
        {/* Back button remains accessible */}
        <View style={{ position: 'absolute', left: SP.md, top: headerTopInset + SP.sm }}>
          <IconButton
            name="arrow-left"
            onPress={leaveProduct}
            accessibilityLabel="Back"
            variant="filled"
          />
        </View>
      </View>
    );
  }

  if (!product) {
    // Compact error/not-found state with retry
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <View style={{ height: GALLERY_HEIGHT, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', gap: SP.md, paddingHorizontal: SP.lg }}>
          <Feather name="alert-circle" size={ICON.xl} color={RED} />
          <Text style={{ color: FG, fontFamily: FONT.semibold, fontSize: FS.base, textAlign: 'center' }}>Product not found</Text>
          <Text style={{ color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 20 }}>
            This product may be unavailable or the link may have expired.
          </Text>
          <Button label="Go back" onPress={leaveProduct} variant="secondary" size="small" icon="chevron-left" />
        </View>
        {/* Back button */}
        <View style={{ position: 'absolute', left: SP.md, top: headerTopInset + SP.sm }}>
          <IconButton
            name="arrow-left"
            onPress={leaveProduct}
            accessibilityLabel="Back"
            variant="filled"
          />
        </View>
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
    setOptionsTouched(true);
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
      // Mark options as touched so unselected options show a required indicator
      setOptionsTouched(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
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
      setCartCount(result.cart.items.reduce((sum, item) => sum + item.quantity, 0));
      await flyToCart();
      bumpCart();
      setShowAddedSheet(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Auto-clear the icon-button checkmark after 2.5s; the sheet itself
      // stays open until the buyer taps View bag or Keep shopping.
      if (addedBannerTimerRef.current) clearTimeout(addedBannerTimerRef.current);
      addedBannerTimerRef.current = setTimeout(() => setAddedToCart(false), 2500);
    } else {
      Alert.alert('Cannot Add to Cart', result.message ?? 'Please try again.');
    }
  }

  /** The product photo lifts off the gallery and lands in the bag icon (skipped under Reduce Motion). */
  async function flyToCart(): Promise<void> {
    if (!shouldAnimateCartSuccess(reduceMotion)) return;
    const fallback = { x: GALLERY_WIDTH - 40, y: headerTopInset + SP.sm + 22 };
    const [target, photoRect] = await Promise.all([
      measureCartTarget(cartTargetRef.current?.measureInWindow?.bind(cartTargetRef.current), fallback),
      measureWindowRect(galleryRef.current?.measureInWindow?.bind(galleryRef.current)),
    ]);
    const source = flightSourceFromRect(photoRect, { top: 0, bottom: Dimensions.get('window').height });
    setFlight({ source, target });
    setFlying(true);
    cartFlyProgress.setValue(0);
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => {
        Animated.timing(cartFlyProgress, {
          toValue: 1, duration: 720, easing: Easing.inOut(Easing.cubic), useNativeDriver: true,
        }).start(() => { setFlying(false); resolve(); });
      });
    });
  }

  // DM the seller about this product: opens (or reuses) the buyer↔seller
  // product thread with this product's card staged in the composer.
  function handleMessageSeller() {
    if (!product) return;
    if (sellerVacationMessage) {
      Alert.alert('Seller is away', sellerVacationMessage);
      return;
    }
    if (!isSignedIn) {
      router.push('/sign-in' as never);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(messageSellerAboutProductHref({
      sellerId: product.sellerId,
      sellerName: product.sellerName,
      productId: product.id,
      productName: product.name,
      productPriceCents: variantPrice,
      productImageUri: product.imageUris[0] ?? null,
    }) as never);
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
      // A seeded preview seller has no payment account to check (dev-web preview only).
      if (sellerId && isSignedIn && !isPreviewSellerId(sellerId)) {
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
      if (usesThreadPull) {
        push('/thread-checkout?source=buynow' as never);
      } else {
        router.push('/buyer-checkout?source=buynow' as never);
      }
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
    setBuyingNow(false);
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
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
        <View style={s.imageArea} ref={galleryRef} collapsable={false}>
          <ProductGallery imageUris={product.imageUris} accentColor={PURPLE} />
          {/* Back button — solid dark chrome over the full-bleed gallery. A
              BlurView-based "glass" variant re-samples whatever sits behind
              it every frame; on a swipeable gallery that reads as the same
              shimmer/glitch PR #109 killed on the video feed, so this uses
              the same solid rgba(0,0,0,0.6) scrim pattern that PR used over
              other media chrome, not a frosted blur. */}
          <View style={[s.backBtnWrap, { top: headerTopInset + SP.sm, left: SP.md + insets.left }]}>
            <IconButton
              name="arrow-left"
              onPress={leaveProduct}
              accessibilityLabel="Back to previous screen"
              variant="plain"
              color="#FFFFFF"
              style={s.mediaChromeBtn}
            />
          </View>
          {/* Cart button */}
          <Animated.View
            ref={cartTargetRef}
            collapsable={false}
            style={[s.cartBtnWrap, { top: headerTopInset + SP.sm, right: SP.md + insets.right, transform: [{ scale: cartPulse }] }]}
            testID="product-cart-button"
          >
            <IconButton
              name="shopping-bag"
              onPress={() => router.push('/(buyer)/cart' as never)}
              accessibilityLabel={cartCount > 0 ? `Open cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}` : 'Open cart'}
              accessibilityHint="View items in your cart"
              variant="plain"
              color="#FFFFFF"
              style={s.mediaChromeBtn}
            />
            {cartCount > 0 ? (
              <View style={s.cartBadge} pointerEvents="none" testID="product-cart-badge">
                <Text style={s.cartBadgeText}>{cartCount > 99 ? '99+' : cartCount}</Text>
              </View>
            ) : null}
          </Animated.View>
        </View>

        <ResponsiveContainer style={s.body}>
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

          {/* Page order (item: preview buy flow) follows real marketplace
              product pages (SSENSE / Farfetch / Depop on Mobbin): photos →
              title → price → sizes → the purchase bar (sticky) → seller →
              About this piece → returns → purchase protection (once) →
              you might also like → report links, small, at the very end. */}
          <Text style={s.productName} numberOfLines={3}>{product.name}</Text>
          {/* Price */}
          <View style={s.priceRow}>
            <Text style={[s.price, hasDiscount ? s.priceSale : undefined]}>{formatCents(variantPrice)}</Text>
            {hasDiscount && <Text style={s.comparePrice}>{fmtPrice(variantCompare!)}</Text>}
            {hasDiscount && <Text style={s.savings}>Save {fmtPrice(savingsAmt)}</Text>}
          </View>

          {/* ── Buyer demand signals (server-supplied values only) ── */}
          {(demandClaimedUnits > 0 || demandRemainingUnits > 0 || !!demandEndsAt ||
            (demandCount != null && demandCount >= HIGH_DEMAND_THRESHOLD)) && (
            <View style={{ marginBottom: SP.md, gap: 6 }}>
              {demandCount != null && demandCount >= HIGH_DEMAND_THRESHOLD && (
                <DemandBadge demandCount={demandCount} accent={theme.accent} />
              )}
              <ClaimedRemainingLabel
                claimedUnits={demandClaimedUnits}
                remainingUnits={demandRemainingUnits}
                urgent={demandRemainingUnits > 0 && demandRemainingUnits <= URGENCY_UNITS_THRESHOLD}
                accent={theme.accent}
              />
              {!!demandEndsAt && (
                <TimeRemainingLabel endsAt={demandEndsAt} accent={theme.accent} />
              )}
              <UrgencyBar
                claimedUnits={demandClaimedUnits}
                remainingUnits={demandRemainingUnits}
                accentColor={theme.accent}
              />
            </View>
          )}

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

          <View style={s.divider} />

          {/* Options — unselected options highlight after the buyer attempts to add */}
          {product.options.map(option => {
            const isUnselected = optionsTouched && !selections[option.id];
            return (
              <View key={option.id}>
                <OptionPicker
                  product={product}
                  option={option}
                  selections={selections}
                  onSelect={handleSelect}
                />
                {isUnselected && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: -SP.sm, marginBottom: SP.sm }}>
                    <Feather name="alert-circle" size={12} color={RED} />
                    <Text style={{ fontSize: FS.xs, fontFamily: FONT.medium, color: RED }}>
                      Please select a {option.name.toLowerCase()}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}

          {/* "Size guide" text link — only when the seller uploaded a size
              chart photo, right under the size chips (mobbin.com/screens/
              0c16f080-0cb8-487a-8928-6a7631cb205c). No placeholder link
              when absent. */}
          {!!product.sizeChartImageUrl && (
            <TouchableOpacity
              style={s.sizeGuideLink}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSizeGuideOpen(true); }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Size guide"
              testID="product-size-guide-link"
            >
              <Feather name="maximize" size={13} color={PURPLE_LIGHT} />
              <Text style={[s.sizeGuideLinkText, { color: PURPLE_LIGHT }]}>Size guide</Text>
            </TouchableOpacity>
          )}

          {/* Stock status */}
          {allSelected && variant && (
            <View style={s.stockRow} testID="product-stock-line">
              {/* Monochrome (no green/red): low stock is white and bold,
                  plain in-stock and sold-out are grey. */}
              <View style={[s.stockDot, {
                backgroundColor: variant.isAvailable && variant.inventoryQuantity <= 5 ? FG : variant.isAvailable ? MUTED : SUBTLE,
              }]} />
              <Text style={[
                s.stockText,
                variant.isAvailable && variant.inventoryQuantity <= 5
                  ? { color: FG, fontFamily: FONT.bold }
                  : { color: MUTED },
              ]}>
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
              accessibilityRole="button"
              accessibilityLabel={waitlistJoined ? "You're on the waitlist" : 'Notify me when back in stock'}
              accessibilityState={{ disabled: waitlistLoading || waitlistJoined, busy: waitlistLoading }}
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
            <View style={[qs.root, { marginVertical: SP.md }]}>
              <Text style={qs.label}>Qty</Text>
              <QuantityStepper value={qty} onChange={setQty} min={1} max={maxQty} />
              {maxQty <= 5 && <Text style={qs.stock}>{maxQty} left</Text>}
            </View>
          )}

          {/* Size Chart — expandable table */}
          {!!(product as any).sizeChart && (
            <>
              <TouchableOpacity
                style={[sz.toggle, { borderTopColor: theme.border }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSizeChartOpen(o => !o); }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Size chart"
                accessibilityState={{ expanded: sizeChartOpen }}
              >
                <Text style={[sz.label, { color: theme.text }]}>Size Chart</Text>
                <Feather name={sizeChartOpen ? 'chevron-up' : 'chevron-down'} size={16} color={MUTED} />
              </TouchableOpacity>
              {sizeChartOpen && <SizeChartViewer chart={(product as any).sizeChart} />}
            </>
          )}

          {/* Bundle & save — active bundles with this product; renders nothing when none. */}
          <BundleSaveSection productId={product.id} dividerStyle={s.divider} headerStyle={s.reviewsHeader} onAdded={bumpCart} />


          <View style={s.divider} />
          <TouchableOpacity style={s.sellerCard} onPress={() => router.push(profileHref({ userId: product.sellerId, accountType: 'seller' }) as never)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`View seller ${product.sellerName}`} testID="product-seller-link">
            <Avatar name={product.sellerName} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={s.sellerName} numberOfLines={1}>{product.sellerName}</Text>
              {!!product.sellerHandle && <Text style={s.sellerHandle} numberOfLines={1}>{product.sellerHandle}</Text>}
            </View>
            <View style={s.sellerViewStore}>
              <Text style={s.sellerViewStoreText}>View store</Text>
              <Feather name="chevron-right" size={14} color={MUTED} />
            </View>
          </TouchableOpacity>
          <Button
            label="Message seller"
            icon="message-circle"
            onPress={handleMessageSeller}
            variant="secondary"
            size="small"
            accessibilityHint="Opens a chat with the seller about this product"
            style={{ alignSelf: 'flex-start', marginBottom: SP.md }}
            testID="product-message-seller"
          />

          {/* About this piece — the product's own description (hidden when empty). */}
          {product.description?.trim() ? (
            <>
              <View style={s.divider} />
              <Text style={s.descTitle}>About this piece</Text>
              <Text style={s.desc}>{product.description.trim()}</Text>
            </>
          ) : null}

          {/* Returns & cancellation */}
          <View style={s.divider} />
          <PolicyRow icon="refresh-ccw" label="Returns" value={product.refundPolicy} />
          <PolicyRow icon="x-circle" label="Cancellation" value={product.cancellationPolicy} />

          {/* Purchase protection — exactly once (it also rendered, compact,
              under the seller row). */}
          <BuyerProtectionNote preorder={product.isPreOrder} style={{ marginTop: SP.sm }} />

          {/* Reviews — shared with the Shop sheet so review UI never drifts
              between the two surfaces. Renders nothing when there are none. */}
          <ProductReviewsSection productId={product.id} productName={product.name} />

          {/* Worn in these videos */}
          <WornInVideos productId={product.id} productName={product.name} />

          {/* You might also like — owns its header; renders nothing when empty. */}
          <RelatedProducts productId={product.id} dividerStyle={s.divider} headerStyle={s.reviewsHeader} />

          {/* Report links: de-emphasised via SUBTLE text color alone (below) —
              a resting `opacity < 1` on the row would make its already-dim
              small text subpixel-antialias against the background instead
              of rendering as one crisp color, the exact "blurry fine
              print" bug this pass fixes elsewhere. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SP.md, marginTop: SP.lg, marginBottom: SP.md }}>
            <TouchableOpacity
              onPress={() => router.push(reportHref({
                targetType: 'product',
                targetId: product.id,
                label: product.name,
                ownerId: product.sellerId,
                ownerName: product.sellerName,
              }) as never)}
              accessibilityRole="button"
              accessibilityLabel="Report this listing"
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}
            >
              <Feather name="flag" size={11} color={SUBTLE} />
              <Text style={{ color: SUBTLE, fontFamily: FONT.medium, fontSize: FS.meta }}>Report listing</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push(('/ip-report?listingId=' + encodeURIComponent(product.id)) as never)}
              accessibilityRole="button"
              accessibilityLabel="Report intellectual property infringement"
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            >
              <Text style={{ color: SUBTLE, fontFamily: FONT.medium, fontSize: FS.meta }}>Report intellectual property infringement</Text>
            </TouchableOpacity>
          </View>
        </ResponsiveContainer>
      </ScrollView>

      {flying && flight ? (() => {
        const flySize = flight.source?.size ?? CART_FLIGHT_ITEM_SIZE;
        const startLeft = flight.source ? flight.source.x - flySize / 2 : GALLERY_WIDTH / 2 - flySize / 2;
        const startTop = flight.source ? flight.source.y - flySize / 2 : GALLERY_HEIGHT / 2 - flySize / 2;
        const vector = getCartFlightVector(startLeft, startTop, flight.target, flySize);
        const ratio = CART_FLIGHT_ITEM_SIZE / flySize;
        return (
          <Animated.View
            testID="cart-fly-item"
            pointerEvents="none"
            style={[s.cartFlyItem, {
              left: startLeft, top: startTop, width: flySize, height: flySize, borderRadius: 14 / ratio,
              opacity: cartFlyProgress.interpolate({ inputRange: [0, 0.82, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateX: cartFlyProgress.interpolate({ inputRange: [0, 1], outputRange: [0, vector.x] }) },
                { translateY: cartFlyProgress.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, -48, vector.y] }) },
                { scale: cartFlyProgress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 0.72 * ratio, 0.28 * ratio] }) },
              ],
            }]}
          >
            {product.imageUris[0] ? <CachedImage source={{ uri: product.imageUris[0] }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
          </Animated.View>
        );
      })() : null}

      {/* Added-to-bag confirmation — a deliberate choice (UNIQLO-style), not
          an auto-dismissing toast: the buyer picks View bag or Keep shopping. */}
      <BottomSheet visible={showAddedSheet} onClose={() => setShowAddedSheet(false)}>
        <View style={s.addedSheetContent}>
          {/* Monochrome brand accent, not a green checkmark — the shared
              success-moment primitive (components/ui/SuccessCheck.tsx). */}
          <SuccessCheck size={56} iconSize={26} />
          <Text style={s.addedSheetTitle}>Added to your bag</Text>
          <View style={s.addedSheetProductRow}>
            {product.imageUris[0] ? (
              <CachedImage source={{ uri: product.imageUris[0] }} style={s.addedSheetImage} contentFit="cover" />
            ) : (
              <View style={[s.addedSheetImage, { alignItems: 'center', justifyContent: 'center', backgroundColor: CARD_ELEVATED }]}>
                <Feather name="image" size={18} color={SUBTLE} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.addedSheetProductName} numberOfLines={1}>{product.name}</Text>
              <Text style={s.addedSheetProductMeta}>
                {formatCents(variantPrice)}{qty > 1 ? ` · Qty ${qty}` : ''}
              </Text>
            </View>
          </View>
          <Button
            label="View bag"
            onPress={() => { setShowAddedSheet(false); router.push('/(buyer)/cart' as never); }}
            fullWidth
          />
          <Button
            label="Keep shopping"
            variant="secondary"
            onPress={() => setShowAddedSheet(false)}
            fullWidth
            style={{ marginTop: SP.sm }}
          />
        </View>
      </BottomSheet>

      <SizeGuideSheet
        visible={sizeGuideOpen}
        imageUri={product.sizeChartImageUrl ?? null}
        onClose={() => setSizeGuideOpen(false)}
      />

      {/* Persistent purchase bar remains visible while product content scrolls.
          This screen is pushed as a root stack card over the whole app (not
          nested under the buyer tab group), so it never sits behind the
          floating tab bar — no tabBarInset is passed. */}
      <StickyFooter style={s.actionBar}>
      <View
        ref={actionBarRef}
        onLayout={actionBarOnLayout}
        collapsable={false}
        style={s.actionBarRow}
        accessibilityRole="toolbar"
        accessibilityLabel="Product purchase actions"
      >
        {/* Real "Add to cart" + "Buy now" pair (it was an unlabeled bag icon). */}
        {addedToCart ? (
          <Button
            label="In your bag"
            icon="check"
            variant="secondary"
            onPress={() => router.push('/(buyer)/cart' as never)}
            accessibilityLabel="In your bag. View cart"
            style={s.buyNowBtn}
            testID="product-view-cart"
          />
        ) : (
          <Button
            label="Add to cart"
            variant="secondary"
            onPress={handleAddToCart}
            loading={addingToCart}
            disabled={addingToCart || (allSelected && !inStock)}
            accessibilityLabel={!allSelected ? 'Add to cart. Select a size first' : !inStock ? 'Out of stock' : 'Add to cart'}
            style={s.buyNowBtn}
            testID="product-add-to-cart"
          />
        )}

        {product.isPreOrder ? (
          <Button
            label={reserved ? 'Reserved ✓' : 'Reserve (No Charge)'}
            onPress={handleReserve}
            variant={reserved ? 'secondary' : 'primary'}
            loading={reserveLoading}
            disabled={reserveLoading || reserved}
            accessibilityHint={reserved ? undefined : 'Reserves this pre-order at no charge'}
            style={s.buyNowBtn}
          />
        ) : (
          <Button
            label={
              paymentUnavailable ? 'Payments unavailable'
                : !allSelected ? 'Select options'
                : !inStock ? 'Sold Out'
                : 'Buy now'
            }
            icon={!inStock && allSelected && !paymentUnavailable ? 'clock' : undefined}
            onPress={handleBuyNow}
            variant="primary"
            loading={buyingNow}
            disabled={buyingNow || !inStock || !allSelected || paymentUnavailable}
            style={s.buyNowBtn}
          />
        )}
      </View>
      </StickyFooter>
      <FirstRunTip
        id="buyer-product-detail"
        variant="spotlight"
        contentReady={!loading}
        spotlight={{ target: actionBarRect, ...BUYER_PRODUCT_DETAIL_SPOTLIGHT }}
      />
    </View>
  );
}

// ─── Size Chart Viewer ────────────────────────────────────────────────────────

interface SizeChart { columns: string[]; rows: { size: string; values: string[] }[]; unit?: string; notes?: string }

function SizeChartViewer({ chart }: { chart: SizeChart }) {
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, GOLD } = useThemeAliases();
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

// ─── Size Guide Sheet (photo) ─────────────────────────────────────────────────
// A seller-uploaded photo of their own size chart — distinct from the
// structured SizeChartViewer table above. Mobbin refs: SHEIN's "Size Guide"
// text link directly under the size chips (mobbin.com/screens/
// 0c16f080-0cb8-487a-8928-6a7631cb205c) and Polarsteps' full-bleed,
// pinch-zoomable photo viewer (mobbin.com/screens/
// 7d855183-6163-4eb9-8776-7ac07592c47f) for the zoom behavior — adapted to
// the app's own shared BottomSheet rather than a full-screen viewer, since
// a translucent Glass blur over the chart photo itself would work against
// the one thing this sheet exists to show clearly.

function SizeGuideSheet({ visible, imageUri, onClose }: { visible: boolean; imageUri: string | null; onClose: () => void }) {
  const { theme, FG, MUTED } = useThemeAliases();
  const scale = useRef(new Animated.Value(1)).current;
  const currentScale = useRef(1);
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);

  const distance = (touches: readonly any[]) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const resetZoom = () => {
    currentScale.current = 1;
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
    },
    onPanResponderTerminate: () => {
      if (currentScale.current < 1.06) resetZoom();
    },
  })).current;

  if (!imageUri) return null;

  return (
    <BottomSheet visible={visible} onClose={() => { resetZoom(); onClose(); }} testID="size-guide-sheet">
      <View style={sgs.header}>
        <Text style={[sgs.title, { color: FG }]}>Size guide</Text>
        <IconButton name="x" size={20} variant="plain" onPress={() => { resetZoom(); onClose(); }} accessibilityLabel="Close size guide" />
      </View>
      <View style={[sgs.imageWrap, { backgroundColor: theme.surface }]} {...responder.panHandlers}>
        <Animated.Image
          source={{ uri: imageUri }}
          resizeMode="contain"
          style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]}
          accessibilityLabel="Size guide photo. Pinch with two fingers to zoom."
        />
      </View>
      <Text style={[sgs.hint, { color: MUTED }]}>Pinch to zoom</Text>
    </BottomSheet>
  );
}

const sgs = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, marginBottom: SP.sm },
  title: { fontFamily: FONT.bold, fontSize: FS.lg },
  imageWrap: { width: '100%', aspectRatio: 4 / 3, overflow: 'hidden' },
  hint: { textAlign: 'center', fontFamily: FONT.regular, fontSize: FS.xs, marginTop: SP.sm, marginBottom: SP.xs },
});

function WornInVideos({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const { theme } = useThemeAliases();
  const api = useApi();
  const [videos, setVideos] = useState<Array<{
    postId: string; mediaUrl: string; thumbnailUrl: string | null; authorName: string;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.publicProducts.taggedVideos(productId, 10)
      .then((rows) => { if (!cancelled) setVideos(rows); })
      .catch(() => { if (!cancelled) setVideos([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [productId, api]);

  if (loading) {
    return (
      <View style={{ paddingVertical: SP.md, alignItems: 'center' }}>
        <ActivityIndicator color={theme.accent} size="small" />
      </View>
    );
  }

  // No banner/empty-state here by design — an entirely absent row for a
  // product nobody has posted a video of yet is the correct "nothing to see"
  // state; the "You Might Also Like" section right below still gives the
  // buyer somewhere real to go.
  if (videos.length === 0) return null;

  return (
    <View style={{ marginBottom: SP.lg }} testID="product-featured-videos">
      <View style={[wv.divider, { backgroundColor: theme.border }]} />
      <Text style={[wv.header, { color: theme.muted }]}>Worn in these videos</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -SP.md }}
        contentContainerStyle={{ paddingHorizontal: SP.md, gap: SP.sm }}
      >
        {videos.map((video) => (
          <TouchableOpacity
            key={video.postId}
            style={wv.card}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Watch ${video.authorName}'s video of ${productName}`}
            testID={`product-video-${video.postId}`}
            onPress={() => {
              // Same full-screen feed player as the main feed, scoped to the
              // videos that tag this product and starting at the tapped one,
              // so the buyer can swipe through every video of it.
              router.push(profileVideosHref({ source: 'product', id: productId, startPostId: video.postId, title: productName }) as never);
            }}
          >
            {video.thumbnailUrl ? (
              <CachedImage source={{ uri: video.thumbnailUrl }} style={wv.thumb} contentFit="cover" />
            ) : (
              <View style={[wv.thumb, { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.cardElevated }]}>
                <Feather name="video" size={20} color={theme.muted} />
              </View>
            )}
            <View style={wv.playBadge}>
              <Feather name="play" size={12} color="#FFFFFF" />
            </View>
            <Text style={[wv.authorName, { color: theme.muted }]} numberOfLines={1}>{video.authorName}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const wv = StyleSheet.create({
  divider: { height: 1, marginVertical: SP.md },
  header: { fontSize: FS.sm, fontFamily: FONT.semibold, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  card: { width: 104 },
  thumb: { width: 104, height: 150, borderRadius: RADIUS.md },
  playBadge: {
    position: 'absolute', top: 8, right: 8,
    width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  authorName: { fontSize: FS.xs, fontFamily: FONT.medium, marginTop: 4 },
});

/**
 * "You might also like". Owns its header so an empty or failed row never
 * leaves a bare section title behind (it did: "You Might Also Like" over
 * nothing). Dev-web preview: seeded products get the same seller's other
 * pieces, then similar ones, from the preview catalog.
 */
function RelatedProducts({ productId, dividerStyle, headerStyle }: {
  productId: string;
  dividerStyle?: object;
  headerStyle?: object;
}) {
  const { push } = useThreadPull();
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, GOLD } = useThemeAliases();
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const usesThreadPull = pathname === '/thread-product-detail';
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const preview = isPreviewProductId(productId) ? getPreviewRelatedProducts(productId, 4) : [];
    if (preview.length > 0) {
      setProducts(preview);
      setLoading(false);
      return () => { cancelled = true; };
    }
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
    return null;
  }

  return (
    <>
    <View style={dividerStyle} />
    <Text style={headerStyle} accessibilityRole="header">You might also like</Text>
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
              if (usesThreadPull) {
                push({ pathname: '/thread-product-detail' as any, params: { productId: p.id } } as never);
              } else {
                router.push({ pathname: '/buyer-product-detail' as any, params: { productId: p.id } });
              }
            }}
          >
            <View style={{ width: 140, height: 180, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md, overflow: 'hidden', marginBottom: SP.sm }}>
              {(p.images && p.images[0]) ? (
                <CachedImage source={{ uri: p.images[0] }} style={{ width: '100%', height: '100%' }} contentFit="cover" recyclingKey={p.images[0]} />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="image" size={24} color={MUTED} />
                </View>
              )}
            </View>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG }} numberOfLines={1}>{p.name}</Text>
            <Text style={{ fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 2 }} numberOfLines={1}>
              {p.sellerDisplayName || 'Independent Seller'}
            </Text>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.bold, color: FG, marginTop: 4 }}>{formatCents(lowestPriceCents)}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
    </>
  );
}

const makeSizeChartStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE_DIM = theme.accentDim, PURPLE_LIGHT = theme.accentLight;
  const BORDER = theme.border;
  const CARD_ELEVATED = theme.cardElevated;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SUBTLE = theme.subtle;
  return StyleSheet.create({
  row:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER },
  altRow:     { backgroundColor: CARD_ELEVATED },
  cell:       { width: 72, paddingVertical: 8, paddingHorizontal: 4, justifyContent: 'center' },
  sizeCell:   { width: 52 },
  headerCell: { backgroundColor: PURPLE_DIM },
  headerText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: PURPLE_LIGHT, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.4 },
  sizeText:   { fontFamily: FONT.semibold, fontSize: FS.xs, color: FG, textAlign: 'center' },
  valueText:  { fontFamily: FONT.medium, fontSize: FS.meta, color: MUTED, textAlign: 'center' },
  notes:      { fontFamily: FONT.medium, fontSize: FS.meta, color: SUBTLE, marginTop: SP.sm, lineHeight: 17 },
  });
};

// ─────────────────────────────────────────────────────────────────────────────

function PolicyRow({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, GOLD } = useThemeAliases();
  return (
    <View style={pr.root}>
      <Feather name={icon} size={14} color={theme.muted} />
      <View style={{ flex: 1 }}>
        <Text style={[pr.label, { color: theme.muted }]}>{label}</Text>
        <Text style={[pr.value, { color: theme.subtle }]}>{value}</Text>
      </View>
    </View>
  );
}
const pr = StyleSheet.create({
  root: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.md },
  label: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  value: { fontSize: FS.meta, fontFamily: FONT.medium, color: SUBTLE, marginTop: 2, lineHeight: 17 },
});

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const BG = theme.background;
  const CARD = theme.card;
  const CARD_ELEVATED = theme.cardElevated;
  const BORDER = theme.border;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SUBTLE = theme.subtle;
  const SUCCESS = theme.success;
  const SUCCESS_DIM = `${theme.success}26`;
  const ORANGE = theme.warning;
  const ORANGE_DIM = `${theme.warning}26`;
  const RED = theme.error;
  const RED_DIM = `${theme.error}26`;
  const { PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM, BORDER_ACTIVE, BORDER_FOCUS, SHADOW_PURPLE } = {
    PURPLE: theme.accent, PURPLE_LIGHT: theme.accentLight, PURPLE_DIM: theme.accentDim, CYAN: theme.secondary, CYAN_DIM: theme.secondaryDim,
    BORDER_ACTIVE: `${theme.accent}73`, BORDER_FOCUS: `${theme.secondary}80`,
    SHADOW_PURPLE: { shadowColor: theme.shadowColor, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  };
  return StyleSheet.create({
  imageArea: { height: GALLERY_HEIGHT, backgroundColor: CARD, position: 'relative' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  imagePlaceholderText: { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', paddingHorizontal: SP.lg },
  // Positioning wrappers only — the solid dark chrome and hit area come
  // from `mediaChromeBtn` below on a `variant="plain"` IconButton (no blur
  // over the swipeable gallery — see the comment where these render).
  backBtnWrap: { position: 'absolute', left: SP.md },
  cartBtnWrap: { position: 'absolute', right: SP.md },
  // `right: 0` (was `-4`, pushing the badge outward past the button's
  // own bounds) — same class of fix as the buyer feed top bar's cart
  // badge (see feed.tsx): with a real device safe-area inset on top of
  // an outward offset, the badge could sit past the screen's actual
  // edge instead of just past the icon.
  cartBadge: {
    position: 'absolute', top: -4, right: 0, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center',
  },
  cartBadgeText: { color: theme.onAccent, fontFamily: FONT.bold, fontSize: 11, lineHeight: 13 },
  cartFlyItem: { position: 'absolute', overflow: 'hidden', zIndex: 50, backgroundColor: CARD },
  mediaChromeBtn: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: RADIUS.pill },
  body: { paddingVertical: SP.md },
  badgeRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.sm },
  preOrderBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CYAN_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  preOrderBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: CYAN, letterSpacing: 0.4 },
  saleBadge: { backgroundColor: RED_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  saleBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: RED, letterSpacing: 0.4 },
  productName: { ...TYPE.title, color: FG, marginBottom: SP.sm },
  addedSheetContent: { padding: SP.md, paddingTop: SP.xs, alignItems: 'center' },
  addedSheetTitle: { ...TYPE.title, color: FG, marginTop: SP.sm, marginBottom: SP.md },
  addedSheetProductRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, width: '100%',
    marginBottom: SP.lg, padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
  },
  addedSheetImage: { width: 52, height: 52, borderRadius: RADIUS.sm },
  addedSheetProductName: { ...TYPE.bodyMedium, color: FG },
  addedSheetProductMeta: { ...TYPE.caption, color: MUTED, marginTop: 2 },
  sellerCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm,
    padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD,
  },
  sellerName: { ...TYPE.bodyMedium, color: FG, flexShrink: 1 },
  sellerHandle: { ...TYPE.caption, color: MUTED, flexShrink: 1 },
  sellerViewStore: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sellerViewStoreText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
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
  paymentWarningText: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, lineHeight: 17 },
  vacationBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
    borderWidth: 1, borderColor: `${ORANGE}66`, backgroundColor: `${ORANGE}12`,
    borderRadius: RADIUS.md, padding: SP.md, marginBottom: SP.md,
  },
  vacationTitle: { color: ORANGE, fontFamily: FONT.bold, fontSize: FS.sm, marginBottom: 3 },
  vacationText: { color: FG, fontFamily: FONT.medium, fontSize: FS.meta, lineHeight: 18 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  price: { ...TYPE.heading, fontFamily: FONT.bold, color: FG },
  priceSale: { color: SUCCESS },
  comparePrice: { fontSize: FS.base, fontFamily: FONT.regular, color: SUBTLE, textDecorationLine: 'line-through' },
  savings: { fontSize: FS.sm, fontFamily: FONT.semibold, color: SUCCESS },
  preOrderCard: { backgroundColor: CYAN_DIM, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: `${CYAN}40`, marginBottom: SP.md, gap: 4 },
  preOrderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  preOrderTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: CYAN },
  preOrderDetail: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  preOrderDisclaimer: { fontSize: FS.meta, fontFamily: FONT.medium, color: SUBTLE, marginTop: 4, lineHeight: 17 },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.md },
  sizeGuideLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: -SP.xs, marginBottom: SP.sm },
  sizeGuideLinkText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm },
  stockDot: { width: 8, height: 8, borderRadius: 4 },
  stockText: { fontSize: FS.sm, fontFamily: FONT.medium },
  descTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  desc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 22 },
  // Passed as StickyFooter's own `style` — it already supplies the absolute
  // positioning, safe-area/tab-bar-aware bottom padding, background, and
  // top border/shadow; only the original paddingTop is preserved here.
  actionBar: { paddingTop: SP.md },
  actionBarRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  // The add-to-cart / view-cart control uses IconButton's own 44×44pt
  // footprint; only the fill/border are overridden so it reads as a
  // secondary action next to the full-width primary Button.
  addToCartIconBtn: {
    width: COMP.iconBtn, height: COMP.iconBtn, borderRadius: RADII.chip,
    borderWidth: 1, borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM,
    alignItems: 'center', justifyContent: 'center',
  },
  buyNowBtn: { flex: 1 },
  reviewsHeader: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  reviewRow: { marginBottom: SP.md, paddingBottom: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  reviewStars: { fontSize: FS.sm, fontFamily: FONT.regular, color: GOLD, marginBottom: 2 },
  reviewBody: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, lineHeight: 20 },
  reviewDate: { fontSize: FS.meta, fontFamily: FONT.medium, color: SUBTLE, marginTop: 2 },
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
