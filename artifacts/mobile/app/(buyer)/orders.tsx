import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { getBuyerOrders } from '@/services/orderService';
import { BuyerOrderView, TrackingStatus, OrderStatus } from '@/services/orderTypes';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM,
  SUCCESS, SUCCESS_DIM,
  BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadHeader, FilterChip,
  StatusBadge, EmptyState, PrimaryButton,
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
  const firstItem = order.lineItems[0];
  const extraCount = order.lineItems.length - 1;
  const sellerInitial = order.sellerName.charAt(0).toUpperCase();

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={onPress}>
      {/* Top row */}
      <View style={styles.cardTopRow}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{sellerInitial}</Text>
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
        <Text style={styles.totalText}>${order.payment.total.toFixed(2)}</Text>
      </View>

      {/* Tracking info */}
      {order.trackingStatus && (
        <View style={styles.trackingRow}>
          <Feather name="truck" size={ICON.xs} color={CYAN} />
          <Text style={styles.trackingText}>
            {trackingLabel(order.trackingStatus)}
            {order.estimatedDelivery ? ` → Est. ${fmtDate(order.estimatedDelivery)}` : ''}
          </Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.8}>
          <Text style={styles.actionBtnText}>View Order Details</Text>
        </TouchableOpacity>
        {order.trackingNumber && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnSecondary]}
            activeOpacity={0.8}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
          >
            <Feather name="map-pin" size={12} color={CYAN} />
            <Text style={[styles.actionBtnText, { color: CYAN }]}>Track Shipment</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerOrdersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [orders, setOrders] = useState<BuyerOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<BuyerFilterKey>('all');

  const load = useCallback(async () => {
    try {
      const data = await getBuyerOrders();
      setOrders(data);
    } catch {}
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
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
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={PURPLE} size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="shopping-bag"
          title="No orders yet"
          description="Your orders will appear here once you make a purchase."
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
    backgroundColor: PURPLE_DIM,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
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
  preOrderBadge: {
    backgroundColor: CYAN_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  preOrderText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: CYAN,
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
    color: CYAN,
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
    backgroundColor: PURPLE_DIM,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    flexDirection: 'row',
    gap: 4,
  },
  actionBtnSecondary: {
    backgroundColor: CYAN_DIM,
    borderColor: 'rgba(34,211,238,0.35)',
  },
  actionBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },
});
