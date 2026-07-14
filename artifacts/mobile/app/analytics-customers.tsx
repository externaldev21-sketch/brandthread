/**
 * Customer Analytics — Brandthread Seller App
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_DIM, PURPLE_LIGHT, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, BLUE, BLUE_DIM, GOLD,
  FONT, FS,
} from '@/lib/theme';
import { getCustomerAnalytics, getFilterState } from '@/services/analyticsService';
import { CustomerAnalytics, AnalyticsMetric, CustomerCohort, AnalyticsFilterState } from '@/services/analyticsTypes';

function KpiRow({ m, iconName, iconColor }: { m: AnalyticsMetric; iconName: keyof typeof Feather.glyphMap; iconColor: string }) {
  const upColor = m.trend === 'up' ? SUCCESS : RED;
  return (
    <View style={s.kpiRow}>
      <View style={[s.kpiIcon, { backgroundColor: iconColor + '22' }]}>
        <Feather name={iconName} size={14} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.kpiLabel}>{m.label}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.kpiValue}>{m.formatted}</Text>
        <Text style={[s.kpiChange, { color: m.trend === 'flat' ? MUTED : upColor }]}>
          {m.changePct > 0 ? '+' : ''}{m.changePct.toFixed(1)}%
        </Text>
      </View>
    </View>
  );
}

export default function AnalyticsCustomersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [data,       setData]       = useState<CustomerAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const f = filter ?? await getFilterState();
    if (!filter) setFilter(f);
    setData(await getCustomerAnalytics(f));
    setLoading(false); setRefreshing(false);
  }, [filter]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  if (loading) {
    return <View style={[s.loadWrap, { paddingTop: topPad + 48 }]}><ActivityIndicator size="large" color={PURPLE} /></View>;
  }

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
          <Text style={s.pageTitle}>Customer Analytics</Text>
          <Text style={s.subtitle}>{filter?.dateRange.label ?? '30 days'}</Text>
        </View>
      </View>

      {/* KPIs */}
      <Text style={s.sectionTitle}>Overview</Text>
      <View style={s.card}>
        {data && <>
          <KpiRow m={data.totalCustomers}       iconName="users"    iconColor={PURPLE} />
          <View style={s.divider} />
          <KpiRow m={data.newCustomers}         iconName="user-plus" iconColor={SUCCESS} />
          <View style={s.divider} />
          <KpiRow m={data.returningCustomers}   iconName="repeat"   iconColor={BLUE} />
          <View style={s.divider} />
          <KpiRow m={data.repeatRate}           iconName="refresh-cw" iconColor={PURPLE} />
          <View style={s.divider} />
          <KpiRow m={data.avgCustomerValue}     iconName="dollar-sign" iconColor={GOLD} />
          <View style={s.divider} />
          <KpiRow m={data.clv}                  iconName="heart"    iconColor={SUCCESS} />
          <View style={s.divider} />
          <KpiRow m={data.purchaseFrequency}    iconName="shopping-bag" iconColor={BLUE} />
          <View style={s.divider} />
          <KpiRow m={data.avgDaysBetweenOrders} iconName="clock"    iconColor={MUTED} />
        </>}
      </View>

      {/* Risk */}
      <View style={s.riskRow}>
        <View style={[s.riskCard, { borderColor: ORANGE + '44' }]}>
          <View style={[s.riskIcon, { backgroundColor: ORANGE_DIM }]}>
            <Feather name="alert-triangle" size={18} color={ORANGE} />
          </View>
          <Text style={[s.riskValue, { color: ORANGE }]}>{data?.atRiskCount.formatted ?? '—'}</Text>
          <Text style={s.riskLabel}>At-Risk</Text>
        </View>
        <View style={[s.riskCard, { borderColor: GOLD + '44' }]}>
          <View style={[s.riskIcon, { backgroundColor: 'rgba(245,158,11,0.12)' }]}>
            <Feather name="star" size={18} color={GOLD} />
          </View>
          <Text style={[s.riskValue, { color: GOLD }]}>{data?.vipCount.formatted ?? '—'}</Text>
          <Text style={s.riskLabel}>VIP</Text>
        </View>
        <View style={[s.riskCard, { borderColor: RED + '44' }]}>
          <View style={[s.riskIcon, { backgroundColor: RED_DIM }]}>
            <Feather name="user-x" size={18} color={RED} />
          </View>
          <Text style={[s.riskValue, { color: RED }]}>{data?.churnRisk.formatted ?? '—'}</Text>
          <Text style={s.riskLabel}>Churn Risk</Text>
        </View>
      </View>

      {/* Cohorts */}
      <Text style={s.sectionTitle}>Cohort Retention</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
        <View>
          <View style={s.cohortHeaderRow}>
            <Text style={[s.cohortCell, s.cohortLabelCell]}>Cohort</Text>
            <Text style={s.cohortCell}>Customers</Text>
            <Text style={s.cohortCell}>M+1</Text>
            <Text style={s.cohortCell}>M+2</Text>
            <Text style={s.cohortCell}>M+3</Text>
            <Text style={s.cohortCell}>Avg LTV</Text>
          </View>
          {data?.cohorts.map(c => (
            <View key={c.cohortLabel} style={s.cohortRow}>
              <Text style={[s.cohortCell, s.cohortLabelCell, { color: FG }]}>{c.cohortLabel}</Text>
              <Text style={s.cohortCell}>{c.customers}</Text>
              <Text style={[s.cohortCell, { color: retColor(c.month1RetentionPct) }]}>{c.month1RetentionPct > 0 ? `${c.month1RetentionPct}%` : '—'}</Text>
              <Text style={[s.cohortCell, { color: retColor(c.month2RetentionPct) }]}>{c.month2RetentionPct > 0 ? `${c.month2RetentionPct}%` : '—'}</Text>
              <Text style={[s.cohortCell, { color: retColor(c.month3RetentionPct) }]}>{c.month3RetentionPct > 0 ? `${c.month3RetentionPct}%` : '—'}</Text>
              <Text style={[s.cohortCell, { color: GOLD }]}>${c.avgLtv}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Locations */}
      <Text style={s.sectionTitle}>Top Locations</Text>
      <View style={s.card}>
        {data?.topLocations.map((loc, i) => (
          <View key={loc.location} style={[s.locRow, i > 0 && s.divider]}>
            <View style={{ flex: 1 }}>
              <Text style={s.locName}>{loc.location}</Text>
              <View style={[s.locBar, { marginTop: 4 }]}>
                <View style={[s.locFill, { width: `${loc.sharePct}%` }]} />
              </View>
            </View>
            <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
              <Text style={s.locCount}>{loc.customers.toLocaleString()}</Text>
              <Text style={s.locShare}>{loc.sharePct.toFixed(1)}%</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

function retColor(pct: number): string {
  if (pct === 0) return SUBTLE;
  if (pct >= 40) return SUCCESS;
  if (pct >= 25) return ORANGE;
  return RED;
}

const s = StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: BG },
  content:  { paddingHorizontal: 16 },
  loadWrap: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  header:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  pageTitle:{ fontSize: 22, fontFamily: FONT.bold, color: FG },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, color: MUTED },
  sectionTitle:{ fontSize: 15, fontFamily: FONT.semibold, color: FG, marginBottom: 10 },
  card:     { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 20, overflow: 'hidden' },
  divider:  { height: 1, backgroundColor: BORDER, marginHorizontal: 16 },
  kpiRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 10 },
  kpiIcon:  { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  kpiLabel: { fontSize: 13, fontFamily: FONT.regular, color: MUTED },
  kpiValue: { fontSize: 15, fontFamily: FONT.semibold, color: FG },
  kpiChange:{ fontSize: 11, fontFamily: FONT.regular },
  riskRow:  { flexDirection: 'row', gap: 10, marginBottom: 20 },
  riskCard: { flex: 1, backgroundColor: CARD, borderRadius: 14, padding: 14, borderWidth: 1, alignItems: 'center', gap: 6 },
  riskIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  riskValue:{ fontSize: 20, fontFamily: FONT.bold },
  riskLabel:{ fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  cohortHeaderRow:{ flexDirection: 'row', backgroundColor: CARD_ELEVATED, borderRadius: 10, marginBottom: 4, padding: 4 },
  cohortRow:{ flexDirection: 'row', backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER, padding: 4 },
  cohortCell:{ width: 80, textAlign: 'center', fontSize: 12, fontFamily: FONT.regular, color: MUTED, paddingVertical: 8 },
  cohortLabelCell:{ width: 90, textAlign: 'left', fontFamily: FONT.medium },
  locRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  locName:  { fontSize: 13, fontFamily: FONT.semibold, color: FG },
  locBar:   { height: 4, backgroundColor: BORDER, borderRadius: 2, overflow: 'hidden' },
  locFill:  { height: '100%', backgroundColor: PURPLE, borderRadius: 2 },
  locCount: { fontSize: 13, fontFamily: FONT.semibold, color: FG },
  locShare: { fontSize: 11, fontFamily: FONT.regular, color: MUTED },
});
