import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, Platform, Switch,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ─── Types ────────────────────────────────────────────────────────────────────

type DropType   = 'pre-order' | 'pre-made';
type DropStatus = 'held' | 'processing' | 'scheduled' | 'paid';

interface Drop {
  id: string;
  name: string;
  type: DropType;
  totalOrders: number;
  totalCollected: string;
  totalRaw: number;
  payoutDate: string;
  status: DropStatus;
  releaseDate?: string;   // Pre Order only — when items ship
  mfgProgress?: number;   // Pre Order only — 0–1
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const DROPS: Drop[] = [
  {
    id: 'DROP-001',
    name: 'Summer Collection Vol. 3',
    type: 'pre-order',
    totalOrders: 142,
    totalCollected: '$18,440',
    totalRaw: 18440,
    releaseDate: 'Aug 15, 2026',
    payoutDate: 'Aug 18, 2026',
    status: 'held',
    mfgProgress: 0.65,
  },
  {
    id: 'DROP-002',
    name: 'Essential Basics – Restock',
    type: 'pre-made',
    totalOrders: 89,
    totalCollected: '$7,210',
    totalRaw: 7210,
    payoutDate: 'Jul 9, 2026',
    status: 'processing',
  },
  {
    id: 'DROP-003',
    name: 'Heritage Hoodie Drop',
    type: 'pre-order',
    totalOrders: 210,
    totalCollected: '$31,500',
    totalRaw: 31500,
    releaseDate: 'Jul 20, 2026',
    payoutDate: 'Jul 23, 2026',
    status: 'held',
    mfgProgress: 0.88,
  },
  {
    id: 'DROP-004',
    name: 'Spring Capsule',
    type: 'pre-made',
    totalOrders: 156,
    totalCollected: '$12,480',
    totalRaw: 12480,
    payoutDate: 'Jun 30, 2026',
    status: 'paid',
  },
  {
    id: 'DROP-005',
    name: 'Limited Collab – Artist Series',
    type: 'pre-order',
    totalOrders: 320,
    totalCollected: '$44,800',
    totalRaw: 44800,
    releaseDate: 'Sep 1, 2026',
    payoutDate: 'Sep 4, 2026',
    status: 'held',
    mfgProgress: 0.30,
  },
];

const PAYMENT_METHODS = [
  { name: 'Credit / Debit Cards',    desc: 'Visa, Mastercard, Amex',  icon: 'credit-card' as const, on: true  },
  { name: 'Apple Pay / Google Pay',  desc: 'Digital wallet payments', icon: 'smartphone'  as const, on: true  },
  { name: 'Buy Now, Pay Later',      desc: 'Klarna, Afterpay, Affirm',icon: 'calendar'    as const, on: true  },
  { name: 'International Currencies',desc: '135 currencies supported',icon: 'globe'       as const, on: true  },
  { name: 'Crypto Payments',         desc: 'Bitcoin, Ethereum (Beta)',icon: 'zap'         as const, on: false },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusConfig: Record<DropStatus, { variant: 'success' | 'warning' | 'info' | 'error'; label: string }> = {
  held:       { variant: 'warning', label: 'Held'       },
  processing: { variant: 'info',    label: 'Processing' },
  scheduled:  { variant: 'info',    label: 'Scheduled'  },
  paid:       { variant: 'success', label: 'Paid'       },
};

// ─── Drop Card ────────────────────────────────────────────────────────────────

interface DropCardProps {
  drop: Drop;
  colors: ReturnType<typeof useColors>;
  isDark: boolean;
  isLast: boolean;
}

function DropCard({ drop, colors, isDark, isLast }: DropCardProps) {
  const primary = isDark ? '#9F7AEA' : '#7C3AED';
  const isPreOrder = drop.type === 'pre-order';
  const s = statusConfig[drop.status];

  const typeColor   = isPreOrder ? (isDark ? '#C4B5FD' : '#7C3AED') : (isDark ? '#22C55E' : '#16A34A');
  const typeBg      = isPreOrder ? (isDark ? '#9F7AEA18' : '#EDE9FE') : (isDark ? '#22C55E18' : '#DCFCE7');
  const typeBorder  = isPreOrder ? (isDark ? '#9F7AEA33' : '#DDD6FE') : (isDark ? '#22C55E33' : '#BBF7D0');
  const progressBg  = isDark ? '#252535' : '#EDE9FE';

  return (
    <View style={[
      styles.dropCard,
      { backgroundColor: colors.card, borderColor: colors.border },
      !isLast && { marginBottom: 12 },
    ]}>
      {/* Top row */}
      <View style={styles.dropTop}>
        {/* Type badge */}
        <View style={[styles.typeBadge, { backgroundColor: typeBg, borderColor: typeBorder }]}>
          <Feather
            name={isPreOrder ? 'clock' : 'package'}
            size={11}
            color={typeColor}
          />
          <Text style={[styles.typeText, { color: typeColor }]}>
            {isPreOrder ? 'Pre Order' : 'Pre Made'}
          </Text>
        </View>
        <Badge label={s.label} variant={s.variant} />
      </View>

      {/* Name */}
      <Text style={[styles.dropName, { color: colors.foreground }]}>{drop.name}</Text>

      {/* Key numbers */}
      <View style={styles.dropStats}>
        <View style={styles.dropStat}>
          <Text style={[styles.dropStatVal, { color: colors.foreground }]}>{drop.totalCollected}</Text>
          <Text style={[styles.dropStatLabel, { color: colors.mutedForeground }]}>Collected</Text>
        </View>
        <View style={[styles.dropDivider, { backgroundColor: colors.border }]} />
        <View style={styles.dropStat}>
          <Text style={[styles.dropStatVal, { color: colors.foreground }]}>{drop.totalOrders}</Text>
          <Text style={[styles.dropStatLabel, { color: colors.mutedForeground }]}>Orders</Text>
        </View>
        <View style={[styles.dropDivider, { backgroundColor: colors.border }]} />
        <View style={styles.dropStat}>
          <Text style={[styles.dropStatVal, { color: drop.status === 'paid' ? colors.success : primary }]}>
            {drop.payoutDate}
          </Text>
          <Text style={[styles.dropStatLabel, { color: colors.mutedForeground }]}>
            {drop.status === 'paid' ? 'Paid out' : 'Payout date'}
          </Text>
        </View>
      </View>

      {/* Pre Order extras: manufacturing progress + ship date */}
      {isPreOrder && drop.mfgProgress != null && (
        <View style={styles.preOrderExtra}>
          <View style={styles.progressHeader}>
            <View style={styles.progressLabelRow}>
              <Feather name="tool" size={12} color={colors.mutedForeground} />
              <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>
                Manufacturing progress
              </Text>
            </View>
            <Text style={[styles.progressPct, { color: primary }]}>
              {Math.round(drop.mfgProgress * 100)}%
            </Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: progressBg }]}>
            <View style={[styles.progressFill, { width: `${drop.mfgProgress * 100}%`, backgroundColor: primary }]} />
          </View>
          <View style={styles.shipRow}>
            <Feather name="truck" size={12} color={colors.mutedForeground} />
            <Text style={[styles.shipText, { color: colors.mutedForeground }]}>
              Ships {drop.releaseDate} · Funds release 3 days after delivery
            </Text>
          </View>
        </View>
      )}

