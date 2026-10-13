import { hapticToggle, haptics, haptic } from '@/lib/haptics';

/**
 * Brandthread Buyer Product Detail
 * Variant selection, add to cart, buy now.
 */
import { track } from '@/lib/analytics';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { formatCalendarDate } from '@/lib/calendarDate';

import { allOptionsSelected, onlyVariantSelection } from '@/lib/buyerProductSelection';

import Reanimated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { goBackOr } from '@/lib/navigation/goBackOr';

import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, RefreshControl, Animated, Dimensions, PanResponder, Easing, AccessibilityInfo, AppState, Pressable, Share } from 'react-native';

import { useFocusEffect, useLocalSearchParams, usePathname, useRouter } from 'expo-router';

import { useQueryClient } from '@tanstack/react-query';

import { DETAIL_STALE_TIME_MS, queryKeys } from '@/lib/queryClient';

import { buildProductUrl } from '@/lib/shareLinks';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LinearGradient } from 'expo-linear-gradient';

import { formatMoney as formatCents } from '@/lib/format';


import { ApproxPrice } from '@/components/intl/ApproxPrice';
import { useColors } from '@/hooks/useColors';

import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';

import { useAppTheme, getOnAccentTextStyle } from '@/contexts/AppThemeContext';

import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';

import { addToCart, createBuyNowSession, replaceCartItemVariant, getCart, warmCart } from '@/services/cartService';

import { BuyerProduct, BuyerProductOption, BuyerProductVariant, CheckoutAttribution } from '@/services/cartTypes';

import { useApi } from '@/hooks/useApi';

import { invalidateSellerPaymentStatusCache } from '@/lib/api';

import { reportHref } from '@/lib/safety';

import { trackAndRelayConversionEvent } from '@/lib/marketingPixels';

import { useAuth } from '@clerk/expo';

import { useSignInGate } from '@/hooks/useSignInGate';

import { BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE, ON_DARK, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, GRAD_SUCCESS_G, FONT, FS, SP, RADIUS, COMP, ICON, TYPE } from '@/lib/theme';

import { ResponsiveContainer, StickyFooter } from '@/components/layout';

import { SaveHeart } from '@/components/SaveHeart';

import { CachedImage } from '@/components/CachedImage';

import { Button, IconButton, Chip, QuantityStepper, BottomSheet, Sheet, Avatar, SuccessCheck, SegmentedControl } from '@/components/ui';

import { PhotoViewer } from '@/components/media/PhotoViewer';
import { ProductPhoto, ProductPhotoPlaceholder } from '@/components/media/ProductPhoto';
import { productPhotoHeight } from '@/constants/media';
import { TYPE_SCALE } from '@/constants/typography';

import { SPACING } from '@/constants/spacing';

import { RADII, radius } from '@/constants/radii';



import { BuyerProtectionNote } from '@/components/BuyerProtectionNote';

import { LaunchCountdown } from '@/components/products/LaunchCountdown';

import { PreOrderShipBy } from '@/components/products/PreOrderShipBy';

import { ProductReviewsSection } from '@/components/ProductReviewsSection';

import { CompleteTheFit } from '@/components/products/CompleteTheFit';

import { BrandLink, brandLinkHref } from '@/components/products/BrandLink';

import { BundleOffer } from '@/components/products/BundleOffer';
import { MysteryBoxLabel } from '@/components/products/MysteryBoxLabel';
import { FitChecksStrip } from '@/components/products/FitChecksStrip';
import { ProductVideo } from '@/components/products/ProductVideo';

import { ProductShareButton } from '@/components/products/ProductShareButton';

import { ProductShippingLine } from '@/components/products/ProductShippingLine';

import { POLICY_NOT_LISTED, readSellerPolicies, readSellerShipping } from '@/lib/productTrust';

import { GalleryLoupe, useGalleryLoupe } from '@/components/products/GalleryLoupe';
import { GalleryVideoSlide, useGalleryVideo } from '@/components/products/GalleryVideoSlide';
import {
  chartUnitOf, colorImageFor, convertChartValue, galleryCountLabel, percentOff, readProductPageDetails,
  type ChartUnit, type ProductPageDetails,
} from '@/lib/productPageDetails';
import { InBagCount, ModelInfoLine, ProductDetailRows } from '@/components/products/ProductDetailRows';
import { SoldOutAlternatives } from '@/components/products/SoldOutAlternatives';
import { BagPlusOne } from '@/components/products/BagPlusOne';
import type { ProductVideoInfo } from '@/lib/api';
import { ProductQuestionsSection } from '@/components/ProductQuestionsSection';

import { SizeRecommendationBadge, RecommendedTag, useSizeBadgeModel } from '@/components/SizeRecommendationBadge';

import { BundleSaveSection } from '@/components/bundles/BundleSaveSection';

import { useRememberedSize } from '@/hooks/useRememberedSize';

import { messageSellerAboutProductHref, profileHref, profileVideosHref, resolveStoreVisitSource } from '@/lib/profileNavigation';

import { getPreviewBuyerProduct, getPreviewRelatedProducts, getPreviewSellerProducts, isPreviewProductId } from '@/lib/previewProducts';

import { splitRelatedByBrand } from '@/lib/relatedByBrand';
import { isPreviewSellerId } from '@/lib/previewCheckout';

import { isOwnerPreviewRow, sellerProductToBuyerProduct } from '@/lib/sellerProductPreview';

import { useHideTabBar } from '@/lib/tabBarVisibility';

import { getProduct as getLocalSellerProduct } from '@/services/productService';

import { useCartBadgeBump } from '@/hooks/useCartBadgeBump';

import { useMeasuredTarget } from '@/hooks/useMeasuredTarget';

import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';

import { BUYER_PRODUCT_DETAIL_SPOTLIGHT } from '@/lib/firstRunTips/content';

import { StockCounter } from '@/components/products/StockCounter';

import { ProductSellerRow } from '@/components/products/ProductSellerRow';

import { SizeSheet } from '@/components/products/SizeSheet';

import { Icon, Icon as AppIcon, type IconName } from '@/components/ui/Icon';

import { primaryOption, sizeCells } from '@/lib/sizeSheet';

import { useExpandFromTileOverlay } from '@/components/ExpandFromTileOverlay';

import { productTransitionKey } from '@/lib/tileTransition';

import { deliveryPromiseLine } from '@/lib/deliveryGuarantee';

import { useStockInfo, variantStockLine } from '@/lib/stockInfo';

import { PayLaterLine } from '@/components/products/PayLaterLine';

import { RecentlyViewedRow } from '@/components/RecentlyViewedRow';
import { Snackbar } from '@/components/ui/Snackbar';
import { useAutoSelectSize } from '@/hooks/useAutoSelectSize';
import { ApiError } from '@/lib/networkNotice';

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
import { ClaimedRemainingLabel, TimeRemainingLabel, UrgencyBar, DemandBadge, URGENCY_UNITS_THRESHOLD, HIGH_DEMAND_THRESHOLD } from '@/components/CommerceSignal';

import { useScreenInteractive } from '@/lib/perf';

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

export function adaptApiProductToBuyerProduct(row: any): BuyerProduct {
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
      compareAtPriceCents: v.compareAtPriceCents ?? undefined,
      inventoryQuantity: v.stock ?? 0,
      isAvailable:       (v.stock ?? 0) > 0,
      imageUri:          firstImage,
    };
  });

  const lowestPrice = variants.length > 0 ? Math.min(...variants.map(v => v.priceCents)) : 0;

  return {
    id:                 row.id,
    sellerId:           row.ownerId ?? row.sellerId,
    sellerName:         row.sellerDisplayName ?? 'Independent Seller',
    sellerHandle:       row.sellerUsername ?? '',
    sellerAvatarUri:    row.sellerAvatarUrl ?? undefined,
    name:               row.name,
    description:        row.description ?? '',
    priceCents:         lowestPrice,
    compareAtPriceCents: variants.find(v => v.priceCents === lowestPrice)?.compareAtPriceCents,
    imageUris:          row.images ?? [],
    category:           row.category ?? 'apparel',
    isPreOrder:           row.isPreOrder           ?? false,
    preOrderClosingDate:  row.preOrderClosingDate ? new Date(row.preOrderClosingDate).toISOString() : undefined,
    preOrderEstShipDate:  row.preOrderEstShipDate ? new Date(row.preOrderEstShipDate).toISOString() : undefined,
    ...readSellerPolicies(row), // seller's own text; '' when none (row says "Not listed")
    sellerShipping:     readSellerShipping(row),
    options,
    variants,
    isActive:           true,
    tags:               row.tags ?? [],
    sizeChartImageUrl:  row.sizeChartImageUrl ?? null,
    sizeChart:          row.sizeChart && typeof row.sizeChart === 'object' ? row.sizeChart : null,
  };
}

/**
 * Polish 93/94: the seller's one-photo-per-colour choice (migration 270)
 * becomes the colour swatch's photo and each variant's photo, so the swatch
 * shows the real colour and the bag line shows the colour that was picked.
 */
