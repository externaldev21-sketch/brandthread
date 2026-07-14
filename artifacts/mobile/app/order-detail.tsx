import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity, StyleSheet,
  Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { DEMO_ORDERS } from '@/services/data';
import type { Order, OrderStatus } from '@/services/types';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG     = '#0A0B0A';
const CARD   = '#111311';
const BORDER = '#1E221E';
const FG     = '#EAF2ED';
const MUTED  = '#5A6B5C';
const GREEN  = '#39FF88';
const BLUE   = '#3B82F6';
const PURPLE = '#8B5CF6';
const CYAN   = '#06B6D4';
const ORANGE = '#F97316';
const RED    = '#EF4444';

function statusColor(s: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    new: BLUE, processing: PURPLE, ready_to_ship: CYAN, shipped: GREEN,
    delivered: GREEN, refunded: ORANGE, disputed: RED, cancelled: MUTED,
  };
  return map[s] ?? MUTED;
}

function statusLabel(s: OrderStatus): string {
  const map: Record<OrderStatus, string> = {
    new: 'New', processing: 'Processing', ready_to_ship: 'Ready to Ship',
    shipped: 'Shipped', delivered: 'Delivered', refunded: 'Refunded',
    disputed: 'Disputed', cancelled: 'Cancelled',
  };
  return map[s] ?? s;
}

