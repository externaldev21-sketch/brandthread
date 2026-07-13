import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';

// ─── Tokens ───────────────────────────────────────────────────────────────────
const BG      = '#0A0B0A';
const CARD    = '#131713';
const CARD2   = '#111211';
const BORDER  = '#1E221E';
const FG      = '#EAF2ED';
const MUTED   = '#5C6B5E';
const GREEN   = '#39FF88';
const GREEN_D = '#0C2418';

// ─── Data ─────────────────────────────────────────────────────────────────────
const PROD_STATS = [
  { value: '12', label: 'In Production', icon: 'package'   as const, color: GREEN },
  { value: '7',  label: 'Sampling',      icon: 'scissors'  as const, color: '#F97316' },
  { value: '3',  label: 'Shipped',       icon: 'truck'     as const, color: '#0EA5E9' },
  { value: '2',  label: 'Needs Approval',icon: 'alert-circle' as const, color: '#EF4444' },
];

const PIPELINE = [
  { key: 'design',     label: 'Design',     done: true,  active: false },
  { key: 'sample',     label: 'Sample',     done: true,  active: false },
  { key: 'production', label: 'Production', done: false, active: true  },
  { key: 'qc',         label: 'QC',         done: false, active: false },
  { key: 'shipping',   label: 'Shipping',   done: false, active: false },
];

const MANUFACTURERS = [
  {
    id: 'm1', name: 'Ace Apparel Co.', location: 'Pakistan', initials: 'ACE',
    rating: 4.9, verified: true, moq: 100, price: '$7.80', lead: '18-22 Days',
    gradient: ['#1A2C1A', '#0F1F0F'] as [string,string],
    factorColor: '#2C3E2C',
  },
  {
    id: 'm2', name: 'Stitch Labs', location: 'Portugal', initials: 'SL',
    rating: 4.8, verified: true, moq: 100, price: '$9.20', lead: '15-18 Days',
    gradient: ['#1A1F2C', '#0F1520'] as [string,string],
    factorColor: '#2C3040',
  },
  {
    id: 'm3', name: 'Elite Garments', location: 'Turkey', initials: 'EG',
    rating: 4.5, verified: true, moq: 200, price: '$8.50', lead: '20-25 Days',
    gradient: ['#2C1A1A', '#200F0F'] as [string,string],
    factorColor: '#3C2020',
  },
  {
    id: 'm4', name: 'Apex Garment Co.', location: 'Guangzhou, CN', initials: 'AG',
    rating: 4.9, verified: true, moq: 50, price: '$4.20', lead: '18 Days',
    gradient: ['#1E2A1E', '#121A12'] as [string,string],
    factorColor: '#253025',
  },
];

