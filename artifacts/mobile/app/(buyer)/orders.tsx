import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useScrollReset } from '@/hooks/useScrollReset';
import { BuyerOrderView, cancellationReasonLabel, TrackingStatus, OrderStatus } from '@/services/orderTypes';
import { getBuyerOrdersWithStatus, mapApiBuyerOrder } from '@/services/orderService';
import { visibleOrdersForBuyer } from '@/lib/buyerOrdersVisibility';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { getPreviewBuyerOrders as getPreviewDeliveryBuyerOrders, isPreviewOrderId } from '@/lib/previewOrders';
import { getPreviewBuyerOrders as getPreviewCommerceBuyerOrders, isPreviewCommerceId } from '@/lib/previewCommerce';
import { formatCents } from '@/lib/money';
import { deliveryHeadline } from '@/lib/deliveryGuarantee';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  BrandthreadScreen, FilterChip,
  StatusBadge, EmptyState,
} from '@/components/BrandthreadUI';
import { Header, SkeletonBlock, useCenteredContentPadding } from '@/components/layout';
import { OrderStatusTimeline } from '@/components/orders/OrderStatusTimeline';
import { useReorderFlow } from '@/components/orders/ReorderFlow';
import { canReorderStatus } from '@/lib/reorderSummary';
import { RetryRow } from '@/components/ui/RetryRow';
import { getBuyerReturns } from '@/services/buyerReturnsService';
import { returnReasonLabel, statusLabel as returnStatusLabel, type ReturnView } from '@/lib/returns';
import type { AppThemePreset } from '@/contexts/AppThemeContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Monochrome: every order status reads as the same neutral pill; the label carries the meaning.
function statusBadgeVariant(_status: OrderStatus): 'neutral' {
  return 'neutral';
}

function statusBadgeLabel(status: OrderStatus): string {
  switch (status) {
    case 'new':           return 'NEW';
    case 'processing':    return 'PROCESSING';
    case 'ready_to_ship': return 'READY';
    case 'shipped':       return 'SHIPPED';
    case 'delivered':     return 'DELIVERED';
    case 'cancelled':     return 'CANCELLED';
    case 'refunded':      return 'REFUNDED';
    case 'disputed':      return 'DISPUTED';
    default:              return (status as string).toUpperCase();
  }
}

function trackingLabel(ts: TrackingStatus): string {
  switch (ts) {
    case 'label_created':    return 'Label created';
    case 'accepted':         return 'Accepted';
    case 'in_transit':       return 'In transit';
    case 'out_for_delivery': return 'Out for delivery';
    case 'delivered':        return 'Delivered';
    case 'exception':        return 'Exception';
    case 'returned_to_sender': return 'Returned to sender';
    default: return ts;
  }
}

type BuyerFilterKey = 'all' | 'active' | 'shipped' | 'delivered' | 'returns' | 'pre-order';

const FILTER_CHIPS: { key: BuyerFilterKey; label: string }[] = [
  { key: 'all',       label: 'All' },
  { key: 'active',    label: 'Active' },
  { key: 'shipped',   label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'returns',   label: 'Returns' },
  { key: 'pre-order', label: 'Pre-order' },
];

function applyFilter(orders: BuyerOrderView[], filter: BuyerFilterKey): BuyerOrderView[] {
  switch (filter) {
    case 'all':       return orders;
    case 'active':    return orders.filter(o => ['new', 'processing', 'ready_to_ship'].includes(o.status));
    case 'shipped':   return orders.filter(o => o.status === 'shipped');
    case 'delivered': return orders.filter(o => o.status === 'delivered');
    // The Returns tab renders the buyer's return requests from
    // GET /api/returns/buyer (see BuyerReturnCard), not order rows.
    case 'returns':   return [];
    case 'pre-order': return orders.filter(o => o.isPreOrder);
    default:          return orders;
  }
}

// ─── Order Card ───────────────────────────────────────────────────────────────
// Visual, tracker-forward card: seller + order meta up top, a live compact
// status tracker as the centerpiece, then item preview / total / actions.

