import React from 'react';
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';

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
  const primary = isDark ? '#C94D1F' : '#B33F1E';
  const isPreOrder = drop.type === 'pre-order';
  const s = statusConfig[drop.status];

  const typeColor   = isPreOrder ? (isDark ? '#E2DDD0' : '#B33F1E') : (isDark ? '#4C9A5E' : '#3F7A4F');
  const typeBg      = isPreOrder ? (isDark ? '#C94D1F18' : '#E8E1CF') : (isDark ? '#4C9A5E18' : '#DCFCE7');
  const typeBorder  = isPreOrder ? (isDark ? '#C1440E33' : '#DBD3C0') : (isDark ? '#4C9A5E33' : '#BBF7D0');
  const progressBg  = isDark ? '#33302A' : '#E8E1CF';

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

const METHOD_CHIPS = [
  { label: 'Shop', bg: '#5A31F4', text: '#FFFFFF' },
  { label: 'VISA', bg: '#1A1F71', text: '#FFFFFF' },
  { label: 'MC',   bg: '#EB5C2E', text: '#FFFFFF' },
  { label: 'AMEX', bg: '#016FD0', text: '#FFFFFF' },
];

const CONFIG_ROWS = [
  { label: 'Payment capture method',        icon: 'zap'      as const },
  { label: 'Manual payment methods',        icon: 'inbox'    as const },
  { label: 'Payment method customizations', icon: 'sliders'  as const },
  { label: 'Payout schedule',               icon: 'calendar' as const },
  { label: 'Escrow & release rules',        icon: 'shield'   as const },
];

