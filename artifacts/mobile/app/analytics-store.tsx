/**
 * Store Analytics — Brandthread Seller App
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_DIM, PURPLE_LIGHT, SUCCESS, SUCCESS_DIM, ORANGE, RED, BLUE, GOLD,
  FONT, FS,
} from '@/lib/theme';
import { getStoreAnalytics, getFilterState } from '@/services/analyticsService';
import { StoreAnalytics, StoreFunnelStep, StoreSectionAnalytics, AnalyticsMetric, AnalyticsFilterState } from '@/services/analyticsTypes';

function KpiCard({ m, icon, color }: { m: AnalyticsMetric; icon: keyof typeof Feather.glyphMap; color: string }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const up = m.trend === 'up';
  return (
    <View style={s.kpiCard}>
      <View style={[s.kpiIconWrap, { backgroundColor: color + '22' }]}>
        <Feather name={icon} size={14} color={color} />
      </View>
      <Text style={s.kpiValue}>{m.formatted}</Text>
      <Text style={s.kpiLabel} numberOfLines={1}>{m.label}</Text>
      <Text style={[s.kpiChange, { color: m.trend === 'flat' ? MUTED : up ? SUCCESS : RED }]}>
        {(m.changePct ?? 0) > 0 ? '+' : ''}{m.changePct?.toFixed(1) ?? '—'}%
      </Text>
    </View>
  );
}

function FunnelStep({ step, isLast }: { step: StoreFunnelStep; isLast: boolean }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const pct = step.conversionPct;
  const barColor = pct >= 50 ? SUCCESS : pct >= 20 ? ORANGE : RED;

  return (
    <View style={s.funnelStep}>
      <View style={s.funnelLeft}>
        <Text style={s.funnelLabel}>{step.label}</Text>
        <View style={s.funnelBarWrap}>
          <View style={[s.funnelBarFill, { width: `${step.conversionPct}%`, backgroundColor: barColor }]} />
        </View>
      </View>
      <View style={s.funnelRight}>
        <Text style={s.funnelCount}>{step.count.toLocaleString()}</Text>
        {!isLast && (
          <Text style={[s.funnelDrop, { color: step.dropOffPct > 60 ? RED : step.dropOffPct > 30 ? ORANGE : MUTED }]}>
            ↓ {step.dropOffPct.toFixed(0)}% drop
          </Text>
        )}
      </View>
    </View>
  );
}

export default function AnalyticsStoreScreen() {
  const colors = useColors();
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = colors;
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

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
          <Text style={s.pageTitle}>Store Analytics</Text>
          <Text style={s.subtitle}>{filter?.dateRange.label ?? '30 days'}</Text>
        </View>
        <TouchableOpacity onPress={() => { Haptics.selectionAsync(); router.push('/store-builder' as never); }} style={[s.storeBtn, { backgroundColor: PURPLE_DIM, borderColor: PURPLE }]}>
          <Text style={[s.storeBtnText, { color: PURPLE_LIGHT }]}>Edit Store</Text>
        </TouchableOpacity>
      </View>

      {/* KPI grid */}
      <Text style={s.sectionTitle}>Traffic</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 10, flexDirection: 'row', paddingRight: 16 }}>
        {data && [
          { m: data.visitors,          icon: 'users'    as const, color: PURPLE },
          { m: data.uniqueVisitors,     icon: 'user'     as const, color: BLUE   },
          { m: data.sessions,           icon: 'activity' as const, color: CYAN },
          { m: data.productPageViews,   icon: 'eye'      as const, color: GOLD   },
          { m: data.returningVisitors,  icon: 'repeat'   as const, color: SUCCESS },
          { m: data.mobileTrafficPct,   icon: 'smartphone' as const, color: ORANGE },
        ].map(item => <KpiCard key={item.m.key} {...item} />)}
      </ScrollView>

      {/* Conversion KPIs */}
      <Text style={s.sectionTitle}>Conversion</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 10, flexDirection: 'row', paddingRight: 16 }}>
        {data && [
          { m: data.addToCartRate,      icon: 'shopping-cart' as const, color: PURPLE },
          { m: data.checkoutStartRate,  icon: 'credit-card'   as const, color: GOLD   },
          { m: data.purchaseConversion, icon: 'check-circle'  as const, color: SUCCESS },
          { m: data.avgSessionDuration, icon: 'clock'         as const, color: BLUE   },
        ].map(item => <KpiCard key={item.m.key} {...item} />)}
      </ScrollView>

      {/* Funnel */}
      <Text style={s.sectionTitle}>Conversion Funnel</Text>
      <View style={s.card}>
        {data?.funnel.map((step, i) => (
          <View key={step.label}>
            {i > 0 && <View style={s.divider} />}
            <FunnelStep step={step} isLast={i === (data.funnel.length - 1)} />
          </View>
        ))}
      </View>

      {/* Store sections */}
      <Text style={s.sectionTitle}>Store Section Performance</Text>
      <View style={s.card}>
        {data?.sections.map((sec, i) => (
          <TouchableOpacity
            key={sec.sectionKey}
            onPress={() => { Haptics.selectionAsync(); router.push('/store-sections' as never); }}
            style={[s.secRow, i > 0 && s.divider]}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.secLabel}>{sec.label}</Text>
              <View style={s.secMeta}>
                <Text style={s.secStat}>{sec.views.toLocaleString()} views</Text>
                <Text style={s.dotSep}>·</Text>
                <Text style={s.secStat}>{sec.clicks.toLocaleString()} clicks</Text>
                <Text style={s.dotSep}>·</Text>
                <Text style={[s.secStat, { color: sec.ctr > 20 ? SUCCESS : sec.ctr > 10 ? ORANGE : RED }]}>{sec.ctr.toFixed(1)}% CTR</Text>
              </View>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.secPurchases}>{sec.purchasesInfluenced}</Text>
              <Text style={s.secPurchasesLabel}>purchases</Text>
            </View>
            <Feather name="chevron-right" size={14} color={SUBTLE} style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => {
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT } = colors;
  return StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: 16 },
  loadWrap: { flex: 1, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  header:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  pageTitle:{ fontSize: 22, fontFamily: FONT.bold, color: FG },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, color: MUTED },
  storeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  storeBtnText:{ fontSize: 12, fontFamily: FONT.semibold },
  sectionTitle:{ fontSize: 15, fontFamily: FONT.semibold, color: FG, marginBottom: 10 },
  card:     { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 20, overflow: 'hidden' },
  divider:  { height: 1, backgroundColor: BORDER, marginHorizontal: 16 },
  kpiCard:  { width: 110, backgroundColor: CARD, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BORDER, gap: 4 },
  kpiIconWrap:{ width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  kpiValue: { fontSize: 18, fontFamily: FONT.bold, color: FG },
  kpiLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  kpiChange:{ fontSize: FS.xs, fontFamily: FONT.medium },
  funnelStep:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  funnelLeft:{ flex: 1, gap: 6 },
  funnelLabel:{ fontSize: 13, fontFamily: FONT.medium, color: FG },
  funnelBarWrap:{ height: 6, backgroundColor: BORDER, borderRadius: 3, overflow: 'hidden' },
  funnelBarFill:{ height: '100%', borderRadius: 3 },
  funnelRight:{ alignItems: 'flex-end', marginLeft: 12, minWidth: 60 },
  funnelCount:{ fontSize: 15, fontFamily: FONT.bold, color: FG },
  funnelDrop:{ fontSize: 11, fontFamily: FONT.regular, marginTop: 2 },
  secRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  secLabel: { fontSize: 13, fontFamily: FONT.semibold, color: FG, marginBottom: 4 },
  secMeta:  { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  secStat:  { fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  dotSep:   { fontSize: 11, color: SUBTLE },
  secPurchases:{ fontSize: 15, fontFamily: FONT.bold, color: SUCCESS },
  secPurchasesLabel:{ fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  });
};