export default function OrderDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const order = DEMO_ORDERS.find(o => o.id === id) ?? DEMO_ORDERS[0];
  const [showShipping, setShowShipping] = useState(false);

  function back() { router.back(); }
  function go(route: string) { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(route as never); }

  function handleAction(label: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (label === 'Buy Shipping Label') {
      setShowShipping(true);
    } else {
      Alert.alert(label, `Action: ${label} for order ${order.orderNumber}`, [{ text: 'OK' }]);
    }
  }

  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* Back bar */}
      <View style={s.backBar}>
        <TouchableOpacity style={s.backBtn} onPress={back} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.backTitle}>{order.orderNumber}</Text>
        <TouchableOpacity style={s.moreBtn}>
          <Feather name="more-horizontal" size={20} color={FG} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
        {/* Status header */}
        <View style={s.statusHeader}>
          <View style={[s.statusBadge, { backgroundColor: statusColor(order.status) + '22', borderColor: statusColor(order.status) + '44' }]}>
            <View style={[s.statusDot, { backgroundColor: statusColor(order.status) }]} />
            <Text style={[s.statusText, { color: statusColor(order.status) }]}>{statusLabel(order.status)}</Text>
          </View>
          <Text style={s.orderDate}>{order.date}</Text>
        </View>

        {/* Customer info */}
        <View style={[s.card, s.section]}>
          <Text style={s.cardTitle}>Customer</Text>
          <View style={s.customerRow}>
            <View style={s.initials}>
              <Text style={s.initialsText}>{order.customer.initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.customerName}>{order.customer.name}</Text>
              <Text style={s.customerEmail}>{order.customer.email}</Text>
              <Text style={s.customerOrders}>{order.customer.totalOrders} lifetime orders</Text>
            </View>
            <TouchableOpacity style={s.contactBtn} onPress={() => {}}>
              <Feather name="message-circle" size={16} color={GREEN} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Items */}
        <View style={[s.card, s.section]}>
          <Text style={s.cardTitle}>Items</Text>
          {order.items.map((item, i) => (
            <View key={i} style={[s.itemRow, i > 0 && s.borderTop]}>
              <View style={s.itemThumb}>
                <Feather name="tag" size={16} color={MUTED} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.itemName}>{item.productName}</Text>
                <Text style={s.itemVariant}>{item.variant}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={s.itemTotal}>${item.total.toFixed(2)}</Text>
                <Text style={s.itemQty}>×{item.quantity}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Price breakdown */}
        <View style={[s.card, s.section]}>
          <Text style={s.cardTitle}>Payment</Text>
          {[
            { label: 'Subtotal',  value: `$${order.subtotal.toFixed(2)}` },
            { label: 'Discount',  value: order.discount > 0 ? `-$${order.discount.toFixed(2)}` : '—', color: GREEN },
            { label: 'Shipping',  value: order.shipping > 0 ? `$${order.shipping.toFixed(2)}` : 'Free' },
            { label: 'Tax',       value: `$${order.tax.toFixed(2)}` },
          ].map(row => (
            <View key={row.label} style={s.priceRow}>
              <Text style={s.priceLabel}>{row.label}</Text>
              <Text style={[s.priceValue, row.color ? { color: row.color } : {}]}>{row.value}</Text>
            </View>
          ))}
          <View style={[s.priceRow, s.totalRow]}>
            <Text style={s.totalLabel}>Total</Text>
            <Text style={s.totalValue}>${order.total.toFixed(2)}</Text>
          </View>
          <View style={[s.payBadge, { backgroundColor: GREEN + '18', borderColor: GREEN + '33' }]}>
            <Feather name="check-circle" size={13} color={GREEN} />
            <Text style={[s.payBadgeText, { color: GREEN }]}>Paid</Text>
          </View>
        </View>

        {/* Shipping address */}
        <View style={[s.card, s.section]}>
          <Text style={s.cardTitle}>Shipping address</Text>
          <Text style={s.addrLine}>{order.shippingAddress.name}</Text>
          <Text style={s.addrLine}>{order.shippingAddress.line1}</Text>
          <Text style={s.addrLine}>{order.shippingAddress.city}, {order.shippingAddress.state} {order.shippingAddress.zip}</Text>
          <Text style={s.addrLine}>{order.shippingAddress.country}</Text>
          {order.trackingNumber && (
            <View style={s.trackingRow}>
              <Feather name="truck" size={13} color={CYAN} />
              <Text style={s.trackingText}>{order.carrier}: {order.trackingNumber}</Text>
            </View>
          )}
        </View>

        {/* Held funds display */}
        {order.paymentStatus === 'paid' && order.status !== 'delivered' && (
          <View style={[s.card, s.section]}>
            <Text style={s.cardTitle}>Funds breakdown</Text>
            <Text style={s.fundsNote}>Funds are released upon shipment and delivery confirmation.</Text>
            {[
              { label: 'Customer paid',        value: `$${order.total.toFixed(2)}`,     color: FG    },
              { label: 'Shipping allocation',   value: `-$${order.shipping.toFixed(2)}`, color: MUTED },
              { label: 'Platform fee (5%)',     value: `-$${(order.total * 0.05).toFixed(2)}`, color: MUTED },
              { label: 'Your net',              value: `$${(order.total - order.shipping - order.total * 0.05).toFixed(2)}`, color: GREEN },
            ].map(row => (
              <View key={row.label} style={s.fundsRow}>
                <Text style={s.fundsLabel}>{row.label}</Text>
                <Text style={[s.fundsValue, { color: row.color }]}>{row.value}</Text>
              </View>
            ))}
            <View style={s.holdBadge}>
              <Feather name="clock" size={12} color={ORANGE} />
              <Text style={s.holdText}>Held until delivery confirmed</Text>
            </View>
          </View>
        )}

        {/* Timeline */}
        <View style={[s.card, s.section]}>
          <Text style={s.cardTitle}>Timeline</Text>
          {order.timeline.map((ev, i) => (
            <View key={i} style={[s.timelineRow, i > 0 && s.borderTop]}>
              <View style={[s.tlDot, { backgroundColor: ev.type === 'success' ? GREEN : ev.type === 'warning' ? ORANGE : MUTED }]} />
              <View style={{ flex: 1 }}>
                <Text style={s.tlEvent}>{ev.event}</Text>
                <Text style={s.tlDate}>{ev.date}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={s.section}>
          <Text style={s.cardTitle}>Actions</Text>
          <View style={s.actionsGrid}>
            {[
              { label: 'Mark Processing',     icon: 'refresh-cw'      as const, color: PURPLE },
              { label: 'Mark Ready to Ship',  icon: 'package'         as const, color: CYAN   },
              { label: 'Buy Shipping Label',  icon: 'truck'           as const, color: GREEN  },
              { label: 'Add Tracking',        icon: 'map-pin'         as const, color: BLUE   },
              { label: 'Mark Shipped',        icon: 'send'            as const, color: GREEN  },
              { label: 'Contact Customer',    icon: 'message-circle'  as const, color: MUTED  },
              { label: 'Cancel Order',        icon: 'x-circle'        as const, color: RED    },
              { label: 'Issue Refund',        icon: 'rotate-ccw'      as const, color: ORANGE },
            ].map(action => (
              <TouchableOpacity
                key={action.label}
                style={s.actionCard}
                onPress={() => handleAction(action.label)}
                activeOpacity={0.8}
              >
                <View style={[s.actionIcon, { backgroundColor: action.color + '20' }]}>
                  <Feather name={action.icon} size={16} color={action.color} />
                </View>
                <Text style={s.actionLabel}>{action.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Shipping label modal */}
        {showShipping && (
          <ShippingLabelPanel order={order} onClose={() => setShowShipping(false)} />
        )}
      </ScrollView>
    </View>
  );
}

// ─── Shipping label inline panel ──────────────────────────────────────────────
function ShippingLabelPanel({ order, onClose }: { order: Order; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);

  const carriers = [
    { name: 'UPS Ground',      price: '$8.49',  days: '3-5 business days', color: '#F97316' },
    { name: 'USPS Priority',   price: '$10.20', days: '1-3 business days', color: BLUE      },
    { name: 'FedEx 2-Day',     price: '$18.95', days: '2 business days',   color: '#7C3AED' },
    { name: 'DHL Express',     price: '$24.50', days: '1-2 business days', color: '#FBBF24' },
  ];

  return (
    <View style={[sl.wrap, { marginHorizontal: 16, marginBottom: 16 }]}>
      <View style={sl.head}>
        <Text style={sl.title}>Buy Shipping Label</Text>
        <TouchableOpacity onPress={onClose}><Feather name="x" size={18} color={MUTED} /></TouchableOpacity>
      </View>
      <View style={sl.infoRow}>
        <Text style={sl.infoLabel}>Ship to</Text>
        <Text style={sl.infoValue}>{order.shippingAddress.city}, {order.shippingAddress.state}</Text>
      </View>
      <View style={sl.infoRow}>
        <Text style={sl.infoLabel}>Weight</Text>
        <Text style={sl.infoValue}>0.8 kg (estimated)</Text>
      </View>
      <Text style={sl.subTitle}>Select carrier</Text>
      {carriers.map((c, i) => (
        <TouchableOpacity
          key={c.name}
          style={[sl.carrierRow, selected === i && sl.carrierSelected, { borderColor: selected === i ? c.color + '66' : BORDER }]}
          onPress={() => setSelected(i)}
          activeOpacity={0.8}
        >
          <View style={[sl.carrierDot, { backgroundColor: c.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={sl.carrierName}>{c.name}</Text>
            <Text style={sl.carrierDays}>{c.days}</Text>
          </View>
          <Text style={sl.carrierPrice}>{c.price}</Text>
          {selected === i && <Feather name="check-circle" size={16} color={GREEN} />}
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={[sl.buyBtn, selected === null && sl.buyBtnDisabled]}
        disabled={selected === null}
        onPress={() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          Alert.alert('Label Purchased', `Shipping label from ${carriers[selected!].name} has been created.`, [{ text: 'OK', onPress: onClose }]);
        }}
        activeOpacity={0.85}
      >
        <LinearGradient colors={[GREEN, '#00C853']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={sl.buyGrad}>
          <Feather name="truck" size={15} color="#0A0B0A" />
          <Text style={sl.buyText}>Buy Label {selected !== null ? carriers[selected].price : ''}</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const sl = StyleSheet.create({
  wrap:   { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER, overflow: 'hidden', marginTop: 16 },
  head:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER },
  title:  { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  infoRow:{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 6 },
  infoLabel:{ fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  infoValue:{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: FG },
  subTitle:{ fontSize: 13, fontFamily: 'Inter_600SemiBold', color: MUTED, paddingHorizontal: 16, marginTop: 8, marginBottom: 4 },
  carrierRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, marginHorizontal: 12, marginBottom: 8, borderRadius: 12 },
  carrierSelected: { backgroundColor: GREEN + '08' },
  carrierDot:    { width: 8, height: 8, borderRadius: 4 },
  carrierName:   { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  carrierDays:   { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  carrierPrice:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: FG, marginRight: 4 },
  buyBtn:        { margin: 16, borderRadius: 14, overflow: 'hidden' },
  buyBtnDisabled:{ opacity: 0.4 },
  buyGrad:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15 },
  buyText:       { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#0A0B0A' },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  backBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  backTitle: { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },
  moreBtn:   { width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },

  statusHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 16 },
  statusBadge:  { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1 },
  statusDot:    { width: 6, height: 6, borderRadius: 3 },
  statusText:   { fontSize: 12, fontFamily: 'Inter_700Bold' },
  orderDate:    { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },

  section:  { marginHorizontal: 16, marginBottom: 12 },
  card:     { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 10 },
  cardTitle:{ fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 4 },
  borderTop:{ borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 12, marginTop: 4 },

  customerRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  initials:       { width: 44, height: 44, borderRadius: 22, backgroundColor: PURPLE + '30', alignItems: 'center', justifyContent: 'center' },
  initialsText:   { fontSize: 16, fontFamily: 'Inter_700Bold', color: PURPLE },
  customerName:   { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  customerEmail:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  customerOrders: { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  contactBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: GREEN + '15', alignItems: 'center', justifyContent: 'center' },

  itemRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  itemThumb:  { width: 44, height: 44, borderRadius: 10, backgroundColor: '#1A1E1A', alignItems: 'center', justifyContent: 'center' },
  itemName:   { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  itemVariant:{ fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  itemTotal:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: FG },
  itemQty:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },

  priceRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  priceLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  priceValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  totalRow:   { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 12, marginTop: 4 },
  totalLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  totalValue: { fontSize: 17, fontFamily: 'Inter_700Bold', color: FG },
  payBadge:   { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, alignSelf: 'flex-start' },
  payBadgeText:{ fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  addrLine:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: FG, lineHeight: 20 },
  trackingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: CYAN + '15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  trackingText:{ fontSize: 12, fontFamily: 'Inter_500Medium', color: CYAN, flex: 1 },

  fundsNote:  { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 4, lineHeight: 17 },
  fundsRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  fundsLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  fundsValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  holdBadge:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: ORANGE + '15', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  holdText:   { fontSize: 11, fontFamily: 'Inter_500Medium', color: ORANGE },

  timelineRow:{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  tlDot:      { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  tlEvent:    { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  tlDate:     { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },

  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  actionCard:  { width: '22.5%', backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, alignItems: 'center', paddingVertical: 14, gap: 7 },
  actionIcon:  { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', color: MUTED, textAlign: 'center' },
});
