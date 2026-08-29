import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet, ActivityIndicator, Modal, TextInput,
  RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Feather } from '@expo/vector-icons';
import { BuyerOrderView, CANCELLATION_REASONS, OrderStatus, TrackingStatus } from '@/services/orderTypes';
import { useApi } from '@/hooks/useApi';
import {
  BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE, ON_DARK,
  SUCCESS, SUCCESS_DIM,
  BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  GOLD,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  GradientCard, StatusBadge, PrimaryButton, SecondaryButton,
} from '@/components/BrandthreadUI';
import { formatCents } from '@/lib/money';

// 60-minute cancellation window (mirrors server enforcement)
const CANCEL_WINDOW_MS = 60 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadgeVariant(status: OrderStatus): 'info' | 'purple' | 'warning' | 'success' | 'neutral' | 'error' {
  switch (status) {
    case 'new':           return 'info';
    case 'processing':    return 'purple';
    case 'ready_to_ship': return 'warning';
    case 'shipped':       return 'warning';
    case 'delivered':     return 'success';
    case 'cancelled':     return 'neutral';
    case 'refunded':      return 'error';
    case 'disputed':      return 'error';
    default:              return 'neutral';
  }
}

function statusBadgeLabel(status: OrderStatus): string {
  switch (status) {
    case 'new':           return 'NEW';
    case 'processing':    return 'PROCESSING';
    case 'ready_to_ship': return 'READY TO SHIP';
    case 'shipped':       return 'SHIPPED';
    case 'delivered':     return 'DELIVERED';
    case 'cancelled':     return 'CANCELLED';
    case 'refunded':      return 'REFUNDED';
    case 'disputed':      return 'DISPUTED';
    default:              return (status as string).toUpperCase();
  }
}

function trackingStatusLabel(ts: TrackingStatus): string {
  switch (ts) {
    case 'label_created':    return 'Label Created';
    case 'accepted':         return 'Accepted';
    case 'in_transit':       return 'In Transit';
    case 'out_for_delivery': return 'Out for Delivery';
    case 'delivered':        return 'Delivered';
    case 'exception':        return 'Exception';
    case 'returned_to_sender': return 'Returned to Sender';
    default: return ts;
  }
}

function trackingStatusVariant(ts: TrackingStatus): 'info' | 'purple' | 'warning' | 'success' | 'neutral' | 'error' {
  switch (ts) {
    case 'label_created': return 'neutral';
    case 'accepted':      return 'info';
    case 'in_transit':    return 'purple';
    case 'out_for_delivery': return 'warning';
    case 'delivered':     return 'success';
    case 'exception':     return 'error';
    case 'returned_to_sender': return 'error';
    default:              return 'neutral';
  }
}

function fulfillmentStatusLabel(fs: string): string {
  switch (fs) {
    case 'unfulfilled':          return 'Unfulfilled';
    case 'partially_fulfilled':  return 'Partially Fulfilled';
    case 'fulfilled':            return 'Fulfilled';
    case 'manufacturer_pending': return 'In Production';
    case 'returned':             return 'Returned';
    case 'cancelled':            return 'Cancelled';
    default:                     return fs;
  }
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sc.root}>
      <Text style={sc.title}>{title}</Text>
      <BrandthreadCard>{children}</BrandthreadCard>
    </View>
  );
}

const sc = StyleSheet.create({
  root:  { marginBottom: SP.md },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, letterSpacing: 0.4,
           textTransform: 'uppercase', marginBottom: SP.sm, paddingHorizontal: SP.md },
});

// ─── Row ──────────────────────────────────────────────────────────────────────

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={row.root}>
      <Text style={row.label}>{label}</Text>
      <Text style={[row.value, mono && row.mono]}>{value}</Text>
    </View>
  );
}

const row = StyleSheet.create({
  root:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
           paddingVertical: SP.xs },
  label: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, flex: 1 },
  value: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, flex: 1, textAlign: 'right' },
  mono:  { fontFamily: 'Inter_400Regular', letterSpacing: 0.5, fontSize: FS.xs },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

// ─── API → BuyerOrderView adapter (detail) ────────────────────────────────────

