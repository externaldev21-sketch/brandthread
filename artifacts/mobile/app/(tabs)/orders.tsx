import React, { useState, useCallback, useMemo, useRef } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import { View, Text, ScrollView, FlatList, TouchableOpacity, TextInput, StyleSheet, Alert, RefreshControl, Modal, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, GRAD_CARD_GLOW, GRAD_DARK_FADE, FONT, FS, SP, RADIUS, COMP, ICON, ANIM, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, FilterChip, StatusBadge, SectionHeader, EmptyState, StatCard, SearchBar, BrandedLoader } from '@/components/BrandthreadUI';
import { filterOrders, sortOrders } from '@/services/orderService';
import { Order, OrderFilterKey, OrderSortKey, OrderAddress, OrderCustomer, FulfillmentStatus, FulfillmentType, OrderStatus, PaymentStatus } from '@/services/orderTypes';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@clerk/expo';
import { clearBadge } from '@/lib/orderBadgeStore';
import { formatCents } from '@/lib/money';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderStats {
  newOrders: number;
  toProcess: number;
  readyToShip: number;
  returnRequests: number;
  disputes: number;
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMoney(cents: number): string {
  return formatCents(cents);
}

function getPaymentColor(status: string): string {
  switch (status) {
    case 'paid': return SUCCESS;
    case 'pending': case 'authorized': return ORANGE;
    case 'refunded': case 'partially_refunded': return CYAN;
    case 'failed': case 'voided': return RED;
    default: return MUTED;
  }
}

function getFulfillmentColor(status: string): string {
  switch (status) {
    case 'unfulfilled': return ORANGE;
    case 'partially_fulfilled': return CYAN;
    case 'fulfilled': return SUCCESS;
    case 'manufacturer_pending': return BLUE;
    default: return MUTED;
  }
}

function getPaymentLabel(status: string): string {
  switch (status) {
    case 'paid': return 'Paid';
    case 'pending': return 'Pending';
    case 'authorized': return 'Authorized';
    case 'refunded': return 'Refunded';
    case 'partially_refunded': return 'Part. Refunded';
    case 'failed': return 'Failed';
    case 'voided': return 'Voided';
    default: return status;
  }
}

function getFulfillmentLabel(status: string): string {
  switch (status) {
    case 'unfulfilled': return 'Unfulfilled';
    case 'partially_fulfilled': return 'Partial';
    case 'fulfilled': return 'Fulfilled';
    case 'manufacturer_pending': return 'Mfg Pending';
    case 'returned': return 'Returned';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

function computeStats(orders: Order[]): OrderStats {
  return {
    newOrders: orders.filter(o => o.status === 'new').length,
    toProcess: orders.filter(o => o.status === 'processing').length,
    readyToShip: orders.filter(o => o.status === 'ready_to_ship').length,
    returnRequests: orders.filter(o => o.returns.length > 0).length,
    disputes: orders.filter(o => o.disputes.length > 0).length,
    total: orders.length,
  };
}

// ─── API → Order adapter ──────────────────────────────────────────────────────
// Maps the seller orders API response to the full Order type used by this screen.
// Only fills the fields that filterOrders / sortOrders / the UI actually read.

const DB_STATUS_MAP: Record<string, OrderStatus> = {
  pending:        'new',
  processing:     'processing',
  fulfilled:      'ready_to_ship',
  shipped:        'shipped',
  cancelled:      'cancelled',
  refund_pending: 'refunded',
};

const FULFILLMENT_MAP: Partial<Record<OrderStatus, FulfillmentStatus>> = {
  new:           'unfulfilled',
  processing:    'unfulfilled',
  ready_to_ship: 'fulfilled',
  shipped:       'fulfilled',
  delivered:     'fulfilled',
  cancelled:     'cancelled',
  refunded:      'cancelled',
  disputed:      'unfulfilled',
};

function apiRowToOrder(row: any): Order {
  const ordStatus: OrderStatus = DB_STATUS_MAP[row.status as string] ?? 'new';
  const fStatus: FulfillmentStatus = FULFILLMENT_MAP[ordStatus] ?? 'unfulfilled';
  const initials = ((row.customerName as string | undefined) ?? 'C')
    .split(/\s+/).map((w: string) => w[0] ?? '').slice(0, 2).join('').toUpperCase();

  const emptyAddr: OrderAddress = { name: '', line1: '', city: '', state: '', zip: '', country: 'US' };
  const customer: OrderCustomer = {
    id: '', name: row.customerName ?? 'Customer', email: row.customerEmail ?? '',
    initials, totalOrders: 1, lifetimeValueCents: row.totalCents ?? 0,
    tags: [], shippingAddress: emptyAddr, billingAddress: emptyAddr,
  };
  const totalCents = row.totalCents ?? 0;

  return {
    id: row.id, orderNumber: row.orderNumber ?? '',
    sellerId: '', sellerName: '', sellerHandle: '',
    source: 'online', salesChannel: 'online',
    status: ordStatus, paymentStatus: 'paid' as PaymentStatus,
    fulfillmentStatus: fStatus, fulfillmentType: 'seller' as FulfillmentType,
    riskLevel: 'low', riskFlags: [], customer,
    lineItems: [],
    fulfillment: {
      id: '', orderId: row.id, groups: [], type: 'seller', status: fStatus,
      isPicked: ['ready_to_ship', 'shipped', 'delivered'].includes(ordStatus),
      isPacked: ['ready_to_ship', 'shipped', 'delivered'].includes(ordStatus),
    },
    payment: {
      subtotalCents: totalCents, discountTotalCents: 0, shippingTotalCents: 0, taxTotalCents: 0,
      totalCents, amountPaidCents: totalCents, amountRefundedCents: 0,
      amountHeldCents: 0, amountPendingCents: 0, sellerAllocationCents: totalCents,
      manufacturerAllocationCents: 0, shippingLabelAllocationCents: 0, platformFeeCents: 0,
      payoutStatus: 'available',
    },
    shipments: row.trackingNumber ? [{
      id: `ship_${row.id}`, orderId: row.id, fulfillmentGroupId: '',
      carrier: row.carrier ?? undefined, trackingNumber: row.trackingNumber,
      trackingEvents: [], isDemo: false,
    }] : [],
    labels: [], returns: [], refunds: [], disputes: [], timeline: [], notes: [],
    hasUnreadMessage: false, isPreOrder: false, isManufacturerFulfilled: false,
    currency: 'USD', tags: [],
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date(row.createdAt).toISOString(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date(row.updatedAt).toISOString(),
  };
}

// ─── Filter Config ────────────────────────────────────────────────────────────

const FILTERS: { key: OrderFilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'new', label: 'New' },
  { key: 'unfulfilled', label: 'Unfulfilled' },
  { key: 'processing', label: 'Processing' },
  { key: 'ready_to_ship', label: 'Ready' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'returned', label: 'Returns' },
  { key: 'pre_order', label: 'Pre-order' },
  { key: 'manufacturer_fulfilled', label: 'Mfg Fulfilled' },
  { key: 'high_risk', label: 'High Risk' },
  { key: 'disputed', label: 'Disputed' },
];

const SORTS: { key: OrderSortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'highest_value', label: 'Highest value' },
  { key: 'lowest_value', label: 'Lowest value' },
  { key: 'customer_name', label: 'Customer name' },
  { key: 'fulfillment_status', label: 'Fulfillment status' },
  { key: 'payment_status', label: 'Payment status' },
];

// ─── Order Card ───────────────────────────────────────────────────────────────

interface OrderCardProps {
  order: Order;
  selected: boolean;
  selectionMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onMarkProcessing: () => void;
  onMarkReady: () => void;
  onShip: () => void;
}

function OrderCard({
  order, selected, selectionMode, onPress, onLongPress,
  onMarkProcessing, onMarkReady, onShip,
}: OrderCardProps) {
  const { theme } = useAppTheme();
  const isHighRisk = order.riskLevel === 'high';
  const hasReturn = order.returns.length > 0;
  const hasDispute = order.disputes.length > 0;

  const firstItem = order.lineItems[0];
  const moreCount = order.lineItems.length - 1;
  const itemSummary = firstItem
    ? moreCount > 0
      ? `${firstItem.productName} + ${moreCount} more`
      : firstItem.productName
    : 'No items';

  const payColor = getPaymentColor(order.paymentStatus);
  const fulColor = getFulfillmentColor(order.fulfillmentStatus);

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={onPress}
      onLongPress={onLongPress}
      style={[s.card, selected && s.cardSelected, isHighRisk && s.cardRisk]}
    >
      {/* Selection indicator */}
      {selectionMode && (
        <View style={[s.selBox, selected && s.selBoxActive]}>
          {selected && <Feather name="check" size={10} color={FG} />}
        </View>
      )}

      {/* Row 1: Order number + badges */}
      <View style={s.cardRow}>
        <View style={s.cardRowLeft}>
          <Text style={s.orderNum}>{order.orderNumber}</Text>
          {order.status === 'new' && (
            <View style={s.newBadge}>
              <Text style={s.newBadgeText}>NEW</Text>
            </View>
          )}
          {order.hasUnreadMessage && <View style={s.unreadDot} />}
        </View>
        <View style={s.cardRowRight}>
          {isHighRisk && (
            <View style={s.riskBadge}>
              <Feather name="alert-triangle" size={9} color={RED} />
              <Text style={s.riskText}>HIGH RISK</Text>
            </View>
          )}
          {hasReturn && (
            <View style={s.returnBadge}>
              <Text style={s.returnBadgeText}>RETURN</Text>
            </View>
          )}
          {hasDispute && (
            <View style={s.disputeBadge}>
              <Text style={s.disputeBadgeText}>DISPUTE</Text>
            </View>
          )}
        </View>
      </View>

      {/* Row 2: Customer + date */}
      <View style={s.cardRow}>
        <Text style={s.customerName}>{order.customer.name}</Text>
        <Text style={s.orderDate}>{fmtDate(order.createdAt)}</Text>
      </View>

      {/* Row 3: Items summary */}
      <Text style={s.itemSummary} numberOfLines={1}>
        {itemSummary}  ·  {order.lineItems.length} {order.lineItems.length === 1 ? 'item' : 'items'}
      </Text>

      {/* Divider */}
      <View style={s.divider} />

      {/* Row 4: Payment + fulfillment + total */}
      <View style={s.cardRow}>
        <View style={s.statusRow}>
          <View style={s.statusPill}>
            <View style={[s.statusDot, { backgroundColor: payColor }]} />
            <Text style={[s.statusLabel, { color: payColor }]}>
              {getPaymentLabel(order.paymentStatus)}
            </Text>
          </View>
          <View style={s.statusPill}>
            <View style={[s.statusDot, { backgroundColor: fulColor }]} />
            <Text style={[s.statusLabel, { color: fulColor }]}>
              {getFulfillmentLabel(order.fulfillmentStatus)}
            </Text>
          </View>
        </View>
        <Text style={s.totalAmount}>{fmtMoney(order.payment.totalCents)}</Text>
      </View>

      {/* Row 5: Tags */}
      {(order.isPreOrder || order.isManufacturerFulfilled) && (
        <View style={s.tagRow}>
          {order.isPreOrder && (
            <View style={s.tagPreOrder}>
              <Text style={s.tagPreOrderText}>PRE-ORDER</Text>
            </View>
          )}
          {order.isManufacturerFulfilled && (
            <View style={s.tagMfg}>
              <Text style={s.tagMfgText}>MFG</Text>
            </View>
          )}
        </View>
      )}

      {/* Divider */}
      <View style={s.divider} />

      {/* Row 6: Context actions */}
      <View style={s.actionRow}>
        {order.status === 'new' && (
          <TouchableOpacity
            style={s.actionBtn}
            onPress={e => { e.stopPropagation(); onMarkProcessing(); }}
            activeOpacity={0.8}
          >
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionBtnGrad}>
              <Feather name="check-circle" size={12} color="#fff" />
              <Text style={s.actionBtnText}>Accept</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
        {order.status === 'processing' && (
          <TouchableOpacity
            style={s.actionBtn}
            onPress={e => { e.stopPropagation(); onMarkReady(); }}
            activeOpacity={0.8}
          >
            <LinearGradient colors={[BLUE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionBtnGrad}>
              <Feather name="package" size={12} color="#fff" />
              <Text style={s.actionBtnText}>Mark Ready</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
        {order.status === 'ready_to_ship' && (
          <TouchableOpacity
            style={s.actionBtn}
            onPress={e => { e.stopPropagation(); onShip(); }}
            activeOpacity={0.8}
          >
            <LinearGradient colors={[SUCCESS, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionBtnGrad}>
              <Feather name="send" size={12} color="#fff" />
              <Text style={s.actionBtnText}>Ship</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}
        {order.status === 'shipped' && order.shipments[0] && (
          <View style={s.trackingPill}>
            <Feather name="truck" size={11} color={SUCCESS} />
            <Text style={s.trackingText}>
              {order.shipments[0].carrier} · {order.shipments[0].trackingNumber?.slice(-6)}
            </Text>
          </View>
        )}
        {order.status === 'disputed' && (
          <View style={s.disputePill}>
            <Feather name="alert-circle" size={11} color={RED} />
            <Text style={s.disputePillText}>Dispute open</Text>
          </View>
        )}
        <TouchableOpacity
          style={s.viewBtn}
          onPress={e => { e.stopPropagation(); onPress(); }}
          activeOpacity={0.8}
        >
          <Text style={s.viewBtnText}>
            {order.status === 'disputed' ? 'View Dispute' : 'View Details'}
          </Text>
          <Feather name="arrow-right" size={12} color={PURPLE_LIGHT} />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Sort Modal ───────────────────────────────────────────────────────────────

function SortModal({
  visible, current, onSelect, onClose,
}: {
  visible: boolean;
  current: OrderSortKey;
  onSelect: (k: OrderSortKey) => void;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose} />
      <View style={s.modalSheet}>
        <View style={s.modalHandle} />
        <Text style={s.modalTitle}>Sort Orders</Text>
        {SORTS.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[s.sortOption, current === key && s.sortOptionActive]}
            onPress={() => { Haptics.selectionAsync(); onSelect(key); }}
            activeOpacity={0.8}
          >
            <Text style={[s.sortOptionText, current === key && s.sortOptionTextActive]}>
              {label}
            </Text>
            {current === key && <Feather name="check" size={ICON.sm} color={PURPLE_LIGHT} />}
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={s.modalCloseBtn} onPress={onClose}>
          <Text style={s.modalCloseBtnText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function OrdersScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const api = useApi();
  const { userId } = useAuth();

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [activeFilter, setActiveFilter] = useState<OrderFilterKey>('all');
  const [sort, setSort] = useState<OrderSortKey>('newest');
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stats, setStats] = useState<OrderStats | null>(null);

  // Backoff: stop polling after 3 consecutive failures; resume on next focus.
  // A generation counter ensures requests from a previous focus cycle cannot
  // increment the failure count or clear the timer of the current focus cycle.
  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const loadData = useCallback(async (generation: number) => {
    try {
      const rows = await api.orders.list();
      if (generationRef.current !== generation) return; // stale focus cycle
      // Guard: API can return null/undefined/error-object when the request fails
      // or when the seller has no orders yet. Array.isArray prevents the
      // "rows.map is not a function" TypeError that crashes the screen.
      const all = Array.isArray(rows) ? (rows as any[]).map(apiRowToOrder) : [];
      setOrders(all);
      setStats(computeStats(all));
      setLoadError(null);
      consecutiveFailuresRef.current = 0;
    } catch (e) {
      if (generationRef.current !== generation) return; // stale focus cycle
      console.error('Failed to load seller orders', e);
      setOrders([]);
      setStats(computeStats([]));
      setLoadError('Could not load orders. Check your connection and try again.');
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3 && timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } finally {
      if (generationRef.current === generation) {
        setLoading(false);
        setRefreshing(false);
        hasLoadedRef.current = true;
      }
    }
  }, [api]);

  // Load on focus and poll every 30 s so status updates appear live.
  // After 3 consecutive failures the interval is cleared to avoid hammering a
  // down/offline server; it resets on the next focus event.
  useFocusEffect(
    useCallback(() => {
      // Immediately zero the Orders tab badge and record the viewed timestamp.
      // clearBadge() updates the shared in-memory store (instant re-render in
      // the tab bar) and persists the per-seller watermark to AsyncStorage for
      // the next app launch. No-op when not authenticated.
      if (userId) clearBadge(userId);

      const generation = ++generationRef.current;
      consecutiveFailuresRef.current = 0;
      if (!hasLoadedRef.current) setLoading(true);
      loadData(generation);
      timerRef.current = setInterval(() => loadData(generation), 30_000);
      return () => {
        if (timerRef.current !== null) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }, [loadData])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData(generationRef.current);
  }, [loadData]);

  // Filtered + sorted list
  const filtered = useMemo(() => {
    let base = orders;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      base = orders.filter(o =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customer.name.toLowerCase().includes(q) ||
        o.customer.email.toLowerCase().includes(q) ||
        o.lineItems.some(li => li.productName.toLowerCase().includes(q))
      );
    }
    base = filterOrders(base, activeFilter);
    base = sortOrders(base, sort);
    return base;
  }, [orders, searchQuery, activeFilter, sort]);

  // Filter counts
  const filterCounts = useMemo(() => {
    const map: Partial<Record<OrderFilterKey, number>> = {};
    FILTERS.forEach(({ key }) => {
      const count = filterOrders(orders, key).length;
      if (key !== 'all') map[key] = count;
    });
    return map;
  }, [orders]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const handleMarkProcessing = useCallback(async (orderId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api.orders.updateStatus(orderId, 'processing');
      await loadData(generationRef.current);
    } catch {
      Alert.alert('Error', 'Could not update order.');
    }
  }, [api, loadData]);

  const handleMarkReady = useCallback(async (orderId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await api.orders.updateStatus(orderId, 'fulfilled');
      await loadData(generationRef.current);
    } catch {
      Alert.alert('Error', 'Could not update order.');
    }
  }, [api, loadData]);

  const handleShip = useCallback((orderId: string) => {
    router.push(('/order-detail?id=' + orderId + '&tab=shipping') as never);
  }, [router]);

  const handleCardPress = useCallback((order: Order) => {
    if (selectedIds.length > 0) {
      // Toggle selection
      setSelectedIds(prev =>
        prev.includes(order.id) ? prev.filter(id => id !== order.id) : [...prev, order.id]
      );
    } else {
      router.push(('/order-detail?id=' + order.id) as never);
    }
  }, [selectedIds, router]);

  const handleLongPress = useCallback((orderId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSelectedIds(prev =>
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  }, []);

  const handleBulkMarkProcessing = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Promise.all(selectedIds.map(id => api.orders.updateStatus(id, 'processing')));
      setSelectedIds([]);
      await loadData(generationRef.current);
    } catch {
      Alert.alert('Error', 'Could not bulk update orders.');
    }
  }, [api, selectedIds, loadData]);

  const handleBulkMarkReady = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await Promise.all(selectedIds.map(id => api.orders.updateStatus(id, 'fulfilled')));
      setSelectedIds([]);
      await loadData(generationRef.current);
    } catch {
      Alert.alert('Error', 'Could not bulk update orders.');
    }
  }, [api, selectedIds, loadData]);

  const handleExportCsv = useCallback(async () => {
    try {
      const rows = orders.map(o => {
        const customer = o.customer?.name ?? o.customer?.email ?? 'Unknown';
        const date = new Date(o.createdAt).toLocaleDateString('en-US');
        const total = formatCents(o.payment.totalCents);
        const itemCount = o.lineItems.length;
        return [
          o.orderNumber ?? o.id.slice(0, 8),
          `"${customer.replace(/"/g, '""')}"`,
          date,
          o.status,
          o.paymentStatus,
          o.fulfillmentStatus ?? 'unfulfilled',
          itemCount,
          total,
        ].join(',');
      });
      const csv = ['Order #,Customer,Date,Status,Payment,Fulfillment,Items,Total', ...rows].join('\n');
      await Share.share({ message: csv, title: 'Orders Export' });
    } catch {
      Alert.alert('Export failed', 'Could not export orders. Please try again.');
    }
  }, [orders]);

  const handleMoreMenu = useCallback(() => {
    Alert.alert('Orders', 'Choose an action', [
      { text: 'Export CSV', onPress: handleExportCsv },
      { text: 'Bulk Actions', onPress: () => Alert.alert('Bulk', 'Long-press orders to select.') },
      { text: 'Refresh', onPress: onRefresh },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [onRefresh]);

  // ─── Render item ───────────────────────────────────────────────────────────

  const renderItem = useCallback(({ item }: { item: Order }) => (
    <OrderCard
      order={item}
      selected={selectedIds.includes(item.id)}
      selectionMode={selectedIds.length > 0}
      onPress={() => handleCardPress(item)}
      onLongPress={() => handleLongPress(item.id)}
      onMarkProcessing={() => handleMarkProcessing(item.id)}
      onMarkReady={() => handleMarkReady(item.id)}
      onShip={() => handleShip(item.id)}
    />
  ), [selectedIds, handleCardPress, handleLongPress, handleMarkProcessing, handleMarkReady, handleShip]);

  const keyExtractor = useCallback((o: Order) => o.id, []);

  // ─── Header right ──────────────────────────────────────────────────────────

  const headerRight = (
    <View style={s.headerRight}>
      <IconButton
        name="bar-chart-2"
        onPress={() => router.push('/(tabs)/analytics' as never)}
        color={FG}
      />
      <IconButton
        name="search"
        onPress={() => {
          setSearchActive(v => !v);
          if (searchActive) setSearchQuery('');
        }}
        color={searchActive ? PURPLE_LIGHT : FG}
      />
      <IconButton
        name="sliders"
        onPress={() => {
          Haptics.selectionAsync();
          // cycle filter via modal — use sort modal for now as filter bar is visible
        }}
        color={activeFilter !== 'all' ? PURPLE_LIGHT : FG}
      />
      <IconButton
        name="sliders"
        onPress={() => setSortModalVisible(true)}
        color={FG}
      />
      <IconButton name="more-horizontal" onPress={handleMoreMenu} color={FG} />
    </View>
  );

  // ─── Empty + Loading ───────────────────────────────────────────────────────

  const ListEmpty = useCallback(() => {
    if (loading) return null;
    if (loadError) return null; // error banner shown above the list
    return (
      <EmptyState
        icon="shopping-bag"
        title="No orders yet"
        description="Your first orders will appear here. Share your store link to start selling."
        style={{ marginTop: SP.xl }}
      />
    );
  }, [loading, loadError]);

  const ListHeader = useCallback(() => (
    <View>
      {/* Summary Strip */}
      {stats && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.statStrip}
        >
          <TouchableOpacity style={[s.statChip, { borderColor: PURPLE + '55' }]} onPress={() => setActiveFilter('all')}>
            <Text style={[s.statChipVal, { color: PURPLE_LIGHT }]}>{stats.total}</Text>
            <Text style={s.statChipLabel}>Total</Text>
          </TouchableOpacity>
          {stats.newOrders > 0 && (
            <TouchableOpacity style={[s.statChip, { borderColor: ORANGE + '55' }]} onPress={() => setActiveFilter('new')}>
              <Text style={[s.statChipVal, { color: ORANGE }]}>{stats.newOrders}</Text>
              <Text style={s.statChipLabel}>New</Text>
            </TouchableOpacity>
          )}
          {stats.toProcess > 0 && (
            <TouchableOpacity style={[s.statChip, { borderColor: BLUE + '55' }]} onPress={() => setActiveFilter('processing')}>
              <Text style={[s.statChipVal, { color: BLUE }]}>{stats.toProcess}</Text>
              <Text style={s.statChipLabel}>Processing</Text>
            </TouchableOpacity>
          )}
          {stats.readyToShip > 0 && (
            <TouchableOpacity style={[s.statChip, { borderColor: SUCCESS + '55' }]} onPress={() => setActiveFilter('ready_to_ship')}>
              <Text style={[s.statChipVal, { color: SUCCESS }]}>{stats.readyToShip}</Text>
              <Text style={s.statChipLabel}>Ready</Text>
            </TouchableOpacity>
          )}
          {stats.returnRequests > 0 && (
            <TouchableOpacity style={[s.statChip, { borderColor: CYAN + '55' }]} onPress={() => setActiveFilter('returned')}>
              <Text style={[s.statChipVal, { color: CYAN }]}>{stats.returnRequests}</Text>
              <Text style={s.statChipLabel}>Returns</Text>
            </TouchableOpacity>
          )}
          {stats.disputes > 0 && (
            <TouchableOpacity style={[s.statChip, { borderColor: RED + '55' }]} onPress={() => setActiveFilter('disputed')}>
              <Text style={[s.statChipVal, { color: RED }]}>{stats.disputes}</Text>
              <Text style={s.statChipLabel}>Disputes</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      )}

      {/* Filter bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filterBar}
      >
        {FILTERS.map(({ key, label }) => (
          <FilterChip
            key={key}
            label={label}
            active={activeFilter === key}
            onPress={() => setActiveFilter(key)}
            count={key !== 'all' && filterCounts[key] != null ? filterCounts[key] : undefined}
          />
        ))}
      </ScrollView>

      {/* Results count */}
      <View style={s.resultsRow}>
        <Text style={s.resultsText}>
          {filtered.length} {filtered.length === 1 ? 'order' : 'orders'}
          {activeFilter !== 'all' ? ` · ${FILTERS.find(f => f.key === activeFilter)?.label}` : ''}
        </Text>
        {sort !== 'newest' && (
          <TouchableOpacity onPress={() => setSortModalVisible(true)}>
            <Text style={s.sortLabel}>
              {SORTS.find(s => s.key === sort)?.label} ↕
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  ), [stats, activeFilter, filterCounts, filtered.length, sort]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Orders</Text>
        {headerRight}
      </View>

      {/* Search bar */}
      {searchActive && (
        <View style={s.searchWrap}>
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search orders, customers, SKUs…"
            style={{ flex: 1 }}
          />
          <TouchableOpacity
            onPress={() => { setSearchActive(false); setSearchQuery(''); }}
            style={s.searchClose}
          >
            <Feather name="x" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
        </View>
      )}

      {/* Error banner with retry */}
      {loadError && !loading && (
        <View style={s.errorBanner}>
          <Feather name="alert-circle" size={ICON.sm} color={RED} />
          <Text style={s.errorBannerText} numberOfLines={2}>{loadError}</Text>
          <TouchableOpacity
            style={s.errorRetryBtn}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onRefresh(); }}
            activeOpacity={0.8}
          >
            <Feather name="refresh-cw" size={12} color={PURPLE_LIGHT} />
            <Text style={s.errorRetryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main list */}
      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={[
          s.listContent,
          filtered.length === 0 && { flexGrow: 1 },
          { paddingBottom: insets.bottom + COMP.tabBarH + (selectedIds.length > 0 ? 80 : SP.md) },
        ]}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={PURPLE}
            colors={[PURPLE]}
          />
        }
      />
      {loading && !refreshing && (
        <View style={s.loadingOverlay} pointerEvents="none">
          <BrandedLoader label="Lining up your orders…" />
        </View>
      )}

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <View style={[s.bulkBar, { paddingBottom: insets.bottom + SP.sm }]}>
          <LinearGradient colors={['#12121F', '#07070F']} style={s.bulkBarInner}>
            <Text style={s.bulkCount}>{selectedIds.length} selected</Text>
            <View style={s.bulkActions}>
              <TouchableOpacity style={s.bulkBtn} onPress={handleBulkMarkProcessing}>
                <Feather name="play" size={ICON.xs} color={BLUE} />
                <Text style={[s.bulkBtnText, { color: BLUE }]}>Processing</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.bulkBtn} onPress={handleBulkMarkReady}>
                <Feather name="package" size={ICON.xs} color={SUCCESS} />
                <Text style={[s.bulkBtnText, { color: SUCCESS }]}>Ready</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.bulkBtn} onPress={handleExportCsv}>
                <Feather name="download" size={ICON.xs} color={MUTED} />
                <Text style={[s.bulkBtnText, { color: MUTED }]}>Export</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.bulkBtn} onPress={() => setSelectedIds([])}>
                <Feather name="x" size={ICON.xs} color={RED} />
                <Text style={[s.bulkBtnText, { color: RED }]}>Clear</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>
      )}

      {/* Sort Modal */}
      <SortModal
        visible={sortModalVisible}
        current={sort}
        onSelect={k => { setSort(k); setSortModalVisible(false); }}
        onClose={() => setSortModalVisible(false)}
      />
      <AIBrainFAB context={{ screen: 'orders' as const }} bottomOffset={72} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    top: 72,
    backgroundColor: BG,
    zIndex: 10,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    minHeight: COMP.headerH,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },

  // Search
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  searchClose: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Stat strip
  statStrip: {
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    paddingBottom: SP.sm,
    gap: SP.sm,
  },
  statChip: {
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    minWidth: 72,
    gap: 2,
  },
  statChipVal: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    letterSpacing: -0.5,
  },
  statChipLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },

  // Filter bar
  filterBar: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    gap: SP.sm,
  },

  // Results row
  resultsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  resultsText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },
  sortLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },

  // List
  listContent: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },

  // Order card
  card: {
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    gap: SP.sm,
    marginBottom: SP.sm,
  },
  cardSelected: {
    borderColor: BORDER_ACTIVE,
    backgroundColor: CARD_ELEVATED,
  },
  cardRisk: {
    borderColor: RED + '44',
  },

  // Selection
  selBox: {
    position: 'absolute',
    top: SP.md,
    right: SP.md,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  selBoxActive: {
    backgroundColor: PURPLE,
    borderColor: PURPLE,
  },

  // Card rows
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    flex: 1,
  },
  cardRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },

  orderNum: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.2,
  },
  newBadge: {
    backgroundColor: ORANGE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: ORANGE + '44',
  },
  newBadgeText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: ORANGE,
    letterSpacing: 0.5,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: PURPLE,
  },
  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: RED_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: RED + '44',
  },
  riskText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: RED,
    letterSpacing: 0.4,
  },
  returnBadge: {
    backgroundColor: CYAN_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
  },
  returnBadgeText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: CYAN,
    letterSpacing: 0.3,
  },
  disputeBadge: {
    backgroundColor: RED_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
  },
  disputeBadgeText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: RED,
    letterSpacing: 0.3,
  },
  customerName: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  orderDate: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },
  itemSummary: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: 2,
  },

  // Status pills
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    flex: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },
  totalAmount: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.2,
  },

  // Tags
  tagRow: {
    flexDirection: 'row',
    gap: SP.xs,
    marginTop: -SP.xs,
  },
  tagPreOrder: {
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
  },
  tagPreOrderText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
    letterSpacing: 0.4,
  },
  tagMfg: {
    backgroundColor: BLUE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: BLUE + '44',
  },
  tagMfgText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: BLUE,
    letterSpacing: 0.4,
  },

  // Action row
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    flexWrap: 'wrap',
  },
  actionBtn: {
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
  },
  actionBtnGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  actionBtnText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: '#fff',
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  viewBtnText: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },
  trackingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: SUCCESS_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: SUCCESS + '44',
  },
  trackingText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUCCESS,
  },
  disputePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: RED_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: RED + '44',
  },
  disputePillText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: RED,
  },

  // Bulk bar
  bulkBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bulkBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    borderTopWidth: 1,
    borderTopColor: BORDER_ACTIVE,
  },
  bulkCount: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
  },
  bulkActions: {
    flexDirection: 'row',
    gap: SP.sm,
  },
  bulkBtn: {
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
    backgroundColor: CARD,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
  },
  bulkBtnText: {
    fontSize: 10,
    fontFamily: FONT.semibold,
  },

  // Sort modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  modalSheet: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.md,
    paddingBottom: SP.xxl,
    paddingTop: SP.md,
    gap: SP.xs,
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: BORDER,
    borderRadius: RADIUS.pill,
    alignSelf: 'center',
    marginBottom: SP.sm,
  },
  modalTitle: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
    paddingBottom: SP.sm,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  sortOptionActive: {
    // subtle purple tint handled by text color
  },
  sortOptionText: {
    fontSize: FS.base,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  sortOptionTextActive: {
    color: PURPLE_LIGHT,
    fontFamily: FONT.semibold,
  },
  modalCloseBtn: {
    marginTop: SP.md,
    alignItems: 'center',
    paddingVertical: SP.md,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalCloseBtnText: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: MUTED,
  },

  // Error banner
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginHorizontal: SP.md,
    marginTop: SP.sm,
    marginBottom: SP.xs,
    backgroundColor: RED_DIM,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: RED + '44',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  errorBannerText: {
    flex: 1,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: RED,
    lineHeight: 16,
  },
  errorRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: PURPLE_LIGHT + '44',
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  errorRetryText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },
});
