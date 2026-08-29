import React, { useState, useCallback, useRef } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { BuyerOrderView, cancellationReasonLabel, TrackingStatus, OrderStatus } from '@/services/orderTypes';
import { useApi } from '@/hooks/useApi';
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

// ─── API → BuyerOrderView adapter ─────────────────────────────────────────────

function adaptOrder(row: any): BuyerOrderView {
  const dbAddr = row.shippingAddress;
  const shippingAddress: import('@/services/orderTypes').OrderAddress = dbAddr
    ? {
        name:    dbAddr.name ?? '',
        line1:   dbAddr.street ?? '',
        line2:   '',
        city:    dbAddr.city ?? '',
        state:   dbAddr.state ?? '',
        zip:     dbAddr.zip ?? '',
        country: dbAddr.country ?? 'US',
        phone:   '',
      }
    : { name: '', line1: '', city: '', state: '', zip: '', country: 'US' };

  return {
    id:                row.id,
    orderNumber:       row.orderNumber,
    sellerId:          row.ownerId ?? '',
    sellerName:        row.sellerDisplayName ?? 'Seller',
    sellerHandle:      '',
    status:            (row.status ?? 'new') as OrderStatus,
    paymentStatus:     row.stripePaymentIntentId ? 'paid' : 'pending',
    fulfillmentStatus: 'unfulfilled',
    lineItems:         [],
    shippingAddress,
    payment: {
      subtotalCents:      row.subtotalCents ?? 0,
      shippingTotalCents: row.shippingCents ?? 0,
      taxTotalCents:      0,
      totalCents:         row.totalCents ?? 0,
    },
    trackingNumber:  row.trackingNumber ?? undefined,
    trackingCarrier: row.carrier ?? undefined,
    cancellationReason: row.cancellationReason ?? null,
    isPreOrder:       false,
    hasReturnRequest: false,
    createdAt:        row.createdAt ?? new Date().toISOString(),
  };
}

function adaptOrderDetail(row: any): BuyerOrderView {
  const base = adaptOrder(row);
  const items = Array.isArray(row.items) ? row.items : [];
  return {
    ...base,
    lineItems: items.map((item: any) => ({
      productName: item.productName,
      variant:     item.variantLabel ?? '',
      quantity:    item.quantity,
      unitPriceCents: item.priceCents ?? 0,
    })),
  };
}

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
      {order.status === 'cancelled' && order.cancellationReason && (
        <Text style={styles.cancellationReason} numberOfLines={1}>
          {cancellationReasonLabel(order.cancellationReason)}
        </Text>
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
  const api = useApi();

  const [orders, setOrders] = useState<BuyerOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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
    setLoadError(false);
    try {
      const rows = await api.buyer.orders.list();
      if (generationRef.current !== generation) return; // stale focus cycle
      const orderRows = Array.isArray(rows) ? rows : [];
      setOrders(orderRows.map(adaptOrder));
      consecutiveFailuresRef.current = 0;
    } catch {
      if (generationRef.current !== generation) return; // stale focus cycle
      setOrders([]);
      setLoadError(true);
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3 && timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    if (generationRef.current !== generation) return;
    setLoading(false);
    hasLoadedRef.current = true;
  }, [api]);

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

  const filtered = applyFilter(orders, filter);

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

      {loading ? (
        <BrandedLoader label="Checking in with your orders…" />
      ) : loadError ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
          <Feather name="wifi-off" size={ICON.xxl} color={MUTED} />
          <Text style={{ marginTop: SP.md, fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textAlign: 'center' }}>
            Couldn't load your orders
          </Text>
          <TouchableOpacity
            style={{ marginTop: SP.md, paddingHorizontal: SP.lg, paddingVertical: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER }}
            onPress={() => { setLoading(true); load(generationRef.current); }}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : filtered.length === 0 ? (
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
  cancellationReason: {
    marginTop: SP.xs,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: RED,
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
});
