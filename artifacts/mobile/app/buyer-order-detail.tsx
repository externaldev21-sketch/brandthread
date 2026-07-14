import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { getBuyerOrder } from '@/services/orderService';
import { BuyerOrderView, OrderStatus, TrackingStatus } from '@/services/orderTypes';
import { getAllDemoProducts } from '@/services/cartService';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, BORDER_FOCUS,
  FG, MUTED, SUBTLE, ON_DARK,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM, CYAN_LIGHT,
  SUCCESS, SUCCESS_DIM,
  BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, COMP, ICON,
  SHADOW_PURPLE,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadHeader, BrandthreadCard,
  GradientCard, StatusBadge, PrimaryButton, SecondaryButton,
} from '@/components/BrandthreadUI';

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

export default function BuyerOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<BuyerOrderView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getBuyerOrder(id).then(o => {
      setOrder(o ?? null);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  function handleCopyTracking() {
    if (!order?.trackingNumber) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert('Tracking Number', order.trackingNumber);
  }

  function handleContactSeller() {
    if (!order) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const sellerId = 'u_' + order.sellerName.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const initials = order.sellerName
      .split(/\s+/)
      .map(w => w[0] ?? '')
      .slice(0, 2)
      .join('')
      .toUpperCase();
    router.push((
      '/buyer-conversation?participantId=' + encodeURIComponent(sellerId) +
      '&participantName=' + encodeURIComponent(order.sellerName) +
      '&participantHandle=%40' + encodeURIComponent(order.sellerName.toLowerCase().replace(/\s+/g, '')) +
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
      '/buyer-report?targetType=seller&targetId=' +
      encodeURIComponent('u_' + order.sellerName.toLowerCase().replace(/[^a-z0-9]+/g, '_')) +
      '&targetLabel=' + encodeURIComponent(order.sellerName)
    ) as never);
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

  async function handleBuyAgain() {
    if (!order) return;
    const firstItem = order.lineItems[0];
    if (!firstItem) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Look up demo catalog by product name to find the productId
    const allProducts = getAllDemoProducts();
    const match = allProducts.find(p =>
      p.name.toLowerCase() === firstItem.productName.toLowerCase()
    );
    if (match) {
      router.push(('/buyer-product-detail?productId=' + match.id + '&productName=' + encodeURIComponent(match.name)) as never);
    } else {
      // Product not in demo catalog — navigate to discover
      Alert.alert(
        'Buy Again',
        `${firstItem.productName} — tap Discover to find similar items.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Discover', onPress: () => router.push('/(buyer)/discover' as never) },
        ]
      );
    }
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  if (!order) {
    return (
      <BrandthreadScreen>
        <BrandthreadHeader title="Order Not Found" onBack={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
          <Feather name="alert-circle" size={ICON.xxl} color={MUTED} />
          <Text style={{ marginTop: SP.md, fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textAlign: 'center' }}>
            We couldn't find this order. It may have been removed.
          </Text>
          <SecondaryButton label="Go Back" onPress={() => router.back()} style={{ marginTop: SP.md }} />
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
                {item.quantity} × ${item.unitPrice.toFixed(2)}
              </Text>
            </View>
          ))}
        </SectionCard>

        {/* ── Payment Summary ───────────────────────────────────────────────── */}
        <SectionCard title="Payment Summary">
          <Row label="Subtotal" value={`$${order.payment.subtotal.toFixed(2)}`} />
          <Row label="Shipping" value={`$${order.payment.shippingTotal.toFixed(2)}`} />
          <Row label="Tax" value={`$${order.payment.taxTotal.toFixed(2)}`} />
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>${order.payment.total.toFixed(2)}</Text>
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
                label="Track on carrier (demo)"
                icon="external-link"
                onPress={() => Alert.alert('Track Shipment', `Carrier tracking for ${order.trackingNumber} — demo mode. In production this would open the carrier website.`)}
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
              colors={['rgba(34,211,238,0.12)', 'rgba(34,211,238,0.04)']}
              style={{ borderColor: 'rgba(34,211,238,0.35)' }}
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
          <PrimaryButton
            label="Contact Seller"
            icon="message-circle"
            onPress={handleContactSeller}
          />
          <SecondaryButton
            label="Request Return"
            icon="refresh-ccw"
            onPress={handleRequestReturn}
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
    </BrandthreadScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