function adaptOrderDetail(row: any): BuyerOrderView {
  const dbAddr = row.shippingAddress;
  const items = Array.isArray(row.items) ? row.items : [];
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
    lineItems: items.map((item: any) => ({
      productName: item.productName,
      variant:     item.variantLabel ?? '',
      quantity:    item.quantity,
      unitPriceCents: item.priceCents ?? 0,
    })),
    shippingAddress,
    payment: {
      subtotalCents: row.subtotalCents ?? 0,
      shippingTotalCents: row.shippingCents ?? 0,
      taxTotalCents: 0,
      totalCents: row.totalCents ?? 0,
    },
    trackingNumber:      row.trackingNumber    ?? undefined,
    trackingCarrier:     row.carrier           ?? undefined,
    trackingStatus:      row.trackingStatus    ?? undefined,
    estimatedDelivery:   row.estimatedDelivery ?? undefined,
    isPreOrder:           false,
    hasReturnRequest:     false,
    cancellationReason:  row.cancellationReason ?? null,
    cancellationNotes:   row.cancellationNotes ?? null,
    isCustomerVisible:   row.isCustomerVisible === true,
    createdAt:            row.createdAt ?? new Date().toISOString(),
  };
}

// ─── Cancellation reason → human-friendly label ───────────────────────────────

function cancellationReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'No reason provided';
  // buyer_requested is the server's legacy value for a buyer-initiated
  // cancellation; the shared list contains the seller-facing equivalent.
  if (reason === 'buyer_requested') return 'You requested the cancellation';
  return CANCELLATION_REASONS.find(item => item.key === reason)?.label
    ?? reason.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function BuyerOrderDetailScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = colors.accent, CYAN = theme.secondary, CYAN_DIM = theme.secondaryDim, CYAN_LIGHT = theme.secondary;
  const BORDER_ACTIVE = `${theme.accent}73`;
  const GRAD_PRIMARY = theme.primaryGradient;
  const GRAD_CARD_GLOW = [theme.accentDim, theme.secondaryDim] as const;
  const styles = makeStyles(theme);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [order, setOrder] = useState<BuyerOrderView | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [returnRequest, setReturnRequest] = useState<any | null>(null);
  // Backoff: stop polling after 3 consecutive failures; resume on next focus.
  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll every 15 s while this screen is focused so status updates
  // (paid → processing → shipped → delivered) appear without manual refresh.
  // After 3 consecutive failures the interval is cleared to avoid hammering a
  // down/offline server; it resets on the next focus event.
  useFocusEffect(useCallback(() => {
    if (!id) return;
    let cancelled = false;
    consecutiveFailuresRef.current = 0;

    function fetchOrder() {
      api.buyer.orders.get(id!).then(row => {
        if (!cancelled) {
          setOrder(adaptOrderDetail(row));
          setFetchError(false);
          setLoading(false);
          setRefreshing(false);
          consecutiveFailuresRef.current = 0;
        }
      }).catch(() => {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
          setFetchError(true);
          consecutiveFailuresRef.current += 1;
          if (consecutiveFailuresRef.current >= 3 && timerRef.current !== null) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
        }
      });
      api.returns.listBuyer()
        .then(rows => {
          if (!cancelled) setReturnRequest(rows.find((request: any) => request.orderId === id) ?? null);
        })
        .catch(() => {});
    }

    fetchOrder();
    timerRef.current = setInterval(fetchOrder, 15_000);
    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [id]));

  function handleRetry() {
    if (!id) return;
    setLoading(true);
    setFetchError(false);
    setOrder(null);
    consecutiveFailuresRef.current = 0;
    // Clear the stale polling interval so useFocusEffect re-runs cleanly
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    api.buyer.orders.get(id).then(row => {
      setOrder(adaptOrderDetail(row));
      setFetchError(false);
      setLoading(false);
      timerRef.current = setInterval(() => {
        api.buyer.orders.get(id).then(r => setOrder(adaptOrderDetail(r))).catch(() => {});
        api.returns.listBuyer().then(rows => setReturnRequest(rows.find((request: any) => request.orderId === id) ?? null)).catch(() => {});
      }, 15_000);
    }).catch(() => {
      setLoading(false);
      setFetchError(true);
    });
  }

  function handlePullRefresh() {
    if (!id || refreshing) return;
    setRefreshing(true);
    api.buyer.orders.get(id).then(row => {
      setOrder(adaptOrderDetail(row));
      setFetchError(false);
      setRefreshing(false);
    }).catch(() => {
      setRefreshing(false);
      setFetchError(true);
    });
    api.returns.listBuyer().then(rows => setReturnRequest(rows.find((request: any) => request.orderId === id) ?? null)).catch(() => {});
  }

  function handleCopyTracking() {
    if (!order?.trackingNumber) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Tracking Number', order.trackingNumber);
  }

  function handleContactSeller() {
    if (!order) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const initials = order.sellerName
      .split(/\s+/)
      .map(w => w[0] ?? '')
      .slice(0, 2)
      .join('')
      .toUpperCase();
    router.push((
      '/buyer-conversation?participantId=' + encodeURIComponent(order.sellerId) +
      '&participantName=' + encodeURIComponent(order.sellerName) +
      '&participantHandle=' + encodeURIComponent(order.sellerHandle) +
      '&participantInitials=' + encodeURIComponent(initials) +
      '&participantColor=' + encodeURIComponent(PURPLE) +
      '&participantAccountType=seller' +
      '&type=buyer_to_seller_order' +
      '&contextOrderId=' + encodeURIComponent(order.id) +
      '&contextOrderNumber=' + encodeURIComponent(order.orderNumber) +
      '&contextOrderStatus=' + encodeURIComponent(order.status) +
      '&contextSellerName=' + encodeURIComponent(order.sellerName)
    ) as never);
  }

  function handleReportSeller() {
    if (!order) return;
    router.push((
      '/buyer-report?targetType=seller&targetId=' + encodeURIComponent(order.sellerId) +
      '&targetLabel=' + encodeURIComponent(order.sellerName)
    ) as never);
  }

  async function handleSubmitReview() {
    if (!order) return;
    setSubmittingReview(true);
    try {
      await api.reviews.create({
        orderId:  order.id,
        sellerId: order.sellerId,
        rating:   reviewRating,
        body:     reviewBody.trim() || undefined,
      });
      setReviewSubmitted(true);
      setShowReviewModal(false);
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not submit review');
    } finally {
      setSubmittingReview(false);
    }
  }

  function handleRequestReturn() {
    if (!order) return;
    if (order.status === 'delivered') {
      router.push(('/return-request?orderId=' + order.id) as never);
    } else {
      Alert.alert('Not Eligible', 'Returns are only available after your order has been delivered.');
    }
  }

  function handleReportProblem() {
    if (!order) return;
    router.push(('/buyer-problem-report?orderId=' + order.id) as never);
  }

  async function handleCancelOrder() {
    if (!order) return;
    setCancelling(true);
    setShowCancelModal(false);
    try {
      const result = await api.buyer.orders.cancel(order.id);
      if (result.cancelled) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const msg = result.refunded
          ? 'Your order has been cancelled and a full refund has been issued. It may take 5–10 business days to appear on your statement.'
          : 'Your order has been cancelled.';
        Alert.alert('Order Cancelled', msg, [{ text: 'OK', onPress: () => router.back() }]);
      }
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Cannot Cancel', err?.message ?? 'Could not cancel this order. Please contact the seller.');
    } finally {
      setCancelling(false);
    }
  }

  function handleBuyAgain() {
    if (!order) return;
    const firstItem = order.lineItems[0];
    if (!firstItem) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Navigate to Discover so the buyer can find the product again
    Alert.alert(
      'Buy Again',
      `Looking for ${firstItem.productName}? Browse Discover to find it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discover', onPress: () => router.push('/(buyer)/discover' as never) },
      ]
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  if (!order) {
    const isNetworkError = fetchError;
    return (
      <BrandthreadScreen>
        <BrandthreadHeader
          title={isNetworkError ? 'Couldn\'t Load Order' : 'Order Not Found'}
          onBack={() => router.back()}
        />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
          <Feather
            name={isNetworkError ? 'wifi-off' : 'alert-circle'}
            size={ICON.xxl}
            color={MUTED}
          />
          <Text style={{ marginTop: SP.md, fontSize: FS.base, fontFamily: FONT.semibold, color: FG, textAlign: 'center' }}>
            {isNetworkError ? 'Connection Problem' : 'Order Not Found'}
          </Text>
          <Text style={{ marginTop: SP.xs, fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 20 }}>
            {isNetworkError
              ? 'We couldn\'t reach our servers right now. Check your connection and try again.'
              : 'We couldn\'t find this order. It may have been removed or the link may be invalid.'}
          </Text>
          {isNetworkError && (
            <PrimaryButton
              label="Try Again"
              icon="refresh-cw"
              onPress={handleRetry}
              style={{ marginTop: SP.lg }}
            />
          )}
          <SecondaryButton label="Go Back" onPress={() => router.back()} style={{ marginTop: SP.sm }} />
        </View>
      </BrandthreadScreen>
    );
  }

  return (
    <BrandthreadScreen>
      {/* Header */}
      <BrandthreadHeader
        title={`Order ${order.orderNumber}`}
        subtitle={order.sellerName}
        onBack={() => router.back()}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: SP.md,
          paddingBottom: Math.max(insets.bottom, SP.md) + SP.xxl,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handlePullRefresh}
            tintColor={PURPLE}
            colors={[PURPLE]}
          />
        }
      >

        {/* ── Status Card ──────────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <GradientCard colors={GRAD_CARD_GLOW} glow>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap' }}>
              <StatusBadge label={statusBadgeLabel(order.status)} variant={statusBadgeVariant(order.status)} />
              <Text style={styles.fulfillmentStatus}>{fulfillmentStatusLabel(order.fulfillmentStatus)}</Text>
            </View>

            {order.isPreOrder && order.preOrderEstShipDate && (
              <View style={styles.preOrderInfoRow}>
                <Feather name="clock" size={ICON.xs} color={CYAN} />
                <Text style={styles.preOrderInfoText}>
                  Pre-order — Est. ship {fmtDate(order.preOrderEstShipDate)}
                </Text>
              </View>
            )}

            {order.trackingNumber && (
              <View style={styles.trackingInfoRow}>
                <Feather name="truck" size={ICON.xs} color={PURPLE_LIGHT} />
                <Text style={styles.trackingInfoText}>
                  Shipped via {order.trackingCarrier}
                </Text>
                <View style={styles.trackingChip}>
                  <Text style={styles.trackingChipText} numberOfLines={1}>{order.trackingNumber}</Text>
                </View>
              </View>
            )}
          </GradientCard>
        </View>

        {returnRequest && (
          <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
            <GradientCard colors={GRAD_CARD_GLOW}>
              <View style={styles.returnHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.returnEyebrow}>RETURN / REFUND</Text>
                  <Text style={styles.returnTitle}>
                    {String(returnRequest.status).replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </Text>
                </View>
                <StatusBadge
                  label={String(returnRequest.status).toUpperCase()}
                  variant={returnRequest.status === 'refunded' ? 'success' : returnRequest.status === 'denied' ? 'error' : returnRequest.status === 'approved' ? 'info' : 'warning'}
                />
              </View>
              <Text style={styles.returnDetail}>
                Requested: {String(returnRequest.resolutionRequested ?? 'refund').replace(/_/g, ' ')}
              </Text>
              {returnRequest.refundAmountCents != null && (
                <Text style={styles.returnDetail}>Refunded: {formatCents(returnRequest.refundAmountCents)}</Text>
              )}
              {returnRequest.sellerResponse ? (
                <View style={styles.sellerResponse}>
                  <Text style={styles.sellerResponseLabel}>Seller response</Text>
                  <Text style={styles.sellerResponseText}>{returnRequest.sellerResponse}</Text>
                </View>
              ) : (
                <Text style={styles.returnPendingText}>Waiting for the seller to respond.</Text>
              )}
              <Text style={styles.returnUpdated}>Updated {fmtDate(returnRequest.updatedAt)}</Text>
            </GradientCard>
          </View>
        )}

        {/* ── Cancellation Reason ───────────────────────────────────────────── */}
        {order.status === 'cancelled' && order.isCustomerVisible && order.cancellationReason && (
          <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
            <GradientCard
              colors={['rgba(239,68,68,0.14)', 'rgba(239,68,68,0.05)']}
              style={{ borderColor: 'rgba(239,68,68,0.35)' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs }}>
                <Feather name="x-circle" size={ICON.sm} color={RED} />
                <Text style={{ fontSize: FS.sm, fontFamily: FONT.bold, color: RED }}>Order Cancelled</Text>
              </View>
              <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginBottom: 2 }}>
                {cancellationReasonLabel(order.cancellationReason)}
              </Text>
              {!!order.cancellationNotes && (
                <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginTop: SP.xs, lineHeight: 18 }}>
                  {order.cancellationNotes}
                </Text>
              )}
            </GradientCard>
          </View>
        )}

        {/* ── Products ─────────────────────────────────────────────────────── */}
        <SectionCard title={`Items (${order.lineItems.length})`}>
          {order.lineItems.map((item, idx) => (
            <View
              key={idx}
              style={[
                styles.lineItemRow,
                idx < order.lineItems.length - 1 && { borderBottomWidth: 1, borderBottomColor: BORDER, paddingBottom: SP.sm, marginBottom: SP.sm },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.lineItemName}>{item.productName}</Text>
                <Text style={styles.lineItemVariant}>{item.variant}</Text>
              </View>
              <Text style={styles.lineItemPrice}>
                {item.quantity} × {formatCents(item.unitPriceCents)}
              </Text>
            </View>
          ))}
        </SectionCard>

        {/* ── Payment Summary ───────────────────────────────────────────────── */}
        <SectionCard title="Payment Summary">
          <Row label="Subtotal" value={formatCents(order.payment.subtotalCents)} />
          <Row label="Shipping" value={formatCents(order.payment.shippingTotalCents)} />
          <Row label="Tax"      value={formatCents(order.payment.taxTotalCents)} />
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatCents(order.payment.totalCents)}</Text>
          </View>
          <Text style={styles.paymentNote}>Payment processed securely via Brandthread</Text>
        </SectionCard>

        {/* ── Shipping Address ─────────────────────────────────────────────── */}
        <SectionCard title="Shipping Address">
          <Text style={styles.addressLine}>{order.shippingAddress.name}</Text>
          <Text style={styles.addressLine}>{order.shippingAddress.line1}</Text>
          {order.shippingAddress.line2 && (
            <Text style={styles.addressLine}>{order.shippingAddress.line2}</Text>
          )}
          <Text style={styles.addressLine}>
            {order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.zip}
          </Text>
          <Text style={styles.addressLine}>{order.shippingAddress.country}</Text>
        </SectionCard>

        {/* ── Tracking ─────────────────────────────────────────────────────── */}
        {order.trackingNumber && (
          <SectionCard title="Tracking">
            <Text style={styles.trackingNumberDisplay}>{order.trackingNumber}</Text>

            <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: SP.sm, flexWrap: 'wrap' }}>
              {order.trackingCarrier && (
                <View style={styles.carrierChip}>
                  <Text style={styles.carrierChipText}>{order.trackingCarrier}</Text>
                </View>
              )}
              {order.trackingStatus && (
                <StatusBadge
                  label={trackingStatusLabel(order.trackingStatus)}
                  variant={trackingStatusVariant(order.trackingStatus)}
                />
              )}
            </View>

            {order.estimatedDelivery && (
              <View style={styles.estDeliveryRow}>
                <Feather name="calendar" size={ICON.xs} color={SUCCESS} />
                <Text style={styles.estDeliveryText}>Est. delivery {fmtDate(order.estimatedDelivery)}</Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: SP.md }}>
              <SecondaryButton
                label="Copy tracking number"
                icon="copy"
                onPress={handleCopyTracking}
                small
                style={{ flex: 1 }}
              />
              <SecondaryButton
                label="Track on carrier"
                icon="external-link"
                onPress={() => Alert.alert('Track Shipment', `Track your shipment with number ${order.trackingNumber} on the carrier's website.`)}
                small
                accent={CYAN}
                style={{ flex: 1 }}
              />
            </View>
          </SectionCard>
        )}

        {/* ── Pre-order Info ───────────────────────────────────────────────── */}
        {order.isPreOrder && (
          <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
            <Text style={[sc.title, { paddingHorizontal: 0, marginBottom: SP.sm }]}>Pre-order Status</Text>
            <GradientCard
              colors={[theme.secondaryDim, `${theme.secondary}0A`]}
              style={{ borderColor: `${theme.secondary}59` }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm }}>
                <Feather name="clock" size={ICON.sm} color={CYAN} />
                <Text style={styles.preOrderTitle}>Your pre-order is being produced.</Text>
              </View>
              {order.preOrderEstShipDate && (
                <Text style={styles.preOrderDetail}>
                  Est. ship date: {fmtDate(order.preOrderEstShipDate)}
                </Text>
              )}
              <View style={{ marginTop: SP.sm }}>
                <StatusBadge label="IN PRODUCTION" variant="info" />
              </View>
            </GradientCard>
          </View>
        )}

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: SP.md, gap: SP.sm, marginBottom: SP.md }}>
          <Text style={[sc.title, { paddingHorizontal: 0 }]}>Actions</Text>

          {/* Cancel button — only visible within the 60-min window while pending */}
          {order.status === 'new' &&
            (Date.now() - new Date(order.createdAt).getTime()) < CANCEL_WINDOW_MS && (
            <SecondaryButton
              label={cancelling ? 'Cancelling…' : 'Cancel Order'}
              icon="x-circle"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowCancelModal(true);
              }}
              accent={RED}
              disabled={cancelling}
            />
          )}

          <PrimaryButton
            label="Contact Seller"
            icon="message-circle"
            onPress={handleContactSeller}
          />
          <SecondaryButton
            label={returnRequest ? "Return Request Submitted" : "Request Return"}
            icon="refresh-ccw"
            onPress={handleRequestReturn}
            disabled={!!returnRequest}
          />
          <SecondaryButton
            label="Report a Problem"
            icon="alert-circle"
            onPress={handleReportProblem}
            accent={RED}
          />
          <SecondaryButton
            label="Report Seller"
            icon="flag"
            onPress={handleReportSeller}
            accent={RED}
          />
          {order.status === 'delivered' && (
            <SecondaryButton
              label="Buy Again"
              icon="repeat"
              onPress={handleBuyAgain}
            />
          )}
        </View>

        {/* ── Disclaimer ───────────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <Text style={styles.disclaimer}>
            This order view shows your purchase details only. Internal seller information is not visible here.
          </Text>
        </View>

      </ScrollView>

      {/* ── Review CTA ──────────────────────────────────────────────────── */}
      {order.status === 'delivered' && !reviewSubmitted && (
        <View style={{ paddingHorizontal: SP.md, paddingVertical: SP.sm }}>
          <TouchableOpacity
            style={{ backgroundColor: CARD, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'center', gap: SP.sm }}
            onPress={() => setShowReviewModal(true)}
            activeOpacity={0.8}
          >
            <Feather name="star" size={ICON.sm} color={GOLD} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: FG }}>Leave a Review</Text>
              <Text style={{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 }}>Share your experience with {order.sellerName}</Text>
            </View>
            <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
        </View>
      )}
      {reviewSubmitted && (
        <View style={{ paddingHorizontal: SP.md, paddingVertical: SP.sm }}>
          <View style={{ backgroundColor: CARD, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: BORDER, flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
            <Feather name="check-circle" size={ICON.sm} color={SUCCESS} />
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.medium, color: SUCCESS }}>Review submitted — thank you!</Text>
          </View>
        </View>
      )}

      {/* ── Cancel Confirmation Modal ─────────────────────────────────────── */}
      <Modal visible={showCancelModal} transparent animationType="slide" onRequestClose={() => setShowCancelModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: SP.lg, paddingBottom: SP.xl + 20 }}>
            <View style={{ alignItems: 'center', marginBottom: SP.md }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: RED_DIM, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm }}>
                <Feather name="x-circle" size={24} color={RED} />
              </View>
              <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: FG }}>Cancel this order?</Text>
            </View>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 20, marginBottom: SP.lg }}>
              Your payment will be fully refunded. Refunds typically appear within 5–10 business days depending on your bank.
            </Text>
            <View style={{ flexDirection: 'row', gap: SP.sm }}>
              <SecondaryButton
                label="Keep Order"
                onPress={() => setShowCancelModal(false)}
                style={{ flex: 1 }}
              />
              <TouchableOpacity
                style={{ flex: 1, height: COMP.buttonH, borderRadius: RADIUS.md, backgroundColor: RED_DIM, borderWidth: 1, borderColor: RED + '60', alignItems: 'center', justifyContent: 'center' }}
                onPress={handleCancelOrder}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: FS.sm, fontFamily: FONT.bold, color: RED }}>Yes, Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Review Modal ─────────────────────────────────────────────────── */}
      <Modal visible={showReviewModal} transparent animationType="slide" onRequestClose={() => setShowReviewModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: SP.lg, paddingBottom: SP.xl + 20 }}>
            <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: FG, marginBottom: SP.md }}>Rate your order</Text>
            <View style={{ flexDirection: 'row', gap: SP.sm, marginBottom: SP.md }}>
              {[1, 2, 3, 4, 5].map(n => (
                <TouchableOpacity key={n} onPress={() => setReviewRating(n)} activeOpacity={0.7}>
                  <Text style={{ fontSize: 32, color: n <= reviewRating ? GOLD : MUTED }}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={{ backgroundColor: BG, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, padding: SP.md, color: FG, fontSize: FS.sm, fontFamily: FONT.regular, minHeight: 80, textAlignVertical: 'top', marginBottom: SP.md }}
              placeholder="Share your experience (optional)"
              placeholderTextColor={MUTED}
              value={reviewBody}
              onChangeText={setReviewBody}
              multiline
              maxLength={500}
            />
            <View style={{ flexDirection: 'row', gap: SP.sm }}>
              <TouchableOpacity
                style={{ flex: 1, height: COMP.buttonH, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' }}
                onPress={() => setShowReviewModal(false)}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 2, height: COMP.buttonH, borderRadius: RADIUS.md, backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: BORDER_ACTIVE, alignItems: 'center', justifyContent: 'center' }}
                onPress={handleSubmitReview}
                disabled={submittingReview}
                activeOpacity={0.8}
              >
                {submittingReview
                  ? <ActivityIndicator color={PURPLE_LIGHT} size="small" />
                  : <Text style={{ fontSize: FS.sm, fontFamily: FONT.bold, color: PURPLE_LIGHT }}>Submit Review</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </BrandthreadScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = theme.accentDim, CYAN = theme.secondary, CYAN_DIM = theme.secondaryDim, CYAN_LIGHT = theme.secondary;
  const BORDER_ACTIVE = `${theme.accent}73`;
  return StyleSheet.create({
  fulfillmentStatus: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  preOrderInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginTop: SP.sm,
  },
  preOrderInfoText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: CYAN,
  },
  trackingInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginTop: SP.sm,
    flexWrap: 'wrap',
  },
  trackingInfoText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: PURPLE_LIGHT,
  },
  trackingChip: {
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 180,
  },
  trackingChipText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: PURPLE_LIGHT,
  },
  returnHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  returnEyebrow: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 0.7 },
  returnTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.md, marginTop: 2 },
  returnDetail: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 4, textTransform: 'capitalize' },
  sellerResponse: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.sm, marginTop: SP.sm },
  sellerResponseLabel: { color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.xs, marginBottom: 4 },
  sellerResponseText: { color: FG, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  returnPendingText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.sm },
  returnUpdated: { color: SUBTLE, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: SP.sm },
  lineItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  lineItemName: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  lineItemVariant: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    marginTop: 2,
  },
  lineItemPrice: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: FG,
  },
  divider: {
    height: 1,
    backgroundColor: BORDER,
    marginVertical: SP.sm,
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  totalLabel: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
  },
  totalAmount: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
  },
  paymentNote: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    marginTop: SP.sm,
    textAlign: 'center',
  },
  addressLine: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
    lineHeight: 22,
  },
  trackingNumberDisplay: {
    fontSize: FS.base,
    fontFamily: 'Inter_400Regular',
    color: FG,
    letterSpacing: 1,
  },
  carrierChip: {
    backgroundColor: BLUE_DIM,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  carrierChipText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: BLUE,
  },
  estDeliveryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    marginTop: SP.sm,
  },
  estDeliveryText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: SUCCESS,
  },
  preOrderTitle: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: CYAN_LIGHT,
  },
  preOrderDetail: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  disclaimer: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    textAlign: 'center',
    lineHeight: 18,
  },
  });
};