const BuyerOrderCard = React.memo(function BuyerOrderCard({ order, onOpen, onTrack, onReorder, reordering }: { order: BuyerOrderView; onOpen: (orderId: string) => void; onTrack: (orderId: string) => void; onReorder?: (orderId: string) => void; reordering?: boolean }) {
  const onPress = () => onOpen(order.id);
  const { theme } = useAppTheme();
  const styles = useMemo(() => cardStyles(theme), [theme]);
  const firstItem = order.lineItems[0];
  const extraCount = order.lineItems.length - 1;
  const sellerInitial = order.sellerName.charAt(0).toUpperCase();
  const isTerminalStatus = order.status === 'cancelled' || order.status === 'refunded' || order.status === 'disputed';
  // Preview orders are list-only here: never pass their synthetic IDs into
  // a detail or mutation route that can reach the live API.
  const isPreview = isPreviewOrderId(order.id) || isPreviewCommerceId(order.id);
  const autoRefunded = !!order.delivery?.autoRefund;
  const headline = deliveryHeadline(order);
  const thumbs = order.lineItems.slice(0, 4);

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={onPress} disabled={isPreview}>
      {/* Top row */}
      <View style={styles.cardTopRow}>
        <View style={[styles.avatarCircle, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
          <Text style={[styles.avatarText, { color: theme.accentLight }]}>{sellerInitial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sellerName}>{order.sellerName}</Text>
          <Text style={styles.orderMeta}>{order.orderNumber} · {fmtDate(order.createdAt)}</Text>
        </View>
        <StatusBadge
          label={autoRefunded ? (order.delivery?.autoRefund?.partial ? 'PARTIAL REFUND' : 'REFUNDED') : statusBadgeLabel(order.status)}
          variant={autoRefunded ? 'neutral' : statusBadgeVariant(order.status)}
          small
        />
      </View>

      {/* Delivery headline — "Arriving Oct 15" / "Delivered" / "Refunded" */}
      {headline && (
        <Text
          style={[styles.headline, headline.tone === 'muted' && { color: theme.muted }]}
          numberOfLines={1}
        >
          {headline.text}
        </Text>
      )}

      {/* Item thumbnails */}
      {thumbs.length > 0 && (
        <View style={styles.thumbRow}>
          {thumbs.map((item, i) => (
            item.imageUri ? (
              <Image key={i} source={{ uri: item.imageUri }} style={styles.thumb} resizeMode="cover" accessibilityLabel={item.productName} />
            ) : (
              <View key={i} style={[styles.thumb, styles.thumbFallback]}>
                <Feather name="image" size={16} color={theme.subtle} />
              </View>
            )
          ))}
          {order.lineItems.length > thumbs.length && (
            <View style={[styles.thumb, styles.thumbFallback]}>
              <Text style={styles.moreText}>+{order.lineItems.length - thumbs.length}</Text>
            </View>
          )}
        </View>
      )}

      {/* Items */}
      <View style={{ marginTop: SP.sm }}>
        {firstItem && (
          <Text style={styles.itemText} numberOfLines={1}>
            {firstItem.productName} ({firstItem.variant}) × {firstItem.quantity}
          </Text>
        )}
        {extraCount > 0 && (
          <Text style={styles.moreText}>+ {extraCount} more item{extraCount > 1 ? 's' : ''}</Text>
        )}
      </View>

      {/* Live status tracker — visual centerpiece of the card */}
      {!autoRefunded && (
        <View style={styles.trackerWrap}>
          <OrderStatusTimeline status={order.status} compact />
        </View>
      )}

      {/* Price + pre-order row */}
      <View style={styles.statusRow}>
        {order.isPreOrder && (
          <View style={styles.preOrderBadge}>
            <Text style={styles.preOrderText}>PRE-ORDER</Text>
          </View>
        )}
        <Text style={styles.totalText}>{formatCents(order.payment.totalCents)}</Text>
      </View>

      {order.status === 'cancelled' && !autoRefunded && (
        <View style={styles.cancellationBanner}>
          <Feather name="x-circle" size={ICON.sm} color={theme.error} />
          <View style={styles.cancellationCopy}>
            <Text style={styles.cancellationLabel}>Order cancelled</Text>
            <Text style={styles.cancellationReason} numberOfLines={1}>
              {cancellationReasonLabel(order.cancellationReason)}
            </Text>
          </View>
        </View>
      )}

      {/* Tracking info */}
      {order.trackingStatus && !isTerminalStatus && !order.delivery && (
        <View style={styles.trackingRow}>
          <Feather name="truck" size={ICON.xs} color={theme.secondary} />
          <Text style={styles.trackingText}>
            {trackingLabel(order.trackingStatus)}
            {order.estimatedDelivery ? ` → Est. ${fmtDate(order.estimatedDelivery)}` : ''}
            {isPreview && order.trackingNumber ? ` · ${order.trackingNumber}` : ''}
          </Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.accentDim, borderColor: theme.accent }]} onPress={onPress} activeOpacity={0.8} disabled={isPreview}>
          <Text style={[styles.actionBtnText, { color: theme.accentLight }]}>View Order Details</Text>
        </TouchableOpacity>
        {order.trackingNumber && !isPreview && (
          <TouchableOpacity
             style={[styles.actionBtn, styles.actionBtnSecondary, { backgroundColor: theme.secondaryDim, borderColor: theme.secondary }]}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Track shipment"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onTrack(order.id); }}
          >
            <Feather name="map-pin" size={12} color={theme.secondary} />
            <Text style={[styles.actionBtnText, { color: theme.secondary }]}>Track Shipment</Text>
          </TouchableOpacity>
        )}
        {onReorder && canReorderStatus(order.status) && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.reorderBtn, { backgroundColor: theme.accentDim, borderColor: theme.accent, opacity: reordering ? 0.5 : 1 }]}
            activeOpacity={0.8}
            disabled={reordering}
            accessibilityRole="button"
            accessibilityLabel="Reorder"
            onPress={() => onReorder(order.id)}
          >
            <Feather name="repeat" size={12} color={theme.accentLight} />
            <Text style={[styles.actionBtnText, { color: theme.accentLight }]}>{reordering ? 'Adding…' : 'Reorder'}</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
});

