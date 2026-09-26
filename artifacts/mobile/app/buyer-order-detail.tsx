/**
 * Buyer Order Detail
 *
 * Depop-inspired hierarchy:
 *   1. Status badge + progress timeline (most prominent)
 *   2. Items — with thumbnail images, title, variant, qty × price
 *   3. Shipping address
 *   4. Payment/totals receipt
 *   5. Tracking, pre-order info, return status
 *   6. Secondary actions (cancel, return, report)
 *
 * Rating flow (delivered orders only, real API orders only):
 *   - "Leave feedback" CTA in bottom bar → inline star picker sheet
 *   - Star selection → optional review text → Submit
 *   - On submit: real api.reviews.create() call
 *   - Post-submit: "Thanks for reviewing" state, no re-entry
 *   - Gate: order.status === 'delivered' && !reviewSubmitted && real order ID (not local/demo)
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet,
  ActivityIndicator, Modal, TextInput, RefreshControl, Image,
  Linking,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui/Button';
import { BuyerOrderView, cancellationReasonLabel, OrderStatus, TrackingStatus } from '@/services/orderTypes';
import { useApi } from '@/hooks/useApi';
import { FONT, FS, SP, RADIUS, COMP, ICON } from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  GradientCard, StatusBadge, PrimaryButton, SecondaryButton,
} from '@/components/BrandthreadUI';
import { ResponsiveContainer } from '@/components/layout';
import { OrderProgressTimeline } from '@/components/orders/OrderProgressTimeline';
import { formatCents } from '@/lib/money';
import { visibleOrderForBuyer } from '@/lib/buyerOrdersVisibility';
import { canBuyerCancel } from '@/services/orderPolicy';
import { SheetRise } from '@/components/motion/SheetRise';
import { BuyerProtectionNote } from '@/components/BuyerProtectionNote';
import { productDetailHref, profileHref } from '@/lib/profileNavigation';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const GRAD_CARD_GLOW = ['rgba(255,255,255,0.06)', 'rgba(255,255,255,0.01)'] as const;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Builds a real carrier tracking URL from the carrier name + tracking number.
// Falls back to a tracking-number web search when the carrier isn't recognized.
function carrierTrackingUrl(carrier: string | undefined, trackingNumber: string): string {
  const key = (carrier ?? '').toLowerCase();
  const encoded = encodeURIComponent(trackingNumber);
  if (key.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  if (key.includes('ups')) return `https://www.ups.com/track?tracknum=${encoded}`;
  if (key.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  if (key.includes('dhl')) return `https://www.dhl.com/en/express/tracking.html?AWB=${encoded}`;
  return `https://www.google.com/search?q=${encoded}+tracking`;
}

function formatRelativeUpdate(timestamp: number): string {
  const elapsed = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsed < 5) return 'just now';
  if (elapsed < 60) return `${elapsed}s ago`;
  const mins = Math.floor(elapsed / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
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

/** Returns true when the order ID is a real API order (not a local/demo ID). */
function isRealOrderId(id: string | undefined): boolean {
  if (!id) return false;
  // Demo/local IDs generated with Date.now().toString(36) are short + alphabetic
  // Real server IDs are UUIDs (36 chars) or numeric strings ≥ 8 digits
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;
  if (/^\d{6,}$/.test(id)) return true;
  return false;
}

// The order's progress is now rendered entirely by the shared
// OrderStatusTimeline component (see components/orders/OrderStatusTimeline)
// so the seller and buyer screens can never disagree on stage order or
// terminal-state handling. Terminal (non-happy-path) statuses that get their
// own exception treatment throughout this screen.
const TERMINAL_STATUSES: OrderStatus[] = ['cancelled', 'refunded', 'disputed'];

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useAppTheme();
  return (
    <View style={sc.root}>
      <Text style={[sc.title, { color: theme.muted }]}>{title}</Text>
      <BrandthreadCard>{children}</BrandthreadCard>
    </View>
  );
}

const sc = StyleSheet.create({
  root:  { marginBottom: SP.md },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: SP.sm, paddingHorizontal: SP.md },
});

// ─── Row ──────────────────────────────────────────────────────────────────────

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View style={row.root}>
      <Text style={[row.label, { color: theme.muted }]}>{label}</Text>
      <Text style={[row.value, { color: theme.text }, mono && row.mono]}>{value}</Text>
    </View>
  );
}

const row = StyleSheet.create({
  root:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.xs },
  label: { fontSize: FS.sm, fontFamily: FONT.regular, flex: 1 },
  value: { fontSize: FS.sm, fontFamily: FONT.semibold, flex: 1, textAlign: 'right' },
  mono:  { fontFamily: 'Inter_400Regular', letterSpacing: 0.5, fontSize: FS.xs },
});

// ─── Star Rating component ────────────────────────────────────────────────────
// Filled stars use theme.warning (the same themed amber token seller-reviews.tsx
// uses for its Stars component) instead of a fixed hex, so ratings stay legible
// but still react to all 12 themes.

