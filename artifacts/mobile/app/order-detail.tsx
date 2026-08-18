/**
 * Order Detail — full rewrite
 * Tabs: overview | customer | payment | fulfillment | timeline | returns | disputes | notes
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  StyleSheet, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, CYAN, SUCCESS, SUCCESS_DIM,
  BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  GRAD_PRIMARY, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, StatusBadge, SectionHeader, EmptyState,
} from '@/components/BrandthreadUI';
import { useApi } from '@/lib/api';
import {
  Order, PAYOUT_MILESTONES, CANCELLATION_REASONS,
  CancellationReason, ReturnStatus, RETURN_REASONS,
  OrderStatus, FulfillmentType, FulfillmentStatus,
  OrderAddress, OrderLineItem, Fulfillment, Shipment,
  OrderTimelineEvent, PaymentSummary,
} from '@/services/orderTypes';

// ─── API → Order adapter ──────────────────────────────────────────────────────

function adaptApiOrder(raw: any): Order {
  const customer = raw.customer ?? null;
  const items: any[] = raw.items ?? [];

  // DB status → UI order status
  const statusMap: Record<string, OrderStatus> = {
    pending:        'new',
    processing:     'processing',
    fulfilled:      'ready_to_ship',
    shipped:        'shipped',
    delivered:      'delivered',
    cancelled:      'cancelled',
    refunded:       'refunded',
    refund_pending: 'cancelled',  // order was cancelled; refund may need manual resolution
    disputed:       'disputed',
  };
  const uiStatus: OrderStatus = statusMap[raw.status] ?? 'cancelled';

  // Derive payment status from DB order status
  type PaymentStatus = 'pending' | 'authorized' | 'paid' | 'partially_refunded' | 'refunded' | 'voided' | 'failed';
  const paymentStatusMap: Record<string, PaymentStatus> = {
    pending:        'pending',
    processing:     'paid',
    fulfilled:      'paid',
    shipped:        'paid',
    delivered:      'paid',
    cancelled:      'voided',
    refunded:       'refunded',
    refund_pending: 'authorized',  // payment received but refund not yet confirmed — shows WARNING
    disputed:       'partially_refunded',
  };
  const uiPaymentStatus: PaymentStatus = paymentStatusMap[raw.status] ?? 'pending';
  const isRefundPending = raw.status === 'refund_pending';

  // Parse shipping address (stored as JSON in DB)
  const defaultAddr: OrderAddress = {
    name: customer?.name ?? 'Customer',
    line1: '', city: '', state: '', zip: '', country: 'US',
  };
  let shippingAddr: OrderAddress = defaultAddr;
  if (raw.shippingAddress) {
    try {
      const sa = typeof raw.shippingAddress === 'string'
        ? JSON.parse(raw.shippingAddress)
        : raw.shippingAddress;
      shippingAddr = {
        name:    sa.name    ?? customer?.name ?? 'Customer',
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
    productId:        item.variantId ?? item.id,
    productName:      item.productName,
    variant:          item.variantLabel ?? '',
    sku:              undefined,
    quantity:         item.quantity,
    unitPrice:        (item.priceCents ?? 0) / 100,
    discountAmount:   0,
    taxAmount:        0,
    total:            ((item.priceCents ?? 0) * item.quantity) / 100,
    fulfillmentSource: 'seller' as FulfillmentType,
    isPreOrder:       false,
  }));

  const totalDollars    = (raw.totalCents    ?? 0) / 100;
  const subtotalDollars = (raw.subtotalCents ?? 0) / 100;
  const shippingDollars = (raw.shippingCents ?? 0) / 100;

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

  const initials = customer?.name
    ? customer.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : 'C';

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
      id:            customer?.id ?? '',
      name:          customer?.name ?? 'Customer',
      email:         customer?.email ?? '',
      phone:         customer?.phone ?? undefined,
      initials,
      totalOrders:   customer?.orderCount ?? 1,
      lifetimeValue: (customer?.totalSpentCents ?? 0) / 100,
      tags:          customer?.tags ?? [],
      shippingAddress: shippingAddr,
      billingAddress:  shippingAddr,
    },
    lineItems,
    fulfillment,
    payment: {
      subtotal:                subtotalDollars,
      discountTotal:           0,
      shippingTotal:           shippingDollars,
      taxTotal:                0,
      total:                   totalDollars,
      // Payment was received for active/shipped/delivered; held in limbo for refund_pending
      amountPaid:              isRefundPending ? 0 : (uiStatus === 'cancelled' || uiStatus === 'refunded') ? 0 : totalDollars,
      amountRefunded:          uiStatus === 'refunded' ? totalDollars : 0,
      amountHeld:              isRefundPending ? totalDollars : 0,
      amountPending:           0,
      sellerAllocation:        subtotalDollars,
      manufacturerAllocation:  0,
      shippingLabelAllocation: shippingDollars,
      platformFee:             0,
      payoutStatus:            isRefundPending ? 'held' : uiStatus === 'refunded' ? 'paid' : 'pending',
    },
    shipments,
    labels:    [],
    returns:   [],
    refunds:   [],
    disputes:  [],
    timeline,
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
  { key: 'notes',       label: 'Notes' },
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
function usd(n: number) {
  return `$${n.toFixed(2)}`;
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

function timelineColor(type: string): string {
  switch (type) {
    case 'order_created': return CYAN;
    case 'payment_confirmed': return SUCCESS;
    case 'shipped': case 'label_purchased': case 'tracking_added': return BLUE;
    case 'delivered': return SUCCESS;
    case 'return_requested': case 'refund_issued': return ORANGE;
    case 'dispute_opened': case 'cancelled': return RED;
    case 'risk_review': return RED;
    case 'note_added': return PURPLE;
    default: return MUTED;
  }
}

function returnReasonLabel(key: string): string {
  return RETURN_REASONS.find(r => r.key === key)?.label ?? key;
}

// ─── InfoRow ─────────────────────────────────────────────────────────────────

function InfoRow({ label, value, valueColor, bold }: { label: string; value: string; valueColor?: string; bold?: boolean }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={[s.infoValue, bold && s.infoValueBold, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

// ─── AddressCard ─────────────────────────────────────────────────────────────

function AddressCard({ title, addr }: { title: string; addr: { name: string; line1: string; line2?: string; city: string; state: string; zip: string; country: string } }) {
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
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
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

  // Tracking events modal
  const [trackingModalShipmentId, setTrackingModalShipmentId] = useState<string | null>(null);

  // Backoff: stop polling after 3 consecutive failures; resume on next focus.
  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);
  const hasLoadedRef = useRef(false);

  const load = useCallback(async (generation: number) => {
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const raw = await api.orders.get(id);
      if (generationRef.current !== generation) return; // stale focus cycle
      setOrder(adaptApiOrder(raw));
      consecutiveFailuresRef.current = 0;
    } catch {
      if (generationRef.current !== generation) return; // stale focus cycle
      if (!hasLoadedRef.current) setOrder(null);
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3 && timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    } finally {
      if (generationRef.current === generation) {
        setLoading(false);
        hasLoadedRef.current = true;
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

  // ── Actions ──────────────────────────────────────────────────────────────

  async function handleMarkProcessing() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await api.orders.updateStatus(id, 'processing'); } catch (e: any) { Alert.alert('Error', e.message); return; }
    load(generationRef.current);
  }

  async function handleMarkReadyToShip() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await api.orders.updateStatus(id, 'fulfilled'); } catch (e: any) { Alert.alert('Error', e.message); return; }
    load(generationRef.current);
  }

  async function handleMarkShipped() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await api.orders.updateStatus(id, 'shipped'); } catch (e: any) { Alert.alert('Error', e.message); return; }
    load(generationRef.current);
  }

  async function handleMarkDelivered() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try { await api.orders.updateStatus(id, 'delivered'); } catch (e: any) { Alert.alert('Error', e.message); return; }
    load(generationRef.current);
  }

  async function handleCancelOrder() {
    if (!cancelReason) {
      Alert.alert('Select a reason', 'Please choose a cancellation reason.');
      return;
    }
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
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
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
      Alert.alert('Error', e.message);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
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
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>
        <View style={s.headerMid}>
          <Text style={s.headerTitle}>{order.orderNumber}</Text>
          <Text style={s.headerSub}>{order.customer.name}</Text>
        </View>
        <IconButton name="refresh-cw" onPress={() => load(generationRef.current)} color={MUTED} />
      </View>

      {/* Tab bar */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={s.tabBar}
        contentContainerStyle={s.tabBarContent}
      >
        {TABS.map(t => (
          <TouchableOpacity
            key={t.key}
            onPress={() => { Haptics.selectionAsync(); setActiveTab(t.key); }}
            style={[s.tabItem, activeTab === t.key && s.tabItemActive]}
          >
            <Text style={[s.tabLabel, activeTab === t.key && s.tabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Cancellation confirmed banner */}
      {cancelConfirmed && (
        <View style={s.cancelBanner}>
          <Feather name="check-circle" size={ICON.sm} color={FG} />
          <Text style={s.cancelBannerText}>Order cancelled successfully.</Text>
          <TouchableOpacity onPress={() => setCancelConfirmed(false)}>
            <Feather name="x" size={ICON.sm} color={FG} />
          </TouchableOpacity>
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
        {activeTab === 'fulfillment' && <FulfillmentTab order={order} trackingForms={trackingForms} setTrackingForms={setTrackingForms} onAddTracking={handleAddTracking} onMarkShipped={handleMarkShipped} onShowTracking={(sid) => setTrackingModalShipmentId(sid)} router={router} />}
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
                <TouchableOpacity
                  key={r.key}
                  onPress={() => setCancelReason(r.key)}
                  style={[s.chip, cancelReason === r.key && s.chipActive]}
                >
                  <Text style={[s.chipText, cancelReason === r.key && s.chipTextActive]}>{r.label}</Text>
                </TouchableOpacity>
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
                colors={[RED, '#C0392B']}
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
                    <View style={[s.trackingDot, { backgroundColor: timelineColor(ev.status) }]} />
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
            <SecondaryButton label="Buy Shipping Label" onPress={() => router.push(`/shipping-label?orderId=${order.id}`)} icon="tag" style={{ flex: 1 }} />
          </View>
        )}
        {order.status === 'ready_to_ship' && (
          <View style={s.actionCol}>
            <View style={s.actionRow}>
              <PrimaryButton label="Buy Label" onPress={() => router.push(`/shipping-label?orderId=${order.id}`)} icon="tag" style={{ flex: 1 }} />
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
          <BrandthreadCard key={li.id} style={s.lineItemCard}>
            <View style={s.lineItemRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.lineItemName}>{li.productName}</Text>
                <Text style={s.lineItemVariant}>{li.variant}</Text>
                {li.sku && <Text style={s.lineItemSku}>SKU: {li.sku}</Text>}
              </View>
              <View style={s.lineItemRight}>
                <Text style={s.lineItemQty}>×{li.quantity}</Text>
                <Text style={s.lineItemTotal}>{usd(li.total)}</Text>
              </View>
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
        <InfoRow label="Lifetime Value" value={usd(c.lifetimeValue)} bold />
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

      <View style={[s.actionRow, { marginHorizontal: SP.md }]}>
        <SecondaryButton label="Message Customer" onPress={() => Alert.alert('Message', 'Messaging coming soon.')} icon="message-circle" style={{ flex: 1 }} />
        <SecondaryButton label="View Profile" onPress={() => Alert.alert('Profile', 'Customer profile coming soon.')} icon="user" style={{ flex: 1 }} />
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════
// TAB: PAYMENT
// ═══════════════════════════════════════════════════════

function PaymentTab({ order }: { order: Order }) {
  const p = order.payment;
  return (
    <View style={s.tabContent}>
      <SectionHeader title="Payment Breakdown" />
      <BrandthreadCard>
        <InfoRow label="Subtotal" value={usd(p.subtotal)} />
        {p.discountTotal > 0 && <InfoRow label="Discounts" value={`-${usd(p.discountTotal)}`} valueColor={SUCCESS} />}
        <InfoRow label="Shipping" value={usd(p.shippingTotal)} />
        <InfoRow label="Tax" value={usd(p.taxTotal)} />
        <View style={s.divider} />
        <InfoRow label="Total" value={usd(p.total)} bold />
        <InfoRow label="Amount Paid" value={usd(p.amountPaid)} valueColor={SUCCESS} />
        {p.amountRefunded > 0 && <InfoRow label="Amount Refunded" value={`-${usd(p.amountRefunded)}`} valueColor={RED} />}
        <InfoRow label="Amount Held" value={usd(p.amountHeld)} valueColor={ORANGE} />
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
                <Text style={[s.heldFundValue, { color: ORANGE }]}>{usd(order.heldFunds.currentlyHeld)}</Text>
              </View>
              <View style={s.heldFundStat}>
                <Text style={s.heldFundLabel}>Seller Pending</Text>
                <Text style={[s.heldFundValue, { color: SUCCESS }]}>{usd(order.heldFunds.sellerPending)}</Text>
              </View>
              <View style={s.heldFundStat}>
                <Text style={s.heldFundLabel}>Platform Fee</Text>
                <Text style={s.heldFundValue}>{usd(order.heldFunds.platformFee)}</Text>
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
                <Text style={s.refundAmount}>{usd(r.totalAmount)}</Text>
              </View>
              <Text style={s.refundDate}>{fmt(r.createdAt)}</Text>
              {r.isDemo && <Text style={s.demoTag}>Demo refund</Text>}
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

function FulfillmentTab({ order, trackingForms, setTrackingForms, onAddTracking, onMarkShipped, onShowTracking, router }: {
  order: Order;
  trackingForms: Record<string, { carrier: string; tracking: string; visible: boolean }>;
  setTrackingForms: React.Dispatch<React.SetStateAction<Record<string, { carrier: string; tracking: string; visible: boolean }>>>;
  onAddTracking: (groupId: string) => void;
  onMarkShipped: () => void;
  onShowTracking: (shipmentId: string) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const { fulfillment, shipments } = order;

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
                <Text style={s.manufacturerNotice}>Fulfillment request sent to manufacturer (demo)</Text>
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
                    <TouchableOpacity onPress={() => onShowTracking(sh.id)} style={s.viewTrackingBtn}>
                      <Feather name="map-pin" size={ICON.xs} color={CYAN} />
                      <Text style={s.viewTrackingText}>View tracking</Text>
                    </TouchableOpacity>
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
  const events = [...order.timeline].reverse();
  return (
    <View style={s.tabContent}>
      <SectionHeader title="Timeline" />
      {events.map(ev => (
        <View key={ev.id} style={s.timelineRow}>
          <View style={[s.timelineDot, { backgroundColor: timelineColor(ev.type) }]} />
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
            {ret.status === 'requested' && (
              <>
                <SecondaryButton label="Approve" onPress={() => onAction(ret.id, 'approved')} icon="check" small accent={SUCCESS} style={{ flex: 1 }} />
                <SecondaryButton label="Deny" onPress={() => Alert.prompt('Deny Reason', 'Reason for denial:', (text) => { if (text) onAction(ret.id, 'denied', text); })} icon="x" small accent={RED} style={{ flex: 1 }} />
              </>
            )}
            {(ret.status === 'approved') && (
              <SecondaryButton label="Issue Label" onPress={() => Alert.alert('Label', 'Return label issuance available in production build.')} icon="tag" small style={{ flex: 1 }} />
            )}
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
              <Text style={s.disputeAmount}>{usd(d.amount)}</Text>
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
              <SecondaryButton label="Add Evidence" onPress={() => router.push(`/dispute-detail?orderId=${order.id}&disputeId=${d.id}`)} icon="plus" small style={{ flex: 1 }} />
              <SecondaryButton label="Accept Dispute" onPress={() => Alert.alert('Accept Dispute', 'Are you sure? This will refund the customer.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Accept', style: 'destructive', onPress: () => Alert.alert('Accepted', 'Dispute accepted (demo).') }])} icon="check" small accent={RED} style={{ flex: 1 }} />
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
            <TouchableOpacity onPress={() => onPinNote(note.id, note.isPinned)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginLeft: 'auto' }}>
              <Text style={[s.pinToggle, { color: note.isPinned ? ORANGE : MUTED }]}>{note.isPinned ? 'Unpin' : 'Pin'}</Text>
            </TouchableOpacity>
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
          <TouchableOpacity
            key={t}
            onPress={() => setNoteType(t)}
            style={[s.noteTypeChip, noteType === t && { borderColor: noteTypeColor(t), backgroundColor: noteTypeColor(t) + '22' }]}
          >
            <Text style={[s.noteTypeText, noteType === t && { color: noteTypeColor(t) }]}>{t}</Text>
          </TouchableOpacity>
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

const s = StyleSheet.create({
  root:             { flex: 1, backgroundColor: BG },
  centered:         { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },

  // Header
  header:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, gap: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:          { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  headerMid:        { flex: 1 },
  headerTitle:      { fontSize: FS.md, fontFamily: FONT.bold, color: FG },
  headerSub:        { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },

  // Tab bar
  tabBar:           { borderBottomWidth: 1, borderBottomColor: BORDER, maxHeight: 44, backgroundColor: SURFACE },
  tabBarContent:    { paddingHorizontal: SP.md, gap: SP.xs },
  tabItem:          { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabItemActive:    { borderBottomColor: PURPLE },
  tabLabel:         { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  tabLabelActive:   { color: FG, fontFamily: FONT.semibold },

  // Content
  content:          { flex: 1 },
  tabContent:       { padding: SP.md, gap: SP.md },
  section:          { gap: SP.sm },

  // Hero / Overview
  heroCard:         { marginBottom: SP.sm },
  heroRow:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  avatarCircle:     { width: 64, height: 64, borderRadius: 32, backgroundColor: PURPLE_DIM, borderWidth: 2, borderColor: BORDER_ACTIVE, alignItems: 'center', justifyContent: 'center' },
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
  timelineDot:      { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  timelineBody:     { flex: 1 },
  timelineMessage:  { fontSize: FS.sm, fontFamily: FONT.regular, color: FG, lineHeight: 20 },
  timelineMeta:     { flexDirection: 'row', gap: SP.sm, alignItems: 'center', marginTop: 2 },
  timelineTime:     { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
  timelineTag:      { flexDirection: 'row', gap: 3, alignItems: 'center' },
  timelineTagText:  { fontSize: 10, fontFamily: FONT.medium },

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
  warningCard:      { borderColor: RED + '44' },
  warningRow:       { flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start' },
  warningText:      { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: RED, lineHeight: 20 },
  cancelBanner:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: '#1A3A2A', borderBottomWidth: 1, borderBottomColor: SUCCESS + '55', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  cancelBannerText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: FG },

  // Tracking modal
  trackingEventRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.sm },
  trackingDot:      { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  trackingEvDesc:   { fontSize: FS.sm, fontFamily: FONT.regular, color: FG },
  trackingEvLoc:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  trackingEvTime:   { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },
});
