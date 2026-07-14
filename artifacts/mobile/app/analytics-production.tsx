/**
 * Production Analytics — Brandthread Seller App
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_DIM, PURPLE_LIGHT, SUCCESS, SUCCESS_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, BLUE, GOLD,
  FONT, FS,
} from '@/lib/theme';
import { getProductionAnalytics, getFilterState } from '@/services/analyticsService';
import { ProductionAnalytics, ManufacturerAnalyticsRow, AnalyticsMetric, AnalyticsFilterState } from '@/services/analyticsTypes';

function KpiTile({ m, color }: { m: AnalyticsMetric; color: string }) {
  const up = m.trend === 'up';
  return (
    <View style={s.kpiTile}>
      <Text style={[s.kpiValue, { color }]}>{m.formatted}</Text>
      <Text style={s.kpiLabel} numberOfLines={2}>{m.label}</Text>
      <Text style={[s.kpiChange, { color: m.trend === 'flat' ? MUTED : up ? SUCCESS : RED }]}>
        {m.changePct > 0 ? '+' : ''}{m.changePct.toFixed(1)}%
      </Text>
    </View>
  );
}

function ManufacturerCard({ mfr }: { mfr: ManufacturerAnalyticsRow }) {
  const router = useRouter();
  const onTimeColor = mfr.delayRate <= 10 ? SUCCESS : mfr.delayRate <= 20 ? ORANGE : RED;
  const qcColor     = mfr.qualityIssueRate <= 2 ? SUCCESS : mfr.qualityIssueRate <= 4 ? ORANGE : RED;
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); router.push(`/manufacturer-profile?id=${mfr.manufacturerId}` as never); }}
      style={s.mfrCard}
      activeOpacity={0.8}
    >
      <View style={s.mfrHeader}>
        <View style={s.mfrAvatar}>
          <Feather name="tool" size={18} color={PURPLE} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.mfrName}>{mfr.name}</Text>
          <Text style={s.mfrSub}>{mfr.productsProduced} products · {mfr.totalUnits.toLocaleString()} units</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.mfrSpend}>${mfr.totalSpend.toLocaleString()}</Text>
          <Text style={s.mfrUnitCost}>${mfr.avgUnitCost}/unit avg</Text>
        </View>
      </View>
      <View style={s.mfrStats}>
        <View style={s.mfrStat}>
          <Text style={[s.mfrStatValue, { color: onTimeColor }]}>{100 - mfr.delayRate}%</Text>
          <Text style={s.mfrStatLabel}>On-time</Text>
        </View>
        <View style={s.mfrStat}>
          <Text style={s.mfrStatValue}>{mfr.avgLeadTimeDays}d</Text>
          <Text style={s.mfrStatLabel}>Lead time</Text>
        </View>
        <View style={s.mfrStat}>
          <Text style={[s.mfrStatValue, { color: qcColor }]}>{100 - mfr.qualityIssueRate}%</Text>
          <Text style={s.mfrStatLabel}>QC pass</Text>
        </View>
        <View style={s.mfrStat}>
          <Text style={[s.mfrStatValue, { color: mfr.sampleApprovalRate >= 90 ? SUCCESS : ORANGE }]}>{mfr.sampleApprovalRate}%</Text>
          <Text style={s.mfrStatLabel}>Sample ok</Text>
        </View>
      </View>
      {mfr.delayRate > 10 && (
        <View style={s.mfrWarning}>
          <Feather name="alert-triangle" size={12} color={ORANGE} />
          <Text style={s.mfrWarningText}>Demo data — not verified ratings</Text>
        </View>
      )}
      <View style={s.mfrFooter}>
        <Feather name="chevron-right" size={14} color={SUBTLE} />
      </View>
    </TouchableOpacity>
  );
}

export default function AnalyticsProductionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [data,       setData]       = useState<ProductionAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const f = filter ?? await getFilterState();
    if (!filter) setFilter(f);
    setData(await getProductionAnalytics(f));
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
          <Text style={s.pageTitle}>Production Analytics</Text>
          <Text style={s.subtitle}>{filter?.dateRange.label ?? '30 days'}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/manufacturer-hub' as never)} style={s.mfrBtn}>
          <Text style={s.mfrBtnText}>Mfr. Hub</Text>
        </TouchableOpacity>
      </View>

      {/* KPI tiles */}
      <Text style={s.sectionTitle}>Production Overview</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 10, flexDirection: 'row', paddingRight: 16 }}>
        {data && [
          { m: data.activeJobs,              color: PURPLE  },
          { m: data.unitsInProduction,       color: BLUE    },
          { m: data.productionValue,         color: GOLD    },
          { m: data.avgLeadTimeDays,         color: MUTED   },
          { m: data.avgSampleTimeDays,       color: MUTED   },
          { m: data.onTimeCompletionRate,    color: SUCCESS },
          { m: data.delayedJobs,            color: RED     },
          { m: data.qcFailureRate,          color: ORANGE  },
          { m: data.avgUnitCost,            color: FG      },
        ].map(item => <KpiTile key={item.m.key} m={item.m} color={item.color} />)}
      </ScrollView>

      {/* On-time gauge */}
      <View style={s.gaugeCard}>
        <View style={s.gaugeHeader}>
          <Text style={s.gaugeTitle}>On-Time Completion</Text>
          <Text style={[s.gaugeValue, { color: (data?.onTimeCompletionRate.value ?? 0) >= 80 ? SUCCESS : ORANGE }]}>
            {data?.onTimeCompletionRate.formatted ?? '—'}
          </Text>
        </View>
        <View style={s.gaugeBar}>
          <View style={[s.gaugeFill, {
            width: `${data?.onTimeCompletionRate.value ?? 0}%`,
            backgroundColor: (data?.onTimeCompletionRate.value ?? 0) >= 80 ? SUCCESS : ORANGE,
          }]} />
        </View>
        {(data?.delayedJobs.value ?? 0) > 0 && (
          <View style={s.gaugeWarning}>
            <Feather name="alert-circle" size={12} color={RED} />
            <Text style={s.gaugeWarningText}>{data?.delayedJobs.value} job{(data?.delayedJobs.value ?? 0) !== 1 ? 's' : ''} delayed</Text>
          </View>
        )}
      </View>

      {/* Manufacturer performance */}
      <Text style={s.sectionTitle}>Manufacturer Performance</Text>
      <Text style={s.disclaimer}>Performance data is for internal reference only. Ratings are based on demo data and are not verified.</Text>
      {data?.manufacturers.length === 0 ? (
        <View style={s.emptyState}>
          <Feather name="tool" size={36} color={MUTED} />
          <Text style={s.emptyTitle}>No production data</Text>
          <Text style={s.emptyBody}>Production performance will appear after working with manufacturers.</Text>
        </View>
      ) : (
        <View style={{ gap: 12 }}>
          {data?.manufacturers.map(mfr => <ManufacturerCard key={mfr.manufacturerId} mfr={mfr} />)}
        </View>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: BG },
  content:  { paddingHorizontal: 16 },
  loadWrap: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  header:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  pageTitle:{ fontSize: 22, fontFamily: FONT.bold, color: FG },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, color: MUTED },
  mfrBtn:   { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: PURPLE },
  mfrBtnText:{ fontSize: 12, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  sectionTitle:{ fontSize: 15, fontFamily: FONT.semibold, color: FG, marginBottom: 8 },
  disclaimer:{ fontSize: 11, fontFamily: FONT.regular, color: SUBTLE, marginBottom: 14 },
  kpiTile:  { width: 110, backgroundColor: CARD, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BORDER, gap: 4 },
  kpiValue: { fontSize: 18, fontFamily: FONT.bold },
  kpiLabel: { fontSize: 10, fontFamily: FONT.regular, color: MUTED },
  kpiChange:{ fontSize: 10, fontFamily: FONT.medium },
  gaugeCard:{ backgroundColor: CARD_ELEVATED, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 20 },
  gaugeHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  gaugeTitle:{ fontSize: 14, fontFamily: FONT.semibold, color: FG },
  gaugeValue:{ fontSize: 22, fontFamily: FONT.bold },
  gaugeBar: { height: 10, backgroundColor: BORDER, borderRadius: 5, overflow: 'hidden' },
  gaugeFill:{ height: '100%', borderRadius: 5 },
  gaugeWarning:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  gaugeWarningText:{ fontSize: 12, fontFamily: FONT.medium, color: RED },
  mfrCard:  { backgroundColor: CARD, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 12 },
  mfrHeader:{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  mfrAvatar:{ width: 40, height: 40, borderRadius: 12, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  mfrName:  { fontSize: 14, fontFamily: FONT.bold, color: FG },
  mfrSub:   { fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  mfrSpend: { fontSize: 14, fontFamily: FONT.bold, color: FG },
  mfrUnitCost:{ fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  mfrStats: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 12 },
  mfrStat:  { flex: 1, alignItems: 'center', gap: 3 },
  mfrStatValue:{ fontSize: 15, fontFamily: FONT.bold, color: FG },
  mfrStatLabel:{ fontSize: 10, fontFamily: FONT.regular, color: MUTED },
  mfrWarning:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: BORDER },
  mfrWarningText:{ fontSize: 11, fontFamily: FONT.regular, color: SUBTLE },
  mfrFooter:{ alignItems: 'flex-end', marginTop: 4 },
  emptyState:{ alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyTitle:{ fontSize: 16, fontFamily: FONT.semibold, color: FG },
  emptyBody:{ fontSize: 13, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', paddingHorizontal: 24 },
});
