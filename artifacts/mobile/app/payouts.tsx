import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM,
  CYAN, CYAN_DIM, SUCCESS, RED, ORANGE, FONT, FS, SP, RADIUS,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { isManagerRole } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import { useTeamRole } from '@/hooks/useTeamRole';

type PayoutStatus = 'paid' | 'pending' | 'in_transit' | 'failed';

interface PayoutRecord {
  id: string;
  date: string;
  amount: string;
  status: PayoutStatus;
  bankLast4: string;
  ordersCount: number;
}

// Status label fallback for Stripe statuses not in our union
function stripeStatusToLocal(s: string): PayoutStatus {
  if (s === 'paid') return 'paid';
  if (s === 'in_transit') return 'in_transit';
  if (s === 'pending') return 'pending';
  if (s === 'failed' || s === 'canceled') return 'failed';
  return 'pending';
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STATUS_CONFIG: Record<PayoutStatus, { label: string; color: string; bg: string }> = {
  paid:       { label: 'Paid',       color: SUCCESS,  bg: `${SUCCESS}20`  },
  pending:    { label: 'Pending',    color: ORANGE,   bg: `${ORANGE}20`   },
  in_transit: { label: 'In transit', color: CYAN,     bg: CYAN_DIM        },
  failed:     { label: 'Failed',     color: RED,      bg: `${RED}20`      },
};

export default function PayoutsScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api    = useApi();
  const { currentRole, isLoadingRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);
  const [activeTab, setActiveTab] = useState<'payouts' | 'settings'>('payouts');
  const [loading,   setLoading]   = useState(true);
  const [balance,   setBalance]   = useState<any>(null);
  const [payouts,   setPayouts]   = useState<PayoutRecord[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bal, po] = await Promise.all([
        api.finance.balance(),
        api.finance.payouts(20),
      ]);
      setBalance(bal);
      setPayouts((po.payouts ?? []).map((p: any): PayoutRecord => ({
        id:         p.id,
        date:       fmtDate(p.arrivalDate),
        amount:     p.formatted,
        status:     stripeStatusToLocal(p.status),
        bankLast4:  p.destination?.last4 ?? '····',
        ordersCount: 0,
      })));
    } catch {
      // Keep the empty state when payout data is unavailable.
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const availFmt   = balance?.available?.formatted ?? '$0.00';
  const pendFmt    = balance?.pending?.formatted   ?? '$0.00';
  const nextDate   = balance?.nextPayout
    ? fmtDate(balance.nextPayout.arrivalDate)
    : '—';

  if (isLoadingRole) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { haptic(); router.back(); }} style={styles.backBtn}>
            <Feather name="chevron-left" size={24} color={FG} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payouts</Text>
          <View style={styles.backBtn} />
        </View>
        <View style={styles.accessLoading}>
          <ActivityIndicator color={PURPLE} />
        </View>
      </View>
    );
  }

  if (currentRole !== 'owner' && !isReadOnly) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { haptic(); router.back(); }} style={styles.backBtn}>
            <Feather name="chevron-left" size={24} color={FG} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payouts</Text>
          <View style={styles.backBtn} />
        </View>
        <RoleLockedView screenTitle="payouts" currentRole={currentRole ?? undefined} />
      </View>
    );
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

      {/* Balance cards */}
      <View style={styles.balanceRow}>
        <View style={[styles.balanceCard, { flex: 1, marginRight: SP.sm }]}>
          <Text style={styles.balanceLabel}>Available</Text>
          <Text style={styles.balanceAmount}>{availFmt}</Text>
          <Text style={styles.balanceSub}>Next: {nextDate}</Text>
        </View>
        <View style={[styles.balanceCard, { flex: 1 }]}>
          <Text style={styles.balanceLabel}>Pending</Text>
          <Text style={[styles.balanceAmount, { color: MUTED }]}>{pendFmt}</Text>
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
          {loading ? (
            <ActivityIndicator color={PURPLE} style={{ marginTop: 40 }} />
          ) : payouts.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Feather name="inbox" size={28} color={MUTED} />
              <Text style={{ color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 10 }}>
                {balance?.connected === false ? 'Connect Stripe to receive payouts' : 'No payouts yet'}
              </Text>
            </View>
          ) : (
            payouts.map((p) => {
              const cfg = STATUS_CONFIG[p.status];
              return (
                <View key={p.id} style={styles.payoutRow}>
                  <View style={styles.payoutLeft}>
                    <Text style={styles.payoutDate}>{p.date}</Text>
                    <Text style={styles.payoutSub}>···{p.bankLast4}</Text>
                  </View>
                  <View style={styles.payoutRight}>
                    <Text style={styles.payoutAmount}>{p.amount}</Text>
                    <View style={[styles.statusPill, { backgroundColor: cfg.bg }]}>
                      <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + SP.xl }]}>
          <View style={styles.bankCard}>
            <Feather name="credit-card" size={20} color={PURPLE} />
            <View style={{ flex: 1, marginLeft: SP.md }}>
              <Text style={styles.bankLabel}>Bank account ···{balance?.bankLast4 ?? '——'}</Text>
              <Text style={styles.bankSub}>Default payout account</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: `${SUCCESS}20` }]}>
              <Text style={[styles.statusText, { color: SUCCESS }]}>Verified</Text>
            </View>
          </View>

          <View style={styles.settingsSection}>
            <Text style={styles.sectionTitle}>Payout schedule</Text>
            {[
              { label: 'Frequency',     value: 'Weekly' },
              { label: 'Minimum',       value: '$1.00' },
              { label: 'Currency',      value: 'USD' },
            ].map((r) => (
              <View key={r.label} style={styles.settingsRow}>
                <Text style={styles.settingsLabel}>{r.label}</Text>
                <Text style={styles.settingsValue}>{r.value}</Text>
              </View>
            ))}
          </View>

           {!isReadOnly && (
             <TouchableOpacity style={styles.addBankBtn}>
               <Feather name="plus" size={16} color={PURPLE} />
               <Text style={styles.addBankText}>Add bank account</Text>
             </TouchableOpacity>
           )}
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (theme: { accent: string; accentLight: string; accentDim: string; secondary: string; secondaryDim: string }) => {
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  return StyleSheet.create({
  root:         { flex: 1, backgroundColor: BG },
  accessLoading:{ flex: 1, alignItems: 'center', justifyContent: 'center' },
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
};
