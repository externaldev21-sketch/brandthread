/**
 * Discover — curated shopping home for buyers.
 *
 * Full-bleed, editorial rebuild (GOAT-style product story hero, big magazine
 * section titles, floating product cutouts on theme-tinted gradients, glass
 * info cards) over the same sections/data/actions as before:
 *
 *   Just Dropped — same catalogue as For You (publicProducts.list), shown as
 *                  an immersive full-bleed swipeable hero with a glass
 *                  "Best price / Sold / Want" info card, mirroring GOAT's
 *                  product-story layout (attached_assets/image_1790033866493.png).
 *
 *   High Demand  — publicProducts.highDemand(6)
 *                  Only qualified product-backed rows. Empty = nothing qualifies.
 *                  NEVER sourced from trending posts; trending posts have no
 *                  productId and no demand fields.
 *
 *   For You      — publicProducts.list({ limit: 8 })
 *                  General product catalogue, full-bleed floating cards.
 *
 *   From Brands You Follow — composed client-side from api.social.following()
 *                  + api.publicSellers.get() per followed seller (no dedicated
 *                  endpoint exists yet). Signed-in only.
 *
 *   Trending     — publicTrending.get(20)
 *                  Engagement-ranked posts. Posts only — no commerce signals.
 *                  Navigates to seller profile via brandId, not to product detail.
 *
 * Urgency accent is always theme.accent — never the error color constants.
 * Product imagery prefers `cutoutUri` (background-removed PNG) when the API
 * supplies one, falling back to the first framed product photo — so this
 * screen upgrades automatically once cutouts are plumbed through end to end.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApi } from '@/hooks/useApi';
import { FONT, SP, GUTTER, GRID_MAX_WIDTH } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useAuth } from '@clerk/expo';
import { formatCents } from '@/lib/money';
import { CachedImage } from '@/components/CachedImage';
import { CardSkeleton, ListSkeleton, ResponsiveContainer, SkeletonBlock } from '@/components/layout';
import { TabPageHeader } from '@/components/layout/TabPageHeader';
import { LinearGradient } from 'expo-linear-gradient';
import { EmptyState } from '@/components/BrandthreadUI';
import { saveItem, removeSavedItem, getSavedItems } from '@/services/socialService';
import { SaveToCollectionSheet, SaveToCollectionItem } from '@/components/SaveToCollectionSheet';
import {
  CommerceSignalRow,
  ClaimedRemainingLabel,
  TimeRemainingLabel,
  UrgencyBar,
  URGENCY_UNITS_THRESHOLD,
  type CommerceSignalData,
} from '@/components/CommerceSignal';
import { SectionError } from '@/components/InlineFeedback';
import { useScrollReset } from '@/hooks/useScrollReset';
import { Card, HeartToggle, ThemedRefreshControl, GlassPanel } from '@/components/ui';
import { RecentlyViewedRow } from '@/components/RecentlyViewedRow';
import { TYPE_SCALE, TABULAR_NUMS } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { hapticLight, hapticMedium, hapticToggle } from '@/lib/haptics';
import { isPreviewCatalogEnabled, getPreviewCatalog, getPreviewCatalogByDemand } from '@/lib/previewCatalog';

// ─── API-backed types ──────────────────────────────────────────────────────────

interface LiveProduct {
  id: string;
  name: string;
  sellerDisplayName?: string;
  images?: string[] | null;
  cutoutUri?: string | null;
  currentPriceCents?: number | null;
  claimedUnits?: number;
  remainingUnits?: number;
  demandCount?: number | null;
  endsAt?: string | null;
  tags?: string[];
  variants?: Array<{ priceCents?: number }>;
}

/** Pick the best available product image: a background-removed cutout first, else the framed photo. */
function pickImage(cutoutUri?: string | null, images?: string[] | null): string | undefined {
  return cutoutUri ?? (images ?? [])[0] ?? undefined;
}

// ─── Editorial section head — big magazine-style title + optional "Shop all" ──

function EditorialSectionHead({
  kicker, title, sub, action, onAction, theme,
}: {
  kicker?: string; title: string; sub?: string; action?: string; onAction?: () => void;
  theme: AppThemePreset;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16, gap: 12 }}>
      <View style={{ flex: 1 }}>
        {!!kicker && (
          <Text style={[esh.kicker, { color: theme.accent }]} numberOfLines={1}>{kicker}</Text>
        )}
        <Text style={[esh.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
        {!!sub && (
          <Text style={[TYPE_SCALE.footnote, { color: theme.muted, marginTop: 3 }]} numberOfLines={1}>{sub}</Text>
        )}
      </View>
      {!!action && (
        <Pressable
          onPress={() => { hapticToggle(); onAction?.(); }}
          accessibilityRole="button"
          accessibilityLabel={`${action}, ${title}`}
          style={[esh.pill, { borderColor: theme.border, backgroundColor: theme.card }]}
          hitSlop={8}
        >
          <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.semibold, color: theme.text }]}>{action}</Text>
          <Feather name="arrow-up-right" size={13} color={theme.text} />
        </Pressable>
      )}
    </View>
  );
}

const esh = StyleSheet.create({
  kicker: { fontSize: 11, fontFamily: FONT.bold, letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 4 },
  title:  { fontSize: 28, lineHeight: 32, fontFamily: FONT.bold, letterSpacing: -0.4, textTransform: 'uppercase' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    minHeight: 36, paddingHorizontal: 14, borderRadius: RADII.pill, borderWidth: 1,
  },
});

// ─── Editorial tile — used by High Demand + From Brands You Follow rails ──────

interface EditorialTileItem {
  id: string;
  productId: string;
  brand: string;
  name: string;
  imageUri?: string;
  initials: string;
  priceCents?: number | null;
  isUrgent?: boolean;
}

