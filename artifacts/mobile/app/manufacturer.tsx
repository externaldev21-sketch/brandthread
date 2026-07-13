/**
 * Manufacturer Hub
 * - Invite banner with copyable onboarding link
 * - Escrow payment protection badge on each order
 * - Manufacturer listing with Message button
 */
import React, { useState } from 'react';
import {
  ScrollView, View, Text, TouchableOpacity,
  StyleSheet, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';

// ─── Theme ────────────────────────────────────────────────────────────────────
const BG      = '#0A0B0A';
const CARD    = '#111311';
const BORDER  = '#1E221E';
const FG      = '#EAF2ED';
const MUTED   = '#5A6B5C';
const GREEN   = '#39FF88';
const GREEN_D = '#0D2B1A';
const ORANGE  = '#F97316';
const BLUE    = '#0EA5E9';
const PURPLE  = '#8B5CF6';
const YELLOW  = '#FBBF24';

const INVITE_LINK = 'https://brandthread.app/manufacturer/join?ref=BT-MFR-2026';

// ─── Mock manufacturers (approved + pending) ──────────────────────────────────
const MANUFACTURERS = [
  {
    id: 'm1', name: 'Apex Garment Co.', location: 'Guangzhou, CN',
    moq: 50, rating: 4.9, verified: true,
    specialty: 'T-Shirts, Hoodies', productionModes: ['Screen Print', 'Embroidery'],
    leadTime: '18 days', priceFrom: '$4.20/unit', status: 'approved',
    initials: 'AG', color: ORANGE,
  },
  {
    id: 'm2', name: 'EcoThread Factory', location: 'Mumbai, IN',
    moq: 100, rating: 4.7, verified: true,
    specialty: 'Sustainable Fabrics', productionModes: ['DTG', 'DTF'],
    leadTime: '22 days', priceFrom: '$6.50/unit', status: 'approved',
    initials: 'ET', color: GREEN,
  },
  {
    id: 'm3', name: 'CraftWear Studio', location: 'Dhaka, BD',
    moq: 30, rating: 4.5, verified: false,
    specialty: 'Knitwear, Denim', productionModes: ['Screen Print', 'Puff Print'],
    leadTime: '14 days', priceFrom: '$3.80/unit', status: 'approved',
    initials: 'CW', color: PURPLE,
  },
  {
    id: 'm4', name: 'Milano Couture', location: 'Milan, IT',
    moq: 200, rating: 5.0, verified: true,
    specialty: 'Luxury, Tailoring', productionModes: ['Woven Labels', 'Embroidery'],
    leadTime: '35 days', priceFrom: '$18.00/unit', status: 'approved',
    initials: 'MC', color: YELLOW,
  },
  {
    id: 'm5', name: 'Vertex Apparel', location: 'Ho Chi Minh, VN',
    moq: 75, rating: 0, verified: false,
    specialty: 'Activewear, Shorts', productionModes: ['Sublimation', 'DTF'],
    leadTime: '16 days', priceFrom: '$5.10/unit', status: 'pending',
    initials: 'VA', color: BLUE,
  },
];

const ORDERS = [
  {
    id: 'PO-2041', mfr: 'Apex Garment Co.', items: 400,
    status: 'In Production', delivery: 'Aug 15', progress: 65,
    escrowHeld: '$8,400', escrowStatus: 'held',
  },
  {
    id: 'PO-2040', mfr: 'EcoThread Factory', items: 150,
    status: 'QC Review', delivery: 'Jul 28', progress: 88,
    escrowHeld: '$2,925', escrowStatus: 'releasing',
  },
  {
    id: 'PO-2039', mfr: 'CraftWear Studio', items: 60,
    status: 'Sampling', delivery: 'Sep 1', progress: 20,
    escrowHeld: '$570', escrowStatus: 'held',
  },
];

type Tab = 'hub' | 'orders';

export default function ManufacturerScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('hub');
  const [linkCopied, setLinkCopied] = useState(false);

  const topPad = Platform.OS === 'web' ? 20 : insets.top;

  function haptic(t: 'light' | 'medium' = 'medium') {
    Haptics.impactAsync(t === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
  }

  async function copyInviteLink() {
    haptic();
    await Clipboard.setStringAsync(INVITE_LINK);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2500);
  }

  function go(route: string) {
    haptic('light');
    router.push(route as never);
  }

  const approved = MANUFACTURERS.filter((m) => m.status === 'approved');
  const pending  = MANUFACTURERS.filter((m) => m.status === 'pending');

  return (
    <View style={[s.root, { paddingTop: topPad }]}>
      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Manufacturer Hub</Text>
          <Text style={s.headerSub}>Find, connect & manage production partners</Text>
        </View>
      </View>

      {/* ── Tab row ── */}
      <View style={s.tabRow}>
        {(['hub', 'orders'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[s.tabBtn, tab === t && s.tabBtnActive]}
            onPress={() => { haptic('light'); setTab(t); }}
            activeOpacity={0.8}
          >
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'hub' ? 'Manufacturer Hub' : 'My Orders'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'hub' ? (
          <>
            {/* ── Invite Banner ── */}
            <View style={s.inviteBanner}>
              <View style={s.inviteTop}>
                <View style={s.inviteIconWrap}>
                  <Feather name="link" size={18} color={GREEN} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.inviteTitle}>Add a Manufacturer</Text>
                  <Text style={s.inviteSub}>
                    Send this link to any manufacturer. They fill out their profile, upload photos & pricing — then they appear here for your brand owners to browse.
                  </Text>
                </View>
              </View>
              <View style={s.linkRow}>
                <Text style={s.linkText} numberOfLines={1}>{INVITE_LINK}</Text>
              </View>
              <View style={s.inviteActions}>
                <TouchableOpacity
                  style={[s.inviteBtn, { backgroundColor: linkCopied ? '#22C55E' : GREEN }]}
                  onPress={copyInviteLink}
                  activeOpacity={0.85}
                >
                  <Feather name={linkCopied ? 'check' : 'copy'} size={14} color={BG} />
                  <Text style={s.inviteBtnText}>{linkCopied ? 'Copied!' : 'Copy Link'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.inviteBtnOutline}
                  onPress={() => go('/manufacturer-onboard')}
                  activeOpacity={0.85}
                >
                  <Feather name="user-plus" size={14} color={GREEN} />
                  <Text style={s.inviteBtnOutlineText}>Apply as Manufacturer</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* ── Escrow notice ── */}
            <View style={s.escrowBanner}>
              <Feather name="shield" size={15} color={GREEN} />
              <Text style={s.escrowText}>
                <Text style={{ color: GREEN, fontFamily: 'Inter_600SemiBold' }}>Escrow Protection: </Text>
                Payments from brand owners are held securely and only released to manufacturers after production is confirmed complete.
              </Text>
            </View>

            {/* ── Stats ── */}
            <View style={s.statsRow}>
              {[
                { label: 'Verified', value: '2,400+', icon: 'check-circle' as const },
                { label: 'Countries', value: '38', icon: 'globe' as const },
                { label: 'Avg. MOQ', value: '50 pcs', icon: 'package' as const },
              ].map((st) => (
                <View key={st.label} style={s.statCard}>
                  <Text style={s.statVal}>{st.value}</Text>
                  <Text style={s.statLabel}>{st.label}</Text>
                </View>
              ))}
            </View>

            {/* ── Pending manufacturers ── */}
            {pending.length > 0 && (
              <View style={s.pendingSection}>
                <Text style={s.sectionLabel}>⏳ Pending Review ({pending.length})</Text>
                {pending.map((m) => (
                  <View key={m.id} style={[s.mfCard, s.pendingCard]}>
                    <View style={s.mfCardTop}>
                      <View style={[s.avatar, { backgroundColor: m.color + '22' }]}>
                        <Text style={[s.avatarText, { color: m.color }]}>{m.initials}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.mfName}>{m.name}</Text>
                        <Text style={s.mfLocation}>{m.location}</Text>
                      </View>
                      <View style={s.pendingPill}>
                        <Text style={s.pendingPillText}>Pending</Text>
                      </View>
                    </View>
                    <Text style={s.mfSpecialty}>{m.specialty} · MOQ {m.moq}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* ── Approved manufacturers ── */}
            <Text style={s.sectionLabel}>✅ Approved Partners</Text>
            {approved.map((m) => (
              <View key={m.id} style={s.mfCard}>
                {/* Card header */}
                <View style={s.mfCardTop}>
                  <View style={[s.avatar, { backgroundColor: m.color + '22' }]}>
                    <Text style={[s.avatarText, { color: m.color }]}>{m.initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={s.nameRow}>
                      <Text style={s.mfName}>{m.name}</Text>
                      {m.verified && <Feather name="check-circle" size={13} color={GREEN} />}
                    </View>
                    <Text style={s.mfLocation}>{m.location}</Text>
                  </View>
                  {m.rating > 0 && (
                    <View style={s.ratingRow}>
                      <Feather name="star" size={11} color={YELLOW} />
                      <Text style={s.ratingText}>{m.rating}</Text>
                    </View>
                  )}
                </View>

                {/* Specs row */}
                <View style={s.specsRow}>
                  <SpecPill icon="package" label={`MOQ ${m.moq}`} />
                  <SpecPill icon="clock"   label={m.leadTime} />
                  <SpecPill icon="tag"     label={m.priceFrom} />
                </View>

                {/* Specialty + production modes */}
                <Text style={s.mfSpecialty}>{m.specialty}</Text>
                <View style={s.modeRow}>
                  {m.productionModes.map((mode) => (
                    <View key={mode} style={s.modePill}>
                      <Text style={s.modePillText}>{mode}</Text>
                    </View>
                  ))}
                </View>

                <View style={s.divider} />

                {/* Actions */}
                <View style={s.actionRow}>
                  <TouchableOpacity
                    style={s.btnOutline}
                    onPress={() => Alert.alert('Request Sample', `A sample request has been sent to ${m.name}. They will respond within 48 hours.`)}
                    activeOpacity={0.75}
                  >
                    <Text style={s.btnOutlineText}>Request Sample</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.btnPrimary}
                    onPress={() => go('/chat/manufacturer-' + m.id)}
                    activeOpacity={0.8}
                  >
                    <Feather name="message-circle" size={14} color={BG} />
                    <Text style={s.btnPrimaryText}>Message</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.btnGhost}
                    onPress={() => Alert.alert('Send RFQ', `RFQ sent to ${m.name}. Expected response: 24–48 hrs.`)}
                    activeOpacity={0.75}
                  >
                    <Text style={s.btnGhostText}>Send RFQ</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        ) : (
          <>
            {/* ── Escrow summary ── */}
            <View style={s.escrowSummary}>
              <View style={s.escrowSummaryTop}>
                <Feather name="shield" size={18} color={GREEN} />
                <Text style={s.escrowSummaryTitle}>Escrow Funds</Text>
              </View>
              <Text style={s.escrowSummaryAmt}>$11,895</Text>
              <Text style={s.escrowSummaryLabel}>held across {ORDERS.length} active orders</Text>
              <Text style={s.escrowSummaryNote}>
                Funds are released automatically when you confirm receipt of completed production. You can also dispute within 7 days of delivery.
              </Text>
            </View>

            {/* ── Orders ── */}
            {ORDERS.map((order) => (
              <View key={order.id} style={s.orderCard}>
                {/* Order header */}
                <View style={s.orderTop}>
                  <View>
                    <Text style={s.orderId}>{order.id}</Text>
                    <Text style={s.orderMfr}>{order.mfr}</Text>
                    <Text style={s.orderItems}>{order.items} units · Due {order.delivery}</Text>
                  </View>
                  <View style={[s.statusPill, {
                    backgroundColor:
                      order.status === 'QC Review'   ? YELLOW + '22' :
                      order.status === 'Sampling'    ? BLUE   + '22' :
                                                       GREEN  + '22',
                  }]}>
                    <Text style={[s.statusText, {
                      color:
                        order.status === 'QC Review'  ? YELLOW :
                        order.status === 'Sampling'   ? BLUE :
                                                        GREEN,
                    }]}>{order.status}</Text>
                  </View>
                </View>

                {/* Progress */}
                <View style={s.progressTrack}>
                  <View style={[s.progressFill, { width: `${order.progress}%` as any }]} />
                </View>
                <Text style={s.progressLabel}>{order.progress}% complete</Text>

                {/* Escrow */}
                <View style={[s.escrowRow, {
                  backgroundColor: order.escrowStatus === 'releasing' ? YELLOW + '15' : GREEN + '10',
                  borderColor:     order.escrowStatus === 'releasing' ? YELLOW + '44' : GREEN + '33',
                }]}>
                  <Feather name="shield" size={13} color={order.escrowStatus === 'releasing' ? YELLOW : GREEN} />
                  <Text style={[s.escrowRowText, { color: order.escrowStatus === 'releasing' ? YELLOW : GREEN }]}>
                    {order.escrowHeld} in escrow
                  </Text>
                  <Text style={s.escrowRowStatus}>
                    {order.escrowStatus === 'releasing' ? '· Releasing on confirmation' : '· Protected until delivery'}
                  </Text>
                </View>

                {/* Actions */}
                <View style={s.orderActions}>
                  <TouchableOpacity
                    style={s.btnOutline}
                    onPress={() => go('/chat/manufacturer-' + order.id)}
                    activeOpacity={0.75}
                  >
                    <Feather name="message-circle" size={13} color={FG} />
                    <Text style={s.btnOutlineText}>Message</Text>
                  </TouchableOpacity>
                  {order.escrowStatus === 'releasing' && (
                    <TouchableOpacity
                      style={[s.btnPrimary, { flex: 1 }]}
                      onPress={() => Alert.alert(
                        'Release Payment?',
                        `Are you satisfied with the order from ${order.mfr}? Releasing funds is irreversible.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Release Funds', style: 'default', onPress: () => Alert.alert('✅ Funds Released', `${order.escrowHeld} has been released to ${order.mfr}.`) },
                        ]
                      )}
                      activeOpacity={0.85}
                    >
                      <Feather name="unlock" size={13} color={BG} />
                      <Text style={s.btnPrimaryText}>Release Payment</Text>
                    </TouchableOpacity>
                  )}
                  {order.escrowStatus === 'held' && (
                    <TouchableOpacity
                      style={[s.btnGhost, { flex: 1 }]}
                      onPress={() => Alert.alert('Dispute', 'File a dispute if production does not meet your specifications. Our team reviews within 48 hours.')}
                      activeOpacity={0.75}
                    >
                      <Text style={s.btnGhostText}>File Dispute</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Spec pill ────────────────────────────────────────────────────────────────
function SpecPill({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) {
  return (
    <View style={s.specPill}>
      <Feather name={icon} size={11} color={MUTED} />
      <Text style={s.specPillText}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },

  // Header
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:     { width: 36, height: 36, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG },
  headerSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },

  // Tabs
  tabRow:       { flexDirection: 'row', backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER },
  tabBtn:       { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: GREEN },
  tabText:      { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED },
  tabTextActive:{ color: GREEN, fontFamily: 'Inter_600SemiBold' },

  // Invite banner
  inviteBanner:   { backgroundColor: GREEN_D, borderRadius: 18, borderWidth: 1, borderColor: GREEN + '44', padding: 16, gap: 12 },
  inviteTop:      { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  inviteIconWrap: { width: 38, height: 38, borderRadius: 10, backgroundColor: GREEN + '22', borderWidth: 1, borderColor: GREEN + '55', alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  inviteTitle:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG, marginBottom: 4 },
  inviteSub:      { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 18 },
  linkRow:        { backgroundColor: '#0A0B0A', borderRadius: 10, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 12, paddingVertical: 10 },
  linkText:       { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },
  inviteActions:  { flexDirection: 'row', gap: 8 },
  inviteBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 11 },
  inviteBtnText:  { fontSize: 13, fontFamily: 'Inter_700Bold', color: BG },
  inviteBtnOutline:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 11, borderWidth: 1, borderColor: GREEN + '66' },
  inviteBtnOutlineText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: GREEN },

  // Escrow banner
  escrowBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: GREEN + '0D', borderRadius: 12, borderWidth: 1, borderColor: GREEN + '33', padding: 12 },
  escrowText:   { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, flex: 1, lineHeight: 18 },

  // Stats
  statsRow: { flexDirection: 'row', gap: 8 },
  statCard: { flex: 1, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, padding: 14, alignItems: 'center', gap: 4 },
  statVal:  { fontSize: 18, fontFamily: 'Inter_700Bold', color: FG },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },

  // Section labels
  sectionLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  pendingSection: { gap: 8 },

  // Manufacturer cards
  mfCard:   { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 10 },
  pendingCard: { opacity: 0.7, borderStyle: 'dashed' },
  mfCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar:    { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  nameRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mfName:    { fontSize: 14, fontFamily: 'Inter_700Bold', color: FG },
  mfLocation: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: FG },

  // Specs
  specsRow:  { flexDirection: 'row', gap: 6 },
  specPill:  { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1A1E1A', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 },
  specPillText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: MUTED },

  mfSpecialty: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  modeRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  modePill:  { backgroundColor: '#1A1E1A', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  modePillText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: MUTED },

  pendingPill: { backgroundColor: '#F9731622', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  pendingPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#F97316' },

  divider: { height: 1, backgroundColor: BORDER },

  actionRow: { flexDirection: 'row', gap: 8 },
  btnOutline:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: BORDER },
  btnOutlineText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: FG },
  btnPrimary:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: GREEN },
  btnPrimaryText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: BG },
  btnGhost:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#1A1E1A' },
  btnGhostText:   { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: MUTED },

  // Orders
  orderCard:  { backgroundColor: CARD, borderRadius: 18, borderWidth: 1, borderColor: BORDER, padding: 16, gap: 12 },
  orderTop:   { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  orderId:    { fontSize: 12, fontFamily: 'Inter_700Bold', color: GREEN, marginBottom: 2 },
  orderMfr:   { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: FG },
  orderItems: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, marginTop: 2 },
  statusPill: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  progressTrack: { height: 5, borderRadius: 3, backgroundColor: '#1A1E1A', overflow: 'hidden' },
  progressFill:  { height: 5, borderRadius: 3, backgroundColor: GREEN },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: MUTED },

  escrowRow:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 8 },
  escrowRowText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  escrowRowStatus: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },

  orderActions: { flexDirection: 'row', gap: 8 },

  // Escrow summary
  escrowSummary:     { backgroundColor: GREEN_D, borderRadius: 18, borderWidth: 1, borderColor: GREEN + '44', padding: 20, gap: 4 },
  escrowSummaryTop:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  escrowSummaryTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: FG },
  escrowSummaryAmt:  { fontSize: 32, fontFamily: 'Inter_700Bold', color: GREEN },
  escrowSummaryLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED },
  escrowSummaryNote: { fontSize: 12, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 18, marginTop: 8 },
});
