/**
 * Profit Analytics — Brandthread Seller App
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_DIM, PURPLE_LIGHT, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD,
  FONT, FS,
} from '@/lib/theme';
import { getProfitAnalytics, getPayoutAnalytics, getFilterState, exportAnalytics } from '@/services/analyticsService';
import { ProfitAnalytics, PayoutAnalytics, ProfitLineItem, AnalyticsMetric, AnalyticsFilterState } from '@/services/analyticsTypes';

function MiniBar({ points, color = SUCCESS }: { points: Array<{ value: number }>; color?: string }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const max = Math.max(...points.map(p => p.value), 1);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 28, gap: 2 }}>
      {points.slice(-20).map((p, i) => (
        <View key={i} style={{ flex: 1, borderRadius: 2, height: Math.max(2, (p.value / max) * 28), backgroundColor: color, opacity: 0.7 }} />
      ))}
    </View>
  );
}

export default function AnalyticsProfitScreen() {
  const colors = useColors();
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = colors;
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [profit,     setProfit]     = useState<ProfitAnalytics | null>(null);
  const [payout,     setPayout]     = useState<PayoutAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<'profit' | 'payout'>('profit');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const [p, pay] = await Promise.all([getProfitAnalytics(f), getPayoutAnalytics()]);
      setProfit(p); setPayout(pay); setError(null);
    } catch (err) {
      setProfit(null); setPayout(null);
      setError(err instanceof Error ? err.message : 'Profit analytics are unavailable.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [filter]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  if (loading) {
    return <View style={[s.loadWrap, { paddingTop: topPad + 48 }]}><ActivityIndicator size="large" color={PURPLE} /></View>;
  }
  if (error) return <View style={[s.loadWrap, { paddingTop: topPad + 48 }]}><Text style={{ color: MUTED }}>{error}</Text><TouchableOpacity onPress={() => load()}><Text style={{ color: PURPLE }}>Retry</Text></TouchableOpacity></View>;

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={PURPLE} />}
    >
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.pageTitle}>Profit & Payout</Text>
          <Text style={s.subtitle}>{filter?.dateRange.label ?? '30 days'}</Text>
        </View>
        <TouchableOpacity onPress={async () => {
          if (!filter) return;
          Alert.alert('Exporting…');
          await exportAnalytics('profit', filter.dateRange);
          Alert.alert('Export ready', 'Profit CSV generated.');
        }} style={s.iconBtn}>
          <Feather name="share" size={16} color={PURPLE} />
        </TouchableOpacity>
      </View>

      {/* Tab toggle */}
      <View style={s.tabRow}>
        {(['profit','payout'] as const).map(t => (
          <TouchableOpacity key={t} onPress={() => { Haptics.selectionAsync(); setTab(t); }} style={[s.tabBtn, tab === t && s.tabBtnActive, tab === t && { backgroundColor: PURPLE_DIM, borderColor: PURPLE }]}>
            <Text style={[s.tabBtnText, tab === t && s.tabBtnTextActive, tab === t && { color: PURPLE_LIGHT }]}>{t === 'profit' ? 'Profit' : 'Payouts'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'profit' && profit && (
        <>
          {/* Profit hero */}
          <View style={s.heroCard}>
            <Text style={s.heroEst}>Estimated</Text>
            <Text style={s.heroValue}>{profit.estimatedProfit.formatted}</Text>
            <Text style={[s.heroMargin, { color: SUCCESS }]}>{profit.profitMargin.formatted} margin</Text>
            <Text style={s.heroDisclaimer}>Cost estimates may differ from actual figures</Text>
            <MiniBar points={profit.profitChart} color={SUCCESS} />
          </View>

          {/* Waterfall */}
          <Text style={s.sectionTitle}>Profit Breakdown</Text>
          <View style={s.card}>
            {profit.lineItems.map((item, i) => {
              const isTotal = item.label === 'Est. Profit';
              return (
                <View key={item.label} style={[s.lineRow, i > 0 && s.divider, isTotal && s.totalRow]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.lineLabel, isTotal && { color: FG, fontFamily: FONT.bold }]}>{item.label}</Text>
                    {item.isEstimate && !isTotal && (
                      <Text style={s.estimateNote}>estimate</Text>
                    )}
                  </View>
                  <Text style={[
                    s.lineAmount,
                    isTotal
                      ? { color: GOLD, fontSize: 17, fontFamily: FONT.bold }
                      : item.isDeduction
                        ? { color: RED }
                        : { color: SUCCESS }
                  ]}>
                    {item.isDeduction ? `−$${Math.abs(item.amount).toLocaleString()}` : `$${item.amount.toLocaleString()}`}
                  </Text>
                </View>
              );
            })}
          </View>

          {/* Key metrics */}
          <Text style={s.sectionTitle}>Key Metrics</Text>
          <View style={s.metricsRow}>
            {[
              { m: profit.grossRevenue,  color: FG       },
              { m: profit.netRevenue,    color: PURPLE   },
              { m: profit.profitMargin,  color: SUCCESS  },
            ].map(item => (
              <View key={item.m.key} style={s.metCard}>
                <Text style={[s.metValue, { color: item.color }]}>{item.m.formatted}</Text>
                <Text style={s.metLabel}>{item.m.label}</Text>
                <Text style={[s.metChange, { color: item.m.trend === 'up' ? SUCCESS : RED }]}>
                  {(item.m.changePct ?? 0) > 0 ? '+' : ''}{item.m.changePct?.toFixed(1) ?? '—'}%
                </Text>
              </View>
            ))}
          </View>
        </>
      )}

      {tab === 'payout' && payout && (
        <>
          {/* Payout balance */}
          <View style={s.payoutCard}>
            <View style={s.payoutRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.payoutLabel}>Available Balance</Text>
                <Text style={s.payoutValue}>{payout.availableBalance.formatted}</Text>
              </View>
              <View style={[s.nextPayoutBadge]}>
                <Text style={s.nextPayoutDate}>Next payout</Text>
                <Text style={s.nextPayoutAmt}>{payout.nextPayoutAmount.formatted}</Text>
                <Text style={s.nextPayoutDate2}>{payout.nextPayoutDate}</Text>
              </View>
            </View>
          </View>

          <View style={s.card}>
            {[
              { label: 'Pending Balance',        value: payout.pendingBalance.formatted,         note: '' },
              { label: 'Held Funds',             value: payout.heldFunds.formatted,              note: '' },
              { label: 'Total Paid Out',         value: payout.totalPaidOut.formatted,           note: '' },
              { label: 'Manufacturer Allocation',value: payout.manufacturerAllocation.formatted, note: 'est.' },
              { label: 'Shipping Allocation',    value: payout.shippingAllocation.formatted,     note: 'est.' },
              { label: 'Dispute Holds',          value: payout.disputeHolds.formatted,           note: '' },
              { label: 'Refund Impact',          value: payout.refundImpact.formatted,           note: '' },
            ].map((row, i) => (
              <View key={row.label} style={[s.payRowItem, i > 0 && s.divider]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.payRowLabel}>{row.label}</Text>
                  {row.note ? <Text style={s.payRowNote}>{row.note}</Text> : null}
                </View>
                <Text style={s.payRowValue}>{row.value}</Text>
              </View>
            ))}
          </View>
          <Text style={s.payoutDisclaimer}>
            Payout figures are estimates. Actual amounts are confirmed by your payment provider.
          </Text>
        </>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT } = colors;
  return StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: BG },
  content:  { paddingHorizontal: 16 },
  loadWrap: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  header:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  pageTitle:{ fontSize: 22, fontFamily: FONT.bold, color: FG },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, color: MUTED },
  iconBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  tabRow:   { flexDirection: 'row', gap: 10, marginBottom: 20 },
  tabBtn:   { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  tabBtnActive:{},
  tabBtnText:{ fontSize: 14, fontFamily: FONT.semibold, color: MUTED },
  tabBtnTextActive:{},
  heroCard: { backgroundColor: CARD_ELEVATED, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: BORDER_ACTIVE, marginBottom: 20, alignItems: 'center', gap: 4 },
  heroEst:  { fontSize: 11, fontFamily: FONT.medium, color: SUBTLE, letterSpacing: 0.8, textTransform: 'uppercase' },
  heroValue:{ fontSize: 44, fontFamily: FONT.bold, color: FG },
  heroMargin:{ fontSize: 15, fontFamily: FONT.semibold },
  heroDisclaimer:{ fontSize: 11, fontFamily: FONT.regular, color: SUBTLE, marginBottom: 8 },
  sectionTitle:{ fontSize: 15, fontFamily: FONT.semibold, color: FG, marginBottom: 10 },
  card:     { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 20, overflow: 'hidden' },
  divider:  { height: 1, backgroundColor: BORDER, marginHorizontal: 16 },
  lineRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  totalRow: { backgroundColor: CARD_ELEVATED, paddingVertical: 16 },
  lineLabel:{ fontSize: 13, fontFamily: FONT.regular, color: MUTED },
  estimateNote:{ fontSize: 10, fontFamily: FONT.regular, color: SUBTLE, marginTop: 1 },
  lineAmount:{ fontSize: 14, fontFamily: FONT.semibold },
  metricsRow:{ flexDirection: 'row', gap: 10, marginBottom: 20 },
  metCard:  { flex: 1, backgroundColor: CARD, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BORDER },
  metValue: { fontSize: 17, fontFamily: FONT.bold, marginBottom: 2 },
  metLabel: { fontSize: 10, fontFamily: FONT.regular, color: MUTED, marginBottom: 2 },
  metChange:{ fontSize: 10, fontFamily: FONT.medium },
  payoutCard:{ backgroundColor: CARD_ELEVATED, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: BORDER_ACTIVE, marginBottom: 20 },
  payoutRow:{ flexDirection: 'row', alignItems: 'center' },
  payoutLabel:{ fontSize: 12, fontFamily: FONT.medium, color: MUTED, marginBottom: 4 },
  payoutValue:{ fontSize: 36, fontFamily: FONT.bold, color: FG },
  nextPayoutBadge:{ backgroundColor: SUCCESS_DIM, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: SUCCESS + '44' },
  nextPayoutDate:{ fontSize: 10, fontFamily: FONT.regular, color: SUCCESS },
  nextPayoutAmt:{ fontSize: 17, fontFamily: FONT.bold, color: SUCCESS },
  nextPayoutDate2:{ fontSize: 10, fontFamily: FONT.regular, color: SUCCESS },
  payRowItem:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  payRowLabel:{ fontSize: 13, fontFamily: FONT.regular, color: MUTED },
  payRowNote:{ fontSize: 10, fontFamily: FONT.regular, color: SUBTLE, marginTop: 1 },
  payRowValue:{ fontSize: 14, fontFamily: FONT.semibold, color: FG },
  payoutDisclaimer:{ fontSize: 11, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', paddingHorizontal: 16, marginBottom: 12 },
  });
};
