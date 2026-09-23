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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApi } from '@/hooks/useApi';
import {
  BG, SURFACE, CARD,
  BORDER,
  FG, MUTED, SUBTLE, ON_DARK,
  FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useAuth } from '@clerk/expo';
import { formatCents } from '@/lib/money';
import { CachedImage } from '@/components/CachedImage';
import { saveItem, removeSavedItem, getSavedItems } from '@/services/socialService';
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
        <Text style={{ fontSize: 18, fontFamily: FONT.bold, color: FG, letterSpacing: -0.3 }} numberOfLines={1}>
          {title}
        </Text>
        {sub && (
          <Text style={{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 }} numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {action && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => { Haptics.selectionAsync(); onAction?.(); }}
          accessibilityRole="button"
          accessibilityLabel={`${action}, ${title}`}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.accent }}>
            {action}
          </Text>
        </TouchableOpacity>
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

function HighDemandRow({ item }: { item: HighDemandRowItem }) {
  const { push } = useThreadPull();
  const { theme } = useAppTheme();

  const isUrgent =
    (item.commerce.remainingUnits ?? 0) > 0 &&
    (item.commerce.remainingUnits ?? 0) <= URGENCY_UNITS_THRESHOLD;

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    push((`/thread-product-detail?productId=${encodeURIComponent(item.productId)}&productName=${encodeURIComponent(item.name)}`) as never);
  }

  return (
    <TouchableOpacity
      style={[hd.row, { borderColor: isUrgent ? `${theme.accent}44` : BORDER }]}
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${item.name} by ${item.brand}`}
    >
      {item.imageUri ? (
        <CachedImage source={{ uri: item.imageUri }} style={hd.avatar} contentFit="cover" />
      ) : (
        <View style={[hd.avatar, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={[hd.initials, { color: theme.text }]}>{item.initials}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={hd.name} numberOfLines={1}>{item.name}</Text>
        <Text style={hd.brand} numberOfLines={1}>{item.brand}</Text>
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
        <Text style={[hd.price, isUrgent && { color: theme.accent }]}>
          {formatCents(item.commerce.currentPriceCents)}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const hd = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: RADIUS.xs, borderWidth: 1, backgroundColor: CARD },
  avatar:   { width: 44, height: 44, borderRadius: RADIUS.xs, overflow: 'hidden' },
  initials: { fontSize: 13, fontFamily: FONT.bold, color: ON_DARK },
  name:     { fontSize: 13, fontFamily: FONT.semibold, color: FG },
  brand:    { fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  price:    { fontSize: 13, fontFamily: FONT.bold, color: FG },
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

function ProductShowcase({ items }: { items: ProductCardItem[] }) {
  const { push } = useThreadPull();
  const { theme } = useAppTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const [listWidth, setListWidth] = useState(viewportWidth);
  const [activeIndex, setActiveIndex] = useState(0);
  const [savedIds, setSavedIds] = useState<Record<string, boolean>>({});
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
        ItemSeparatorComponent={() => <View style={{ width: SHOWCASE_GAP }} />}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        onMomentumScrollEnd={event => {
          const nextIndex = Math.round(event.nativeEvent.contentOffset.x / snapInterval);
          setActiveIndex(Math.max(0, Math.min(items.length - 1, nextIndex)));
          Haptics.selectionAsync();
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
              <TouchableOpacity
                style={[showcase.card, { borderColor: isUrgent ? `${theme.accent}55` : BORDER }]}
                activeOpacity={0.92}
                accessibilityRole="button"
                accessibilityLabel={`${item.name} by ${item.brand}${item.commerce.currentPriceCents != null ? `, ${formatCents(item.commerce.currentPriceCents)}` : ''}`}
                onPress={() => openProduct(item)}
              >
                <View style={showcase.topline}>
                  <View style={{ flex: 1 }}>
                    <Text style={showcase.brand} numberOfLines={1}>{item.brand}</Text>
                    <Text style={showcase.name} numberOfLines={1}>{item.name}</Text>
                  </View>
                  <TouchableOpacity
                    style={showcase.save}
                    onPress={() => {
                      const nextSaved = !saved;
                      setSavedIds(current => ({ ...current, [item.id]: nextSaved }));
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const targetId = item.productId ?? item.id;
                      const action = nextSaved
                        ? saveItem({ type: 'product', targetId, title: item.name, subtitle: item.brand, accentColor: item.colorHex })
                        : removeSavedItem(targetId);
                      action.catch(() => {
                        setSavedIds(current => ({ ...current, [item.id]: !nextSaved }));
                      });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={saved ? 'Remove from saved' : 'Save product'}
                  >
                    <Feather name="bookmark" size={18} color={saved ? FG : MUTED} />
                  </TouchableOpacity>
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
                      <Text style={showcase.tagText}>{item.tag}</Text>
                    </View>
                  )}
                  {item.commerce.currentPriceCents != null && (
                    <View style={showcase.pricePill}>
                      <Text style={showcase.priceText}>{formatCents(item.commerce.currentPriceCents)}</Text>
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
              </TouchableOpacity>
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
    </View>
  );
}

const showcase = StyleSheet.create({
  shell:          { marginBottom: 32 },
  card:           { overflow: 'hidden', borderRadius: RADIUS.md, borderWidth: 1, backgroundColor: CARD, padding: 14 },
  topline:        { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 12 },
  brand:          { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  name:           { marginTop: 2, fontSize: 16, fontFamily: FONT.bold, color: FG, letterSpacing: -0.2 },
  save:           { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER },
  visual:         { height: 330, marginTop: 8, position: 'relative', overflow: 'hidden', borderRadius: RADIUS.sm, backgroundColor: SURFACE },
  visualFallback: { alignItems: 'center', justifyContent: 'center' },
  initials:       { fontSize: 56, fontFamily: FONT.bold, color: ON_DARK },
  tag:            { position: 'absolute', top: 12, left: 12, paddingHorizontal: 9, paddingVertical: 5, borderRadius: RADIUS.xs, backgroundColor: 'rgba(0,0,0,0.72)' },
  tagText:        { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK, letterSpacing: 0.7, textTransform: 'uppercase' },
  pricePill:      { position: 'absolute', bottom: 12, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: FG, borderWidth: 3, borderColor: CARD },
  priceText:      { fontSize: FS.sm, fontFamily: FONT.bold, color: BG },
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

function DropRow({ item }: { item: DropRowItem }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const isUrgentUnits =
    (item.commerce.remainingUnits ?? 0) > 0 &&
    (item.commerce.remainingUnits ?? 0) <= URGENCY_UNITS_THRESHOLD;

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push((`/buyer-drop-detail?dropId=${encodeURIComponent(item.dropId)}&dropName=${encodeURIComponent(item.name)}`) as never);
  }

  return (
    <TouchableOpacity
      style={[dr.row, { borderColor: item.isLive ? `${theme.accent}55` : BORDER }]}
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${item.name} by ${item.brand}${item.isLive ? ', live now' : ''}`}
    >
      {item.imageUri ? (
        <CachedImage source={{ uri: item.imageUri }} style={dr.avatar} contentFit="cover" />
      ) : (
        <View style={[dr.avatar, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={[dr.initials, { color: theme.text }]}>{item.initials}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={dr.name} numberOfLines={1}>{item.name}</Text>
        <Text style={dr.brand} numberOfLines={1}>{item.brand}</Text>
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
          <Text style={dr.price}>{formatCents(item.commerce.currentPriceCents)}</Text>
        )}
        {item.isLive ? (
          <View style={dr.liveRow}>
            <LivePulseDot color={theme.accent} />
            <Text style={[dr.liveText, { color: theme.accent }]}>Live now</Text>
          </View>
        ) : item.releaseAt ? (
          <UpcomingCountdown releaseAt={item.releaseAt} />
        ) : null}
        {!!item.endsAt && item.isLive && (
          <TimeRemainingLabel endsAt={item.endsAt} accent={theme.accent} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const dr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: RADIUS.xs, borderWidth: 1, backgroundColor: CARD },
  avatar:   { width: 44, height: 44, borderRadius: RADIUS.xs, overflow: 'hidden' },
  initials: { fontSize: 13, fontFamily: FONT.bold, color: ON_DARK },
  name:     { fontSize: 13, fontFamily: FONT.semibold, color: FG },
  brand:    { fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  price:    { fontSize: 13, fontFamily: FONT.bold, color: FG },
  liveRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveText: { fontSize: 11, fontFamily: FONT.semibold },
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

function TrendingRow({ item }: { item: TrendingRowItem }) {
  const router = useRouter();
  const { theme } = useAppTheme();

  function handlePress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (item.brandId) {
      // Trending posts navigate to seller profile via brandId — they have no productId
      router.push((`/seller-profile?id=${encodeURIComponent(item.brandId)}`) as never);
    }
  }

  return (
    <TouchableOpacity
      style={[tr.row, { borderColor: BORDER }]}
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`#${item.rank}, ${item.name} by ${item.brand}`}
    >
      <Text style={[tr.rank, { color: theme.accent }]}>#{item.rank}</Text>
      <View style={[tr.avatar, { backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={[tr.initials, { color: theme.text }]}>{item.initials}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={tr.name} numberOfLines={1}>{item.name}</Text>
        <Text style={tr.brand} numberOfLines={1}>{item.brand}</Text>
        {/* No commerce signals — trending posts have no product demand data */}
      </View>
    </TouchableOpacity>
  );
}

const tr = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: RADIUS.xs, borderWidth: 1, backgroundColor: CARD },
  rank:     { fontSize: 14, fontFamily: FONT.bold, width: 28 },
  avatar:   { width: 44, height: 44, borderRadius: RADIUS.xs, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 13, fontFamily: FONT.bold, color: ON_DARK },
  name:     { fontSize: 13, fontFamily: FONT.semibold, color: FG },
  brand:    { fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
});

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow() {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View style={[skRow.row, { opacity }]}>
      <View style={skRow.avatar} />
      <View style={{ flex: 1, gap: 8 }}>
        <View style={[skRow.line, { width: '65%' }]} />
        <View style={[skRow.line, { width: '45%' }]} />
      </View>
      <View style={[skRow.line, { width: 44 }]} />
    </Animated.View>
  );
}
const skRow = StyleSheet.create({
  row:    { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: RADIUS.xs, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  avatar: { width: 44, height: 44, borderRadius: RADIUS.xs, backgroundColor: SURFACE },
  line:   { height: 10, borderRadius: 4, backgroundColor: SURFACE },
});

function SkeletonCard() {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View style={[skCard.card, { opacity }]}>
      <View style={skCard.visual} />
      <View style={{ padding: 10, gap: 8 }}>
        <View style={[skRow.line, { width: '60%' }]} />
        <View style={[skRow.line, { width: '85%' }]} />
        <View style={[skRow.line, { width: '40%' }]} />
      </View>
    </Animated.View>
  );
}
const skCard = StyleSheet.create({
  card:   { width: 158, borderRadius: RADIUS.xs, overflow: 'hidden', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  visual: { height: 130, backgroundColor: SURFACE },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function DiscoverScreen() {
  const insets    = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const router    = useRouter();
  const api       = useApi();
  const { theme } = useAppTheme();
  const palette = theme as typeof theme & { background?: string; card?: string; border?: string; text?: string; muted?: string; };
  const { isSignedIn } = useAuth();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Promise.all([fetchHighDemand(), fetchProducts(), fetchDrops(), fetchTrending()])
      .finally(() => setRefreshing(false));
  }, [fetchHighDemand, fetchProducts, fetchDrops, fetchTrending]);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background ?? BG }}
      contentContainerStyle={{ paddingBottom: barInset + SP.md }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={theme.accent}
          colors={[theme.accent]}
        />
      }
    >
      {/* ─ Header ─ */}
      <View style={[s.header, { paddingTop: topPad + 16, paddingHorizontal: 20 }]}>
        <View>
          <Text style={[s.greeting, { color: palette.muted ?? MUTED }]}>What's dropping</Text>
          <Text style={[s.pageTitle, { color: palette.text ?? FG }]}>Discover</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <TouchableOpacity
            style={[s.headerBtn, { backgroundColor: palette.card ?? CARD, borderColor: palette.border ?? BORDER }]}
            activeOpacity={0.75}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(buyer)/search' as never); }}
            accessibilityRole="button"
            accessibilityLabel="Search products and brands"
          >
            <Feather name="search" size={18} color={MUTED} />
          </TouchableOpacity>
          {isSignedIn && (
            <TouchableOpacity
              style={[s.headerBtn, { backgroundColor: palette.card ?? CARD, borderColor: palette.border ?? BORDER }]}
              activeOpacity={0.75}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/(buyer)/inbox' as never); }}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <Feather name="bell" size={18} color={MUTED} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ─ High Demand — publicProducts.highDemand(6) only, no trending posts ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 32 }}>
        <HighDemandSectionHead
          title="High Demand"
          subtitle="Products moving fast across the platform"
          style={{ marginBottom: 14 }}
        />
        {highDemandLoading ? (
          <View style={{ gap: 10 }}>
            {[0, 1, 2].map(i => <SkeletonRow key={i} />)}
          </View>
        ) : highDemandError ? (
          <SectionError message={highDemandError} onRetry={fetchHighDemand} />
        ) : highDemandItems.length === 0 ? (
          <View style={s.emptyRow}>
            <Feather name="trending-up" size={22} color={SUBTLE} />
            <Text style={s.emptyText}>No high-demand products right now</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {highDemandItems.slice(0, 6).map(item => (
              <HighDemandRow key={item.id} item={item} />
            ))}
          </View>
        )}
      </View>

      {/* ─ For You ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <SectionHead
          title="For You"
          sub="Products from across the platform"
        />
      </View>
      {forYouLoading ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 4 }}
          style={{ marginBottom: 32 }}
          scrollEnabled={false}
        >
          {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
        </ScrollView>
      ) : forYouError ? (
        <View style={{ paddingHorizontal: 20, marginBottom: 32 }}>
          <SectionError message={forYouError} onRetry={fetchProducts} />
        </View>
      ) : forYouItems.length === 0 ? (
        <View style={[s.emptyRow, { marginBottom: 32 }]}>
          <Feather name="package" size={24} color={SUBTLE} />
          <Text style={s.emptyText}>No products available right now</Text>
        </View>
      ) : (
        <ProductShowcase items={forYouItems} />
      )}

      {/* ─ Drops ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <SectionHead
          title="Drops"
          sub={dropsItems.some(d => d.isLive) ? 'Live now and coming up' : 'Coming up'}
        />
      </View>
      <View style={{ paddingHorizontal: 20, gap: 10, marginBottom: 32 }}>
        {dropsLoading ? (
          [0, 1, 2].map(i => <SkeletonRow key={i} />)
        ) : dropsError ? (
          <SectionError message={dropsError} onRetry={fetchDrops} />
        ) : dropsItems.length === 0 ? (
          <View style={s.emptyRow}>
            <Feather name="calendar" size={22} color={SUBTLE} />
            <Text style={s.emptyText}>No upcoming drops right now</Text>
          </View>
        ) : (
          dropsItems.map(item => <DropRow key={item.id} item={item} />)
        )}
      </View>

      {/* ─ Trending — engagement-ranked posts, separate from High Demand ─ */}
      <View style={{ paddingHorizontal: 20, marginBottom: 4 }}>
        <SectionHead
          title="Trending"
          sub="Real-time engagement across the platform"
        />
      </View>
      <View style={{ paddingHorizontal: 20, gap: 10, marginBottom: 32 }}>
        {trendingLoading ? (
          [0, 1, 2].map(i => <SkeletonRow key={i} />)
        ) : trendingError ? (
          <SectionError message={trendingError} onRetry={fetchTrending} />
        ) : trendingItems.length === 0 ? (
          <View style={s.emptyRow}>
            <Feather name="activity" size={22} color={SUBTLE} />
            <Text style={s.emptyText}>No trending posts right now</Text>
          </View>
        ) : (
          trendingItems.slice(0, 10).map(item => <TrendingRow key={item.id} item={item} />)
        )}
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  greeting:  { fontSize: 12, fontFamily: FONT.medium, letterSpacing: 0.3 },
  pageTitle: { fontSize: 28, fontFamily: FONT.bold, letterSpacing: -0.6 },
  headerBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  emptyRow:  { paddingHorizontal: 20, paddingVertical: 24, alignItems: 'center', gap: 10 },
  emptyText: { color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.sm },
});
