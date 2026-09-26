/**
 * Production Analytics — Brandthread Seller App
 *
 * Mobbin reference: eBay "Performance" KPI-tile strip + Shopify "Analytics"
 * gauge/progress framing (https://mobbin.com/screens/14328f90-76c9-44b6-8675-f0c534c2fba7,
 * https://mobbin.com/screens/6122bfe2-f660-4354-8c46-545ed12c96ba) informed the
 * scrollable KPI tile row and the on-time completion gauge.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { getProductionAnalytics, getFilterState } from '@/services/analyticsService';
import { ProductionAnalytics, ManufacturerAnalyticsRow, AnalyticsFilterState } from '@/services/analyticsTypes';
import { EmptyState } from '@/components/BrandthreadUI';
import {
  AnalyticsHeader, AnalyticsSkeleton, HeaderPillButton, ProgressBar, SectionTitle, StatTileRow,
} from '@/components/analytics/AnalyticsKit';

function ManufacturerCard({ mfr }: { mfr: ManufacturerAnalyticsRow }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const onTimeColor = mfr.delayRate <= 10 ? colors.success : mfr.delayRate <= 20 ? colors.warning : colors.destructive;
  const qcColor     = mfr.qualityIssueRate <= 2 ? colors.success : mfr.qualityIssueRate <= 4 ? colors.warning : colors.destructive;
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); router.push(`/manufacturer-profile?id=${mfr.manufacturerId}` as never); }}
      style={s.mfrCard}
      activeOpacity={0.8}
    >
      <View style={s.mfrHeader}>
        <View style={s.mfrAvatar}>
          <Feather name="tool" size={18} color={colors.primary} />
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
          <Text style={[s.mfrStatValue, { color: mfr.sampleApprovalRate >= 90 ? colors.success : colors.warning }]}>{mfr.sampleApprovalRate}%</Text>
          <Text style={s.mfrStatLabel}>Sample ok</Text>
        </View>
      </View>
      {mfr.delayRate > 10 && (
        <View style={s.mfrWarning}>
          <Feather name="alert-triangle" size={12} color={colors.warning} />
          <Text style={s.mfrWarningText}>Higher-than-target delay rate</Text>
        </View>
      )}
      <View style={s.mfrFooter}>
        <Feather name="chevron-right" size={14} color={colors.subtle} />
      </View>
    </TouchableOpacity>
  );
}

export default function AnalyticsProductionScreen() {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [data,       setData]       = useState<ProductionAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const requestUser = useRef<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!authLoaded || !userId) return;
    const requestedUser = userId;
    requestUser.current = requestedUser;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const next = await getProductionAnalytics(f);
      if (requestUser.current !== requestedUser) return;
      setData(next);
    } catch (err) {
      if (requestUser.current !== requestedUser) return;
    } finally { setLoading(false); setRefreshing(false); }
  }, [filter, authLoaded, userId]);

  useEffect(() => {
    requestUser.current = null;
    setData(null); setFilter(null);
    setLoading(!authLoaded);
    if (authLoaded && userId) { setLoading(true); load(); }
  }, [authLoaded, userId]); // load reads the current filter

  if (loading) {
    return <AnalyticsSkeleton topPad={topPad} kpiCount={3} listRows={3} />;
  }
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      <AnalyticsHeader
        title="Production Analytics"
        subtitle={filter?.dateRange.label ?? '30 days'}
        right={<HeaderPillButton label="Mfr. Hub" onPress={() => router.push('/manufacturer-hub' as never)} />}
      />

      {!data ? (
        <EmptyState icon="tool" title="Production insights are on the way" description="Production stats will show once you run a job." style={{ marginTop: SP.lg }} />
      ) : (
        <>
          {/* KPI tiles */}
          <SectionTitle>Production Overview</SectionTitle>
          <StatTileRow
            scroll
            items={[
              { key: 'active', label: data.activeJobs.label, value: data.activeJobs.formatted },
              { key: 'units', label: data.unitsInProduction.label, value: data.unitsInProduction.formatted },
              { key: 'value', label: data.productionValue.label, value: data.productionValue.formatted },
              { key: 'lead', label: data.avgLeadTimeDays.label, value: data.avgLeadTimeDays.formatted },
              { key: 'sample', label: data.avgSampleTimeDays.label, value: data.avgSampleTimeDays.formatted },
              { key: 'ontime', label: data.onTimeCompletionRate.label, value: data.onTimeCompletionRate.formatted },
              { key: 'delayed', label: data.delayedJobs.label, value: data.delayedJobs.formatted },
              { key: 'qc', label: data.qcFailureRate.label, value: data.qcFailureRate.formatted },
              { key: 'unitcost', label: data.avgUnitCost.label, value: data.avgUnitCost.formatted },
            ]}
          />

          {/* On-time gauge */}
          <View style={s.gaugeCard}>
            <View style={s.gaugeHeader}>
              <Text style={s.gaugeTitle}>On-Time Completion</Text>
              <Text style={[s.gaugeValue, { color: data.onTimeCompletionRate.value >= 80 ? colors.success : colors.warning }]}>
                {data.onTimeCompletionRate.formatted}
              </Text>
            </View>
            <ProgressBar
              pct={data.onTimeCompletionRate.value}
              color={data.onTimeCompletionRate.value >= 80 ? colors.success : colors.warning}
              height={10}
            />
            {data.delayedJobs.value > 0 && (
              <View style={s.gaugeWarning}>
                <Feather name="alert-circle" size={12} color={colors.destructive} />
                <Text style={s.gaugeWarningText}>{data.delayedJobs.value} job{data.delayedJobs.value !== 1 ? 's' : ''} delayed</Text>
              </View>
            )}
          </View>

          {/* Manufacturer performance */}
          <SectionTitle note="Calculated only from your recorded production activity.">Manufacturer Performance</SectionTitle>
          {data.manufacturers.length === 0 ? (
            <EmptyState icon="tool" title="No production data" description="Production performance will appear after working with manufacturers." />
          ) : (
            <View style={{ gap: SP.sm }}>
              {data.manufacturers.map(mfr => <ManufacturerCard key={mfr.manufacturerId} mfr={mfr} />)}
            </View>
          )}
        </>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: SP.md },
  gaugeCard:{ backgroundColor: colors.elevated, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: colors.border, marginBottom: SP.lg },
  gaugeHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  gaugeTitle:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  gaugeValue:{ fontSize: FS.xl, fontFamily: FONT.bold },
  gaugeWarning:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm },
  gaugeWarningText:{ fontSize: FS.sm, fontFamily: FONT.medium, color: colors.destructive },
  mfrCard:  { backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: colors.border, marginBottom: SP.sm, minHeight: COMP.minTouchTarget },
  mfrHeader:{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm + 2 },
  mfrAvatar:{ width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  mfrName:  { fontSize: FS.sm, fontFamily: FONT.bold, color: colors.foreground },
  mfrSub:   { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  mfrSpend: { fontSize: FS.sm, fontFamily: FONT.bold, color: colors.foreground },
  mfrUnitCost:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  mfrStats: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, paddingTop: SP.sm },
  mfrStat:  { flex: 1, alignItems: 'center', gap: 3 },
  mfrStatValue:{ fontSize: FS.base, fontFamily: FONT.bold, color: colors.foreground },
  mfrStatLabel:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  mfrWarning:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm, paddingTop: SP.sm, borderTopWidth: 1, borderTopColor: colors.border },
  mfrWarningText:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle },
  mfrFooter:{ alignItems: 'flex-end', marginTop: 4 },
});
