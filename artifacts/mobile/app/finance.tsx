import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Linking, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';
import { useApi } from '@/lib/api';
import { isManagerRole } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import { SUCCESS, ORANGE } from '@/lib/theme';
import { useTeamRole } from '@/hooks/useTeamRole';
import { formatCents } from '@/lib/money';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function txCategory(type: string): string {
  if (type === 'charge' || type === 'payment') return 'Revenue';
  if (type === 'refund' || type === 'payment_refund') return 'Refund';
  if (type === 'payout') return 'Payout';
  if (type === 'stripe_fee' || type === 'application_fee') return 'Payments';
  if (type === 'adjustment') return 'Adjustment';
  return 'Other';
}

export default function FinanceScreen() {
  const colors = useColors();
  const router = useRouter();
  const api = useApi();
  const { currentRole, isLoadingRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [balance,      setBalance]      = useState<any>(null);
  const [loading,      setLoading]      = useState(true);

  // Subscription status for the dashboard card
  const [subStatus, setSubStatus] = useState<{
    plan: string; status: string; renewsOn: string | null; trialEnd: string | null; amountCents: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bal, txs, sub] = await Promise.all([
        api.finance.balance(),
        api.finance.transactions(20),
        api.seller.subscription.status().catch(() => null),
      ]);
      setBalance(bal);
      setTransactions(txs.transactions ?? []);
      if (sub) setSubStatus(sub as any);
    } catch {
      // Keep the empty state when finance data is unavailable.
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDownloadStatement = async () => {
    const BASE = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
    const url  = `${BASE}/api/finance/statement.csv`;
    try { await Linking.openURL(url); } catch { /* ignore */ }
  };

  // Build overview cards from real data
  const availAmt = balance?.available?.amount ?? 0;
  const pendAmt  = balance?.pending?.amount   ?? 0;
  const totalNet = transactions.reduce((acc, t) => acc + (t.net ?? 0), 0);

  const overviewCards = [
    { label: 'Available', value: formatCents(availAmt), color: colors.success, icon: 'trending-up' as const },
    { label: 'Pending',   value: formatCents(pendAmt),  color: colors.primary, icon: 'activity' as const },
    { label: 'Net (30d)', value: formatCents(Math.abs(totalNet)), color: colors.info, icon: 'percent' as const },
  ];

  // Build expenses list from real transactions
  const expenseRows = transactions.slice(0, 10).map(t => ({
    name:     t.description ?? t.type,
     amount:   (t.net >= 0 ? '+' : '') + formatCents(t.net),
    date:     fmtDate(t.created),
    category: txCategory(t.type),
    positive: t.net >= 0,
  }));

  // Fallback P&L data when not connected
  const PL_DATA_FALLBACK = [
     { label: 'Gross Revenue', value: formatCents(transactions.filter(t => t.net > 0).reduce((a, t) => a + t.amount, 0)), positive: true },
     { label: 'Fees',          value: '-' + formatCents(transactions.reduce((a, t) => a + Math.abs(t.fee ?? 0), 0)),        positive: false },
     { label: 'Net Total',     value: formatCents(Math.abs(totalNet)), positive: totalNet >= 0, highlight: true },
  ];

  const documents = [
    ...(!isReadOnly ? [{ label: 'Download Statement (CSV)', icon: 'file-text' as const, onPress: handleDownloadStatement }] : []),
    { label: 'Tax Report / 1099-K', icon: 'percent' as const, onPress: () => router.push('/taxes-duties' as any) },
    { label: 'Manufacturer PO', icon: 'shopping-cart' as const, onPress: undefined },
    { label: 'Inventory Valuation', icon: 'package' as const, onPress: undefined },
  ];

  if (isLoadingRole) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title="Finance" subtitle="P&L, cash flow & expenses" />
        <View style={styles.accessLoading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (currentRole !== 'owner' && !isReadOnly) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScreenHeader title="Finance" subtitle="P&L, cash flow & expenses" />
        <RoleLockedView screenTitle="finance" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="Finance" subtitle="P&L, cash flow & expenses" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Platform Subscription Card */}
      {subStatus && (
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => router.push('/subscription' as any)}
          style={[styles.subCard, { borderColor: colors.border, backgroundColor: colors.card }]}
        >
          <View style={styles.subCardLeft}>
            <Text style={[styles.subCardLabel, { color: colors.mutedForeground }]}>Platform subscription</Text>
            <Text style={[styles.subCardPlan, { color: colors.foreground }]}>
              {subStatus.plan === 'growth' ? 'Growth' : subStatus.plan === 'scale' ? 'Scale' : 'Starter'}
              {' '}
              <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
                 {subStatus.amountCents > 0 ? `${formatCents(subStatus.amountCents)}/mo` : formatCents(2900) + '/mo'}
              </Text>
            </Text>
            {subStatus.trialEnd ? (
              <Text style={[styles.subCardMeta, { color: colors.info }]}>Trial ends {subStatus.trialEnd}</Text>
            ) : subStatus.renewsOn ? (
              <Text style={[styles.subCardMeta, { color: colors.mutedForeground }]}>Renews {subStatus.renewsOn}</Text>
            ) : null}
          </View>
          <View style={styles.subCardRight}>
            <View style={[
              styles.subStatusPill,
              { backgroundColor: subStatus.status === 'trialing' ? colors.infoDim
                  : subStatus.status === 'active' ? `${SUCCESS}22`
                  : `${ORANGE}22` },
            ]}>
              <Text style={[
                styles.subStatusText,
                { color: subStatus.status === 'trialing' ? colors.info
                    : subStatus.status === 'active' ? SUCCESS
                    : ORANGE },
              ]}>
                {subStatus.status === 'trialing' ? 'Trial'
                  : subStatus.status === 'active' ? 'Active'
                  : subStatus.status === 'past_due' ? 'Past due'
                  : 'Manage'}
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={{ marginTop: 8 }} />
          </View>
        </TouchableOpacity>
      )}

      {/* Overview */}
      <View style={styles.overviewRow}>
        {overviewCards.map((card) => (
          <View key={card.label} style={[styles.overviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name={card.icon} size={16} color={card.color} />
            <Text style={[styles.overviewVal, { color: card.color }]}>{card.value}</Text>
            <Text style={[styles.overviewLabel, { color: colors.mutedForeground }]}>{card.label}</Text>
          </View>
        ))}
      </View>

      {/* P&L */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Summary</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {PL_DATA_FALLBACK.map((item, i) => (
          <View
            key={item.label}
            style={[
              styles.plRow,
              i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
              item.highlight && { backgroundColor: colors.accent },
            ]}
          >
            <Text style={[styles.plLabel, { color: item.highlight ? colors.foreground : colors.mutedForeground, fontFamily: item.highlight ? 'Inter_600SemiBold' : 'Inter_400Regular' }]}>
              {item.label}
            </Text>
            <Text style={[styles.plValue, { color: item.positive ? (item.highlight ? colors.primary : colors.success) : colors.destructive, fontFamily: item.highlight ? 'Inter_700Bold' : 'Inter_500Medium' }]}>
              {item.value}
            </Text>
          </View>
        ))}
      </View>

      {/* Recent Transactions */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Transactions</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ margin: 20 }} />
        ) : expenseRows.length === 0 ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              {balance?.connected === false ? 'Connect Stripe to see transactions' : 'No transactions yet'}
            </Text>
          </View>
        ) : (
          expenseRows.map((e, i) => (
            <View key={i} style={[styles.expRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={styles.expLeft}>
                <Text style={[styles.expName, { color: colors.foreground }]}>{e.name}</Text>
                <View style={styles.expMeta}>
                  <Badge label={e.category} variant="default" />
                  <Text style={[styles.expDate, { color: colors.mutedForeground }]}>{e.date}</Text>
                </View>
              </View>
              <Text style={[styles.expAmount, { color: e.positive ? colors.success : colors.foreground }]}>{e.amount}</Text>
            </View>
          ))
        )}
      </View>

      {/* Documents */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Documents</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {documents.map((item, i) => (
          <TouchableOpacity key={item.label} onPress={item.onPress} activeOpacity={0.75} style={[styles.docRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.docIcon, { backgroundColor: colors.secondary }]}>
              <Feather name={item.icon} size={15} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.docLabel, { color: colors.foreground }]}>{item.label}</Text>
            <Feather name="download" size={15} color={colors.mutedForeground} />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  accessLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  overviewRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  overviewCard: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 4 },
  overviewVal: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  overviewLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  plRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  plLabel: { fontSize: 14 },
  plValue: { fontSize: 14 },
  cashRow: { padding: 14, gap: 8 },
  cashBar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  cashFill: { height: '100%', borderRadius: 4 },
  cashLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  expRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  expLeft: { flex: 1, gap: 5 },
  expName: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  expMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  expDate: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  expAmount: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  docRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  docIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  docLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },

  // Subscription card
  subCard: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 14,
    borderWidth: 1, padding: 14, marginBottom: 20, gap: 12,
  },
  subCardLeft:    { flex: 1, gap: 3 },
  subCardLabel:   { fontSize: 11, fontFamily: 'Inter_400Regular' },
  subCardPlan:    { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  subCardMeta:    { fontSize: 12, fontFamily: 'Inter_400Regular' },
  subCardRight:   { alignItems: 'flex-end' },
  subStatusPill:  { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  subStatusText:  { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});
