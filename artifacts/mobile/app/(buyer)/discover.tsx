/**
 * Discover — curated shopping home for buyers.
 *
 * Four independent sections, each with its own loading / data state:
 *
 *   High Demand  — publicProducts.highDemand(6)
 *                  Only qualified product-backed rows. Empty = nothing qualifies.
 *                  NEVER sourced from trending posts; trending posts have no
 *                  productId and no demand fields.
 *
 *   For You      — publicProducts.list({ limit: 8 })
 *                  General product catalogue.
 *
 *   Drops        — publicDrops.list()
 *                  Live and upcoming drops.
 *
 *   Trending     — publicTrending.get(20)
 *                  Engagement-ranked posts. Posts only — no commerce signals.
 *                  Navigates to seller profile via brandId, not to product detail.
 *
 * Urgency accent is always theme.accent — never the error color constants.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useApi } from '@/hooks/useApi';
import {
  BG, SURFACE, CARD,
  FG, MUTED, SUBTLE, ON_DARK,
  FONT, SP, GUTTER, GRID_MAX_WIDTH,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useAuth } from '@clerk/expo';
import { formatCents } from '@/lib/money';
import { CachedImage } from '@/components/CachedImage';
import { CardSkeleton, ListSkeleton, ResponsiveContainer } from '@/components/layout';
import { EmptyState } from '@/components/BrandthreadUI';
import { saveItem, removeSavedItem, getSavedItems } from '@/services/socialService';
import { SaveToCollectionSheet, SaveToCollectionItem } from '@/components/SaveToCollectionSheet';
import {
  CommerceSignalRow,
  ClaimedRemainingLabel,
  TimeRemainingLabel,
  UrgencyBar,
  HighDemandSectionHead,
  UpcomingCountdown,
  LivePulseDot,
  URGENCY_UNITS_THRESHOLD,
  type CommerceSignalData,
} from '@/components/CommerceSignal';
import { SectionError } from '@/components/InlineFeedback';
import { Card, IconButton, HeartToggle, ThemedRefreshControl } from '@/components/ui';
import { TYPE_SCALE, TABULAR_NUMS } from '@/constants/typography';
import { RADII } from '@/constants/radii';
import { hapticLight, hapticMedium, hapticToggle } from '@/lib/haptics';

// ─── API-backed types ──────────────────────────────────────────────────────────

interface LiveProduct {
  id: string;
  name: string;
  sellerDisplayName?: string;
  images?: string[] | null;
  currentPriceCents?: number | null;
  claimedUnits?: number;
  remainingUnits?: number;
  demandCount?: number | null;
  endsAt?: string | null;
  tags?: string[];
  variants?: Array<{ priceCents?: number }>;
}

interface LiveDrop {
  id: string;
  name: string;
  type: string;
  releaseAt?: string | null;
  endsAt?: string | null;
  isLive?: boolean;
  isUpcoming?: boolean;
  isEnded?: boolean;
  currentPriceCents?: number | null;
  claimedUnits?: number;
  remainingUnits?: number;
  demandCount?: number | null;
  seller?: { displayName?: string; brandName?: string };
  products?: { images?: string[] }[];
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHead({
  title, sub, action, onAction,
}: {
  title: string; sub?: string; action?: string; onAction?: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14 }}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={[TYPE_SCALE.headline, { fontFamily: FONT.bold, color: FG, letterSpacing: -0.3 }]} numberOfLines={1}>
          {title}
        </Text>
        {sub && (
          <Text style={[TYPE_SCALE.caption, { color: MUTED, marginTop: 2 }]} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {action && (
        <Pressable
          onPress={() => { hapticToggle(); onAction?.(); }}
          accessibilityRole="button"
          accessibilityLabel={`${action}, ${title}`}
          style={{ minHeight: 44, justifyContent: 'center' }}
          hitSlop={8}
        >
          <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.semibold, color: theme.accent }]}>
            {action}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── High Demand product row ──────────────────────────────────────────────────
// Uses publicProducts.highDemand() — only qualified product-backed rows.
// Always navigates to thread-product-detail via real productId.
// Trending posts are NEVER mixed in here.

interface HighDemandRowItem {
  id: string;
  productId: string;  // real productId — guaranteed from highDemand()
  brand: string;
  name: string;
  imageUri?: string;
  initials: string;
  colorHex: string;
  commerce: CommerceSignalData;
}

const HighDemandRow = React.memo(function HighDemandRow({ item }: { item: HighDemandRowItem }) {
  const { push } = useThreadPull();
  const { theme } = useAppTheme();

  const isUrgent =
    (item.commerce.remainingUnits ?? 0) > 0 &&
    (item.commerce.remainingUnits ?? 0) <= URGENCY_UNITS_THRESHOLD;

  function handlePress() {
    hapticLight();
    push((`/thread-product-detail?productId=${encodeURIComponent(item.productId)}&productName=${encodeURIComponent(item.name)}`) as never);
  }

  return (
    <Card
      onPress={handlePress}
      accessibilityLabel={`${item.name} by ${item.brand}`}
      style={[hd.row, { borderColor: isUrgent ? `${theme.accent}44` : theme.border }]}
    >
      {item.imageUri ? (
        <CachedImage source={{ uri: item.imageUri }} style={hd.avatar} contentFit="cover" />
      ) : (
        <View style={[hd.avatar, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.bold, color: theme.text }]}>{item.initials}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.semibold, color: FG }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[TYPE_SCALE.caption, { color: MUTED, marginTop: 2 }]} numberOfLines={1}>{item.brand}</Text>
        <CommerceSignalRow
          claimedUnits={item.commerce.claimedUnits}
          remainingUnits={item.commerce.remainingUnits}
          demandCount={item.commerce.demandCount}
          endsAt={item.commerce.endsAt}
          accent={theme.accent}
          style={{ marginTop: 3 }}
        />
      </View>
      {item.commerce.currentPriceCents != null && (
        <Text style={[TYPE_SCALE.footnote, TABULAR_NUMS, { fontFamily: FONT.bold, color: isUrgent ? theme.accent : FG }]}>
          {formatCents(item.commerce.currentPriceCents)}
        </Text>
      )}
    </Card>
  );});

const hd = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  avatar:   { width: 44, height: 44, borderRadius: RADII.chip, overflow: 'hidden' },
});

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

const SHOWCASE_GAP = 12;

// Declared once: an inline separator component would be a new component type
// on every render, remounting every separator in the carousel.
function ShowcaseGap() {
  return <View style={{ width: SHOWCASE_GAP }} />;
}

function ProductShowcase({ items }: { items: ProductCardItem[] }) {
  const { push } = useThreadPull();
  const { theme } = useAppTheme();
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
            <Animated.View style={{ width: cardWidth, opacity, transform: [{ scale }] }}>
              <Card
                onPress={() => openProduct(item)}
                accessibilityLabel={`${item.name} by ${item.brand}${item.commerce.currentPriceCents != null ? `, ${formatCents(item.commerce.currentPriceCents)}` : ''}`}
                style={[showcase.card, { borderColor: isUrgent ? `${theme.accent}55` : theme.border }]}
              >
                <View style={showcase.topline}>
                  <View style={{ flex: 1 }}>
                    <Text style={[TYPE_SCALE.caption, { color: MUTED }]} numberOfLines={1}>{item.brand}</Text>
                    <Text style={[TYPE_SCALE.headline, { marginTop: 2, fontFamily: FONT.bold, color: FG, letterSpacing: -0.2 }]} numberOfLines={1}>{item.name}</Text>
                  </View>
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

                <View style={showcase.visual}>
                  {item.imageUri ? (
                    <CachedImage source={{ uri: item.imageUri }} style={StyleSheet.absoluteFill} contentFit="contain" />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, showcase.visualFallback, { backgroundColor: theme.cardElevated }]}>
                      <Text style={[showcase.initials, { color: theme.text }]}>{item.initials}</Text>
                    </View>
                  )}
                  {item.tag && (
                    <View style={showcase.tag}>
                      <Text style={[TYPE_SCALE.caption, { color: ON_DARK, letterSpacing: 0.7, textTransform: 'uppercase' }]}>{item.tag}</Text>
                    </View>
                  )}
                  {item.commerce.currentPriceCents != null && (
                    <View style={showcase.pricePill}>
                      <Text style={[TYPE_SCALE.footnote, TABULAR_NUMS, { fontFamily: FONT.bold, color: BG }]}>{formatCents(item.commerce.currentPriceCents)}</Text>
                    </View>
                  )}
                </View>

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
                  />
                )}
              </Card>
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

const showcase = StyleSheet.create({
  shell:          { marginBottom: 32 },
  card:           { overflow: 'hidden' },
  topline:        { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 12 },
  visual:         { height: 330, marginTop: 8, position: 'relative', overflow: 'hidden', borderRadius: RADII.card, backgroundColor: SURFACE },
  visualFallback: { alignItems: 'center', justifyContent: 'center' },
  initials:       { fontSize: 56, fontFamily: FONT.bold, color: ON_DARK },
  tag:            { position: 'absolute', top: 12, left: 12, paddingHorizontal: 9, paddingVertical: 5, borderRadius: RADII.chip, backgroundColor: 'rgba(0,0,0,0.72)' },
  pricePill:      { position: 'absolute', bottom: 12, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: RADII.pill, backgroundColor: FG, borderWidth: 3, borderColor: CARD },
  signalRow:      { minHeight: 34, paddingTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  pagination:     { height: 22, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  dot:            { width: 5, height: 5, borderRadius: 3, backgroundColor: SUBTLE },
  dotActive:      { width: 18, backgroundColor: FG },
});

// ─── Drop row ─────────────────────────────────────────────────────────────────

interface DropRowItem {
  id: string;
  dropId: string;
  brand: string;
  name: string;
  imageUri?: string;
  initials: string;
  colorHex: string;
  isLive?: boolean;
  releaseAt?: string | null;
  endsAt?: string | null;
  commerce: CommerceSignalData;
}

const DropRow = React.memo(function DropRow({ item }: { item: DropRowItem }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const isUrgentUnits =
    (item.commerce.remainingUnits ?? 0) > 0 &&
    (item.commerce.remainingUnits ?? 0) <= URGENCY_UNITS_THRESHOLD;

  function handlePress() {
    hapticMedium();
    router.push((`/buyer-drop-detail?dropId=${encodeURIComponent(item.dropId)}&dropName=${encodeURIComponent(item.name)}`) as never);
  }

  return (
    <Card
      onPress={handlePress}
      accessibilityLabel={`${item.name} by ${item.brand}${item.isLive ? ', live now' : ''}`}
      style={[dr.row, { borderColor: item.isLive ? `${theme.accent}55` : theme.border }]}
    >
      {item.imageUri ? (
        <CachedImage source={{ uri: item.imageUri }} style={dr.avatar} contentFit="cover" />
      ) : (
        <View style={[dr.avatar, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.bold, color: theme.text }]}>{item.initials}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.semibold, color: FG }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[TYPE_SCALE.caption, { color: MUTED, marginTop: 2 }]} numberOfLines={1}>{item.brand}</Text>
        <ClaimedRemainingLabel
          claimedUnits={item.commerce.claimedUnits ?? 0}
          remainingUnits={item.commerce.remainingUnits ?? 0}
          urgent={isUrgentUnits}
          accent={theme.accent}
          style={{ marginTop: 3 }}
        />
      </View>
      <View style={{ alignItems: 'flex-end', gap: 5 }}>
        {item.commerce.currentPriceCents != null && (
          <Text style={[TYPE_SCALE.footnote, TABULAR_NUMS, { fontFamily: FONT.bold, color: FG }]}>{formatCents(item.commerce.currentPriceCents)}</Text>
        )}
        {item.isLive ? (
          <View style={dr.liveRow}>
            <LivePulseDot color={theme.accent} />
            <Text style={[TYPE_SCALE.caption, { fontFamily: FONT.semibold, color: theme.accent }]}>Live now</Text>
          </View>
        ) : item.releaseAt ? (
          <UpcomingCountdown releaseAt={item.releaseAt} />
        ) : null}
        {!!item.endsAt && item.isLive && (
          <TimeRemainingLabel endsAt={item.endsAt} accent={theme.accent} />
        )}
      </View>
    </Card>
  );});

const dr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  avatar:   { width: 44, height: 44, borderRadius: RADII.chip, overflow: 'hidden' },
  liveRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
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
      <Text style={[TYPE_SCALE.callout, TABULAR_NUMS, { fontFamily: FONT.bold, color: theme.accent, width: 28 }]}>#{item.rank}</Text>
      <View style={[tr.avatar, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.bold, color: theme.text }]}>{item.initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.semibold, color: FG }]} numberOfLines={1}>{item.name}</Text>
        <Text style={[TYPE_SCALE.caption, { color: MUTED, marginTop: 2 }]} numberOfLines={1}>{item.brand}</Text>
        {/* No commerce signals — trending posts have no product demand data */}
      </View>
    </Card>
  );});

