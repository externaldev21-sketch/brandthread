import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, RED, ORANGE, FONT, FS, SP, RADIUS,
} from '@/lib/theme';

// ─── Demo data (mock — real payout API not yet connected) ────────────────────
const PAYOUT_SUMMARY = {
  nextPayoutAmount: '$1,284.50',
  nextPayoutDate:   'Jul 21, 2026',
  availableBalance: '$1,284.50',
  pendingBalance:   '$312.00',
  totalEarned:      '$18,640.20',
};

type PayoutStatus = 'paid' | 'pending' | 'in_transit' | 'failed';

interface PayoutRecord {
  id: string;
  date: string;
  amount: string;
  status: PayoutStatus;
  bankLast4: string;
  ordersCount: number;
}

const PAYOUTS: PayoutRecord[] = [
  { id: 'po_1', date: 'Jul 14, 2026', amount: '$840.00',   status: 'in_transit', bankLast4: '4242', ordersCount: 12 },
  { id: 'po_2', date: 'Jul 7, 2026',  amount: '$1,120.40', status: 'paid',       bankLast4: '4242', ordersCount: 17 },
  { id: 'po_3', date: 'Jun 30, 2026', amount: '$630.80',   status: 'paid',       bankLast4: '4242', ordersCount: 9  },
  { id: 'po_4', date: 'Jun 23, 2026', amount: '$990.00',   status: 'paid',       bankLast4: '4242', ordersCount: 14 },
  { id: 'po_5', date: 'Jun 16, 2026', amount: '$215.00',   status: 'paid',       bankLast4: '4242', ordersCount: 3  },
  { id: 'po_6', date: 'Jun 9, 2026',  amount: '$0.00',     status: 'failed',     bankLast4: '4242', ordersCount: 0  },
];

const STATUS_CONFIG: Record<PayoutStatus, { label: string; color: string; bg: string }> = {
  paid:       { label: 'Paid',       color: SUCCESS,  bg: `${SUCCESS}20`  },
  pending:    { label: 'Pending',    color: ORANGE,   bg: `${ORANGE}20`   },
  in_transit: { label: 'In transit', color: CYAN,     bg: CYAN_DIM        },
  failed:     { label: 'Failed',     color: RED,      bg: `${RED}20`      },
};

