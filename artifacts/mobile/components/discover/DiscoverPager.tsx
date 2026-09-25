/**
 * DiscoverPager — immersive, full-screen, TikTok-style swipeable product feed.
 *
 * Data: GET /api/public/discover/feed via api.discover.feed({ limit, offset }).
 * See lib/api.ts for the exact response contract (matched against the backend
 * ranking endpoint being built in parallel).
 *
 * Layout is a single horizontal FlatList of full-bleed "pages": each page is a
 * floating hero product cutout over a heavily blurred, tinted copy of the same
 * photo. Reanimated worklets (not JS onScroll callbacks) drive the crossfade
 * between backgrounds, the foreground parallax/scale, and the idle float —
 * so all of it stays on the UI thread at 60fps.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import * as Haptics from 'expo-haptics';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, GRID_MAX_WIDTH, SP } from '@/lib/theme';
import { hapticPrimaryAction } from '@/lib/haptics';
import { TYPE_SCALE, TABULAR_NUMS } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { CachedImage } from '@/components/CachedImage';
import { CardSkeleton } from '@/components/layout';
import { IconButton } from '@/components/ui';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import {
  addToCart,
  getBuyerProduct,
  getCart,
} from '@/services/cartService';
import type { BuyerProduct, BuyerProductVariant } from '@/services/cartTypes';
import {
  getCartFlightVector,
  getSuccessfulCartCount,
  measureCartTarget,
  shouldAnimateCartSuccess,
} from '@/lib/cartFlight';
import { BuyNowFlow } from '@/components/buy-now/BuyNowFlow';
import { VariantPickerSheet } from '@/components/buy-now/VariantPickerSheet';

// ─── Contract types (mirrors lib/api.ts discover.feed exactly) ────────────────

export interface DiscoverFeedItem {
  rank: number;
  productId: string;
  brandId: string;
  brandName: string;
  brandVerified: boolean;
  productName: string;
  priceCents: number;
  compareAtPriceCents: number | null;
  images: string[];
  category: string;
  sellerScore: number;
}

export const DISCOVER_PAGE_LIMIT = 20;

// ─── Layout constants ──────────────────────────────────────────────────────────

const PEEK = 22; // sliver of the next/prev card visible at the edges
const GAP = 10;

/** Preload the next/prev N products' images so swiping never shows a blank frame. */
const PRELOAD_RADIUS = 2;

// ─── Component ────────────────────────────────────────────────────────────────

