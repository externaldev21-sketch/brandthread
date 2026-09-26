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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { getStoreAnalytics, getFilterState } from '@/services/analyticsService';
import { StoreAnalytics, StoreFunnelStep, AnalyticsFilterState } from '@/services/analyticsTypes';
import { EmptyState } from '@/components/BrandthreadUI';
import {
  AnalyticsHeader, AnalyticsSkeleton, Card, CardDivider, HeaderPillButton,
  ProgressBar, SectionTitle, StatTileRow,
} from '@/components/analytics/AnalyticsKit';

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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = insets.top;

  const [data,       setData]       = useState<StoreAnalytics | null>(null);
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
      const next = await getStoreAnalytics(f);
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
    return <AnalyticsSkeleton topPad={topPad} kpiCount={3} listRows={4} />;
  }
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      <AnalyticsHeader
        title="Store Analytics"
        subtitle={filter?.dateRange.label ?? '30 days'}
        right={<HeaderPillButton label="Edit Store" onPress={() => { Haptics.selectionAsync(); router.push('/store-builder' as never); }} />}
      />

      {!data ? (
        <EmptyState
          icon="bar-chart-2"
          title="Store insights are on the way"
          description="We'll show traffic and conversion once visitors start browsing your store."
          style={{ marginTop: SP.lg }}
        />
      ) : (
        <>
          {/* KPI grid */}
          <SectionTitle>Traffic</SectionTitle>
          <StatTileRow
            scroll
            items={[
              { key: 'visitors', label: data.visitors.label, value: data.visitors.formatted, changePct: data.visitors.changePct },
              { key: 'unique', label: data.uniqueVisitors.label, value: data.uniqueVisitors.formatted, changePct: data.uniqueVisitors.changePct },
              { key: 'sessions', label: data.sessions.label, value: data.sessions.formatted, changePct: data.sessions.changePct },
              { key: 'views', label: data.productPageViews.label, value: data.productPageViews.formatted, changePct: data.productPageViews.changePct },
              { key: 'returning', label: data.returningVisitors.label, value: data.returningVisitors.formatted, changePct: data.returningVisitors.changePct },
              { key: 'mobile', label: data.mobileTrafficPct.label, value: data.mobileTrafficPct.formatted, changePct: data.mobileTrafficPct.changePct },
            ]}
          />

          {/* Conversion KPIs */}
          <SectionTitle>Conversion</SectionTitle>
          <StatTileRow
            scroll
            items={[
              { key: 'atc', label: data.addToCartRate.label, value: data.addToCartRate.formatted, changePct: data.addToCartRate.changePct },
              { key: 'checkout', label: data.checkoutStartRate.label, value: data.checkoutStartRate.formatted, changePct: data.checkoutStartRate.changePct },
              { key: 'purchase', label: data.purchaseConversion.label, value: data.purchaseConversion.formatted, changePct: data.purchaseConversion.changePct },
              { key: 'duration', label: data.avgSessionDuration.label, value: data.avgSessionDuration.formatted, changePct: data.avgSessionDuration.changePct },
            ]}
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

          {/* Store sections */}
          <SectionTitle>Store Section Performance</SectionTitle>
          <Card>
            {data.sections.map((sec, i) => (
              <View key={sec.sectionKey}>
                {i > 0 && <CardDivider />}
                <TouchableOpacity
                  onPress={() => { Haptics.selectionAsync(); router.push('/store-sections' as never); }}
                  style={s.secRow}
                  activeOpacity={0.8}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.secLabel}>{sec.label}</Text>
                    <View style={s.secMeta}>
                      <Text style={s.secStat}>{sec.views.toLocaleString()} views</Text>
                      <Text style={s.dotSep}>·</Text>
                      <Text style={s.secStat}>{sec.clicks.toLocaleString()} clicks</Text>
                      <Text style={s.dotSep}>·</Text>
                      <Text style={[s.secStat, { color: sec.ctr > 20 ? colors.success : sec.ctr > 10 ? colors.warning : colors.destructive }]}>{sec.ctr.toFixed(1)}% CTR</Text>
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
          </Card>
        </>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: SP.md },
  funnelStep:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm + 3, minHeight: COMP.minTouchTarget },
  funnelLeft:{ flex: 1, gap: 6 },
  funnelLabel:{ fontSize: FS.sm, fontFamily: FONT.medium, color: colors.foreground },
  funnelRight:{ alignItems: 'flex-end', marginLeft: SP.sm, minWidth: 60 },
  funnelCount:{ fontSize: FS.base, fontFamily: FONT.bold, color: colors.foreground },
  funnelDrop:{ fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  secRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm + 3, minHeight: COMP.minTouchTarget },
  secLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground, marginBottom: 4 },
  secMeta:  { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  secStat:  { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  dotSep:   { fontSize: FS.xs, color: colors.subtle },
  secPurchases:{ fontSize: FS.base, fontFamily: FONT.bold, color: colors.success },
  secPurchasesLabel:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
});
