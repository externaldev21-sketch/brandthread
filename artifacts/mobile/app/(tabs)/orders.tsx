import { Icon as Feather } from '@/components/ui/Icon';
/**
 * Brandthread — Seller Orders Tab
 * Shopify-pattern layout: persistent search row, status pills, date-grouped divider rows.
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePersistedChoice } from '@/hooks/usePersistedChoice';
import { getCachedTabData, setCachedTabData } from '@/lib/tabDataCache';
import { View, Text, ScrollView, FlatList, TouchableOpacity, StyleSheet, Alert, RefreshControl, Modal, Platform, Share } from 'react-native';

import { showActionSheet } from '@/components/ui/ActionSheet';

import { openPullDownMenu } from '@/lib/contextMenu';

import { FlashList } from '@shopify/flash-list';

import { Icon } from '@/components/ui/Icon';

import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { usePreloadedSceneEffect } from '@/hooks/usePreloadedSceneEffect';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptics, haptic } from '@/lib/haptics';


import { LinearGradient } from 'expo-linear-gradient';

import { FONT, FS, SP, RADIUS, ICON, ANIM } from '@/lib/theme';

import { useResponsive } from '@/hooks/useResponsive';

import { useIsWebShell } from '@/components/web/WebAppShell';

import OrderDetailScreen from '@/app/order-detail';
import { getOnAccentTextStyle, useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';

import { SellerListHeader, sellerListCountRowStyles } from '@/components/SellerListHeader';

import { orderEmptyCopy } from '@/lib/sellerLists/emptyCopy';

import { Button } from '@/components/ui/Button';

import { SkeletonBlock, EmptyState, useCenteredContentPadding } from '@/components/layout';

import { RetryRow } from '@/components/ui/RetryRow';

import { OrderStatusTimeline } from '@/components/orders/OrderStatusTimeline';

import { useTabBarClearance, useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';

import { filterOrders, sortOrders } from '@/services/orderService';

import { dbStatusToOrderStatus, dbStatusToPaymentStatus } from '@/lib/orderStatusAdapter';

import { Order, OrderFilterKey, OrderSortKey, OrderAddress, OrderCustomer, FulfillmentStatus, FulfillmentType, OrderStatus, PaymentStatus, CancellationReason, CANCELLATION_REASONS } from '@/services/orderTypes';

import { useApi } from '@/hooks/useApi';

import { useAuth } from '@clerk/expo';

import { clearBadge } from '@/lib/orderBadgeStore';

import { formatCents } from '@/lib/money';

import SwipeRow from '@/components/ui/SwipeRow';
import { exportCsvFile } from '@/lib/csvExport';
import { runBulk, summarizeBulk, ordersForExport, ordersToCsv } from '@/lib/orderBulk';
import { apiErrorMessage } from '@/lib/safety';
import { OptionSheet } from '@/components/ui/OptionSheet';
import SwipeActionRow from '@/components/SwipeActionRow';
import { SheetRise } from '@/components/motion/SheetRise';

import { useScrollReset } from '@/hooks/useScrollReset';

import { isSellerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';

import { allPreviewSellerOrders } from '@/lib/previewSellerOrders';

import { sellerCountdown } from '@/lib/deliveryGuarantee';

import { DeadlineChip } from '@/components/orders/SellerDelivery';
import { OrderStatusDot } from '@/components/orders/OrderStatusDot';
import { isOrderLate } from '@/lib/orderLate';
import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryClient';

import { prefetchOnPressIn } from '@/lib/prefetch';

import { seedDetailOnInteraction, type DetailSeedSnapshot } from '@/lib/seedDetailOnInteraction';

import { groupByLocalDate } from '@/lib/groupByLocalDate';

import { groupOrdersByRecency } from '@/lib/groupOrdersByRecency';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';

import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { tipTargetProps, useTipTarget } from '@/components/first-run-tips/tipTargets';

import { SELLER_ORDERS_GESTURE } from '@/lib/firstRunTips/content';
import { readSellerOrdersCache, saveSellerOrdersCache } from '@/lib/sellerOrdersCache';

import { useRealtimeEvents } from '@/lib/realtime/conversationRealtime';

import { useRouteIsFocused } from '@/hooks/useRouteIsFocused';

import { crispPx } from '@/lib/crispPixel';

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

/** One recyclable list row: a date header, an order, or the gap after a date group. */
type OrderListItem =
  | { type: 'header'; key: string; title: string; count: number }
  | { type: 'order'; key: string; order: Order; isLast: boolean }
  | { type: 'gap'; key: string };

/** Flattens date sections into rows so FlashList can recycle them by type. */
export function flattenOrderSections(sections: OrderSection[]): OrderListItem[] {
  const rows: OrderListItem[] = [];
  for (const section of sections) {
    rows.push({ type: 'header', key: `header:${section.title}`, title: section.title, count: section.data.length });
    section.data.forEach((order, index) => {
      rows.push({ type: 'order', key: order.id, order, isLast: index === section.data.length - 1 });
    });
    rows.push({ type: 'gap', key: `gap:${section.title}` });
  }
  return rows;
}

type OrderRowActions = {
  press: (order: Order) => void;
  pressIn: (order: Order) => void;
  longPress: (orderId: string) => void;
  ship: (orderId: string) => void;
};

