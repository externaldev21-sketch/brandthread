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
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { getProductionAnalytics, getFilterState } from '@/services/analyticsService';
import { formatCents } from '@/lib/money';
import { plural } from '@/lib/plural';
import { isSellerDevPreview } from '@/lib/devPreview';
import { ProductionAnalytics, ManufacturerAnalyticsRow, AnalyticsFilterState } from '@/services/analyticsTypes';
import { EmptyState } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  AnalyticsSkeleton, HeaderPillButton, SectionTitle, StatTileRow,
} from '@/components/analytics/AnalyticsKit';
import { metricTiles } from '@/lib/analyticsMetricTiles';

function ManufacturerCard({ mfr }: { mfr: ManufacturerAnalyticsRow }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); router.push(`/manufacturer-profile?id=${mfr.manufacturerId}` as never); }}
      style={s.mfrCard}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${mfr.name}, open manufacturer profile`}
    >
      <View style={s.mfrHeader}>
        <View style={s.mfrAvatar}>
          <Feather name="tool" size={18} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.mfrName}>{mfr.name}</Text>
          <Text style={s.mfrSub}>{mfr.productsProduced} order{mfr.productsProduced !== 1 ? 's' : ''} · {plural(mfr.totalUnits, 'unit')}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.mfrSpend}>{formatCents(mfr.totalSpendCents)}</Text>
          {mfr.avgUnitCostCents !== null && <Text style={s.mfrUnitCost}>{formatCents(mfr.avgUnitCostCents)}/unit avg</Text>}
        </View>
      </View>
      {mfr.avgLeadTimeDays !== null && (
        <View style={s.mfrStats}>
          <View style={s.mfrStat}>
            <Text style={s.mfrStatValue}>{mfr.avgLeadTimeDays}d</Text>
            <Text style={s.mfrStatLabel}>Avg. order-to-delivery</Text>
          </View>
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
  const router = useRouter();
  const { isLoaded: authLoaded, userId } = useAuth();

  const [data,       setData]       = useState<ProductionAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
      const next = await getProductionAnalytics(f);
      if (requestUser.current !== requestedUser) return;
      setData(next);
      setLoadError(false);
    } catch (err) {
      if (requestUser.current !== requestedUser) return;
      setLoadError(true);
        } finally { setLoading(false); setRefreshing(false); }
  }, [filter, authLoaded, userId]);

  useEffect(() => {
    requestUser.current = null;
    setData(null); setFilter(null);
    setLoading(!authLoaded);
    if (isSellerDevPreview() || (authLoaded && userId)) { setLoading(true); load(); }
  }, [authLoaded, userId]); // load reads the current filter

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        title="Production Analytics"
        rightElement={<HeaderPillButton label="Suppliers" onPress={() => router.push('/manufacturer-hub' as never)} />}
      />
      {loading ? (
        <AnalyticsSkeleton kpiCount={3} listRows={3} />
      ) : loadError && !data ? (
        <View style={s.loadWrap}>
          <ErrorState message="Couldn't load production analytics." onRetry={() => load()} />
        </View>
      ) : (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      {!data || (data.activeJobs.value === 0 && data.manufacturers.length === 0 && data.totalSpend.value === 0) ? (
        <EmptyState icon="tool" title="No production jobs yet" description="Production stats will show once you run a job." style={{ marginTop: SP.lg }} />
      ) : (
        <>
          {/* KPI tiles */}
          <SectionTitle>Production Overview</SectionTitle>
          <StatTileRow
            scroll
            items={metricTiles([
              ['active', data.activeJobs],
              ['units', data.unitsInProduction],
              ['value', data.productionValue],
              ['spend', data.totalSpend],
              ['lead', data.avgLeadTimeDays],
              ['sample', data.avgSampleTimeDays],
              ['unitcost', data.avgUnitCost],
            ])}
          />

          {/* Manufacturer performance */}
          <SectionTitle note="Calculated only from your recorded production activity.">Manufacturer Performance</SectionTitle>
          {data.manufacturers.length === 0 ? (
            <EmptyState icon="tool" title="No production data" description="Production performance will appear after working with manufacturers." />
          ) : (
            <View>
              {data.manufacturers.map(mfr => <ManufacturerCard key={mfr.manufacturerId} mfr={mfr} />)}
            </View>
          )}
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
  loadWrap: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: SP.md },
  content:  { paddingHorizontal: SP.md },
  gaugeCard:{ backgroundColor: colors.elevated, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: colors.border, marginBottom: SP.lg },
  gaugeHeader:{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  gaugeTitle:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  gaugeValue:{ fontSize: FS.xl, fontFamily: FONT.bold },
  gaugeWarning:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm },
  gaugeWarningText:{ fontSize: FS.sm, fontFamily: FONT.medium, color: colors.destructive },
  mfrCard:  { backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: colors.border, marginBottom: SP.sm, minHeight: COMP.minTouchTarget },
  mfrHeader:{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm + 4 },
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