export function DiscoverPager() {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const { push, back } = useThreadPull();
  const api = useApi();

  const window = Dimensions.get('window');
  const [viewport, setViewport] = useState({ width: window.width, height: window.height });
  const cardWidth = Math.min(viewport.width - PEEK * 2, GRID_MAX_WIDTH);
  const snapInterval = cardWidth + GAP;
  const sideInset = Math.max(0, (viewport.width - cardWidth) / 2);

  const [items, setItems] = useState<DiscoverFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [cartCount, setCartCount] = useState(0);

  const [pickerProduct, setPickerProduct] = useState<DiscoverFeedItem | null>(null);
  const [buyNowItem, setBuyNowItem] = useState<DiscoverFeedItem | null>(null);
  const [flyImage, setFlyImage] = useState<{ uri?: string; startX: number; startY: number } | null>(null);
  const cartIconRef = useRef<View>(null);

  const refreshCartCount = useCallback(() => {
    getCart().then(cart => {
      setCartCount(cart.items.reduce((total, item) => total + item.quantity, 0));
    }).catch(() => {});
  }, []);

  useEffect(() => { refreshCartCount(); }, [refreshCartCount]);

  // ─ Fetch page ─────────────────────────────────────────────────────────────
  const fetchPage = useCallback(async (offset: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else { setLoading(true); setError(null); }
    try {
      const result = await api.discover.feed({ limit: DISCOVER_PAGE_LIMIT, offset });
      const rows = Array.isArray(result?.items) ? result.items : [];
      setItems(prev => (append ? [...prev, ...rows] : rows));
      setNextOffset(result?.nextOffset ?? null);
    } catch {
      if (!append) setError('Could not load Discover. Tap to retry.');
      // A failed "load more" silently stops paginating rather than replacing
      // the feed the buyer is already swiping through.
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchPage(0, false); }, [fetchPage]);

  const handleRetry = useCallback(() => { fetchPage(0, false); }, [fetchPage]);

  const handleEndReached = useCallback(() => {
    if (loadingMore || loading || nextOffset == null) return;
    fetchPage(nextOffset, true);
  }, [fetchPage, loading, loadingMore, nextOffset]);

  // ─ Preload neighboring images as the active index changes ─────────────────
  useEffect(() => {
    const lo = Math.max(0, activeIndex - PRELOAD_RADIUS);
    const hi = Math.min(items.length - 1, activeIndex + PRELOAD_RADIUS);
    for (let i = lo; i <= hi; i++) {
      const uri = items[i]?.images?.[0];
      if (uri) ExpoImage.prefetch(uri).catch(() => {});
    }
  }, [activeIndex, items]);

  // ─ Shared scroll position — drives everything below via worklets ──────────
  const scrollX = useSharedValue(0);
  const lastHapticIndex = useRef(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const onMomentumScrollEnd = useCallback((event: { nativeEvent: { contentOffset: { x: number } } }) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / snapInterval);
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    setActiveIndex(clamped);
    if (clamped !== lastHapticIndex.current) {
      lastHapticIndex.current = clamped;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [items.length, snapInterval]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
    const first = viewableItems.find(v => v.index != null);
    if (first?.index != null) setActiveIndex(first.index);
  }).current;

  // ─ Add to cart ──────────────────────────────────────────────────────────────
  async function performAddToCart(feedItem: DiscoverFeedItem, variant: BuyerProductVariant, product: BuyerProduct, quantity: number, startX: number, startY: number) {
    try {
      const result = await addToCart({
        product,
        variant,
        quantity,
        attribution: { channel: 'discover' },
      });
      const newCount = getSuccessfulCartCount(result);
      if (newCount == null) return;
      setCartCount(newCount);
      const reduceMotion = false; // Discover always attempts the fly animation; measureCartTarget degrades gracefully.
      if (shouldAnimateCartSuccess(reduceMotion)) {
        const fallback = { x: viewport.width - 40, y: insets.top + 26 };
        const target = await measureCartTarget(
          cartIconRef.current?.measureInWindow?.bind(cartIconRef.current),
          fallback,
        );
        void getCartFlightVector(startX, startY, target); // computed for the caller's fly-animation layer
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      // Swallow — the per-card UI already shows its own busy/error affordance.
    }
  }

  async function handleAddToCartPress(feedItem: DiscoverFeedItem, startX: number, startY: number) {
    const product = await getBuyerProduct(feedItem.productId);
    if (!product) return;
    if (product.options.length > 0) {
      setPickerProduct(feedItem);
      setFlyImage({ uri: feedItem.images[0], startX, startY });
      return;
    }
    const variant = product.variants[0];
    if (!variant) return;
    await performAddToCart(feedItem, variant, product, 1, startX, startY);
  }

  const showEmpty = !loading && !error && items.length === 0;
  const showError = !loading && !!error;

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0A0B' }}>
      {loading ? (
        <DiscoverSkeleton insets={insets} cardWidth={cardWidth} />
      ) : showError ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState icon="wifi-off" title="Couldn't load" description={error!} action={{ label: 'Retry', onPress: handleRetry }} compact />
        </View>
      ) : showEmpty ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState icon="compass" title="No trending products" description="Nothing is trending right now." action={{ label: 'Retry', onPress: handleRetry }} compact />
        </View>
      ) : (
        <>
          <DiscoverBackground items={items} activeIndex={activeIndex} scrollX={scrollX} snapInterval={snapInterval} viewportWidth={viewport.width} />

          <Animated.FlatList
            data={items}
            keyExtractor={(item: DiscoverFeedItem) => item.productId}
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            snapToInterval={snapInterval}
            snapToAlignment="start"
            disableIntervalMomentum
            bounces={items.length > 1}
            onScroll={onScroll}
            scrollEventThrottle={16}
            onMomentumScrollEnd={onMomentumScrollEnd}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.5}
            getItemLayout={(_: unknown, index: number) => ({ length: snapInterval, offset: snapInterval * index, index })}
            onLayout={({ nativeEvent }: any) => {
              const w = Math.round(nativeEvent.layout.width);
              const h = Math.round(nativeEvent.layout.height);
              if (w > 0 && h > 0 && (w !== viewport.width || h !== viewport.height)) setViewport({ width: w, height: h });
            }}
            ListHeaderComponent={<View style={{ width: sideInset }} />}
            ListFooterComponent={<View style={{ width: sideInset }} />}
            ItemSeparatorComponent={() => <View style={{ width: GAP }} />}
            renderItem={({ item, index }: { item: DiscoverFeedItem; index: number }) => (
              <DiscoverCard
                item={item}
                index={index}
                cardWidth={cardWidth}
                snapInterval={snapInterval}
                scrollX={scrollX}
                insets={insets}
                theme={theme}
                onBrandPress={() => push(`/seller-profile?id=${encodeURIComponent(item.brandId)}` as never)}
                onAddToCart={(startX, startY) => handleAddToCartPress(item, startX, startY)}
                onBuyNow={() => setBuyNowItem(item)}
              />
            )}
          />

          {/* ─ Top chrome: back, brand handled per-card, cart icon ─ */}
          <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="box-none">
            <IconButton
              name="chevron-left"
              variant="glass"
              accessibilityLabel="Back"
              onPress={back}
              style={styles.glassBtn}
            />
            <View
              ref={cartIconRef}
              collapsable={false}
            >
              <IconButton
                name="shopping-cart"
                variant="glass"
                accessibilityLabel={`Open cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
                onPress={() => push('/(buyer)/cart' as never)}
                badge={cartCount}
                style={styles.glassBtn}
              />
            </View>
          </View>
        </>
      )}

      {pickerProduct && (
        <VariantPickerSheet
          productId={pickerProduct.productId}
          onClose={() => { setPickerProduct(null); setFlyImage(null); }}
          onConfirm={async (product, variant, quantity) => {
            const fly = flyImage;
            setPickerProduct(null);
            setFlyImage(null);
            await performAddToCart(pickerProduct, variant, product, quantity, fly?.startX ?? 0, fly?.startY ?? 0);
          }}
        />
      )}

      {buyNowItem && (
        <BuyNowFlow
          productId={buyNowItem.productId}
          onClose={() => setBuyNowItem(null)}
          onOrderPlaced={() => { refreshCartCount(); }}
        />
      )}
    </View>
  );
}

// ─── Skeleton (blurred placeholder + shimmering silhouette) ───────────────────

function DiscoverSkeleton({ insets, cardWidth }: { insets: { top: number }; cardWidth: number }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: insets.top }}>
      <CardSkeleton width={cardWidth * 0.72} />
    </View>
  );
}

// ─── Background layer — heavy blur + tint + crossfade + parallax ─────────────

const BACKGROUND_PARALLAX = 0.4; // background moves slower than the finger

function DiscoverBackground({
  items, activeIndex, scrollX, snapInterval, viewportWidth,
}: {
  items: DiscoverFeedItem[];
  activeIndex: number;
  scrollX: SharedValue<number>;
  snapInterval: number;
  viewportWidth: number;
}) {
  const lo = Math.max(0, activeIndex - 1);
  const hi = Math.min(items.length - 1, activeIndex + 1);
  const windowed: number[] = [];
  for (let i = lo; i <= hi; i++) windowed.push(i);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {windowed.map(index => (
        <BackgroundLayer
          key={items[index].productId}
          uri={items[index].images?.[0]}
          index={index}
          scrollX={scrollX}
          snapInterval={snapInterval}
          viewportWidth={viewportWidth}
        />
      ))}
      <LinearGradient
        colors={['rgba(0,0,0,0.42)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
        locations={[0, 0.35, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

function BackgroundLayer({
  uri, index, scrollX, snapInterval, viewportWidth,
}: {
  uri?: string;
  index: number;
  scrollX: SharedValue<number>;
  snapInterval: number;
  viewportWidth: number;
}) {
  const style = useAnimatedStyle(() => {
    const center = index * snapInterval;
    const distance = scrollX.value - center;
    const opacity = interpolate(
      distance,
      [-snapInterval, 0, snapInterval],
      [0, 1, 0],
      Extrapolation.CLAMP,
    );
    // Background tracks the drag at a fraction of the foreground's speed —
    // the classic parallax cue that this is a layer behind the hero image.
    const translateX = -distance * BACKGROUND_PARALLAX;
    return { opacity, transform: [{ translateX }, { scale: 1.4 }] };
  });

  if (!uri) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, style, { width: viewportWidth }]}>
      <CachedImage
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        blurRadius={Platform.OS === 'android' ? 25 : 60}
      />
    </Animated.View>
  );
}

// ─── Foreground card ───────────────────────────────────────────────────────────

function DiscoverCard({
  item, index, cardWidth, snapInterval, scrollX, insets, theme,
  onBrandPress, onAddToCart, onBuyNow,
}: {
  item: DiscoverFeedItem;
  index: number;
  cardWidth: number;
  snapInterval: number;
  scrollX: SharedValue<number>;
  insets: { top: number; bottom: number };
  theme: { accent: string; onAccent: string; text: string; muted: string; card: string; border: string };
  onBrandPress: () => void;
  onAddToCart: (startX: number, startY: number) => void;
  onBuyNow: () => void;
}) {
  const imageStyle = useAnimatedStyle(() => {
    const center = index * snapInterval;
    const distance = scrollX.value - center;
    const scale = interpolate(distance, [-snapInterval, 0, snapInterval], [1, 1.06, 1], Extrapolation.CLAMP);
    return { transform: [{ scale }] };
  });

  // Gentle, continuous idle float — a few px of bob plus a degree or two of tilt.
  const floatY = useSharedValue(0);
  const floatRot = useSharedValue(0);
  useEffect(() => {
    floatY.value = withRepeat(withSequence(
      withTiming(-6, { duration: 1800 }),
      withTiming(0, { duration: 1800 }),
    ), -1, true);
    floatRot.value = withRepeat(withSequence(
      withTiming(1.4, { duration: 2200 }),
      withTiming(-1.4, { duration: 2200 }),
    ), -1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const floatStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: floatY.value },
      { rotate: `${floatRot.value}deg` },
    ],
  }));

  const priceRef = useRef<View>(null);
  const hasDiscount = item.compareAtPriceCents != null && item.compareAtPriceCents > item.priceCents;

  return (
    <View style={{ width: cardWidth }}>
      <View style={styles.brandRow}>
        <PressableScale
          onPress={() => { hapticPrimaryAction(); onBrandPress(); }}
          accessibilityLabel={`View ${item.brandName}'s shop`}
        >
          <View style={styles.brandInner}>
            <Text style={[styles.brandName, { color: theme.text }]} numberOfLines={1}>{item.brandName}</Text>
            {item.brandVerified && (
              <Feather name="check-circle" size={13} color={theme.accent} style={{ marginLeft: 4 }} />
            )}
          </View>
        </PressableScale>
      </View>

      <View style={styles.heroWrap}>
        <Animated.View style={[styles.heroFloat, floatStyle]}>
          <Animated.View style={imageStyle}>
            {item.images?.[0] ? (
              // Foreground is always pin-sharp — no blur ever applied here.
              // NOTE (upgrade path): real product photos usually still carry a
              // background since server-side cutout/bg-removal is a stretch
              // goal. Until that lands (server-side at upload time, or an
              // on-device segmentation pass here), we fall back to a large
              // corner radius + soft shadow so the edges read as a floating
              // card rather than a hard rectangle, instead of a true cutout.
              <CachedImage
                source={{ uri: item.images[0] }}
                style={[styles.heroImage, { width: cardWidth * 0.72, height: cardWidth * 0.72 }]}
                contentFit="contain"
              />
            ) : (
              <View style={[styles.heroImage, styles.heroFallback, { width: cardWidth * 0.72, height: cardWidth * 0.72 }]}>
                <Feather name="image" size={40} color="#FFFFFF88" />
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </View>

      <Text style={styles.productName} numberOfLines={2}>{item.productName}</Text>

      <View style={styles.priceRow}>
        <Text style={[styles.price, TABULAR_NUMS]}>{formatCents(item.priceCents)}</Text>
        {hasDiscount && (
          <Text style={[styles.comparePrice, TABULAR_NUMS]}>{formatCents(item.compareAtPriceCents!)}</Text>
        )}
      </View>

      <View style={[styles.actionsRow, { marginBottom: insets.bottom + SP.lg }]}>
        <View style={{ flex: 1 }}>
          <PressableScale
            style={[styles.secondaryBtn, { borderColor: '#FFFFFF55' }]}
            accessibilityLabel="Add to cart"
            onPress={() => {
              hapticPrimaryAction();
              priceRef.current?.measureInWindow((x, y) => onAddToCart(x, y));
            }}
          >
            <View ref={priceRef} collapsable={false} style={styles.actionBtnInner}>
              <Feather name="shopping-cart" size={16} color="#FFFFFF" />
              <Text style={styles.secondaryBtnText}>Add to Cart</Text>
            </View>
          </PressableScale>
        </View>

        <View style={{ flex: 1 }}>
          <PressableScale
            style={[styles.primaryBtn, { backgroundColor: theme.accent }]}
            accessibilityLabel="Buy now"
            onPress={() => { hapticPrimaryAction(); onBuyNow(); }}
          >
            <Text style={[styles.primaryBtnText, { color: theme.onAccent }]}>Buy Now</Text>
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    left: SP.md,
    right: SP.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  glassBtn: {
    width: 40,
    height: 40,
  },
  brandRow: { alignItems: 'center', marginBottom: SP.md },
  brandInner: { flexDirection: 'row', alignItems: 'center' },
  brandName: { ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  heroWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: SP.lg },
  heroFloat: { alignItems: 'center', justifyContent: 'center' },
  heroImage: {
    borderRadius: RADII.sheet,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 14,
  },
  heroFallback: { backgroundColor: '#FFFFFF14', alignItems: 'center', justifyContent: 'center' },
  productName: {
    color: '#FFFFFF',
    ...TYPE_SCALE.title2,
    textAlign: 'center',
    paddingHorizontal: SP.lg,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 },
  price: { color: '#FFFFFF', ...TYPE_SCALE.title1 },
  comparePrice: { color: '#FFFFFF99', ...TYPE_SCALE.body, textDecorationLine: 'line-through' },
  actionsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: SP.lg, marginTop: SP.lg },
  secondaryBtn: {
    flex: 1,
    minHeight: 50,
    borderRadius: RADII.pill,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  actionBtnInner: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryBtnText: { color: '#FFFFFF', ...TYPE_SCALE.headline },
  primaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    borderRadius: RADII.pill,
  },
  primaryBtnText: { ...TYPE_SCALE.headline },
});