type OrderListFilter = OrderFilterKey | 'unpaid' | 'open' | 'archived';
type OrderListOrder = Order & {
  listItemCount?: number;
  listItemLabel?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
function fmtDate(iso: string): string { return dateFormatter.format(new Date(iso)); }

function fmtTime(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

function fmtMoney(cents: number): string {
  return formatCents(cents);
}

export function getCancellationReasonLabel(reason: string): string {
  if (reason === 'not_delivered_in_time') return 'Not delivered in time';
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

/** Group a sorted order list into Today / This week / Earlier sections. */
function groupByDate(orders: Order[]): OrderSection[] {
  return groupOrdersByRecency(orders);
}

// ─── API → Order adapter ──────────────────────────────────────────────────────
// Status and payment-status mapping is shared with order-detail.tsx via
// lib/orderStatusAdapter.ts so this list can never disagree with the detail
// screen about whether an order is new, delivered, refunded or disputed.

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

/** A GET /api/orders list row (only the fields read here). */
export interface SellerOrderListRow {
  id: string;
  orderNumber?: string | null;
  status?: string | null;
  paidAt?: string | Date | null;
  customerName?: string | null;
  customerEmail?: string | null;
  totalCents?: number | null;
  cancellationReason?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  isPreorder?: boolean | null;
  deliverBy?: string | null;
  promisedShipDate?: string | null;
  deliveredAt?: string | null;
  autoRefundedAt?: string | null;
  disputePausedAt?: string | null;
  itemCount?: unknown;
  dropName?: unknown;
  createdAt: string | number | Date;
  updatedAt: string | number | Date;
}

export function apiRowToOrder(row: SellerOrderListRow): OrderListOrder {
  const ordStatus: OrderStatus = dbStatusToOrderStatus(row.status as string);
  const rowPaymentStatus: PaymentStatus = dbStatusToPaymentStatus(row.status as string, row.paidAt) as PaymentStatus;
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
    status: ordStatus, paymentStatus: rowPaymentStatus,
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
    hasUnreadMessage: false, isPreOrder: row.isPreorder === true, isManufacturerFulfilled: false,
    deliverBy: row.deliverBy ?? null,
    promisedShipDate: row.promisedShipDate ?? null,
    deliveredAt: row.deliveredAt ?? null,
    autoRefundedAt: row.autoRefundedAt ?? null,
    disputePausedAt: row.disputePausedAt ?? null,
    paidAt: row.paidAt ? (typeof row.paidAt === 'string' ? row.paidAt : new Date(row.paidAt).toISOString()) : null,
    currency: 'USD', tags: [],
    listItemCount: typeof row.itemCount === 'number' && Number.isSafeInteger(row.itemCount) && row.itemCount >= 0 ? row.itemCount : undefined,
    listItemLabel: typeof row.dropName === 'string' && row.dropName.trim() ? row.dropName.trim() : undefined,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date(row.createdAt).toISOString(),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date(row.updatedAt).toISOString(),
  };
}

// ─── Filter Config ────────────────────────────────────────────────────────────

const FILTERS: { key: OrderListFilter; label: string }[] = [
  { key: 'all',        label: 'All' },
  { key: 'unfulfilled', label: 'To ship' },
  { key: 'unpaid',     label: 'Unpaid' },
  { key: 'open',       label: 'Open' },
  { key: 'archived',   label: 'Archived' },
];

// Every filter the list understands (chips + the filter sheet) — used to
// restore the last pick across launches.
const ORDER_LIST_FILTER_KEYS: OrderListFilter[] = ['all', 'new', 'unfulfilled', 'processing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'unpaid', 'open', 'archived'];

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
  { key: 'unfulfilled', label: 'To ship' },
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

// Payment states that mean the buyer hasn't paid yet (mirrors lib/orderStatusDot.ts).
const UNPAID_FOR_SHIP: ReadonlySet<string> = new Set(['pending', 'authorized', 'failed']);

/**
 * Ship is offered on every paid order that hasn't shipped. A new paid order
 * doesn't need "Mark processing" first: the server ships (or buys a label for)
 * a pending order directly, so Ship goes straight to packing.
 */
export function canShipFromList(order: Pick<Order, 'status' | 'paymentStatus'>): boolean {
  if (order.status === 'processing' || order.status === 'ready_to_ship') return true;
  return order.status === 'new' && !UNPAID_FOR_SHIP.has(order.paymentStatus);
}

interface OrderRowProps {
  order: OrderListOrder;
  selected: boolean;
  selectionMode: boolean;
  onPress: () => void;
  onPressIn?: () => void;
  onLongPress: () => void;
  onShip: () => void;
  isLast?: boolean;
}

export function OrderRow({
  order, selected, selectionMode, onPress, onPressIn, onLongPress,
  onShip, isLast = false,
}: OrderRowProps) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const { text: FG, error: RED, muted: MUTED, border: BORDER, borderSubtle: BORDER_ACTIVE } = theme;
  const STRONG = theme.text, DIM = `${theme.text}14`, RED_DIM = `${theme.error}22`;
  const isHighRisk = order.riskLevel === 'high';
  const hasReturn = order.returns.length > 0;
  const hasDispute = order.disputes.length > 0;
  const isArchived = order.status === 'cancelled';
  // Deadline chip: only while there is still something to ship (or once auto-refunded).
  const countdown = sellerCountdown(order, order.status === 'shipped' || order.status === 'delivered');

  const firstItem = order.lineItems[0];
  const itemCount = order.listItemCount ?? order.lineItems.length;
  const moreCount = Math.max(0, itemCount - 1);
  const itemLabel = firstItem
    ? moreCount > 0
      ? `${firstItem.productName} +${moreCount}`
      : firstItem.productName
    : order.listItemLabel ?? (itemCount > 0 ? `${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : 'No items');

  return (
    <>
      <View style={[s.orderCard, selected && s.orderRowSelected, isHighRisk && s.orderRowRisk, isArchived && s.orderRowArchived]}>
      <TouchableOpacity
        activeOpacity={0.86}
        onPress={onPress}
        onPressIn={onPressIn}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={`Order ${order.orderNumber}, ${order.customer.name}, ${fmtMoney(order.payment.totalCents)}`}
      >
        {/* Selection checkbox */}
        {selectionMode && (
          <View style={[s.selBox, selected && s.selBoxActive]}>
            {selected && <Icon name="check" size={10} color={theme.background} />}
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
                  <Icon name="alert-triangle" size={9} color={RED} />
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
            {countdown && <View style={{ marginTop: 4 }}><DeadlineChip countdown={countdown} /></View>}
          </View>
        </View>

      </TouchableOpacity>
        {/* Status pills row */}
        <View style={s.orderStatusRow}>
          <TouchableOpacity
            onPress={onPress}
            onPressIn={onPressIn}
            onLongPress={onLongPress}
            accessibilityRole="button"
            accessibilityLabel={`View status for order ${order.orderNumber}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: SP.xs }}
          >
          <OrderStatusDot
            status={order.status}
            paymentStatus={order.paymentStatus}
            late={isOrderLate(order)}
            testID={`order-status-${order.id}`}
          />
          {order.isPreOrder && (
            <View style={s.tagPill}>
              <Text style={s.tagText}>PRE-ORDER</Text>
            </View>
          )}
          {order.isManufacturerFulfilled && (
            <View style={[s.tagPill, { borderColor: STRONG + '44', backgroundColor: DIM }]}>
              <Text style={[s.tagText, { color: STRONG }]}>MFG</Text>
            </View>
          )}

          {/* Quick action — pushed right */}
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {canShipFromList(order) && (
            <Button
              label="Ship"
              icon="send"
              variant="primary"
              size="compact"
              style={s.quickAction}
              onPress={e => { e?.stopPropagation?.(); onShip(); }}
              accessibilityLabel={`Ship order ${order.orderNumber}`}
            />
          )}
          {order.status === 'shipped' && order.shipments[0] && (
            <View style={s.trackingPill}>
              <Icon name="truck" size={10} color={STRONG} />
              <Text style={s.trackingText}>
                {order.shipments[0].carrier} · {order.shipments[0].trackingNumber?.slice(-6)}
              </Text>
            </View>
          )}
        </View>

        {/* Live status tracker — compact stepper mirrors the buyer + detail screens */}
        <View style={s.cardTimelineWrap}>
          <OrderStatusTimeline status={order.status} compact />
        </View>
      </View>
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
  const { theme } = useAppTheme();
  const STRONG = theme.text;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close sort menu" />
      <SheetRise style={s.modalSheet}>
        <View style={s.modalHandle} />
        <Text style={s.modalTitle}>Sort Orders</Text>
        {SORTS.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[s.sortOption, current === key && s.sortOptionActive]}
            onPress={() => { haptic('select'); onSelect(key); onClose(); }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={`Sort by ${label}`}
          >
            <Text style={[s.sortOptionText, current === key && s.sortOptionTextActive]}>
              {label}
            </Text>
            {current === key && <Icon name="check" size={ICON.sm} color={STRONG} />}
          </TouchableOpacity>
        ))}
        <Button label="Cancel" variant="secondary" fullWidth style={s.modalCloseBtn} onPress={onClose} accessibilityLabel="Cancel sorting" />
      </SheetRise>
    </Modal>
  );
}