function StarRating({ rating, size = 36, interactive = true, onRate }: {
  rating: number; size?: number; interactive?: boolean; onRate?: (r: number) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <TouchableOpacity
          key={n}
          onPress={interactive && onRate ? () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onRate(n);
          } : undefined}
          disabled={!interactive || !onRate}
          activeOpacity={0.7}
          accessibilityRole={interactive ? 'button' : 'image'}
          accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
          accessibilityState={interactive ? { selected: n <= rating } : undefined}
        >
          <Text style={{ fontSize: size, color: n <= rating ? theme.warning : theme.muted }}>★</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Inline review rating sheet (Depop-pattern) ───────────────────────────────

function ReviewSheet({
  visible, sellerName, onClose, onSubmit, submitting,
}: {
  visible: boolean; sellerName: string;
  onClose: () => void; onSubmit: (rating: number, body: string) => void;
  submitting: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');

  // Reset when sheet opens
  useEffect(() => {
    if (visible) { setRating(0); setBody(''); }
  }, [visible]);

  const canSubmit = rating > 0 && !submitting;
  const ratingLabel = rating === 0 ? 'Tap to rate your experience'
    : rating <= 2 ? 'Not great'
    : rating === 3 ? 'It was okay'
    : rating === 4 ? 'Pretty good'
    : 'Excellent!';

  if (!visible) return null;

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <TouchableOpacity
        style={{ ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.62)' } as any}
        activeOpacity={1}
        onPress={onClose}
        accessibilityLabel="Close review"
      />
      <SheetRise style={[rvs.sheet, { backgroundColor: theme.card, borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, SP.lg) }]}>
        {/* Handle */}
        <View style={[rvs.handle, { backgroundColor: theme.border }]} />

        {/* Header */}
        <View style={rvs.header}>
          <View style={{ flex: 1 }}>
            <Text style={[rvs.eyebrow, { color: theme.muted }]}>LEAVE FEEDBACK</Text>
            <Text style={[rvs.title, { color: theme.text }]}>Rate {sellerName}</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="Close">
            <Feather name="x" size={22} color={theme.text} />
          </TouchableOpacity>
        </View>

        {/* Stars */}
        <View style={rvs.starsRow}>
          <StarRating rating={rating} size={42} interactive onRate={setRating} />
          <Text style={[rvs.ratingLabel, { color: theme.muted }]}>{ratingLabel}</Text>
        </View>

        {/* Review text */}
        <TextInput
          style={[rvs.input, { backgroundColor: theme.cardElevated, borderColor: theme.border, color: theme.text }]}
          placeholder="Share your experience (optional)"
          placeholderTextColor={theme.subtle}
          value={body}
          onChangeText={setBody}
          multiline
          maxLength={500}
          textAlignVertical="top"
          accessibilityLabel="Review text"
        />
        <Text style={[rvs.charCount, { color: theme.subtle }]}>{body.length}/500</Text>

        {/* Actions */}
        <View style={rvs.actions}>
          <TouchableOpacity
            style={[rvs.cancelBtn, { borderColor: theme.border }]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={[rvs.cancelBtnText, { color: theme.muted }]}>Not now</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[rvs.submitBtn, { backgroundColor: theme.accent }, !canSubmit && rvs.submitBtnDisabled]}
            onPress={canSubmit ? () => onSubmit(rating, body) : undefined}
            disabled={!canSubmit}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Submit review"
            accessibilityState={{ disabled: !canSubmit, busy: submitting }}
          >
            {submitting
              ? <ActivityIndicator color={theme.onAccent} size="small" />
              : <Text style={[rvs.submitBtnText, { color: theme.onAccent }]}>Submit review</Text>
            }
          </TouchableOpacity>
        </View>
      </SheetRise>
    </Modal>
  );
}

const rvs = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1,
    padding: SP.lg,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SP.lg },
  eyebrow: { fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1.6, marginBottom: 4 },
  title: { fontFamily: FONT.bold, fontSize: FS.lg, letterSpacing: -0.3 },
  starsRow: { alignItems: 'center', marginBottom: SP.lg, gap: SP.sm },
  ratingLabel: { fontFamily: FONT.medium, fontSize: FS.sm, textAlign: 'center' },
  input: {
    minHeight: 88, borderRadius: RADIUS.md,
    borderWidth: 1, padding: SP.md,
    fontFamily: FONT.regular, fontSize: FS.sm,
    marginBottom: 4,
  },
  charCount: { fontFamily: FONT.regular, fontSize: FS.xs, textAlign: 'right', marginBottom: SP.md },
  actions: { flexDirection: 'row', gap: SP.sm },
  cancelBtn: { flex: 1, height: COMP.buttonH, borderRadius: RADIUS.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  submitBtn: { flex: 2, height: COMP.buttonH, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  submitBtnDisabled: { opacity: 0.42 },
  submitBtnText: { fontFamily: FONT.bold, fontSize: FS.base },
});

// ─── API adapter ──────────────────────────────────────────────────────────────