const TILE_WIDTH = 152;
const TILE_IMAGE_HEIGHT = 180;

const EditorialTile = React.memo(function EditorialTile({ item, theme }: { item: EditorialTileItem; theme: AppThemePreset }) {
  const { push } = useThreadPull();
  return (
    <Pressable
      onPress={() => {
        hapticLight();
        push((`/thread-product-detail?productId=${encodeURIComponent(item.productId)}&productName=${encodeURIComponent(item.name)}`) as never);
      }}
      accessibilityRole="button"
      accessibilityLabel={`${item.name} by ${item.brand}${item.priceCents != null ? `, ${formatCents(item.priceCents)}` : ''}`}
      style={{ width: TILE_WIDTH }}
    >
      <LinearGradient
        colors={theme.heroGradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[tile.imageWrap, { width: TILE_WIDTH, height: TILE_IMAGE_HEIGHT }]}
      >
        {item.imageUri ? (
          <CachedImage source={{ uri: item.imageUri }} style={tile.image} contentFit="contain" />
        ) : (
          <View style={[StyleSheet.absoluteFill, tile.fallback]}>
            <Text style={tile.fallbackText}>{item.initials}</Text>
          </View>
        )}
        {item.isUrgent && (
          <View style={[tile.urgentDot, { backgroundColor: theme.accent }]} />
        )}
        {item.priceCents != null && (
          <View style={tile.pricePill}>
            <Text style={[TYPE_SCALE.caption, TABULAR_NUMS, { fontFamily: FONT.bold, color: '#0A0A0B' }]}>
              {formatCents(item.priceCents)}
            </Text>
          </View>
        )}
      </LinearGradient>
      <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.semibold, color: theme.text, marginTop: 8 }]} numberOfLines={1}>{item.name}</Text>
      <Text style={[TYPE_SCALE.caption, { color: theme.muted, marginTop: 1 }]} numberOfLines={1}>{item.brand}</Text>
    </Pressable>
  );
});

const tile = StyleSheet.create({
  imageWrap: { borderRadius: RADII.sheet, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '78%', height: '78%' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackText: { fontSize: 34, fontFamily: FONT.bold, color: '#FFFFFF' },
  urgentDot: { position: 'absolute', top: 10, right: 10, width: 8, height: 8, borderRadius: 4 },
  pricePill: {
    position: 'absolute', bottom: 10, left: 10,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: RADII.pill,
    backgroundColor: '#FFFFFF',
  },
});

function TileRailSkeleton() {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: GUTTER }}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={{ width: TILE_WIDTH, gap: 8 }}>
          <SkeletonBlock width={TILE_WIDTH} height={TILE_IMAGE_HEIGHT} radius={RADII.sheet} />
          <SkeletonBlock width="80%" height={12} />
          <SkeletonBlock width="50%" height={11} />
        </View>
      ))}
    </ScrollView>
  );
}

// ─── High Demand rail ───────────────────────────────────────────────────────────
// Uses publicProducts.highDemand() — only qualified product-backed rows.
// Always navigates to thread-product-detail via real productId.
// Trending posts are NEVER mixed in here.

// ─── Swipeable product showcase (For You) ─────────────────────────────────────

interface ProductCardItem {
  id: string;
  productId?: string;
  brand: string;
  name: string;
  imageUri?: string;
  initials: string;
  colorHex: string;
  tag?: string;
  commerce: CommerceSignalData;
}

const SHOWCASE_GAP = 14;

// Declared once: an inline separator component would be a new component type
// on every render, remounting every separator in the carousel.
function ShowcaseGap() {
  return <View style={{ width: SHOWCASE_GAP }} />;
}

