/**
 * Seller order detail — Shopify iOS order screen, 1:1 in black/white/silver:
 * header with the order number, share and ⋯; the unfulfilled items with
 * "Create shipping label" + "Fulfill item"; fulfilled shipments with their
 * tracking number; the Paid block; customer, contact, shipping address and
 * the timeline. "Fulfill item" and "Refund" open full sheets
 * (components/orders/FulfillSheet.tsx, RefundSheet.tsx).
 */

import { shareInvoice, invoiceFromSellerOrder } from '@/lib/invoice';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Alert, ActivityIndicator, Modal, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { FONT, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { BottomSheet, Button, Chip, ListRow } from '@/components/ui';
import { showActionSheet, type ActionSheetButton } from '@/components/ui/ActionSheet';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RADII } from '@/constants/radii';
import { TYPE_SCALE } from '@/constants/typography';
import { hapticPrimaryAction, hapticToggle, hapticSuccessAction, hapticDestructiveConfirm } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { useFeeSchedule } from '@/hooks/useFeeSchedule';
import { quoteFromSchedule } from '@/lib/feeSchedule';
import { adaptReturnRow, itemsTotalCents, returnReasonLabel as returnRequestReasonLabel, statusLabel as returnRequestStatusLabel, type ReturnView } from '@/lib/returns';
import { Order, CANCELLATION_REASONS, CancellationReason, OrderStatus, TrackingStatus, FulfillmentType, FulfillmentStatus, OrderAddress, OrderLineItem, Fulfillment, Shipment, OrderTimelineEvent } from '@/services/orderTypes';
import { dbStatusToOrderStatus, dbStatusToPaymentStatus, type DbPaymentStatus } from '@/lib/orderStatusAdapter';
import { productDetailHref, profileHref } from '@/lib/profileNavigation';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { getInitials } from '@/lib/format';
import { sellerThreadCashPayout } from '@/lib/threadCashCheckout';
import { useQueryClient } from '@tanstack/react-query';
import { OrderRiskBadge } from '@/components/orders/OrderRiskBadge';
import { queryKeys } from '@/lib/queryClient';
import { formatLocalDate, sellerOrderConflictMessage } from '@/lib/deliveryGuarantee';
import { SellerDeliveryBanner } from '@/components/orders/SellerDelivery';
import { FulfillSheet } from '@/components/orders/FulfillSheet';
import { RefundSheet } from '@/components/orders/RefundSheet';
import { SHEET_FIELD_BG } from '@/components/orders/FullSheet';
import { sharePackingSlip } from '@/lib/packingSlip';
import {
  applyFulfillLocally, applyRefundLocally, linesToFulfill, orderTitle, refundableCentsOf, shipmentGroups,
  submitFulfillRequest, type FulfillRequest,
} from '@/lib/orderFulfillment';
import { isLocalPreviewSellerOrderId, loadPreviewSellerOrder, savePreviewSellerOrder } from '@/lib/previewOrderEdits';
import { refundReasonLabel, type OrderRefundsResponse, type SellerRefundRequest } from '@/lib/sellerRefund';
import { ApiError } from '@/lib/networkNotice';

// ─── API → Order adapter ──────────────────────────────────────────────────────