// ─── Filter Sheet ─────────────────────────────────────────────────────────────

// One filter control for the list (Depop's shop filter sheet): "Sort by"
// lives here instead of behind a second icon button in the header.
function FilterSheet({
  visible, current, onSelect, currentSort, onSelectSort, onClose,
}: {
  visible: boolean;
  current: OrderFilterKey;
  onSelect: (k: OrderFilterKey) => void;
  currentSort: OrderSortKey;
  onSelectSort: (k: OrderSortKey) => void;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const STRONG = theme.text;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close filter menu" />
      <SheetRise style={s.modalSheet}>
        <View style={s.modalHandle} />
        <Text style={s.modalTitle}>Filter Orders</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 480 }}>
          <Text style={s.filterSectionLabel}>Sort by</Text>
          {SORTS.map(({ key, label }) => (
            <TouchableOpacity
              key={`sort-${key}`}
              style={[s.sortOption, currentSort === key && s.sortOptionActive]}
              onPress={() => { haptic('select'); onSelectSort(key); onClose(); }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Sort by ${label}`}
            >
              <Text style={[s.sortOptionText, currentSort === key && s.sortOptionTextActive]}>
                {label}
              </Text>
              {currentSort === key && <Feather name="check" size={ICON.sm} color={STRONG} />}
            </TouchableOpacity>
          ))}
          <Text style={[s.filterSectionLabel, { marginTop: SP.md }]}>Status</Text>
          {ALL_FILTERS.map(({ key, label }) => (
            <TouchableOpacity
              key={key}
              style={[s.sortOption, current === key && s.sortOptionActive]}
              onPress={() => { haptic('select'); onSelect(key); onClose(); }}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Filter orders by ${label}`}
            >
              <Text style={[s.sortOptionText, current === key && s.sortOptionTextActive]}>
                {label}
              </Text>
              {current === key && <Icon name="check" size={ICON.sm} color={STRONG} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Button label="Cancel" variant="secondary" fullWidth style={s.modalCloseBtn} onPress={onClose} accessibilityLabel="Cancel filtering" />
      </SheetRise>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

/**
 * A memoized order row plus its swipe action. Handlers arrive as one stable
 * object, so scrolling or polling does not re-render rows whose order and
 * selection state are unchanged.
 */
const OrderListRow = React.memo(function OrderListRow({
  order, isLast, selected, selectionMode, actions, current = false, tipTarget = false,
}: {
  order: Order;
  isLast: boolean;
  selected: boolean;
  selectionMode: boolean;
  actions: OrderRowActions;
  /** iPad split: the order shown in the detail pane (white outline, like Shopify iPad's selected row). */
  current?: boolean;
  /** First-run tip: measure this row (measurement only). */
  tipTarget?: boolean;
}) {
  const { theme } = useAppTheme();
  // Orders are automatic (paid orders arrive as "To ship"), so the only useful
  // swipe is Ship, which opens the fulfil / label flow. Neutral, never coloured.
  const swipeAction = canShipFromList(order)
    ? { label: 'Ship', icon: 'send' as const, run: () => actions.ship(order.id) }
    : { label: 'Open', icon: 'arrow-right' as const, run: () => actions.press(order) };

  return (
    // Apple Mail swipe: the action sits on the right; a full swipe runs it.
    <SwipeRow
      rowId={order.id}
      disabled={selectionMode}
      trailing={[{
        key: swipeAction.label.toLowerCase(),
        label: swipeAction.label,
        icon: swipeAction.icon,
        onPress: swipeAction.run,
        accessibilityLabel: `${swipeAction.label} order ${order.orderNumber}`,
      }]}
    >
      <View {...(tipTarget ? tipTargetProps('seller-orders') : null)} style={current ? { borderRadius: RADIUS.lg, borderWidth: 1.5, borderColor: theme.text } : undefined} accessibilityState={current ? { selected: true } : undefined}>
        <OrderRow
          order={order}
          selected={selected}
          selectionMode={selectionMode}
          onPress={() => actions.press(order)}
          onPressIn={() => actions.pressIn(order)}
          onLongPress={() => actions.longPress(order.id)}
          onShip={() => actions.ship(order.id)}
          isLast={isLast}
        />
      </View>
    </SwipeRow>
  );
});

// ─── Order card skeleton — matches OrderRow's card shape: order # row,
// customer + item lines, price/time, status pills, then the timeline strip ──
function SellerOrderRowSkeleton() {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        paddingHorizontal: SP.md,
        paddingVertical: SP.md,
        marginHorizontal: SP.md,
        marginBottom: SP.sm,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: theme.border,
        backgroundColor: theme.card,
        gap: SP.xs,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <View style={{ gap: SP.xs, flex: 1 }}>
          <SkeletonBlock width={90} height={13} />
          <SkeletonBlock width="45%" height={13} />
          <SkeletonBlock width="65%" height={11} />
        </View>
        <View style={{ alignItems: 'flex-end', gap: SP.xs }}>
          <SkeletonBlock width={56} height={13} />
          <SkeletonBlock width={40} height={11} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: SP.xs, marginTop: SP.xs }}>
        <SkeletonBlock width={64} height={16} radius={RADIUS.pill} />
        <SkeletonBlock width={72} height={16} radius={RADIUS.pill} />
      </View>
      <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: SP.sm, paddingTop: SP.sm, borderTopWidth: 1, borderTopColor: theme.border }}>
        {Array.from({ length: 5 }).map((_, i) => <SkeletonBlock key={i} width={10} height={10} radius={RADIUS.pill} />)}
      </View>
    </View>
  );
}

function SellerOrdersListSkeleton() {
  return (
    <View style={{ paddingTop: SP.sm }}>
      {Array.from({ length: 6 }).map((_, i) => <SellerOrderRowSkeleton key={i} />)}
    </View>
  );
}

/** iPad split view: on at >= 900pt (iPad landscape, 12.9" portrait); list column width. */
const SPLIT_MIN_WIDTH = 900;
const SPLIT_LIST_WIDTH = 400;

