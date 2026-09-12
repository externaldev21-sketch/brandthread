/**
 * Inventory Analytics — Brandthread Seller App
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useColors } from '@/hooks/useColors';
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
import { getInventoryAnalytics, getFilterState } from '@/services/analyticsService';
import { InventoryAnalytics, InventoryProductRow, AnalyticsMetric, AnalyticsFilterState } from '@/services/analyticsTypes';

function statusColor(status: InventoryProductRow['status']): string {
  switch (status) { case 'healthy': return SUCCESS; case 'low': return ORANGE; case 'out': return RED; case 'overstock': return BLUE; }
}
function statusLabel(status: InventoryProductRow['status']): string {
  switch (status) { case 'healthy': return 'Healthy'; case 'low': return 'Low Stock'; case 'out': return 'Out of Stock'; case 'overstock': return 'Overstock'; }
}

function InventoryProductRow2({ p }: { p: InventoryProductRow }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const color = statusColor(p.status);
  const urgent = p.status === 'out' || (p.status === 'low' && p.daysOfStockLeft <= 7);
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); router.push(`/inventory-detail?id=${p.productId}` as never); }}
      style={s.prodRow}
      activeOpacity={0.8}
    >
      <View style={[s.prodIcon, { backgroundColor: color + '22' }]}>
        <Feather name={urgent ? 'alert-triangle' : 'package'} size={14} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.prodName} numberOfLines={1}>{p.name}</Text>
        <View style={s.prodMeta}>
          <Text style={s.prodStat}>{p.unitsOnHand} on hand</Text>
          <Text style={s.dotSep}>·</Text>
          <Text style={[s.prodStat, p.daysOfStockLeft > 0 && p.daysOfStockLeft <= 7 ? { color: RED } : {}]}>
            {p.daysOfStockLeft > 0 ? `${p.daysOfStockLeft}d remaining` : 'Out of stock'}
          </Text>
          <Text style={s.dotSep}>·</Text>
          <Text style={s.prodStat}>{p.sellThroughRate}% sell-through</Text>
        </View>
      </View>
      <View style={[s.statusBadge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
        <Text style={[s.statusText, { color }]}>{statusLabel(p.status)}</Text>
      </View>
    </TouchableOpacity>
  );
}

export default function AnalyticsInventoryScreen() {
  const colors = useColors();
  const { primary: PURPLE, accent: PURPLE_DIM, accentForeground: PURPLE_LIGHT, info: CYAN } = colors;
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [data,       setData]       = useState<InventoryAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeList, setActiveList] = useState<'fastest' | 'slowest' | 'overstock' | 'runout'>('runout');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      setData(await getInventoryAnalytics(f)); setError(null);
    } catch (err) {
      setData(null); setError(err instanceof Error ? err.message : 'Inventory analytics are unavailable.');
    } finally { setLoading(false); setRefreshing(false); }
  }, [filter]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  const listData: InventoryProductRow[] = data
    ? (activeList === 'fastest' ? data.fastestSelling : activeList === 'slowest' ? data.slowestSelling : activeList === 'overstock' ? data.mostOverstocked : data.likelyRunOut)
    : [];

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
          <Text style={s.pageTitle}>Inventory Analytics</Text>
          <Text style={s.subtitle}>{filter?.dateRange.label ?? '30 days'}</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/inventory' as never)} style={[s.invBtn, { backgroundColor: PURPLE_DIM, borderColor: PURPLE }]}>
          <Text style={[s.invBtnText, { color: PURPLE_LIGHT }]}>Inventory</Text>
        </TouchableOpacity>
      </View>

      {/* Alert cards */}
      <View style={s.alertRow}>
        {data && data.outOfStockCount.value > 0 && (
          <View style={[s.alertCard, { borderColor: RED + '44' }]}>
            <Feather name="x-circle" size={16} color={RED} />
            <Text style={[s.alertValue, { color: RED }]}>{data.outOfStockCount.value}</Text>
            <Text style={s.alertLabel}>Out of Stock</Text>
          </View>
        )}
        {data && data.lowStockCount.value > 0 && (
          <View style={[s.alertCard, { borderColor: ORANGE + '44' }]}>
            <Feather name="alert-triangle" size={16} color={ORANGE} />
            <Text style={[s.alertValue, { color: ORANGE }]}>{data.lowStockCount.value}</Text>
            <Text style={s.alertLabel}>Low Stock</Text>
          </View>
        )}
        <View style={[s.alertCard, { borderColor: PURPLE + '44' }]}>
          <Feather name="archive" size={16} color={PURPLE} />
          <Text style={[s.alertValue, { color: PURPLE }]}>{data?.inventoryValue.formatted ?? '—'}</Text>
          <Text style={s.alertLabel}>Inv. Value</Text>
        </View>
      </View>

      {/* KPI grid */}
      <Text style={s.sectionTitle}>Inventory Health</Text>
      <View style={s.kpiGrid}>
        {data && [
          { m: data.unitsOnHand,       color: FG     },
          { m: data.unitsAvailable,    color: SUCCESS },
          { m: data.unitsReserved,     color: ORANGE  },
          { m: data.unitsIncoming,     color: BLUE    },
          { m: data.sellThroughRate,   color: PURPLE  },
          { m: data.inventoryTurnover, color: GOLD    },
        ].map(item => (
          <View key={item.m.key} style={s.kpiCard}>
            <Text style={[s.kpiValue, { color: item.color }]}>{item.m.formatted}</Text>
            <Text style={s.kpiLabel} numberOfLines={1}>{item.m.label}</Text>
          </View>
        ))}
      </View>

      {/* Sell-through rate */}
      <Text style={s.sectionTitle}>Sell-Through Rate</Text>
      <View style={[s.card, { padding: 16 }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ fontSize: 13, fontFamily: FONT.regular, color: MUTED }}>Overall sell-through</Text>
          <Text style={{ fontSize: 14, fontFamily: FONT.bold, color: SUCCESS }}>{data?.sellThroughRate.formatted}</Text>
        </View>
        <View style={{ height: 10, backgroundColor: BORDER, borderRadius: 5, overflow: 'hidden' }}>
          <View style={{ width: `${data?.sellThroughRate.value ?? 0}%`, height: '100%', backgroundColor: SUCCESS, borderRadius: 5 }} />
        </View>
        <Text style={{ fontSize: 11, fontFamily: FONT.regular, color: SUBTLE, marginTop: 6 }}>
          Avg {data?.avgDaysOfStock.formatted ?? '—'} of stock remaining
        </Text>
      </View>

      {/* Product lists */}
      <View style={s.tabRow}>
        {([['runout','Likely Run Out'],['fastest','Fastest'],['slowest','Slowest'],['overstock','Overstock']] as const).map(([k, l]) => (
          <TouchableOpacity key={k} onPress={() => { Haptics.selectionAsync(); setActiveList(k); }} style={[s.tabBtn, activeList === k && s.tabBtnActive, activeList === k && { backgroundColor: PURPLE_DIM, borderColor: PURPLE }]}>
            <Text style={[s.tabBtnText, activeList === k && s.tabBtnTextActive, activeList === k && { color: PURPLE_LIGHT }]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {listData.length === 0 ? (
        <View style={s.emptyState}>
          <Feather name="archive" size={36} color={MUTED} />
          <Text style={s.emptyTitle}>No inventory data</Text>
          <Text style={s.emptyBody}>Inventory insights will appear after products and stock are added.</Text>
        </View>
      ) : (
        <View style={s.card}>
          {listData.map((p, i) => (
            <View key={p.productId}>
              {i > 0 && <View style={s.divider} />}
              <InventoryProductRow2 p={p} />
            </View>
          ))}
        </View>
      )}

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
  invBtn:   { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  invBtnText:{ fontSize: 12, fontFamily: FONT.semibold },
  alertRow: { flexDirection: 'row', gap: 10, marginBottom: 20, flexWrap: 'wrap' },
  alertCard:{ flex: 1, minWidth: 90, backgroundColor: CARD, borderRadius: 14, padding: 14, borderWidth: 1, alignItems: 'center', gap: 4 },
  alertValue:{ fontSize: 20, fontFamily: FONT.bold },
  alertLabel:{ fontSize: 11, fontFamily: FONT.regular, color: MUTED, textAlign: 'center' },
  sectionTitle:{ fontSize: 15, fontFamily: FONT.semibold, color: FG, marginBottom: 10 },
  kpiGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  kpiCard:  { width: '30%', minWidth: 90, backgroundColor: CARD, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: BORDER, gap: 4 },
  kpiValue: { fontSize: 17, fontFamily: FONT.bold },
  kpiLabel: { fontSize: 10, fontFamily: FONT.regular, color: MUTED },
  card:     { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 20, overflow: 'hidden' },
  divider:  { height: 1, backgroundColor: BORDER, marginHorizontal: 16 },
  tabRow:   { flexDirection: 'row', gap: 6, marginBottom: 12, flexWrap: 'wrap' },
  tabBtn:   { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  tabBtnActive:{},
  tabBtnText:{ fontSize: 12, fontFamily: FONT.medium, color: MUTED },
  tabBtnTextActive:{},
  prodRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  prodIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  prodName: { fontSize: 13, fontFamily: FONT.semibold, color: FG, marginBottom: 3 },
  prodMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  prodStat: { fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  dotSep:   { fontSize: 11, color: SUBTLE },
  statusBadge:{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  statusText:{ fontSize: 10, fontFamily: FONT.medium },
  emptyState:{ alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyTitle:{ fontSize: 16, fontFamily: FONT.semibold, color: FG },
  emptyBody:{ fontSize: 13, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', paddingHorizontal: 24 },
  });
};