const MESSAGES = [
  { id: 'msg1', name: 'Ace Apparel Co.',  initials: 'ACE', online: true,  preview: 'We have received your tech pack. Sample will be ready in 5 days.', time: '2m ago', unread: 2 },
  { id: 'msg2', name: 'Stitch Labs',      initials: 'SL',  online: true,  preview: 'Can you confirm the pantone colors?',                               time: '1h ago', unread: 0 },
  { id: 'msg3', name: 'Elite Garments',   initials: 'EG',  online: true,  preview: 'Production update: 60% completed.',                                 time: '3h ago', unread: 0 },
];

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ManufacturerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  function go(route: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  return (
    <View style={[s.root, { paddingTop: topPad }]}>

      {/* ── Top Nav ── */}
      <View style={s.topNav}>
        <TouchableOpacity onPress={() => router.back()} style={s.navIcon} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <Text style={s.navTitle}>Manufacturer Hub</Text>
        <TouchableOpacity style={s.navIcon} onPress={() => go('/chat/manufacturer-ace')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="message-circle" size={20} color={FG} />
        </TouchableOpacity>
      </View>

      {/* ── Scrollable Body ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 100, gap: 14, padding: 14 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Production Overview ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Production Overview</Text>
            <TouchableOpacity onPress={() => go('/payments')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.viewAllText}>View All</Text>
            </TouchableOpacity>
          </View>
          <View style={s.statsGrid}>
            {PROD_STATS.map((st) => (
              <View key={st.label} style={[s.statChip, { borderColor: BORDER }]}>
                <View style={s.statTopRow}>
                  <View style={[s.statIconBox, { backgroundColor: st.color + '22' }]}>
                    <Feather name={st.icon} size={13} color={st.color} />
                  </View>
                  <Text style={[s.statValue, { color: st.color }]}>{st.value}</Text>
                </View>
                <Text style={s.statLabel} numberOfLines={2}>{st.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* ── Active Order ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={s.cardTitle}>Active Order</Text>
              <Text style={[s.orderTag, { color: MUTED }]}>#BT-78291</Text>
            </View>
            <TouchableOpacity onPress={() => go('/payments')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={[s.viewAllText, { color: GREEN }]}>View Details</Text>
                <Feather name="chevron-right" size={13} color={GREEN} />
              </View>
            </TouchableOpacity>
          </View>

          {/* Product row */}
          <View style={s.productRow}>
            <LinearGradient colors={['#1E2A1E', '#0E160E']} style={s.productThumb}>
              <Feather name="shopping-bag" size={22} color={GREEN + '99'} />
            </LinearGradient>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Text style={s.productName}>Heavyweight Hoodie</Text>
                <Text style={[s.productStatus, { color: GREEN }]}>In Production</Text>
              </View>
              <Text style={s.productSpec}>500 GSM • Puff Print</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[s.productQty, { color: GREEN }]}>Quantity: 250</Text>
                <Text style={[s.productPct, { color: GREEN }]}>60%</Text>
              </View>
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: '60%' }]} />
              </View>
            </View>
          </View>

          {/* Pipeline steps */}
          <View style={s.pipeline}>
            {PIPELINE.map((step, i) => (
              <React.Fragment key={step.key}>
                <View style={s.pipeStep}>
                  <View style={[
                    s.pipeCircle,
                    step.done   && { backgroundColor: GREEN, borderColor: GREEN },
                    step.active && { borderColor: GREEN },
                    !step.done && !step.active && { borderColor: BORDER },
                  ]}>
                    {step.done ? (
                      <Feather name="check" size={10} color="#000" />
                    ) : step.active ? (
                      <Feather name="settings" size={10} color={GREEN} />
                    ) : (
                      <View style={[s.pipeDot, { backgroundColor: MUTED }]} />
                    )}
                  </View>
                  <Text style={[s.pipeLabel, { color: step.done || step.active ? FG : MUTED }]}>{step.label}</Text>
                </View>
                {i < PIPELINE.length - 1 && (
                  <View style={[s.pipeLine, { backgroundColor: step.done ? GREEN + '60' : BORDER }]} />
                )}
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* ── Find Manufacturers ── */}
        <View style={{ gap: 10 }}>
          <View style={[s.cardHeader, { paddingHorizontal: 0 }]}>
            <Text style={s.cardTitle}>Find Manufacturers</Text>
            <TouchableOpacity onPress={() => go('/manufacturer-onboard')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={[s.viewAllText, { color: GREEN }]}>View All</Text>
                <Feather name="chevron-right" size={13} color={GREEN} />
              </View>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {MANUFACTURERS.map((m) => (
              <MfrCard key={m.id} m={m} onPress={() => go('/chat/manufacturer-' + m.id)} onSample={() => go('/request-sample?name=' + encodeURIComponent(m.name))} />
            ))}
          </ScrollView>
        </View>

        {/* ── Recent Messages ── */}
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardTitle}>Recent Messages</Text>
            <TouchableOpacity onPress={() => go('/chat/manufacturer-m1')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={[s.viewAllText, { color: GREEN }]}>View All</Text>
                <Feather name="chevron-right" size={13} color={GREEN} />
              </View>
            </TouchableOpacity>
          </View>
          {MESSAGES.map((msg, i) => (
            <TouchableOpacity
              key={msg.id}
              style={[s.msgRow, i > 0 && { borderTopWidth: 1, borderTopColor: BORDER }]}
              onPress={() => go('/chat/manufacturer-' + msg.id)}
              activeOpacity={0.8}
            >
              <View style={s.msgAvatar}>
                <Text style={s.msgAvatarText}>{msg.initials}</Text>
                {msg.online && <View style={s.onlineDot} />}
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={s.msgName}>{msg.name}</Text>
                  <Text style={s.msgTime}>{msg.time}</Text>
                </View>
                <Text style={s.msgPreview} numberOfLines={2}>{msg.preview}</Text>
              </View>
              {msg.unread > 0 && (
                <View style={s.unreadBadge}>
                  <Text style={s.unreadText}>{msg.unread}</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Manufacturer card (horizontal scroll) ────────────────────────────────────
function MfrCard({ m, onPress, onSample }: { m: typeof MANUFACTURERS[0]; onPress: () => void; onSample: () => void }) {
  return (
    <View style={mc.card}>
      {/* Factory photo placeholder */}
      <LinearGradient colors={m.gradient} style={mc.photo}>
        {/* Simulated factory floor rows */}
        {[0,1,2,3].map(row => (
          <View key={row} style={[mc.factoryRow, { top: 20 + row * 18, opacity: 0.35 }]}>
            {[0,1,2,3,4,5].map(col => (
              <View key={col} style={[mc.factoryDesk, { backgroundColor: m.factorColor }]} />
            ))}
          </View>
        ))}
        {/* Rating badge */}
        <View style={mc.ratingBadge}>
          <Feather name="star" size={9} color="#FBBF24" />
          <Text style={mc.ratingText}>{m.rating}</Text>
        </View>
        {/* Verified badge */}
        <View style={mc.verifiedBadge}>
          <Feather name="check" size={9} color="#000" />
          <Text style={mc.verifiedText}>Verified</Text>
        </View>
      </LinearGradient>

      {/* Card body */}
      <View style={mc.body}>
        <Text style={mc.name}>{m.name}</Text>
        <Text style={mc.location}>{m.location}</Text>
        <View style={mc.specRow}>
          <Text style={mc.spec}>MOQ {m.moq}</Text>
          <Text style={mc.spec}>From {m.price}</Text>
        </View>
        <Text style={mc.lead}>{m.lead}</Text>
        {/* Icon buttons */}
        <View style={mc.iconRow}>
          <TouchableOpacity style={mc.iconBtn} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
            <Feather name="globe" size={14} color={MUTED} />
          </TouchableOpacity>
          <TouchableOpacity style={mc.iconBtn} onPress={() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)}>
            <Feather name="shield" size={14} color={MUTED} />
          </TouchableOpacity>
          <TouchableOpacity style={mc.iconBtn} onPress={onPress}>
            <Feather name="message-circle" size={14} color={MUTED} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },

  topNav:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: BORDER },
  navIcon: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  navTitle:{ fontSize: 16, fontFamily: 'Inter_700Bold', color: FG },

  card:        { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 14 },
  cardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle:   { fontSize: 15, fontFamily: 'Inter_700Bold', color: FG },
  viewAllText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },

  // Production stats
  statsGrid:   { flexDirection: 'row', gap: 8 },
  statChip:    { flex: 1, backgroundColor: CARD2, borderRadius: 12, borderWidth: 1, padding: 10, gap: 6 },
  statTopRow:  { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statIconBox: { width: 22, height: 22, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  statValue:   { fontSize: 16, fontFamily: 'Inter_700Bold' },
  statLabel:   { fontSize: 9, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 12 },

  // Order ID
  orderTag:    { fontSize: 12, fontFamily: 'Inter_500Medium' },

  // Product row
  productRow:   { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  productThumb: { width: 72, height: 72, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  productName:  { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  productStatus:{ fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  productSpec:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  productQty:   { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  productPct:   { fontSize: 12, fontFamily: 'Inter_700Bold' },
  progressTrack:{ height: 5, backgroundColor: '#1A2A1A', borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  progressFill: { height: 5, backgroundColor: GREEN, borderRadius: 3 },

  // Pipeline
  pipeline:    { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  pipeStep:    { alignItems: 'center', gap: 5 },
  pipeCircle:  { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  pipeDot:     { width: 6, height: 6, borderRadius: 3 },
  pipeLabel:   { fontSize: 9, fontFamily: 'Inter_500Medium', textAlign: 'center', width: 52 },
  pipeLine:    { flex: 1, height: 1.5, marginBottom: 14 },

  // Messages
  msgRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 12 },
  msgAvatar:  { width: 42, height: 42, borderRadius: 12, backgroundColor: '#1A2A1A', alignItems: 'center', justifyContent: 'center' },
  msgAvatarText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: GREEN },
  onlineDot:  { position: 'absolute', bottom: 1, right: 1, width: 9, height: 9, borderRadius: 5, backgroundColor: GREEN, borderWidth: 1.5, borderColor: CARD },
  msgName:    { fontSize: 13, fontFamily: 'Inter_700Bold', color: FG },
  msgTime:    { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  msgPreview: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 17 },
  unreadBadge:{ width: 20, height: 20, borderRadius: 10, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  unreadText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#000' },
});

const mc = StyleSheet.create({
  card:     { width: 160, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  photo:    { height: 110, overflow: 'hidden', position: 'relative', alignItems: 'center', justifyContent: 'center' },
  factoryRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', gap: 6, paddingHorizontal: 8 },
  factoryDesk:{ flex: 1, height: 10, borderRadius: 2 },
  ratingBadge:{ position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3 },
  ratingText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#FBBF24' },
  verifiedBadge: { position: 'absolute', bottom: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: GREEN, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  verifiedText:  { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#000' },
  body:     { padding: 10, gap: 4 },
  name:     { fontSize: 13, fontFamily: 'Inter_700Bold', color: FG },
  location: { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  specRow:  { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  spec:     { fontSize: 10, fontFamily: 'Inter_500Medium', color: MUTED },
  lead:     { fontSize: 10, fontFamily: 'Inter_400Regular', color: MUTED },
  iconRow:  { flexDirection: 'row', gap: 8, marginTop: 6 },
  iconBtn:  { width: 28, height: 28, borderRadius: 8, backgroundColor: '#1A2A1A', alignItems: 'center', justifyContent: 'center' },
});