// ─── Return card (Returns tab) ───────────────────────────────────────────────
// One row per return request from GET /api/returns/buyer; opens the shared
// return status screen (app/return-detail.tsx).

const BuyerReturnCard = React.memo(function BuyerReturnCard({ item, onOpen }: { item: ReturnView; onOpen: (returnId: string) => void }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => cardStyles(theme), [theme]);
  const firstItem = item.items[0];
  const refund = item.refundAmountCents != null ? formatCents(item.refundAmountCents) : null;
  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={0.82}
      onPress={() => onOpen(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`Return for order ${item.orderNumber}, ${returnStatusLabel(item.status)}`}
    >
      <View style={styles.cardTopRow}>
        <View style={[styles.avatarCircle, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
          <Feather name="rotate-ccw" size={ICON.sm} color={theme.accentLight} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sellerName}>{item.sellerName}</Text>
          <Text style={styles.orderMeta}>{item.orderNumber ? `${item.orderNumber} · ` : ''}{fmtDate(item.createdAt)}</Text>
        </View>
        <StatusBadge label={returnStatusLabel(item.status).toUpperCase()} variant="neutral" small />
      </View>
      <View style={{ marginTop: SP.sm }}>
        <Text style={styles.itemText} numberOfLines={1}>{returnReasonLabel(item.reason)}</Text>
        {firstItem && (
          <Text style={styles.moreText} numberOfLines={1}>
            {firstItem.productName}{firstItem.variantTitle ? ` (${firstItem.variantTitle})` : ''} × {firstItem.quantity}
            {item.items.length > 1 ? ` + ${item.items.length - 1} more` : ''}
          </Text>
        )}
        {item.status === 'denied' && !!item.sellerResponse && (
          <Text style={styles.moreText} numberOfLines={2}>{item.sellerResponse}</Text>
        )}
      </View>
      <View style={styles.statusRow}>
        <Text style={styles.totalText}>{refund ? `Refund ${refund}` : formatCents(item.orderTotalCents)}</Text>
      </View>
    </TouchableOpacity>
  );
});

