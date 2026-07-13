import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, useColorScheme, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const ORDERS = [
  {
    id: '#2041', name: 'Canvas Cargo Jacket', brand: 'Vault Studio', initials: 'VS',
    price: '$189', status: 'Delivered', date: 'Jul 8, 2026', qty: 1,
    color: '#00C853', tracking: '1Z999AA10123456784', eta: 'Delivered Jul 8',
    items: ['Canvas Cargo Jacket – Olive – Size M'],
  },
  {
    id: '#1988', name: 'Archive Hoodie Vol.3', brand: 'NxGen Drops', initials: 'NX',
    price: '$135', status: 'Shipped', date: 'Jul 5, 2026', qty: 1,
    color: '#B45309', tracking: '9400111899223397658530', eta: 'Expected Jul 14',
    items: ['Archive Hoodie Vol.3 – Black – Size L'],
  },
  {
    id: '#1740', name: 'Relaxed Tee — Sage', brand: 'Meridian Co.', initials: 'MC',
    price: '$48', status: 'Processing', date: 'Jul 3, 2026', qty: 2,
    color: '#0F766E', tracking: null, eta: 'Estimated Jul 18',
    items: ['Relaxed Tee – Sage – Size S', 'Relaxed Tee – Sage – Size M'],
  },
];

const STATUS_STEPS = ['Order Placed', 'Processing', 'Shipped', 'Delivered'];

function stepIndex(status: string) {
  if (status === 'Delivered')  return 3;
  if (status === 'Shipped')    return 2;
  if (status === 'Processing') return 1;
  return 0;
}

export default function BuyerOrdersScreen() {
  const insets  = useSafeAreaInsets();
  const scheme  = useColorScheme();
  const isDark  = scheme !== 'light';
  const router  = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);

  const bg     = isDark ? '#121110' : '#F5F1E7';
  const card   = isDark ? '#1B1917' : '#FFFFFF';
  const border = isDark ? '#33302A' : '#E3DCC9';
  const fg     = isDark ? '#EDE7D9' : '#17140F';
  const muted  = isDark ? '#8C8577' : '#6E6759';
  const green  = isDark ? '#39FF88' : '#00C853';

  return (
    <View style={[s.root, { backgroundColor: bg, paddingTop: Platform.OS === 'web' ? 20 : insets.top }]}>
      <View style={[s.header, { borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color={fg} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: fg }]}>My Orders</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 14 }} showsVerticalScrollIndicator={false}>
        {ORDERS.map((order) => {
          const isOpen = expanded === order.id;
          const step   = stepIndex(order.status);
          return (
            <TouchableOpacity
              key={order.id}
              style={[s.card, { backgroundColor: card, borderColor: border }]}
              activeOpacity={0.92}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setExpanded(isOpen ? null : order.id); }}
            >
              {/* Card top */}
              <View style={s.cardTop}>
                <View style={[s.brandAvatar, { backgroundColor: order.color + '22' }]}>
                  <Text style={[s.brandInitials, { color: order.color }]}>{order.initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.orderName, { color: fg }]} numberOfLines={1}>{order.name}</Text>
                  <Text style={[s.orderBrand, { color: muted }]}>{order.brand} · {order.date}</Text>
                </View>
                <View style={s.cardRight}>
                  <Text style={[s.orderPrice, { color: fg }]}>{order.price}</Text>
                  <View style={[s.statusPill, { backgroundColor: order.color + '22' }]}>
                    <Text style={[s.statusText, { color: order.color }]}>{order.status}</Text>
                  </View>
                </View>
              </View>

              {/* Tracking progress — always visible */}
              <View style={s.progressRow}>
                {STATUS_STEPS.map((label, i) => (
                  <React.Fragment key={label}>
                    <View style={s.stepWrap}>
                      <View style={[s.stepDot, { backgroundColor: i <= step ? order.color : border }]}>
                        {i < step && <Feather name="check" size={8} color="#000" />}
                      </View>
                      <Text style={[s.stepLabel, { color: i <= step ? fg : muted }]} numberOfLines={1}>{label}</Text>
                    </View>
                    {i < STATUS_STEPS.length - 1 && (
                      <View style={[s.stepLine, { backgroundColor: i < step ? order.color : border }]} />
                    )}
                  </React.Fragment>
                ))}
              </View>

              {/* Expanded details */}
              {isOpen && (
                <View style={[s.details, { borderTopColor: border }]}>
                  <Text style={[s.detailLabel, { color: muted }]}>Items</Text>
                  {order.items.map((item) => (
                    <Text key={item} style={[s.detailValue, { color: fg }]}>• {item}</Text>
                  ))}

                  <Text style={[s.detailLabel, { color: muted, marginTop: 12 }]}>Estimated Arrival</Text>
                  <Text style={[s.detailValue, { color: fg }]}>{order.eta}</Text>

                  {order.tracking && (
                    <>
                      <Text style={[s.detailLabel, { color: muted, marginTop: 12 }]}>Tracking Number</Text>
                      <Text style={[s.detailValue, { color: green, fontFamily: 'Inter_600SemiBold' }]}>{order.tracking}</Text>
                    </>
                  )}

                  <View style={s.detailActions}>
                    <TouchableOpacity
                      style={[s.detailBtn, { borderColor: border }]}
                      onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                      activeOpacity={0.75}
                    >
                      <Feather name="help-circle" size={14} color={muted} />
                      <Text style={[s.detailBtnText, { color: fg }]}>Get Help</Text>
                    </TouchableOpacity>
                    {order.status === 'Delivered' && (
                      <TouchableOpacity
                        style={[s.detailBtn, { borderColor: border }]}
                        onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}
                        activeOpacity={0.75}
                      >
                        <Feather name="refresh-ccw" size={14} color={muted} />
                        <Text style={[s.detailBtnText, { color: fg }]}>Return / Exchange</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[s.detailBtnPrimary, { backgroundColor: green }]}
                      onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
                      activeOpacity={0.85}
                    >
                      <Feather name="message-circle" size={14} color="#000" />
                      <Text style={s.detailBtnPrimaryText}>Message Brand</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root:       { flex: 1 },
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  card:       { borderRadius: 16, borderWidth: 1, padding: 14, gap: 14 },
  cardTop:    { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandAvatar: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  brandInitials: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  orderName:  { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  orderBrand: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  cardRight:  { alignItems: 'flex-end', gap: 5 },
  orderPrice: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  progressRow:{ flexDirection: 'row', alignItems: 'center' },
  stepWrap:   { alignItems: 'center', gap: 4 },
  stepDot:    { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  stepLabel:  { fontSize: 9, fontFamily: 'Inter_500Medium', textAlign: 'center', width: 54 },
  stepLine:   { flex: 1, height: 2, marginBottom: 12 },
  details:    { borderTopWidth: 1, paddingTop: 14, gap: 4 },
  detailLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  detailValue: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 },
  detailActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  detailBtn:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  detailBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  detailBtnPrimary: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  detailBtnPrimaryText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#000' },
});