function adaptOrderDetail(row: any): BuyerOrderView {
  const dbAddr = row.shippingAddress;
  const items = Array.isArray(row.items) ? row.items : [];
  const shippingAddress: import('@/services/orderTypes').OrderAddress = dbAddr
    ? { name: dbAddr.name ?? '', line1: dbAddr.street ?? '', line2: '', city: dbAddr.city ?? '', state: dbAddr.state ?? '', zip: dbAddr.zip ?? '', country: dbAddr.country ?? 'US', phone: '' }
    : { name: '', line1: '', city: '', state: '', zip: '', country: 'US' };

  return {
    id:                row.id,
    orderNumber:       row.orderNumber,
    sellerId:          row.ownerId ?? '',
    sellerName:        row.sellerDisplayName ?? 'Seller',
    sellerHandle:      '',
    status:            (row.status === 'pending' ? 'new' : row.status === 'fulfilled' ? 'ready_to_ship' : (row.status ?? 'new')) as OrderStatus,
    paymentStatus:     row.stripePaymentIntentId ? 'paid' : 'pending',
    fulfillmentStatus: 'unfulfilled',
    lineItems: items.map((item: any) => ({
      productId:      typeof item.productId === 'string' ? item.productId : null,
      productName:    item.productName,
      variant:        item.variantLabel ?? '',
      quantity:       item.quantity,
      unitPriceCents: item.priceCents ?? 0,
      imageUri:       item.imageUri ?? item.imageUrl ?? undefined,
    })),
    shippingAddress,
    payment: {
      subtotalCents:     row.subtotalCents ?? 0,
      shippingTotalCents: row.shippingCents ?? 0,
      taxTotalCents:     0,
      totalCents:        row.totalCents ?? 0,
    },
    trackingNumber:    row.trackingNumber    ?? undefined,
    trackingCarrier:   row.carrier           ?? undefined,
    trackingStatus:    row.trackingStatus    ?? undefined,
    estimatedDelivery: row.estimatedDelivery ?? undefined,
    shippedAt:         row.shippedAt         ?? undefined,
    isPreOrder:        false,
    hasReturnRequest:  false,
    cancellationReason: row.cancellationReason ?? null,
    cancellationNotes:  row.cancellationNotes ?? null,
    isCustomerVisible: row.isCustomerVisible === true,
    createdAt:         row.createdAt ?? new Date().toISOString(),
  };
}

// ─── Exported sub-components ──────────────────────────────────────────────────

export function BuyerCancellationDetailsCard({ order }: {
  order: Pick<BuyerOrderView, 'status' | 'isCustomerVisible' | 'cancellationReason' | 'cancellationNotes'>;
}) {
  const { theme } = useAppTheme();
  if (order.status !== 'cancelled' || !order.isCustomerVisible || !order.cancellationReason) return null;
  return (
    <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
      <GradientCard colors={[`${theme.error}24`, `${theme.error}0D`]} style={{ borderColor: `${theme.error}59` }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs }}>
          <Feather name="x-circle" size={ICON.sm} color={theme.error} />
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.bold, color: theme.error }}>Order Cancelled</Text>
        </View>
        <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, marginBottom: 2 }}>
          {cancellationReasonLabel(order.cancellationReason)}
        </Text>
        {!!order.cancellationNotes && (
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginTop: SP.xs, lineHeight: 18 }}>
            {order.cancellationNotes}
          </Text>
        )}
      </GradientCard>
    </View>
  );
}

