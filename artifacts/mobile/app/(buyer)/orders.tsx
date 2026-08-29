import React, { useState, useCallback, useRef } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BuyerOrderView, cancellationReasonLabel, TrackingStatus, OrderStatus } from '@/services/orderTypes';
import { getBuyerOrdersWithStatus } from '@/services/orderService';
import { visibleOrdersForBuyer } from '@/lib/buyerOrdersVisibility';
import { formatCents } from '@/lib/money';
import {
  BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE,
  SUCCESS, SUCCESS_DIM,
  BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadHeader, FilterChip,
  StatusBadge, EmptyState, PrimaryButton, BrandedLoader,
} from '@/components/BrandthreadUI';

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

function BuyerOrderCard({ order, onPress }: { order: BuyerOrderView; onPress: () => void }) {
  const { theme } = useAppTheme();
  const firstItem = order.lineItems[0];
  const extraCount = order.lineItems.length - 1;
  const sellerInitial = order.sellerName.charAt(0).toUpperCase();

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

      {/* Divider */}
      <View style={styles.divider} />

      {/* Status row */}
      <View style={styles.statusRow}>
        <StatusBadge label={statusBadgeLabel(order.status)} variant={statusBadgeVariant(order.status)} />
        {order.isPreOrder && (
          <View style={styles.preOrderBadge}>
            <Text style={styles.preOrderText}>PRE-ORDER</Text>
          </View>
        )}
        <Text style={styles.totalText}>{formatCents(order.payment.totalCents)}</Text>
      </View>
      {order.status === 'cancelled' && (
        <View style={styles.cancellationBanner}>
          <Feather name="x-circle" size={ICON.sm} color={RED} />
          <View style={styles.cancellationCopy}>
            <Text style={styles.cancellationLabel}>Order cancelled</Text>
            <Text style={styles.cancellationReason} numberOfLines={1}>
              {cancellationReasonLabel(order.cancellationReason)}
            </Text>
          </View>
        </View>
      )}

      {/* Tracking info */}
      {order.trackingStatus && (
        <View style={styles.trackingRow}>
          <Feather name="truck" size={ICON.xs} color={BLUE} />
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
            <Feather name="map-pin" size={12} color={BLUE} />
            <Text style={[styles.actionBtnText, { color: BLUE }]}>Track Shipment</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerOrdersScreen() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
    try {
      const result = await getBuyerOrdersWithStatus(userId);
      if (generationRef.current !== generation) return; // stale focus cycle
      setOrders(result.orders);
      setOrdersOwnerId(userId);
      setLoadError(Boolean(result.error));
      if (!result.error) consecutiveFailuresRef.current = 0;
      else consecutiveFailuresRef.current += 1;
      if (result.error && consecutiveFailuresRef.current >= 3 && timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } catch {
      if (generationRef.current !== generation) return; // stale focus cycle
      setOrders([]);
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
  const visibleLoadError = ownsRenderedOrders && loadError;

  return (
    <BrandthreadScreen noSafeBottom>
      <BrandthreadHeader title="My Orders" />

      {/* Filter chips */}
      <FlatList
        horizontal
        data={FILTER_CHIPS}
        keyExtractor={i => i.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SP.md, gap: 8, paddingBottom: SP.sm }}
        renderItem={({ item }) => (
          <FilterChip
            label={item.label}
            active={filter === item.key}
            onPress={() => setFilter(item.key)}
          />
        )}
      />

      {visibleLoading ? (
        <BrandedLoader label="Checking in with your orders…" />
      ) : filtered.length === 0 && visibleLoadError ? (
        <View style={styles.loadErrorState}>
          <Feather name="wifi-off" size={ICON.xxl} color={MUTED} />
          <Text style={styles.loadErrorTitle}>Couldn't load your orders</Text>
          <Text style={styles.loadErrorText}>
            Check your connection and try again. Your orders will appear here when we can reach the server.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={retry} activeOpacity={0.8} testID="buyer-orders-retry">
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {visibleLoadError && (
            <View style={styles.loadErrorBanner} accessibilityRole="alert">
              <Feather name="wifi-off" size={ICON.sm} color={ORANGE} />
              <View style={styles.loadErrorCopy}>
                <Text style={styles.loadErrorBannerTitle}>Couldn't refresh your orders</Text>
                <Text style={styles.loadErrorBannerText}>Showing your saved orders. Pull to refresh and try again.</Text>
              </View>
              <TouchableOpacity onPress={retry} disabled={refreshing} activeOpacity={0.8} testID="buyer-orders-banner-retry">
                <Text style={styles.bannerRetryText}>{refreshing ? 'Retrying…' : 'Retry'}</Text>
              </TouchableOpacity>
            </View>
          )}
          {filtered.length === 0 ? (
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
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={o => o.id}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={retry} tintColor={theme.accent} />}
              contentContainerStyle={{
                paddingHorizontal: SP.md,
                paddingTop: SP.sm,
                paddingBottom: Math.max(insets.bottom, SP.md) + COMP.tabBarH + SP.md,
                gap: SP.md,
              }}
              renderItem={({ item }) => (
                <BuyerOrderCard
                  order={item}
                  onPress={() => router.push(('/buyer-order-detail?id=' + item.id) as never)}
                />
              )}
            />
          )}
        </>
      )}
    </BrandthreadScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
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
    color: FG,
  },
  orderMeta: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 1,
  },
  itemText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: FG,
  },
  moreText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: SP.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    flexWrap: 'wrap',
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
    borderColor: 'rgba(248,113,113,0.28)',
    backgroundColor: RED_DIM,
  },
  cancellationCopy: {
    flex: 1,
    minWidth: 0,
  },
  cancellationLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: RED,
    letterSpacing: 0.2,
  },
  cancellationReason: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  preOrderBadge: {
    backgroundColor: BLUE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  preOrderText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: BLUE,
    letterSpacing: 0.4,
  },
  totalText: {
    marginLeft: 'auto' as any,
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
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
    color: BLUE,
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
    backgroundColor: CARD_ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    gap: 4,
  },
  actionBtnSecondary: {
    backgroundColor: BLUE_DIM,
    borderColor: BORDER,
  },
  actionBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: FG,
  },
  loadErrorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SP.xl,
  },
  loadErrorTitle: {
    marginTop: SP.md,
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
    textAlign: 'center',
  },
  loadErrorText: {
    marginTop: SP.xs,
    maxWidth: 320,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: SP.md,
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  retryButtonText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
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
    borderColor: ORANGE,
    backgroundColor: ORANGE_DIM,
  },
  loadErrorCopy: {
    flex: 1,
    minWidth: 0,
  },
  loadErrorBannerTitle: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: FG,
  },
  loadErrorBannerText: {
    marginTop: 2,
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 16,
  },
  bannerRetryText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: ORANGE,
  },
});
