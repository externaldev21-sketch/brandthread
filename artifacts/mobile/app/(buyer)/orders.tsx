import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BuyerOrderView, cancellationReasonLabel, TrackingStatus, OrderStatus } from '@/services/orderTypes';
import { getBuyerOrdersWithStatus } from '@/services/orderService';
import { visibleOrdersForBuyer } from '@/lib/buyerOrdersVisibility';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS, ICON, GRAD_DARK_FADE } from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadHeader, FilterChip,
  StatusBadge, EmptyState,
} from '@/components/BrandthreadUI';
import { SkeletonBlock, useCenteredContentPadding } from '@/components/layout';
import { OrderStatusTimeline } from '@/components/orders/OrderStatusTimeline';
import type { AppThemePreset } from '@/contexts/AppThemeContext';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadgeVariant(status: OrderStatus): 'info' | 'purple' | 'warning' | 'success' | 'neutral' | 'error' {
  switch (status) {
    case 'new':          return 'info';
    case 'processing':   return 'purple';
    case 'ready_to_ship': return 'warning';
    case 'shipped':      return 'warning';
    case 'delivered':    return 'success';
    case 'cancelled':    return 'neutral';
    case 'refunded':     return 'error';
    case 'disputed':     return 'error';
    default:             return 'neutral';
  }
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
    case 'returns':   return orders.filter(o => o.hasReturnRequest);
    case 'pre-order': return orders.filter(o => o.isPreOrder);
    default:          return orders;
  }
}

// ─── Order Card ───────────────────────────────────────────────────────────────
// Visual, tracker-forward card: seller + order meta up top, a live compact
// status tracker as the centerpiece, then item preview / total / actions.