const tr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  avatar:   { width: 44, height: 44, borderRadius: RADII.chip, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const insets    = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const router    = useRouter();
  const { push }  = useThreadPull();
  const api       = useApi();
  const { theme } = useAppTheme();
  const palette = theme as typeof theme & { background?: string; card?: string; border?: string; text?: string; muted?: string; };
  const { isSignedIn } = useAuth();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const { width: winWidth } = useWindowDimensions();
  const showcaseSkeletonWidth = Math.min(Math.max(winWidth - 54 - GUTTER * 2, 1), 370);

  // ─ Each section has independent loading, error, and data ──────────

  const [refreshing, setRefreshing] = useState(false);

  // High Demand — publicProducts.highDemand(6) only.
  // Never sourced from trending posts. Empty array = nothing qualifies.
  const [highDemandItems,   setHighDemandItems]   = useState<HighDemandRowItem[]>([]);
  const [highDemandLoading, setHighDemandLoading] = useState(true);
  const [highDemandError,   setHighDemandError]   = useState<string | null>(null);

  const [forYouItems,    setForYouItems]    = useState<ProductCardItem[]>([]);
  const [forYouLoading,  setForYouLoading]  = useState(true);
  const [forYouError,    setForYouError]    = useState<string | null>(null);

  const [dropsItems,   setDropsItems]   = useState<DropRowItem[]>([]);
  const [dropsLoading, setDropsLoading] = useState(true);
  const [dropsError,   setDropsError]   = useState<string | null>(null);

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
      const safe = Array.isArray(rows) ? rows : [];
      setHighDemandItems(safe.map((p: any): HighDemandRowItem => {
        const firstImg = (p.images ?? [])[0] ?? undefined;
        const fallbackPrice = (p.variants ?? [])[0]?.priceCents ?? null;
        return {
          id:        `hd_${p.id}`,
          productId: p.id,  // real productId — thread-product-detail navigation
          brand:     p.sellerDisplayName ?? 'Seller',
          name:      p.name,
          imageUri:  firstImg,
          initials:  (p.name ?? 'P')[0].toUpperCase(),
          colorHex:  theme.accent,
          commerce: {
            currentPriceCents: p.currentPriceCents ?? fallbackPrice,
            claimedUnits:      typeof p.claimedUnits  === 'number' ? p.claimedUnits  : 0,
            remainingUnits:    typeof p.remainingUnits === 'number' ? p.remainingUnits : 0,
            demandCount:       typeof p.demandCount    === 'number' ? p.demandCount    : null,
            endsAt:            p.endsAt ?? null,
          },
        };
      }));
    } catch {
      // Do NOT reset highDemandItems — keep previous data visible if available
      setHighDemandError('Could not load high demand products. Tap to retry.');
    } finally {
      setHighDemandLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.accent]);

  // ─ Fetch For You products ─────────────────────────────────────────────
  // publicProducts.list returns any[] directly — no {items} wrapper.
  const fetchProducts = useCallback(async () => {
    setForYouLoading(true);
    setForYouError(null);
    try {
      const rows = await api.publicProducts.list({ limit: 8 });
      const safe: LiveProduct[] = Array.isArray(rows) ? rows : [];
      setForYouItems(safe.map((row, i): ProductCardItem => {
        const firstImg = (row.images ?? [])[0] ?? undefined;
        const fallbackPrice = (row.variants ?? [])[0]?.priceCents ?? null;
        return {
          id:         `fy_${i}`,
          productId:  row.id,
          brand:      row.sellerDisplayName ?? 'Seller',
          name:       row.name,
          imageUri:   firstImg,
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

  // ─ Fetch Drops ────────────────────────────────────────────────────────
  const fetchDrops = useCallback(async () => {
    setDropsLoading(true);
    setDropsError(null);
    try {
      const rows = await (api as any).publicDrops?.list?.() ?? [];
      const safe: LiveDrop[] = Array.isArray(rows)
        ? rows
        : Array.isArray((rows as any)?.drops) ? (rows as any).drops : [];
      const filtered = safe
        .filter(d => !d.isEnded)
        .sort((a, b) => (b.isLive ? 1 : 0) - (a.isLive ? 1 : 0))
        .slice(0, 6);
      setDropsItems(filtered.map((d): DropRowItem => {
        const firstImg = (d.products ?? []).flatMap(p => p.images ?? []).find(Boolean);
        const sellerName = d.seller?.brandName ?? d.seller?.displayName ?? 'Brand';
        return {
          id:        d.id,
          dropId:    d.id,
          brand:     sellerName,
          name:      d.name,
          imageUri:  firstImg,
          initials:  sellerName.slice(0, 2).toUpperCase(),
          colorHex:  theme.accent,
          isLive:    d.isLive,
          releaseAt: d.releaseAt,
          endsAt:    d.endsAt,
          commerce: {
            currentPriceCents: d.currentPriceCents ?? null,
            claimedUnits:      d.claimedUnits  ?? 0,
            remainingUnits:    d.remainingUnits ?? 0,
            demandCount:       d.demandCount   ?? null,
            endsAt:            d.endsAt,
          },
        };
      }));
    } catch {
      // Do NOT reset dropsItems — keep previous data visible if available
      setDropsError('Could not load drops. Tap to retry.');
    } finally {
      setDropsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.accent]);

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
    fetchDrops();
    fetchTrending();
  }, [fetchHighDemand, fetchProducts, fetchDrops, fetchTrending]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    hapticLight();
    Promise.all([fetchHighDemand(), fetchProducts(), fetchDrops(), fetchTrending()])
      .finally(() => setRefreshing(false));
  }, [fetchHighDemand, fetchProducts, fetchDrops, fetchTrending]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background ?? BG }}
      contentContainerStyle={{ paddingBottom: barInset + SP.md }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
      }
    >
      {/* ─ Header ─ */}
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
        <View style={[s.header, { paddingTop: topPad + 16 }]}>
          <View>
            <Text style={[TYPE_SCALE.caption, { color: palette.muted ?? MUTED, letterSpacing: 0.3 }]}>What's dropping</Text>
            <Text style={[TYPE_SCALE.title1, { color: palette.text ?? FG, letterSpacing: -0.6 }]}>Discover</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <IconButton
              name="search"
              onPress={() => router.push('/(buyer)/search' as never)}
              accessibilityLabel="Search products and brands"
            />
            {isSignedIn && (
              <IconButton
                name="bell"
                onPress={() => router.push('/(buyer)/inbox' as never)}
                accessibilityLabel="Notifications"
              />
            )}
          </View>
        </View>
      </ResponsiveContainer>

      {/* ─ High Demand — publicProducts.highDemand(6) only, no trending posts ─ */}
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
        <HighDemandSectionHead
          title="High Demand"
          subtitle="Products moving fast across the platform"
          style={{ marginBottom: 14 }}
        />
        {highDemandLoading ? (
          <ListSkeleton rows={3} />
        ) : highDemandError ? (
          <SectionError message={highDemandError} onRetry={fetchHighDemand} />
        ) : highDemandItems.length === 0 ? (
          <EmptyState icon="trending-up" title="No high-demand products right now" compact />
        ) : (
          <View style={{ gap: 10 }}>
            {highDemandItems.slice(0, 6).map(item => (
              <HighDemandRow key={item.id} item={item} />
            ))}
          </View>
        )}
      </ResponsiveContainer>

      {/* ─ For You ─ */}
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: 4 }}>
        <SectionHead
          title="For You"
          sub="Products from across the platform"
        />
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
            <Text style={[TYPE_SCALE.footnote, { fontFamily: FONT.semibold, color: FG }]}>For You, full screen</Text>
            <Text style={[TYPE_SCALE.caption, { color: MUTED, marginTop: 2 }]}>Swipe through products one at a time</Text>
          </View>
          <Feather name="chevron-right" size={18} color={MUTED} />
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
          <EmptyState icon="package" title="No products available right now" compact />
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
          <ProductShowcase items={forYouItems} />
        </ResponsiveContainer>
      )}

      {/* ─ Drops ─ */}
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: 4 }}>
        <SectionHead
          title="Drops"
          sub={dropsItems.some(d => d.isLive) ? 'Live now and coming up' : 'Coming up'}
          action="See all"
          onAction={() => router.push('/buyer-drops' as never)}
        />
      </ResponsiveContainer>
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
        <View style={{ gap: 10 }}>
          {dropsLoading ? (
            <ListSkeleton rows={3} />
          ) : dropsError ? (
            <SectionError message={dropsError} onRetry={fetchDrops} />
          ) : dropsItems.length === 0 ? (
            <EmptyState icon="calendar" title="No upcoming drops right now" compact />
          ) : (
            dropsItems.map(item => <DropRow key={item.id} item={item} />)
          )}
        </View>
      </ResponsiveContainer>

      {/* ─ Trending — engagement-ranked posts, separate from High Demand ─ */}
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: 4 }}>
        <SectionHead
          title="Trending"
          sub="Real-time engagement across the platform"
        />
      </ResponsiveContainer>
      <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ marginBottom: SP.xl }}>
        <View style={{ gap: 10 }}>
          {trendingLoading ? (
            <ListSkeleton rows={3} />
          ) : trendingError ? (
            <SectionError message={trendingError} onRetry={fetchTrending} />
          ) : trendingItems.length === 0 ? (
            <EmptyState icon="activity" title="No trending posts right now" compact />
          ) : (
            trendingItems.slice(0, 10).map(item => <TrendingRow key={item.id} item={item} />)
          )}
        </View>
      </ResponsiveContainer>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
});

const fy = StyleSheet.create({
  banner:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13 },
  bannerIcon: { width: 40, height: 40, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center' },
});