// ─── Order card skeleton — matches BuyerOrderCard: avatar + seller/date, item
// line, then a status + price row ──────────────────────────────────────────
function BuyerOrderCardSkeleton() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => cardStyles(theme), [theme]);
  return (
    <View style={styles.card}>
      <View style={styles.cardTopRow}>
        <SkeletonBlock width={40} height={40} radius={RADIUS.pill} />
        <View style={{ flex: 1, gap: SP.xs }}>
          <SkeletonBlock width="55%" height={14} />
          <SkeletonBlock width="35%" height={11} />
        </View>
      </View>
      <View style={{ marginTop: SP.sm }}>
        <SkeletonBlock width="70%" height={13} />
      </View>
      <View style={{ marginTop: SP.md }}>
        <SkeletonBlock width="100%" height={10} />
      </View>
      <View style={styles.statusRow}>
        <SkeletonBlock width={56} height={14} style={{ marginLeft: 'auto' as any }} />
      </View>
    </View>
  );
}

function BuyerOrdersListSkeleton() {
  return (
    <View style={{ gap: SP.md }}>
      {Array.from({ length: 4 }).map((_, i) => <BuyerOrderCardSkeleton key={i} />)}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerOrdersScreen() {
  const scrollResetRef = useScrollReset<any>(true, false);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const centeredPadding = useCenteredContentPadding();
  const router = useRouter();
  const openOrder = useCallback((orderId: string) => {
    // Synthetic preview orders are list-only; never hand their IDs to a
    // detail/mutation route backed by the live API.
    if (isPreviewOrderId(orderId) || isPreviewCommerceId(orderId)) return;
    router.push(('/buyer-order-detail?id=' + orderId) as never);
  }, [router]);
  // Track Shipment opens the order's tracking screen (carrier, number,
  // status, scan history, carrier link), not the order details page.
  const openTracking = useCallback((orderId: string) => {
    if (isPreviewOrderId(orderId) || isPreviewCommerceId(orderId)) return;
    router.push(('/buyer-order-tracking?id=' + encodeURIComponent(orderId)) as never);
  }, [router]);
  const openReturn = useCallback((returnId: string) => {
    router.push(('/return-detail?returnId=' + encodeURIComponent(returnId)) as never);
  }, [router]);
  const { userId } = useAuth();
  const buyerPreview = isBuyerDevPreview() && !userId;
  const { reorder, busyOrderId, element: reorderElement } = useReorderFlow({ aboveTabBar: true });

  const [orders, setOrders] = useState<BuyerOrderView[]>([]);
  const [ordersOwnerId, setOrdersOwnerId] = useState<string | null | undefined>(userId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<BuyerFilterKey>('all');
  // Returns tab: the buyer's real return requests (GET /api/returns/buyer).
  const [returns, setReturns] = useState<ReturnView[]>([]);
  const [returnsOwnerId, setReturnsOwnerId] = useState<string | null | undefined>(userId);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [returnsError, setReturnsError] = useState(false);
  const returnsGenerationRef = useRef(0);
  // Track whether the very first load has completed so re-focuses and
  // polling intervals don't flash the full-screen spinner.
  const hasLoadedRef = useRef(false);
  // Backoff: stop polling after 3 consecutive failures; resume on next focus.
  // A generation counter ensures requests from a previous focus cycle cannot
  // increment the failure count or clear the timer of the current focus cycle.
  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);

  const load = useCallback(async (generation: number) => {
    if (!userId) {
      // The explicit demo cast includes delivery-guarantee states; a fresh
      // buyer preview retains its list-only synthetic commerce orders.
      setOrders(isPreviewDemoMode()
        ? getPreviewDeliveryBuyerOrders().map(mapApiBuyerOrder)
        : buyerPreview ? getPreviewCommerceBuyerOrders() : []);
      setOrdersOwnerId(userId);
      setLoading(false);
      setRefreshing(false);
      setLoadError(false);
      hasLoadedRef.current = true;
      return;
    }
    try {
      const result = await getBuyerOrdersWithStatus(userId);
      if (generationRef.current !== generation) return; // stale focus cycle
      // A failed fetch still returns cached/previous orders (see
      // getBuyerOrdersWithStatus). Never replace real orders with an empty
      // list just because this fetch failed — show an error banner instead.
      setOrders(result.orders);
      setOrdersOwnerId(userId);
      setLoadError(!!result.error);
      if (!result.error) consecutiveFailuresRef.current = 0;
      else consecutiveFailuresRef.current += 1;
      if (result.error && consecutiveFailuresRef.current >= 3 && timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } catch {
      if (generationRef.current !== generation) return; // stale focus cycle
      // Keep whatever orders were already loaded — an error is never shown
      // as an empty state.
      setOrdersOwnerId(userId);
      setLoadError(true);
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3 && timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    if (generationRef.current !== generation) return;
    setLoading(false);
    setRefreshing(false);
    hasLoadedRef.current = true;
  }, [buyerPreview, userId]);

  const loadReturns = useCallback(async () => {
    const generation = ++returnsGenerationRef.current;
    if (!userId) {
      // Signed-out preview: no synthetic returns.
      setReturns([]);
      setReturnsOwnerId(userId);
      setReturnsError(false);
      setReturnsLoading(false);
      return;
    }
    setReturnsLoading(true);
    setReturnsError(false);
    try {
      const rows = await getBuyerReturns();
      if (returnsGenerationRef.current !== generation) return;
      setReturns(rows);
      setReturnsOwnerId(userId);
    } catch {
      if (returnsGenerationRef.current !== generation) return;
      // Keep the last loaded rows for this account; never show an error as "no returns".
      setReturnsOwnerId(userId);
      setReturnsError(true);
    } finally {
      if (returnsGenerationRef.current === generation) setReturnsLoading(false);
    }
  }, [userId]);

  React.useEffect(() => {
    returnsGenerationRef.current += 1;
    setReturns([]);
    setReturnsOwnerId(userId);
    setReturnsError(false);
    setReturnsLoading(false);
  }, [userId]);

  // Load when the Returns tab is opened (and again whenever the screen refocuses on it).
  useFocusEffect(useCallback(() => {
    if (filter === 'returns') void loadReturns();
  }, [filter, loadReturns]));

  const retry = useCallback(() => {
    if (refreshing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    consecutiveFailuresRef.current = 0;
    setRefreshing(true);
    if (orders.length === 0) setLoading(true);
    void load(generationRef.current);
  }, [load, orders.length, refreshing]);

  React.useEffect(() => {
    generationRef.current += 1;
    hasLoadedRef.current = false;
    consecutiveFailuresRef.current = 0;
    setOrders([]);
    setOrdersOwnerId(userId);
    setLoadError(false);
    setRefreshing(false);
    setLoading(true);
  }, [userId]);

  // Refresh immediately on focus, then poll every 30 s while on this screen.
  // Spinner only shows on the very first load; subsequent refreshes are silent.
  // After 3 consecutive failures the interval is cleared to avoid hammering a
  // down/offline server; it resets on the next focus event.
  useFocusEffect(useCallback(() => {
    const generation = ++generationRef.current;
    consecutiveFailuresRef.current = 0;
    if (!hasLoadedRef.current) setLoading(true);
    load(generation);
    timerRef.current = setInterval(() => load(generation), 30_000);
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [load]));

  // Clerk can switch active sessions without unmounting this route. Guard the
  // render synchronously so the previous account's rows disappear before the
  // reset effect or the new account's request has completed.
  const ownsRenderedOrders = ordersOwnerId === userId;
  const visibleOrders = visibleOrdersForBuyer(orders, ordersOwnerId, userId);
  const filtered = applyFilter(visibleOrders, filter);
  const visibleLoading = loading || !ownsRenderedOrders;
  const showingReturns = filter === 'returns';
  const visibleReturns = returnsOwnerId === userId ? returns : [];

  return (
    <BrandthreadScreen noSafeBottom noSafeTop>
      {/* Shared page header — identical large-title size/weight/offset to every other tab-root page */}
      <Header title="My Orders" largeTitle showBack={false} />

      {/* Filter chips — horizontal scroll, edge-to-edge. The screen's own
          gutter (`centeredPadding`) on the content container is what lets
          the last chip clip naturally at the screen edge as a scroll
          affordance — no gradient overlay on top of the chips themselves
          (a previous `GRAD_DARK_FADE` scrim here went fully opaque at its
          own edge, painting a solid black block over the last chip instead
          of fading it — same antipattern the tab-bar glass zone replaced
          for Activity, see app/activity-center.tsx's history). */}
      <FlatList
        horizontal
        style={{ flexGrow: 0 }}
        data={FILTER_CHIPS}
        keyExtractor={i => i.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: centeredPadding, gap: 8, paddingBottom: SP.sm }}
        renderItem={({ item }) => (
          <FilterChip
            label={item.label}
            active={filter === item.key}
            onPress={() => setFilter(item.key)}
          />
        )}
      />

      {showingReturns ? (
        (returnsLoading || returnsOwnerId !== userId) && visibleReturns.length === 0 ? (
          <View style={{ paddingHorizontal: centeredPadding, paddingTop: SP.sm }}>
            <BuyerOrdersListSkeleton />
          </View>
        ) : visibleReturns.length === 0 ? (
          returnsError ? (
            <EmptyState
              icon="alert-triangle"
              title="Couldn't load your returns."
              description="Check your connection and try again."
              action={{ label: 'Try again', icon: 'refresh-cw', onPress: () => { void loadReturns(); } }}
              style={{ flex: 1 }}
            />
          ) : (
            <EmptyState
              icon="rotate-ccw"
              title="No returns"
              description="Return requests you start from a delivered order will show up here with their status."
              style={{ flex: 1 }}
            />
          )
        ) : (
          <>
            {returnsError && (
              <View style={screenStyles.loadErrorRow}>
                <RetryRow label="Couldn't refresh — showing your last loaded returns" onRetry={() => { void loadReturns(); }} />
              </View>
            )}
            <FlashList
              data={visibleReturns}
              keyExtractor={r => r.id}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={returnsLoading} onRefresh={() => { void loadReturns(); }} tintColor={theme.accent} />}
              contentContainerStyle={{
                paddingHorizontal: centeredPadding,
                paddingTop: SP.sm,
                paddingBottom: barInset + SP.md,
              }}
              ItemSeparatorComponent={OrderCardGap}
              renderItem={({ item }) => <BuyerReturnCard item={item} onOpen={openReturn} />}
            />
          </>
        )
      ) : visibleLoading ? (
        <View style={{ paddingHorizontal: centeredPadding, paddingTop: SP.sm }}>
          <BuyerOrdersListSkeleton />
        </View>
      ) : (
        <>
          {loadError && orders.length > 0 && (
            <View style={screenStyles.loadErrorRow}>
              <RetryRow label="Couldn't refresh — showing your last saved orders" onRetry={retry} />
            </View>
          )}
          {filtered.length === 0 ? (
            loadError ? (
              <EmptyState
                icon="alert-triangle"
                title="Couldn't load your orders."
                description="Pull to refresh, or tap try again."
                action={{
                  label: 'Try again',
                  icon: 'refresh-cw',
                  onPress: retry,
                }}
                style={{ flex: 1 }}
              />
            ) : (
              <EmptyState
                icon="shopping-bag"
                illustration="tee"
                title="Your first find is still out there."
                description="When something catches your eye, every update from checkout to doorstep will live here."
                action={{
                  label: 'Discover Products',
                  icon: 'compass',
                  onPress: () => router.navigate('/(buyer)/discover' as never),
                }}
                style={{ flex: 1 }}
              />
            )
          ) : (
            <FlashList
              ref={scrollResetRef}
              data={filtered}
              keyExtractor={o => o.id}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={retry} tintColor={theme.accent} />}
              contentContainerStyle={{
                paddingHorizontal: centeredPadding,
                paddingTop: SP.sm,
                paddingBottom: barInset + SP.md,
              }}
              extraData={busyOrderId}
              ItemSeparatorComponent={OrderCardGap}
              renderItem={({ item }) => <BuyerOrderCard order={item} onOpen={openOrder} onTrack={openTracking} onReorder={reorder} reordering={busyOrderId === item.id} />}
            />
          )}
        </>
      )}
      {reorderElement}
    </BrandthreadScreen>
  );
}

function OrderCardGap() {
  return <View style={{ height: SP.md }} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

function cardStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.card,
      borderRadius: RADIUS.lg,
      borderWidth: 1,
      borderColor: theme.border,
      padding: SP.md,
    },
    cardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.sm,
    },
    avatarCircle: {
      width: 40,
      height: 40,
      borderRadius: RADIUS.pill,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: FS.base,
      fontFamily: FONT.bold,
    },
    sellerName: {
      fontSize: FS.base,
      fontFamily: FONT.semibold,
      color: theme.text,
    },
    orderMeta: {
      fontSize: FS.xs,
      fontFamily: FONT.regular,
      color: theme.muted,
      marginTop: 1,
    },
    headline: {
      fontSize: FS.base,
      fontFamily: FONT.bold,
      color: theme.text,
      marginTop: SP.sm,
    },
    thumbRow: {
      flexDirection: 'row',
      gap: SP.sm,
      marginTop: SP.sm,
    },
    thumb: {
      width: 56,
      height: 70,
      borderRadius: RADIUS.sm,
      borderWidth: 1,
      borderColor: theme.border,
      overflow: 'hidden',
    },
    thumbFallback: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.cardElevated,
    },
    itemText: {
      fontSize: FS.sm,
      fontFamily: FONT.medium,
      color: theme.text,
    },
    moreText: {
      fontSize: FS.xs,
      fontFamily: FONT.regular,
      color: theme.muted,
      marginTop: 2,
    },
    trackerWrap: {
      marginTop: SP.md,
      paddingVertical: SP.xs,
      paddingHorizontal: 2,
      borderTopWidth: 1,
      borderTopColor: theme.border,
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.sm,
      flexWrap: 'wrap',
      marginTop: SP.sm,
    },
    cancellationBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.sm,
      marginTop: SP.sm,
      paddingHorizontal: SP.sm,
      paddingVertical: 7,
      borderRadius: RADIUS.sm,
      borderWidth: 1,
      borderColor: `${theme.error}48`,
      backgroundColor: `${theme.error}1F`,
    },
    cancellationCopy: {
      flex: 1,
      minWidth: 0,
    },
    cancellationLabel: {
      fontSize: FS.xs,
      fontFamily: FONT.bold,
      color: theme.error,
      letterSpacing: 0.2,
    },
    cancellationReason: {
      fontSize: FS.xs,
      fontFamily: FONT.medium,
      color: theme.muted,
    },
    preOrderBadge: {
      backgroundColor: theme.secondaryDim,
      borderRadius: RADIUS.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    preOrderText: {
      fontSize: FS.xs,
      fontFamily: FONT.bold,
      color: theme.secondary,
      letterSpacing: 0.4,
    },
    totalText: {
      marginLeft: 'auto' as any,
      fontSize: FS.base,
      fontFamily: FONT.bold,
      color: theme.text,
    },
    trackingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SP.xs,
      marginTop: SP.xs,
    },
    trackingText: {
      fontSize: FS.xs,
      fontFamily: FONT.medium,
      color: theme.secondary,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: SP.sm,
      marginTop: SP.sm,
      flexWrap: 'wrap',
    },
    actionBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      borderRadius: RADIUS.sm,
      backgroundColor: theme.cardElevated,
      borderWidth: 1,
      borderColor: theme.border,
      flexDirection: 'row',
      gap: 4,
    },
    // Own line under View / Track so those two keep their existing width.
    reorderBtn: {
      flexBasis: '100%',
      paddingHorizontal: SP.sm,
    },
    actionBtnSecondary: {
      backgroundColor: theme.secondaryDim,
      borderColor: theme.border,
    },
    actionBtnText: {
      fontSize: FS.xs,
      fontFamily: FONT.semibold,
      color: theme.text,
    },
  });
}

const screenStyles = StyleSheet.create({
  loadErrorRow: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
  },
});