const BuyerOrderCard = React.memo(function BuyerOrderCard({ order, onOpen }: { order: BuyerOrderView; onOpen: (orderId: string) => void }) {
  const onPress = () => onOpen(order.id);
  const { theme } = useAppTheme();
  const styles = useMemo(() => cardStyles(theme), [theme]);
  const firstItem = order.lineItems[0];
  const extraCount = order.lineItems.length - 1;
  const sellerInitial = order.sellerName.charAt(0).toUpperCase();
  const isTerminalStatus = order.status === 'cancelled' || order.status === 'refunded' || order.status === 'disputed';

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={onPress}>
      {/* Top row */}
      <View style={styles.cardTopRow}>
        <View style={[styles.avatarCircle, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}>
          <Text style={[styles.avatarText, { color: theme.accentLight }]}>{sellerInitial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sellerName}>{order.sellerName}</Text>
          <Text style={styles.orderMeta}>{order.orderNumber} · {fmtDate(order.createdAt)}</Text>
        </View>
        <StatusBadge label={statusBadgeLabel(order.status)} variant={statusBadgeVariant(order.status)} small />
      </View>

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
      <View style={styles.trackerWrap}>
        <OrderStatusTimeline status={order.status} compact />
      </View>

      {/* Price + pre-order row */}
      <View style={styles.statusRow}>
        {order.isPreOrder && (
          <View style={styles.preOrderBadge}>
            <Text style={styles.preOrderText}>PRE-ORDER</Text>
          </View>
        )}
        <Text style={styles.totalText}>{formatCents(order.payment.totalCents)}</Text>
      </View>

      {order.status === 'cancelled' && (
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
      {order.trackingStatus && !isTerminalStatus && (
        <View style={styles.trackingRow}>
          <Feather name="truck" size={ICON.xs} color={theme.secondary} />
          <Text style={styles.trackingText}>
            {trackingLabel(order.trackingStatus)}
            {order.estimatedDelivery ? ` → Est. ${fmtDate(order.estimatedDelivery)}` : ''}
          </Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.accentDim, borderColor: theme.accent }]} onPress={onPress} activeOpacity={0.8}>
          <Text style={[styles.actionBtnText, { color: theme.accentLight }]}>View Order Details</Text>
        </TouchableOpacity>
        {order.trackingNumber && (
          <TouchableOpacity
             style={[styles.actionBtn, styles.actionBtnSecondary, { backgroundColor: theme.secondaryDim, borderColor: theme.secondary }]}
            activeOpacity={0.8}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
          >
            <Feather name="map-pin" size={12} color={theme.secondary} />
            <Text style={[styles.actionBtnText, { color: theme.secondary }]}>Track Shipment</Text>
          </TouchableOpacity>
        )}
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
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const centeredPadding = useCenteredContentPadding();
  const router = useRouter();
  const openOrder = useCallback((orderId: string) => {
    router.push(('/buyer-order-detail?id=' + orderId) as never);
  }, [router]);
  const { userId } = useAuth();

  const [orders, setOrders] = useState<BuyerOrderView[]>([]);
  const [ordersOwnerId, setOrdersOwnerId] = useState<string | null | undefined>(userId);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<BuyerFilterKey>('all');
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
      setOrders([]);
      setOrdersOwnerId(null);
      setLoading(false);
      setRefreshing(false);
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
  }, [userId]);

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

  return (
    <BrandthreadScreen noSafeBottom>
      <BrandthreadHeader title="My Orders" />

      {/* Filter chips — horizontal scroll with a trailing fade so the last
          chip reads as scrollable instead of abruptly clipped. */}
      <View style={{ position: 'relative' }}>
        <FlatList
          horizontal
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
        <LinearGradient
          pointerEvents="none"
          colors={GRAD_DARK_FADE}
          start={{ x: 1, y: 0 }}
          end={{ x: 0, y: 0 }}
          style={{ position: 'absolute', right: 0, top: 0, bottom: SP.sm, width: 28 }}
        />
      </View>

      {visibleLoading ? (
        <View style={{ paddingHorizontal: centeredPadding, paddingTop: SP.sm }}>
          <BuyerOrdersListSkeleton />
        </View>
      ) : (
        <>
          {loadError && orders.length > 0 && (
            <View style={[screenStyles.loadErrorBanner, { borderColor: theme.warning, backgroundColor: `${theme.warning}1F` }]}>
              <Feather name="alert-triangle" size={16} color={theme.warning} />
              <View style={screenStyles.loadErrorCopy}>
                <Text style={[screenStyles.loadErrorBannerTitle, { color: theme.text }]}>Couldn't load your orders</Text>
                <Text style={[screenStyles.loadErrorBannerText, { color: theme.muted }]}>Showing your last saved orders. Pull to refresh.</Text>
              </View>
              <TouchableOpacity onPress={retry} accessibilityRole="button" accessibilityLabel="Retry">
                <Text style={[screenStyles.bannerRetryText, { color: theme.warning }]}>Retry</Text>
              </TouchableOpacity>
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
                title="Your first find is still out there."
                description="When something catches your eye, every update from checkout to doorstep will live here."
                action={{
                  label: 'Discover Products',
                  icon: 'compass',
                  onPress: () => router.push('/(buyer)/discover' as never),
                }}
                style={{ flex: 1 }}
              />
            )
          ) : (
            <FlashList
              data={filtered}
              keyExtractor={o => o.id}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={retry} tintColor={theme.accent} />}
              contentContainerStyle={{
                paddingHorizontal: centeredPadding,
                paddingTop: SP.sm,
                paddingBottom: barInset + SP.md,
              }}
              ItemSeparatorComponent={OrderCardGap}
              renderItem={({ item }) => <BuyerOrderCard order={item} onOpen={openOrder} />}
            />
          )}
        </>
      )}
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
  loadErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  loadErrorCopy: {
    flex: 1,
    minWidth: 0,
  },
  loadErrorBannerTitle: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },
  loadErrorBannerText: {
    marginTop: 2,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    lineHeight: 16,
  },
  bannerRetryText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },
});