function ProductShowcase({ items }: { items: ProductCardItem[] }) {
  const { push } = useThreadPull();
  const { theme } = useAppTheme();
  const showcase = React.useMemo(() => makeShowcaseStyles(theme), [theme]);
  const { width: viewportWidth } = useWindowDimensions();
  const [listWidth, setListWidth] = useState(viewportWidth);
  const [activeIndex, setActiveIndex] = useState(0);
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
  const [saveToSheetItem, setSaveToSheetItem] = useState<SaveToCollectionItem | null>(null);
  useEffect(() => {
    let cancelled = false;
    getSavedItems().then(saved => {
      if (cancelled) return;
      const savedTargetIds = new Set(saved.map(item => item.targetId));
      setSavedIds(current => {
        const next = { ...current };
        for (const item of items) {
          if (savedTargetIds.has(item.productId ?? item.id)) next[item.id] = true;
        }
        return next;
      });
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
  const scrollX = useRef(new Animated.Value(0)).current;
  const measuredWidth = Math.max(1, listWidth);
  const cardWidth = Math.min(Math.max(measuredWidth - 54, 1), 370);
  const snapInterval = cardWidth + SHOWCASE_GAP;
  const sideInset = Math.max(0, (measuredWidth - cardWidth) / 2);
  const snapOffsets = items.map((_, index) => index * snapInterval);

  function openProduct(item: ProductCardItem) {
    const pid = encodeURIComponent(item.productId ?? item.id);
    push((`/thread-product-detail?productId=${pid}&productName=${encodeURIComponent(item.name)}`) as never);
  }

  return (
    <View
      style={showcase.shell}
      onLayout={({ nativeEvent }) => {
        const nextWidth = Math.round(nativeEvent.layout.width);
        if (nextWidth > 0 && nextWidth !== listWidth) setListWidth(nextWidth);
      }}
    >
      <Animated.FlatList
        horizontal
        data={items}
        keyExtractor={item => item.id}
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToOffsets={snapOffsets}
        snapToAlignment="start"
        disableIntervalMomentum
        nestedScrollEnabled
        removeClippedSubviews={false}
        bounces={items.length > 1}
        ListHeaderComponent={<View style={{ width: sideInset }} />}
        ListFooterComponent={<View style={{ width: sideInset }} />}
        ItemSeparatorComponent={ShowcaseGap}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        onMomentumScrollEnd={event => {
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / snapInterval);
          setActiveIndex(Math.max(0, Math.min(items.length - 1, nextIndex)));
          hapticToggle();
        }}
        renderItem={({ item, index }) => {
          const isUrgent =
            (item.commerce.remainingUnits ?? 0) > 0 &&
            (item.commerce.remainingUnits ?? 0) <= URGENCY_UNITS_THRESHOLD;
          const saved = !!savedIds[item.id];
          const inputRange = [
            (index - 1) * snapInterval,
            index * snapInterval,
            (index + 1) * snapInterval,
          ];
          const scale = scrollX.interpolate({
            inputRange,
            outputRange: [0.92, 1, 0.92],
            extrapolate: 'clamp',
          });
          const opacity = scrollX.interpolate({
            inputRange,
            outputRange: [0.64, 1, 0.64],
            extrapolate: 'clamp',
          });

          return (
            <Animated.View style={{ width: cardWidth, opacity, transform: [{ scale }], position: 'relative' }}>
              {/* This card's own navigation Pressable renders as a real DOM
                  <button> on web. The save heart below is rendered as a
                  sibling (not a descendant) positioned absolutely on top of
                  it — a real <button> can never contain another <button>,
                  so the heart must live outside this Pressable's subtree. */}
              <Pressable
                onPress={() => openProduct(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} by ${item.brand}${item.commerce.currentPriceCents != null ? `, ${formatCents(item.commerce.currentPriceCents)}` : ''}`}
              >
                <View style={showcase.card}>
                  <LinearGradient
                    colors={theme.heroGradient}
                    start={{ x: 0.1, y: 0 }}
                    end={{ x: 0.9, y: 1 }}
                    style={[showcase.visual, isUrgent && { borderWidth: 1, borderColor: `${theme.accent}66` }]}
                  >
                    <View style={showcase.topline} pointerEvents="box-none">
                      <View style={showcase.brandPill}>
                        <Text style={showcase.brandPillText} numberOfLines={1}>{item.brand}</Text>
                      </View>
                      {/* Reserves the same row space the heart used to occupy
                          so the brand pill doesn't stretch full-width now
                          that the heart is a sibling, not a flex child here. */}
                      <View style={showcase.heartSpacer} />
                    </View>

                    {item.imageUri ? (
                      <CachedImage source={{ uri: item.imageUri }} style={showcase.productImage} contentFit="contain" />
                    ) : (
                      <View style={[showcase.productImage, showcase.visualFallback]}>
                        <Text style={showcase.initials}>{item.initials}</Text>
                      </View>
                    )}

                    {item.tag && (
                      <View style={showcase.tag}>
                        <Text style={[TYPE_SCALE.caption, { color: '#FFFFFF', letterSpacing: 0.7, textTransform: 'uppercase' }]}>{item.tag}</Text>
                      </View>
                    )}
                    {item.commerce.currentPriceCents != null && (
                      <View style={showcase.pricePill}>
                        <Text style={[TYPE_SCALE.footnote, TABULAR_NUMS, { fontFamily: FONT.bold, color: '#0A0A0B' }]}>{formatCents(item.commerce.currentPriceCents)}</Text>
                      </View>
                    )}
                  </LinearGradient>

                  <View style={{ paddingHorizontal: 2 }}>
                    <Text style={[TYPE_SCALE.headline, { marginTop: 12, fontFamily: FONT.bold, color: theme.text, letterSpacing: -0.2 }]} numberOfLines={1}>{item.name}</Text>
                    <View style={showcase.signalRow}>
                      <ClaimedRemainingLabel
                        claimedUnits={item.commerce.claimedUnits ?? 0}
                        remainingUnits={item.commerce.remainingUnits ?? 0}
                        urgent={isUrgent}
                        accent={theme.accent}
                      />
                      {!!item.commerce.endsAt && (
                        <TimeRemainingLabel endsAt={item.commerce.endsAt} accent={theme.accent} />
                      )}
                    </View>
                    {isUrgent && (
                      <UrgencyBar
                        claimedUnits={item.commerce.claimedUnits ?? 0}
                        remainingUnits={item.commerce.remainingUnits ?? 0}
                        accentColor={theme.accent}
                        style={{ marginTop: 8 }}
                      />
                    )}
                  </View>
                </View>
              </Pressable>
              <View style={showcase.heartWrap} pointerEvents="box-none">
                <HeartToggle
                  liked={saved}
                  onChange={(nextSaved) => {
                    setSavedIds(current => ({ ...current, [item.id]: nextSaved }));
                    const targetId = item.productId ?? item.id;
                    const action = nextSaved
                      ? saveItem({ type: 'product', targetId, title: item.name, subtitle: item.brand, accentColor: item.colorHex, priceCents: item.commerce.currentPriceCents ?? undefined })
                      : removeSavedItem(targetId);
                    action.catch(() => {
                      setSavedIds(current => ({ ...current, [item.id]: !nextSaved }));
                    });
                  }}
                  onLongPress={() => {
                    hapticMedium();
                    setSavedIds(current => ({ ...current, [item.id]: true }));
                    setSaveToSheetItem({
                      type: 'product',
                      targetId: item.productId ?? item.id,
                      title: item.name,
                      subtitle: item.brand,
                      accentColor: item.colorHex,
                      priceCents: item.commerce.currentPriceCents ?? undefined,
                    });
                  }}
                  accessibilityLabel={saved ? 'Remove from saved' : 'Save product'}
                />
              </View>
            </Animated.View>
          );
        }}
      />
      {items.length > 1 && (
        <View style={showcase.pagination} accessibilityLabel={`Product ${activeIndex + 1} of ${items.length}`}>
          {items.map((item, index) => (
            <View
              key={item.id}
              style={[showcase.dot, index === activeIndex && showcase.dotActive]}
            />
          ))}
        </View>
      )}
      <SaveToCollectionSheet
        visible={!!saveToSheetItem}
        item={saveToSheetItem}
        onClose={() => setSaveToSheetItem(null)}
      />
    </View>
  );
}

const makeShowcaseStyles = (theme: AppThemePreset) => StyleSheet.create({
  shell:          { marginBottom: 32 },
  card:           {},
  topline:        { position: 'absolute', top: 12, left: 12, right: 12, zIndex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brandPill:      { maxWidth: '70%', paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADII.pill, backgroundColor: 'rgba(0,0,0,0.4)' },
  brandPillText:  { fontSize: 11, fontFamily: FONT.semibold, color: '#FFFFFF' },
  // Reserves the same 22pt the heart used to occupy inside `topline`.
  heartSpacer:    { width: 22, height: 22 },
  // The heart lives outside the card's Pressable (a real <button> on web) so
  // it's a DOM sibling, not a nested <button> — positioned to land exactly
  // where it used to sit inside `topline` (top:12, right edge of the card).
  heartWrap:      { position: 'absolute', top: 12, right: 12, zIndex: 3 },
  visual:         { height: 380, position: 'relative', overflow: 'hidden', borderRadius: RADII.sheet, alignItems: 'center', justifyContent: 'center' },
  productImage:   { width: '74%', height: '70%' },
  visualFallback: { alignItems: 'center', justifyContent: 'center' },
  initials:       { fontSize: 56, fontFamily: FONT.bold, color: '#FFFFFF' },
  tag:            { position: 'absolute', top: 12, left: 12, paddingHorizontal: 9, paddingVertical: 5, borderRadius: RADII.chip, backgroundColor: 'rgba(0,0,0,0.72)' },
  pricePill:      { position: 'absolute', bottom: 14, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 9, borderRadius: RADII.pill, backgroundColor: '#FFFFFF' },
  signalRow:      { minHeight: 30, marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 10 },
  pagination:     { height: 22, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot:            { width: 5, height: 5, borderRadius: 3, backgroundColor: theme.subtle },
  dotActive:      { width: 18, backgroundColor: theme.text },
});

// ─── Trending post row ────────────────────────────────────────────────────────
// Trending items are engagement-ranked posts. They carry no productId and no
// product demand fields. We show brand/caption, navigate to seller profile via
// brandId. No commerce signals displayed here.

interface TrendingRowItem {
  id: string;
  rank: number;
  brand: string;
  brandId?: string;
  name: string;
  initials: string;
  colorHex: string;
}

const TrendingRow = React.memo(function TrendingRow({ item }: { item: TrendingRowItem }) {
  const router = useRouter();
  const { theme } = useAppTheme();

  function handlePress() {
    hapticLight();
    if (item.brandId) {
      // Trending posts navigate to seller profile via brandId — they have no productId
      router.push((`/seller-profile?id=${encodeURIComponent(item.brandId)}`) as never);
    }
  }

  return (
    <Card
      onPress={handlePress}
      accessibilityLabel={`#${item.rank}, ${item.name} by ${item.brand}`}
      style={tr.row}
    >
      <Text style={[TYPE_SCALE.title2, TABULAR_NUMS, { fontFamily: FONT.bold, color: theme.accent, width: 32 }]}>{item.rank}</Text>
      <View style={[tr.avatar, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.bold, color: theme.text }]}>{item.initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.semibold, color: theme.text }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[TYPE_SCALE.caption, { color: theme.muted, marginTop: 2 }]} numberOfLines={1}>{item.brand}</Text>
        {/* No commerce signals — trending posts have no product demand data */}
      </View>
    </Card>
  );});

const tr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  avatar:   { width: 44, height: 44, borderRadius: RADII.chip, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});

// ─── Discover Hero — full-bleed "Just Dropped" product story ──────────────────
//
// Layout inspired by GOAT's immersive drop page (see attached_assets/
// image_1790033866493.png): full-bleed theme-tinted gradient backdrop with
// soft glow, one product cutout floating centered with an idle bob, a glass
// top bar (counter chip · JUST DROPPED · Shop all pill), a glass price pill,
// a glass "Best price / Sold / Want" info card, and horizontal swipe between
// products with the next one peeking + scaling in from the edge.
function DiscoverHero({
  items, theme, onOpenProduct, onShopAll,
}: {
  items: ProductCardItem[];
  theme: AppThemePreset;
  onOpenProduct: (item: ProductCardItem) => void;
  onShopAll: () => void;
}) {
  // Measured from the hero's own container, not useWindowDimensions(): on
  // web, WebAppShell clips the app to a centered column (WEB_SHELL_MAX_WIDTH)
  // narrower than the raw browser window once past its breakpoint, and
  // sizing off the window would push the product page past the visible
  // column's edge.
  const { width: windowWidth } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(windowWidth);
  const heroWidth = measuredWidth || windowWidth;
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const heroHeight = Math.min(620, Math.max(480, heroWidth * 1.32));
  // Page is narrower than the viewport so the next card peeks in at the edge.
  const pagePeek = 46;
  const pageWidth = Math.min(heroWidth, GRID_MAX_WIDTH) - pagePeek;
  const snapInterval = pageWidth;
  const sideInset = (heroWidth - pageWidth) / 2;

  // Gentle continuous idle float for the active product cutout.
  const floatY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: -10, duration: 1900, useNativeDriver: true }),
        Animated.timing(floatY, { toValue: 0, duration: 1900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [floatY]);

  if (items.length === 0) return null;
  const active = items[Math.min(activeIndex, items.length - 1)];
  const isUrgent =
    (active.commerce.remainingUnits ?? 0) > 0 &&
    (active.commerce.remainingUnits ?? 0) <= URGENCY_UNITS_THRESHOLD;

  return (
    <View
      style={{ height: heroHeight, marginBottom: SP.xl }}
      onLayout={({ nativeEvent }) => {
        const next = Math.round(nativeEvent.layout.width);
        if (next > 0 && next !== measuredWidth) setMeasuredWidth(next);
      }}
    >
      <LinearGradient
        colors={theme.heroGradient}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Soft glow blobs for depth — theme-tinted, never a new hue */}
      <View pointerEvents="none" style={[dh.glowTop, { backgroundColor: theme.glowGradient[0] }]} />
      <View pointerEvents="none" style={[dh.glowBottom, { backgroundColor: theme.glowGradient[0] }]} />

      {/* ─ Story bar: counter chip · JUST DROPPED · Shop all pill ─ */}
      <View style={[dh.topBar, { paddingHorizontal: Math.max(SP.md, sideInset) }]}>
        <View style={dh.counterChip}>
          <Text style={dh.counterChipText}>{activeIndex + 1}/{items.length}</Text>
        </View>
        <Text style={dh.title} numberOfLines={1}>Just Dropped</Text>
        <Pressable onPress={onShopAll} style={dh.shopAllPill} accessibilityRole="button" accessibilityLabel="Shop all">
          <Text style={dh.shopAllText}>Shop all</Text>
        </Pressable>
      </View>

      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={false}
        snapToInterval={snapInterval}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: sideInset }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(e) => {
          const next = Math.round(e.nativeEvent.contentOffset.x / snapInterval);
          setActiveIndex(Math.max(0, Math.min(items.length - 1, next)));
          hapticToggle();
        }}
      >
        {items.map((item, index) => {
          const inputRange = [(index - 1) * snapInterval, index * snapInterval, (index + 1) * snapInterval];
          const scale = scrollX.interpolate({ inputRange, outputRange: [0.86, 1, 0.86], extrapolate: 'clamp' });
          const opacity = scrollX.interpolate({ inputRange, outputRange: [0.5, 1, 0.5], extrapolate: 'clamp' });
          return (
            <Pressable
              key={item.id}
              onPress={() => onOpenProduct(item)}
              style={{ width: pageWidth, alignItems: 'center' }}
              accessibilityRole="button"
              accessibilityLabel={`${item.name} by ${item.brand}${item.commerce.currentPriceCents != null ? `, ${formatCents(item.commerce.currentPriceCents)}` : ''}`}
            >
              <Animated.View style={[dh.productWrap, { opacity, transform: [{ scale }, { translateY: index === activeIndex ? floatY : 0 }] }]}>
                {item.imageUri ? (
                  <CachedImage source={{ uri: item.imageUri }} style={dh.productImage} contentFit="contain" />
                ) : (
                  <View style={[dh.productImage, dh.productImageFallback, { backgroundColor: `${theme.onAccent}22` }]}>
                    <Text style={[dh.productFallbackInitials, { color: theme.onAccent }]}>{item.initials}</Text>
                  </View>
                )}
              </Animated.View>
            </Pressable>
          );
        })}
      </Animated.ScrollView>

      {/* ─ Price pill + glass "Best price / Sold / Want" info card ─ */}
      <View style={[dh.bottomChrome, { paddingHorizontal: Math.max(SP.md, sideInset) }]} pointerEvents="box-none">
        {active.commerce.currentPriceCents != null && (
          <View style={dh.pricePill}>
            <Text style={dh.pricePillText}>{formatCents(active.commerce.currentPriceCents)}</Text>
          </View>
        )}
        <HeroStatCard item={active} isUrgent={isUrgent} theme={theme} />
        {items.length > 1 && (
          <View style={dh.dots} accessibilityLabel={`Product ${activeIndex + 1} of ${items.length}`}>
            {items.map((it, i) => (
              <View key={it.id} style={[dh.dot, i === activeIndex && dh.dotActive]} />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

function HeroStatCard({ item, isUrgent, theme }: { item: ProductCardItem; isUrgent: boolean; theme: AppThemePreset }) {
  const best = item.commerce.currentPriceCents;
  const sold = item.commerce.claimedUnits ?? 0;
  const want = item.commerce.demandCount;
  const stats: { label: string; value: string }[] = [];
  if (best != null) stats.push({ label: 'Best price', value: formatCents(best) });
  if (sold > 0) stats.push({ label: 'Sold', value: sold.toLocaleString() });
  if (want != null && want > 0) stats.push({ label: 'Want', value: want.toLocaleString() });
  if (stats.length < 2) return null;

  return (
    <GlassPanel style={dh.statCard} intensity={35}>
      <View style={dh.statRow}>
        {stats.map((stat, i) => (
          <React.Fragment key={stat.label}>
            {i > 0 && <View style={dh.statDivider} />}
            <View style={dh.statCol}>
              <Text style={dh.statLabel}>{stat.label.toUpperCase()}</Text>
              <Text style={[dh.statValue, isUrgent && stat.label !== 'Best price' ? { color: theme.accentLight } : null]}>{stat.value}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>
    </GlassPanel>
  );
}

const dh = StyleSheet.create({
  glowTop: {
    position: 'absolute', top: -80, left: -60, width: 280, height: 280, borderRadius: 200, opacity: 0.55,
  },
  glowBottom: {
    position: 'absolute', bottom: -100, right: -80, width: 320, height: 320, borderRadius: 220, opacity: 0.4,
  },
  topBar: {
    marginTop: SP.lg + SP.md,
    flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  counterChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: RADII.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  counterChipText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 11, ...TABULAR_NUMS },
  title: {
    flex: 1, textAlign: 'center', color: '#FFFFFF', fontFamily: FONT.bold,
    fontSize: 13, letterSpacing: 2.4, textTransform: 'uppercase',
  },
  shopAllPill: {
    minHeight: 32, justifyContent: 'center',
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: RADII.pill,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  shopAllText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 12 },
  productWrap: {
    width: '100%', height: 240, alignItems: 'center', justifyContent: 'center', marginTop: 14,
  },
  productImage: {
    width: '68%', height: '100%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 22 }, shadowOpacity: 0.4, shadowRadius: 30, elevation: 14,
  },
  productImageFallback: { alignItems: 'center', justifyContent: 'center', borderRadius: RADII.card },
  productFallbackInitials: { fontFamily: FONT.bold, fontSize: 40 },
  bottomChrome: {
    position: 'absolute', bottom: SP.lg, left: 0, right: 0, alignItems: 'center', gap: 12,
  },
  pricePill: {
    paddingHorizontal: 18, paddingVertical: 9, borderRadius: RADII.pill,
    backgroundColor: '#FFFFFF',
  },
  pricePillText: { color: '#0A0A0B', fontFamily: FONT.bold, fontSize: 16, ...TABULAR_NUMS },
  statCard: { width: '100%', maxWidth: 360 },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8 },
  statCol: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 26, backgroundColor: 'rgba(255,255,255,0.18)' },
  statValue: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 15, marginTop: 3, ...TABULAR_NUMS },
  statLabel: { color: 'rgba(255,255,255,0.68)', fontFamily: FONT.semibold, fontSize: 9, letterSpacing: 0.8 },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { width: 16, backgroundColor: '#FFFFFF' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const scrollResetRef = useScrollReset<ScrollView>();
  const barInset = useBuyerTabBarInset();
  const router    = useRouter();
  const { push }  = useThreadPull();
  const api       = useApi();
  const { theme } = useAppTheme();
  const { isSignedIn } = useAuth();

  const { width: winWidth } = useWindowDimensions();
  const showcaseSkeletonWidth = Math.min(Math.max(winWidth - 54 - GUTTER * 2, 1), 370);

  // ─ Each section has independent loading, error, and data ──────────

  const [refreshing, setRefreshing] = useState(false);

  // High Demand — publicProducts.highDemand(6) only.
  // Never sourced from trending posts. Empty array = nothing qualifies.
  const [highDemandItems,   setHighDemandItems]   = useState<EditorialTileItem[]>([]);
  const [highDemandLoading, setHighDemandLoading] = useState(true);
  const [highDemandError,   setHighDemandError]   = useState<string | null>(null);

  const [forYouItems,    setForYouItems]    = useState<ProductCardItem[]>([]);
  const [forYouLoading,  setForYouLoading]  = useState(true);
  const [forYouError,    setForYouError]    = useState<string | null>(null);

  const [followedItems,   setFollowedItems]   = useState<EditorialTileItem[]>([]);
  const [followedLoading, setFollowedLoading] = useState(true);
  const [followedError,   setFollowedError]   = useState<string | null>(null);

  const [trendingItems,   setTrendingItems]   = useState<TrendingRowItem[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingError,   setTrendingError]   = useState<string | null>(null);

  // ─ Fetch High Demand ────────────────────────────────────────────────────
  // publicProducts.highDemand(limit) → any[] (direct array, no wrapper)
  // Only qualified product-backed rows. Empty = nothing meets criteria.
  // No fallback to publicProducts.list() — empty array shows empty state.
  const fetchHighDemand = useCallback(async () => {
    setHighDemandLoading(true);
    setHighDemandError(null);
    try {
      const rows = await api.publicProducts.highDemand(6);
      let safe = Array.isArray(rows) ? rows : [];
      // Nothing testable without real sellers yet: in preview/dev only, seed
      // from the bundled preview catalog so this rail has real-looking data
      // to browse. Never used when the real API actually returned rows, and
      // never compiled into a production build (isPreviewCatalogEnabled is
      // hard-gated on __DEV__).
      if (safe.length === 0 && isPreviewCatalogEnabled()) {
        safe = getPreviewCatalogByDemand(6);
      }
      setHighDemandItems(safe.map((p: any): EditorialTileItem => {
        const fallbackPrice = (p.variants ?? [])[0]?.priceCents ?? null;
        const remaining = typeof p.remainingUnits === 'number' ? p.remainingUnits : 0;
        return {
          id:        `hd_${p.id}`,
          productId: p.id,  // real productId — thread-product-detail navigation
          brand:     p.sellerDisplayName ?? 'Seller',
          name:      p.name,
          imageUri:  pickImage(p.cutoutUri, p.images),
          initials:  (p.name ?? 'P')[0].toUpperCase(),
          priceCents: p.currentPriceCents ?? fallbackPrice,
          isUrgent:  remaining > 0 && remaining <= URGENCY_UNITS_THRESHOLD,
        };
      }));
    } catch {
      // Do NOT reset highDemandItems — keep previous data visible if available
      setHighDemandError('Could not load high demand products. Tap to retry.');
    } finally {
      setHighDemandLoading(false);
    }
  }, [api]);

  // ─ Fetch For You products ─────────────────────────────────────────────
  // publicProducts.list returns any[] directly — no {items} wrapper.
  const fetchProducts = useCallback(async () => {
    setForYouLoading(true);
    setForYouError(null);
    try {
      const rows = await api.publicProducts.list({ limit: 8 });
      let safe: LiveProduct[] = Array.isArray(rows) ? rows : [];
      if (safe.length === 0 && isPreviewCatalogEnabled()) {
        safe = getPreviewCatalog();
      }
      setForYouItems(safe.map((row, i): ProductCardItem => {
        const fallbackPrice = (row.variants ?? [])[0]?.priceCents ?? null;
        return {
          id:         `fy_${i}`,
          productId:  row.id,
          brand:      row.sellerDisplayName ?? 'Seller',
          name:       row.name,
          imageUri:   pickImage(row.cutoutUri, row.images),
          initials:   (row.name ?? 'P')[0].toUpperCase(),
          colorHex:   theme.accent,
          tag:        (row.tags as string[] | undefined)?.[0],
          commerce: {
            currentPriceCents: row.currentPriceCents ?? fallbackPrice,
            claimedUnits:      row.claimedUnits  ?? 0,
            remainingUnits:    row.remainingUnits ?? 0,
            demandCount:       row.demandCount   ?? null,
            endsAt:            row.endsAt ?? null,
          },
        };
      }));
    } catch {
      // Do NOT reset forYouItems — keep previous data visible if available
      setForYouError('Could not load products. Tap to retry.');
    } finally {
      setForYouLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.accent]);

  // ─ Fetch From Brands You Follow ─────────────────────────────────────────
  // Composed client-side: api.social.following() → per-seller
  // api.publicSellers.get() → first product(s) per followed seller. No
  // dedicated endpoint exists yet. Signed-in only; empty when signed out.
  const fetchFollowed = useCallback(async () => {
    if (!isSignedIn) {
      setFollowedLoading(false);
      setFollowedItems([]);
      setFollowedError(null);
      return;
    }
    setFollowedLoading(true);
    setFollowedError(null);
    try {
      const following = await api.social.following();
      const sellers = (Array.isArray(following) ? following : []).slice(0, 6);
      const perSeller = await Promise.all(sellers.map(async (f): Promise<EditorialTileItem[]> => {
        try {
          const data = await api.publicSellers.get(f.userId);
          const prods = Array.isArray(data?.products) ? data.products : [];
          const brandName = (data?.profile as any)?.brandName ?? (data?.profile as any)?.displayName ?? f.name ?? 'Brand';
          return prods.slice(0, 2).map((p: any): EditorialTileItem => ({
            id:        `fb_${p.id}`,
            productId: p.id,
            brand:     brandName,
            name:      p.name,
            imageUri:  pickImage(p.cutoutUri, p.images),
            initials:  (brandName ?? 'B').slice(0, 2).toUpperCase(),
            priceCents: (p.variants ?? [])[0]?.priceCents ?? null,
          }));
        } catch {
          return [];
        }
      }));
      setFollowedItems(perSeller.flat().slice(0, 10));
    } catch {
      setFollowedError('Could not load brands you follow. Tap to retry.');
    } finally {
      setFollowedLoading(false);
    }
  }, [api, isSignedIn]);

  // ─ Fetch Trending posts ───────────────────────────────────────────────
  // publicTrending.get(limit: number) → { trending: TrendingItem[] }
  // TrendingItem = post: id, rank, brand, brandId, caption.
  // Posts have NO productId and NO product demand fields.
  // We display brand/caption under "Trending" only — never in High Demand.
  // finalScore/organicScore are NOT mapped to demandCount (they are post metrics, not demand signals).
  const fetchTrending = useCallback(async () => {
    setTrendingLoading(true);
    setTrendingError(null);
    try {
      // Correct signature: get(limit: number) — not get({ limit })
      const data = await api.publicTrending.get(20);
      const rows: any[] = Array.isArray(data?.trending)
        ? data.trending.map((t: any) => ({ ...t, caption: t.caption ?? undefined }))
        : [];
      setTrendingItems(rows.map((t, i): TrendingRowItem => ({
        id:       t.id,
        rank:     t.rank ?? i + 1,
        brand:    t.brand ?? 'Brand',
        brandId:  t.brandId,
        // Navigate to seller-profile via brandId — trending posts have no productId
        name:     t.caption ? String(t.caption).slice(0, 60) : (t.brand ?? 'Trending'),
        initials: (t.brand ?? 'B').slice(0, 2).toUpperCase(),
        colorHex: theme.accent,
        // No commerce fields — trending posts are not product demand rows
      })));
    } catch {
      // Do NOT reset trendingItems — keep previous data visible if available
      setTrendingError('Could not load trending posts. Tap to retry.');
    } finally {
      setTrendingLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.accent]);

  useEffect(() => {
    fetchHighDemand();
    fetchProducts();
    fetchFollowed();
    fetchTrending();
  }, [fetchHighDemand, fetchProducts, fetchFollowed, fetchTrending]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    hapticLight();
    Promise.all([fetchHighDemand(), fetchProducts(), fetchFollowed(), fetchTrending()])
      .finally(() => setRefreshing(false));
  }, [fetchHighDemand, fetchProducts, fetchFollowed, fetchTrending]);

  return (
    <ScrollView
      ref={scrollResetRef}
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ paddingBottom: barInset + SP.md }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      <TabPageHeader
        title="Discover"
        actions={[
          { name: 'search', onPress: () => router.push('/(buyer)/search' as never), accessibilityLabel: 'Search products and brands' },
          ...(isSignedIn ? [{ name: 'bell' as const, onPress: () => router.push('/(buyer)/inbox' as never), accessibilityLabel: 'Notifications' }] : []),
        ]}
      />

      {/* ─ Hero — full-bleed "Just Dropped" story. Sourced from the same For
          You catalogue fetched below (no separate endpoint yet). ─ */}
      {forYouLoading ? (
        <View style={{ marginBottom: SP.xl }}>
          <SkeletonBlock width="100%" height={520} radius={0} />
        </View>
      ) : forYouError ? (
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
          <View style={{ paddingTop: SP.md }}>
            <SectionError message={forYouError} onRetry={fetchProducts} />
          </View>
        </ResponsiveContainer>
      ) : forYouItems.length === 0 ? (
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
          <View style={{ paddingTop: SP.md }}>
            <EmptyState
              icon="package"
              title="No products available right now"
              description="New arrivals show up here as sellers add them."
              action={{ label: 'Search products', onPress: () => router.push('/(buyer)/search' as never) }}
            />
          </View>
        </ResponsiveContainer>
      ) : (
        <DiscoverHero
          items={forYouItems.slice(0, 6)}
          theme={theme}
          onOpenProduct={(item) => {
            hapticLight();
            const pid = encodeURIComponent(item.productId ?? item.id);
            push((`/thread-product-detail?productId=${pid}&productName=${encodeURIComponent(item.name)}`) as never);
          }}
          onShopAll={() => router.push('/(buyer)/search' as never)}
        />
      )}

      {/* ─ High Demand — publicProducts.highDemand(6) only, no trending posts ─ */}
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
        <EditorialSectionHead
          kicker="Moving fast"
          title="High Demand"
          sub="Products moving fast across the platform"
          theme={theme}
        />
        {highDemandLoading ? (
          <TileRailSkeleton />
        ) : highDemandError ? (
          <SectionError message={highDemandError} onRetry={fetchHighDemand} />
        ) : highDemandItems.length === 0 ? (
          <EmptyState
            icon="trending-up"
            title="No high-demand products right now"
            description="Check back soon, or browse everything sellers have listed."
            action={{ label: 'Browse products', onPress: () => router.push('/(buyer)/search' as never) }}
          />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingRight: GUTTER }}>
            {highDemandItems.map(item => (
              <EditorialTile key={item.id} item={item} theme={theme} />
            ))}
          </ScrollView>
        )}
      </ResponsiveContainer>

      {/* ─ For You — full-bleed floating product cards ─ */}
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: 4 }}>
        <EditorialSectionHead kicker="Just for you" title="For You" sub="Products from across the platform" theme={theme} />
      </ResponsiveContainer>

      {/* ─ Entry point into the full-screen, swipeable Discover pager ─ */}
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.md }}>
        <Card
          onPress={() => push('/(buyer)/discover-feed' as never)}
          accessibilityLabel="Open full-screen For You feed"
          style={fy.banner}
        >
          <View style={[fy.bannerIcon, { backgroundColor: theme.accentDim }]}>
            <Feather name="zap" size={18} color={theme.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.semibold, color: theme.text }]}>For You, full screen</Text>
            <Text style={[TYPE_SCALE.caption, { color: theme.muted, marginTop: 2 }]}>Swipe through products one at a time</Text>
          </View>
          <Feather name="chevron-right" size={18} color={theme.muted} />
        </Card>
      </ResponsiveContainer>
      {forYouLoading ? (
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
          <CardSkeleton width={showcaseSkeletonWidth} />
        </ResponsiveContainer>
      ) : forYouError ? (
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
          <SectionError message={forYouError} onRetry={fetchProducts} />
        </ResponsiveContainer>
      ) : forYouItems.length === 0 ? (
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
          <EmptyState
            icon="package"
            title="No products available right now"
            description="New arrivals show up here as sellers add them."
            action={{ label: 'Search products', onPress: () => router.push('/(buyer)/search' as never) }}
          />
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
          <ProductShowcase items={forYouItems} />
        </ResponsiveContainer>
      )}

      {/* ─ From Brands You Follow — signed-in only, composed client-side ─ */}
      {isSignedIn && (
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
          <EditorialSectionHead
            kicker="Your people"
            title="From Brands You Follow"
            sub="New from sellers you follow"
            theme={theme}
          />
          {followedLoading ? (
            <TileRailSkeleton />
          ) : followedError ? (
            <SectionError message={followedError} onRetry={fetchFollowed} />
          ) : followedItems.length === 0 ? (
            <EmptyState
              icon="users"
              title="Follow a brand to see them here"
              description="Products from sellers you follow will show up in this row."
              action={{ label: 'Find brands to follow', onPress: () => router.push('/(buyer)/search' as never) }}
              compact
            />
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingRight: GUTTER }}>
              {followedItems.map(item => (
                <EditorialTile key={item.id} item={item} theme={theme} />
              ))}
            </ScrollView>
          )}
        </ResponsiveContainer>
      )}

      {/* ─ Trending — engagement-ranked posts, separate from High Demand ─ */}
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: 4 }}>
        <EditorialSectionHead kicker="Right now" title="Trending" sub="Real-time engagement across the platform" theme={theme} />
      </ResponsiveContainer>
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
        <View style={{ gap: 10 }}>
          {trendingLoading ? (
            <ListSkeleton rows={3} />
          ) : trendingError ? (
            <SectionError message={trendingError} onRetry={fetchTrending} />
          ) : trendingItems.length === 0 ? (
            <EmptyState
              icon="activity"
              title="No trending posts right now"
              description="Posts with the most likes and saves across the platform show up here."
              action={{ label: 'Explore feed', onPress: () => router.push('/(buyer)/feed' as never) }}
            />
          ) : (
            trendingItems.slice(0, 10).map(item => <TrendingRow key={item.id} item={item} />)
          )}
        </View>
      </ResponsiveContainer>

      {/* ─ Recently viewed ─ */}
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginTop: SP.xl }}>
        <RecentlyViewedRow />
      </ResponsiveContainer>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const fy = StyleSheet.create({
  banner:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  bannerIcon: { width: 40, height: 40, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center' },
});
