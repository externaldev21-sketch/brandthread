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
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { getProfitAnalytics, getPayoutAnalytics, getFilterState } from '@/services/analyticsService';
import { formatCents } from '@/lib/money';
import { isSellerDevPreview } from '@/lib/devPreview';
import { ProfitAnalytics, PayoutAnalytics, AnalyticsFilterState } from '@/services/analyticsTypes';
import { EmptyState } from '@/components/BrandthreadUI';
import { RetryRow } from '@/components/ui/RetryRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  AnalyticsSkeleton, Card, CardDivider, PillTabs, SectionTitle, Sparkline, StatTileRow,
} from '@/components/analytics/AnalyticsKit';
import { metricTiles } from '@/lib/analyticsMetricTiles';

export default function AnalyticsProfitScreen() {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const { isLoaded: authLoaded, userId } = useAuth();

  const [profit,     setProfit]     = useState<ProfitAnalytics | null>(null);
  const [payout,     setPayout]     = useState<PayoutAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(false);
  const [payoutError, setPayoutError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<'profit' | 'payout'>('profit');
  const requestUser = useRef<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    // The signed-out web preview has no Clerk user; the service serves its fixtures.
    const preview = isSellerDevPreview();
    if (!preview && (!authLoaded || !userId)) return;
    const requestedUser = userId ?? 'preview';
    requestUser.current = requestedUser;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      // Profit (orders + recorded costs) and payouts (live Stripe balance)
      // load independently: a missing Stripe account must not hide profit.
      const [p, pay] = await Promise.allSettled([getProfitAnalytics(f), getPayoutAnalytics(f)]);
      if (requestUser.current !== requestedUser) return;
      // A failed fetch must never be indistinguishable from "not synced
      // yet" — never render this as a genuine $0 profit/payout state.
      if (p.status === 'fulfilled') { setProfit(p.value); setLoadError(false); } else setLoadError(true);
      if (pay.status === 'fulfilled') { setPayout(pay.value); setPayoutError(false); } else setPayoutError(true);
    } catch (err) {
      if (requestUser.current !== requestedUser) return;
      setLoadError(true); setPayoutError(true);
    } finally { setLoading(false); setRefreshing(false); }
  }, [filter, authLoaded, userId]);

  useEffect(() => {
    requestUser.current = null;
    setProfit(null); setPayout(null); setFilter(null);
    setLoading(!authLoaded);
    if (isSellerDevPreview() || (authLoaded && userId)) { setLoading(true); load(); }
  }, [authLoaded, userId]); // load reads the current filter

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Profit & Payout" />
      {loading ? (
        <AnalyticsSkeleton kpiCount={0} listRows={3} />
      ) : (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      <PillTabs
        options={[{ key: 'profit', label: 'Profit' }, { key: 'payout', label: 'Payouts' }] as const}
        value={tab}
        onChange={setTab}
        scroll={false}
      />

      {tab === 'profit' && !profit && loadError && (
        <View style={{ marginTop: SP.xl, alignItems: 'center' }}>
          <RetryRow label="Couldn't load profit data" onRetry={() => load()} />
        </View>
      )}

      {tab === 'profit' && !profit && !loadError && (
        <EmptyState icon="trending-up" title="No profit data yet" description="We'll show margins once your sales and costs sync." style={{ marginTop: SP.lg }} />
      )}

      {tab === 'profit' && profit && (
        <>
          {/* Profit hero */}
          <View style={s.heroCard}>
            <Text style={s.heroEst}>Estimated</Text>
            <Text style={s.heroValue}>{profit.estimatedProfit.formatted}</Text>
            {profit.profitMargin && (
              <Text style={[s.heroMargin, { color: colors.success }]}>{profit.profitMargin.formatted} margin</Text>
            )}
            <Text style={s.heroDisclaimer}>Sales minus refunds, fees and the costs recorded in Brandthread. Product and packaging costs aren{'\u2019'}t included.</Text>
            {profit.netRevenueChart.length > 1 && <Sparkline points={profit.netRevenueChart} color={colors.success} />}
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
                      {item.isEstimate && !isTotal && <Text style={s.estimateNote}>Estimate</Text>}
                    </View>
                    <Text style={[
                      s.lineAmount,
                      isTotal
                        ? { color: colors.foreground, fontSize: FS.md, fontFamily: FONT.bold }
                        : item.isDeduction
                          ? { color: colors.destructive }
                          : { color: colors.success },
                    ]}>
                      {isTotal ? profit.estimatedProfit.formatted : item.isDeduction ? `−${formatCents(item.amountCents)}` : formatCents(item.amountCents)}
                    </Text>
                  </View>
                </View>
              );
            })}
          </Card>

          {/* Key metrics */}
          <SectionTitle>Key Metrics</SectionTitle>
          <StatTileRow
            items={metricTiles([
              ['gross', profit.grossRevenue],
              ['net', profit.netRevenue],
              ['margin', profit.profitMargin],
            ])}
          />
        </>
      )}

      {tab === 'payout' && !payout && payoutError && (
        <View style={{ marginTop: SP.xl, alignItems: 'center' }}>
          <RetryRow label="Couldn't load payout balance" onRetry={() => load()} />
        </View>
      )}

      {tab === 'payout' && !payout && !payoutError && (
        <EmptyState icon="dollar-sign" title="No payout data yet" description="We'll show balances once your sales and payouts sync." style={{ marginTop: SP.lg }} />
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
              {payout.nextPayoutAmount && (
                <View style={s.nextPayoutBadge}>
                  <Text style={s.nextPayoutDate}>Next payout</Text>
                  <Text style={s.nextPayoutAmt}>{payout.nextPayoutAmount.formatted}</Text>
                  {!!payout.nextPayoutDate && <Text style={s.nextPayoutDate}>{payout.nextPayoutDate}</Text>}
                </View>
              )}
            </View>
          </View>

          <Card>
            {[
              { label: 'Pending Balance', value: payout.pendingBalance.formatted, note: 'Still settling in Stripe' },
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
            Balances come from your Stripe account. See Payouts for history and cash-out.
          </Text>
        </>
      )}

      {/* The stack scene already ends above the floating seller tab bar. */}
      <View style={{ height: SP.lg }} />
    </ScrollView>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: SP.md },
  heroCard: { backgroundColor: colors.elevated, borderRadius: RADIUS.lg, padding: SP.lg, borderWidth: 1, borderColor: colors.border, marginBottom: SP.lg, alignItems: 'center', gap: 4 },
  heroEst:  { fontSize: FS.xs, fontFamily: FONT.medium, color: colors.subtle, letterSpacing: 0.8, textTransform: 'uppercase' },
  heroValue:{ fontSize: FS.h1, fontFamily: FONT.bold, color: colors.foreground },
  heroMargin:{ fontSize: FS.md, fontFamily: FONT.semibold },
  heroDisclaimer:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, marginBottom: SP.sm },
  lineRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: COMP.minTouchTarget },
  totalRow: { backgroundColor: colors.elevated, paddingVertical: SP.md },
  lineLabel:{ fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  estimateNote:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, marginTop: 1 },
  lineAmount:{ fontSize: FS.base, fontFamily: FONT.semibold },
  payoutCard:{ backgroundColor: colors.elevated, borderRadius: RADIUS.lg, padding: SP.lg, borderWidth: 1, borderColor: colors.border, marginBottom: SP.lg },
  payoutLabel:{ fontSize: FS.xs, fontFamily: FONT.medium, color: colors.mutedForeground, marginBottom: 4 },
  payoutValue:{ fontSize: FS.h1, fontFamily: FONT.bold, color: colors.foreground },
  nextPayoutBadge:{ backgroundColor: colors.success + '22', borderRadius: RADIUS.sm, padding: SP.sm, alignItems: 'center', borderWidth: 1, borderColor: colors.success + '44' },
  nextPayoutDate:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.success },
  nextPayoutAmt:{ fontSize: FS.lg, fontFamily: FONT.bold, color: colors.success },
  payRow:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm, minHeight: COMP.minTouchTarget },
  payRowLabel:{ fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  payRowNote:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, marginTop: 1 },
  payRowValue:{ fontSize: FS.base, fontFamily: FONT.semibold, color: colors.foreground },
  payoutDisclaimer:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, textAlign: 'center', paddingHorizontal: SP.md, marginBottom: SP.sm },
});
