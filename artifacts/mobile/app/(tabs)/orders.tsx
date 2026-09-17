/**
 * Brandthread — Seller Orders Tab
 * Shopify-pattern layout: persistent search row, status pills, date-grouped divider rows.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import { View, Text, ScrollView, FlatList, TouchableOpacity, StyleSheet, Alert, RefreshControl, Modal, Share, SectionList } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BG, SCREEN_BG, SURFACE, CARD, CARD_GLASS, CARD_ELEVATED_GLASS, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, CYAN, CYAN_DIM, FONT, FS, SP, RADIUS, COMP, ICON, ANIM, PURPLE, PURPLE_LIGHT, PURPLE_DIM } from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { IconButton, FilterChip, StatusBadge, SearchBar, EmptyState } from '@/components/BrandthreadUI';
import { filterOrders, sortOrders } from '@/services/orderService';
import { Order, OrderFilterKey, OrderSortKey, OrderAddress, OrderCustomer, FulfillmentStatus, FulfillmentType, OrderStatus, PaymentStatus, CancellationReason, CANCELLATION_REASONS } from '@/services/orderTypes';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@clerk/expo';
import { clearBadge } from '@/lib/orderBadgeStore';
import { formatCents } from '@/lib/money';
import SwipeActionRow from '@/components/SwipeActionRow';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrderStats {
  newOrders: number;
  toProcess: number;
  readyToShip: number;
  returnRequests: number;
  disputes: number;
  total: number;
}

interface OrderSection {
  title: string;
  data: Order[];
}

type OrderListFilter = OrderFilterKey | 'unpaid' | 'open' | 'archived';
type OrderListOrder = Order & {
  listItemCount?: number;
  listItemLabel?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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

export function getCancellationReasonLabel(reason: string): string {
  return CANCELLATION_REASONS.find(r => r.key === reason)?.label ?? reason.replace(/_/g, ' ');
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

/** Group a sorted order list into date-labelled sections. */
function groupByDate(orders: Order[]): OrderSection[] {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const todayStr = fmt(today);
  const yesterdayStr = fmt(yesterday);

  const buckets = new Map<string, Order[]>();

  for (const order of orders) {
    const d = new Date(order.createdAt);
    const label = fmt(d) === todayStr
      ? 'Today'
      : fmt(d) === yesterdayStr
        ? 'Yesterday'
        : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label)!.push(order);
  }

  return Array.from(buckets.entries()).map(([title, data]) => ({ title, data }));
}

// ─── API → Order adapter ──────────────────────────────────────────────────────

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

export function apiRowToOrder(row: any): OrderListOrder {
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
  const cancellationReason = row.cancellationReason as string | null | undefined;

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
    cancellation: ordStatus === 'cancelled' && cancellationReason ? {
      id: `cancel_${row.id}`,
      orderId: row.id,
      reason: cancellationReason as CancellationReason,
      refundAmountCents: totalCents,
      notifyCustomer: true,
      cancelledAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date(row.updatedAt).toISOString(),
    } : undefined,
    hasUnreadMessage: false, isPreOrder: false, isManufacturerFulfilled: false,
    currency: 'USD', tags: [],
    listItemCount: Number.isSafeInteger(row.itemCount) && row.itemCount >= 0 ? row.itemCount : undefined,
    listItemLabel: typeof row.dropName === 'string' && row.dropName.trim() ? row.dropName.trim() : undefined,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date(row.createdAt).toISOString(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date(row.updatedAt).toISOString(),
  };
}

// ─── Filter Config ────────────────────────────────────────────────────────────

const FILTERS: { key: OrderListFilter; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'unfulfilled', label: 'Unfulfilled' },
  { key: 'unpaid',     label: 'Unpaid' },
  { key: 'open',       label: 'Open' },
  { key: 'archived',   label: 'Archived' },
];