      {/* Pre Made: note */}
      {!isPreOrder && drop.status !== 'paid' && (
        <View style={styles.premadeNote}>
          <Feather name="info" size={12} color={colors.mutedForeground} />
          <Text style={[styles.premadeNoteText, { color: colors.mutedForeground }]}>
            Inventory ships within 24–48 hrs · Payout 2–3 business days after fulfillment
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PaymentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [methods, setMethods] = useState(PAYMENT_METHODS.map((m) => m.on));

  const isDark = colors.background === '#08080F' || colors.background.startsWith('#0');
  const primary = isDark ? '#9F7AEA' : '#7C3AED';

  // Summary numbers
  const heldTotal     = DROPS.filter((d) => d.status === 'held').reduce((s, d) => s + d.totalRaw, 0);
  const availableNow  = DROPS.filter((d) => d.status === 'processing').reduce((s, d) => s + d.totalRaw, 0);
  const lastPaid      = DROPS.find((d) => d.status === 'paid');

  const preOrderDrops = DROPS.filter((d) => d.type === 'pre-order');
  const preMadeDrops  = DROPS.filter((d) => d.type === 'pre-made');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Payments" subtitle="Drop payouts & methods" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 120, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Balance summary ── */}
        <View style={[styles.summaryCard, { backgroundColor: isDark ? '#0F0A1E' : colors.secondary, borderColor: isDark ? '#9F7AEA44' : colors.border }]}>
          <View style={styles.summaryRow}>
            {/* Available */}
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: isDark ? '#9F7AEA88' : colors.mutedForeground }]}>
                AVAILABLE NOW
              </Text>
              <Text style={[styles.summaryAmount, { color: colors.success }]}>
                ${availableNow.toLocaleString()}
              </Text>
              <Text style={[styles.summarySub, { color: colors.mutedForeground }]}>Pre Made drops</Text>
            </View>

            <View style={[styles.summaryDivider, { backgroundColor: isDark ? '#9F7AEA22' : colors.border }]} />

            {/* Held */}
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryLabel, { color: isDark ? '#9F7AEA88' : colors.mutedForeground }]}>
                HELD IN ESCROW
              </Text>
              <Text style={[styles.summaryAmount, { color: isDark ? '#C4B5FD' : primary }]}>
                ${heldTotal.toLocaleString()}
              </Text>
              <Text style={[styles.summarySub, { color: colors.mutedForeground }]}>Pre Order drops</Text>
            </View>
          </View>

          {/* Info line */}
          <View style={[styles.summaryInfo, { borderTopColor: isDark ? '#9F7AEA22' : colors.border }]}>
            <Feather name="info" size={12} color={colors.mutedForeground} />
            <Text style={[styles.summaryInfoText, { color: colors.mutedForeground }]}>
              Pre Order funds are held until your drop ships and customers receive their orders
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.requestBtn, { backgroundColor: primary, opacity: availableNow > 0 ? 1 : 0.4 }]}
            activeOpacity={0.8}
            disabled={availableNow === 0}
          >
            <Feather name="arrow-down-circle" size={15} color="#FFFFFF" />
            <Text style={styles.requestBtnText}>Request Payout  ·  ${availableNow.toLocaleString()}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Pre Order Drops ── */}
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionDot, { backgroundColor: isDark ? '#C4B5FD' : '#7C3AED' }]} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pre Order Drops</Text>
          <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{preOrderDrops.length}</Text>
        </View>
        <View style={[styles.preOrderNote, { backgroundColor: isDark ? '#9F7AEA10' : '#EDE9FE', borderColor: isDark ? '#9F7AEA33' : '#DDD6FE' }]}>
          <Feather name="clock" size={13} color={isDark ? '#C4B5FD' : primary} />
          <Text style={[styles.preOrderNoteText, { color: isDark ? '#C4B5FD' : primary }]}>
            Funds collected upfront and held until each drop ships
          </Text>
        </View>
        {preOrderDrops.map((d, i) => (
          <DropCard key={d.id} drop={d} colors={colors} isDark={isDark} isLast={i === preOrderDrops.length - 1} />
        ))}

        {/* ── Pre Made Drops ── */}
        <View style={[styles.sectionHeader, { marginTop: 28 }]}>
          <View style={[styles.sectionDot, { backgroundColor: colors.success }]} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pre Made Drops</Text>
          <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{preMadeDrops.length}</Text>
        </View>
        <View style={[styles.preOrderNote, { backgroundColor: isDark ? '#22C55E10' : '#DCFCE7', borderColor: isDark ? '#22C55E33' : '#BBF7D0' }]}>
          <Feather name="package" size={13} color={colors.success} />
          <Text style={[styles.preOrderNoteText, { color: colors.success }]}>
            Standard payout 2–3 business days after order fulfillment
          </Text>
        </View>
        {preMadeDrops.map((d, i) => (
          <DropCard key={d.id} drop={d} colors={colors} isDark={isDark} isLast={i === preMadeDrops.length - 1} />
        ))}

        {/* ── Payment Methods ── */}
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginTop: 32, marginBottom: 12 }]}>
          Payment Methods
        </Text>
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {PAYMENT_METHODS.map((m, i) => (
            <View key={m.name} style={[styles.methodRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={[styles.methodIcon, { backgroundColor: colors.secondary }]}>
                <Feather name={m.icon} size={16} color={primary} />
              </View>
              <View style={styles.methodInfo}>
                <Text style={[styles.methodName, { color: colors.foreground }]}>{m.name}</Text>
                <Text style={[styles.methodDesc, { color: colors.mutedForeground }]}>{m.desc}</Text>
              </View>
              <Switch
                value={methods[i] ?? false}
                onValueChange={(v) => setMethods((p) => p.map((val, idx) => idx === i ? v : val))}
                trackColor={{ false: colors.secondary, true: primary }}
                thumbColor="#FFFFFF"
              />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Summary card
  summaryCard: { borderRadius: 18, borderWidth: 1, padding: 20, marginBottom: 28 },
  summaryRow: { flexDirection: 'row', gap: 16 },
  summaryItem: { flex: 1 },
  summaryLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 1, marginBottom: 6 },
  summaryAmount: { fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, marginBottom: 2 },
  summarySub: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  summaryDivider: { width: 1 },
  summaryInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 16, paddingTop: 14, borderTopWidth: 1 },
  summaryInfoText: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 17 },
  requestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, borderRadius: 12, paddingVertical: 13 },
  requestBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },

  // Section headers
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', flex: 1 },
  sectionCount: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  // Note banners
  preOrderNote: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 12 },
  preOrderNoteText: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },

  // Drop card
  dropCard: { borderRadius: 16, borderWidth: 1, padding: 16 },
  dropTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  typeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  typeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  dropName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 14 },
  dropStats: { flexDirection: 'row', alignItems: 'center' },
  dropStat: { flex: 1, alignItems: 'center' },
  dropStatVal: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  dropStatLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  dropDivider: { width: 1, height: 28 },

  // Pre Order progress
  preOrderExtra: { marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'transparent' },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  progressLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  progressPct: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: 6, borderRadius: 3 },
  shipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  shipText: { fontSize: 11, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 16 },

  // Pre Made note
  premadeNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'transparent' },
  premadeNoteText: { fontSize: 11, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 16 },

  // Payment methods
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  methodRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  methodIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  methodInfo: { flex: 1 },
  methodName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  methodDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
});
