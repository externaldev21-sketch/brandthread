/**
 * Order Detail — full rewrite
 * Tabs: overview | customer | payment | fulfillment | timeline | returns | disputes | notes
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, Alert, ActivityIndicator, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, StatusBadge, SectionHeader, EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { OrderStatusTimeline } from '@/components/orders/OrderStatusTimeline';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RADII } from '@/constants/radii';
import { hapticPrimaryAction, hapticToggle, hapticSuccessAction, hapticDestructiveConfirm } from '@/lib/haptics';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { Order, PAYOUT_MILESTONES, CANCELLATION_REASONS, CancellationReason, ReturnStatus, RETURN_REASONS, OrderStatus, TrackingStatus, FulfillmentType, FulfillmentStatus, OrderAddress, OrderLineItem, Fulfillment, Shipment, OrderTimelineEvent, PaymentSummary } from '@/services/orderTypes';
import { dbStatusToOrderStatus, dbStatusToPaymentStatus, type DbPaymentStatus } from '@/lib/orderStatusAdapter';
import { productDetailHref, profileHref } from '@/lib/profileNavigation';

function useThemeAliases() {
  const { theme } = useAppTheme();
  return {
    theme,
    BG: theme.background, SURFACE: theme.surface, CARD: theme.card, CARD_ELEVATED: theme.cardElevated,
    BORDER: theme.border, BORDER_ACTIVE: theme.accentLight, FG: theme.text, MUTED: theme.muted, SUBTLE: theme.subtle,
    SUCCESS: theme.success, SUCCESS_DIM: `${theme.success}26`, BLUE: theme.accentLight, BLUE_DIM: `${theme.accentLight}26`,
    ORANGE: theme.warning, ORANGE_DIM: `${theme.warning}26`, RED: theme.error, RED_DIM: `${theme.error}26`,
    GOLD: theme.accent, PURPLE: theme.accent, PURPLE_LIGHT: theme.accentLight, PURPLE_DIM: theme.accentDim,
    CYAN: theme.secondary, CYAN_DIM: theme.secondaryDim,
  };
}

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
  const uiPaymentStatus: PaymentStatus = dbStatusToPaymentStatus(raw.status);
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
    fulfillmentSource: 'seller' as FulfillmentType,
    isPreOrder:       false,
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
       discountTotalCents:      0,
       shippingTotalCents:      shippingCents,
       taxTotalCents:           0,
       totalCents,
      // Payment was received for active/shipped/delivered; held in limbo for refund_pending
       amountPaidCents:         isRefundPending ? 0 : (uiStatus === 'cancelled' || uiStatus === 'refunded') ? 0 : totalCents,
       amountRefundedCents:     uiStatus === 'refunded' ? totalCents : 0,
       amountHeldCents:         isRefundPending ? totalCents : 0,
       amountPendingCents:      0,
       sellerAllocationCents:   subtotalCents,
       manufacturerAllocationCents: 0,
       shippingLabelAllocationCents: shippingCents,
       platformFeeCents:        0,
      payoutStatus:            isRefundPending ? 'held' : uiStatus === 'refunded' ? 'paid' : 'pending',
    },
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
    isPreOrder:             false,
    isManufacturerFulfilled: false,
    currency: 'USD',
    tags:     [],
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt ?? raw.createdAt,
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'customer' | 'payment' | 'fulfillment' | 'timeline' | 'returns' | 'disputes' | 'notes';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview',    label: 'Overview' },
  { key: 'customer',    label: 'Customer' },
  { key: 'payment',     label: 'Payment' },
  { key: 'fulfillment', label: 'Fulfillment' },
  { key: 'timeline',    label: 'Timeline' },
  { key: 'returns',     label: 'Returns' },
  { key: 'disputes',    label: 'Disputes' },
  // The Notes tab is hidden: notes aren't persisted by any API, and the
  // 15-second order poll overwrites local edits, silently discarding
  // anything a seller types. Bring this back once notes are backed by
  // a real endpoint.
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function usd(cents: number) {
  return formatCents(cents);
}

function orderStatusVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  switch (status) {
    case 'new': return 'info';
    case 'processing': return 'warning';
    case 'ready_to_ship': return 'purple';
    case 'shipped': return 'info';
    case 'delivered': return 'success';
    case 'cancelled': return 'neutral';
    case 'refunded': return 'neutral';
    case 'disputed': return 'error';
    default: return 'neutral';
  }
}

function paymentVariant(status: string): 'success' | 'info' | 'warning' | 'error' | 'neutral' | 'purple' {
  switch (status) {
    case 'paid': return 'success';
    case 'pending': case 'authorized': return 'warning';
    case 'refunded': case 'partially_refunded': return 'info';
    case 'failed': case 'voided': return 'error';
    default: return 'neutral';
  }
}

function timelineColor(type: string, theme: ReturnType<typeof useAppTheme>['theme']): string {
  switch (type) {
    case 'order_created': return theme.secondary;
    case 'payment_confirmed': return theme.success;
    case 'shipped': case 'label_purchased': case 'tracking_added': return theme.accentLight;
    case 'delivered': return theme.success;
    case 'return_requested': case 'refund_issued': return theme.warning;
    case 'dispute_opened': case 'cancelled': return theme.error;
    case 'risk_review': return theme.error;
    case 'note_added': return theme.accent;
    default: return theme.muted;
  }
}

function returnReasonLabel(key: string): string {
  return RETURN_REASONS.find(r => r.key === key)?.label ?? key;
}

function cancellationReasonLabel(key: string): string {
  return CANCELLATION_REASONS.find(r => r.key === key)?.label ?? key;
}

const TRACKING_STATUS_OPTIONS: { key: TrackingStatus; label: string }[] = [
  { key: 'label_created', label: 'Label Created' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'out_for_delivery', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'exception', label: 'Exception' },
  { key: 'returned_to_sender', label: 'Returned to Sender' },
];

function trackingStatusLabel(status: TrackingStatus): string {
  return TRACKING_STATUS_OPTIONS.find(option => option.key === status)?.label ?? status;
}

// ─── InfoRow ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value, valueColor, bold }: { label: string; value: string; valueColor?: string; bold?: boolean }) {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, bold && s.infoValueBold, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

// ─── AddressCard ─────────────────────────────────────────────────────────────

function AddressCard({ title, addr }: { title: string; addr: { name: string; line1: string; line2?: string; city: string; state: string; zip: string; country: string } }) {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  return (
    <BrandthreadCard style={s.addressCard}>
      <Text style={s.addressTitle}>{title}</Text>
      <Text style={s.addressText}>{addr.name}</Text>
      <Text style={s.addressText}>{addr.line1}{addr.line2 ? `, ${addr.line2}` : ''}</Text>
      <Text style={s.addressText}>{addr.city}, {addr.state} {addr.zip}</Text>
      <Text style={s.addressText}>{addr.country}</Text>
    </BrandthreadCard>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OrderDetailScreen() {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatesPaused, setUpdatesPaused] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>((tab as Tab) || 'overview');

  // Cancel modal
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState<CancellationReason | null>(null);
  const [cancelNote, setCancelNote] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);

  // Note form
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<'internal' | 'customer' | 'manufacturer'>('internal');
  const [addingNote, setAddingNote] = useState(false);

  // Tracking form per group
  const [trackingForms, setTrackingForms] = useState<Record<string, { carrier: string; tracking: string; visible: boolean }>>({});
  const [updatingTracking, setUpdatingTracking] = useState(false);

  // Tracking events modal
  const [trackingModalShipmentId, setTrackingModalShipmentId] = useState<string | null>(null);

  // Backoff: stop polling after 3 consecutive failures; resume on next focus.
  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);
  const requestGenerationRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (generation: number) => {
    // Keep one request in flight per focus cycle. Without this guard, a slow
    // poll can overlap the next tick and an older success can clear the
    // paused state after a later failure has already stopped the timer.
    if (requestGenerationRef.current === generation) return;
    requestGenerationRef.current = generation;
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const raw = await api.orders.get(id);
      if (generationRef.current !== generation) return; // stale focus cycle
      setOrder(adaptApiOrder(raw));
      setUpdatesPaused(false);
      consecutiveFailuresRef.current = 0;
    } catch {
      if (generationRef.current !== generation) return; // stale focus cycle
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
  }, [id, api]);

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

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleMarkProcessing() {
    hapticSuccessAction();
    try { await api.orders.updateStatus(id, 'processing'); } catch (e: any) { Alert.alert('Couldn’t update this order', 'Check your connection and try again.'); return; }
    load(generationRef.current);
  }

  async function handleMarkReadyToShip() {
    hapticSuccessAction();
    try { await api.orders.updateStatus(id, 'fulfilled'); } catch (e: any) { Alert.alert('Couldn’t update this order', 'Check your connection and try again.'); return; }
    load(generationRef.current);
  }

  async function handleMarkShipped() {
    hapticSuccessAction();
    try { await api.orders.updateStatus(id, 'shipped'); } catch (e: any) { Alert.alert('Couldn’t update this order', 'Check your connection and try again.'); return; }
    load(generationRef.current);
  }

  async function handleMarkDelivered() {
    hapticSuccessAction();
    try { await api.orders.updateStatus(id, 'delivered'); } catch (e: any) { Alert.alert('Couldn’t update this order', 'Check your connection and try again.'); return; }
    load(generationRef.current);
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

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setAddingNote(true);
    // Notes are stored locally (no API endpoint) — optimistically append
    if (order) {
      const newNote = {
        id: `note-${Date.now()}`,
        orderId: id,
        type: noteType,
        content: noteText.trim(),
        isPinned: false,
        fileIds: [],
        authorName: 'You',
        createdAt: new Date().toISOString(),
      };
      setOrder({ ...order, notes: [...order.notes, newNote] });
    }
    setNoteText('');
    setAddingNote(false);
  }

  async function handleAddTracking(groupId: string) {
    const form = trackingForms[groupId];
    if (!form?.carrier.trim() || !form?.tracking.trim()) {
      Alert.alert('Missing info', 'Please enter carrier and tracking number.');
      return;
    }
    try {
      await api.orders.addTracking(id, {
        trackingNumber: form.tracking.trim(),
        carrier:        form.carrier.trim(),
      });
    } catch (e: any) {
      Alert.alert('Couldn’t add tracking', 'Check your connection and try again.');
      return;
    }
    setTrackingForms(prev => ({ ...prev, [groupId]: { ...prev[groupId], visible: false } }));
    load(generationRef.current);
  }

  async function handleAddTrackingQuick(carrier: string, trackingNumber: string) {
    try {
      await api.orders.addTracking(id, { trackingNumber, carrier });
      load(generationRef.current);
    } catch (e: any) {
      Alert.alert('Couldn’t add tracking', 'Check your connection and try again.');
    }
  }

  async function handleUpdateTracking(status: TrackingStatus, estimatedDelivery: string | null) {
    setUpdatingTracking(true);
    try {
      await api.orders.updateTracking(id, {
        trackingStatus: status,
        estimatedDelivery,
      });
      await load(generationRef.current);
    } catch (e: any) {
      Alert.alert('Couldn’t update tracking', 'Check your connection and try again.');
      throw e;
    } finally {
      setUpdatingTracking(false);
    }
  }

  async function handlePinNote(noteId: string, current: boolean) {
    if (!order) return;
    // Toggle pin locally (no API endpoint)
    setOrder({
      ...order,
      notes: order.notes.map(n => n.id === noteId ? { ...n, isPinned: !current } : n),
    });
  }

  async function handleReturnAction(returnId: string, status: ReturnStatus, deniedReason?: string) {
    if (status === 'denied') hapticDestructiveConfirm();
    else hapticSuccessAction();
    // Returns not yet wired to API — update locally
    if (order) {
      setOrder({
        ...order,
        returns: order.returns.map(r => r.id === returnId ? { ...r, status, deniedReason } : r),
      });
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={s.centered}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        {updatesPaused && (
          <PressableScale
            style={s.pausedBanner}
            onPress={retryUpdates}
            accessibilityRole="button"
            accessibilityLabel="Live updates paused. Tap to retry."
            testID="order-detail-live-updates-retry"
          >
            <Feather name="wifi-off" size={ICON.sm} color={ORANGE} />
            <Text style={s.pausedBannerText}>Live updates paused</Text>
            <Text style={s.pausedBannerAction}>Tap to retry</Text>
            <Feather name="refresh-cw" size={12} color={ORANGE} />
          </PressableScale>
        )}
        <EmptyState
          icon="alert-circle"
          title="Order not found"
          description="This order may have been deleted or the ID is invalid."
          action={{ label: 'Go Back', onPress: () => router.back(), icon: 'arrow-left' }}
        />
      </View>
    );
  }

  const trackingModal = order.shipments.find(sh => sh.id === trackingModalShipmentId);

  return (
    <View style={s.root}>
      {/* Header */}
      <ScreenHeader
        title={order.orderNumber}
        subtitle={order.customer.name}
        variant="push"
        onBack={() => router.back()}
        actions={[{ icon: 'refresh-cw', onPress: retryUpdates, accessibilityLabel: 'Refresh order' }]}
      />

      {/* Tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.tabBar}
        contentContainerStyle={s.tabBarContent}
      >
        {TABS.map(t => (
          <PressableScale
            key={t.key}
            onPress={() => { hapticToggle(); setActiveTab(t.key); }}
            style={[s.tabItem, activeTab === t.key && s.tabItemActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: activeTab === t.key }}
            accessibilityLabel={t.label}
          >
            <Text style={[s.tabLabel, activeTab === t.key && s.tabLabelActive]}>{t.label}</Text>
          </PressableScale>
        ))}
      </ScrollView>

      {/* Cancellation confirmed banner */}
      {updatesPaused && (
        <PressableScale
          style={s.pausedBanner}
          onPress={retryUpdates}
          accessibilityRole="button"
          accessibilityLabel="Live updates paused. Tap to retry."
          testID="order-detail-live-updates-retry"
        >
          <Feather name="wifi-off" size={ICON.sm} color={ORANGE} />
          <Text style={s.pausedBannerText}>Live updates paused</Text>
          <Text style={s.pausedBannerAction}>Tap to retry</Text>
          <Feather name="refresh-cw" size={12} color={ORANGE} />
        </PressableScale>
      )}

      {cancelConfirmed && (
        <View style={s.cancelBanner}>
          <Feather name="check-circle" size={ICON.sm} color={FG} />
          <Text style={s.cancelBannerText}>Order cancelled successfully.</Text>
          <PressableScale onPress={() => { hapticPrimaryAction(); setCancelConfirmed(false); }} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Feather name="x" size={ICON.sm} color={FG} />
          </PressableScale>
        </View>
      )}

      {/* Content */}
      <ScrollView
        style={s.content}
        contentContainerStyle={{ paddingBottom: insets.bottom + SP.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {activeTab === 'overview'    && <OverviewTab order={order} onMarkProcessing={handleMarkProcessing} onMarkReadyToShip={handleMarkReadyToShip} onMarkShipped={handleMarkShipped} onMarkDelivered={handleMarkDelivered} onCancelPress={() => setShowCancelModal(true)} router={router} reload={() => load(generationRef.current)} onAddTrackingQuick={handleAddTrackingQuick} />}
        {activeTab === 'customer'    && <CustomerTab order={order} />}
        {activeTab === 'payment'     && <PaymentTab order={order} />}
        {activeTab === 'fulfillment' && <FulfillmentTab order={order} trackingForms={trackingForms} setTrackingForms={setTrackingForms} onAddTracking={handleAddTracking} onMarkShipped={handleMarkShipped} onUpdateTracking={handleUpdateTracking} updatingTracking={updatingTracking} onShowTracking={(sid) => setTrackingModalShipmentId(sid)} router={router} />}
        {activeTab === 'timeline'    && <TimelineTab order={order} noteText={noteText} setNoteText={setNoteText} onAddNote={handleAddNote} addingNote={addingNote} />}
        {activeTab === 'returns'     && <ReturnsTab order={order} onAction={handleReturnAction} router={router} />}
        {activeTab === 'disputes'    && <DisputesTab order={order} router={router} />}
        {activeTab === 'notes'       && <NotesTab order={order} noteText={noteText} setNoteText={setNoteText} noteType={noteType} setNoteType={setNoteType} onAddNote={handleAddNote} addingNote={addingNote} onPinNote={handlePinNote} />}
      </ScrollView>

      {/* Cancel Modal */}
      <Modal visible={showCancelModal} transparent animationType="fade" onRequestClose={() => setShowCancelModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Cancel Order</Text>
            <Text style={s.modalSubtitle}>Select a reason</Text>
            <View style={s.chipRow}>
              {CANCELLATION_REASONS.map(r => (
                <PressableScale
                  key={r.key}
                  onPress={() => { hapticToggle(); setCancelReason(r.key); }}
                  style={[s.chip, cancelReason === r.key && s.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: cancelReason === r.key }}
                  accessibilityLabel={r.label}
                >
                  <Text style={[s.chipText, cancelReason === r.key && s.chipTextActive]}>{r.label}</Text>
                </PressableScale>
              ))}
            </View>
            <TextInput
              style={s.cancelNoteInput}
              value={cancelNote}
              onChangeText={setCancelNote}
              placeholder="Additional notes (optional)"
              placeholderTextColor={SUBTLE}
              multiline
            />
            {/* Warning */}
            <BrandthreadCard style={s.warningCard}>
              <View style={s.warningRow}>
                <Feather name="alert-triangle" size={ICON.sm} color={RED} />
                <Text style={s.warningText}>
                  This will cancel the order. Any refund must be issued separately through your payment provider. This cannot be undone.
                </Text>
              </View>
            </BrandthreadCard>
            <View style={s.modalActions}>
              <SecondaryButton label="Go Back" onPress={() => setShowCancelModal(false)} style={{ flex: 1 }} />
              <PrimaryButton
                label="Confirm Cancel"
                onPress={handleCancelOrder}
                loading={cancelling}
                colors={[RED, RED]}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Tracking Events Modal */}
      <Modal visible={!!trackingModalShipmentId} transparent animationType="slide" onRequestClose={() => setTrackingModalShipmentId(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <Text style={s.modalTitle}>Tracking Events</Text>
            {trackingModal && (
              <>
                <Text style={s.modalSubtitle}>{trackingModal.carrier} · {trackingModal.trackingNumber}</Text>
                {trackingModal.trackingEvents.map(ev => (
                  <View key={ev.id} style={s.trackingEventRow}>
                    <View style={[s.trackingDot, { backgroundColor: timelineColor(ev.status, theme) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.trackingEvDesc}>{ev.description}</Text>
                      {ev.location && <Text style={s.trackingEvLoc}>{ev.location}</Text>}
                      <Text style={s.trackingEvTime}>{fmtTime(ev.timestamp)}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
            <SecondaryButton label="Close" onPress={() => setTrackingModalShipmentId(null)} style={{ marginTop: SP.md }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// TAB: OVERVIEW
// ═══════════════════════════════════════════════════════

function OverviewTab({ order, onMarkProcessing, onMarkReadyToShip, onMarkShipped, onMarkDelivered, onCancelPress, router, reload, onAddTrackingQuick }: {
  order: Order;
  onMarkProcessing: () => void;
  onMarkReadyToShip: () => void;
  onMarkShipped: () => void;
  onMarkDelivered: () => void;
  onCancelPress: () => void;
  router: ReturnType<typeof useRouter>;
  reload: () => void;
  onAddTrackingQuick: (carrier: string, trackingNumber: string) => Promise<void>;
}) {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const [addingTracking, setAddingTracking] = useState(false);
  const [trackingCarrier, setTrackingCarrier] = useState('');
  const [trackingNum, setTrackingNum] = useState('');

  async function handleAddTrackingAndShip() {
    if (!trackingCarrier.trim() || !trackingNum.trim()) {
      Alert.alert('Missing info', 'Enter carrier and tracking number.');
      return;
    }
    await onAddTrackingQuick(trackingCarrier.trim(), trackingNum.trim());
    setAddingTracking(false);
  }

  return (
    <View style={s.tabContent}>
      {/* Hero card */}
      <GradientCard glow style={s.heroCard}>
        <View style={s.heroRow}>
          <Text style={s.heroOrderNum}>{order.orderNumber}</Text>
          <View style={s.badgeRow}>
            <StatusBadge label={order.status.replace(/_/g, ' ').toUpperCase()} variant={orderStatusVariant(order.status)} />
            <StatusBadge label={order.paymentStatus.replace(/_/g, ' ').toUpperCase()} variant={paymentVariant(order.paymentStatus)} />
          </View>
        </View>
        <Text style={s.heroDate}>{fmt(order.createdAt)}</Text>
        <View style={s.heroMeta}>
          <Text style={s.heroMetaText}>Source: {order.source}</Text>
          <Text style={s.heroMetaText}>·</Text>
          <Text style={s.heroMetaText}>{order.salesChannel}</Text>
          <Text style={s.heroMetaText}>·</Text>
          <Text style={s.heroMetaText}>{order.currency}</Text>
        </View>
        {order.riskLevel !== 'low' && (
          <View style={s.riskBadge}>
            <Feather name="alert-triangle" size={ICON.xs} color={FG} />
            <Text style={s.riskBadgeText}>⚠ High Risk</Text>
          </View>
        )}
        {order.isPreOrder && (
          <View style={s.preOrderBadge}>
            <Text style={s.preOrderBadgeText}>PRE-ORDER</Text>
          </View>
        )}
      </GradientCard>

      {/* Live status tracker — the visual centerpiece: where this order stands right now */}
      <BrandthreadCard style={s.timelineCard}>
        <OrderStatusTimeline status={order.status} />
      </BrandthreadCard>

      {/* Cancellation reason card */}
      {order.status === 'cancelled' && order.cancellation && (
        <View style={s.section}>
          <BrandthreadCard style={s.cancellationCard}>
            <View style={s.cancellationHeader}>
              <Feather name="x-circle" size={ICON.sm} color={RED} />
              <Text style={s.cancellationTitle}>Order Cancelled</Text>
            </View>
            <InfoRow label="Reason" value={cancellationReasonLabel(order.cancellation.reason)} valueColor={FG} />
            {order.cancellation.notes ? (
              <InfoRow label="Notes" value={order.cancellation.notes} valueColor={MUTED} />
            ) : null}
            <InfoRow label="Cancelled" value={fmt(order.cancellation.cancelledAt)} valueColor={MUTED} />
          </BrandthreadCard>
        </View>
      )}

      {/* Action Buttons */}
      <View style={s.actionSection}>
        <SectionHeader title="Actions" />
        {order.status === 'new' && (
          <View style={s.actionRow}>
            <PrimaryButton label="Mark Processing" onPress={onMarkProcessing} icon="play" style={{ flex: 1 }} />
            <SecondaryButton label="Cancel Order" onPress={onCancelPress} icon="x" style={{ flex: 1 }} accent={RED} />
          </View>
        )}
        {order.status === 'processing' && (
          <View style={s.actionRow}>
            <PrimaryButton label="Mark Ready to Ship" onPress={onMarkReadyToShip} icon="package" style={{ flex: 1 }} />
            <SecondaryButton label="Fulfill Order" onPress={() => router.push(`/fulfill-order?orderId=${order.id}`)} icon="tag" style={{ flex: 1 }} />
          </View>
        )}
        {order.status === 'ready_to_ship' && (
          <View style={s.actionCol}>
            <View style={s.actionRow}>
              <PrimaryButton label="Fulfill Order" onPress={() => router.push(`/fulfill-order?orderId=${order.id}`)} icon="tag" style={{ flex: 1 }} />
              <SecondaryButton label="Add Tracking" onPress={() => setAddingTracking(!addingTracking)} icon="map-pin" style={{ flex: 1 }} />
            </View>
            {addingTracking && (
              <BrandthreadCard style={s.inlineForm}>
                <TextInput style={s.inlineInput} value={trackingCarrier} onChangeText={setTrackingCarrier} placeholder="Carrier (USPS, UPS...)" placeholderTextColor={SUBTLE} />
                <TextInput style={s.inlineInput} value={trackingNum} onChangeText={setTrackingNum} placeholder="Tracking number" placeholderTextColor={SUBTLE} />
                <PrimaryButton label="Save & Mark Shipped" onPress={handleAddTrackingAndShip} small />
              </BrandthreadCard>
            )}
            <SecondaryButton label="Mark Shipped" onPress={onMarkShipped} icon="send" />
          </View>
        )}
        {order.status === 'shipped' && (
          <View style={s.actionRow}>
            <PrimaryButton label="Mark Delivered" onPress={onMarkDelivered} icon="check-circle" style={{ flex: 1 }} />
            {order.shipments[0]?.trackingNumber && (
              <SecondaryButton label="View Tracking" onPress={() => Alert.alert('Tracking', order.shipments[0].trackingNumber ?? '')} icon="map-pin" style={{ flex: 1 }} />
            )}
          </View>
        )}
        {order.status === 'delivered' && (
          <BrandthreadCard style={s.deliveredCard}>
            <Feather name="check-circle" size={ICON.md} color={SUCCESS} />
            <Text style={s.deliveredText}>Order delivered · Read-only</Text>
          </BrandthreadCard>
        )}
        {(order.status === 'new' || order.status === 'processing' || order.status === 'ready_to_ship') && order.status !== 'new' && (
          <SecondaryButton label="Cancel Order" onPress={onCancelPress} icon="x" accent={RED} />
        )}
      </View>

      {/* Risk Flags */}
      {order.riskFlags.length > 0 && (
        <View style={s.section}>
          <SectionHeader title="Risk Flags" />
          {order.riskFlags.map(f => (
            <View key={f.id} style={s.riskRow}>
              <Feather name="alert-circle" size={ICON.sm} color={f.severity === 'high' ? RED : ORANGE} />
              <Text style={s.riskRowText}>{f.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Pre-order info */}
      {order.isPreOrder && order.preOrder && (
        <View style={s.section}>
          <SectionHeader title="Pre-Order Details" />
          <BrandthreadCard>
            <InfoRow label="Manufacturer" value={order.preOrder.manufacturerName ?? 'TBD'} />
            <InfoRow label="Production Status" value={order.preOrder.productionStatus.replace(/_/g, ' ')} />
            {order.preOrder.estimatedShipDate && (
              <InfoRow label="Est. Ship Date" value={fmtShort(order.preOrder.estimatedShipDate)} />
            )}
            <InfoRow label="Units Ordered" value={String(order.preOrder.unitsOrdered)} />
          </BrandthreadCard>
        </View>
      )}

      {/* Line items summary */}
      <View style={s.section}>
        <SectionHeader title="Items" />
        {order.lineItems.map(li => (
          <BrandthreadCard
            key={li.id}
            style={s.lineItemCard}
            onPress={li.productId ? () => router.push(productDetailHref(li.productId, { isOwner: true }) as never) : undefined}
          >
            <View style={s.lineItemRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.lineItemName}>{li.productName}</Text>
                <Text style={s.lineItemVariant}>{li.variant}</Text>
                {li.sku && <Text style={s.lineItemSku}>SKU: {li.sku}</Text>}
              </View>
              <View style={s.lineItemRight}>
                <Text style={s.lineItemQty}>×{li.quantity}</Text>
                <Text style={s.lineItemTotal}>{usd(li.totalCents)}</Text>
              </View>
              {li.productId ? <Feather name="chevron-right" size={ICON.sm} color={theme.muted} /> : null}
            </View>
          </BrandthreadCard>
        ))}
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// TAB: CUSTOMER
// ═══════════════════════════════════════════════════════

function CustomerTab({ order }: { order: Order }) {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const router = useRouter();
  const c = order.customer;
  return (
    <View style={s.tabContent}>
      <BrandthreadCard elevated style={s.customerHero}>
        <View style={s.avatarCircle}>
          <Text style={s.avatarInitials}>{c.initials}</Text>
        </View>
        <Text style={s.customerName}>{c.name}</Text>
        <Text style={s.customerEmail}>{c.email}</Text>
        {c.phone && <Text style={s.customerPhone}>{c.phone}</Text>}
      </BrandthreadCard>

      <BrandthreadCard style={s.customerStatsCard}>
        <InfoRow label="Total Orders" value={String(c.totalOrders)} />
        <InfoRow label="Lifetime Value" value={usd(c.lifetimeValueCents)} bold />
      </BrandthreadCard>

      {c.tags.length > 0 && (
        <View style={s.section}>
          <SectionHeader title="Customer Tags" />
          <View style={s.chipRow}>
            {c.tags.map(t => (
              <View key={t} style={s.chip}><Text style={s.chipText}>{t}</Text></View>
            ))}
          </View>
        </View>
      )}

      <View style={s.section}>
        <AddressCard title="Shipping Address" addr={c.shippingAddress} />
      </View>
      <View style={s.section}>
        <AddressCard title="Billing Address" addr={c.billingAddress} />
      </View>

      {(!!c.id || !!c.buyerUserId) && (
        <View style={[s.actionRow, { marginHorizontal: SP.md }]}>
          {!!c.id && (
            <SecondaryButton
              label="View customer"
              onPress={() => router.push(`/customer-orders?customerId=${encodeURIComponent(c.id)}` as never)}
              icon="user"
              style={{ flex: 1 }}
            />
          )}
          {!!c.buyerUserId && (
            <SecondaryButton
              label="View profile"
              onPress={() => router.push(profileHref({ userId: c.buyerUserId!, accountType: 'buyer', name: c.name, initials: c.initials }) as never)}
              icon="external-link"
              style={{ flex: 1 }}
            />
          )}
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// TAB: PAYMENT
// ═══════════════════════════════════════════════════════

function PaymentTab({ order }: { order: Order }) {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const p = order.payment;
  return (
    <View style={s.tabContent}>
      <SectionHeader title="Payment Breakdown" />
      <BrandthreadCard>
        <InfoRow label="Subtotal" value={usd(p.subtotalCents)} />
        {p.discountTotalCents > 0 && <InfoRow label="Discounts" value={`-${usd(p.discountTotalCents)}`} valueColor={SUCCESS} />}
        <InfoRow label="Shipping" value={usd(p.shippingTotalCents)} />
        <InfoRow label="Tax" value={usd(p.taxTotalCents)} />
        <View style={s.divider} />
        <InfoRow label="Total" value={usd(p.totalCents)} bold />
        <InfoRow label="Amount Paid" value={usd(p.amountPaidCents)} valueColor={SUCCESS} />
        {p.amountRefundedCents > 0 && <InfoRow label="Amount Refunded" value={`-${usd(p.amountRefundedCents)}`} valueColor={RED} />}
        <InfoRow label="Amount Held" value={usd(p.amountHeldCents)} valueColor={ORANGE} />
      </BrandthreadCard>

      {order.heldFunds && (
        <View style={s.section}>
          <SectionHeader title="Held Funds" />
          <GradientCard style={{ borderColor: ORANGE + '55' }}>
            <View style={s.heldFundsNotice}>
              <Feather name="lock" size={ICON.sm} color={ORANGE} />
              <Text style={s.heldFundsNoticeText}>
                Funds are held based on fulfillment milestones. This is not legally guaranteed escrow.
              </Text>
            </View>
            <View style={s.heldFundsGrid}>
              <View style={s.heldFundStat}>
                <Text style={s.heldFundLabel}>Currently Held</Text>
                <Text style={[s.heldFundValue, { color: ORANGE }]}>{usd(order.heldFunds.currentlyHeldCents)}</Text>
              </View>
              <View style={s.heldFundStat}>
                <Text style={s.heldFundLabel}>Seller Pending</Text>
                <Text style={[s.heldFundValue, { color: SUCCESS }]}>{usd(order.heldFunds.sellerPendingCents)}</Text>
              </View>
              <View style={s.heldFundStat}>
                <Text style={s.heldFundLabel}>Platform Fee</Text>
                <Text style={s.heldFundValue}>{usd(order.heldFunds.platformFeeCents)}</Text>
              </View>
            </View>
            <Text style={s.milestoneTitle}>Payout Milestones</Text>
            {order.heldFunds.milestones.map(m => (
              <View key={m.key} style={s.milestoneRow}>
                <Feather name={m.completedAt ? 'check-circle' : 'circle'} size={ICON.sm} color={m.completedAt ? SUCCESS : SUBTLE} />
                <Text style={[s.milestoneLabel, m.completedAt && { color: FG }]}>{m.label}</Text>
                {m.completedAt && <Text style={s.milestoneDate}>{fmtShort(m.completedAt)}</Text>}
              </View>
            ))}
            {order.heldFunds.expectedReleaseDate && (
              <Text style={s.expectedRelease}>Expected release: {fmt(order.heldFunds.expectedReleaseDate)}</Text>
            )}
          </GradientCard>
        </View>
      )}

      {order.refunds.length > 0 && (
        <View style={s.section}>
          <SectionHeader title="Refunds" />
          {order.refunds.map(r => (
            <BrandthreadCard key={r.id} style={s.refundCard}>
              <View style={s.refundHeader}>
                <StatusBadge label={r.status.toUpperCase()} variant={r.status === 'completed' ? 'success' : r.status === 'failed' ? 'error' : 'warning'} />
                <StatusBadge label={r.type.replace(/_/g, ' ')} variant="neutral" />
                <Text style={s.refundAmount}>{usd(r.totalAmountCents)}</Text>
              </View>
              <Text style={s.refundDate}>{fmt(r.createdAt)}</Text>
              {r.isDemo && <Text style={s.demoTag}>Test refund</Text>}
            </BrandthreadCard>
          ))}
        </View>
      )}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// TAB: FULFILLMENT
// ═══════════════════════════════════════════════════════

function FulfillmentTab({ order, trackingForms, setTrackingForms, onAddTracking, onMarkShipped, onUpdateTracking, updatingTracking, onShowTracking, router }: {
  order: Order;
  trackingForms: Record<string, { carrier: string; tracking: string; visible: boolean }>;
  setTrackingForms: React.Dispatch<React.SetStateAction<Record<string, { carrier: string; tracking: string; visible: boolean }>>>;
  onAddTracking: (groupId: string) => void;
  onMarkShipped: () => void;
  onUpdateTracking: (status: TrackingStatus, estimatedDelivery: string | null) => Promise<void>;
  updatingTracking: boolean;
  onShowTracking: (shipmentId: string) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const { fulfillment, shipments } = order;
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>(
    order.trackingStatus ?? shipments[0]?.trackingStatus ?? 'label_created',
  );
  const [estimatedDelivery, setEstimatedDelivery] = useState(order.estimatedDelivery ?? '');
  const [trackingFormDirty, setTrackingFormDirty] = useState(false);

  useEffect(() => {
    if (trackingFormDirty) return;
    setTrackingStatus(order.trackingStatus ?? shipments[0]?.trackingStatus ?? 'label_created');
    setEstimatedDelivery(order.estimatedDelivery ?? shipments[0]?.estimatedDelivery ?? '');
  }, [order.trackingStatus, order.estimatedDelivery, shipments, trackingFormDirty]);

  async function saveTrackingUpdate() {
    await onUpdateTracking(trackingStatus, estimatedDelivery.trim() || null);
    setTrackingFormDirty(false);
  }

  function getForm(groupId: string) {
    return trackingForms[groupId] ?? { carrier: '', tracking: '', visible: false };
  }
  function updateForm(groupId: string, key: 'carrier' | 'tracking', val: string) {
    setTrackingForms(prev => ({ ...prev, [groupId]: { ...getForm(groupId), [key]: val } }));
  }
  function toggleForm(groupId: string) {
    setTrackingForms(prev => ({ ...prev, [groupId]: { ...getForm(groupId), visible: !getForm(groupId).visible } }));
  }

  return (
    <View style={s.tabContent}>
      <View style={s.section}>
        <SectionHeader title="Tracking Status" />
        <BrandthreadCard style={s.trackingStatusCard}>
          <Text style={s.trackingStatusHint}>
            Keep buyers up to date as this order moves through delivery.
          </Text>
          <View style={s.trackingStatusOptions}>
            {TRACKING_STATUS_OPTIONS.map(option => {
              const selected = trackingStatus === option.key;
              return (
                <PressableScale
                  key={option.key}
                  onPress={() => {
                    hapticToggle();
                    setTrackingStatus(option.key);
                    setTrackingFormDirty(true);
                  }}
                  style={[s.trackingStatusOption, selected && s.trackingStatusOptionSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Set tracking status to ${option.label}`}
                  testID={`tracking-status-${option.key}`}
                >
                  <Text style={[s.trackingStatusOptionText, selected && s.trackingStatusOptionTextSelected]}>
                    {option.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
          <Text style={s.estimatedDeliveryLabel}>Estimated delivery (optional)</Text>
          <TextInput
            style={s.inlineInput}
            value={estimatedDelivery}
            onChangeText={value => {
              setEstimatedDelivery(value);
              setTrackingFormDirty(true);
            }}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={SUBTLE}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Estimated delivery date"
            testID="estimated-delivery-input"
          />
          <PrimaryButton
            label="Save Tracking Update"
            icon="check"
            small
            loading={updatingTracking}
            disabled={updatingTracking || !trackingFormDirty}
            onPress={saveTrackingUpdate}
          />
        </BrandthreadCard>
      </View>

      {fulfillment.groups.map((group, idx) => {
        const groupItems = order.lineItems.filter(li => group.lineItemIds.includes(li.id));
        const form = getForm(group.id);
        const groupShipments = shipments.filter(sh => sh.fulfillmentGroupId === group.id);
        const isManufacturer = group.type === 'manufacturer';

        return (
          <View key={group.id} style={s.section}>
            <View style={s.groupHeader}>
              <Text style={s.groupTitle}>Group {idx + 1} — {isManufacturer ? 'Manufacturer Fulfilled' : 'Seller Fulfilled'}</Text>
              <StatusBadge label={group.status.replace(/_/g, ' ').toUpperCase()} variant={group.status === 'fulfilled' ? 'success' : 'warning'} />
            </View>

            {/* Line items */}
            {groupItems.map(li => (
              <BrandthreadCard key={li.id} style={s.lineItemCard}>
                <Text style={s.lineItemName}>{li.productName}</Text>
                <Text style={s.lineItemVariant}>{li.variant} · ×{li.quantity}</Text>
              </BrandthreadCard>
            ))}

            {isManufacturer ? (
              <BrandthreadCard style={s.manufacturerCard}>
                <Text style={s.manufacturerName}>{group.manufacturerName ?? 'Manufacturer'}</Text>
                <Text style={s.manufacturerStatus}>Status: {group.status.replace(/_/g, ' ')}</Text>
                <Text style={s.manufacturerNotice}>Fulfillment request sent to manufacturer</Text>
                <SecondaryButton label="Add Tracking from Manufacturer" onPress={() => toggleForm(group.id)} icon="map-pin" small style={{ marginTop: SP.sm }} />
              </BrandthreadCard>
            ) : (
              <BrandthreadCard style={s.sellerFulfillCard}>
                {/* Checklist */}
                <View style={s.checklistRow}>
                  <View style={[s.checkItem, fulfillment.isPicked && s.checkItemDone]}>
                    <Feather name={fulfillment.isPicked ? 'check-square' : 'square'} size={ICON.sm} color={fulfillment.isPicked ? SUCCESS : MUTED} />
                    <Text style={s.checkLabel}>Picked</Text>
                  </View>
                  <View style={[s.checkItem, fulfillment.isPacked && s.checkItemDone]}>
                    <Feather name={fulfillment.isPacked ? 'check-square' : 'square'} size={ICON.sm} color={fulfillment.isPacked ? SUCCESS : MUTED} />
                    <Text style={s.checkLabel}>Packed</Text>
                  </View>
                </View>

                {fulfillment.fromAddress && (
                  <View style={s.fromAddrRow}>
                    <Feather name="map-pin" size={ICON.xs} color={MUTED} />
                    <Text style={s.fromAddrText}>From: {fulfillment.fromAddress.city}, {fulfillment.fromAddress.state}</Text>
                  </View>
                )}

                <View style={s.actionRow}>
                  <SecondaryButton label="Buy Label" onPress={() => router.push(`/shipping-label?orderId=${order.id}&groupId=${group.id}`)} icon="tag" small style={{ flex: 1 }} />
                  <SecondaryButton label="Add Tracking" onPress={() => toggleForm(group.id)} icon="map-pin" small style={{ flex: 1 }} />
                </View>
              </BrandthreadCard>
            )}

            {/* Inline tracking form */}
            {form.visible && (
              <BrandthreadCard style={s.inlineForm}>
                <Text style={s.inlineFormTitle}>Add Tracking</Text>
                <TextInput style={s.inlineInput} value={form.carrier} onChangeText={v => updateForm(group.id, 'carrier', v)} placeholder="Carrier (USPS, UPS, FedEx...)" placeholderTextColor={SUBTLE} />
                <TextInput style={s.inlineInput} value={form.tracking} onChangeText={v => updateForm(group.id, 'tracking', v)} placeholder="Tracking number" placeholderTextColor={SUBTLE} />
                <View style={s.actionRow}>
                  <SecondaryButton label="Cancel" onPress={() => toggleForm(group.id)} small style={{ flex: 1 }} />
                  <PrimaryButton label="Save" onPress={() => onAddTracking(group.id)} small style={{ flex: 1 }} />
                </View>
                {form.tracking.trim().length > 0 && (
                  <SecondaryButton label="Mark Shipped" onPress={onMarkShipped} icon="send" small style={{ marginTop: SP.sm }} />
                )}
              </BrandthreadCard>
            )}

            {/* Shipments */}
            {groupShipments.length > 0 && (
              <View style={{ marginTop: SP.sm }}>
                <Text style={s.shipmentsTitle}>Shipments</Text>
                {groupShipments.map(sh => (
                  <BrandthreadCard key={sh.id} style={s.shipmentCard}>
                    <View style={s.shipmentHeader}>
                      <Text style={s.shipmentCarrier}>{sh.carrier}</Text>
                      {sh.trackingStatus && <StatusBadge label={sh.trackingStatus.replace(/_/g, ' ')} variant={sh.trackingStatus === 'delivered' ? 'success' : 'info'} />}
                    </View>
                    {sh.trackingNumber && <Text style={s.trackingNum}>{sh.trackingNumber}</Text>}
                    {sh.trackingEvents.length > 0 && (
                      <Text style={s.latestEvent}>{sh.trackingEvents[sh.trackingEvents.length - 1].description}</Text>
                    )}
                    <PressableScale
                      onPress={() => { hapticPrimaryAction(); onShowTracking(sh.id); }}
                      style={s.viewTrackingBtn}
                      accessibilityRole="button"
                      accessibilityLabel="View tracking"
                    >
                      <Feather name="map-pin" size={ICON.xs} color={CYAN} />
                      <Text style={s.viewTrackingText}>View tracking</Text>
                    </PressableScale>
                  </BrandthreadCard>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// TAB: TIMELINE
// ═══════════════════════════════════════════════════════

function TimelineTab({ order, noteText, setNoteText, onAddNote, addingNote }: {
  order: Order;
  noteText: string;
  setNoteText: (v: string) => void;
  onAddNote: () => void;
  addingNote: boolean;
}) {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const events = [...order.timeline].reverse();
  return (
    <View style={s.tabContent}>
      <SectionHeader title="Timeline" />
      {events.map(ev => (
        <View key={ev.id} style={s.timelineRow}>
          <View style={[s.timelineDot, { backgroundColor: timelineColor(ev.type, theme) }]} />
          <View style={s.timelineBody}>
            <Text style={s.timelineMessage}>{ev.message}</Text>
            <View style={s.timelineMeta}>
              <Text style={s.timelineTime}>{fmtTime(ev.createdAt)}</Text>
              {ev.isCustomerVisible && (
                <View style={s.timelineTag}>
                  <Feather name="eye" size={10} color={CYAN} />
                  <Text style={[s.timelineTagText, { color: CYAN }]}>Customer</Text>
                </View>
              )}
              {ev.isSellerNote && (
                <View style={s.timelineTag}>
                  <Feather name="lock" size={10} color={ORANGE} />
                  <Text style={[s.timelineTagText, { color: ORANGE }]}>Internal</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      ))}

      <View style={s.divider} />
      <SectionHeader title="Add Internal Note" />
      <View style={s.noteFormCard}>
        <TextInput
          style={s.noteInput}
          value={noteText}
          onChangeText={setNoteText}
          placeholder="Write an internal note..."
          placeholderTextColor={SUBTLE}
          multiline
        />
        <PrimaryButton label="Add Note" onPress={onAddNote} loading={addingNote} icon="plus" small />
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// TAB: RETURNS
// ═══════════════════════════════════════════════════════

function ReturnsTab({ order, onAction, router }: {
  order: Order;
  onAction: (returnId: string, status: ReturnStatus, reason?: string) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const [denyingReturnId, setDenyingReturnId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');
  if (order.returns.length === 0) {
    return (
      <View style={s.tabContent}>
        <EmptyState icon="package" title="No Return Requests" description="No return requests have been submitted for this order." />
      </View>
    );
  }

  return (
    <View style={s.tabContent}>
      {order.returns.map(ret => (
        <BrandthreadCard key={ret.id} style={s.returnCard}>
          <View style={s.returnHeader}>
            <StatusBadge label={ret.status.replace(/_/g, ' ').toUpperCase()} variant={ret.status === 'refunded' ? 'success' : ret.status === 'denied' ? 'error' : 'warning'} />
            <Text style={s.returnResolution}>{ret.requestedResolution.replace(/_/g, ' ')}</Text>
          </View>
          <Text style={s.returnCustomer}>{ret.customerName}</Text>
          <Text style={s.returnExplanation}>{ret.customerExplanation}</Text>

          {/* Items */}
          {ret.items.map(item => (
            <View key={item.lineItemId} style={s.returnItemRow}>
              <Feather name="package" size={ICON.xs} color={MUTED} />
              <Text style={s.returnItemText}>{item.productName} · {item.variant} · ×{item.quantity}</Text>
              <Text style={s.returnItemReason}>{returnReasonLabel(item.reason)}</Text>
            </View>
          ))}

          {/* Actions */}
          <View style={s.returnActions}>
            {ret.status === 'requested' && denyingReturnId !== ret.id && (
              <>
                <SecondaryButton label="Approve" onPress={() => onAction(ret.id, 'approved')} icon="check" small accent={SUCCESS} style={{ flex: 1 }} />
                <SecondaryButton label="Deny" onPress={() => { setDenyReason(''); setDenyingReturnId(ret.id); }} icon="x" small accent={RED} style={{ flex: 1 }} />
              </>
            )}
          </View>
          {ret.status === 'requested' && denyingReturnId === ret.id && (
            <View style={s.denyForm}>
              <Text style={s.denyLabel}>Denial reason (required)</Text>
              <TextInput
                style={s.denyInput}
                value={denyReason}
                onChangeText={setDenyReason}
                placeholder="Explain why the return is denied…"
                placeholderTextColor={SUBTLE}
                multiline
                autoFocus
              />
              <View style={s.returnActions}>
                <SecondaryButton
                  label="Cancel"
                  onPress={() => { setDenyingReturnId(null); setDenyReason(''); }}
                  small
                  style={{ flex: 1 }}
                />
                <PrimaryButton
                  label="Submit denial"
                  onPress={() => {
                    if (!denyReason.trim()) return;
                    onAction(ret.id, 'denied', denyReason.trim());
                    setDenyingReturnId(null);
                    setDenyReason('');
                  }}
                  disabled={!denyReason.trim()}
                  small
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          )}
          <View style={s.returnActions}>
            {(ret.status === 'label_issued' || ret.status === 'in_transit') && (
              <SecondaryButton label="Mark Received" onPress={() => onAction(ret.id, 'received')} icon="inbox" small style={{ flex: 1 }} />
            )}
            {ret.status === 'received' && (
              <SecondaryButton label="Mark Inspected" onPress={() => onAction(ret.id, 'inspected')} icon="search" small style={{ flex: 1 }} />
            )}
            {(ret.status === 'inspected' || ret.status === 'refund_pending') && (
              <PrimaryButton label="Issue Refund" onPress={() => router.push(`/refund-detail?orderId=${order.id}&returnId=${ret.id}`)} icon="credit-card" small style={{ flex: 1 }} />
            )}
          </View>
        </BrandthreadCard>
      ))}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// TAB: DISPUTES
// ═══════════════════════════════════════════════════════

function DisputesTab({ order, router }: { order: Order; router: ReturnType<typeof useRouter> }) {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  if (order.disputes.length === 0) {
    return (
      <View style={s.tabContent}>
        <EmptyState icon="shield" title="No Disputes" description="No disputes have been opened for this order." />
      </View>
    );
  }

  return (
    <View style={s.tabContent}>
      {order.disputes.map(d => {
        const daysUntilDeadline = d.evidenceDeadline
          ? Math.ceil((new Date(d.evidenceDeadline).getTime() - Date.now()) / 86400000)
          : null;
        const deadlineUrgent = daysUntilDeadline !== null && daysUntilDeadline <= 5;

        return (
          <GradientCard key={d.id} colors={['rgba(248,113,113,0.12)', 'rgba(248,113,113,0.04)']} style={s.disputeCard} glow>
            <View style={s.disputeHeader}>
              <StatusBadge label={d.status.replace(/_/g, ' ').toUpperCase()} variant={d.status === 'won' ? 'success' : d.status === 'lost' ? 'error' : 'warning'} />
              <Text style={s.disputeType}>{d.type.replace(/_/g, ' ')}</Text>
              <Text style={s.disputeAmount}>{usd(d.amountCents)}</Text>
            </View>

            <Text style={s.disputeClaim}>{d.customerClaim}</Text>

            {d.evidenceDeadline && (
              <View style={s.disputeDeadlineRow}>
                <Feather name="clock" size={ICON.xs} color={deadlineUrgent ? ORANGE : MUTED} />
                <Text style={[s.disputeDeadline, deadlineUrgent && { color: ORANGE }]}>
                  Evidence due {fmt(d.evidenceDeadline)}{deadlineUrgent ? ` (${daysUntilDeadline}d)` : ''}
                </Text>
              </View>
            )}

            <Text style={s.disputeEvCount}>Evidence: {d.evidence.length} item{d.evidence.length !== 1 ? 's' : ''}</Text>

            <View style={s.disputeActions}>
              {/* "Accept Dispute" is hidden here until it calls a real disputes API —
                  see dispute-detail.tsx, which owns evidence and concede actions. */}
              <SecondaryButton label="Review Dispute" onPress={() => router.push(`/dispute-detail?orderId=${order.id}&disputeId=${d.id}`)} icon="plus" small style={{ flex: 1 }} />
            </View>
            {d.status === 'evidence_needed' && (
              <PrimaryButton label="Submit Evidence" onPress={() => router.push(`/dispute-detail?orderId=${order.id}&disputeId=${d.id}`)} icon="upload" small style={{ marginTop: SP.sm }} />
            )}
          </GradientCard>
        );
      })}
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// TAB: NOTES
// ═══════════════════════════════════════════════════════

function NotesTab({ order, noteText, setNoteText, noteType, setNoteType, onAddNote, addingNote, onPinNote }: {
  order: Order;
  noteText: string;
  setNoteText: (v: string) => void;
  noteType: 'internal' | 'customer' | 'manufacturer';
  setNoteType: (t: 'internal' | 'customer' | 'manufacturer') => void;
  onAddNote: () => void;
  addingNote: boolean;
  onPinNote: (noteId: string, current: boolean) => void;
}) {
  const { theme, BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } = useThemeAliases();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  const sorted = [...order.notes].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  function noteTypeColor(t: string) {
    switch (t) {
      case 'internal': return PURPLE;
      case 'customer': return CYAN;
      case 'manufacturer': return ORANGE;
      default: return MUTED;
    }
  }
  function noteTypeVariant(t: string): 'purple' | 'info' | 'warning' {
    switch (t) {
      case 'internal': return 'purple';
      case 'customer': return 'info';
      case 'manufacturer': return 'warning';
      default: return 'purple';
    }
  }

  return (
    <View style={s.tabContent}>
      {sorted.length === 0 && (
        <Text style={s.emptyNotes}>No notes yet. Add one below.</Text>
      )}
      {sorted.map(note => (
        <BrandthreadCard key={note.id} style={s.noteCard}>
          <View style={s.noteHeader}>
            <StatusBadge label={note.type.toUpperCase()} variant={noteTypeVariant(note.type)} />
            {note.isPinned && <Feather name="bookmark" size={ICON.xs} color={GOLD} />}
            <PressableScale
              onPress={() => { hapticToggle(); onPinNote(note.id, note.isPinned); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginLeft: 'auto' }}
              accessibilityRole="button"
              accessibilityLabel={note.isPinned ? 'Unpin note' : 'Pin note'}
            >
              <Text style={[s.pinToggle, { color: note.isPinned ? ORANGE : MUTED }]}>{note.isPinned ? 'Unpin' : 'Pin'}</Text>
            </PressableScale>
          </View>
          <Text style={s.noteContent}>{note.content}</Text>
          <Text style={s.noteMeta}>{note.authorName} · {fmtTime(note.createdAt)}</Text>
        </BrandthreadCard>
      ))}

      <View style={s.divider} />
      <SectionHeader title="Add Note" />

      {/* Type selector */}
      <View style={s.noteTypeRow}>
        {(['internal', 'customer', 'manufacturer'] as const).map(t => (
          <PressableScale
            key={t}
            onPress={() => { hapticToggle(); setNoteType(t); }}
            style={[s.noteTypeChip, noteType === t && { borderColor: noteTypeColor(t), backgroundColor: noteTypeColor(t) + '22' }]}
            accessibilityRole="button"
            accessibilityState={{ selected: noteType === t }}
            accessibilityLabel={t}
          >
            <Text style={[s.noteTypeText, noteType === t && { color: noteTypeColor(t) }]}>{t}</Text>
          </PressableScale>
        ))}
      </View>

      <View style={s.noteFormCard}>
        <TextInput
          style={s.noteInput}
          value={noteText}
          onChangeText={setNoteText}
          placeholder="Write a note..."
          placeholderTextColor={SUBTLE}
          multiline
        />
        <PrimaryButton label="Add Note" onPress={onAddNote} loading={addingNote} icon="plus" small />
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const { background: BG, surface: SURFACE, card: CARD, cardElevated: CARD_ELEVATED,
    border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE, accent: PURPLE,
    accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN,
    secondaryDim: CYAN_DIM, success: SUCCESS, warning: ORANGE, error: RED,
    onAccent: ON_DARK } = theme;
  const SUCCESS_DIM = `${SUCCESS}26`;
  const ORANGE_DIM = `${ORANGE}26`;
  const RED_DIM = `${RED}26`;
  const BLUE = theme.accentLight;
  const BLUE_DIM = `${BLUE}26`;
  const BORDER_ACTIVE = theme.accentLight;
  const GOLD = theme.accent;
  const GRAD_CARD_GLOW = theme.glowGradient;
  return StyleSheet.create({
  root:             { flex: 1, backgroundColor: 'transparent' },
  centered:         { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },

  // Tab bar
  tabBar:           { borderBottomWidth: 1, borderBottomColor: BORDER, maxHeight: 52, backgroundColor: SURFACE },
  tabBarContent:    { paddingHorizontal: SP.md, paddingVertical: SP.xs, gap: SP.xs, alignItems: 'center' },
  tabItem:          { paddingHorizontal: SP.md, paddingVertical: SP.xs + 2, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: 'transparent', backgroundColor: 'transparent' },
  tabItemActive:    { borderColor: PURPLE_DIM, backgroundColor: PURPLE_DIM },
  tabLabel:         { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  tabLabelActive:   { color: FG, fontFamily: FONT.semibold },

  // Content
  content:          { flex: 1 },
  tabContent:       { padding: SP.md, gap: SP.md },
  section:          { gap: SP.sm },

  // Hero / Overview
  heroCard:         { marginBottom: SP.sm },
  heroRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timelineCard:     { marginBottom: SP.md, paddingVertical: SP.md },
  heroOrderNum:     { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  badgeRow:         { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap' },
  heroDate:         { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: SP.xs },
  heroMeta:         { flexDirection: 'row', gap: SP.xs, marginTop: SP.xs, flexWrap: 'wrap' },
  heroMetaText:     { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  riskBadge:        { flexDirection: 'row', gap: SP.xs, alignItems: 'center', backgroundColor: RED_DIM, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: SP.xs, marginTop: SP.sm, alignSelf: 'flex-start' },
  riskBadgeText:    { fontSize: FS.xs, fontFamily: FONT.bold, color: RED },
  preOrderBadge:    { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: SP.xs, marginTop: SP.xs, alignSelf: 'flex-start' },
  preOrderBadgeText:{ fontSize: FS.xs, fontFamily: FONT.bold, color: PURPLE },

  // Actions
  actionSection:    { gap: SP.sm },
  actionRow:        { flexDirection: 'row', gap: SP.sm },
  actionCol:        { gap: SP.sm },
  deliveredCard:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  deliveredText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: SUCCESS },

  // Risk
  riskRow:          { flexDirection: 'row', gap: SP.sm, alignItems: 'center', paddingVertical: SP.xs },
  riskRowText:      { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, flex: 1 },

  // InfoRow
  infoRow:          { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SP.xs },
  infoLabel:        { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  infoValue:        { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  infoValueBold:    { fontFamily: FONT.bold, fontSize: FS.base },

  // Line items
  lineItemCard:     { marginBottom: SP.xs },
  lineItemRow:      { flexDirection: 'row', alignItems: 'center' },
  lineItemName:     { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  lineItemVariant:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  lineItemSku:      { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  lineItemRight:    { alignItems: 'flex-end' },
  lineItemQty:      { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  lineItemTotal:    { fontSize: FS.sm, fontFamily: FONT.bold, color: FG },

  // Customer
  customerHero:     { alignItems: 'center', gap: SP.sm },
  avatarCircle:     { width: 64, height: 64, borderRadius: RADII.pill, backgroundColor: PURPLE_DIM, borderWidth: 2, borderColor: BORDER_ACTIVE, alignItems: 'center', justifyContent: 'center' },
  avatarInitials:   { fontSize: FS.xl, fontFamily: FONT.bold, color: PURPLE },
  customerName:     { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  customerEmail:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  customerPhone:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  customerStatsCard:{ gap: SP.xs },
  addressCard:      { gap: SP.xs, marginBottom: SP.sm },
  addressTitle:     { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.xs },
  addressText:      { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },

  // Chips
  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chip:             { paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: RADIUS.pill, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  chipActive:       { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  chipText:         { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  chipTextActive:   { color: FG },

  // Payment
  divider:          { height: 1, backgroundColor: BORDER, marginVertical: SP.sm },
  heldFundsNotice:  { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', marginBottom: SP.md },
  heldFundsNoticeText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20 },
  heldFundsGrid:    { flexDirection: 'row', gap: SP.md, marginBottom: SP.md },
  heldFundStat:     { flex: 1, alignItems: 'center' },
  heldFundLabel:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  heldFundValue:    { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  milestoneTitle:   { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.sm },
  milestoneRow:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs },
  milestoneLabel:   { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  milestoneDate:    { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  expectedRelease:  { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: SP.sm },
  refundCard:       { gap: SP.xs, marginBottom: SP.xs },
  refundHeader:     { flexDirection: 'row', gap: SP.sm, alignItems: 'center', flexWrap: 'wrap' },
  refundAmount:     { fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginLeft: 'auto' },
  refundDate:       { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  demoTag:          { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },

  // Fulfillment
  trackingStatusCard: { gap: SP.sm, borderColor: BORDER_ACTIVE },
  trackingStatusHint: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
  trackingStatusOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs },
  trackingStatusOption: { paddingHorizontal: SP.sm, paddingVertical: SP.xs, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER, backgroundColor: SURFACE },
  trackingStatusOptionSelected: { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  trackingStatusOptionText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  trackingStatusOptionTextSelected: { color: FG },
  estimatedDeliveryLabel: { fontSize: FS.xs, fontFamily: FONT.semibold, color: MUTED, marginTop: SP.xs },
  groupHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
  groupTitle:       { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  manufacturerCard: { gap: SP.sm },
  manufacturerName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  manufacturerStatus:{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  manufacturerNotice:{ fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  sellerFulfillCard:{ gap: SP.sm },
  checklistRow:     { flexDirection: 'row', gap: SP.md },
  checkItem:        { flexDirection: 'row', gap: SP.xs, alignItems: 'center' },
  checkItemDone:    {},
  checkLabel:       { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  fromAddrRow:      { flexDirection: 'row', gap: SP.xs, alignItems: 'center' },
  fromAddrText:     { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  inlineForm:       { gap: SP.sm, borderColor: BORDER_ACTIVE },
  inlineFormTitle:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  inlineInput:      { backgroundColor: SURFACE, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, fontSize: FS.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  shipmentsTitle:   { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.xs },
  shipmentCard:     { gap: SP.xs, marginBottom: SP.xs },
  shipmentHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  shipmentCarrier:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  trackingNum:      { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  latestEvent:      { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  viewTrackingBtn:  { flexDirection: 'row', gap: SP.xs, alignItems: 'center', marginTop: SP.xs },
  viewTrackingText: { fontSize: FS.xs, fontFamily: FONT.medium, color: CYAN },

  // Timeline
  timelineRow:      { flexDirection: 'row', gap: SP.sm, marginBottom: SP.sm },
  timelineDot:      { width: 10, height: 10, borderRadius: RADII.pill, marginTop: 4 },
  timelineBody:     { flex: 1 },
  timelineMessage:  { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20 },
  timelineMeta:     { flexDirection: 'row', gap: SP.sm, alignItems: 'center', marginTop: 2 },
  timelineTime:     { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  timelineTag:      { flexDirection: 'row', gap: 3, alignItems: 'center' },
  timelineTagText:  { fontSize: FS.xs, fontFamily: FONT.medium },

  // Notes
  noteFormCard:     { gap: SP.sm, backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md },
  noteInput:        { color: FG, fontFamily: FONT.regular, fontSize: FS.sm, minHeight: 80, textAlignVertical: 'top' },
  emptyNotes:       { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', paddingVertical: SP.lg },
  noteCard:         { gap: SP.sm, marginBottom: SP.xs },
  noteHeader:       { flexDirection: 'row', gap: SP.sm, alignItems: 'center' },
  noteContent:      { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20 },
  noteMeta:         { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  pinToggle:        { fontSize: FS.xs, fontFamily: FONT.medium },
  noteTypeRow:      { flexDirection: 'row', gap: SP.sm, marginBottom: SP.sm },
  noteTypeChip:     { paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  noteTypeText:     { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, textTransform: 'capitalize' },

  // Returns
  returnCard:       { gap: SP.sm, marginBottom: SP.sm },
  returnHeader:     { flexDirection: 'row', gap: SP.sm, alignItems: 'center', flexWrap: 'wrap' },
  returnResolution: { fontSize: FS.xs, fontFamily: FONT.medium, color: CYAN, textTransform: 'capitalize' },
  returnCustomer:   { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  returnExplanation:{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
  returnItemRow:    { flexDirection: 'row', gap: SP.xs, alignItems: 'center', paddingVertical: 2 },
  returnItemText:   { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, flex: 1 },
  returnItemReason: { fontSize: FS.xs, fontFamily: FONT.regular, color: ORANGE },
  returnActions:    { flexDirection: 'row', gap: SP.sm, flexWrap: 'wrap', marginTop: SP.xs },
  denyForm:         { gap: SP.sm, marginTop: SP.xs },
  denyLabel:        { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  denyInput:        { minHeight: 72, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD, color: FG, padding: SP.sm, fontSize: FS.sm, fontFamily: FONT.regular, textAlignVertical: 'top' },

  // Disputes
  disputeCard:      { gap: SP.sm, marginBottom: SP.sm },
  disputeHeader:    { flexDirection: 'row', gap: SP.sm, alignItems: 'center', flexWrap: 'wrap' },
  disputeType:      { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, textTransform: 'capitalize' },
  disputeAmount:    { fontSize: FS.base, fontFamily: FONT.bold, color: RED, marginLeft: 'auto' },
  disputeClaim:     { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20 },
  disputeDeadlineRow:{ flexDirection: 'row', gap: SP.xs, alignItems: 'center' },
  disputeDeadline:  { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  disputeEvCount:   { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  disputeActions:   { flexDirection: 'row', gap: SP.sm },

  // Modal
  modalOverlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' },
  modalCard:        { backgroundColor: CARD_ELEVATED, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER, padding: SP.lg, gap: SP.md, maxHeight: '90%' },
  modalTitle:       { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  modalSubtitle:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  modalActions:     { flexDirection: 'row', gap: SP.sm },
  cancelNoteInput:  { backgroundColor: SURFACE, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, color: FG, fontFamily: FONT.regular, fontSize: FS.sm, padding: SP.md, minHeight: 80, textAlignVertical: 'top' },
  cancellationCard:   { borderColor: RED + '44' },
  cancellationHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  cancellationTitle:  { fontSize: FS.base, fontFamily: FONT.semibold, color: RED },
  warningCard:        { borderColor: RED + '44' },
  warningRow:       { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start' },
  warningText:      { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: RED, lineHeight: 20 },
  pausedBanner:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: ORANGE_DIM, borderBottomWidth: 1, borderBottomColor: ORANGE + '55', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  pausedBannerText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.medium, color: FG },
  pausedBannerAction: { fontSize: FS.xs, fontFamily: FONT.semibold, color: ORANGE },
  cancelBanner:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: SUCCESS_DIM, borderBottomWidth: 1, borderBottomColor: SUCCESS + '55', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  cancelBannerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG },

  // Tracking modal
  trackingEventRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.sm },
  trackingDot:      { width: 10, height: 10, borderRadius: RADII.pill, marginTop: 4 },
  trackingEvDesc:   { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
  trackingEvLoc:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  trackingEvTime:   { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  });
};