function filterOrderList(orders: Order[], filter: OrderListFilter): Order[] {
  if (filter === 'unpaid') {
    return orders.filter(order =>
      order.paymentStatus === 'pending' ||
      order.paymentStatus === 'failed' ||
      order.paymentStatus === 'voided'
    );
  }
  if (filter === 'open') {
    return orders.filter(order =>
      order.status !== 'cancelled' &&
      order.status !== 'refunded' &&
      order.status !== 'delivered'
    );
  }
  if (filter === 'archived') {
    return orders.filter(order =>
      order.status === 'cancelled' ||
      order.status === 'refunded' ||
      order.status === 'delivered'
    );
  }
  return filterOrders(orders, filter);
}

const ALL_FILTERS: { key: OrderFilterKey; label: string }[] = [
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

// ─── Order Row ────────────────────────────────────────────────────────────────

interface OrderRowProps {
  order: OrderListOrder;
  selected: boolean;
  selectionMode: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onMarkProcessing: () => void;
  onMarkReady: () => void;
  onShip: () => void;
  isLast?: boolean;
}

export function OrderRow({
  order, selected, selectionMode, onPress, onLongPress,
  onMarkProcessing, onMarkReady, onShip, isLast = false,
}: OrderRowProps) {
  const { theme } = useAppTheme();
  const isHighRisk = order.riskLevel === 'high';
  const hasReturn = order.returns.length > 0;
  const hasDispute = order.disputes.length > 0;
  const isArchived = order.status === 'cancelled';

  const firstItem = order.lineItems[0];
  const itemCount = order.listItemCount ?? order.lineItems.length;
  const moreCount = Math.max(0, itemCount - 1);
  const itemLabel = firstItem
    ? moreCount > 0
      ? `${firstItem.productName} +${moreCount}`
      : firstItem.productName
    : order.listItemLabel ?? (itemCount > 0 ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : 'No items');

  const payColor = getPaymentColor(order.paymentStatus);
  const fulColor = getFulfillmentColor(order.fulfillmentStatus);

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={onPress}
        onLongPress={onLongPress}
        style={[s.orderRow, selected && s.orderRowSelected, isHighRisk && s.orderRowRisk, isArchived && s.orderRowArchived]}
        accessibilityLabel={`Order ${order.orderNumber}, ${order.customer.name}, ${fmtMoney(order.payment.totalCents)}`}
      >
        {/* Selection checkbox */}
        {selectionMode && (
          <View style={[s.selBox, selected && s.selBoxActive]}>
            {selected && <Feather name="check" size={10} color={FG} />}
          </View>
        )}

        {/* Row: order number + price + time */}
        <View style={s.orderMainRow}>
          <View style={s.orderLeft}>
            <View style={s.orderNumRow}>
              <Text style={s.orderNum}>{order.orderNumber}</Text>
              {order.status === 'new' && (
                <View style={s.newDot}>
                  <Text style={s.newDotText}>NEW</Text>
                </View>
              )}
              {order.hasUnreadMessage && <View style={s.unreadDot} />}
              {isHighRisk && (
                <View style={s.riskBadge}>
                  <Feather name="alert-triangle" size={9} color={RED} />
                  <Text style={s.riskText}>RISK</Text>
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

            {/* Customer + item label */}
            <Text style={s.orderCustomer} numberOfLines={1}>{order.customer.name}</Text>
            <Text style={s.orderItems} numberOfLines={1}>
              {itemLabel}
              {itemCount > 0 && !itemLabel.startsWith(`${itemCount} `)
                ? ` · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}`
                : ''}
            </Text>
            {isArchived && order.cancellation?.reason && (
              <Text style={s.orderCancelled} numberOfLines={1}>
                {`Cancelled · ${getCancellationReasonLabel(order.cancellation.reason)}`}
              </Text>
            )}
          </View>

          {/* Right: price + time */}
          <View style={s.orderRight}>
            <Text style={s.orderAmount}>{fmtMoney(order.payment.totalCents)}</Text>
            <Text style={s.orderTime}>{fmtTime(order.createdAt)}</Text>
          </View>
        </View>

        {/* Status pills row */}
        <View style={s.orderStatusRow}>
          <View style={s.statusPill}>
            <View style={[s.statusDot, { backgroundColor: payColor }]} />
            <Text style={[s.statusText, { color: payColor }]}>{getPaymentLabel(order.paymentStatus)}</Text>
          </View>
          <View style={s.statusPill}>
            <View style={[s.statusDot, { backgroundColor: fulColor }]} />
            <Text style={[s.statusText, { color: fulColor }]}>{getFulfillmentLabel(order.fulfillmentStatus)}</Text>
          </View>
          {order.isPreOrder && (
            <View style={s.tagPill}>
              <Text style={s.tagText}>PRE-ORDER</Text>
            </View>
          )}
          {order.isManufacturerFulfilled && (
            <View style={[s.tagPill, { borderColor: BLUE + '44', backgroundColor: BLUE_DIM }]}>
              <Text style={[s.tagText, { color: BLUE }]}>MFG</Text>
            </View>
          )}
          {isArchived && order.cancellation?.reason && (
            <View style={[s.tagPill, { borderColor: RED + '44', backgroundColor: RED_DIM }]}>
              <Text style={[s.tagText, { color: RED }]}>
                {getCancellationReasonLabel(order.cancellation.reason).toUpperCase()}
              </Text>
            </View>
          )}

          {/* Quick action — pushed right */}
          <View style={{ flex: 1 }} />
          {order.status === 'new' && (
            <TouchableOpacity
              style={s.quickAction}
              onPress={e => { e.stopPropagation(); onMarkProcessing(); }}
              activeOpacity={0.8}
            >
              <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.quickActionGrad}>
                <Feather name="check-circle" size={11} color={theme.onAccent} />
                <Text style={[s.quickActionText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Accept</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
          {order.status === 'processing' && (
            <TouchableOpacity
              style={s.quickAction}
              onPress={e => { e.stopPropagation(); onMarkReady(); }}
              activeOpacity={0.8}
            >
              <LinearGradient colors={[BLUE, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.quickActionGrad}>
                <Feather name="package" size={11} color="#fff" />
                <Text style={s.quickActionText}>Ready</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
          {order.status === 'ready_to_ship' && (
            <TouchableOpacity
              style={s.quickAction}
              onPress={e => { e.stopPropagation(); onShip(); }}
              activeOpacity={0.8}
            >
              <LinearGradient colors={[SUCCESS, CYAN]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.quickActionGrad}>
                <Feather name="send" size={11} color="#fff" />
                <Text style={s.quickActionText}>Ship</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}
          {order.status === 'shipped' && order.shipments[0] && (
            <View style={s.trackingPill}>
              <Feather name="truck" size={10} color={SUCCESS} />
              <Text style={s.trackingText}>
                {order.shipments[0].carrier} · {order.shipments[0].trackingNumber?.slice(-6)}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
      {!isLast && <View style={s.rowDivider} />}
    </>
  );
}

// ─── Legacy OrderCard export (kept for test compatibility) ────────────────────
export const OrderCard = OrderRow;

// ─── Sort Modal ───────────────────────────────────────────────────────────────

function SortModal({
  visible, current, onSelect, onClose,
}: {
  visible: boolean;
  current: OrderSortKey;
  onSelect: (k: OrderSortKey) => void;
  onClose: () => void;
}) {
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
            onPress={() => { Haptics.selectionAsync(); onSelect(key); onClose(); }}
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

// ─── Filter Sheet ─────────────────────────────────────────────────────────────

function FilterSheet({
  visible, current, onSelect, onClose,
}: {
  visible: boolean;
  current: OrderFilterKey;
  onSelect: (k: OrderFilterKey) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose} />
      <View style={s.modalSheet}>
        <View style={s.modalHandle} />
        <Text style={s.modalTitle}>Filter Orders</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 400 }}>
          {ALL_FILTERS.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={[s.sortOption, current === key && s.sortOptionActive]}
              onPress={() => { Haptics.selectionAsync(); onSelect(key); onClose(); }}
              activeOpacity={0.8}
            >
              <Text style={[s.sortOptionText, current === key && s.sortOptionTextActive]}>
                {label}
              </Text>
              {current === key && <Feather name="check" size={ICON.sm} color={PURPLE_LIGHT} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
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
  const { userId, isLoaded: authLoaded, isSignedIn } = useAuth();

  const [orders, setOrders] = useState<OrderListOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatesPaused, setUpdatesPaused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<OrderListFilter>('all');
  const [sort, setSort] = useState<OrderSortKey>('newest');
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stats, setStats] = useState<OrderStats | null>(null);
  const [ordersOwnerId, setOrdersOwnerId] = useState<string | null>(null);

  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);
  const requestGenerationRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);

  const loadData = useCallback(async (generation: number) => {
    if (!authLoaded || !isSignedIn || !userId) return;
    if (requestGenerationRef.current === generation) return;
    const requestOwnerId = userId;
    requestGenerationRef.current = generation;
    try {
      const rows = await api.orders.list();
      if (generationRef.current !== generation) return;
      const all = Array.isArray(rows) ? (rows as any[]).map(apiRowToOrder) : [];
      setOrders(all);
      setOrdersOwnerId(requestOwnerId);
      setStats(computeStats(all));
      setUpdatesPaused(false);
      consecutiveFailuresRef.current = 0;
    } catch (e) {
      if (generationRef.current !== generation) return;
      if (__DEV__) console.warn('[seller-orders] refresh unavailable; showing empty state', e);
      setOrders([]);
      setOrdersOwnerId(requestOwnerId);
      setStats(computeStats([]));
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3) {
        setUpdatesPaused(true);
        if (timerRef.current !== null) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    } finally {
      if (generationRef.current === generation) {
        setLoading(false);
        setRefreshing(false);
        hasLoadedRef.current = true;
      }
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current = null;
      }
    }
  }, [api, authLoaded, isSignedIn, userId]);

  useFocusEffect(
    useCallback(() => {
      if (!authLoaded || !isSignedIn || !userId) {
        setLoading(true);
        return undefined;
      }
      clearBadge(userId);
      const generation = ++generationRef.current;
      consecutiveFailuresRef.current = 0;
      setUpdatesPaused(false);
      if (!hasLoadedRef.current) setLoading(true);
      loadData(generation);
      timerRef.current = setInterval(() => loadData(generation), 30_000);
      return () => {
        if (timerRef.current !== null) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }, [authLoaded, isSignedIn, loadData, userId])
  );

  const retryUpdates = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const generation = generationRef.current;
    consecutiveFailuresRef.current = 0;
    setUpdatesPaused(false);
    if (timerRef.current === null) {
      timerRef.current = setInterval(() => loadData(generation), 30_000);
    }
    loadData(generation);
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    retryUpdates();
  }, [retryUpdates]);

  // Filtered + sorted list
  const filtered = useMemo(() => {
    const visibleOrders = ordersOwnerId === userId ? orders : [];
    let base = visibleOrders;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      base = visibleOrders.filter(o =>
        o.orderNumber.toLowerCase().includes(q) ||
        o.customer.name.toLowerCase().includes(q) ||
        o.customer.email.toLowerCase().includes(q) ||
        o.lineItems.some(li => li.productName.toLowerCase().includes(q))
      );
    }
    base = filterOrderList(base, activeFilter);
    base = sortOrders(base, sort);
    return base;
  }, [orders, ordersOwnerId, userId, searchQuery, activeFilter, sort]);

  // Date-grouped sections
  const sections = useMemo(() => groupByDate(filtered), [filtered]);

  // Filter counts
  const filterCounts = useMemo(() => {
    const map: Partial<Record<OrderListFilter, number>> = {};
    FILTERS.forEach(({ key }) => {
      const visibleOrders = ordersOwnerId === userId ? orders : [];
      const count = filterOrderList(visibleOrders, key).length;
      if (key !== 'all') map[key] = count;
    });
    return map;
  }, [orders, ordersOwnerId, userId]);

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
      const visibleOrders = ordersOwnerId === userId ? orders : [];
      const rows = visibleOrders.map(o => {
        const customer = o.customer?.name ?? o.customer?.email ?? 'Unknown';
        const date = new Date(o.createdAt).toLocaleDateString('en-US');
        const total = formatCents(o.payment.totalCents);
        const itemCount = o.listItemCount ?? o.lineItems.length;
        return [
          o.orderNumber ?? o.id.slice(0, 8),
          `"${customer.replace(/"/g, '""')}"`,
          date, o.status, o.paymentStatus,
          o.fulfillmentStatus ?? 'unfulfilled',
          itemCount, total,
        ].join(',');
      });
      const csv = ['Order #,Customer,Date,Status,Payment,Fulfillment,Items,Total', ...rows].join('\n');
      await Share.share({ message: csv, title: 'Orders Export' });
    } catch {
      Alert.alert('Export failed', 'Could not export orders. Please try again.');
    }
  }, [orders, ordersOwnerId, userId]);

  const handleMoreMenu = useCallback(() => {
    Alert.alert('Orders', 'Choose an action', [
      { text: 'Export CSV', onPress: handleExportCsv },
      { text: 'Bulk Actions', onPress: () => Alert.alert('Bulk', 'Long-press orders to select.') },
      { text: 'Refresh', onPress: onRefresh },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [onRefresh, handleExportCsv]);

  // ─── Render helpers ────────────────────────────────────────────────────────

  const hasActiveFilter = activeFilter !== 'all';
  const currentSortLabel = SORTS.find(s => s.key === sort)?.label ?? 'Sort';

  const renderSectionHeader = useCallback(({ section }: { section: OrderSection }) => (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{section.title}</Text>
      <Text style={s.sectionCount}>{section.data.length} {section.data.length === 1 ? 'order' : 'orders'}</Text>
    </View>
  ), []);

  const renderItem = useCallback(({ item, index, section }: { item: Order; index: number; section: OrderSection }) => {
    const isLast = index === section.data.length - 1;
    const swipeAction =
      item.status === 'new'
        ? { label: 'Accept', icon: 'check-circle' as const, color: theme.accent, run: () => handleMarkProcessing(item.id) }
        : item.status === 'processing'
          ? { label: 'Ready', icon: 'package' as const, color: BLUE, run: () => handleMarkReady(item.id) }
          : item.status === 'ready_to_ship'
            ? { label: 'Ship', icon: 'send' as const, color: SUCCESS, run: () => handleShip(item.id) }
            : { label: 'Open', icon: 'arrow-right' as const, color: theme.accent, run: () => handleCardPress(item) };

    return (
      <SwipeActionRow
        label={swipeAction.label}
        icon={swipeAction.icon}
        color={swipeAction.color}
        onAction={swipeAction.run}
        disabled={selectedIds.length > 0}
        accessibilityLabel={`${swipeAction.label} order ${item.orderNumber}`}
      >
        <OrderRow
          order={item}
          selected={selectedIds.includes(item.id)}
          selectionMode={selectedIds.length > 0}
          onPress={() => handleCardPress(item)}
          onLongPress={() => handleLongPress(item.id)}
          onMarkProcessing={() => handleMarkProcessing(item.id)}
          onMarkReady={() => handleMarkReady(item.id)}
          onShip={() => handleShip(item.id)}
          isLast={isLast}
        />
      </SwipeActionRow>
    );
  }, [selectedIds, handleCardPress, handleLongPress, handleMarkProcessing, handleMarkReady, handleShip, theme.accent]);

  const keyExtractor = useCallback((o: Order) => o.id, []);

  const ListHeaderComponent = useCallback(() => (
    <View style={s.listHeader}>
      {/* Results count */}
      <View style={s.resultsRow}>
        <Text style={s.resultsText}>
          {filtered.length} {filtered.length === 1 ? 'order' : 'orders'}
          {activeFilter !== 'all'
            ? ` · ${FILTERS.find(f => f.key === activeFilter)?.label ?? ALL_FILTERS.find(f => f.key === activeFilter)?.label}`
            : ''}
        </Text>
        {sort !== 'newest' && (
          <TouchableOpacity onPress={() => setSortModalVisible(true)}>
            <Text style={s.sortIndicator}>{currentSortLabel} ↕</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  ), [filtered.length, activeFilter, sort, currentSortLabel]);

  const ListEmptyComponent = useCallback(() => {
    if (loading) return null;
    return (
      <View style={s.emptyStateContainer}>
        <EmptyState
          icon="shopping-bag"
          title="Your first order will show up here."
          description="When a customer places an order, you can manage payment and fulfillment here."
        />
      </View>
    );
  }, [loading]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* ── Fixed header ── */}
      <View style={s.header}>
        {/* Title row */}
        <View style={s.titleRow}>
          <TouchableOpacity
            style={s.titleBtn}
            onPress={() => Alert.alert('Order view', 'Choose a view', [
              { text: 'All orders', onPress: () => setActiveFilter('all') },
              { text: 'Open orders', onPress: () => setActiveFilter('open') },
              { text: 'Archived orders', onPress: () => setActiveFilter('archived') },
              { text: 'Cancel', style: 'cancel' },
            ])}
            activeOpacity={0.7}
          >
            <Text style={s.titleText}>Orders</Text>
            <Feather name="chevron-down" size={18} color={MUTED} />
          </TouchableOpacity>
          <View style={s.titleActions}>
            <TouchableOpacity
              style={s.headerIconBtn}
              onPress={handleMoreMenu}
              accessibilityLabel="More order actions"
            >
              <Feather name="more-horizontal" size={ICON.md} color={FG} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Persistent search row */}
        <View style={s.searchRow}>
          <View style={s.searchBox}>
            <Feather name="map-pin" size={14} color={MUTED} style={{ marginRight: SP.xs }} />
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="All locations · Search orders"
              style={s.searchInput}
            />
          </View>
          <TouchableOpacity
            style={[s.controlBtn, hasActiveFilter && s.controlBtnActive]}
            onPress={() => setFilterSheetVisible(true)}
            accessibilityLabel={hasActiveFilter ? `Filter: ${activeFilter}` : 'Filter orders'}
          >
            <Feather name="sliders" size={14} color={hasActiveFilter ? PURPLE_LIGHT : MUTED} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.controlBtn}
            onPress={() => setSortModalVisible(true)}
            accessibilityLabel={`Sort: ${currentSortLabel}`}
          >
            <Feather name="chevrons-down" size={14} color={MUTED} />
          </TouchableOpacity>
        </View>

        {/* Status pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.pillsRow}
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
      </View>

      {/* ── Order list (section list for date groups) ── */}
      <SectionList
        sections={sections}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        renderSectionFooter={() => <View style={{ height: SP.sm }} />}
        ListHeaderComponent={ListHeaderComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={[
          s.listContent,
          filtered.length === 0 && { flexGrow: 1 },
          { paddingBottom: insets.bottom + COMP.tabBarH + (selectedIds.length > 0 ? 80 : SP.md) },
        ]}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={PURPLE}
            colors={[PURPLE]}
          />
        }
      />

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <View style={[s.bulkBar, { paddingBottom: insets.bottom + SP.sm }]}>
          <LinearGradient colors={['#18181B', '#0A0A0B']} style={s.bulkBarInner}>
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
        onSelect={k => setSort(k)}
        onClose={() => setSortModalVisible(false)}
      />

      {/* Filter Sheet */}
      <FilterSheet
        visible={filterSheetVisible}
        current={FILTERS.some(filter => filter.key === activeFilter) ? 'all' : activeFilter as OrderFilterKey}
        onSelect={k => setActiveFilter(k)}
        onClose={() => setFilterSheetVisible(false)}
      />

      <AIBrainFAB context={{ screen: 'orders' as const }} bottomOffset={72} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  // Header
  header: {
    backgroundColor: BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    paddingBottom: SP.sm,
    minHeight: 44,
  },
  titleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  titleText: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconBtn: {
    width: COMP.iconBtn,
    height: COMP.iconBtn,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Search row
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.sm,
    height: 36,
  },
  searchInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    height: 36,
  },
  controlBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
  },
  controlBtnActive: {
    borderColor: BORDER_ACTIVE,
    backgroundColor: PURPLE_DIM,
  },

  // Status pills
  pillsRow: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    paddingTop: 2,
    gap: SP.xs,
  },

  // List header
  listHeader: {
    paddingTop: SP.sm,
  },
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
  emptyStateContainer: {
    marginHorizontal: SP.md,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
    marginBottom: SP.sm,
  },
  sortIndicator: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },

  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    paddingBottom: SP.xs,
  },
  sectionTitle: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionCount: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },

  // Order row
  orderRow: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: CARD,
    minHeight: 44,
  },
  orderRowSelected: {
    backgroundColor: CARD_ELEVATED_GLASS,
  },
  orderRowRisk: {
    borderLeftWidth: 2,
    borderLeftColor: RED + '66',
  },
  orderRowArchived: {
    opacity: 0.68,
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

  orderMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: SP.xs,
  },
  orderLeft: {
    flex: 1,
    gap: 2,
  },
  orderNumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    flexWrap: 'nowrap',
  },
  orderNum: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.1,
  },
  newDot: {
    backgroundColor: ORANGE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: ORANGE + '44',
  },
  newDotText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: ORANGE,
    letterSpacing: 0.4,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: PURPLE,
  },
  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: RED_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: RED + '44',
  },
  riskText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: RED,
    letterSpacing: 0.3,
  },
  returnBadge: {
    backgroundColor: CYAN_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
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
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  disputeBadgeText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: RED,
    letterSpacing: 0.3,
  },
  orderCustomer: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  orderItems: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  orderCancelled: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: RED,
  },
  orderRight: {
    alignItems: 'flex-end',
    gap: 2,
    paddingLeft: SP.sm,
    flexShrink: 0,
  },
  orderAmount: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.1,
  },
  orderTime: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
  },

  // Status row
  orderStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    flexWrap: 'nowrap',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },
  tagPill: {
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE + '55',
  },
  tagText: {
    fontSize: 9,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
    letterSpacing: 0.3,
  },

  // Quick action
  quickAction: {
    borderRadius: RADIUS.xs,
    overflow: 'hidden',
  },
  quickActionGrad: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
  },
  quickActionText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: '#fff',
  },
  trackingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: SUCCESS_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: SUCCESS + '44',
  },
  trackingText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUCCESS,
  },

  // Row divider
  rowDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginLeft: SP.md,
  },

  // List
  listContent: {
    paddingHorizontal: 0,
  },

  // Banners
  pausedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginHorizontal: SP.md,
    marginBottom: SP.xs,
    backgroundColor: ORANGE_DIM,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: ORANGE + '44',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  pausedBannerText: {
    flex: 1,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: FG,
  },
  pausedBannerAction: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: ORANGE,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginHorizontal: SP.md,
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
    borderColor: BORDER_ACTIVE + '44',
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  errorRetryText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
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
    backgroundColor: CARD_GLASS,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
  },
  bulkBtnText: {
    fontSize: 10,
    fontFamily: FONT.semibold,
  },

  // Sort / filter modal
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
  sortOptionActive: {},
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
    backgroundColor: CARD_GLASS,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalCloseBtnText: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: MUTED,
  },
});
