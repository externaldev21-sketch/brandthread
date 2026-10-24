/**
 * Store Analytics — Brandthread Seller App
 *
 * Mobbin reference: eBay "Performance" traffic-tile-then-funnel layout
 * (https://mobbin.com/screens/14328f90-76c9-44b6-8675-f0c534c2fba7) informed the
 * scrollable traffic/conversion KPI tiles above the funnel and section list.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { getStoreAnalytics, getFilterState } from '@/services/analyticsService';
import { StoreAnalytics, StoreFunnelStep, AnalyticsFilterState } from '@/services/analyticsTypes';
import { EmptyState } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { ScreenHeader } from '@/components/ScreenHeader';
import {
  AnalyticsSkeleton, Card, CardDivider, HeaderPillButton,
  ProgressBar, SectionTitle, StatTileRow,
} from '@/components/analytics/AnalyticsKit';
import { metricTiles } from '@/lib/analyticsMetricTiles';

function FunnelStepRow({ step, isLast }: { step: StoreFunnelStep; isLast: boolean }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const pct = step.conversionPct;
  const barColor = pct >= 50 ? colors.success : pct >= 20 ? colors.warning : colors.destructive;
  return (
    <View style={s.funnelStep}>
      <View style={s.funnelLeft}>
        <Text style={s.funnelLabel}>{step.label}</Text>
        <ProgressBar pct={step.conversionPct} color={barColor} />
      </View>
      <View style={s.funnelRight}>
        <Text style={s.funnelCount}>{step.count.toLocaleString()}</Text>
        {!isLast && (
          <Text style={[s.funnelDrop, { color: step.dropOffPct > 60 ? colors.destructive : step.dropOffPct > 30 ? colors.warning : colors.mutedForeground }]}>
            ↓ {step.dropOffPct.toFixed(0)}% drop
          </Text>
        )}
      </View>
    </View>
  );
}

export default function AnalyticsStoreScreen() {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const { isLoaded: authLoaded, userId } = useAuth();

  const [data,       setData]       = useState<StoreAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState(false);
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
      const next = await getStoreAnalytics(f);
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
    if (authLoaded && userId) { setLoading(true); load(); }
  }, [authLoaded, userId]); // load reads the current filter

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        title="Store Analytics"
        rightElement={<HeaderPillButton label="Edit Store" onPress={() => { Haptics.selectionAsync(); router.push('/store-builder' as never); }} />}
      />
      {loading ? (
        <AnalyticsSkeleton kpiCount={3} listRows={4} />
      ) : loadError && !data ? (
        <View style={s.loadWrap}>
          <ErrorState message="Couldn't load store analytics." onRetry={() => load()} />
        </View>
      ) : (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={s.content}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      {!data || (data.visitors.value === 0 && data.sessions.value === 0) ? (
        <EmptyState
          icon="bar-chart-2"
          title="No store visits yet"
          description="We'll show traffic and conversion once visitors start browsing your store."
          style={{ marginTop: SP.lg }}
        />
      ) : (
        <>
          {/* KPI grid */}
          <SectionTitle>Traffic</SectionTitle>
          <StatTileRow
            scroll
            items={metricTiles([
              ['visitors', data.visitors],
              ['unique', data.uniqueVisitors],
              ['sessions', data.sessions],
              ['views', data.productPageViews],
              ['returning', data.returningVisitors],
              ['mobile', data.mobileTrafficPct],
            ])}
          />

          {/* Conversion KPIs */}
          <SectionTitle>Conversion</SectionTitle>
          <StatTileRow
            scroll
            items={metricTiles([
              ['atc', data.addToCartRate],
              ['checkout', data.checkoutStartRate],
              ['purchase', data.purchaseConversion],
              ['duration', data.avgSessionDuration],
            ])}
          />

          {/* Funnel */}
          <SectionTitle>Conversion Funnel</SectionTitle>
          <Card>
            {data.funnel.map((step, i) => (
              <View key={step.label}>
                {i > 0 && <CardDivider />}
                <FunnelStepRow step={step} isLast={i === (data.funnel.length - 1)} />
              </View>
            ))}
          </Card>

          {/* Store sections — only when section-level tracking returns rows */}
          {data.sections.length > 0 && <SectionTitle>Store Section Performance</SectionTitle>}
          {data.sections.length > 0 && <Card>
            {data.sections.map((sec, i) => (
              <View key={sec.sectionKey}>
                {i > 0 && <CardDivider />}
                <TouchableOpacity
                  onPress={() => { Haptics.selectionAsync(); router.push('/store-sections' as never); }}
                  style={s.secRow}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={`${sec.label}, edit store sections`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.secLabel}>{sec.label}</Text>
                    <View style={s.secMeta}>
                      <Text style={s.secStat}>{sec.views.toLocaleString()} views</Text>
                      <Text style={s.dotSep}>·</Text>
                      <Text style={s.secStat}>{sec.clicks.toLocaleString()} clicks</Text>
                      <Text style={s.dotSep}>·</Text>
                      <Text style={[s.secStat, { color: sec.ctr > 20 ? colors.success : sec.ctr > 10 ? colors.warning : colors.destructive }]}>{sec.ctr.toFixed(1)}% click rate</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.secPurchases}>{sec.purchasesInfluenced}</Text>
                    <Text style={s.secPurchasesLabel}>purchases</Text>
                  </View>
                  <Feather name="chevron-right" size={14} color={colors.subtle} style={{ marginLeft: SP.sm }} />
                </TouchableOpacity>
              </View>
            ))}
          </Card>}
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
  funnelStep:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm + 4, minHeight: COMP.minTouchTarget },
  funnelLeft:{ flex: 1, gap: 6 },
  funnelLabel:{ fontSize: FS.sm, fontFamily: FONT.medium, color: colors.foreground },
  funnelRight:{ alignItems: 'flex-end', marginLeft: SP.sm, minWidth: 60 },
  funnelCount:{ fontSize: FS.base, fontFamily: FONT.bold, color: colors.foreground },
  funnelDrop:{ fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  secRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm + 4, minHeight: COMP.minTouchTarget },
  secLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground, marginBottom: 4 },
  secMeta:  { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  secStat:  { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  dotSep:   { fontSize: FS.xs, color: colors.subtle },
  secPurchases:{ fontSize: FS.base, fontFamily: FONT.bold, color: colors.success },
  secPurchasesLabel:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
});