function withColorPhotos(product: BuyerProduct, colorImages: Record<string, string>): BuyerProduct {
  if (!Object.keys(colorImages).length) return product;
  const colorOption = product.options.find(o => o.id === 'opt_color');
  if (!colorOption) return product;
  const photoByValueId = new Map<string, string>();
  for (const value of colorOption.values) {
    const uri = colorImageFor(colorImages, value.label);
    if (uri) photoByValueId.set(value.id, uri);
  }
  if (!photoByValueId.size) return product;
  return {
    ...product,
    options: product.options.map(o => o.id !== 'opt_color' ? o : {
      ...o,
      values: o.values.map(v => photoByValueId.has(v.id) ? { ...v, imageUri: photoByValueId.get(v.id) } : v),
    }),
    variants: product.variants.map(v => {
      const color = v.optionValues.find(ov => ov.optionId === 'opt_color');
      const uri = color ? photoByValueId.get(color.valueId) : undefined;
      return uri ? { ...v, imageUri: uri } : v;
    }),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtPrice = formatCents;
/** How long Add to cart reads "In bag ✓" after a successful add (item 131). */
export const IN_BAG_CONFIRM_MS = 2000;
const GALLERY_WIDTH = Dimensions.get('window').width;
const GALLERY_HEIGHT = Math.min(productPhotoHeight(GALLERY_WIDTH), Dimensions.get('window').height * 0.6);

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

const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.5;

/**
 * One gallery photo: pinch to zoom (1–4x), drag to look around while zoomed,
 * double-tap to zoom in / back out. Panning is only enabled while zoomed so
 * an unzoomed photo still swipes the gallery; `onZoomChange` lets the
 * gallery lock paging while a photo is zoomed.
 */
function ZoomableGalleryImage({ uri, brand, name, onOpen, onZoomChange, onLoupeChange }: {
  uri: string;
  brand?: string;
  name?: string;
  onOpen?: () => void;
  onZoomChange?: (zoomed: boolean) => void;
  onLoupeChange?: (active: boolean) => void;
}) {
  const [failed, setFailed] = useState(false);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const [zoomed, setZoomedState] = useState(false);
  const loupe = useGalleryLoupe({enabled: !zoomed, onActiveChange: onLoupeChange});

  const setZoomed = useCallback((next: boolean) => {
    setZoomedState(next);
    onZoomChange?.(next);
  }, [onZoomChange]);

  const clampX = (x: number, sc: number) => {
    'worklet';
    const max = (GALLERY_WIDTH * sc - GALLERY_WIDTH) / 2;
    return Math.max(-max, Math.min(max, x));
  };
  const clampY = (y: number, sc: number) => {
    'worklet';
    const max = (GALLERY_HEIGHT * sc - GALLERY_HEIGHT) / 2;
    return Math.max(-max, Math.min(max, y));
  };

  const resetZoom = useCallback(() => {
    scale.value = withTiming(1, { duration: 200 });
    tx.value = withTiming(0, { duration: 200 });
    ty.value = withTiming(0, { duration: 200 });
    savedScale.value = 1;
    savedTx.value = 0;
    savedTy.value = 0;
    setZoomed(false);
  }, [scale, tx, ty, savedScale, savedTx, savedTy, setZoomed]);

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(MAX_ZOOM, savedScale.value * e.scale));
      tx.value = clampX(tx.value, scale.value);
      ty.value = clampY(ty.value, scale.value);
    })
    .onEnd(() => {
      if (scale.value < 1.06) {
        scale.value = withTiming(1, { duration: 200 });
        tx.value = withTiming(0, { duration: 200 });
        ty.value = withTiming(0, { duration: 200 });
        savedScale.value = 1;
        savedTx.value = 0;
        savedTy.value = 0;
        runOnJS(setZoomed)(false);
        return;
      }
      savedScale.value = scale.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      runOnJS(setZoomed)(true);
    });

  const pan = Gesture.Pan()
    .enabled(zoomed)
    .averageTouches(true)
    .onUpdate((e) => {
      tx.value = clampX(savedTx.value + e.translationX, scale.value);
      ty.value = clampY(savedTy.value + e.translationY, scale.value);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (savedScale.value > 1) {
        runOnJS(resetZoom)();
        return;
      }
      // Zoom toward the tapped point.
      const nextTx = clampX((GALLERY_WIDTH / 2 - e.x) * (DOUBLE_TAP_ZOOM - 1), DOUBLE_TAP_ZOOM);
      const nextTy = clampY((GALLERY_HEIGHT / 2 - e.y) * (DOUBLE_TAP_ZOOM - 1), DOUBLE_TAP_ZOOM);
      scale.value = withTiming(DOUBLE_TAP_ZOOM, { duration: 220 });
      tx.value = withTiming(nextTx, { duration: 220 });
      ty.value = withTiming(nextTy, { duration: 220 });
      savedScale.value = DOUBLE_TAP_ZOOM;
      savedTx.value = nextTx;
      savedTy.value = nextTy;
      runOnJS(setZoomed)(true);
    });

  const singleTap = Gesture.Tap().numberOfTaps(1).onEnd((_event, success) => {
    if (success && onOpen && savedScale.value <= 1) runOnJS(onOpen)();
  });
  const gesture = Gesture.Simultaneous(pinch, pan, Gesture.Exclusive(doubleTap, singleTap));
  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  if (failed) {
    return <ProductPhotoPlaceholder brand={brand} name={name} style={{ width: GALLERY_WIDTH, height: GALLERY_HEIGHT }} />;
  }

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width: GALLERY_WIDTH, height: GALLERY_HEIGHT, overflow: 'hidden' }} testID="product-gallery-photo" {...loupe.touchHandlers}>
        <Reanimated.View style={[StyleSheet.absoluteFill, imageStyle]}>
          <CachedImage
            source={{ uri }}
            onError={() => setFailed(true)}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessibilityLabel="Product photo. Pinch or double-tap to zoom."
          />
        </Reanimated.View>
        {loupe.point && <GalleryLoupe uri={uri} point={loupe.point} width={GALLERY_WIDTH} height={GALLERY_HEIGHT} />}
        {zoomed && (
          <TouchableOpacity style={galleryStyles.resetZoom} onPress={resetZoom} accessibilityRole="button" accessibilityLabel="Reset product photo zoom">
            <AppIcon name="minimize-2" size={14} color={ON_DARK} />
            <Text style={galleryStyles.resetZoomText}>Reset</Text>
          </TouchableOpacity>
        )}
      </View>
    </GestureDetector>
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
  galleryCount: {
    position: 'absolute', right: SP.md, bottom: SP.md,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: RADIUS.pill, backgroundColor: 'rgba(0,0,0,0.58)', // theme-exempt: same scrim as the zoom pill over the photo
  },
  dots: { position: 'absolute', bottom: 21, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  dot: { height: 6, borderRadius: 3, backgroundColor: ON_DARK },
  resetZoom: {
    position: 'absolute', right: SP.md, bottom: 56, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: 'rgba(0,0,0,0.65)',
  },
  resetZoomText: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: FS.xs },
  thumbRail: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  thumb: {
    width: 56, height: productPhotoHeight(56), borderRadius: RADIUS.sm, overflow: 'hidden',
    borderWidth: 2, borderColor: 'transparent',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbVideo: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)' }, // theme-exempt: scrim behind the play glyph
});

type GallerySlide = { kind: 'video'; uri: string; poster: string | null } | { kind: 'image'; uri: string };