export function BuyerTrackingAlertCard({ trackingStatus }: { trackingStatus?: TrackingStatus }) {
  const { theme } = useAppTheme();
  const isOutForDelivery  = trackingStatus === 'out_for_delivery';
  const isDeliveryProblem = trackingStatus === 'exception' || trackingStatus === 'returned_to_sender';
  if (!isOutForDelivery && !isDeliveryProblem) return null;
  const title   = isOutForDelivery ? 'Arriving today' : trackingStatus === 'returned_to_sender' ? 'Package returning to sender' : 'Delivery problem';
  const message = isOutForDelivery
    ? 'Your package is out for delivery. Keep an eye out for it today.'
    : trackingStatus === 'returned_to_sender'
      ? 'The carrier is returning this package to the sender. Contact the seller for help.'
      : 'The carrier reported a problem with this delivery. Check the tracking details or contact the seller.';
  const color = isOutForDelivery ? theme.warning : theme.error;
  return (
    <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
      <GradientCard colors={[`${color}24`, `${color}0D`]} style={{ borderColor: `${color}66` }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.xs }}>
          <Feather name={isOutForDelivery ? 'truck' : 'alert-triangle'} size={ICON.sm} color={color} />
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.bold, color }}>{title}</Text>
        </View>
        <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text, lineHeight: 20 }}>{message}</Text>
      </GradientCard>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function BuyerOrderDetailScreen() {
  const { theme } = useAppTheme();
  const PURPLE = theme.accent;
  const PURPLE_LIGHT = theme.accentLight;
  const PURPLE_DIM = theme.accentDim;
  const CYAN = theme.secondary;
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { userId } = useAuth();

  const [storedOrder, setOrder] = useState<BuyerOrderView | null>(null);
  const [orderOwnerId, setOrderOwnerId] = useState<string | null | undefined>(userId);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [showReviewSheet, setShowReviewSheet] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [trackingCopied, setTrackingCopied] = useState(false);
  const [returnRequest, setReturnRequest] = useState<any | null>(null);

  const consecutiveFailuresRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accountGenerationRef = useRef(0);

  useEffect(() => {
    accountGenerationRef.current += 1;
    consecutiveFailuresRef.current = 0;
    setOrder(null);
    setOrderOwnerId(userId);
    setReturnRequest(null);
    setFetchError(false);
    setRefreshing(false);
    setIsFetching(false);
    setLastUpdatedAt(null);
    setLoading(true);
    setShowReviewSheet(false);
    setShowCancelModal(false);
  }, [userId]);

  useFocusEffect(useCallback(() => {
    if (!id) return;
    let cancelled = false;
    const accountGeneration = accountGenerationRef.current;
    consecutiveFailuresRef.current = 0;
    setIsFetching(true);

    function fetchOrder() {
      api.buyer.orders.get(id!).then(row => {
        if (!cancelled && accountGenerationRef.current === accountGeneration) {
          setOrder(adaptOrderDetail(row));
          setOrderOwnerId(userId);
          setFetchError(false);
          setLoading(false);
          setIsFetching(false);
          setLastUpdatedAt(Date.now());
          consecutiveFailuresRef.current = 0;
        }
      }).catch(() => {
        if (!cancelled && accountGenerationRef.current === accountGeneration) {
          setOrder(null);
          setOrderOwnerId(userId);
          setLoading(false);
          setIsFetching(false);
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
          if (!cancelled && accountGenerationRef.current === accountGeneration) {
            setReturnRequest(rows.find((req: any) => req.orderId === id) ?? null);
          }
        })
        .catch(() => {});
    }

    fetchOrder();
    timerRef.current = setInterval(fetchOrder, 15_000);
    return () => {
      cancelled = true;
      setIsFetching(false);
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [api, id, userId]));

  function handlePullRefresh() {
    if (!id || refreshing) return;
    const accountGeneration = accountGenerationRef.current;
    setRefreshing(true);
    setIsFetching(true);
    api.buyer.orders.get(id).then(row => {
      if (accountGenerationRef.current !== accountGeneration) return;
      setOrder(adaptOrderDetail(row));
      setOrderOwnerId(userId);
      setFetchError(false);
      setRefreshing(false);
      setIsFetching(false);
      setLastUpdatedAt(Date.now());
    }).catch(() => {
      if (accountGenerationRef.current !== accountGeneration) return;
      setOrder(null);
      setOrderOwnerId(userId);
      setRefreshing(false);
      setIsFetching(false);
      setFetchError(true);
    });
    api.returns.listBuyer().then(rows => {
      if (accountGenerationRef.current === accountGeneration) {
        setReturnRequest(rows.find((req: any) => req.orderId === id) ?? null);
      }
    }).catch(() => {});
  }

  const order = visibleOrderForBuyer(storedOrder, orderOwnerId, userId);
  const visibleLoading = loading || orderOwnerId !== userId;

  function handleCopyTracking() {
    if (!order?.trackingNumber) return;
    Clipboard.setStringAsync(order.trackingNumber);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTrackingCopied(true);
    setTimeout(() => setTrackingCopied(false), 2000);
  }

  function handleTrackOnCarrier() {
    if (!order?.trackingNumber) return;
    const url = carrierTrackingUrl(order.trackingCarrier, order.trackingNumber);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(url).catch(() => {
      Alert.alert("Couldn't open tracking", 'Try again in a moment.');
    });
  }

  function handleContactSeller() {
    if (!order) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const initials = order.sellerName.split(/\s+/).map(w => w[0] ?? '').slice(0, 2).join('').toUpperCase();
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

  function handleViewSeller() {
    if (!order?.sellerId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(profileHref({ userId: order.sellerId, accountType: 'seller' }) as never);
  }

  function handleViewProduct(productId: string | null | undefined) {
    if (!productId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(productDetailHref(productId) as never);
  }

  function handleReportSeller() {
    if (!order) return;
    router.push(('/buyer-report?targetType=seller&targetId=' + encodeURIComponent(order.sellerId) + '&targetLabel=' + encodeURIComponent(order.sellerName)) as never);
  }

  async function handleSubmitReview(rating: number, body: string) {
    if (!order) return;
    // Gate: only allow reviews on real API orders to prevent demo/local data contamination
    if (!isRealOrderId(order.id)) {
      Alert.alert('Not Available', 'Reviews can only be submitted for completed purchases.');
      return;
    }
    setSubmittingReview(true);
    try {
      await api.reviews.create({
        orderId:  order.id,
        sellerId: order.sellerId,
        rating,
        body: body.trim() || undefined,
      });
      setReviewSubmitted(true);
      setShowReviewSheet(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert('Error', "Couldn't post your review. Try again.");
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
      Alert.alert('Cannot Cancel', "This order can't be cancelled now. Message the seller for help.");
    } finally {
      setCancelling(false);
    }
  }

  function handleBuyAgain() {
    if (!order) return;
    const firstItem = order.lineItems[0];
    if (!firstItem) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Buy Again',
      `Looking for ${firstItem.productName}? Browse Discover to find it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discover', onPress: () => router.push('/(buyer)/discover' as never) },
      ]
    );
  }

  // ── Render states ────────────────────────────────────────────────────────────

  if (visibleLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.accent} size="large" />
      </View>
    );
  }

  if (fetchError && !order) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Order Details" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg }}>
          <Feather name="wifi-off" size={40} color={theme.muted} />
          <Text style={{ color: theme.muted, fontFamily: FONT.medium, fontSize: FS.base, marginTop: SP.md, textAlign: 'center' }}>
            Could not load order details
          </Text>
          <Button label="Retry" variant="secondary" size="small" style={{ marginTop: SP.md }} onPress={handlePullRefresh} />
        </View>
      </BrandthreadScreen>
    );
  }

  if (!order) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Order Details" onBack={() => router.back()} />
        <View style={{ flex: 1 }} />
      </BrandthreadScreen>
    );
  }

  const isTerminal = TERMINAL_STATUSES.includes(order.status);
  // Rating eligibility: delivered, real API order, not yet reviewed
  const canLeaveReview = order.status === 'delivered' && !reviewSubmitted && isRealOrderId(order.id);

  return (
    <BrandthreadScreen>
      {/* Header */}
      <BrandthreadHeader
        title={`Order ${order.orderNumber}`}
        subtitle={order.sellerName}
        onBack={() => router.back()}
      />

      {/* Live-updating status indicator */}
      <View style={styles.refreshStatus} accessibilityLiveRegion="polite">
        {isFetching ? (
          <>
            <ActivityIndicator color={theme.accent} size="small" />
            <Text style={styles.refreshStatusText}>Updating order status…</Text>
          </>
        ) : lastUpdatedAt !== null ? (
          <>
            <Feather name="check-circle" size={ICON.xs} color={theme.subtle} />
            <Text style={styles.refreshStatusText}>Last updated {formatRelativeUpdate(lastUpdatedAt)}</Text>
          </>
        ) : null}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: SP.md, paddingBottom: Math.max(insets.bottom, SP.md) + COMP.buttonH + SP.xl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handlePullRefresh} tintColor={theme.accent} colors={[theme.accent]} />
        }
      >
      {/* Centers content in a max-width column on iPad/landscape; each section
          below keeps its own SP.md gutter so phones render unchanged. */}
      <ResponsiveContainer style={{ paddingHorizontal: 0 }}>
        {/* ── 1. Status + Progress ─────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <GradientCard colors={GRAD_CARD_GLOW} glow>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, flexWrap: 'wrap' }}>
              <StatusBadge label={statusBadgeLabel(order.status)} variant={statusBadgeVariant(order.status)} />
              <Text style={styles.fulfillmentStatus}>{fulfillmentStatusLabel(order.fulfillmentStatus)}</Text>
            </View>
            {order.isPreOrder && order.preOrderEstShipDate && (
              <View style={styles.preOrderInfoRow}>
                <Feather name="clock" size={ICON.xs} color={CYAN} />
                <Text style={[styles.preOrderInfoText, { color: CYAN }]}>
                  Pre-order — Est. ship {fmtDate(order.preOrderEstShipDate)}
                </Text>
              </View>
            )}
            {order.trackingNumber && (
              <View style={styles.trackingInfoRow}>
                <Feather name="truck" size={ICON.xs} color={PURPLE_LIGHT} />
                <Text style={[styles.trackingInfoText, { color: PURPLE_LIGHT }]}>
                  Shipped via {order.trackingCarrier}
                </Text>
                <View style={[styles.trackingChip, { backgroundColor: PURPLE_DIM }]}>
                  <Text style={[styles.trackingChipText, { color: PURPLE_LIGHT }]} numberOfLines={1}>{order.trackingNumber}</Text>
                </View>
              </View>
            )}
          </GradientCard>
        </View>

        {/* Live, timestamped progress tracker — the visual centerpiece of this
            screen: Order placed → Processing → Shipped (carrier + tracking,
            tap to track) → Out for delivery → Delivered, current step
            highlighted and animated, future steps dimmed. Cancel/return/
            refund states are handled by the cards below (BuyerCancellation-
            DetailsCard / return request card / BuyerTrackingAlertCard) — this
            tracker itself collapses to a single exception pill for those. */}
        <View style={{ marginBottom: SP.md }}>
          <Text style={[sc.title, { color: theme.muted, paddingHorizontal: SP.md }]}>Order Progress</Text>
          <BrandthreadCard style={{ marginHorizontal: SP.md }} glow={!isTerminal}>
            <OrderProgressTimeline
              status={order.status}
              createdAt={order.createdAt}
              shippedAt={order.shippedAt}
              trackingStatus={order.trackingStatus}
              trackingCarrier={order.trackingCarrier}
              trackingNumber={order.trackingNumber}
              onTrackPress={handleTrackOnCarrier}
            />
          </BrandthreadCard>
        </View>

        {/* Return request */}
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
              <Text style={styles.returnDetail}>Requested: {String(returnRequest.resolutionRequested ?? 'refund').replace(/_/g, ' ')}</Text>
              {returnRequest.refundAmountCents != null && (
                <Text style={styles.returnDetail}>Refunded: {formatCents(returnRequest.refundAmountCents)}</Text>
              )}
              {returnRequest.sellerResponse ? (
                <View style={styles.sellerResponse}>
                  <Text style={[styles.sellerResponseLabel, { color: PURPLE_LIGHT }]}>Seller response</Text>
                  <Text style={styles.sellerResponseText}>{returnRequest.sellerResponse}</Text>
                </View>
              ) : (
                <Text style={styles.returnPendingText}>Waiting for the seller to respond.</Text>
              )}
              <Text style={styles.returnUpdated}>Updated {fmtDate(returnRequest.updatedAt)}</Text>
            </GradientCard>
          </View>
        )}

        <BuyerCancellationDetailsCard order={order} />
        <BuyerTrackingAlertCard trackingStatus={order.trackingStatus} />

        {/* ── 2. Items (with thumbnails) ───────────────────────────────────── */}
        <SectionCard title={`Items (${order.lineItems.length})`}>
          {order.lineItems.map((item, idx) => (
            <TouchableOpacity
              key={idx}
              disabled={!item.productId}
              onPress={() => handleViewProduct(item.productId)}
              activeOpacity={0.75}
              accessibilityRole={item.productId ? 'button' : undefined}
              accessibilityLabel={item.productId ? `View ${item.productName}` : undefined}
              testID={item.productId ? `order-item-product-${item.productId}` : undefined}
              style={[
                styles.lineItemRow,
                idx < order.lineItems.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.border, paddingBottom: SP.sm, marginBottom: SP.sm },
              ]}
            >
              {/* Thumbnail */}
              {item.imageUri ? (
                <Image
                  source={{ uri: item.imageUri }}
                  style={styles.itemThumb}
                  resizeMode="cover"
                  accessibilityLabel={`Product image for ${item.productName}`}
                />
              ) : (
                <View style={[styles.itemThumb, styles.itemThumbFallback]}>
                  <Feather name="image" size={18} color={theme.subtle} />
                </View>
              )}
              {/* Info */}
              <View style={{ flex: 1 }}>
                <Text style={styles.lineItemName}>{item.productName}</Text>
                {!!item.variant && <Text style={styles.lineItemVariant}>{item.variant}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.lineItemPrice}>{formatCents(item.unitPriceCents * item.quantity)}</Text>
                {item.quantity > 1 && <Text style={styles.lineItemVariant}>×{item.quantity}</Text>}
              </View>
              {item.productId ? <Feather name="chevron-right" size={ICON.sm} color={theme.muted} /> : null}
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={handleViewSeller}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`View ${order.sellerName}'s profile`}
            testID="order-seller-profile"
            style={styles.sellerLinkRow}
          >
            <Feather name="shopping-bag" size={ICON.sm} color={theme.muted} />
            <Text style={styles.sellerLinkText} numberOfLines={1}>Sold by {order.sellerName}</Text>
            <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
          </TouchableOpacity>
        </SectionCard>

        {/* ── 3. Shipping address ──────────────────────────────────────────── */}
        <SectionCard title="Shipping Address">
          <Text style={styles.addressLine}>{order.shippingAddress.name}</Text>
          <Text style={styles.addressLine}>{order.shippingAddress.line1}</Text>
          {order.shippingAddress.line2 ? <Text style={styles.addressLine}>{order.shippingAddress.line2}</Text> : null}
          <Text style={styles.addressLine}>{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.zip}</Text>
          <Text style={styles.addressLine}>{order.shippingAddress.country}</Text>
        </SectionCard>

        {/* ── 4. Payment / totals receipt ──────────────────────────────────── */}
        <SectionCard title="Payment Summary">
          <Row label="Subtotal" value={formatCents(order.payment.subtotalCents)} />
          <Row label="Shipping" value={formatCents(order.payment.shippingTotalCents)} />
          {/* Tax is hidden rather than shown as "$0.00" when it isn't known/charged —
              display-only guard; the underlying total is unchanged. */}
          {!!order.payment.taxTotalCents && (
            <Row label="Tax" value={formatCents(order.payment.taxTotalCents)} />
          )}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatCents(order.payment.totalCents)}</Text>
          </View>
          <Text style={styles.paymentNote}>Payment processed securely via Brandthread</Text>
        </SectionCard>

        {/* ── Buyer protection (same note as product detail + checkout) ──── */}
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <BuyerProtectionNote preorder={order.isPreOrder} />
        </View>

        {/* ── 5. Tracking ─────────────────────────────────────────────────── */}
        {order.trackingNumber && (
          <SectionCard title="Tracking">
            <Text style={styles.trackingNumberDisplay}>{order.trackingNumber}</Text>
            <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: SP.sm, flexWrap: 'wrap' }}>
              {order.trackingCarrier && (
                <View style={styles.carrierChip}>
                  <Text style={styles.carrierChipText} numberOfLines={1}>{order.trackingCarrier}</Text>
                </View>
              )}
              {order.trackingStatus && (
                <StatusBadge label={trackingStatusLabel(order.trackingStatus)} variant={trackingStatusVariant(order.trackingStatus)} />
              )}
            </View>
            {order.estimatedDelivery && (
              <View style={styles.estDeliveryRow}>
                <Feather name="calendar" size={ICON.xs} color={theme.success} />
                <Text style={styles.estDeliveryText}>Est. delivery {fmtDate(order.estimatedDelivery)}</Text>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: SP.sm, marginTop: SP.md }}>
              <SecondaryButton
                label={trackingCopied ? 'Copied' : 'Copy tracking'}
                icon={trackingCopied ? 'check' : 'copy'}
                onPress={handleCopyTracking}
                small style={{ flex: 1 }}
              />
              <SecondaryButton
                label="Track on carrier"
                icon="external-link"
                onPress={handleTrackOnCarrier}
                small style={{ flex: 1 }}
              />
            </View>
          </SectionCard>
        )}

        {/* Pre-order info */}
        {order.isPreOrder && (
          <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
            <Text style={[sc.title, { paddingHorizontal: 0, marginBottom: SP.sm }]}>Pre-order Status</Text>
            <GradientCard colors={[theme.secondaryDim, `${theme.secondary}0A`]} style={{ borderColor: `${theme.secondary}59` }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm }}>
                <Feather name="clock" size={ICON.sm} color={CYAN} />
                <Text style={[styles.preOrderTitle, { color: CYAN }]}>Your pre-order is being produced.</Text>
              </View>
              {order.preOrderEstShipDate && (
                <Text style={styles.preOrderDetail}>Est. ship date: {fmtDate(order.preOrderEstShipDate)}</Text>
              )}
              <View style={{ marginTop: SP.sm }}>
                <StatusBadge label="IN PRODUCTION" variant="info" />
              </View>
            </GradientCard>
          </View>
        )}

        {/* ── 6. Contextual secondary actions ─────────────────────────────── */}
        <View style={{ paddingHorizontal: SP.md, gap: SP.sm, marginBottom: SP.md }}>
          {canBuyerCancel(order.status, order.createdAt) && (
            <SecondaryButton
              label={cancelling ? 'Cancelling…' : 'Cancel Order'}
              icon="x-circle"
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowCancelModal(true); }}
              accent={theme.error}
              disabled={cancelling}
            />
          )}
          <SecondaryButton
            label={returnRequest ? 'Return Request Submitted' : 'Request Return'}
            icon="refresh-ccw"
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); handleRequestReturn(); }}
            disabled={!!returnRequest}
          />
          <SecondaryButton label="Report a Problem" icon="alert-circle" onPress={handleReportProblem} accent={theme.error} />
          <SecondaryButton label="Report Seller" icon="flag" onPress={handleReportSeller} accent={theme.error} />
          {order.status === 'delivered' && (
            <SecondaryButton label="Buy Again" icon="repeat" onPress={handleBuyAgain} />
          )}
        </View>

        {/* Disclaimer */}
        <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md }}>
          <Text style={styles.disclaimer}>
            This order view shows your purchase details only. Internal seller information is not visible here.
          </Text>
        </View>
      </ResponsiveContainer>
      </ScrollView>

      {/* ── Bottom Action Bar ────────────────────────────────────────────── */}
      <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
        {/* Review CTA or submitted state */}
        {order.status === 'delivered' && reviewSubmitted && (
          <View style={styles.reviewDoneRow}>
            <Feather name="check-circle" size={ICON.sm} color={theme.success} />
            <Text style={styles.reviewDoneText}>Review submitted — thank you!</Text>
          </View>
        )}
        {canLeaveReview && (
          <TouchableOpacity
            style={styles.reviewCTA}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setShowReviewSheet(true);
            }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Leave a review"
          >
            <Feather name="star" size={ICON.sm} color={theme.warning} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reviewCTATitle}>Leave a Review</Text>
              <Text style={styles.reviewCTASub}>Share your experience with {order.sellerName}</Text>
            </View>
            <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
          </TouchableOpacity>
        )}

        <SecondaryButton label="Help Center" icon="help-circle" onPress={() => router.push('/help' as never)} small />
        <PrimaryButton label="Contact Seller" icon="message-circle" onPress={handleContactSeller} />
      </View>

      {/* ── Cancel Confirmation Modal ─────────────────────────────────────── */}
      <Modal visible={showCancelModal} transparent animationType="slide" onRequestClose={() => setShowCancelModal(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: theme.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: SP.lg, paddingBottom: SP.xl + 20 }}>
            <View style={{ alignItems: 'center', marginBottom: SP.md }}>
              <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: `${theme.error}24`, alignItems: 'center', justifyContent: 'center', marginBottom: SP.sm }}>
                <Feather name="x-circle" size={24} color={theme.error} />
              </View>
              <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text }}>Cancel this order?</Text>
            </View>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, textAlign: 'center', lineHeight: 20, marginBottom: SP.lg }}>
              Your payment will be fully refunded. Refunds typically appear within 5–10 business days depending on your bank.
            </Text>
            <View style={{ flexDirection: 'row', gap: SP.sm }}>
              <SecondaryButton label="Keep Order" onPress={() => setShowCancelModal(false)} style={{ flex: 1 }} />
              <TouchableOpacity
                style={{ flex: 1, height: COMP.buttonH, borderRadius: RADIUS.md, backgroundColor: `${theme.error}24`, borderWidth: 1, borderColor: `${theme.error}60`, alignItems: 'center', justifyContent: 'center' }}
                onPress={handleCancelOrder}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: FS.sm, fontFamily: FONT.bold, color: theme.error }}>Yes, Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Depop-style Review Sheet ──────────────────────────────────────── */}
      <ReviewSheet
        visible={showReviewSheet}
        sellerName={order.sellerName}
        onClose={() => setShowReviewSheet(false)}
        onSubmit={handleSubmitReview}
        submitting={submittingReview}
      />
    </BrandthreadScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: AppThemePreset) => {
  return StyleSheet.create({
    fulfillmentStatus: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
    refreshStatus: { minHeight: 28, paddingHorizontal: SP.md, flexDirection: 'row', alignItems: 'center', gap: SP.xs },
    refreshStatusText: { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.subtle },
    preOrderInfoRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: SP.sm },
    preOrderInfoText: { fontSize: FS.sm, fontFamily: FONT.medium },
    trackingInfoRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: SP.sm, flexWrap: 'wrap' },
    trackingInfoText: { fontSize: FS.sm, fontFamily: FONT.medium },
    trackingChip: { borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 180 },
    trackingChipText: { fontSize: FS.xs, fontFamily: FONT.medium },
    returnHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
    returnEyebrow: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 0.7 },
    returnTitle: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.md, marginTop: 2 },
    returnDetail: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 4, textTransform: 'capitalize' },
    sellerResponse: { backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.md, padding: SP.sm, marginTop: SP.sm },
    sellerResponseLabel: { fontFamily: FONT.semibold, fontSize: FS.xs, marginBottom: 4 },
    sellerResponseText: { color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
    returnPendingText: { color: theme.muted, fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.sm },
    returnUpdated: { color: theme.subtle, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: SP.sm },

    // Item rows with thumbnail
    lineItemRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
    sellerLinkRow: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 44,
      marginTop: SP.sm, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: SP.sm,
    },
    sellerLinkText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
    itemThumb: { width: 56, height: 70, borderRadius: RADIUS.sm, overflow: 'hidden', borderWidth: 1, borderColor: theme.border },
    itemThumbFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: theme.cardElevated },
    lineItemName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
    lineItemVariant: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
    lineItemPrice: { fontSize: FS.sm, fontFamily: FONT.bold, color: theme.text },

    // Address
    addressLine: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.text, lineHeight: 22 },

    // Payment summary
    divider: { height: 1, backgroundColor: theme.border, marginVertical: SP.sm },
    totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    totalLabel: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.text },
    totalAmount: { fontSize: FS.base, fontFamily: FONT.bold, color: theme.text },
    paymentNote: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, marginTop: SP.sm, textAlign: 'center' },

    // Tracking
    trackingNumberDisplay: { fontSize: FS.base, fontFamily: 'Inter_400Regular', color: theme.text, letterSpacing: 1 },
    carrierChip: { backgroundColor: theme.secondaryDim, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
    carrierChipText: { fontSize: FS.xs, fontFamily: FONT.bold, color: theme.secondary },
    estDeliveryRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginTop: SP.sm },
    estDeliveryText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.success },

    // Pre-order
    preOrderTitle: { fontSize: FS.base, fontFamily: FONT.semibold },
    preOrderDetail: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted },

    // Disclaimer
    disclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.subtle, textAlign: 'center', lineHeight: 18 },

    // Bottom action bar
    actionBar: { borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.background, paddingHorizontal: SP.md, paddingTop: SP.sm, gap: SP.sm },
    reviewCTA: {
      backgroundColor: theme.card, borderRadius: RADIUS.md, padding: SP.md,
      borderWidth: 1, borderColor: theme.border, flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    },
    reviewCTATitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
    reviewCTASub: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },
    reviewDoneRow: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm,
      backgroundColor: `${theme.success}1F`, borderRadius: RADIUS.md, padding: SP.sm,
      borderWidth: 1, borderColor: `${theme.success}40`,
    },
    reviewDoneText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.success },
  });
};