export default function OrdersScreen() {
  const scrollResetRef = useScrollReset<any>(true, false);
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const { background: BG, surface: SCREEN_BG, text: FG, muted: MUTED, subtle: SUBTLE, error: RED, border: BORDER, borderSubtle: BORDER_ACTIVE, card: CARD, cardElevatedGlass: CARD_ELEVATED_GLASS } = theme;
  const STRONG = theme.text, DIM = `${theme.text}14`, RED_DIM = `${theme.error}22`, CARD_GLASS = theme.cardGlass, SURFACE = theme.surface;
  const palette = theme as typeof theme & Record<string, string>;
  const { width: windowWidth, isTablet } = useResponsive();
  // Not inside the web preview's centred 640pt column (components/web/WebAppShell).
  const isWebShell = useIsWebShell();
  const splitCapable = isTablet && !isWebShell && windowWidth >= SPLIT_MIN_WIDTH;
  const [splitOrderId, setSplitOrderId] = useState<string | null>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  // Extra centering padding beyond each row's own SP.md gutter — 0 on phone,
  // grows on iPad so the list doesn't stretch edge to edge.
  const centeredPad = Math.max(0, useCenteredContentPadding() - SP.md);
  const tabBarMetrics = useTabBarMetrics();
  const tabBarClearance = useTabBarClearance(2); // seller bar: Studio + AI side circles

  const api = useApi();
  const queryClient = useQueryClient();
  const { userId, isLoaded: authLoaded, isSignedIn } = useAuth();
  // ?bt_preview=seller (web design-preview bypass, app/_layout.tsx): renders
  // this screen without ever waiting for Clerk to load or sign in, so
  // authLoaded/isSignedIn/userId can legitimately stay false/null forever —
  // that is not "still loading", it is the deliberate no-account preview
  // state. Gating the fetch/loading state on real auth in that state is
  // exactly what produced an infinite skeleton (never resolves because
  // isSignedIn never becomes true). Evaluated once: bt_preview doesn't
  // change during a session.
  const [isPreviewMode] = useState(() => isSellerDevPreview());

  // Deep-link support: /(tabs)/orders?filter=unfulfilled opens pre-filtered
  // (e.g. from the dashboard's "N orders to ship" row) instead of always
  // landing on the unfiltered "All" list.
  const params = useLocalSearchParams<{ filter?: string }>();
  const initialFilter = ((): OrderListFilter => {
    const requested = params.filter;
    const valid: OrderListFilter[] = ['all', 'new', 'unfulfilled', 'processing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'unpaid', 'open', 'archived'];
    return valid.includes(requested as OrderListFilter) ? (requested as OrderListFilter) : 'all';
  })();

  // Seed from the last list this account loaded (this session, or the
  // app-start warmer's 'seller-orders' entry) so the tab paints its rows on
  // frame one; the focus poll below still refreshes them in the background
  // and the skeleton only ever shows while `orders` is empty.
  const seedRows = (() => {
    if (!userId) return null;
    const cached = getCachedTabData<unknown[]>('seller-orders');
    return Array.isArray(cached) && cached.length > 0 ? cached : null;
  })();
  const [orders, setOrders] = useState<OrderListOrder[]>(() => (seedRows ? (seedRows as any[]).map(apiRowToOrder) : []));
  // Split only once there are orders; with none, the list's empty state keeps the full width.
  const splitView = splitCapable && orders.length > 0;
  // In the split the list owns a fixed column, so no tablet centring inside it.
  const listSidePad = splitView ? 0 : centeredPad;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatesPaused, setUpdatesPaused] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = usePersistedChoice<OrderListFilter>(
    'seller-orders.filter', initialFilter, ORDER_LIST_FILTER_KEYS, { restore: !params.filter },
  );
  const [sort, setSort] = useState<OrderSortKey>('newest');
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [stats, setStats] = useState<OrderStats | null>(() => (orders.length > 0 ? computeStats(orders) : null));
  const [ordersOwnerId, setOrdersOwnerId] = useState<string | null>(() => (orders.length > 0 ? userId ?? null : null));

  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);
  const requestGenerationRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);
  const detailSeedRef = useRef<DetailSeedSnapshot | null>(null);

  const loadData = useCallback(async (generation: number) => {
    // Design-preview bypass with no real signed-in account: there is no
    // token to fetch real orders with, and there never will be (Clerk was
    // never awaited — see app/_layout.tsx's PREVIEW_ROLE bypass). This is
    // not a connectivity failure, so it resolves straight to the honest
    // empty state rather than the "couldn't load" retry banner a real
    // fetch failure shows.
    if (isPreviewMode) {
      // Preview never calls the orders API (a stubbed session would only get
      // a 401). Demo mode lists the same order set the dashboard's numbers
      // are summed from (lib/previewSellerOrders.ts); fresh mode is empty.
      const rows = isPreviewDemoMode() ? allPreviewSellerOrders() : [];
      const preview = rows.map(apiRowToOrder);
      if (generationRef.current === generation) {
        detailSeedRef.current = {
          ownerId: userId ?? null,
          rows: new Map(rows.map(raw => [raw.id, raw])),
        };
        setOrders(preview);
        setOrdersOwnerId(userId ?? null);
        setStats(computeStats(preview));
        setLoadError(false);
        setLoading(false);
        setRefreshing(false);
        hasLoadedRef.current = true;
      }
      return;
    }
    if (!authLoaded || !isSignedIn || !userId) return;
    if (requestGenerationRef.current === generation) return;
    const requestOwnerId = userId;
    requestGenerationRef.current = generation;
    // Offline: paint the last list this account loaded while the request
    // runs, so a cold start with no connection still shows real orders.
    if (!hasLoadedRef.current) {
      const cachedRows = await readSellerOrdersCache<any>();
      if (cachedRows && generationRef.current === generation && !hasLoadedRef.current) {
        const cached = cachedRows.map(apiRowToOrder);
        detailSeedRef.current = {
          ownerId: requestOwnerId,
          rows: new Map(cachedRows.filter(raw => !!raw?.id).map(raw => [raw.id, raw])),
        };
        setOrders(cached);
        setOrdersOwnerId(requestOwnerId);
        setStats(computeStats(cached));
        setLoading(false);
      }
    }
    try {
      const rows = await api.orders.list();
      if (generationRef.current !== generation) return;
      const all = Array.isArray(rows) ? (rows as SellerOrderListRow[]).map(apiRowToOrder) : [];
      saveSellerOrdersCache(rows);
      setOrders(all);
      if (Array.isArray(rows)) setCachedTabData('seller-orders', rows);
      // Keep the raw snapshot outside the shared cache. Seed only the tapped
      // order; hundreds of cache updates synchronously dehydrate the cache
      // hundreds of times, despite throttled AsyncStorage writes.
      detailSeedRef.current = {
        ownerId: requestOwnerId,
        rows: new Map((rows as { id: string }[]).filter(raw => !!raw.id).map(raw => [raw.id, raw])),
      };
      setOrdersOwnerId(requestOwnerId);
      setStats(computeStats(all));
      setUpdatesPaused(false);
      setLoadError(false);
      consecutiveFailuresRef.current = 0;
    } catch (e) {
      if (generationRef.current !== generation) return;
      if (__DEV__) console.warn('[seller-orders] refresh failed; keeping last known orders', e);
      // Never clear the list or show a fake empty state on a fetch failure —
      // keep whatever orders we already had and surface a retry banner.
      setOrdersOwnerId(requestOwnerId);
      setLoadError(true);
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
  }, [api, authLoaded, isPreviewMode, isSignedIn, userId, queryClient]);

  // Re-apply the ?filter= deep link every time this screen is focused (not
  // just on first mount) — the seller tab bar keeps this screen mounted, so
  // tapping the dashboard's "N orders to ship" row a second time needs to
  // re-apply the filter even though Orders never unmounted.
  useFocusEffect(
    useCallback(() => {
      const requested = params.filter;
      const valid: OrderListFilter[] = ['all', 'new', 'unfulfilled', 'processing', 'ready_to_ship', 'shipped', 'delivered', 'cancelled', 'unpaid', 'open', 'archived'];
      if (requested && valid.includes(requested as OrderListFilter)) {
        setActiveFilter(requested as OrderListFilter);
        // Consume the deep link so a plain return to this tab keeps the
        // seller's own filter instead of re-forcing the link's (see
        // products.tsx).
        router.setParams({ filter: undefined } as never);
      }
    }, [params.filter, router]),
  );

  // Pre-mounted by the tab preloader: one read so the first visit paints the
  // list. Badge clearing and the 30s poll stay with the real visit below.
  usePreloadedSceneEffect(() => {
    if (!isPreviewMode && (!authLoaded || !isSignedIn || !userId)) return;
    void loadData(++generationRef.current);
  });

  useFocusEffect(
    useCallback(() => {
      // In the design-preview bypass, real auth may never resolve (see
      // isPreviewMode above) — that's the deliberate no-account state, not
      // "still loading", so it must not block loadData the way waiting on
      // a real account does.
      if (!isPreviewMode && (!authLoaded || !isSignedIn || !userId)) {
        setLoading(true);
        return undefined;
      }
      if (userId) clearBadge(userId);
      const generation = ++generationRef.current;
      consecutiveFailuresRef.current = 0;
      setUpdatesPaused(false);
      if (!hasLoadedRef.current) setLoading(true);
      loadData(generation);
      // Preview mode resolves once, synchronously, in loadData above — no
      // real backend to poll every 30s (even with a stubbed signed-in user).
      if (!isPreviewMode) {
        timerRef.current = setInterval(() => loadData(generation), 30_000);
      }
      return () => {
        if (timerRef.current !== null) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }, [authLoaded, isPreviewMode, isSignedIn, loadData, userId])
  );

  // Safety net for a real race: useFocusEffect above only re-runs its
  // callback on an actual navigation focus event — it does NOT re-run
  // merely because authLoaded/isSignedIn/userId changed while this tab was
  // already focused (e.g. this tab is focused at cold start, before
  // Clerk's async `isLoaded` flips true). If that happens, the effect
  // above sets loading=true and returns, and — since a tab screen never
  // unmounts and no further focus event follows — nothing else ever calls
  // loadData: the skeleton spins forever (item 127). This plain effect
  // closes that one gap: it only fires once auth has just become ready and
  // nothing has loaded yet, so it never duplicates the normal focus-driven
  // poll once that has started.
  useEffect(() => {
    if (!authLoaded || !isSignedIn || !userId) return;
    if (hasLoadedRef.current || timerRef.current !== null) return;
    clearBadge(userId);
    const generation = ++generationRef.current;
    consecutiveFailuresRef.current = 0;
    setUpdatesPaused(false);
    setLoading(true);
    loadData(generation);
    timerRef.current = setInterval(() => loadData(generation), 30_000);
  }, [authLoaded, isSignedIn, loadData, userId]);

  // Realtime: a new order or any status change (checkout, webhooks, jobs —
  // api-server lib/orderChangeListener.ts) refreshes the list right away.
  // The 30s poll above stays as the fallback. While Orders is on screen the
  // new-order badge stays cleared.
  const ordersFocused = useRouteIsFocused();
  useRealtimeEvents((event) => {
    if (event.type !== 'order.created' && event.type !== 'order.updated') return;
    if (!hasLoadedRef.current) return;
    if (ordersFocused && userId && event.type === 'order.created') clearBadge(userId);
    loadData(generationRef.current);
  }, !isPreviewMode && !!isSignedIn && !!userId);

  // Hard backstop: whatever the cause — a real load that's taking unusually
  // long, an auth or network edge case neither guard above anticipated —
  // the skeleton must never spin indefinitely. If nothing has resolved
  // `loading` within 1.5s of it turning true, fall through to whatever
  // state that leaves (the real empty state when `orders` is still empty,
  // or the existing list/error state otherwise) instead of an infinite
  // skeleton. A real, fast load always resolves well before this fires, so
  // in the normal case this timer is cleared long before it would run.
  useEffect(() => {
    if (!loading) return undefined;
    const timeout = setTimeout(() => {
      setLoading(false);
      hasLoadedRef.current = true;
    }, 1500);
    return () => clearTimeout(timeout);
  }, [loading]);

  const retryUpdates = useCallback(() => {
    const generation = generationRef.current;
    consecutiveFailuresRef.current = 0;
    setUpdatesPaused(false);
    if (timerRef.current === null) {
      timerRef.current = setInterval(() => loadData(generation), 30_000);
    }
    loadData(generation);
  }, [loadData]);

  const onRefresh = useCallback(() => {
    haptic('refresh');
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

  // Date-grouped sections, flattened into recyclable rows
  const sections = useMemo(() => groupByDate(filtered), [filtered]);
  const listRows = useMemo(() => flattenOrderSections(sections), [sections]);
  // First-run tip target: the first order row actually listed (measurement only).
  const firstListedOrderId = useMemo(() => {
    for (const row of listRows) if (row.type === 'order') return row.order.id;
    return null;
  }, [listRows]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // ─── Actions ───────────────────────────────────────────────────────────────

  const handleShip = useCallback((orderId: string) => {
    router.push(('/fulfill-order?orderId=' + orderId) as never);
  }, [router]);

  const handleBulkFulfill = useCallback(() => {
    router.push(('/fulfill-batch?orderIds=' + selectedIds.join(',')) as never);
  }, [router, selectedIds]);

  const handleCardPress = useCallback((order: Order) => {
    if (selectedIds.length > 0) {
      setSelectedIds(prev =>
        prev.includes(order.id) ? prev.filter(id => id !== order.id) : [...prev, order.id]
      );
    } else {
      seedDetailOnInteraction(queryClient, queryKeys.order(order.id), order.id, detailSeedRef.current, userId ?? null);
      if (splitView) setSplitOrderId(order.id);
      else router.push(('/order-detail?id=' + order.id) as never);
    }
  }, [selectedIds, router, queryClient, userId, splitView]);

  // Fires ~100-200ms before onPress (finger-down vs. finger-up): warms the
  // query cache order-detail.tsx reads on mount, so by the time the tap
  // completes and the screen mounts, its data is often already there.
  const handleCardPressIn = useCallback((order: Order) => {
    if (selectedIds.length > 0) return;
    if (seedDetailOnInteraction(queryClient, queryKeys.order(order.id), order.id, detailSeedRef.current, userId ?? null)) return;
    prefetchOnPressIn(
      queryClient,
      queryKeys.order(order.id),
      () => api.orders.get(order.id),
    )();
  }, [selectedIds, queryClient, api, userId]);

  const handleLongPress = useCallback((orderId: string) => {
    setSelectedIds(prev =>
      prev.includes(orderId) ? prev.filter(id => id !== orderId) : [...prev, orderId]
    );
  }, []);

  // Runs one existing per-order endpoint over the selection and reports
  // exactly which orders failed (and why) instead of a blanket error.
  const runBulkAction = useCallback(async (actionLabel: string, fn: (id: string) => Promise<unknown>) => {
    if (isPreviewMode) {
      Alert.alert('Sign in to continue', 'Bulk actions need a signed-in seller account.');
      return;
    }
    haptic('select');
    const byId = new Map(orders.map(o => [o.id, o]));
    const result = await runBulk(selectedIds, fn, {
      label: id => byId.get(id)?.orderNumber ?? id.slice(0, 8),
      errorMessage: e => apiErrorMessage(e, 'Request failed'),
    });
    // Keep the failed orders selected so the seller can retry or inspect them.
    setSelectedIds(result.failed.map(f => f.id));
    const summary = summarizeBulk(result, actionLabel);
    if (summary) Alert.alert(summary.title, summary.message);
    await loadData(generationRef.current);
  }, [isPreviewMode, orders, selectedIds, loadData]);

  const handleBulkMarkReady = useCallback(() => {
    void runBulkAction('mark orders ready', id => api.orders.updateStatus(id, 'fulfilled'));
  }, [api, runBulkAction]);

  const handleBulkMarkProcessing = useCallback(() => {
    void runBulkAction('mark orders processing', id => api.orders.updateStatus(id, 'processing'));
  }, [api, runBulkAction]);

  const handleBulkMarkPacked = useCallback(() => {
    void runBulkAction('mark orders packed', id => api.orders.updateFulfillmentChecklist(id, { isPicked: true, isPacked: true }));
  }, [api, runBulkAction]);

  const handleExportCsv = useCallback(async () => {
    try {
      const visibleOrders = ordersOwnerId === userId ? orders : [];
      // With a selection, export just the selected orders.
      const toExport = ordersForExport(visibleOrders, selectedIds);
      if (toExport.length === 0) {
        Alert.alert('Nothing to export', 'There are no orders to export yet.');
        return;
      }
      const csv = ordersToCsv(toExport, formatCents);
      const shared = await exportCsvFile('orders', csv, 'Export orders');
      if (!shared) Alert.alert('Export saved', 'Sharing is not available on this device.');
    } catch {
      Alert.alert('Export failed', 'Could not export orders. Please try again.');
    }
  }, [orders, ordersOwnerId, userId, selectedIds]);

  // OptionSheet rather than an Alert button list: Android alerts show at
  // most three buttons.
  const [bulkSheetVisible, setBulkSheetVisible] = useState(false);
  const handleBulkMenu = useCallback(() => setBulkSheetVisible(true), []);
  const bulkOptions = useMemo(() => {
    const selectAll = { id: 'select_all', label: `Select all shown (${filtered.length})`, icon: 'check-square' as const };
    if (selectedIds.length === 0) return [selectAll];
    return [
      { id: 'processing', label: 'Mark processing', icon: 'clock' as const },
      { id: 'packed', label: 'Mark packed', icon: 'box' as const },
      { id: 'ready', label: 'Mark ready to ship', icon: 'package' as const },
      { id: 'ship', label: 'Ship (add tracking or buy labels)', icon: 'send' as const },
      { id: 'export', label: 'Export selected (CSV)', icon: 'download' as const },
      selectAll,
      { id: 'clear', label: 'Clear selection', icon: 'x' as const },
    ];
  }, [filtered.length, selectedIds.length]);
  const handleBulkOption = useCallback((id: string) => {
    setBulkSheetVisible(false);
    switch (id) {
      case 'select_all': setSelectedIds(filtered.map(o => o.id)); break;
      case 'processing': handleBulkMarkProcessing(); break;
      case 'packed': handleBulkMarkPacked(); break;
      case 'ready': handleBulkMarkReady(); break;
      case 'ship': handleBulkFulfill(); break;
      case 'export': void handleExportCsv(); break;
      case 'clear': setSelectedIds([]); break;
    }
  }, [filtered, handleBulkMarkProcessing, handleBulkMarkPacked, handleBulkMarkReady, handleBulkFulfill, handleExportCsv]);

  const handleMoreMenu = useCallback((event?: unknown) => {
    openPullDownMenu(event, [
      { label: 'Returns', icon: 'corner-up-left', onPress: () => setActiveFilter('returned') },
      { label: selectedIds.length ? `Export selected (${selectedIds.length})` : 'Export CSV', icon: 'download', onPress: handleExportCsv },
      { label: 'Bulk Actions', icon: 'check-square', onPress: handleBulkMenu },
      { label: 'Refresh', icon: 'refresh-cw', onPress: onRefresh },
    ]);
  }, [onRefresh, handleExportCsv, handleBulkMenu, selectedIds.length]);

  // ─── Render helpers ────────────────────────────────────────────────────────

  const hasActiveFilter = activeFilter !== 'all';
  // Search, filter and status chips only once there is something to search or
  // filter (Shopify's empty Orders screen is just the title + empty state).
  const hasAnyOrders = loading || orders.length > 0 || activeFilter !== 'all' || searchQuery.trim().length > 0;
  const currentSortLabel = SORTS.find(s => s.key === sort)?.label ?? 'Sort';

  // Row handlers go through a ref so every row receives the same function
  // identities; memoized rows then re-render only when their own order or
  // selection state changes.
  const actionsRef = useRef<OrderRowActions>({
    press: handleCardPress,
    pressIn: handleCardPressIn,
    longPress: handleLongPress,
    ship: handleShip,
  });
  actionsRef.current = {
    press: handleCardPress,
    pressIn: handleCardPressIn,
    longPress: handleLongPress,
    ship: handleShip,
  };
  const rowActions = useMemo<OrderRowActions>(() => ({
    press: (order) => actionsRef.current.press(order),
    pressIn: (order) => actionsRef.current.pressIn(order),
    longPress: (orderId) => actionsRef.current.longPress(orderId),
    ship: (orderId) => actionsRef.current.ship(orderId),
  }), []);

  const selectionMode = selectedIds.length > 0;
  const sellerOrdersTipTarget = useTipTarget('seller-orders');
  const renderItem = useCallback(({ item }: { item: OrderListItem }) => {
    if (item.type === 'header') {
      return (
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>{item.title}</Text>
          <Text style={s.sectionCount}>{item.count} {item.count === 1 ? 'order' : 'orders'}</Text>
        </View>
      );
    }
    if (item.type === 'gap') return <View style={{ height: SP.sm }} />;
    return (
      <OrderListRow
        order={item.order}
        isLast={item.isLast}
        selected={selectedIdSet.has(item.order.id)}
        selectionMode={selectionMode}
        actions={rowActions}
        current={splitView && item.order.id === (splitOrderId ?? orders[0]?.id)}
        tipTarget={item.order.id === firstListedOrderId}
      />
    );
  }, [s, selectedIdSet, selectionMode, rowActions, splitView, splitOrderId, orders, firstListedOrderId]);

  const keyExtractor = useCallback((row: OrderListItem) => row.key, []);
  const getItemType = useCallback((row: OrderListItem) => row.type, []);

  // Belt-and-suspenders alongside contentContainerStyle's paddingBottom below:
  // FlashList's web renderer doesn't always honor a large contentContainerStyle
  // bottom padding, letting the last row sit under the floating tab bar — a
  // real DOM footer of that height guarantees the scrollable area actually
  // extends past the bar.
  const ListFooterComponent = useCallback(
    () => <View style={{ height: tabBarMetrics.occupiedHeight }} />,
    [tabBarMetrics.occupiedHeight],
  );

  const ListHeaderComponent = useCallback(() => (
    <View style={s.listHeader}>
      {(loadError || updatesPaused) && (
        <View style={s.retryBannerWrap}>
          <RetryRow label="Couldn't refresh orders" onRetry={onRefresh} />
        </View>
      )}
      {/* Results count — omitted on an empty list; the empty state below
          already says there's nothing, so "0 orders" next to it is clutter. */}
      {filtered.length > 0 && (
        <View style={[sellerListCountRowStyles.row, { paddingTop: 0 }]}>
          <Text style={[sellerListCountRowStyles.text, { color: SUBTLE }]}>
            {filtered.length} {filtered.length === 1 ? 'order' : 'orders'}
            {activeFilter !== 'all'
              ? ` · ${FILTERS.find(f => f.key === activeFilter)?.label ?? ALL_FILTERS.find(f => f.key === activeFilter)?.label}`
              : ''}
          </Text>
          {sort !== 'newest' && (
            <TouchableOpacity onPress={() => setFilterSheetVisible(true)} accessibilityRole="button" accessibilityLabel={`Current sort: ${currentSortLabel}. Change sort`}>
              <Text style={s.sortIndicator}>{currentSortLabel} ↕</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  ), [filtered.length, activeFilter, sort, currentSortLabel, loadError, updatesPaused, theme.error]);

  const emptyCopy = useMemo(() => orderEmptyCopy(activeFilter, searchQuery), [activeFilter, searchQuery]);
  const ListEmptyComponent = useCallback(() => (
    <View style={s.emptyStateContainer}>
      {loadError ? (
        <EmptyState
          icon="alert-circle"
          message="Couldn't load orders. Check your connection and pull to refresh."
          variant="error"
        />
      ) : (
        // One honest title per filter / search (lib/sellerLists/emptyCopy.ts)
        // — "No orders yet" only when the seller truly has none.
        <EmptyState
          icon={emptyCopy.icon}
          title={emptyCopy.title}
          testID="orders-empty"
          message={orders.length === 0
            ? 'Share your store to get your first sale.'
            : 'Orders appear here after checkout.'}
          actionLabel={orders.length === 0 ? 'Share store' : undefined}
          onAction={orders.length === 0 ? () => router.push('/share-store' as never) : undefined}
        />
      )}
    </View>
  ), [loadError, emptyCopy, orders.length, router]);

  // ─── Render ────────────────────────────────────────────────────────────────

  const list = (
    <View style={[s.root, { paddingTop: topInset + 12, backgroundColor: palette.background ?? palette.surface ?? BG }]}>
      {/* ── Fixed header ── */}
      <SellerListHeader
        title="Orders"
        showControls={hasAnyOrders}
        actions={[{ icon: 'more-horizontal', onPress: handleMoreMenu, accessibilityLabel: 'More order actions' }]}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search orders"
        onFilterPress={() => setFilterSheetVisible(true)}
        hasActiveFilter={hasActiveFilter}
        filterAccessibilityLabel={hasActiveFilter ? `Filter: ${activeFilter}` : 'Filter orders'}
        chips={FILTERS.map(({ key, label }) => ({
          key,
          label,
          active: activeFilter === key,
          onPress: () => setActiveFilter(key),
          // No count badges (Shopify's order tabs have none): with real
          // counts the five chips ran ~100pt past a 390pt screen, cutting
          // "Archived" off at the edge (polish #93). The selected tab's
          // count shows in the "N orders · To ship" line under the chips.
        }))}
      />

      {/* ── Order list (section list for date groups) ── */}
      {loading && orders.length === 0 ? (
        <View style={{ flex: 1, paddingHorizontal: listSidePad }}>
          <SellerOrdersListSkeleton />
        </View>
      ) : (
        <FlashList
          ref={scrollResetRef}
          data={listRows}
          keyExtractor={keyExtractor}
          getItemType={getItemType}
          renderItem={renderItem}
          extraData={selectedIdSet}
          ListHeaderComponent={ListHeaderComponent}
          ListFooterComponent={ListFooterComponent}
          ListEmptyComponent={ListEmptyComponent}
          contentContainerStyle={[
            s.listContent,
            filtered.length === 0 && { flexGrow: 1 },
            { paddingHorizontal: listSidePad, paddingBottom: tabBarClearance + (selectedIds.length > 0 ? 64 : 0) },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={STRONG}
              colors={[STRONG]}
            />
          }
        />
      )}

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <View style={[s.bulkBar, { paddingBottom: insets.bottom + SP.sm }]}>
          <LinearGradient colors={theme.heroGradient} style={s.bulkBarInner}>
            <Text style={s.bulkCount}>{selectedIds.length} selected</Text>
            <View style={s.bulkActions}>
              <TouchableOpacity style={s.bulkBtn} onPress={handleBulkMarkReady} accessibilityRole="button" accessibilityLabel="Mark selected orders ready">
                <Icon name="package" size={ICON.xs} color={STRONG} />
                <Text style={[s.bulkBtnText, { color: STRONG }]}>Ready</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.bulkBtn} onPress={handleBulkFulfill} accessibilityRole="button" accessibilityLabel="Fulfill selected orders">
                <Icon name="send" size={ICON.xs} color={STRONG} />
                <Text style={[s.bulkBtnText, { color: STRONG }]}>Fulfill</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.bulkBtn} onPress={handleExportCsv} accessibilityRole="button" accessibilityLabel="Export selected orders">
                <Icon name="download" size={ICON.xs} color={MUTED} />
                <Text style={[s.bulkBtnText, { color: MUTED }]}>Export</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.bulkBtn} onPress={handleBulkMenu} accessibilityRole="button" accessibilityLabel="More bulk actions">
                <Feather name="more-horizontal" size={ICON.xs} color={MUTED} />
                <Text style={[s.bulkBtnText, { color: MUTED }]}>More</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.bulkBtn} onPress={() => setSelectedIds([])} accessibilityRole="button" accessibilityLabel="Clear selected orders">
                <Icon name="x" size={ICON.xs} color={RED} />
                <Text style={[s.bulkBtnText, { color: RED }]}>Clear</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>
      )}


      {/* Filter Sheet */}
      <FilterSheet
        visible={filterSheetVisible}
        current={FILTERS.some(filter => filter.key === activeFilter) ? 'all' : activeFilter as OrderFilterKey}
        onSelect={k => setActiveFilter(k)}
        currentSort={sort}
        onSelectSort={k => setSort(k)}
        onClose={() => setFilterSheetVisible(false)}
      />

      <OptionSheet
        visible={bulkSheetVisible}
        onClose={() => setBulkSheetVisible(false)}
        title="Bulk actions"
        description={selectedIds.length === 0
          ? 'Select orders to act on several at once. You can also long-press an order to select it.'
          : `${selectedIds.length} ${selectedIds.length === 1 ? 'order' : 'orders'} selected`}
        options={bulkOptions}
        selectedId=""
        onSelect={handleBulkOption}
      />

      <FirstRunTip
        id="seller-orders"
        variant="gesture"
        contentReady={!loading}
        gesture={{ ...SELLER_ORDERS_GESTURE, target: sellerOrdersTipTarget }}
      />
    </View>
  );

  if (!splitView) return list;

  // iPad split (Shopify iPad / Apple Mail): the list keeps its phone layout
  // in a fixed column, the selected order fills the rest. Selection
  // defaults to the first order so the pane is never empty.
  const paneOrderId = splitOrderId ?? orders[0]?.id ?? null;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: palette.background ?? palette.surface ?? BG }}>
      <View style={{ width: SPLIT_LIST_WIDTH }}>{list}</View>
      <View style={{ width: StyleSheet.hairlineWidth, backgroundColor: palette.border ?? BORDER }} />
      <View style={{ flex: 1, paddingBottom: tabBarMetrics.occupiedHeight }} testID="orders-split-detail">
        {paneOrderId ? (
          <OrderDetailScreen key={paneOrderId} orderId={paneOrderId} embedded />
        ) : null}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (theme: AppThemePreset) => {
  const BG = theme.background, SCREEN_BG = theme.surface, SURFACE = theme.surface, CARD = theme.card;
  const CARD_GLASS = theme.cardGlass, CARD_ELEVATED_GLASS = theme.cardElevatedGlass;
  const BORDER = theme.border, BORDER_ACTIVE = theme.text, FG = theme.text, MUTED = theme.muted, SUBTLE = theme.subtle;
  const STRONG = theme.text, DIM = `${theme.text}14`, RED = theme.error, RED_DIM = `${theme.error}22`;
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  // List header
  listHeader: {
    paddingTop: SP.sm,
  },
  retryBannerWrap: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
  },
  emptyStateContainer: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
  },
  sortIndicator: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: STRONG,
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
  },
  sectionCount: {
    fontVariant: ['tabular-nums'],
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },

  // Order card
  orderCard: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
    backgroundColor: CARD,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: BORDER,
    minHeight: 44,
  },
  orderRowSelected: {
    backgroundColor: CARD_ELEVATED_GLASS,
    borderColor: BORDER_ACTIVE,
  },
  orderRowRisk: {
    borderLeftWidth: 3,
    borderLeftColor: RED + '88',
  },
  orderRowArchived: {
    opacity: 0.68,
  },
  cardTimelineWrap: {
    marginTop: SP.sm,
    paddingTop: SP.sm,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },

  // Selection
  selBox: {
    position: 'absolute',
    top: SP.md,
    right: SP.md,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: crispPx(1.5),
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  selBoxActive: {
    backgroundColor: STRONG,
    borderColor: STRONG,
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
    backgroundColor: DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: MUTED + '44',
  },
  newDotText: {
     fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: MUTED,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: STRONG,
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
     fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: RED,
  },
  returnBadge: {
    backgroundColor: DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  returnBadgeText: {
     fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: MUTED,
  },
  disputeBadge: {
    backgroundColor: RED_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  disputeBadgeText: {
     fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: RED,
  },
  orderCustomer: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  orderItems: {
    fontSize: FS.meta,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  orderCancelled: {
    fontSize: FS.meta,
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
    fontVariant: ['tabular-nums'],
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.1,
  },
  orderTime: {
    fontSize: FS.meta,
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
  tagPill: {
    backgroundColor: DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE + '55',
  },
  tagText: {
     fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: STRONG,
  },

  // Quick action
  quickAction: {
    minWidth: 88,
  },
  trackingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: STRONG + '44',
  },
  trackingText: {
    fontSize: FS.meta,
    fontFamily: FONT.medium,
    color: STRONG,
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
    backgroundColor: DIM,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: MUTED + '44',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  pausedBannerText: {
    flex: 1,
    fontSize: FS.meta,
    fontFamily: FONT.medium,
    color: FG,
  },
  pausedBannerAction: {
    fontSize: FS.meta,
    fontFamily: FONT.semibold,
    color: MUTED,
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
    fontSize: FS.meta,
    fontFamily: FONT.medium,
    color: RED,
    lineHeight: 16,
  },
  errorRetryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: DIM,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE + '44',
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  errorRetryText: {
    fontSize: FS.meta,
    fontFamily: FONT.semibold,
    color: STRONG,
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
    fontVariant: ['tabular-nums'],
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
     fontSize: FS.meta,
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
    color: STRONG,
    fontFamily: FONT.semibold,
  },
  filterSectionLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: MUTED,
    marginBottom: SP.xs,
  },
  modalCloseBtn: {
    marginTop: SP.md,
  },
  });
};