export default function PayoutsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'payouts' | 'settings'>('payouts');

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => { haptic(); router.back(); }} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Payouts</Text>
        <TouchableOpacity style={styles.backBtn}>
          <Feather name="help-circle" size={20} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Dev notice */}
      <View style={styles.devBanner}>
        <Feather name="info" size={13} color={ORANGE} />
        <Text style={styles.devBannerText}>Development mode — payouts are simulated</Text>
      </View>

      {/* Balance cards */}
      <View style={styles.balanceRow}>
        <View style={[styles.balanceCard, { flex: 1, marginRight: SP.sm }]}>
          <Text style={styles.balanceLabel}>Available</Text>
          <Text style={styles.balanceAmount}>{PAYOUT_SUMMARY.availableBalance}</Text>
          <Text style={styles.balanceSub}>Next: {PAYOUT_SUMMARY.nextPayoutDate}</Text>
        </View>
        <View style={[styles.balanceCard, { flex: 1 }]}>
          <Text style={styles.balanceLabel}>Pending</Text>
          <Text style={[styles.balanceAmount, { color: MUTED }]}>{PAYOUT_SUMMARY.pendingBalance}</Text>
          <Text style={styles.balanceSub}>Processing 2–3 days</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['payouts', 'settings'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, activeTab === t && styles.tabActive]}
            onPress={() => { haptic(); setActiveTab(t); }}
          >
            <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>
              {t === 'payouts' ? 'Payout history' : 'Bank account'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'payouts' ? (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + SP.xl }]}>
          {PAYOUTS.map((p) => {
            const cfg = STATUS_CONFIG[p.status];
            return (
              <View key={p.id} style={styles.payoutRow}>
                <View style={styles.payoutLeft}>
                  <Text style={styles.payoutDate}>{p.date}</Text>
                  <Text style={styles.payoutSub}>{p.ordersCount} orders · ···{p.bankLast4}</Text>
                </View>
                <View style={styles.payoutRight}>
                  <Text style={styles.payoutAmount}>{p.amount}</Text>
                  <View style={[styles.statusPill, { backgroundColor: cfg.bg }]}>
                    <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                </View>
              </View>
            );
          })}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total earned</Text>
            <Text style={styles.totalAmount}>{PAYOUT_SUMMARY.totalEarned}</Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + SP.xl }]}>
          <View style={styles.bankCard}>
            <Feather name="credit-card" size={20} color={PURPLE} />
            <View style={{ flex: 1, marginLeft: SP.md }}>
              <Text style={styles.bankLabel}>Chase Business ···4242</Text>
              <Text style={styles.bankSub}>Default payout account</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: `${SUCCESS}20` }]}>
              <Text style={[styles.statusText, { color: SUCCESS }]}>Verified</Text>
            </View>
          </View>

          <View style={styles.settingsSection}>
            <Text style={styles.sectionTitle}>Payout schedule</Text>
            {[
              { label: 'Frequency',     value: 'Weekly (every Monday)' },
              { label: 'Minimum',       value: '$1.00' },
              { label: 'Currency',      value: 'USD' },
            ].map((r) => (
              <View key={r.label} style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>{r.label}</Text>
                <Text style={styles.settingsValue}>{r.value}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.addBankBtn}>
            <Feather name="plus" size={16} color={PURPLE} />
            <Text style={styles.addBankText}>Add bank account</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: BG },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:      { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { flex: 1, textAlign: 'center', color: FG, fontSize: FS.lg, fontFamily: FONT.semibold },
  devBanner:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: `${ORANGE}15`, paddingHorizontal: SP.md, paddingVertical: 8 },
  devBannerText:{ color: ORANGE, fontSize: FS.xs, fontFamily: FONT.medium },
  balanceRow:   { flexDirection: 'row', padding: SP.md },
  balanceCard:  { backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER },
  balanceLabel: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: 4 },
  balanceAmount:{ color: FG, fontSize: FS.xl, fontFamily: FONT.semibold, marginBottom: 2 },
  balanceSub:   { color: SUBTLE, fontSize: FS.xs, fontFamily: FONT.regular },
  tabRow:       { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER, marginHorizontal: SP.md },
  tab:          { flex: 1, paddingVertical: SP.sm, alignItems: 'center' },
  tabActive:    { borderBottomWidth: 2, borderBottomColor: PURPLE },
  tabText:      { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  tabTextActive:{ color: PURPLE },
  list:         { padding: SP.md },
  payoutRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  payoutLeft:   {},
  payoutRight:  { alignItems: 'flex-end', gap: 4 },
  payoutDate:   { color: FG, fontSize: FS.base, fontFamily: FONT.medium },
  payoutSub:    { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  payoutAmount: { color: FG, fontSize: FS.base, fontFamily: FONT.semibold },
  statusPill:   { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  statusText:   { fontSize: FS.xs, fontFamily: FONT.medium },
  totalRow:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: SP.lg, paddingTop: SP.md, borderTopWidth: 1, borderTopColor: BORDER },
  totalLabel:   { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  totalAmount:  { color: FG, fontSize: FS.base, fontFamily: FONT.semibold },
  bankCard:     { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
  bankLabel:    { color: FG, fontSize: FS.base, fontFamily: FONT.medium },
  bankSub:      { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  settingsSection:{ backgroundColor: CARD, borderRadius: RADIUS.lg, padding: SP.md, borderWidth: 1, borderColor: BORDER, marginBottom: SP.md },
  sectionTitle: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: SP.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  settingsRow:  { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: SP.sm, borderTopWidth: 1, borderTopColor: BORDER },
  settingsLabel:{ color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular },
  settingsValue:{ color: FG, fontSize: FS.sm, fontFamily: FONT.medium },
  addBankBtn:   { flexDirection: 'row', alignItems: 'center', gap: SP.sm, justifyContent: 'center', padding: SP.md, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: PURPLE, borderStyle: 'dashed' },
  addBankText:  { color: PURPLE, fontSize: FS.sm, fontFamily: FONT.medium },
});