export function ProductGallery({ imageUris, accentColor, video, focusUri, brand, name }: {
  brand?: string; name?: string;
  imageUris: string[];
  accentColor: string;
  /** Polish 83: the seller's product video leads the gallery. */
  video?: ProductVideoInfo | null;
  /** Polish 94: picking a colour pages the gallery to that colour's photo. */
  focusUri?: string;
}) {
  const images = imageUris.filter(Boolean);
  const slides: GallerySlide[] = [
    ...(video?.videoUrl ? [{ kind: 'video' as const, uri: video.videoUrl, poster: video.posterUrl }] : []),
    ...images.map(uri => ({ kind: 'image' as const, uri })),
  ];
  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef<Animated.FlatList<GallerySlide>>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loupeActive, setLoupeActive] = useState(false);
  const [zoomedPhoto, setZoomedPhoto] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!focusUri) return;
    const index = slides.findIndex(slide => slide.kind === 'image' && slide.uri === focusUri);
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, animated: true });
    setActiveIndex(index);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusUri]);

  if (!slides.length) {
    return (
      <ProductPhotoPlaceholder brand={brand} name={name} style={galleryStyles.gallery} />
    );
  }

  return (
    <View>
      <View style={galleryStyles.gallery}>
        <Animated.FlatList
          ref={listRef}
          data={slides}
          keyExtractor={(slide, index) => `${slide.kind}-${slide.uri}-${index}`}
          horizontal
          pagingEnabled
          scrollEnabled={!loupeActive && !zoomedPhoto}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item, index }) => item.kind === 'video'
            ? <GalleryVideoSlide video={video!} active={index === activeIndex} width={GALLERY_WIDTH} height={GALLERY_HEIGHT} />
            : <ZoomableGalleryImage uri={item.uri} brand={brand} name={name} onZoomChange={setZoomedPhoto} onOpen={() => setViewerIndex(images.indexOf(item.uri))} onLoupeChange={setLoupeActive} />}
          getItemLayout={(_, index) => ({ length: GALLERY_WIDTH, offset: GALLERY_WIDTH * index, index })}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false })}
          onMomentumScrollEnd={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / GALLERY_WIDTH);
            setActiveIndex(Math.max(0, Math.min(slides.length - 1, next)));
          }}
          scrollEventThrottle={16}
        />
        <View style={galleryStyles.galleryShade} pointerEvents="none" />
        {slides[activeIndex]?.kind !== 'video' && (
          <View style={galleryStyles.galleryMeta} pointerEvents="none">
            <AppIcon name="maximize-2" size={13} color={ON_DARK} />
            <Text style={galleryStyles.galleryMetaText}>Pinch to zoom</Text>
          </View>
        )}
        {/* Polish 81: "3/8" next to the dots. */}
        {galleryCountLabel(activeIndex, slides.length) && (
          <View style={galleryStyles.galleryCount} pointerEvents="none" testID="gallery-count">
            <Text style={galleryStyles.galleryMetaText} accessibilityLabel={`Photo ${activeIndex + 1} of ${slides.length}`}>
              {galleryCountLabel(activeIndex, slides.length)}
            </Text>
          </View>
        )}
        {slides.length > 1 && (
          <View style={galleryStyles.dots} pointerEvents="none">
            {slides.map((_, index) => {
              const width = scrollX.interpolate({
                inputRange: [(index - 1) * GALLERY_WIDTH, index * GALLERY_WIDTH, (index + 1) * GALLERY_WIDTH],
                outputRange: [6, 16, 6],
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
      {slides.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={galleryStyles.thumbRail}
        >
          {slides.map((slide, index) => (
            <TouchableOpacity
              key={`${slide.uri}-${index}`}
              onPress={() => {
                listRef.current?.scrollToIndex({ index, animated: true });
                setActiveIndex(index);
              }}
              style={[galleryStyles.thumb, index === activeIndex && { borderColor: accentColor }]}
              accessibilityRole="button"
              accessibilityLabel={slide.kind === 'video' ? 'Play product video' : `View photo ${index + 1} of ${slides.length}`}
              accessibilityState={{ selected: index === activeIndex }}
            >
              {slide.kind === 'video'
                ? (
                  <View style={[galleryStyles.thumbImage, galleryStyles.thumbVideo]}>
                    {slide.poster ? <CachedImage source={{ uri: slide.poster }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
                    <AppIcon name="play" size={16} color={ON_DARK} />
                  </View>
                )
                : <CachedImage source={{ uri: slide.uri }} style={galleryStyles.thumbImage} contentFit="cover" />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <PhotoViewer
        visible={viewerIndex != null}
        images={images}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
      />
    </View>
  );
}

// ─── Option Picker ────────────────────────────────────────────────────────────

export function OptionPicker({ product, option, selections, onSelect, recommendedLabel }: {
  /** Size chip to mark (never select) from the buyer's saved sizes. */
  recommendedLabel?: string | null;
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
      {/* Sizes sit on one row (item 130): a single horizontal line of chips,
          sold-out sizes crossed out, so the size row never pushes Add below
          the fold. Colour swatches keep their wrapping grid. */}
      <ChipRow oneRow={!isColor}>
        {option.values.map(val => {
          const isSelected = selections[option.id] === val.id;
          const { [option.id]: _ignored, ...rest } = selections;
          const available = isVariantComboAvailable(product, option.id, val.id, rest);

          if (isColor && val.imageUri) {
            return (
              <TouchableOpacity
                key={val.id}
                style={[op.photoSwatch, isSelected && op.photoSwatchSelected, !available && op.unavail]}
                onPress={() => { if (available) { hapticToggle(); onSelect(option.id, val.id); } }}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityLabel={`${option.name}, ${val.label}${available ? '' : ', unavailable'}`}
                accessibilityState={{ selected: isSelected, disabled: !available }}
                testID={`option-${option.id}-${val.id}`}
              >
                <CachedImage source={{ uri: val.imageUri }} style={op.photoSwatchImage} contentFit="cover" />
              </TouchableOpacity>
            );
          }

          if (isColor && val.colorHex) {
            return (
              <TouchableOpacity
                key={val.id}
                style={[
                  op.colorSwatch,
                  isSelected && op.colorSwatchSelected,
                  !available && op.unavail,
                ]}
                onPress={() => { hapticToggle(); onSelect(option.id, val.id); }}
                activeOpacity={0.8}
                accessibilityRole="radio"
                accessibilityLabel={`${option.name}, ${val.label}${available ? '' : ', unavailable'}`}
                accessibilityHint={available ? undefined : SOLD_OUT_HINT}
                accessibilityState={{ selected: isSelected, disabled: !available }}
              >
                <View style={[op.colorDot, { backgroundColor: val.colorHex }]} />
                {!available && <View style={op.slashOverlay}><Text style={op.slash}>✕</Text></View>}
              </TouchableOpacity>
            );
          }

          // Size: 44pt-tall outlined chips, solid white when selected (Nike
          // size grid, https://mobbin.com/screens/5163c408-ea2f-46d1-b945-ab33395eacd1).
          if (option.name.toLowerCase() === 'size') {
            const sizeEl = (
              <SizeChip
                key={val.id}
                label={val.label}
                selected={isSelected}
                available={available}
                accessibilityLabel={`${option.name}, ${val.label}${available ? '' : ', sold out'}`}
                onPress={() => onSelect(option.id, val.id)}
                testID={`option-${option.id}-${val.id}`}
              />
            );
            return recommendedLabel && recommendedLabel === val.label
              ? <View key={val.id} style={{ alignItems: 'center' }}>{sizeEl}<RecommendedTag /></View>
              : sizeEl;
          }

          const chipEl = (
            <Chip
              key={val.id}
              label={val.label}
              selected={isSelected}
                      // A leading slash glyph makes "unavailable" a distinct shape,
              // not just a greyed-out label (Nike / GOAT / UNIQLO size-grid
              // convention) — see https://mobbin.com/screens/76430e6c-342a-42be-8fce-148ab5d9651e
              icon={available ? undefined : 'slash'}
              iconColor={theme.subtle}
              strikethrough={!available}
              // Sold out keeps its look but stays selectable, so the buyer
              // reaches "Notify me" (Zalando stock reminder).
              pressableWhenDisabled
              accessibilityHint={available ? undefined : SOLD_OUT_HINT}
              accessibilityRole="radio"
              accessibilityLabel={`${option.name}, ${val.label}${available ? '' : ', sold out'}`}
              onPress={() => onSelect(option.id, val.id)}
              testID={`option-${option.id}-${val.id}`}
            />
          );
          return recommendedLabel && recommendedLabel === val.label
            ? <View key={val.id} style={{ alignItems: 'center' }}>{chipEl}<RecommendedTag /></View>
            : chipEl;
        })}
      </ChipRow>
    </View>
  );
}

function ChipRow({ oneRow, children }: { oneRow: boolean; children: React.ReactNode }) {
  const { theme } = useThemeAliases();
  const op = makeOptionStyles(theme);
  if (!oneRow) return <View style={op.chips}>{children}</View>;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={op.chipRowScroll}
      contentContainerStyle={op.chipRow}
      testID="product-size-row"
    >
      {children}
    </ScrollView>
  );
}

function SizeChip({ label, selected, available, onPress, accessibilityLabel, testID }: {
  label: string;
  selected: boolean;
  available: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const { theme } = useThemeAliases();
  return (
    <Pressable
      onPress={() => { hapticToggle(); onPress(); }}
      disabled={!available}
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      testID={testID}
      style={[
        sizeChipStyles.chip,
        selected
          ? { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' } // theme-exempt: spec — selected size is solid white
          : { backgroundColor: 'transparent', borderColor: theme.border },
      ]}
    >
      {/* Sold out keeps its distinct shape: slash glyph + struck label. */}
      {!available && <AppIcon name="slash" size={12} color={theme.subtle} />}
      <Text
        style={[
          sizeChipStyles.label,
          { color: selected ? '#000000' : available ? theme.text : theme.subtle }, // theme-exempt: black on the white selected chip
          !available && { textDecorationLine: 'line-through' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const sizeChipStyles = StyleSheet.create({
  chip: {
    height: 44, minWidth: 56, paddingHorizontal: 14, borderWidth: 1, borderRadius: radius.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '500' },
});

/** Full-width 56pt row with a chevron (Details / Fit / Returns). */
function InfoRow({ label, expanded, onPress, opensSheet = false, children, testID }: {
  label: string;
  expanded?: boolean;
  onPress: () => void;
  /** Opens a sheet instead of expanding in place — chevron points right. */
  opensSheet?: boolean;
  children?: React.ReactNode;
  testID?: string;
}) {
  const { theme } = useThemeAliases();
  return (
    <View style={[infoRowStyles.wrap, { borderTopColor: theme.border }]}>
      <TouchableOpacity
        style={infoRowStyles.row}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={opensSheet ? undefined : { expanded: !!expanded }}
        testID={testID}
      >
        <Text style={[infoRowStyles.label, { color: theme.text }]}>{label}</Text>
        <AppIcon
          name={opensSheet ? 'chevron-right' : expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={theme.muted}
        />
      </TouchableOpacity>
      {!opensSheet && expanded ? <View style={infoRowStyles.body}>{children}</View> : null}
    </View>
  );
}

const infoRowStyles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: SP.md },
  row: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 16, lineHeight: 21, fontWeight: '500' },
  body: { paddingBottom: SP.md },
});
const SOLD_OUT_HINT = 'Select to set a restock reminder';

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
  // Bleeds to the screen edges so the row scrolls under the gutter.
  chipRowScroll: { marginHorizontal: -SP.md },
  chipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.sm, paddingHorizontal: SP.md },
  colorSwatch: {
    width: 44, height: 44, borderRadius: RADII.chip,
    borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchSelected: { borderColor: PURPLE },
  colorDot: { width: 28, height: 28, borderRadius: RADII.chip - 2 },
  // lululemon's round photo swatch: the colour's own photo, ringed when picked.
  photoSwatch: {
    width: 48, height: 48, borderRadius: 24, padding: 3,
    borderWidth: 2, borderColor: 'transparent',
  },
  photoSwatchSelected: { borderColor: theme.text },
  photoSwatchImage: { width: '100%', height: '100%', borderRadius: 19, backgroundColor: theme.card },
  unavail: { opacity: 0.4 },
  slashOverlay: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  slash: { fontSize: 17, color: RED, fontFamily: FONT.bold },
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
  const { productId, sourcePostId, sourceTagId, editVariantId, editCartItemId, src, localPreview } = useLocalSearchParams<{
    productId?: string;
    /** "1": the seller's "Preview as buyer" for a product stored only on this device. */
    localPreview?: string;
    sourcePostId?: string;
    sourceTagId?: string;
    editVariantId?: string;
    editCartItemId?: string;
    src?: string;
  }>();
  const router = useRouter();
  const stockInfo = useStockInfo(productId);
  const pathname = usePathname();
  const { push, back } = useThreadPull();
  const usesThreadPull = pathname === '/thread-product-detail';
  const leaveProduct = () => usesThreadPull ? back() : goBackOr(router, '/(buyer)/discover');
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const api    = useApi();
  const { isSignedIn } = useAuth();
  const { goToSignIn } = useSignInGate();
  // Shared-element feel: the tapped product tile's photo grows into the
  // gallery. Only on the un-animated thread route (a slide-in push would
  // fight it); a deep link or back navigation has no handoff and no-ops.
  const { overlay: tileExpandOverlay } = useExpandFromTileOverlay(
    pathname === '/thread-product-detail' && productId ? productTransitionKey(productId) : undefined,
    { x: 0, y: 0, width: GALLERY_WIDTH, height: GALLERY_HEIGHT },
  );
  const queryClient = useQueryClient();

  // Cache-first: a row warmed by the tile's press-in prefetch (or a recent
  // visit) paints the page on the first frame; the effect below still
  // refreshes it. See hooks/useProductPrefetch.ts.
  const cachedProductRow = (): any => {
    if (!productId) return undefined;
    const row = queryClient.getQueryData<any>(queryKeys.publicProduct(productId));
    return row && !row.error ? row : undefined;
  };
  const [product, setProduct] = useState<BuyerProduct | null>(() => {
    const row = cachedProductRow();
    return row ? adaptApiProductToBuyerProduct(row) : null;
  });
  const sizeBadgeModel = useSizeBadgeModel(product);
  const [loading, setLoading] = useState(() => !cachedProductRow());
  useScreenInteractive('product-detail', !loading);
  const [loadFailed, setLoadFailed] = useState(false);
  // Set when the product 404s but the server named whose drop it was.
  const [goneBrand, setGoneBrand] = useState<{ sellerId: string; sellerName: string } | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [selections, setSelections] = useState<Record<string, string>>({});
  useRememberedSize(product, selections, setSelections);
  const [qty, setQty] = useState(1);
  const [addingToCart, setAddingToCart] = useState(false);
  const [buyingNow, setBuyingNow] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const { ref: actionBarRef, rect: actionBarRect, onLayout: actionBarOnLayout } = useMeasuredTarget();
  const [sellerPaymentReady, setSellerPaymentReady] = useState<boolean | null>(null);
  const [sellerPaymentReason, setSellerPaymentReason] = useState<string | null>(null);
  const [sellerVacationMessage, setSellerVacationMessage] = useState<string | null>(null);
  // The seller's own not-yet-buyable product ("Preview as buyer"): a draft /
  // archived product the API serves only to its owner (`previewOnly`), or one
  // stored only on this device. Shown, never sold.
  const [sellerPreview, setSellerPreview] = useState<null | 'server' | 'local'>(null);
  // The seller's own tab bar would sit over the purchase bar on their preview.
  useHideTabBar(!!sellerPreview);
  const [refreshing, setRefreshing] = useState(false);
  // Track whether options were touched at least once (for required-option feedback)
  const [optionsTouched, setOptionsTouched] = useState(false);
  // Track added-to-bag confirmation to show a banner (auto-clears after 2s)
  const addedBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Waitlist & pre-order reservation state
  const [launching, setLaunching] = useState(false);
  const [waitlistJoined,  setWaitlistJoined]  = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [reserved,        setReserved]        = useState(false);
  const [reserveLoading,  setReserveLoading]  = useState(false);
  const [sizeGuideOpen,   setSizeGuideOpen]   = useState(false);
  const [sizeSheetOpen,   setSizeSheetOpen]   = useState(false);
  const [sizeChartOpen, setSizeChartOpen] = useState(false);
  const [detailsOpen,     setDetailsOpen]     = useState(false);
  const [returnsOpen,     setReturnsOpen]     = useState(false);
  // Top bar turns solid (with the product name) once the photo has scrolled
  // under it. A ref guards the setState so scrolling only re-renders on the
  // crossing itself.
  const [pastPhoto, setPastPhoto] = useState(false);
  const pastPhotoRef = useRef(false);
  const [reminderToast,   setReminderToast]   = useState<string | null>(null);
  const reminderToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Add to cart → the product photo flies to the bag icon, which bumps and
  // shows the count (the feed / shop sheet pattern, #287 / #291).
  const [cartCount, setCartCount] = useState(0);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const { scale: cartPulse, bump: bumpCart } = useCartBadgeBump(reduceMotion);
  const cartTargetRef = useRef<View>(null);
  const galleryRef = useRef<View>(null);
  // Confirm the bag against the server while the buyer browses, so "Add to
  // bag" completes locally on the tap instead of waiting on a round trip.
  useEffect(() => { warmCart(); }, []);
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
  // Polish 87/88/93/94: seller-set model line, fabric/care/origin, colour photos.
  const [pageDetails, setPageDetails] = useState<ProductPageDetails | null>(null);
  // Polish 103: "+N" off the bag icon on each successful add.
  const [bagPlusOne, setBagPlusOne] = useState({ trigger: 0, quantity: 1 });
  // Polish 83: the product video leads the gallery when the seller added one.
  const galleryVideo = useGalleryVideo(productId);

  useEffect(() => {
    let cancelled = false;

    // A cached row (press-in prefetch / recent visit) shows immediately; the
    // fetch below then refreshes it in place. A manual retry always reloads.
    const seededRow = reloadTick === 0 ? cachedProductRow() : undefined;
    if (seededRow) {
      setProduct(adaptApiProductToBuyerProduct(seededRow));
      setLoading(false);
    } else {
      setLoading(true);
    }
    setLoadFailed(false);
    setGoneBrand(null);
    setSellerPaymentReady(null);
    setSellerPaymentReason(null);
    setSellerPreview(null);

    (async () => {
      try {
        let prod: BuyerProduct | null = null;
        let paymentStatus: { ready: boolean; reason?: string } | null = null;
        let previewKind: null | 'server' | 'local' = null;
        let keepSeeded = false;

        // "Preview as buyer" for a product that exists only in this device's
        // product store (signed-out web preview save, or a seeded demo product).
        if (productId && localPreview === '1') {
          const local = await getLocalSellerProduct(productId).catch(() => undefined);
          if (local) {
            prod = sellerProductToBuyerProduct(local);
            previewKind = 'local';
          }
        }

        // Synthetic catalog IDs have no server record. Resolve them only through
        // the explicit web-demo gate, never through public commerce endpoints.
        if (productId && !prod && isPreviewProductId(productId)) {
          prod = getPreviewBuyerProduct(productId);
          if (prod) previewKind = 'local';
        }
        if (productId && !prod && !isPreviewProductId(productId)) {
          // Load the live product from the public API.
          // DB product UUIDs from the discover feed carry real variant IDs
          // so the checkout server can look them up correctly.
          try {
            const row = await queryClient.fetchQuery({
              queryKey: queryKeys.publicProduct(productId),
              queryFn: () => api.publicProducts.get(productId),
              staleTime: reloadTick === 0 ? DETAIL_STALE_TIME_MS : 0,
            });
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
                setPageDetails(readProductPageDetails(row));
              }
              // Adapt the product and check payment readiness together as soon
              // as the product supplies the seller ID. A payment-status failure
              // is non-fatal: Buy Now performs its own safety check on tap.
              if (isOwnerPreviewRow(row)) previewKind = 'server';
              [prod, paymentStatus] = await Promise.all([
                Promise.resolve(withColorPhotos(adaptApiProductToBuyerProduct(row), readProductPageDetails(row).colorImages)),
                row.ownerId && isSignedIn && !isOwnerPreviewRow(row)
                  ? api.buyer.sellerPaymentStatus(row.ownerId).catch(() => null)
                  : Promise.resolve(null),
              ]);
            }
          } catch (loadError) {
            // A missing product (404) reads as not found; any other failure is a
            // load problem and gets a retry instead of a misleading dead end —
            // unless a cached copy is already on screen, which then simply stays.
            const notFound = loadError instanceof ApiError && loadError.status === 404;
            if (!notFound && seededRow) keepSeeded = true;
            else if (!notFound && !cancelled) setLoadFailed(true);
            if (notFound && !cancelled) setGoneBrand(goneBrandFrom(loadError as ApiError));
          }
        }
        // Dev-web preview only: a seeded `preview-product-*` has no catalog
        // row, so the real request fails. Build the same BuyerProduct from
        // the preview catalog (lib/previewProducts.ts; null for real ids and
        // in production) so the page, sizes, cart and checkout all run.
        if (!prod && isPreviewProductId(productId)) prod = getPreviewBuyerProduct(productId);
        // productName-only navigation is not supported; all entry points
        // must supply a productId so real variant data is loaded.

        if (!cancelled) {
          if (!keepSeeded) setProduct(prod);
          setSellerPreview(prod ? previewKind : null);
          if (paymentStatus) {
            setSellerPaymentReady(paymentStatus.ready);
            setSellerPaymentReason(paymentStatus.reason ?? null);
          }
          // Best-effort — a failed view record should never affect the
          // product page itself, so no error handling beyond swallowing it.
          if (prod?.id && isSignedIn && !previewKind) api.buyer.recentlyViewed.record(prod.id).catch(() => {});
          if (prod?.id && !previewKind) track('product_viewed', { surface: 'detail' });
        }
      } catch {}
      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [productId, reloadTick, localPreview]);

  // Live refresh: a seller's price / stock edit shows when the buyer comes
  // back to this page (screen focus) or to the app (foreground). Silent — no
  // loader, no re-recorded view or analytics — and it only replaces the
  // product when something actually changed, so selections and layout stay put.
  const silentRefreshProduct = useCallback(async () => {
    if (!productId || isPreviewProductId(productId)) return;
    try {
      const row = await api.publicProducts.get(productId);
      if (!row || row.error) return;
      const next = adaptApiProductToBuyerProduct(row);
      setProduct(prev => {
        if (!prev || prev.id !== next.id) return prev;
        return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
      });
      setSellerVacationMessage(
        row.sellerVacationMode
          ? row.sellerVacationMessage ?? 'This seller is currently away and is not accepting purchases.'
          : null,
      );
      setDemandClaimedUnits(typeof row.claimedUnits  === 'number' ? row.claimedUnits  : 0);
      setDemandRemainingUnits(typeof row.remainingUnits === 'number' ? row.remainingUnits : 0);
      setDemandCount(typeof row.demandCount === 'number' ? row.demandCount : null);
      setDemandEndsAt(row.endsAt ?? null);
    } catch {
      // Keep what's on screen; the next focus / foreground tries again.
    }
  }, [api, productId]);

  // The first focus is the mount, which the load effect above already covers.
  const focusedOnceRef = useRef(false);
  useFocusEffect(useCallback(() => {
    if (!focusedOnceRef.current) { focusedOnceRef.current = true; return; }
    void silentRefreshProduct();
  }, [silentRefreshProduct]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void silentRefreshProduct();
    });
    return () => sub.remove();
  }, [silentRefreshProduct]);

  // Real per-source traffic tracking for the seller's own Dashboard — a
  // signed-out shopper's visit still counts, so this never gates on
  // isSignedIn. Fire-and-forget, never blocks this screen's own render.
  useEffect(() => {
    if (!product?.id || !product.sellerId || sellerPreview) return;
    api.publicSellers
      .recordStoreVisit(product.sellerId, { source: resolveStoreVisitSource(src), productId: product.id })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, product?.sellerId, sellerPreview]);

  // Meta Pixel + Conversions API — ViewContent, once per loaded product. This
  // is the real buyer-facing product page (product-detail.tsx is the seller's
  // own management view), so it's the correct place to fire ViewContent.
  useEffect(() => {
    if (!product?.id || sellerPreview) return;
    void trackAndRelayConversionEvent(
      'ViewContent',
      { content_ids: [product.id], content_type: 'product', value: product.priceCents / 100, currency: 'usd' },
      { productId: product.id, valueCents: product.priceCents, currency: 'usd' },
    );
  }, [product?.id, sellerPreview]);

  // One-size / single-variant products: nothing to choose, so it's chosen.
  useEffect(() => {
    if (!product || editVariantId) return;
    const only = onlyVariantSelection(product);
    if (only) setSelections(only);
  }, [product, editVariantId]);

  useEffect(() => {
    if (!product || !editVariantId) return;
    const cartVariant = product.variants.find(candidate => candidate.id === editVariantId);
    if (!cartVariant) return;
    setSelections(Object.fromEntries(cartVariant.optionValues.map(value => [value.optionId, value.valueId])));
  }, [product, editVariantId]);

  // "Your size" preselected once per product (never over a cart edit or a tap).
  useAutoSelectSize({
    product,
    selections,
    badgeModel: sizeBadgeModel,
    enabled: !editVariantId,
    onSelect: (optionId, valueId) => setSelections(prev => (prev[optionId] ? prev : { ...prev, [optionId]: valueId })),
  });

  useEffect(() => () => { if (reminderToastTimer.current) clearTimeout(reminderToastTimer.current); }, []);

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
        {tileExpandOverlay}
      </View>
    );
  }

  if (!product) {
    // Compact error/not-found state with retry
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent' }}>
        <View style={{ height: GALLERY_HEIGHT, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', gap: SP.md, paddingHorizontal: SP.lg }}>
          <AppIcon name={loadFailed ? 'alert-circle' : 'package'} size={ICON.xl} color={loadFailed ? RED : FG} />
          <Text style={{ color: FG, fontFamily: FONT.semibold, fontSize: FS.base, textAlign: 'center' }}>{loadFailed ? "Couldn't load this product" : 'This drop is gone'}</Text>
          {loadFailed ? (
            <Text style={{ color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 20 }}>
              Check your connection and try again.
            </Text>
          ) : null}
          {loadFailed ? (
            <Button label="Retry" onPress={() => setReloadTick((n) => n + 1)} variant="secondary" size="small" icon="refresh-cw" />
          ) : goneBrand ? (
            <Button
              label={`Visit ${goneBrand.sellerName}`}
              onPress={() => router.replace(profileHref({ userId: goneBrand.sellerId, accountType: 'seller' }) as never)}
              variant="secondary"
              size="small"
              testID="product-gone-brand-link"
            />
          ) : (
            <Button label="Go back" onPress={leaveProduct} variant="secondary" size="small" icon="chevron-left" />
          )}
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

  const sizeChart = product.sizeChart && Array.isArray((product.sizeChart as SizeChart).columns) && (product.sizeChart as SizeChart).columns.length > 0
    ? product.sizeChart as SizeChart
    : null;
  const hasSizeGuide = !!sizeChart || !!product.sizeChartImageUrl;

  const variant = findVariant(product, selections);
  const variantPrice = variant?.priceCents ?? product.priceCents;
  const variantCompare = variant?.compareAtPriceCents ?? product.compareAtPriceCents;
  const hasDiscount = variantCompare && variantCompare > variantPrice;
  const savingsAmt = hasDiscount ? variantCompare! - variantPrice : 0;
  const allSelected = allOptionsSelected(product, selections);
  const inStock = variant ? variant.isAvailable && variant.inventoryQuantity > 0 : true;
  const maxQty = variant ? Math.max(1, variant.inventoryQuantity) : 10;
  const stockLine = variant ? variantStockLine(variant, stockInfo) : null;
  const paymentUnavailable = sellerPaymentReady === false;
  // GOAT: the size is picked in a sheet (price under each size), not chips.
  const sizeOption = primaryOption(product);
  const sizeOptionId = sizeOption?.id ?? null;
  const { [sizeOptionId ?? '']: _pickedSize, ...otherSelections } = selections;
  const cells = sizeOption ? sizeCells(product, sizeOption, otherSelections) : [];
  const openSizeSheet = () => { haptics.light(); setSizeSheetOpen(true); };

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
      goToSignIn();
      return;
    }
    setWaitlistLoading(true);
    try {
      await (api as any).waitlist.join(product.id, variant.id);
      setWaitlistJoined(true);
      showReminderToast('Reminder set');
    } catch { Alert.alert('Error', 'Could not join waitlist. Please try again.'); }
    finally { setWaitlistLoading(false); }
  }

  async function handleLeaveWaitlist() {
    if (!product || !variant || !isSignedIn) return;
    hapticToggle();
    setWaitlistLoading(true);
    try {
      await api.waitlist.leave(product.id, variant.id);
      setWaitlistJoined(false);
      showReminderToast('Reminder removed');
    } catch { Alert.alert('Error', 'Could not remove the reminder. Please try again.'); }
    finally { setWaitlistLoading(false); }
  }

  function showReminderToast(message: string) {
    setReminderToast(message);
    if (reminderToastTimer.current) clearTimeout(reminderToastTimer.current);
    reminderToastTimer.current = setTimeout(() => setReminderToast(null), 2500);
  }

  async function handleReserve() {
    if (!product || sellerPreview) return;
    if (!isSignedIn) {
      goToSignIn();
      return;
    }
    setReserveLoading(true);
    try {
      await (api as any).buyer.reserve(product.id);
      setReserved(true);
      Alert.alert('Reserved', "Spot secured. We'll notify you once production is confirmed.");
    } catch { Alert.alert("Couldn't reserve your spot", 'Try again.'); }
    finally { setReserveLoading(false); }
  }

  async function handleAddToCart() {
    if (sellerPreview) return;
    if (sizeOptionId && !selections[sizeOptionId]) { openSizeSheet(); return; }
    if (!allSelected) {
      // Mark options as touched so unselected options show a required indicator
      setOptionsTouched(true);
      haptic('addToBag');
      return;
    }
    if (!variant) return;
    // One haptic per add (the Success one below), per the haptics rule.
    setAddingToCart(true);
    const result = editCartItemId
      ? await replaceCartItemVariant(editCartItemId, product!, variant, qty)
      : await addToCart({ product: product!, variant, quantity: qty, attribution });
    setAddingToCart(false);
    if (result.success) {
      // Item 131: the button itself says "In bag ✓" for 2s, then goes back
      // to "Add to cart". No sheet and no flying photo (item 148: the seller
      // swipe glow is the app's only "wow" motion); the bag badge count
      // changing is the one other signal that something happened.
      setAddedToCart(true);
      setCartCount(result.cart.items.reduce((sum, item) => sum + item.quantity, 0));
      bumpCart();
      setBagPlusOne(prev => ({ trigger: prev.trigger + 1, quantity: qty }));
      // Auto-clear the icon-button checkmark after 2.5s; the sheet itself
      // stays open until the buyer taps View bag or Keep shopping.
      if (addedBannerTimerRef.current) clearTimeout(addedBannerTimerRef.current);
      addedBannerTimerRef.current = setTimeout(() => setAddedToCart(false), IN_BAG_CONFIRM_MS);
    } else {
      Alert.alert("Couldn't add to cart", result.message ?? 'Try again.');
    }
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
      goToSignIn();
      return;
    }
    router.push(messageSellerAboutProductHref({
      sellerId: product.sellerId,
      sellerName: product.sellerName,
      productId: product.id,
      productName: product.name,
      productPriceCents: variantPrice,
      productImageUri: product.imageUris[0] ?? null,
    }) as never);
  }

  function handleShare() {
    if (!product) return;
    const link = buildProductUrl(product.id);
    Share.share(link ? { message: `${product.name} — ${link}`, url: link } : { message: product.name }).catch(() => {});
  }

  const topBarHeight = headerTopInset + SP.sm * 2 + COMP.iconBtn;

  async function handleBuyNow() {
    if (sellerPreview) return;
    if (sellerVacationMessage) {
      Alert.alert('Seller is away', sellerVacationMessage);
      return;
    }
    if (sizeOptionId && !selections[sizeOptionId]) { openSizeSheet(); return; }
    if (!allSelected) {
      setOptionsTouched(true);
      haptics.warning();
      return;
    }
    if (!variant) return;
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
              'Payments unavailable',
              status.reason ?? 'This seller can\'t accept payments right now. Try again later.',
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
      Alert.alert("Couldn't start checkout", 'Try again.');
    }
    setBuyingNow(false);
  }

  return (
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const next = e.nativeEvent.contentOffset.y > GALLERY_HEIGHT - topBarHeight;
          if (next !== pastPhotoRef.current) { pastPhotoRef.current = next; setPastPhoto(next); }
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={PURPLE}
          />
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + 184 }}
      >
        {/* Immersive product gallery */}
        <View style={s.imageArea} ref={galleryRef} collapsable={false}>
          <ProductGallery imageUris={product.imageUris} accentColor={PURPLE} video={galleryVideo} focusUri={product.options.find(o => o.id === "opt_color")?.values.find(v => v.id === selections.opt_color)?.imageUri} brand={product.sellerName} name={product.name} />
          {sellerPreview && (
            <View
              style={[s.previewMarkerWrap, { top: headerTopInset + SP.sm + 8 }]}
              pointerEvents="none"
              testID="product-seller-preview-marker"
            >
              <View style={s.previewMarker}>
                <AppIcon name="eye" size={12} color="#FFFFFF" />
                <Text style={s.previewMarkerText}>Preview</Text>
              </View>
            </View>
          )}
        </View>

        <ResponsiveContainer style={s.body}>
          {/* Polish 87: lululemon's model line, directly under the photos. */}
          <ModelInfoLine details={pageDetails} />
          {/* Badges */}
          <View style={s.badgeRow}>
            {product.isPreOrder && (
              <View style={s.preOrderBadge}>
                <AppIcon name="clock" size={12} color={CYAN} />
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
          {/* Brand above the name, tappable to the store (item 136; SSENSE
              product page: designer name, then product name, then price). */}
          <BrandLink
            sellerId={product.sellerId}
            name={product.sellerName}
            style={s.brandLink}
            testID="product-brand-link"
          />
          <Text style={s.productName} numberOfLines={3}>{product.name}</Text>
          <MysteryBoxLabel productId={product.id} />
          {/* Price */}
          <View style={s.priceRow}>
            <Text style={s.price}>{formatCents(variantPrice)}</Text>
            {hasDiscount && <Text style={s.comparePrice}>{fmtPrice(variantCompare!)}</Text>}
            {hasDiscount && (
              <Text style={s.savings}>
                {percentOff(variantPrice, variantCompare) != null ? `${percentOff(variantPrice, variantCompare)}% off` : `Save ${fmtPrice(savingsAmt)}`}
              </Text>
            )}
          </View>
          <ProductShippingLine shipping={product.sellerShipping} />
          <PayLaterLine sellerId={product.sellerId} priceCents={variantPrice} />
          {/* Polish 91: real counts from other shoppers' bags, shown from 3. */}
          <InBagCount productId={product.id} />

          {!sellerPreview && <LaunchCountdown productId={product.id} onLaunchingChange={setLaunching} />}

          {!sellerPreview && <StockCounter productId={product.id} />}
          {sellerPreview && (
            <Text style={s.previewNote} testID="product-seller-preview-note">
              {sellerPreview === 'local'
                ? 'Saved on this device only. Buyers can’t see or buy it.'
                : 'Only you can see this. Buyers can buy it once it’s active.'}
            </Text>
          )}

           {paymentUnavailable && (
             <View style={s.paymentWarningBanner} accessibilityRole="alert">
               <AppIcon name="alert-triangle" size={ICON.xs} color={ORANGE} />
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
              <AppIcon name="sun" size={ICON.sm} color={ORANGE} />
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
                <AppIcon name="clock" size={ICON.sm} color={CYAN} />
                <Text style={s.preOrderTitle}>Pre-Order Item</Text>
              </View>
              {product.preOrderClosingDate && (
                <Text style={s.preOrderDetail}>
                  Pre-order closes: {new Date(product.preOrderClosingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </Text>
              )}
              {product.preOrderEstShipDate && (
                <Text style={s.preOrderDetail}>
                  Est. ship date: {formatCalendarDate(product.preOrderEstShipDate, { month: 'long', day: 'numeric', year: 'numeric' })}
                </Text>
              )}
              <Text style={s.preOrderDisclaimer}>
                Production and ship dates are estimates and may change. You will be notified of any updates.
              </Text>
            </View>
          )}

          <PreOrderShipBy productId={product.id} isPreOrder={product.isPreOrder} />

          {/* The delivery guarantee (docs/payments/delivery-guarantee.md):
              not delivered in time → refunded automatically. */}
          <View style={s.promiseRow} testID="product-delivery-promise">
            <Icon name="truck" size={17} color={FG} />
            <Text style={s.promiseText}>{deliveryPromiseLine(!!product.isPreOrder)}</Text>
          </View>
          {/* Intl #107: approximate price in the buyer's display currency (nothing when USD / off). */}
          <ApproxPrice cents={variantPrice} style={{ marginTop: -SP.sm, marginBottom: SP.md }} />

          {/* No rule between price and sizes (SSENSE runs price straight into
              the size picker): keeps the size row above the fold (item 129). */}
          <View style={{ height: SP.sm }} />

          {/* Options — unselected options highlight after the buyer attempts to add */}
          {product.options.map(option => {
            const isUnselected = optionsTouched && !selections[option.id];
            return (
              <View key={option.id}>
                {option.name.toLowerCase() === 'size' && <SizeRecommendationBadge model={sizeBadgeModel} />}
                {option.id === sizeOptionId ? (
                  <Pressable
                    style={s.sizeRow}
                    onPress={openSizeSheet}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.name}: ${option.values.find(v => v.id === selections[option.id])?.label ?? 'select'}`}
                    testID="product-size-row"
                  >
                    <Text style={s.sizeRowLabel}>{option.name}</Text>
                    <Text style={[s.sizeRowValue, !selections[option.id] && { color: MUTED }]}>
                      {option.values.find(v => v.id === selections[option.id])?.label ?? 'Select'}
                    </Text>
                    <Icon name="chevron-right" size={17} color={MUTED} />
                  </Pressable>
                ) : (
                <OptionPicker
                  recommendedLabel={option.name.toLowerCase() === 'size' && sizeBadgeModel?.kind === 'recommend' ? sizeBadgeModel.size : null}
                  product={product}
                  option={option}
                  selections={selections}
                  onSelect={handleSelect}
                />
                )}
                {isUnselected && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: -SP.sm, marginBottom: SP.sm }}>
                    <AppIcon name="alert-circle" size={12} color={RED} />
                    <Text style={{ fontSize: FS.xs, fontFamily: FONT.medium, color: RED }}>
                      Please select a {option.name.toLowerCase()}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}

          {/* Demand signals sit under the sizes so photo, name, price, size
              and Add all fit above the fold (item 129). */}
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

          {/* Size guide remains available only when supplied by the seller. */}
          {hasSizeGuide && (
            <TouchableOpacity
              style={s.sizeGuideLink}
              onPress={() => { haptic('sheet'); setSizeGuideOpen(true); }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Size guide"
              testID="product-size-guide-link"
            >
              <AppIcon name="maximize" size={13} color={PURPLE_LIGHT} />
              <Text style={[s.sizeGuideLinkText, { color: PURPLE_LIGHT }]}>Size guide</Text>
            </TouchableOpacity>
          )}

          {/* Stock status */}
          {allSelected && variant && stockLine && stockLine.kind !== 'hidden' && (
            <View style={s.stockRow} testID="product-stock-line">
              {/* Monochrome (no green/red): low stock is white and bold,
                  plain in-stock and sold-out are grey. Threshold and
                  de-duplication with <StockCounter>: lib/stockLine.ts. */}
              <View style={[s.stockDot, {
                backgroundColor: stockLine.kind === 'low' ? FG : stockLine.kind === 'in' ? MUTED : SUBTLE,
              }]} />
              <Text style={[
                s.stockText,
                stockLine.kind === 'low'
                  ? { color: FG, fontFamily: FONT.bold }
                  : { color: MUTED },
              ]}>
                {stockLine.text}
              </Text>
            </View>
          )}

          {/* Waitlist — shown when selected variant is OOS and not pre-order */}
          {allSelected && variant && !variant.isAvailable && !product.isPreOrder && (
            <TouchableOpacity
              style={[wl.btn, waitlistJoined && wl.joined]}
              onPress={waitlistJoined ? handleLeaveWaitlist : handleJoinWaitlist}
              disabled={waitlistLoading}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={waitlistJoined ? 'Reminder set' : 'Notify me when back in stock'}
              accessibilityHint={waitlistJoined ? 'Removes the restock reminder' : undefined}
              accessibilityState={{ disabled: waitlistLoading, busy: waitlistLoading }}
              testID="product-notify-me"
            >
              {waitlistLoading ? (
                <ActivityIndicator size="small" color={PURPLE_LIGHT} />
              ) : (
                <>
                  <AppIcon name={waitlistJoined ? 'check' : 'bell'} size={14} color={waitlistJoined ? SUCCESS : PURPLE_LIGHT} />
                  <Text style={[wl.text, waitlistJoined && { color: SUCCESS }]}>
                    {waitlistJoined ? 'Reminder set' : 'Notify me when back in stock'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Polish 97: an in-stock alternative whenever what's picked (or the whole product) is sold out. */}
          {!product.isPreOrder && ((allSelected && variant && !variant.isAvailable) ||
            (product.variants.length > 0 && product.variants.every(v => !v.isAvailable))) && (
            <SoldOutAlternatives productId={product.id} />
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
                onPress={() => { setSizeChartOpen(o => !o); }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Size chart"
                accessibilityState={{ expanded: sizeChartOpen }}
              >
                <Text style={[sz.label, { color: theme.text }]}>Size Chart</Text>
                <AppIcon name={sizeChartOpen ? 'chevron-up' : 'chevron-down'} size={16} color={MUTED} />
              </TouchableOpacity>
              {sizeChartOpen && <SizeChartViewer chart={(product as any).sizeChart} />}
            </>
          )}

          {/* Bundle & save — active bundles with this product; renders nothing when none. */}



          <View style={s.divider} />
          <ProductSellerRow
            sellerId={product.sellerId}
            sellerName={product.sellerName}
            sellerHandle={product.sellerHandle}
            sellerAvatarUri={product.sellerAvatarUri}
            onOpenStore={() => router.push(profileHref({ userId: product.sellerId, accountType: 'seller' }) as never)}
          />
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

          {/* Details / Fit / Returns — full-width rows over the page's
              existing content (description, the seller's size chart, the
              return + cancellation policy). No Shipping row: there is no
              per-product shipping source yet. A row with no content is
              omitted. */}
          <View style={[s.infoRows, { borderBottomColor: theme.border }]} testID="product-info-rows">
            {product.description?.trim() ? (
              <InfoRow label="Details" expanded={detailsOpen} onPress={() => setDetailsOpen(o => !o)} testID="product-row-details">
                <Text style={s.desc}>{product.description.trim()}</Text>
              </InfoRow>
            ) : null}
            {product.sizeChart?.columns?.length ? (
              <InfoRow label="Fit" expanded={sizeChartOpen} onPress={() => setSizeChartOpen(o => !o)} testID="product-row-fit">
                <SizeChartViewer chart={(product as any).sizeChart} />
              </InfoRow>
            ) : product.sizeChartImageUrl ? (
              <InfoRow label="Fit" opensSheet onPress={() => setSizeGuideOpen(true)} testID="product-row-fit" />
            ) : null}
            {product.refundPolicy || product.cancellationPolicy ? (
              <InfoRow label="Returns" expanded={returnsOpen} onPress={() => setReturnsOpen(o => !o)} testID="product-row-returns">
                {!!product.refundPolicy && <PolicyRow icon="refresh-ccw" label="Returns" value={product.refundPolicy} />}
                {!!product.cancellationPolicy && <PolicyRow icon="x-circle" label="Cancellation" value={product.cancellationPolicy} />}
              </InfoRow>
            ) : null}
          </View>
          <ProductDetailRows details={pageDetails} />

          {/* Shown in the gallery instead when it loaded there (polish 83). */}
          {!galleryVideo && <ProductVideo productId={product.id} />}

          {/* Purchase protection — exactly once (it also rendered, compact,
              under the seller row). */}
          <BuyerProtectionNote preorder={product.isPreOrder} style={{ marginTop: SP.sm }} />

          {/* Reviews — shared with the Shop sheet so review UI never drifts
              between the two surfaces. Renders nothing when there are none. */}
          {!isPreviewProductId(product.id) && <ProductReviewsSection productId={product.id} productName={product.name} summaryLayout="inline" />}

          {/* Questions — public Q&A, answered by the seller. */}
          {!isPreviewProductId(product.id) && <ProductQuestionsSection productId={product.id} productName={product.name} />}

          {/* Worn in these videos */}
          <WornInVideos productId={product.id} productName={product.name} />

          <BundleOffer productId={product.id} onAdded={bumpCart} />
          {/* Fit checks — buyers' posts wearing it (verified purchases). */}
          <FitChecksStrip productId={product.id} productName={product.name} />

          <CompleteTheFit productId={product.id} />

          {/* More from this brand (item 135) — SSENSE's "{DESIGNER} >" shelf
              under "Styled with"; renders nothing when the brand has no other
              live pieces. */}
          <MoreFromBrand
            productId={product.id}
            sellerId={product.sellerId}
            sellerName={product.sellerName}
            dividerStyle={s.divider}
            headerStyle={s.reviewsHeader}
          />

          {/* You might also like — owns its header; renders nothing when empty.
              The brand's own pieces are left out: they're in the row above. */}
          <RelatedProducts productId={product.id} excludeSellerId={product.sellerId} dividerStyle={s.divider} headerStyle={s.reviewsHeader} />

          {/* Recently viewed — the shared row, minus this product. Hides
              signed out, when empty, or when this is the only one viewed. */}
          <RecentlyViewedRow excludeProductId={product.id} style={{ marginTop: SP.lg }} />

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
              <AppIcon name="flag" size={11} color={SUBTLE} />
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

      {/* Top bar — circular back / share / bag buttons on dark translucent
          circles over the photo; turns solid with the product name once the
          photo has scrolled under it (Nike PDP,
          https://mobbin.com/screens/f405046e-331e-488d-8919-0cb1943ee463).
          Solid dark scrim, not a blur, over the swipeable gallery — the
          same reason as PR #109. */}
      <View
        style={[
          s.topBar,
          { paddingTop: headerTopInset + SP.sm, paddingLeft: SP.md + insets.left, paddingRight: SP.md + insets.right },
          pastPhoto && { backgroundColor: theme.background },
        ]}
        pointerEvents="box-none"
        testID="product-top-bar"
      >
        <IconButton
          name="arrow-left"
          onPress={leaveProduct}
          accessibilityLabel="Back to previous screen"
          variant="plain"
          color="#FFFFFF"
          style={s.mediaChromeBtn}
        />
        <View style={s.topBarTitleWrap} pointerEvents="none">
          {pastPhoto ? (
            <Text style={[s.topBarTitle, { color: theme.text }]} numberOfLines={1} testID="product-top-bar-title">{product.name}</Text>
          ) : null}
        </View>
        <View style={s.topBarRight} pointerEvents="box-none">
          <IconButton
            name="share"
            onPress={handleShare}
            accessibilityLabel="Share product"
            variant="plain"
            color="#FFFFFF"
            style={s.mediaChromeBtn}
            testID="product-share-top"
          />
          {/* Cart button */}
          <Animated.View
            ref={cartTargetRef}
            collapsable={false}
            style={{ transform: [{ scale: cartPulse }] }}
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
      </View>


      {tileExpandOverlay}

      {sizeOption && (
        <SizeSheet
          visible={sizeSheetOpen}
          title={`${sizeOption.name}s`}
          cells={cells}
          allowSoldOut={!product.isPreOrder}
          restockLabel={waitlistJoined ? 'Reminder set' : 'Notify me when back in stock'}
          onRestock={() => { void (waitlistJoined ? handleLeaveWaitlist() : handleJoinWaitlist()); }}
          selectedValueId={selections[sizeOption.id] ?? null}
          stockLine={stockLine?.kind === 'hidden' ? null : stockLine?.text ?? null}
          promiseLine={deliveryPromiseLine(!!product.isPreOrder)}
          checkoutLabel={product.isPreOrder ? 'Reserve' : 'Checkout'}
          checkoutDisabled={product.isPreOrder ? reserved || launching : paymentUnavailable || launching || !allSelected || !variant?.isAvailable}
          checkoutBusy={product.isPreOrder ? reserveLoading : buyingNow}
          addBusy={addingToCart}
          onSelect={(valueId) => {
            haptic('select');
            handleSelect(sizeOption.id, valueId);
          }}
          onCheckout={() => { setSizeSheetOpen(false); void (product.isPreOrder ? handleReserve() : handleBuyNow()); }}
          onAddToBag={() => { setSizeSheetOpen(false); void handleAddToCart(); }}
          onClose={() => setSizeSheetOpen(false)}
        />
      )}

      <SizeGuideSheet
        visible={sizeGuideOpen}
        chart={sizeChart}
        imageUri={product.sizeChartImageUrl ?? null}
        onClose={() => setSizeGuideOpen(false)}
      />

      {/* Stock reminder confirmation — top toast below the back button (Zalando). */}
      <Snackbar
        visible={!!reminderToast}
        message={reminderToast ?? ''}
        topOffset={headerTopInset + SP.sm + COMP.iconBtn + SP.sm}
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
        {/* Add to bag (live price inside) with Save and Share beside it
            (Nike PDP CTA, https://mobbin.com/screens/5163c408-ea2f-46d1-b945-ab33395eacd1).
            The bag-icon bump on success is unchanged. */}
        <View style={s.buyNowBtn}>
        {addedToCart ? (
          <Button
            label="In bag ✓"
            onPress={() => router.push('/(buyer)/cart' as never)}
            accessibilityLabel="In your bag. View cart"
            fullWidth
            style={s.bagBtn}
            testID="product-view-cart"
          />
        ) : (
          <Button
            label={allSelected && !inStock ? 'Sold out' : `Add to bag · ${formatCents(variantPrice)}`}
            variant="primary"
            onPress={handleAddToCart}
            loading={addingToCart}
            disabled={!!sellerPreview || addingToCart || launching || (allSelected && !inStock)}
            accessibilityLabel={!allSelected ? 'Add to bag. Select a size first' : !inStock ? 'Out of stock' : 'Add to bag'}
            fullWidth
            style={s.bagBtn}
            testID="product-add-to-cart"
          />
        )}
        </View>
        <SaveHeart
          productId={product.id}
          title={product.name}
          brand={product.sellerName}
          priceCents={product.priceCents > 0 ? product.priceCents : undefined}
          size={44}
          iconColor={theme.text}
          style={[s.barCircleBtn, { borderColor: theme.border }]}
          testID="product-save-heart"
        />
        <IconButton
          name="share"
          onPress={handleShare}
          accessibilityLabel="Share product"
          variant="plain"
          color={theme.text}
          style={[s.barCircleBtn, { borderColor: theme.border }]}
          testID="product-share-bar"
        />
      </View>
      {/* Buy now / Reserve keep their place in the bar, as the secondary
          action under Add to bag. */}
      <View style={s.actionBarSecondRow}>
        {sellerPreview ? (<Button label="Not for sale yet" onPress={() => {}} disabled fullWidth testID="product-seller-preview-buy" />) : product.isPreOrder ? (
          <Button
            label={reserved ? 'Reserved ✓' : 'Reserve (No Charge)'}
            onPress={handleReserve}
            variant="secondary"
            size="small"
            loading={reserveLoading}
            disabled={reserveLoading || reserved || launching}
            accessibilityHint={reserved ? undefined : 'Reserves this pre-order at no charge'}
            fullWidth
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
            variant="secondary"
            size="small"
            loading={buyingNow}
            disabled={buyingNow || launching || (allSelected && !inStock) || paymentUnavailable}
            fullWidth
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
  // Polish 85: in/cm toggle when the seller's chart is in inches or centimetres.
  const sellerUnit = chartUnitOf(chart?.unit);
  const [unit, setUnit] = useState<ChartUnit | null>(sellerUnit);
  if (!chart?.columns?.length) return null;
  const shownUnit = sellerUnit ? (unit ?? sellerUnit) : null;
  const cell = (v: string) => (sellerUnit && shownUnit ? convertChartValue(v, sellerUnit, shownUnit) : v);
  return (
    <View>
    {sellerUnit && (
      <View style={{ alignSelf: 'flex-start', marginTop: SP.sm, minWidth: 200 }}>
        {/* lululemon's size guide: underlined "Inches / Centimeters" tabs. */}
        <SegmentedControl
          options={[{ id: 'in', label: 'Inches' }, { id: 'cm', label: 'Centimeters' }]}
          selectedId={shownUnit!}
          onChange={id => setUnit(id as ChartUnit)}
          variant="underline"
          testID="size-chart-unit-toggle"
        />
      </View>
    )}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: SP.sm }}>
      <View>
        <View style={sch.row}>
          <View style={[sch.cell, sch.sizeCell, sch.headerCell]}>
            <Text style={sch.headerText}>Size</Text>
          </View>
          {chart.columns.map((col, i) => (
            <View key={i} style={[sch.cell, sch.headerCell]}>
              <Text style={sch.headerText}>{col}{shownUnit ? ` (${shownUnit})` : chart.unit ? ` (${chart.unit})` : ''}</Text>
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
                <Text style={sch.valueText}>{v ? cell(v) : '—'}</Text>
              </View>
            ))}
          </View>
        ))}
        {chart.notes ? <Text style={sch.notes}>{chart.notes}</Text> : null}
      </View>
    </ScrollView>
    </View>
  );
}

// ─── Size Guide Sheet (photo) ─────────────────────────────────────────────────
// A seller-uploaded photo of their own size chart — distinct from the
// structured SizeChartViewer table above. Mobbin refs: SHEIN's "Size Guide"
// text link directly under the size chips (mobbin.com/screens/
// 0c16f080-0cb8-487a-8928-6a7631cb205c) and Polarsteps' full-bleed,
// pinch-zoomable photo viewer (mobbin.com/screens/
// 7d855183-6163-4eb9-8776-7ac07592c47f) for the zoom behavior — adapted to
// the app's own shared Sheet rather than a full-screen viewer, since
// a translucent Glass blur over the chart photo itself would work against
// the one thing this sheet exists to show clearly.

function SizeGuideSheet({ visible, chart, imageUri, onClose }: { visible: boolean; chart: SizeChart | null; imageUri: string | null; onClose: () => void }) {
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

  const hasTable = !!chart?.columns?.length;
  if (!imageUri && !hasTable) return null;

  return (
    <Sheet visible={visible} onClose={() => { resetZoom(); onClose(); }} title="Size guide" padded={false} maxHeightRatio={0.88} testID="size-guide-sheet">
      {hasTable && chart ? (
        <View style={{ paddingHorizontal: SP.md }} testID="size-guide-table">
          <SizeChartViewer chart={chart} />
        </View>
      ) : null}
      {imageUri ? (
        <>
          <View style={[sgs.imageWrap, { backgroundColor: theme.surface }]} {...responder.panHandlers}>
            <Animated.Image
              source={{ uri: imageUri }}
              resizeMode="contain"
              style={[StyleSheet.absoluteFill, { transform: [{ scale }] }]}
              accessibilityLabel="Size guide photo. Pinch with two fingers to zoom."
            />
          </View>
          <Text style={[sgs.hint, { color: MUTED }]}>Pinch to zoom</Text>
        </>
      ) : null}
    </Sheet>
  );
}

const sgs = StyleSheet.create({
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
    if (isPreviewProductId(productId)) {
      setVideos([]);
      setLoading(false);
      return () => { cancelled = true; };
    }
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
                <AppIcon name="video" size={20} color={theme.muted} />
              </View>
            )}
            <Text style={[wv.authorName, { color: theme.muted }]} numberOfLines={1}>{video.authorName}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const wv = StyleSheet.create({
  divider: { height: 1, marginVertical: SP.md },
  header: { fontSize: FS.sm, fontFamily: FONT.semibold, marginBottom: SP.sm },
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
 * "More from {brand}" (item 135). Reference: SSENSE product page, the
 * designer shelf under "Styled with": the brand name as the row title with a
 * chevron that opens the brand, then a horizontal row of that brand's other
 * pieces (https://mobbin.com/flows/0f29b0fc-f9f8-4d14-b152-cce071029b9e).
 * Uses the public storefront endpoint only, so signed-out visitors never hit a
 * protected API. Dev-web preview: the seeded seller's other preview pieces.
 */
function MoreFromBrand({ productId, sellerId, sellerName, dividerStyle, headerStyle }: {
  productId: string;
  sellerId: string;
  sellerName: string;
  dividerStyle?: object;
  headerStyle?: object;
}) {
  const { push } = useThreadPull();
  const { theme, CARD_ELEVATED, FG, MUTED } = useThemeAliases();
  const api = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const usesThreadPull = pathname === '/thread-product-detail';
  const [products, setProducts] = useState<Array<{ id: string; name: string; images: string[]; priceCents: number }>>([]);

  useEffect(() => {
    let cancelled = false;
    setProducts([]);
    if (isPreviewProductId(productId)) {
      setProducts(getPreviewSellerProducts(productId, 8));
      return () => { cancelled = true; };
    }
    if (!sellerId) return () => { cancelled = true; };
    api.publicSellers.get(sellerId)
      .then((data) => {
        if (cancelled) return;
        setProducts((data?.products ?? [])
          .filter((p: any) => p?.id && p.id !== productId)
          .slice(0, 8)
          .map((p: any) => ({
            id: p.id,
            name: p.name ?? '',
            images: Array.isArray(p.images) ? p.images : [],
            priceCents: lowestPriceCents(p),
          })));
      })
      .catch(() => { /* The row simply doesn't render. */ });
    return () => { cancelled = true; };
  }, [productId, sellerId, api]);

  if (products.length === 0 || !sellerName) return null;

  return (
    <View testID="product-more-from-brand">
      <View style={dividerStyle} />
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                onPress={() => { router.push(brandLinkHref(sellerId) as never); }}
        accessibilityRole="button"
        accessibilityLabel={`More from ${sellerName}. Open store`}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6 }}
      >
        <Text style={[headerStyle, { flexShrink: 1 }]} accessibilityRole="header" numberOfLines={1}>More from {sellerName}</Text>
        <Icon name="chevron-right" size={16} color={MUTED} style={{ marginBottom: SP.sm }} />
      </TouchableOpacity>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.md }} contentContainerStyle={{ paddingHorizontal: SP.md, gap: SP.md }}>
        {products.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={{ width: 140 }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`${p.name}, ${formatCents(p.priceCents)}`}
            onPress={() => {
              if (usesThreadPull) push({ pathname: '/thread-product-detail' as any, params: { productId: p.id } } as never);
              else router.push({ pathname: '/buyer-product-detail' as any, params: { productId: p.id } });
            }}
          >
            <View style={{ width: 140, height: 180, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md, overflow: 'hidden', marginBottom: SP.sm }}>
              {p.images[0] ? (
                <CachedImage source={{ uri: p.images[0] }} style={{ width: '100%', height: '100%' }} contentFit="cover" recyclingKey={p.images[0]} />
              ) : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="image" size={24} color={theme.muted} />
                </View>
              )}
            </View>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG }} numberOfLines={1}>{p.name}</Text>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.bold, color: FG, marginTop: 4 }}>{formatCents(p.priceCents)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function lowestPriceCents(p: any): number {
  const variants: any[] = Array.isArray(p?.variants) ? p.variants : [];
  const prices = variants.map((v) => v?.priceCents).filter((n): n is number => typeof n === 'number' && n > 0);
  if (prices.length > 0) return Math.min(...prices);
  return typeof p?.priceCents === 'number' ? p.priceCents : 0;
}

/**
 * "You might also like". Owns its header so an empty or failed row never
 * leaves a bare section title behind (it did: "You Might Also Like" over
 * nothing). Dev-web preview: seeded products get the same seller's other
 * pieces, then similar ones, from the preview catalog.
 */
function RelatedProducts({ productId, excludeSellerId, sellerId = excludeSellerId, dividerStyle, headerStyle }: {
  productId: string;
  excludeSellerId?: string;
  sellerId?: string;
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
    const preview = isPreviewProductId(productId)
      ? getPreviewRelatedProducts(productId, 12)
        .filter((p) => !getPreviewSellerProducts(productId, 12).some((own) => own.id === p.id))
        .slice(0, 4)
      : [];
    if (isPreviewProductId(productId)) {
      setProducts(preview);
      setLoading(false);
      return () => { cancelled = true; };
    }
    api.publicProducts.related(productId, 9)
      .then((data) => {
        if (!cancelled) {
          setProducts(data
            .filter((p: any) => p.id !== productId && (!excludeSellerId || (p.ownerId ?? p.sellerId) !== excludeSellerId))
            .slice(0, 4));
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) { setError(true); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [productId, excludeSellerId, api, router]);

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

  // Same data source as before (the related-products shelf, which already
  // ranks this seller's own pieces first): those become "More from this
  // brand" as 140pt-wide 3:4 cards; the rest stay "You might also like".
  const { brand: brandProducts, others } = splitRelatedByBrand(products, sellerId, 6, 4);

  const renderCard = (p: any, imageHeight: number, testID?: string) => {
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
        testID={testID}
        onPress={() => {
          haptics.light();
          if (usesThreadPull) {
            push({ pathname: '/thread-product-detail' as any, params: { productId: p.id } } as never);
          } else {
            router.push({ pathname: '/buyer-product-detail' as any, params: { productId: p.id } });
          }
        }}
      >
        <View style={{ width: 140, height: imageHeight, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.md, overflow: 'hidden', marginBottom: SP.sm }}>
          {(p.images && p.images[0]) ? (
            <CachedImage source={{ uri: p.images[0] }} style={{ width: '100%', height: '100%' }} contentFit="cover" recyclingKey={p.images[0]} />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name="image" size={24} color={MUTED} />
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
  };

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
                  <AppIcon name="image" size={24} color={MUTED} />
                </View>
              )}
            </View>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG }} numberOfLines={1}>{p.name}</Text>
            <BrandLink
              sellerId={p.ownerId ?? p.sellerId}
              name={p.sellerDisplayName || 'Independent Seller'}
              style={{ fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 2 }}
            />
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
  headerText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: PURPLE_LIGHT, textAlign: 'center' },
  sizeText:   { fontFamily: FONT.semibold, fontSize: FS.xs, color: FG, textAlign: 'center' },
  valueText:  { fontFamily: FONT.medium, fontSize: FS.meta, color: MUTED, textAlign: 'center' },
  notes:      { fontFamily: FONT.medium, fontSize: FS.meta, color: SUBTLE, marginTop: SP.sm, lineHeight: 17 },
  });
};

// ─────────────────────────────────────────────────────────────────────────────

export function PolicyRow({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  const { theme, BG, BORDER, CARD, CARD_ELEVATED, FG, MUTED, SUBTLE, RED, RED_DIM, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, GOLD } = useThemeAliases();
  return (
    <View style={pr.root}>
      <AppIcon name={icon} size={14} color={theme.muted} />
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

/** Raised seller block (#1C1C1E — iOS secondarySystemBackground, dark). */
const SELLER_CARD_RAISED = '#1C1C1E';

export const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
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
  // minHeight, not height: the thumbnail rail renders under the photo inside
  // this block, and a fixed height let it overlap the brand/name below.
  imageArea: { minHeight: GALLERY_HEIGHT, backgroundColor: CARD, position: 'relative' },
  previewMarkerWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  previewMarker: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, paddingHorizontal: SP.sm, paddingVertical: SP.xs, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: RADIUS.pill },
  previewMarkerText: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.xs },
  previewNote: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.meta, marginBottom: SP.md },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  imagePlaceholderText: { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', paddingHorizontal: SP.lg },
  // Positioning wrappers only — the solid dark chrome and hit area come
  // from `mediaChromeBtn` below on a `variant="plain"` IconButton (no blur
  // over the swipeable gallery — see the comment where these render).
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingBottom: SP.sm,
  },
  topBarTitleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBarTitle: { fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
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
  mediaChromeBtn: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: RADIUS.pill },
  body: { paddingVertical: SP.md },
  badgeRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.sm },
  preOrderBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CYAN_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  preOrderBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: CYAN },
  saleBadge: { backgroundColor: RED_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  saleBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: RED, letterSpacing: 0.4 },
  brandLink: { alignSelf: 'flex-start', marginBottom: 4 },
  brandText: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  productName: { fontSize: 20, lineHeight: 26, fontWeight: '600', color: FG, marginBottom: SP.xs },
  addedSheetContent: { padding: SP.md, paddingTop: SP.xs, alignItems: 'center' },
  addedSheetTitle: { ...TYPE.title, color: FG, marginTop: SP.sm, marginBottom: SP.md },
  addedSheetProductRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, width: '100%',
    marginBottom: SP.lg, padding: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
  },
  addedSheetImage: { width: 52, height: 52, borderRadius: RADIUS.sm },
  addedSheetProductName: { ...TYPE.bodyMedium, color: FG },
  addedSheetProductMeta: { ...TYPE.caption, color: MUTED, marginTop: 2 },
  // Raised #1C1C1E block, 12pt radius, no outline. (theme.surface is pure
  // black in the default theme, so the spec's grey is set directly.)
  sellerCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm,
    padding: SP.md, borderRadius: RADII.card, backgroundColor: SELLER_CARD_RAISED,
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
  promiseRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginBottom: SP.md },
  sizeRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 52, marginBottom: SP.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
  },
  sizeRowLabel: { flex: 1, fontSize: FS.base, fontFamily: FONT.medium, color: FG },
  sizeRowValue: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  promiseText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG, flexShrink: 1 },
  price: { fontVariant: ['tabular-nums'],  ...TYPE.heading, fontFamily: FONT.bold, color: FG },
  priceSale: { color: SUCCESS },
  comparePrice: { fontVariant: ['tabular-nums'],  fontSize: FS.base, fontFamily: FONT.regular, color: SUBTLE, textDecorationLine: 'line-through' },
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
  descTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.sm },
  desc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 22 },
  // Passed as StickyFooter's own `style` — it already supplies the absolute
  // positioning, safe-area/tab-bar-aware bottom padding, background, and
  // top border/shadow; only the original paddingTop is preserved here.
  actionBar: { paddingTop: SP.md },
  actionBarRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  actionBarSecondRow: { flexDirection: 'row', alignItems: 'center', marginTop: SP.sm },
  bagBtn: { height: COMP.buttonH },
  barCircleBtn: { width: COMP.iconBtn, height: COMP.iconBtn, borderRadius: COMP.iconBtn / 2, borderWidth: 1, backgroundColor: 'transparent' },
  infoRows: { borderBottomWidth: StyleSheet.hairlineWidth, marginHorizontal: -SP.md, marginTop: SP.sm, marginBottom: SP.md },
  // The add-to-cart / view-cart control uses IconButton's own 44×44pt
  // footprint; only the fill/border are overridden so it reads as a
  // secondary action next to the full-width primary Button.
  addToCartIconBtn: {
    width: COMP.iconBtn, height: COMP.iconBtn, borderRadius: RADII.chip,
    borderWidth: 1, borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM,
    alignItems: 'center', justifyContent: 'center',
  },
  buyNowBtn: { flex: 1 },
  reviewsHeader: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.sm },
  reviewRow: { marginBottom: SP.md, paddingBottom: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  reviewStars: { fontSize: FS.sm, fontFamily: FONT.regular, color: GOLD, marginBottom: 2 },
  reviewBody: { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, lineHeight: 20 },
  reviewDate: { fontSize: FS.meta, fontFamily: FONT.medium, color: SUBTLE, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  ratingAvg: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  ratingCount: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, fontVariant: ['tabular-nums'] },
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

/** Brand named by a "gone" product 404 (api-server lib/goneProduct.ts). */
function goneBrandFrom(error: ApiError): { sellerId: string; sellerName: string } | null {
  try {
    const gone = (JSON.parse(error.body) as { gone?: { sellerId?: unknown; sellerName?: unknown } }).gone;
    return gone && typeof gone.sellerId === 'string' && typeof gone.sellerName === 'string'
      ? { sellerId: gone.sellerId, sellerName: gone.sellerName }
      : null;
  } catch {
    return null;
  }
}
