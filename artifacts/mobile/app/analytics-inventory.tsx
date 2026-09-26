/**
 * Inventory Analytics — Brandthread Seller App
 *
 * Mobbin reference: eBay "Performance" alert-tile-then-filterable-list layout
 * (https://mobbin.com/screens/14328f90-76c9-44b6-8675-f0c534c2fba7) informed the
 * status alert row, KPI grid and filterable product list here.
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
import { getInventoryAnalytics, getFilterState } from '@/services/analyticsService';
import { InventoryAnalytics, InventoryProductRow, AnalyticsFilterState } from '@/services/analyticsTypes';
import { EmptyState } from '@/components/BrandthreadUI';
import {
  AnalyticsHeader, AnalyticsSkeleton, Card, CardDivider, HeaderPillButton,
  PillTabs, ProgressBar, SectionTitle,
} from '@/components/analytics/AnalyticsKit';

function statusColor(colors: ReturnType<typeof useColors>, status: InventoryProductRow['status']): string {
  switch (status) {
    case 'healthy':   return colors.success;
    case 'low':       return colors.warning;
    case 'out':       return colors.destructive;
    case 'overstock': return colors.info;
  }
}
function statusLabel(status: InventoryProductRow['status']): string {
  switch (status) {
    case 'healthy':   return 'Healthy';
    case 'low':       return 'Low Stock';
    case 'out':       return 'Out of Stock';
    case 'overstock': return 'Overstock';
  }
}

function InventoryRow({ p }: { p: InventoryProductRow }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const color = statusColor(colors, p.status);
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
          <Text style={[s.prodStat, p.daysOfStockLeft > 0 && p.daysOfStockLeft <= 7 ? { color: colors.destructive } : null]}>
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
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [data,       setData]       = useState<InventoryAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeList, setActiveList] = useState<'runout' | 'fastest' | 'slowest' | 'overstock'>('runout');
  const requestUser = useRef<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!authLoaded || !userId) return;
    const requestedUser = userId;
    requestUser.current = requestedUser;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const next = await getInventoryAnalytics(f);
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

  const listData: InventoryProductRow[] = data
    ? (activeList === 'fastest' ? data.fastestSelling : activeList === 'slowest' ? data.slowestSelling : activeList === 'overstock' ? data.mostOverstocked : data.likelyRunOut)
    : [];

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
        title="Inventory Analytics"
        subtitle={filter?.dateRange.label ?? '30 days'}
        right={<HeaderPillButton label="Inventory" onPress={() => router.push('/inventory' as never)} />}
      />

      {!data ? (
        <EmptyState
          icon="archive"
          title="Inventory insights are on the way"
          description="We'll show stock levels once your inventory syncs."
          style={{ marginTop: SP.lg }}
        />
      ) : (
        <>
          {/* Alert cards */}
          <View style={s.alertRow}>
            {data.outOfStockCount.value > 0 && (
              <View style={[s.alertCard, { borderColor: colors.destructive + '44' }]}>
                <Feather name="x-circle" size={16} color={colors.destructive} />
                <Text style={[s.alertValue, { color: colors.destructive }]}>{data.outOfStockCount.value}</Text>
                <Text style={s.alertLabel}>Out of Stock</Text>
              </View>
            )}
            {data.lowStockCount.value > 0 && (
              <View style={[s.alertCard, { borderColor: colors.warning + '44' }]}>
                <Feather name="alert-triangle" size={16} color={colors.warning} />
                <Text style={[s.alertValue, { color: colors.warning }]}>{data.lowStockCount.value}</Text>
                <Text style={s.alertLabel}>Low Stock</Text>
              </View>
            )}
            <View style={[s.alertCard, { borderColor: colors.primary + '44' }]}>
              <Feather name="archive" size={16} color={colors.primary} />
              <Text style={[s.alertValue, { color: colors.primary }]}>{data.inventoryValue.formatted}</Text>
              <Text style={s.alertLabel}>Inv. Value</Text>
            </View>
          </View>

          {/* KPI grid */}
          <SectionTitle>Inventory Health</SectionTitle>
          <View style={s.kpiGrid}>
            {[
              { m: data.unitsOnHand,       color: colors.foreground },
              { m: data.unitsAvailable,    color: colors.success },
              { m: data.unitsReserved,     color: colors.warning },
              { m: data.unitsIncoming,     color: colors.info },
              { m: data.sellThroughRate,   color: colors.primary },
              { m: data.inventoryTurnover, color: colors.warning },
            ].map(item => (
              <View key={item.m.key} style={s.kpiCard}>
                <Text style={[s.kpiValue, { color: item.color }]}>{item.m.formatted}</Text>
                <Text style={s.kpiLabel} numberOfLines={1}>{item.m.label}</Text>
              </View>
            ))}
          </View>

          {/* Sell-through rate */}
          <SectionTitle>Sell-Through Rate</SectionTitle>
          <Card padded>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.xs }}>
              <Text style={s.sellThroughLabel}>Overall sell-through</Text>
              <Text style={[s.sellThroughValue, { color: colors.success }]}>{data.sellThroughRate.formatted}</Text>
            </View>
            <ProgressBar pct={data.sellThroughRate.value} color={colors.success} height={10} />
            <Text style={s.sellThroughNote}>Avg {data.avgDaysOfStock.formatted} of stock remaining</Text>
          </Card>

          {/* Product lists */}
          <PillTabs
            options={[
              { key: 'runout', label: 'Likely Run Out' },
              { key: 'fastest', label: 'Fastest' },
              { key: 'slowest', label: 'Slowest' },
              { key: 'overstock', label: 'Overstock' },
            ] as const}
            value={activeList}
            onChange={setActiveList}
          />

          {listData.length === 0 ? (
            <EmptyState
              icon="archive"
              title="No inventory data"
              description="Inventory insights will appear after products and stock are added."
            />
          ) : (
            <Card>
              {listData.map((p, i) => (
                <View key={p.productId}>
                  {i > 0 && <CardDivider />}
                  <InventoryRow p={p} />
                </View>
              ))}
            </Card>
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
  alertRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.lg, flexWrap: 'wrap' },
  alertCard:{ flex: 1, minWidth: 90, backgroundColor: colors.card, borderRadius: RADIUS.md, padding: SP.sm + 2, borderWidth: 1, alignItems: 'center', gap: 4 },
  alertValue:{ fontSize: 20, fontFamily: FONT.bold },
  alertLabel:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center' },
  kpiGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.lg },
  kpiCard:  { width: '30%', minWidth: 90, backgroundColor: colors.card, borderRadius: RADIUS.sm, padding: SP.sm, borderWidth: 1, borderColor: colors.border, gap: 4 },
  kpiValue: { fontSize: FS.lg, fontFamily: FONT.bold },
  kpiLabel: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  sellThroughLabel:{ fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  sellThroughValue:{ fontSize: FS.base, fontFamily: FONT.bold },
  sellThroughNote:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle, marginTop: SP.xs + 2 },
  prodRow:  { flexDirection: 'row', alignItems: 'center', minHeight: COMP.minTouchTarget, paddingHorizontal: SP.sm + 2, paddingVertical: SP.sm, gap: SP.sm },
  prodIcon: { width: 32, height: 32, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  prodName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground, marginBottom: 3 },
  prodMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  prodStat: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  dotSep:   { fontSize: FS.xs, color: colors.subtle },
  statusBadge:{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill, borderWidth: 1 },
  statusText:{ fontSize: FS.xs, fontFamily: FONT.medium },
});
