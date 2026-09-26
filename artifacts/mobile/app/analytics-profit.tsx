/**
 * Profit Analytics — Brandthread Seller App
 *
 * Mobbin reference: Turo "Business/Earnings" hero total + breakdown legend
 * (https://mobbin.com/screens/df67c6c0-b53d-4b3f-982a-e67f10409e4a) informed
 * the large estimated-total hero card above the profit waterfall list.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { getProfitAnalytics, getPayoutAnalytics, getFilterState } from '@/services/analyticsService';
import { ProfitAnalytics, PayoutAnalytics, AnalyticsFilterState } from '@/services/analyticsTypes';
import { EmptyState } from '@/components/BrandthreadUI';
import {
  AnalyticsHeader, AnalyticsSkeleton, Card, CardDivider, PillTabs, SectionTitle, Sparkline, StatTileRow,
} from '@/components/analytics/AnalyticsKit';

export default function AnalyticsProfitScreen() {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [profit,     setProfit]     = useState<ProfitAnalytics | null>(null);
  const [payout,     setPayout]     = useState<PayoutAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<'profit' | 'payout'>('profit');
  const requestUser = useRef<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!authLoaded || !userId) return;
    const requestedUser = userId;
    requestUser.current = requestedUser;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const [p, pay] = await Promise.all([getProfitAnalytics(f), getPayoutAnalytics()]);
      if (requestUser.current !== requestedUser) return;
      setProfit(p); setPayout(pay);
    } catch (err) {
      if (requestUser.current !== requestedUser) return;
    } finally { setLoading(false); setRefreshing(false); }
  }, [filter, authLoaded, userId]);

  useEffect(() => {
    requestUser.current = null;
    setProfit(null); setPayout(null); setFilter(null);
    setLoading(!authLoaded);
    if (authLoaded && userId) { setLoading(true); load(); }
  }, [authLoaded, userId]); // load reads the current filter

  if (loading) {
    return <AnalyticsSkeleton topPad={topPad} kpiCount={0} listRows={3} />;
  }
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      <AnalyticsHeader title="Profit & Payout" subtitle={filter?.dateRange.label ?? '30 days'} />

      <PillTabs
        options={[{ key: 'profit', label: 'Profit' }, { key: 'payout', label: 'Payouts' }] as const}
        value={tab}
        onChange={setTab}
        scroll={false}
      />

      {tab === 'profit' && !profit && (
        <EmptyState icon="trending-up" title="Profit insights are on the way" description="We'll show margins once your sales and costs sync." style={{ marginTop: SP.lg }} />
      )}

      {tab === 'profit' && profit && (
        <>
          {/* Profit hero */}
          <View style={s.heroCard}>
            <Text style={s.heroEst}>Estimated</Text>
            <Text style={s.heroValue}>{profit.estimatedProfit.formatted}</Text>
            <Text style={[s.heroMargin, { color: colors.success }]}>{profit.profitMargin.formatted} margin</Text>
            <Text style={s.heroDisclaimer}>Cost estimates may differ from actual figures</Text>
            <Sparkline points={profit.profitChart} color={colors.success} />
          </View>

          {/* Waterfall */}
          <SectionTitle>Profit Breakdown</SectionTitle>
          <Card>
            {profit.lineItems.map((item, i) => {
              const isTotal = item.label === 'Est. Profit';
              return (
                <View key={item.label}>
                  {i > 0 && <CardDivider />}
                  <View style={[s.lineRow, isTotal && s.totalRow]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[s.lineLabel, isTotal && { color: colors.foreground, fontFamily: FONT.bold }]}>{item.label}</Text>
                      {item.isEstimate && !isTotal && <Text style={s.estimateNote}>estimate</Text>}
                    </View>
                    <Text style={[
                      s.lineAmount,
                      isTotal
                        ? { color: colors.warning, fontSize: FS.md, fontFamily: FONT.bold }
                        : item.isDeduction
                          ? { color: colors.destructive }
                          : { color: colors.success },
                    ]}>
                      {item.isDeduction ? `−$${Math.abs(item.amount).toLocaleString()}` : `$${item.amount.toLocaleString()}`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>

          {/* Key metrics */}
          <SectionTitle>Key Metrics</SectionTitle>
          <StatTileRow
            items={[
              { key: 'gross', label: profit.grossRevenue.label, value: profit.grossRevenue.formatted, changePct: profit.grossRevenue.changePct },
              { key: 'net',   label: profit.netRevenue.label,   value: profit.netRevenue.formatted,   changePct: profit.netRevenue.changePct },
              { key: 'margin', label: profit.profitMargin.label, value: profit.profitMargin.formatted, changePct: profit.profitMargin.changePct },
            ]}
          />
        </>
      )}

      {tab === 'payout' && !payout && (
        <EmptyState icon="dollar-sign" title="Payout insights are on the way" description="We'll show balances once your sales and payouts sync." style={{ marginTop: SP.lg }} />
      )}

      {tab === 'payout' && payout && (
        <>
          {/* Payout balance */}
          <View style={s.payoutCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={s.payoutLabel}>Available Balance</Text>
                <Text style={s.payoutValue}>{payout.availableBalance.formatted}</Text>
              </View>
              <View style={s.nextPayoutBadge}>
                <Text style={s.nextPayoutDate}>Next payout</Text>
                <Text style={s.nextPayoutAmt}>{payout.nextPayoutAmount.formatted}</Text>
                <Text style={s.nextPayoutDate}>{payout.nextPayoutDate}</Text>
              </View>
            </View>
          </View>

          <Card>
            {[
              { label: 'Pending Balance',         value: payout.pendingBalance.formatted,         note: '' },
              { label: 'Held Funds',              value: payout.heldFunds.formatted,              note: '' },
              { label: 'Total Paid Out',          value: payout.totalPaidOut.formatted,           note: '' },
              { label: 'Manufacturer Allocation', value: payout.manufacturerAllocation.formatted, note: 'est.' },
              { label: 'Shipping Allocation',     value: payout.shippingAllocation.formatted,     note: 'est.' },
              { label: 'Dispute Holds',           value: payout.disputeHolds.formatted,           note: '' },
              { label: 'Refund Impact',           value: payout.refundImpact.formatted,           note: '' },
            ].map((row, i) => (
              <View key={row.label}>
                {i > 0 && <CardDivider />}
                <View style={s.payRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.payRowLabel}>{row.label}</Text>
                    {row.note ? <Text style={s.payRowNote}>{row.note}</Text> : null}
                  </View>
                  <Text style={s.payRowValue}>{row.value}</Text>
                </View>
              </View>
            ))}
          </Card>
          <Text style={s.payoutDisclaimer}>
            Payout figures are estimates. Actual amounts are confirmed by your payment provider.
          </Text>
        </>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: SP.md },
  heroCard: { backgroundColor: colors.elevated, borderRadius: RADIUS.lg, padding: SP.lg, borderWidth: 1, borderColor: colors.border, marginBottom: SP.lg, alignItems: 'center', gap: 4 },
  heroEst:  { fontSize: FS.xs, fontFamily: FONT.medium, color: colors.subtle, letterSpacing: 0.8, textTransform: 'uppercase' },
  heroValue:{ fontSize: 44, fontFamily: FONT.bold, color: colors.foreground },
  heroMargin:{ fontSize: FS.md, fontFamily: FONT.semibold },
  heroDisclaimer:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, marginBottom: SP.sm },
  lineRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: COMP.minTouchTarget },
  totalRow: { backgroundColor: colors.elevated, paddingVertical: SP.md },
  lineLabel:{ fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  estimateNote:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, marginTop: 1 },
  lineAmount:{ fontSize: FS.base, fontFamily: FONT.semibold },
  payoutCard:{ backgroundColor: colors.elevated, borderRadius: RADIUS.lg, padding: SP.lg, borderWidth: 1, borderColor: colors.border, marginBottom: SP.lg },
  payoutLabel:{ fontSize: FS.xs, fontFamily: FONT.medium, color: colors.mutedForeground, marginBottom: 4 },
  payoutValue:{ fontSize: 36, fontFamily: FONT.bold, color: colors.foreground },
  nextPayoutBadge:{ backgroundColor: colors.success + '22', borderRadius: RADIUS.sm, padding: SP.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.success + '44' },
  nextPayoutDate:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.success },
  nextPayoutAmt:{ fontSize: FS.lg, fontFamily: FONT.bold, color: colors.success },
  payRow:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: COMP.minTouchTarget },
  payRowLabel:{ fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  payRowNote:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, marginTop: 1 },
  payRowValue:{ fontSize: FS.base, fontFamily: FONT.semibold, color: colors.foreground },
  payoutDisclaimer:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, textAlign: 'center', paddingHorizontal: SP.md, marginBottom: SP.sm },
});