export function adaptApiOrder(raw: any): Order {
  const rawCustomer = raw.customer && typeof raw.customer === 'object' ? raw.customer : {};
  let parsedShippingAddress: any = null;
  if (raw.shippingAddress) {
    try {
      parsedShippingAddress = typeof raw.shippingAddress === 'string'
        ? JSON.parse(raw.shippingAddress)
        : raw.shippingAddress;
    } catch {
      // The address adapter below will keep its empty defaults.
    }
  }

  // The detail API normally supplies `customer` for Stripe-originated orders
  // by resolving buyerId through users. Keep the screen resilient to older
  // responses (or a missing customer record) by using the other checkout
  // identity fields before showing a generic label.
  const customerName = [
    rawCustomer.name,
    raw.customerName,
    raw.buyerName,
    parsedShippingAddress?.name,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? 'Customer';
  const customerEmail = [
    rawCustomer.email,
    raw.customerEmail,
    raw.buyerEmail,
    raw.guestEmail,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
  const customer = {
    ...rawCustomer,
    id: rawCustomer.id ?? raw.customerId ?? raw.buyerId ?? '',
    buyerUserId: typeof raw.buyerId === 'string' && raw.buyerId ? raw.buyerId : null,
    name: customerName,
    email: customerEmail,
  };
  const items: any[] = Array.isArray(raw.items) ? raw.items : [];

  // DB status → UI order status (shared with app/(tabs)/orders.tsx)
  const uiStatus: OrderStatus = dbStatusToOrderStatus(raw.status);

  // Derive payment status from DB order status (shared with app/(tabs)/orders.tsx)
  type PaymentStatus = DbPaymentStatus;
  const uiPaymentStatus: PaymentStatus = dbStatusToPaymentStatus(raw.status, raw.paidAt);
  const isRefundPending = raw.status === 'refund_pending';

  // Parse shipping address (stored as JSON in DB)
  const defaultAddr: OrderAddress = {
    name: customer.name,
    line1: '', city: '', state: '', zip: '', country: 'US',
  };
  let shippingAddr: OrderAddress = defaultAddr;
  if (parsedShippingAddress) {
    try {
      const sa = parsedShippingAddress;
      shippingAddr = {
        name:    sa.name    ?? customer.name,
        line1:   sa.street  ?? sa.line1 ?? '',
        line2:   sa.line2,
        city:    sa.city    ?? '',
        state:   sa.state   ?? '',
        zip:     sa.zip     ?? '',
        country: sa.country ?? 'US',
        phone:   sa.phone,
      };
    } catch { /* keep defaultAddr */ }
  }

  // Line items
  const lineItems: OrderLineItem[] = items.map((item: any) => ({
    id:               item.id,
    // Real product id from the API (the variant id is not a product id);
    // empty when the product no longer exists.
    productId:        typeof item.productId === 'string' ? item.productId : '',
    productName:      item.productName,
    variant:          item.variantLabel ?? '',
    sku:              undefined,
    quantity:         item.quantity,
    unitPriceCents:   item.priceCents ?? 0,
    discountAmountCents: 0,
    taxAmountCents:   0,
    totalCents:       (item.priceCents ?? 0) * item.quantity,
    imageUri:         typeof item.imageUrl === 'string' && item.imageUrl ? item.imageUrl : undefined,
    fulfillmentSource: 'seller' as FulfillmentType,
    isPreOrder:       raw.isPreorder === true,
    deliverBy:        item.deliverBy ?? null,
    deliveredAt:      item.deliveredAt ?? null,
    trackingNumber:   item.trackingNumber ?? null,
    carrier:          item.carrier ?? null,
    refundedAt:       item.refundedAt ?? null,
  }));

  const totalCents    = raw.totalCents ?? 0;
  const subtotalCents = raw.subtotalCents ?? 0;
  const shippingCents = raw.shippingCents ?? 0;

  const groupId = `group-${raw.id}`;
  const groupStatus: FulfillmentStatus =
    uiStatus === 'shipped' || uiStatus === 'delivered' ? 'fulfilled' :
    uiStatus === 'cancelled' ? 'cancelled' : 'unfulfilled';

  const fulfillment: Fulfillment = {
    id:      `fulfill-${raw.id}`,
    orderId: raw.id,
    groups: [{
      id:         groupId,
      orderId:    raw.id,
      type:       'seller',
      status:     groupStatus,
      lineItemIds: lineItems.map(li => li.id),
      createdAt:  raw.createdAt,
      updatedAt:  raw.updatedAt ?? raw.createdAt,
    }],
    type:     'seller',
    status:   groupStatus,
    isPicked: false,
    isPacked: false,
  };

  const shipments: Shipment[] = raw.trackingNumber
    ? [{
        id:                `shipment-${raw.id}`,
        orderId:           raw.id,
        fulfillmentGroupId: groupId,
        carrier:           raw.carrier ?? undefined,
        trackingNumber:    raw.trackingNumber,
        trackingEvents:    [],
        isDemo:            false,
        shippedAt:         raw.shippedAt ?? undefined,
        trackingStatus:    raw.trackingStatus ?? undefined,
        estimatedDelivery: raw.estimatedDelivery ?? undefined,
      }]
    : [];

  const timeline: OrderTimelineEvent[] = [
    {
      id:                `tl-created-${raw.id}`,
      type:              'order_created',
      message:           'Order created',
      isCustomerVisible: true,
      isSystemEvent:     true,
      isSellerNote:      false,
      createdAt:         raw.createdAt,
    },
  ];
  if (raw.shippedAt) {
    timeline.push({
      id:                `tl-shipped-${raw.id}`,
      type:              'shipped',
      message:           `Order shipped${raw.carrier ? ` via ${raw.carrier}` : ''}${raw.trackingNumber ? ` · ${raw.trackingNumber}` : ''}`,
      isCustomerVisible: true,
      isSystemEvent:     true,
      isSellerNote:      false,
      createdAt:         raw.shippedAt,
    });
  }

  // Build cancellation object and timeline event from API fields
  const cancellationReasonKey = raw.cancellationReason as string | undefined;
  const cancellationNotes     = raw.cancellationNotes  as string | undefined;
  let cancellation: import('@/services/orderTypes').Cancellation | undefined;
  if (uiStatus === 'cancelled' && cancellationReasonKey) {
    const reasonLabel = CANCELLATION_REASONS.find(r => r.key === cancellationReasonKey)?.label ?? cancellationReasonKey;
    cancellation = {
      id:             `cancel-${raw.id}`,
      orderId:        raw.id,
      reason:         cancellationReasonKey as import('@/services/orderTypes').CancellationReason,
      notes:          cancellationNotes || undefined,
       refundAmountCents: totalCents,
      notifyCustomer: true,
      cancelledAt:    raw.updatedAt ?? raw.createdAt,
    };
    const cancelMsg = cancellationNotes
      ? `Order cancelled · ${reasonLabel} — ${cancellationNotes}`
      : `Order cancelled · ${reasonLabel}`;
    timeline.push({
      id:                `tl-cancelled-${raw.id}`,
      type:              'cancelled',
      message:           cancelMsg,
      isCustomerVisible: false,
      isSystemEvent:     true,
      isSellerNote:      false,
      createdAt:         raw.updatedAt ?? raw.createdAt,
    });
  }

  const initials = customer.name.split(/\s+/).map((n: string) => n[0] ?? '').join('').slice(0, 2).toUpperCase() || 'C';

  return {
    id:          raw.id,
    orderNumber: raw.orderNumber,
    sellerId:    raw.ownerId ?? '',
    sellerName:  '',
    sellerHandle: '',
    source:       'app',
    salesChannel: 'Brandthread',
    status:          uiStatus,
    paymentStatus:   uiPaymentStatus,
    fulfillmentStatus: groupStatus === 'fulfilled' ? 'fulfilled' : 'unfulfilled',
    fulfillmentType: 'seller',
    riskLevel: 'low',
    riskFlags: [],
    customer: {
      id:            customer.id,
      name:          customer.name,
      email:         customer.email,
      phone:         customer.phone ?? undefined,
      initials,
      totalOrders:   customer.orderCount ?? 1,
       lifetimeValueCents: customer.totalSpentCents ?? 0,
      tags:          customer.tags ?? [],
      shippingAddress: shippingAddr,
      billingAddress:  shippingAddr,
    },
    lineItems,
    fulfillment,
    payment: {
       subtotalCents,
       // Promo + Thread Cash on the Stripe charge, so the breakdown adds up
       // to the charged total (older rows without the field stay at 0).
       discountTotalCents:      Math.max(0, raw.discountAmountCents ?? 0),
       shippingTotalCents:      shippingCents,
       taxTotalCents:           0,
       totalCents,
      // Payment was received for active/shipped/delivered; held in limbo for refund_pending
       amountPaidCents:         isRefundPending ? 0 : (uiStatus === 'cancelled' || uiStatus === 'refunded') ? 0 : totalCents,
       // Partial refunds from the order detail (POST /:id/refund) keep the
       // order open; refundedCents is what has gone back so far.
       amountRefundedCents:     uiStatus === 'refunded' ? Math.max(totalCents, raw.refundedCents ?? 0) : Math.max(0, raw.refundedCents ?? 0),
       amountHeldCents:         isRefundPending ? totalCents : 0,
       amountPendingCents:      0,
       sellerAllocationCents:   subtotalCents,
       manufacturerAllocationCents: 0,
       shippingLabelAllocationCents: shippingCents,
       platformFeeCents:        Math.max(0, raw.platformFeeCents ?? 0),
       processingFeeCents:      Math.max(0, raw.processingFeeChargedCents || raw.processingFeeCents || 0),
      payoutStatus:            isRefundPending ? 'held' : uiStatus === 'refunded' ? 'paid' : 'pending',
    },
    threadCashPayout: sellerThreadCashPayout(raw),
    shipments,
    trackingStatus: raw.trackingStatus ?? undefined,
    estimatedDelivery: raw.estimatedDelivery ?? undefined,
    labels:    [],
    returns:   [],
    refunds:   [],
    disputes:  [],
    timeline,
    cancellation,
    notes: isRefundPending
      ? [{
          id:         `note-refund-pending-${raw.id}`,
          orderId:    raw.id,
          type:       'internal' as const,
          content:    '⚠️ This order was cancelled and a refund was attempted automatically, but the refund may not have completed. Please verify in your Stripe dashboard and issue a manual refund if needed.',
          isPinned:   true,
          fileIds:    [],
          authorName: 'System',
          createdAt:  raw.updatedAt ?? raw.createdAt,
        }]
      : [],
    hasUnreadMessage:       false,
    isPreOrder:             raw.isPreorder === true,
    deliverBy:              raw.deliverBy ?? null,
    promisedShipDate:       raw.promisedShipDate ?? null,
    deliveredAt:            raw.deliveredAt ?? null,
    autoRefundedAt:         raw.autoRefundedAt ?? null,
    disputePausedAt:        raw.disputePausedAt ?? null,
    isManufacturerFulfilled: false,
    currency: 'USD',
    tags:     [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? raw.createdAt,
    shopifyFulfillment: raw.shopifyFulfillment ?? null,
    sellerRisk: raw.risk ?? null,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
/** "Aug 4, 2026 at 11:37 AM" — the reference's fulfilment / completed stamp. */
function fmtStamp(iso: string) {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  return `${day} at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
function usd(cents: number) {
  return formatCents(cents);
}
function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function cancellationReasonLabel(key: string): string {
  return CANCELLATION_REASONS.find(r => r.key === key)?.label ?? key;
}

const TRACKING_STATUS_OPTIONS: { key: TrackingStatus; label: string }[] = [
  { key: 'label_created', label: 'Label created' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'in_transit', label: 'In transit' },
  { key: 'out_for_delivery', label: 'Out for delivery' },
  { key: 'exception', label: 'Exception' },
  { key: 'returned_to_sender', label: 'Returned to sender' },
];

function trackingStatusLabel(status: string | undefined | null): string | null {
  if (!status) return null;
  if (status === 'delivered') return 'Delivered';
  return TRACKING_STATUS_OPTIONS.find(option => option.key === status)?.label ?? null;
}

/** Paid / Partially refunded / Refunded / Payment pending — the Paid block's pill. */
function paymentPillLabel(order: Order): string {
  const p = order.payment;
  if (p.amountRefundedCents > 0) return p.amountRefundedCents >= p.totalCents ? 'Refunded' : 'Partially refunded';
  if (order.paymentStatus === 'pending' || order.paymentStatus === 'authorized') return 'Payment pending';
  if (order.paymentStatus === 'voided') return 'Voided';
  return 'Paid';
}

function addressLines(a: OrderAddress): string[] {
  return [a.name, a.line1, a.line2, [a.city, [a.state, a.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), a.country]
    .filter((l): l is string => !!l && !!String(l).trim());
}

// ─── InfoRow ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value, valueColor, bold }: { label: string; value: string; valueColor?: string; bold?: boolean }) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.infoRow}>
      <Text style={[s.infoLabel, bold && s.infoBold]}>{label}</Text>
      <Text style={[s.infoValue, bold && s.infoBold, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

/** "Fees" row: the recorded fees for this order, else the schedule's estimate; hidden with neither. */
function FeesRow({ payment: p }: { payment: Order['payment'] }) {
  const schedule = useFeeSchedule();
  const recorded = p.platformFeeCents + (p.processingFeeCents ?? 0);
  let fees = recorded;
  if (!recorded && schedule && p.totalCents > 0) {
    const q = quoteFromSchedule(schedule, Math.max(0, p.subtotalCents - p.discountTotalCents), { shippingCents: p.shippingTotalCents });
    fees = q.platformFeeCents + q.processingFeeCents;
  }
  if (!fees) return null;
  return <InfoRow label="Fees" value={`-${usd(fees)}`} />;
}

// ─── Building blocks ─────────────────────────────────────────────────────────

/** A full-width block, separated from the next by a thick band (Shopify grouping). */
function Block({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  return <View style={s.block} testID={testID}>{children}</View>;
}

function Pill({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.pill}>
      <Feather name={icon} size={14} color={theme.text} />
      <Text style={s.pillText}>{label}</Text>
    </View>
  );
}

function MoreButton({ onPress, label }: { onPress: () => void; label: string }) {
  const { theme } = useAppTheme();
  return (
    <PressableScale onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} style={{ width: 36, height: 32, alignItems: 'flex-end', justifyContent: 'center' }}>
      <Feather name="more-horizontal" size={ICON.md} color={theme.text} />
    </PressableScale>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { theme } = useAppTheme();
  const [copied, setCopied] = useState(false);
  return (
    <PressableScale
      onPress={() => {
        Clipboard.setStringAsync(text).then(() => {
          hapticToggle();
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={copied ? 'Copied' : label}
      style={{ width: 32, height: 32, alignItems: 'flex-end', justifyContent: 'center' }}
    >
      <Feather name={copied ? 'check' : 'copy'} size={ICON.sm} color={theme.muted} />
    </PressableScale>
  );
}

function ItemRow({ item, onPress }: { item: OrderLineItem; onPress?: () => void }) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const body = (
    <View style={s.itemRow}>
      <View style={s.itemThumb}>
        {item.imageUri
          ? <Image source={{ uri: item.imageUri }} style={s.itemThumbImg} />
          : <Feather name="package" size={ICON.md} color={theme.muted} />}
      </View>
      <View style={s.itemBody}>
        <Text style={s.itemName} numberOfLines={2}>{item.productName}</Text>
        {item.variant ? <Text style={s.itemMeta} numberOfLines={1}>{item.variant}</Text> : null}
        <Text style={s.itemMeta}>{usd(item.unitPriceCents)}</Text>
        {item.refundedAt ? <Text style={s.itemMeta}>Refunded {formatLocalDate(item.refundedAt)}</Text> : null}
      </View>
      <Text style={s.itemQty}>× {item.quantity}</Text>
    </View>
  );
  if (!onPress) return body;
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`${item.productName}, open product`}>
      {body}
    </PressableScale>
  );
}

// ─── Delivery status sheet (was the Fulfillment tab's tracking form) ─────────

function DeliveryStatusSheet({ visible, order, onClose, onSave }: {
  visible: boolean;
  order: Order;
  onClose: () => void;
  onSave: (status: TrackingStatus, estimatedDelivery: string | null) => Promise<void>;
}) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const [status, setStatus] = useState<TrackingStatus>(order.trackingStatus ?? 'label_created');
  const [estimated, setEstimated] = useState(order.estimatedDelivery ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setStatus(order.trackingStatus && order.trackingStatus !== 'delivered' ? order.trackingStatus : 'label_created');
    setEstimated(order.estimatedDelivery ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  return (
    <BottomSheet visible={visible} onClose={onClose} testID="delivery-status-sheet">
      <View style={{ paddingHorizontal: SP.md, gap: SP.sm, paddingBottom: SP.md }}>
        <Text style={[TYPE_SCALE.headline, { color: theme.text }]}>Delivery status</Text>
        {TRACKING_STATUS_OPTIONS.map(option => (
          <ListRow
            key={option.key}
            title={option.label}
            onPress={() => setStatus(option.key)}
            right={status === option.key ? <Feather name="check" size={18} color={theme.text} /> : undefined}
            testID={`tracking-status-${option.key}`}
          />
        ))}
        <View style={s.sheetField}>
          <Text style={s.sheetFieldLabel}>Estimated delivery</Text>
          <TextInput
            style={s.sheetFieldInput}
            value={estimated}
            onChangeText={setEstimated}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.subtle}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Estimated delivery date"
            testID="estimated-delivery-input"
          />
        </View>
        <Button
          label="Save"
          fullWidth
          loading={saving}
          onPress={async () => {
            setSaving(true);
            try { await onSave(status, estimated.trim() || null); onClose(); } catch { /* alert already shown */ } finally { setSaving(false); }
          }}
        />
      </View>
    </BottomSheet>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OrderDetailScreen() {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const { id, refund: refundParam } = useLocalSearchParams<{ id: string; refund?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const api = useApi();
  const queryClient = useQueryClient();

  // Stale-while-revalidate: the seller Orders list (app/(tabs)/orders.tsx)
  // seeds this same cache entry from data it already fetched, and warms it
  // further on press-in. When it's there, paint it immediately instead of
  // the spinner below — `load` still runs on focus and refreshes silently.
  const cachedOrder = id ? queryClient.getQueryData<any>(queryKeys.order(id)) : undefined;
  const [raw, setRaw] = useState<any>(cachedOrder ?? null);
  const [order, setOrder] = useState<Order | null>(() => (cachedOrder ? adaptApiOrder(cachedOrder) : null));
  const [loading, setLoading] = useState(!cachedOrder);
  const [updatesPaused, setUpdatesPaused] = useState(false);
  const [orderLoadFailed, setOrderLoadFailed] = useState(false);
  // Item 108: this order's real return requests (GET /api/returns, seller).
  const [orderReturns, setOrderReturns] = useState<ReturnView[] | null>(null);
  // Refunds already issued (GET /:id/refunds); null until loaded.
  const [refundInfo, setRefundInfo] = useState<OrderRefundsResponse | null>(null);

  // Cancel modal
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancellationReason | null>(null);
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);

  // Sheets
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const [fulfilledAt, setFulfilledAt] = useState<string | null>(null);
  const [refundOpen, setRefundOpen] = useState(refundParam === '1');
  const [deliveryStatusOpen, setDeliveryStatusOpen] = useState(false);

  // Message buyer
  const [messagingBuyer, setMessagingBuyer] = useState(false);

  // Backoff: stop polling after 3 consecutive failures; resume on next focus.
  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);
  const requestGenerationRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(!!cachedOrder);

  const applyRaw = useCallback((next: any) => {
    setRaw(next);
    setOrder(adaptApiOrder(next));
    if (id) queryClient.setQueryData(queryKeys.order(id), next);
  }, [id, queryClient]);

  const load = useCallback(async (generation: number) => {
    // No order id at all (e.g. a bad/incomplete deep link) — nothing to
    // fetch. Show the "not found" state below instead of firing requests
    // that can only ever 404.
    if (!id) {
      setLoading(false);
      hasLoadedRef.current = true;
      return;
    }
    // Keep one request in flight per focus cycle. Without this guard, a slow
    // poll can overlap the next tick and an older success can clear the
    // paused state after a later failure has already stopped the timer.
    if (requestGenerationRef.current === generation) return;
    // Preview demo orders (lib/previewSellerOrders.ts, lib/previewOrders.ts)
    // live only on this device: never fetch them (or returns) from the API,
    // and keep whatever the demo seller already did to them this session.
    if (isLocalPreviewSellerOrderId(id)) {
      const previewRaw = loadPreviewSellerOrder(id);
      if (previewRaw) applyRaw(previewRaw);
      else if (!hasLoadedRef.current) setOrder(null);
      setOrderReturns([]);
      setLoading(false);
      hasLoadedRef.current = true;
      return;
    }
    requestGenerationRef.current = generation;
    if (!hasLoadedRef.current) setLoading(true);
    api.returns.listSeller()
      .then(rows => {
        if (generationRef.current !== generation) return;
        setOrderReturns((Array.isArray(rows) ? rows : []).filter((row: any) => row?.orderId === id).map(adaptReturnRow));
      })
      .catch(() => {
        if (generationRef.current !== generation) return;
        setOrderReturns(prev => prev ?? []);
      });
    api.orders.refunds(id)
      .then(info => { if (generationRef.current === generation) setRefundInfo(info); })
      .catch(() => { /* the Paid block falls back to the order's refundedCents */ });
    try {
      const fetched = await api.orders.get(id);
      if (generationRef.current !== generation) return; // stale focus cycle
      applyRaw(fetched);
      setOrderLoadFailed(false);
      setUpdatesPaused(false);
      consecutiveFailuresRef.current = 0;
    } catch (loadErr) {
      if (generationRef.current !== generation) return; // stale focus cycle
      // A 404 is a real "not found"; anything else is a load failure to retry.
      if (!hasLoadedRef.current) setOrderLoadFailed(!(loadErr instanceof ApiError && loadErr.status === 404));
      if (!hasLoadedRef.current) setOrder(null);
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
        hasLoadedRef.current = true;
      }
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current = null;
      }
    }
  }, [id, api, applyRaw]);

  // Poll every 15 s while focused so status updates surface quickly.
  // After 3 consecutive failures the interval clears to avoid hammering a
  // down/offline server; it resets automatically on the next screen focus.
  useFocusEffect(
    useCallback(() => {
      const generation = ++generationRef.current;
      consecutiveFailuresRef.current = 0;
      setUpdatesPaused(false);
      load(generation);
      timerRef.current = setInterval(() => load(generation), 15_000);
      return () => {
        if (timerRef.current !== null) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };
    }, [load])
  );

  const retryUpdates = useCallback(() => {
    hapticPrimaryAction();
    const generation = generationRef.current;
    consecutiveFailuresRef.current = 0;
    setUpdatesPaused(false);
    if (timerRef.current === null) {
      timerRef.current = setInterval(() => load(generation), 15_000);
    }
    load(generation);
  }, [load]);

  const isPreview = isLocalPreviewSellerOrderId(id);

  // ── Actions ──────────────────────────────────────────────────────────────

  // 409 AUTO_REFUNDED / DELIVERY_NOT_SELLER_CONFIRMED get their own copy.
  function writeFailed(title: string, e: any) {
    Alert.alert(title, sellerOrderConflictMessage(e?.code) ?? 'Check your connection and try again.');
    if (e?.code === 'AUTO_REFUNDED') load(generationRef.current);
  }

  async function handleStatus(status: 'processing' | 'fulfilled') {
    hapticSuccessAction();
    try { await api.orders.updateStatus(id, status); } catch (e: any) { writeFailed('Couldn’t update this order', e); return; }
    load(generationRef.current);
  }

  /** The fulfil sheet's request: same endpoints and server rules as before (tracking / items-tracking / status). */
  async function handleFulfill(request: FulfillRequest) {
    const now = new Date().toISOString();
    if (isPreview && raw) {
      const next = applyFulfillLocally(raw, request, now);
      savePreviewSellerOrder(next);
      applyRaw(next);
    } else {
      try {
        await submitFulfillRequest(api.orders, id, request);
      } catch (e: any) {
        if (e?.code === 'AUTO_REFUNDED') load(generationRef.current);
        throw new Error(sellerOrderConflictMessage(e?.code) ?? fulfillErrorMessage(e));
      }
      load(generationRef.current);
    }
    setFulfillOpen(false);
    setFulfilledAt(now);
  }

  async function handleRefund(request: SellerRefundRequest) {
    if (isPreview && raw) {
      const next = applyRefundLocally(raw, request.amountCents);
      savePreviewSellerOrder(next);
      applyRaw(next);
    } else {
      const result = await api.orders.refund(id, request);
      setRefundInfo(prev => ({ refundedCents: result.refundedCents, refundableCents: result.refundableCents, refunds: prev?.refunds ?? [] }));
      api.orders.refunds(id).then(setRefundInfo).catch(() => {});
      load(generationRef.current);
    }
    hapticSuccessAction();
    setRefundOpen(false);
  }

  async function handleUpdateTracking(status: TrackingStatus, estimatedDelivery: string | null) {
    try {
      await api.orders.updateTracking(id, { trackingStatus: status, estimatedDelivery });
      await load(generationRef.current);
    } catch (e: any) {
      writeFailed('Couldn’t update tracking', e);
      throw e;
    }
  }

  // Opens (or creates) the real DM thread with this order's buyer — reuses
  // the same api.conversations.createOrGet the buyer-side "Message" button
  // already uses (see app/buyer-other-profile.tsx), just with the seller's
  // own identity as `myInfo` instead of that screen's hardcoded buyer one.
  // Never fabricates a buyer identity: bails if this order has no linked
  // buyerUserId (e.g. a guest checkout with no Brandthread account).
  async function handleMessageBuyer() {
    if (!order || messagingBuyer) return;
    const buyerUserId = order.customer.buyerUserId;
    if (!buyerUserId) {
      Alert.alert('No buyer account', 'This order has no linked Brandthread account to message.');
      return;
    }
    hapticPrimaryAction();
    setMessagingBuyer(true);
    try {
      const profile = await api.auth.me();
      const sellerName = profile.brandName || profile.displayName || profile.name;
      const conv = await api.conversations.createOrGet({
        type: 'buyer_to_seller_order',
        participant: {
          userId: buyerUserId,
          name: order.customer.name,
          handle: '',
          initials: order.customer.initials || getInitials(order.customer.name),
          // Monochrome brand: the same theme.accent every avatar chip
          // already falls back to when no color is stored (see
          // `other.color || theme.accent` in seller-inbox.tsx /
          // seller-conversation.tsx) — never a hardcoded brand color.
          color: theme.accent,
          accountType: 'buyer',
        },
        myInfo: {
          name: sellerName,
          handle: profile.username ? `@${profile.username}` : '',
          initials: getInitials(sellerName),
          color: theme.accent,
          accountType: 'seller',
        },
        contextOrderId: order.id,
        contextOrderNumber: order.orderNumber,
        contextOrderStatus: order.status,
      });
      router.push(`/seller-conversation?id=${encodeURIComponent(conv.id)}` as never);
    } catch {
      Alert.alert("Couldn't open conversation", 'Check your connection and try again.');
    } finally {
      setMessagingBuyer(false);
    }
  }

  async function handleCancelOrder() {
    if (!cancelReason) {
      Alert.alert('Select a reason', 'Please choose a cancellation reason.');
      return;
    }
    hapticDestructiveConfirm();
    setCancelling(true);
    try {
      await api.orders.updateStatus(id, 'cancelled', {
        reason: cancelReason,
        notes:  cancelNote.trim() || undefined,
      });
      setShowCancelModal(false);
      setCancelConfirmed(true);
      // Auto-dismiss the banner after 6 seconds
      setTimeout(() => setCancelConfirmed(false), 6000);
    } catch (e: any) {
      Alert.alert('Couldn’t cancel this order', 'Check your connection and try again.');
    } finally {
      setCancelling(false);
    }
    load(generationRef.current);
  }

  function shareOrderInvoice() {
    if (!order) return;
    shareInvoice(invoiceFromSellerOrder(order)).catch((err: any) => Alert.alert('Could not create invoice', err?.message ?? 'Please try again.'));
  }

  function printPackingSlip() {
    if (!order) return;
    sharePackingSlip(order).catch(() => Alert.alert('Couldn’t create the packing slip', 'Try again.'));
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={theme.text} size="large" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[s.root, { paddingTop: headerTopInset }]}>
        {updatesPaused && (
          <PressableScale
            style={s.pausedBanner}
            onPress={retryUpdates}
            accessibilityRole="button"
            accessibilityLabel="Live updates paused. Tap to retry."
            testID="order-detail-live-updates-retry"
          >
            <Feather name="wifi-off" size={ICON.sm} color={theme.text} />
            <Text style={s.pausedBannerText}>Live updates paused</Text>
            <Text style={s.pausedBannerAction}>Tap to retry</Text>
          </PressableScale>
        )}
        <EmptyState
          icon="alert-circle"
          title={orderLoadFailed ? "Couldn't load this order" : 'Order not found'}
          description={orderLoadFailed ? 'Check your connection and try again.' : 'This order may have been deleted or the ID is invalid.'}
          action={orderLoadFailed
            ? { label: 'Retry', onPress: retryUpdates, icon: 'refresh-cw' }
            : { label: 'Go Back', onPress: () => goBackOr(router, '/(tabs)/orders'), icon: 'arrow-left' }}
        />
      </View>
    );
  }

  const readOnly = !!order.autoRefundedAt;
  const toFulfill = linesToFulfill(order);
  const fulfillable = toFulfill.length > 0;
  const groups = shipmentGroups({
    ...order,
    trackingNumber: order.shipments[0]?.trackingNumber ?? null,
    carrier: order.shipments[0]?.carrier ?? null,
  });
  const shippedAt = order.timeline.find(ev => ev.type === 'shipped')?.createdAt ?? null;
  const unfulfilledQty = toFulfill.reduce((sum, li) => sum + li.quantity, 0);
  const closed = order.status === 'cancelled' || order.status === 'refunded';
  // Lines with no shipment that aren't fulfillable: a cancelled order's items.
  const removedLines = closed ? order.lineItems.filter(li => !li.trackingNumber) : [];
  const cancellable = !readOnly && (order.status === 'new' || order.status === 'processing' || order.status === 'ready_to_ship');
  const refundableCents = refundInfo?.refundableCents ?? (raw ? refundableCentsOf(raw) : 0);
  const canRefund = !readOnly && order.payment.amountPaidCents > order.payment.amountRefundedCents && refundableCents > 0;
  const itemCount = order.lineItems.reduce((sum, li) => sum + li.quantity, 0);
  const partiallyShipped = order.lineItems.some(li => !!li.trackingNumber) && fulfillable;
  const labelHref = partiallyShipped
    ? `/fulfill-order?orderId=${order.id}&itemIds=${toFulfill.map(li => li.id).join(',')}`
    : `/fulfill-order?orderId=${order.id}&step=3`;
  const openProduct = (li: OrderLineItem) => (li.productId ? () => router.push(productDetailHref(li.productId, { isOwner: true }) as never) : undefined);
  const refundRows = (refundInfo?.refunds ?? []).filter(r => r.state !== 'failed');
  const c = order.customer;

  function openFulfill() {
    hapticPrimaryAction();
    setFulfillOpen(true);
  }
  function openRefund() {
    hapticPrimaryAction();
    setRefundOpen(true);
  }

  function showMoreActions() {
    const buttons: ActionSheetButton[] = [];
    if (fulfillable) {
      buttons.push({ text: toFulfill.length > 1 ? 'Fulfill items' : 'Fulfill item', onPress: openFulfill });
      buttons.push({ text: 'Create shipping label', onPress: () => router.push(labelHref as never) });
    }
    if (!readOnly && order!.status === 'new') buttons.push({ text: 'Mark as processing', onPress: () => handleStatus('processing') });
    if (!readOnly && order!.status === 'processing') buttons.push({ text: 'Mark as ready to ship', onPress: () => handleStatus('fulfilled') });
    if (!readOnly && order!.status === 'shipped') buttons.push({ text: 'Update delivery status', onPress: () => setDeliveryStatusOpen(true) });
    buttons.push({ text: 'Print packing slip', onPress: printPackingSlip });
    if (order!.customer.buyerUserId) buttons.push({ text: 'Message buyer', onPress: handleMessageBuyer });
    if (canRefund) buttons.push({ text: 'Refund', onPress: openRefund });
    buttons.push({ text: 'Share invoice', onPress: shareOrderInvoice });
    if (cancellable) buttons.push({ text: 'Cancel order', style: 'destructive', onPress: () => setShowCancelModal(true) });
    buttons.push({ text: 'Close', style: 'cancel' });
    showActionSheet(orderTitle(order!.orderNumber), undefined, buttons);
  }

  function showPaidActions() {
    const buttons: ActionSheetButton[] = [];
    if (canRefund) buttons.push({ text: 'Refund', onPress: openRefund });
    buttons.push({ text: 'Share invoice', onPress: shareOrderInvoice });
    buttons.push({ text: 'Close', style: 'cancel' });
    showActionSheet(paymentPillLabel(order!), undefined, buttons);
  }

  function showUnfulfilledActions() {
    const buttons: ActionSheetButton[] = [];
    if (!readOnly && order!.status === 'new') buttons.push({ text: 'Mark as processing', onPress: () => handleStatus('processing') });
    if (!readOnly && order!.status === 'processing') buttons.push({ text: 'Mark as ready to ship', onPress: () => handleStatus('fulfilled') });
    buttons.push({ text: 'Print packing slip', onPress: printPackingSlip });
    if (cancellable) buttons.push({ text: 'Cancel order', style: 'destructive', onPress: () => setShowCancelModal(true) });
    buttons.push({ text: 'Close', style: 'cancel' });
    showActionSheet('Unfulfilled', undefined, buttons);
  }

  function showFulfilledActions() {
    const buttons: ActionSheetButton[] = [];
    if (!readOnly && order!.status === 'shipped') buttons.push({ text: 'Update delivery status', onPress: () => setDeliveryStatusOpen(true) });
    buttons.push({ text: 'Print packing slip', onPress: printPackingSlip });
    buttons.push({ text: 'Close', style: 'cancel' });
    showActionSheet('Fulfilled', undefined, buttons);
  }

  const pinnedNotes = order.notes.filter(n => n.isPinned);
  const timeline = [
    ...order.timeline,
    ...refundRows.map(r => ({
      id: `tl-refund-${r.id}`, type: 'refund_issued', message: `Refunded ${usd(r.amountCents)} · ${refundReasonLabel(r.reason)}`,
      isCustomerVisible: true, isSystemEvent: true, isSellerNote: false, createdAt: r.succeededAt ?? r.createdAt,
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <View style={s.root}>
      <ScreenHeader
        title={orderTitle(order.orderNumber)}
        divider={false}
        variant="push"
        onBack={() => goBackOr(router, '/(tabs)/orders')}
        actions={[
          { icon: 'share', onPress: shareOrderInvoice, accessibilityLabel: 'Share invoice' },
          { icon: 'more-horizontal', onPress: showMoreActions, accessibilityLabel: 'More order actions' },
        ]}
      />

      {updatesPaused && (
        <PressableScale
          style={s.pausedBanner}
          onPress={retryUpdates}
          accessibilityRole="button"
          accessibilityLabel="Live updates paused. Tap to retry."
          testID="order-detail-live-updates-retry"
        >
          <Feather name="wifi-off" size={ICON.sm} color={theme.text} />
          <Text style={s.pausedBannerText}>Live updates paused</Text>
          <Text style={s.pausedBannerAction}>Tap to retry</Text>
        </PressableScale>
      )}

      <ScrollView
        style={s.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + SP.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="order-detail-scroll"
      >
        {/* "Completed" banner (reference 3) after the fulfil sheet confirms. */}
        {fulfilledAt ? (
          <View style={s.band} testID="order-fulfilled-banner">
            <View style={s.doneBanner}>
              <View style={s.doneIcon}><Feather name="check" size={16} color={theme.background} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.doneTitle}>Fulfilled</Text>
                <Text style={s.doneText}>Items fulfilled {fmtStamp(fulfilledAt)}.</Text>
              </View>
            </View>
          </View>
        ) : null}

        {cancelConfirmed && (
          <View style={s.band}>
            <View style={s.doneBanner}>
              <View style={s.doneIcon}><Feather name="check" size={16} color={theme.background} /></View>
              <Text style={[s.doneText, { flex: 1 }]}>Order cancelled.</Text>
            </View>
          </View>
        )}

        <View style={s.bannerWrap}>
          <SellerDeliveryBanner order={order} shipped={order.status === 'shipped' || order.status === 'delivered'} />
        </View>

        {pinnedNotes.map(note => (
          <View key={note.id} style={s.noticeRow}>
            <Feather name="alert-triangle" size={ICON.sm} color={theme.text} />
            <Text style={s.noticeText}>{note.content.replace(/^⚠️\s*/, '')}</Text>
          </View>
        ))}

        {(order.isPreOrder || (order.sellerRisk && order.sellerRisk.level !== 'normal')) ? (
          <View style={s.flagRow}>
            {order.isPreOrder ? <Pill icon="clock" label="Pre-order" /> : null}
            <OrderRiskBadge risk={order.sellerRisk} />
          </View>
        ) : null}

        {/* Fulfilled shipments (reference 4) */}
        {groups.map((group, index) => (
          <Block key={group.key} testID="order-fulfilled-block">
            <View style={s.blockHead}>
              <View style={s.pillLine}>
                <Pill icon="check-square" label={`${order.status === 'delivered' ? 'Delivered' : 'Fulfilled'} (${group.quantity})`} />
                {groups.length > 1 ? <Text style={s.blockHeadMeta}>{`${orderTitle(order.orderNumber)}-F${index + 1}`}</Text> : null}
              </View>
              <MoreButton onPress={showFulfilledActions} label="Fulfillment actions" />
            </View>
            <Text style={s.blockSub}>
              {[shippedAt || group.items[0]?.deliveredAt ? fmtStamp((shippedAt ?? group.items[0]?.deliveredAt)!) : null, 'Shipping'].filter(Boolean).join(' • ')}
            </Text>
            {group.trackingNumber ? (
              <View style={s.trackingBox} testID="order-tracking-box">
                <Text style={s.trackingLabel}>Tracking number</Text>
                <Text style={s.trackingValue} selectable>{[group.carrier, group.trackingNumber].filter(Boolean).join(' • ')}</Text>
                {trackingStatusLabel(order.trackingStatus) ? (
                  <Text style={s.trackingLabel}>{[trackingStatusLabel(order.trackingStatus), order.estimatedDelivery ? `Est. ${fmt(`${order.estimatedDelivery}T12:00:00`)}` : null].filter(Boolean).join(' · ')}</Text>
                ) : null}
              </View>
            ) : null}
            {group.items.map((li, i) => (
              <View key={li.id} style={i > 0 ? s.rowDivider : null}>
                <ItemRow item={li} onPress={openProduct(li)} />
              </View>
            ))}
          </Block>
        ))}

        {/* Unfulfilled items (reference 1) */}
        {fulfillable || removedLines.length > 0 ? (
          <Block testID="order-unfulfilled-block">
            <View style={s.blockHead}>
              <Pill
                icon={closed ? 'x-circle' : 'package'}
                label={closed ? `Cancelled (${removedLines.reduce((n, li) => n + li.quantity, 0)})` : `Unfulfilled (${unfulfilledQty})`}
              />
              {!closed ? <MoreButton onPress={showUnfulfilledActions} label="Unfulfilled item actions" /> : null}
            </View>
            {order.status === 'cancelled' && order.cancellation ? (
              <Text style={s.blockSub}>
                {[cancellationReasonLabel(order.cancellation.reason), order.cancellation.notes, fmt(order.cancellation.cancelledAt)].filter(Boolean).join(' • ')}
              </Text>
            ) : !closed ? <Text style={s.blockSub}>Shipping</Text> : null}
            {(closed ? removedLines : toFulfill).map((li, i) => (
              <View key={li.id} style={i > 0 ? s.rowDivider : null}>
                <ItemRow item={li} onPress={openProduct(li)} />
              </View>
            ))}
            {fulfillable ? (
              <View style={s.blockActions}>
                <Button label="Create shipping label" fullWidth onPress={() => router.push(labelHref as never)} testID="order-create-label" />
                <Button label={toFulfill.length > 1 ? 'Fulfill items' : 'Fulfill item'} variant="secondary" fullWidth onPress={openFulfill} testID="order-fulfill-item" />
              </View>
            ) : null}
          </Block>
        ) : null}

        {readOnly ? (
          <Block>
            <Text style={s.blockFoot}>Auto-refunded orders are read-only. Fulfillment is turned off.</Text>
          </Block>
        ) : null}

        {/* Shopify-linked products */}
        {order.shopifyFulfillment ? (
          <Block>
            <Text style={s.blockTitle}>Fulfilled via Shopify</Text>
            <InfoRow label="Sent to Shopify" value={order.shopifyFulfillment.sentToShopify ? (order.shopifyFulfillment.shopifyOrderName ?? 'Yes') : 'Pending'} />
            <InfoRow label="Fulfilled by partner" value={order.shopifyFulfillment.fulfilledByPartner ? 'Yes — tracking received' : 'Not yet'} />
          </Block>
        ) : null}

        {/* Paid */}
        <Block testID="order-paid-block">
          <View style={s.blockHead}>
            <Pill icon="file-text" label={paymentPillLabel(order)} />
            <MoreButton onPress={showPaidActions} label="Payment actions" />
          </View>
          <Text style={s.itemCount}>{plural(itemCount, 'item')}</Text>
          <InfoRow label="Subtotal" value={usd(order.payment.subtotalCents)} />
          {order.payment.discountTotalCents > 0 ? <InfoRow label="Discounts" value={`-${usd(order.payment.discountTotalCents)}`} /> : null}
          {order.payment.shippingTotalCents > 0 ? <InfoRow label="Shipping" value={usd(order.payment.shippingTotalCents)} /> : null}
          {order.payment.taxTotalCents > 0 ? <InfoRow label="Tax" value={usd(order.payment.taxTotalCents)} /> : null}
          <View style={s.totalRow}><InfoRow label="Total" value={usd(order.payment.totalCents)} bold /></View>
          <View style={s.hair} />
          {order.payment.amountPaidCents > 0 ? <InfoRow label="Paid" value={usd(order.payment.amountPaidCents)} /> : null}
          {order.payment.amountHeldCents > 0 ? <InfoRow label="Held" value={usd(order.payment.amountHeldCents)} /> : null}
          {refundRows.length > 0
            ? refundRows.map(r => (
              <InfoRow key={r.id} label={`Refunded · ${refundReasonLabel(r.reason)}`} value={`-${usd(r.amountCents)}`} />
            ))
            : order.payment.amountRefundedCents > 0
              ? <InfoRow label="Refunded" value={`-${usd(order.payment.amountRefundedCents)}`} />
              : null}
          <FeesRow payment={order.payment} />
          {canRefund ? (
            <View style={s.blockActions}>
              <Button label="Refund" variant="secondary" fullWidth onPress={openRefund} testID="order-refund" />
            </View>
          ) : null}
        </Block>

        {order.threadCashPayout ? (
          <Block testID="order-thread-cash-payout">
            <Text style={s.blockTitle}>Your payout</Text>
            {order.threadCashPayout.lines.map(line => (
              <View key={line.key}>
                <InfoRow label={line.label} value={`${line.cents < 0 ? '-' : ''}${usd(Math.abs(line.cents))}`} />
                {line.note ? <Text style={s.payoutNote}>{line.note}</Text> : null}
              </View>
            ))}
            <View style={s.hair} />
            <InfoRow label="Your payout" value={usd(order.threadCashPayout.payoutCents)} bold />
            <Text style={s.payoutNote}>Same as if the buyer had paid everything by card. Thread Cash never comes out of your pay.</Text>
          </Block>
        ) : null}

        {orderReturns && orderReturns.length > 0 ? (
          <Block>
            <Text style={s.blockTitle}>Returns</Text>
            {orderReturns.map(ret => (
              <ListRow
                key={ret.id}
                title={`${returnRequestStatusLabel(ret.status)} · ${returnRequestReasonLabel(ret.reason)}`}
                subtitle={`${ret.status === 'pending' ? 'Needs your review' : `Updated ${fmt(ret.updatedAt)}`} · Items ${formatCents(itemsTotalCents(ret.items))}`}
                chevron
                onPress={() => router.push(`/return-detail?returnId=${encodeURIComponent(ret.id)}` as never)}
                testID={`seller-return-${ret.id}`}
              />
            ))}
          </Block>
        ) : null}

        {/* Customer */}
        <Block>
          <Text style={s.blockTitle}>Customer</Text>
          <ListRow
            title={c.name}
            subtitle={plural(c.totalOrders, 'order')}
            chevron={!!c.id}
            onPress={c.id ? () => router.push(`/customer-orders?customerId=${encodeURIComponent(c.id)}` as never) : undefined}
            testID="order-customer"
          />
          {c.buyerUserId ? (
            <ListRow
              icon="user"
              title="View profile"
              chevron
              onPress={() => router.push(profileHref({ userId: c.buyerUserId!, accountType: 'buyer', name: c.name, initials: c.initials }) as never)}
            />
          ) : null}
          <ListRow
            icon="message-circle"
            title={messagingBuyer ? 'Opening…' : 'Message buyer'}
            onPress={handleMessageBuyer}
            disabled={messagingBuyer || !order.customer.buyerUserId}
            chevron
            testID="order-message-buyer"
          />
        </Block>

        <Block>
          <Text style={s.blockTitle}>Contact information</Text>
          <View style={s.copyRow}>
            <Text style={[s.bodyText, { flex: 1 }]} selectable>{c.email || 'No email address'}</Text>
            {c.email ? <CopyButton text={c.email} label="Copy email" /> : null}
          </View>
          <Text style={[s.bodyText, !c.phone && s.mutedText]}>{c.phone || 'No phone number'}</Text>
        </Block>

        <Block>
          <View style={s.copyRow}>
            <Text style={[s.blockTitle, { flex: 1, marginBottom: 0 }]}>Shipping address</Text>
            <CopyButton text={addressLines(c.shippingAddress).join('\n')} label="Copy shipping address" />
          </View>
          {addressLines(c.shippingAddress).map((line, i) => <Text key={i} style={s.bodyText} selectable>{line}</Text>)}
        </Block>

        {/* Timeline */}
        <View style={s.timelineWrap}>
          <Text style={s.blockTitle}>Timeline</Text>
          {timeline.map((ev, i) => (
            <View key={ev.id} style={s.timelineRow}>
              <View style={s.timelineRail}>
                <View style={[s.timelineDot, i === 0 && { backgroundColor: theme.text }]} />
                {i < timeline.length - 1 ? <View style={s.timelineLine} /> : null}
              </View>
              <View style={s.timelineBody}>
                <Text style={s.timelineMessage}>{ev.message}</Text>
                <Text style={s.timelineTime}>{fmtTime(ev.createdAt)}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Cancel Modal */}
      <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { paddingBottom: insets.bottom + SP.lg }]}>
            <Text style={s.modalTitle}>Cancel order</Text>
            <Text style={s.modalSubtitle}>Select a reason</Text>
            <View style={s.chipRow}>
              {CANCELLATION_REASONS.map(r => (
                <Chip
                  key={r.key}
                  label={r.label}
                  selected={cancelReason === r.key}
                  onPress={() => { hapticToggle(); setCancelReason(r.key); }}
                />
              ))}
            </View>
            <TextInput
              style={s.cancelNoteInput}
              value={cancelNote}
              onChangeText={setCancelNote}
              placeholder="Additional notes (optional)"
              placeholderTextColor={theme.subtle}
              multiline
            />
            <Text style={s.warningText}>
              This will cancel the order. Any refund must be issued separately through your payment provider. This cannot be undone.
            </Text>
            <View style={s.modalActions}>
              <Button label="Go back" variant="secondary" onPress={() => setShowCancelModal(false)} style={{ flex: 1 }} fullWidth />
              <Button label="Cancel order" variant="destructive" onPress={handleCancelOrder} loading={cancelling} style={{ flex: 1 }} fullWidth />
            </View>
          </View>
        </View>
      </Modal>

      <FulfillSheet
        visible={fulfillOpen}
        order={order}
        onCancel={() => setFulfillOpen(false)}
        onSubmit={handleFulfill}
      />

      <RefundSheet
        visible={refundOpen}
        orderNumber={order.orderNumber}
        refundableCents={refundableCents}
        onCancel={() => setRefundOpen(false)}
        onSubmit={handleRefund}
      />

      <DeliveryStatusSheet
        visible={deliveryStatusOpen}
        order={order}
        onClose={() => setDeliveryStatusOpen(false)}
        onSave={handleUpdateTracking}
      />
    </View>
  );
}

/** The server's own words for a refused shipment (e.g. "Add a tracking number to ship a preorder…"). */
function fulfillErrorMessage(e: any): string {
  const body = e?.body;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed?.error === 'string') return parsed.error;
    } catch { /* not JSON */ }
  }
  if (body && typeof body === 'object' && typeof body.error === 'string') return body.error;
  return 'Couldn’t fulfill. Check your connection and try again.';
}

// ═══════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { text: FG, muted: MUTED, subtle: SUBTLE, border: BORDER, background: BG } = theme;
  return StyleSheet.create({
  root:             { flex: 1, backgroundColor: 'transparent' },
  centered:         { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  content:          { flex: 1 },

  block:            { paddingHorizontal: SP.md, paddingVertical: SP.md, borderBottomWidth: 8, borderBottomColor: SHEET_FIELD_BG },
  blockHead:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
  blockHeadMeta:    { ...TYPE_SCALE.footnote, color: MUTED },
  blockTitle:       { ...TYPE_SCALE.headline, color: FG, marginBottom: SP.xs },
  blockSub:         { ...TYPE_SCALE.footnote, color: MUTED, marginTop: SP.xs },
  blockFoot:        { ...TYPE_SCALE.footnote, color: MUTED, marginTop: SP.sm },
  blockActions:     { gap: SP.sm, marginTop: SP.md },
  pillLine:         { flexDirection: 'row', alignItems: 'center', gap: SP.sm, flexShrink: 1 },
  pill:             { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: RADIUS.sm, backgroundColor: SHEET_FIELD_BG, borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER },
  pillText:         { fontSize: 14, lineHeight: 18, fontFamily: FONT.semibold, color: FG },
  bannerWrap:       { paddingHorizontal: SP.md, paddingTop: SP.sm },
  flagRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.md },

  itemRow:          { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm, marginTop: SP.xs },
  itemThumb:        { width: 60, height: 60, borderRadius: RADIUS.sm, backgroundColor: SHEET_FIELD_BG, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  itemThumbImg:     { width: '100%', height: '100%' },
  itemBody:         { flex: 1, minWidth: 0, gap: 2 },
  itemName:         { ...TYPE_SCALE.body, fontFamily: FONT.semibold, color: FG },
  itemMeta:         { ...TYPE_SCALE.footnote, color: MUTED },
  itemQty:          { ...TYPE_SCALE.headline, color: FG },
  rowDivider:       { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER },
  itemCount:        { ...TYPE_SCALE.footnote, color: MUTED, marginTop: SP.md },

  trackingBox:      { marginTop: SP.sm, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, paddingHorizontal: SP.md, paddingVertical: SP.sm, gap: 2 },
  trackingLabel:    { ...TYPE_SCALE.footnote, color: MUTED },
  trackingValue:    { ...TYPE_SCALE.body, fontFamily: FONT.medium, color: FG },

  infoRow:          { flexDirection: 'row', justifyContent: 'space-between', gap: SP.md, paddingVertical: 5 },
  infoLabel:        { ...TYPE_SCALE.body, color: FG, flexShrink: 1 },
  infoValue:        { ...TYPE_SCALE.body, color: FG },
  infoBold:         { fontFamily: FONT.bold },
  totalRow:         { marginTop: SP.xs },
  hair:             { height: StyleSheet.hairlineWidth, backgroundColor: BORDER, marginVertical: SP.sm },
  payoutNote:       { ...TYPE_SCALE.footnote, color: MUTED, marginBottom: SP.xs },

  bodyText:         { ...TYPE_SCALE.body, color: FG, lineHeight: 22 },
  mutedText:        { color: MUTED },
  copyRow:          { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs },

  band:             { borderBottomWidth: 8, borderBottomColor: SHEET_FIELD_BG },
  doneBanner:       { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.md, borderLeftWidth: 3, borderLeftColor: FG },
  doneIcon:         { width: 24, height: 24, borderRadius: 6, backgroundColor: FG, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  doneTitle:        { ...TYPE_SCALE.headline, color: FG },
  doneText:         { ...TYPE_SCALE.body, color: FG },
  noticeRow:        { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', paddingHorizontal: SP.md, paddingVertical: SP.md, borderBottomWidth: 8, borderBottomColor: SHEET_FIELD_BG },
  noticeText:       { ...TYPE_SCALE.footnote, color: FG, flex: 1 },

  timelineWrap:     { paddingHorizontal: SP.md, paddingVertical: SP.md },
  timelineRow:      { flexDirection: 'row', gap: SP.sm },
  timelineRail:     { width: 12, alignItems: 'center' },
  timelineDot:      { width: 10, height: 10, borderRadius: RADII.pill, backgroundColor: SUBTLE, marginTop: 5 },
  timelineLine:     { flex: 1, width: 2, backgroundColor: BORDER, marginTop: 2 },
  timelineBody:     { flex: 1, paddingBottom: SP.md },
  timelineMessage:  { ...TYPE_SCALE.body, color: FG },
  timelineTime:     { ...TYPE_SCALE.footnote, color: MUTED, marginTop: 2 },

  sheetField:       { backgroundColor: SHEET_FIELD_BG, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  sheetFieldLabel:  { fontSize: 12, lineHeight: 16, fontFamily: FONT.regular, color: MUTED },
  sheetFieldInput:  { fontSize: 17, lineHeight: 22, fontFamily: FONT.regular, color: FG, paddingVertical: 2 },

  // Cancel modal
  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  modalOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  modalCard:        { backgroundColor: SHEET_FIELD_BG, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, padding: SP.lg, gap: SP.md, maxHeight: '90%' },
  modalTitle:       { ...TYPE_SCALE.title2, color: FG },
  modalSubtitle:    { ...TYPE_SCALE.footnote, color: MUTED },
  modalActions:     { flexDirection: 'row', gap: SP.sm },
  cancelNoteInput:  { backgroundColor: BG, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, fontSize: 15, padding: SP.md, minHeight: 80, textAlignVertical: 'top' },
  warningText:      { ...TYPE_SCALE.footnote, color: MUTED },
  pausedBanner:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: SHEET_FIELD_BG, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  pausedBannerText: { flex: 1, ...TYPE_SCALE.footnote, color: FG },
  pausedBannerAction: { ...TYPE_SCALE.footnote, fontFamily: FONT.semibold, color: FG },
  });
};