export default function PaymentsScreen() {
  const colors = useColors();

  const isDark = colors.background === '#121110' || colors.background.startsWith('#0');
  const primary = isDark ? '#C94D1F' : '#B33F1E';

  const preOrderDrops = DROPS.filter((d) => d.type === 'pre-order');
  const preMadeDrops  = DROPS.filter((d) => d.type === 'pre-made');

  const nextPayout = [...DROPS]
    .filter((d) => d.status !== 'paid')
    .sort((a, b) => new Date(a.payoutDate).getTime() - new Date(b.payoutDate).getTime())[0];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Payments" subtitle="Drop payouts & methods" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 120, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Next payout banner ── */}
        {nextPayout && (
          <View style={[styles.banner, { backgroundColor: isDark ? '#C1440E22' : '#E8F0FE', borderColor: isDark ? '#C1440E44' : '#C7DBFB' }]}>
            <Feather name="info" size={14} color={isDark ? '#E2DDD0' : '#1A56C4'} />
            <Text style={[styles.bannerText, { color: isDark ? '#E2DDD0' : '#1A3E7A' }]}>
              Next payout on {nextPayout.payoutDate} · ${nextPayout.totalRaw.toLocaleString()} from {nextPayout.name}
            </Text>
          </View>
        )}

        {/* ── Brandthread Payments card ── */}
        <View style={styles.cardHeaderRow}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Brandthread Payments</Text>
          <TouchableOpacity style={[styles.manageBtn, { borderColor: colors.border }]} activeOpacity={0.7}>
            <Text style={[styles.manageBtnText, { color: colors.foreground }]}>Manage</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Status row */}
          <View style={styles.statusRow}>
            <View style={styles.statusItem}>
              <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
              <Text style={[styles.statusText, { color: colors.foreground }]}>Accepting payments</Text>
            </View>
            <View style={[styles.statusDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statusItem}>
              <Feather name="credit-card" size={13} color={colors.foreground} />
              <Text style={[styles.statusText, { color: colors.foreground }]}>Ready for payouts</Text>
            </View>
          </View>

          {/* Payment methods row */}
          <TouchableOpacity style={[styles.listRow, { borderTopColor: colors.border }]} activeOpacity={0.7}>
            <Feather name="credit-card" size={16} color={colors.mutedForeground} />
            <Text style={[styles.listRowLabel, { color: colors.foreground }]}>Payment methods</Text>
            <View style={styles.chipRow}>
              {METHOD_CHIPS.map((c) => (
                <View key={c.label} style={[styles.chip, { backgroundColor: c.bg }]}>
                  <Text style={[styles.chipText, { color: c.text }]}>{c.label}</Text>
                </View>
              ))}
              <View style={[styles.chip, { backgroundColor: colors.secondary }]}>
                <Text style={[styles.chipText, { color: colors.mutedForeground }]}>+8</Text>
              </View>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>

          {/* Payout account row */}
          <View style={[styles.listRow, { borderTopColor: colors.border }]}>
            <Feather name="home" size={16} color={colors.mutedForeground} />
            <View style={styles.payoutInfo}>
              <Text style={[styles.payoutLabel, { color: colors.mutedForeground }]}>Payout account</Text>
              <Text style={[styles.payoutAccount, { color: colors.foreground }]}>
                BANK OF AMERICA, N.A. ······1649 · USD
              </Text>
            </View>
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={[styles.viewPayoutsLink, { color: primary }]}>View payouts</Text>
            </TouchableOpacity>
          </View>

          {/* Upgrade note */}
          <View style={[styles.upgradeNote, { borderTopColor: colors.border, backgroundColor: isDark ? '#1A1815' : colors.secondary }]}>
            <Text style={[styles.upgradeNoteText, { color: colors.mutedForeground }]}>
              You can get improved payout rates by{' '}
              <Text style={{ color: primary, fontFamily: 'Inter_600SemiBold' }}>upgrading your plan</Text>.
            </Text>
          </View>
        </View>

        {/* ── Additional payment providers ── */}
        <Text style={[styles.groupTitle, { color: colors.foreground }]}>Additional payment providers</Text>
        <Text style={[styles.groupSubtitle, { color: colors.mutedForeground }]}>
          Offer methods processed offsite or through custom checkout integrations
        </Text>
        <TouchableOpacity
          style={[styles.addProviderBtn, { borderColor: colors.border }]}
          activeOpacity={0.7}
        >
          <Feather name="plus-circle" size={16} color={colors.foreground} />
          <Text style={[styles.addProviderText, { color: colors.foreground }]}>Add provider</Text>
        </TouchableOpacity>

        {/* ── Payment configuration ── */}
        <Text style={[styles.groupTitle, { marginTop: 24 }, { color: colors.foreground }]}>Payment configuration</Text>
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 10 }]}>
          {CONFIG_ROWS.map((row, i) => (
            <TouchableOpacity
              key={row.label}
              style={[styles.configRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
              activeOpacity={0.7}
            >
              <Feather name={row.icon} size={16} color={colors.mutedForeground} />
              <Text style={[styles.listRowLabel, { color: colors.foreground, flex: 1 }]}>{row.label}</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Pre Order Drops ── */}
        <View style={styles.sectionHeader}>
          <View style={[styles.sectionDot, { backgroundColor: isDark ? '#E2DDD0' : '#B33F1E' }]} />
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Pre Order Drops</Text>
          <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>{preOrderDrops.length}</Text>
        </View>
        <View style={[styles.preOrderNote, { backgroundColor: isDark ? '#C94D1F10' : '#E8E1CF', borderColor: isDark ? '#C1440E33' : '#DBD3C0' }]}>
          <Feather name="clock" size={13} color={isDark ? '#E2DDD0' : primary} />
          <Text style={[styles.preOrderNoteText, { color: isDark ? '#E2DDD0' : primary }]}>
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
        <View style={[styles.preOrderNote, { backgroundColor: isDark ? '#4C9A5E10' : '#DCFCE7', borderColor: isDark ? '#4C9A5E33' : '#BBF7D0' }]}>
          <Feather name="package" size={13} color={colors.success} />
          <Text style={[styles.preOrderNoteText, { color: colors.success }]}>
            Standard payout 2–3 business days after order fulfillment
          </Text>
        </View>
        {preMadeDrops.map((d, i) => (
          <DropCard key={d.id} drop={d} colors={colors} isDark={isDark} isLast={i === preMadeDrops.length - 1} />
        ))}

      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Banner
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 20 },
  bannerText: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1, lineHeight: 17 },

  // Card header row (title + Manage button)
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  manageBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  manageBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  // Status row
  statusRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  statusItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  statusDivider: { width: 1, height: 16 },

  // Generic list row (used inside cards)
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderTopWidth: 1 },
  listRowLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  chipRow: { flexDirection: 'row', gap: 4 },
  chip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  chipText: { fontSize: 9, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 },

  payoutInfo: { flex: 1 },
  payoutLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', marginBottom: 3, letterSpacing: 0.3 },
  payoutAccount: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  viewPayoutsLink: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  upgradeNote: { padding: 14, borderTopWidth: 1 },
  upgradeNoteText: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 17 },

  // Additional providers
  groupTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginTop: 28, marginBottom: 4 },
  groupSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 12, lineHeight: 17 },
  addProviderBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1, paddingVertical: 14, borderStyle: 'dashed' },
  addProviderText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Payment configuration rows
  configRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },

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

  // Shared card container
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
});
