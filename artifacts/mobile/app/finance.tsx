import React, { useState, useEffect, useCallback } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform, Linking, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { isManagerRole, hasPayoutsAccess } from '@/lib/roleError';
import { RoleLockedView } from '@/components/RoleLockedView';
import { FS, FONT } from '@/lib/theme';
import { useTeamRole } from '@/hooks/useTeamRole';
import { formatCents } from '@/lib/money';
import { FinanceMoneyFlow } from '@/components/FinanceMoneyFlow';
import type { FinanceSummary } from '@/lib/financeSummary';
import { zeroFinanceSummary } from '@/lib/financeSummary';
import { getPreviewFinanceDemo } from '@/lib/previewFinance';
import type { FinanceTransactionRow } from '@/lib/previewFinance';
import { TABULAR_NUMS } from '@/constants/typography';
import { RetryRow } from '@/components/ui/RetryRow';

function fmtDate(iso: string | number) {
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
  const { isLoaded: isAuthLoaded, isSignedIn, userId } = useAuth();
  // Preview sessions never query protected finance endpoints. Fresh preview
  // stays honestly empty; explicit demo mode derives a labeled ledger from
  // the local order fixture and never claims Stripe or bank readiness.
  const isPreviewMode = isSellerDevPreview();
  const isDemoPreview = isPreviewMode && isPreviewDemoMode();
  const isSignedOutSellerPreview = (isPreviewMode && !userId) || (isPreviewMode && (!isAuthLoaded || !isSignedIn));
  const skipProtectedReads = isPreviewMode || isSignedOutSellerPreview;
  const { currentRole, isLoadingRole } = useTeamRole();
  const isReadOnly = isManagerRole(currentRole);
  const [transactions, setTransactions] = useState<FinanceTransactionRow[]>([]);
  const [balance,      setBalance]      = useState<any>(null);
  const [loading,      setLoading]      = useState(!skipProtectedReads);
  // Held vs on-the-way vs available vs paid out (owner only on the server).
  const [summary,      setSummary]      = useState<FinanceSummary | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  // The Stripe balance/transactions fetch failing must never be shown as a
  // genuine "$0.00" — that misrepresents an outage as an honest zero balance.
  const [balanceError, setBalanceError] = useState(false);

  // Subscription status for the dashboard card
  const [subStatus, setSubStatus] = useState<{
    plan: string; status: string; renewsOn: string | null; trialEnd: string | null; amountCents: number;
  } | null>(null);

  const load = useCallback(async () => {
    if (skipProtectedReads) {
      if (isDemoPreview) {
        const demo = getPreviewFinanceDemo();
        setTransactions(demo.transactions);
        setBalance(null);
        setSummary(demo.summary);
      } else {
        setTransactions([]);
        setBalance({ available: { amount: 0, currency: 'usd', formatted: '$0.00' }, pending: { amount: 0, currency: 'usd', formatted: '$0.00' }, connected: false });
        setSummary(zeroFinanceSummary());
      }
      setSummaryError(false);
      setBalanceError(false);
      setSubStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setSummaryError(false);
    setBalanceError(false);
    // Loaded independently: a Stripe hiccup on the transactions list must not
    // hide the ledger figures, and vice versa.
    const summaryRequest = api.finance.summary()
      .then((next) => setSummary(next))
      .catch(() => setSummaryError(true));
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
      // A failed balance/transactions fetch must render a retry affordance,
      // never a silent $0.00 — see balanceError below.
      setBalanceError(true);
    }
    await summaryRequest;
    setLoading(false);
  }, [api, isDemoPreview, skipProtectedReads]);

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
    { label: 'Net (recent)', value: formatCents(totalNet), color: colors.info, icon: 'percent' as const },
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
     { label: 'Net (recent)',  value: formatCents(totalNet), positive: totalNet >= 0, highlight: true },
  ];

  const documents = isPreviewMode ? [] : [
    ...(!isReadOnly ? [{ label: 'Download Statement (CSV)', icon: 'file-text' as const, onPress: handleDownloadStatement }] : []),
    { label: 'Monthly Statements (PDF / CSV)', icon: 'calendar' as const, onPress: () => router.push('/statements' as any) },
    { label: 'Tax Report / 1099-K', icon: 'percent' as const, onPress: () => router.push('/taxes-duties' as any) },
    { label: 'Chargebacks', icon: 'shield' as const, trailing: 'chevron-right' as const, onPress: () => router.push('/disputes' as any) },
  ];

  if (isLoadingRole && !isSignedOutSellerPreview) {
    return (
      <View style={[styles.container, { backgroundColor: 'transparent' }]}>
        <ScreenHeader title="Finance" />
        <View style={styles.accessLoading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  if (!isPreviewMode && !hasPayoutsAccess(currentRole) && !isReadOnly) {
    return (
      <View style={[styles.container, { backgroundColor: 'transparent' }]}>
        <ScreenHeader title="Finance" />
        <RoleLockedView screenTitle="finance" currentRole={currentRole ?? undefined} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader title="Finance" />
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
            <Text style={[styles.subCardPlan, TABULAR_NUMS, { color: colors.foreground }]}>
              {subStatus.plan === 'growth' ? 'Growth' : subStatus.plan === 'pro' ? 'Pro' : 'Starter'}
              {' '}
              <Text style={[{ color: colors.mutedForeground, fontSize: 12, fontFamily: FONT.regular }, TABULAR_NUMS]}>
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
                  : subStatus.status === 'active' ? `${colors.success}22`
                  : `${colors.warning}22` },
            ]}>
              <Text style={[
                styles.subStatusText,
                { color: subStatus.status === 'trialing' ? colors.info
                    : subStatus.status === 'active' ? colors.success
                    : colors.warning },
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

      {/* Where the money is — from the money ledger + live Stripe balance.
          Managers cannot read owner balances, so they keep the overview. */}
      {!isReadOnly && (!isSignedOutSellerPreview || isDemoPreview) && (
        <FinanceMoneyFlow summary={summary} loading={loading} error={summaryError} onRetry={load} />
      )}

      {/* Overview (Stripe balance) — shown when the ledger summary is unavailable */}
      {!isDemoPreview && (isReadOnly || isSignedOutSellerPreview || (!summary && summaryError)) && (
      <View style={styles.overviewRow}>
        {!loading && balanceError ? (
          <View style={[styles.overviewCard, { flex: 1, backgroundColor: colors.card, borderColor: colors.border, alignItems: 'flex-start' }]}>
            <RetryRow label="Couldn't load balance" onRetry={load} />
          </View>
        ) : (
          overviewCards.map((card) => (
            <View key={card.label} style={[styles.overviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name={card.icon} size={16} color={card.color} />
              <Text style={[styles.overviewVal, TABULAR_NUMS, { color: card.color }]}>{card.value}</Text>
              <Text style={[styles.overviewLabel, { color: colors.mutedForeground }]}>{card.label}</Text>
            </View>
          ))
        )}
      </View>
      )}

      {/* P&L */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Summary</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {!loading && balanceError ? (
          <View style={{ padding: 16, alignItems: 'flex-start' }}>
            <RetryRow label="Couldn't load summary" onRetry={load} />
          </View>
        ) : (
          PL_DATA_FALLBACK.map((item, i) => (
            <View
              key={item.label}
              style={[
                styles.plRow,
                i > 0 && { borderTopWidth: 1, borderTopColor: colors.border },
                item.highlight && { backgroundColor: colors.accent },
              ]}
            >
              <Text style={[styles.plLabel, { color: item.highlight ? colors.foreground : colors.mutedForeground, fontFamily: item.highlight ? FONT.semibold : FONT.regular }]}>
                {item.label}
              </Text>
              <Text style={[styles.plValue, TABULAR_NUMS, { color: item.positive ? (item.highlight ? colors.primary : colors.success) : colors.destructive, fontFamily: item.highlight ? FONT.bold : FONT.medium }]}>
                {item.value}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Recent Transactions */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Transactions</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ margin: 20 }} />
        ) : balanceError ? (
          <View style={{ padding: 20, alignItems: 'flex-start' }}>
            <RetryRow label="Couldn't load transactions" onRetry={load} />
          </View>
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
              <Text style={[styles.expAmount, TABULAR_NUMS, { color: e.positive ? colors.success : colors.foreground }]}>{e.amount}</Text>
            </View>
          ))
        )}
      </View>

      {/* Documents */}
      {documents.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Documents</Text>
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {documents.map((item, i) => (
              <TouchableOpacity key={item.label} onPress={() => item.onPress()} activeOpacity={0.75} style={[styles.docRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                <View style={[styles.docIcon, { backgroundColor: colors.secondary }]}>
                  <Feather name={item.icon} size={15} color={colors.mutedForeground} />
                </View>
                <Text style={[styles.docLabel, { color: colors.foreground }]}>{item.label}</Text>
                <Feather name={'trailing' in item ? item.trailing : 'download'} size={15} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  accessLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: FONT.medium },
  pageTitle: { fontSize: 28, fontFamily: FONT.bold, marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: FONT.regular, marginBottom: 20 },
  overviewRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  overviewCard: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 4 },
  overviewVal: { fontSize: 16, fontFamily: FONT.bold },
  overviewLabel: { fontSize: FS.xs, fontFamily: FONT.regular },
  sectionTitle: { fontSize: 17, fontFamily: FONT.semibold, marginBottom: 12 },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  plRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  plLabel: { fontSize: 14 },
  plValue: { fontSize: 14 },
  cashRow: { padding: 14, gap: 8 },
  cashBar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  cashFill: { height: '100%', borderRadius: 4 },
  cashLabel: { fontSize: 13, fontFamily: FONT.medium },
  expRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  expLeft: { flex: 1, gap: 5 },
  expName: { fontSize: 13, fontFamily: FONT.medium },
  expMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  expDate: { fontSize: 11, fontFamily: FONT.regular },
  expAmount: { fontSize: 14, fontFamily: FONT.semibold },
  docRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  docIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  docLabel: { flex: 1, fontSize: 14, fontFamily: FONT.regular },

  // Subscription card
  subCard: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 14,
    borderWidth: 1, padding: 14, marginBottom: 20, gap: 12,
  },
  subCardLeft:    { flex: 1, gap: 3 },
  subCardLabel:   { fontSize: 11, fontFamily: FONT.regular },
  subCardPlan:    { fontSize: 16, fontFamily: FONT.semibold },
  subCardMeta:    { fontSize: 12, fontFamily: FONT.regular },
  subCardRight:   { alignItems: 'flex-end' },
  subStatusPill:  { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  subStatusText:  { fontSize: 11, fontFamily: FONT.semibold },
});
