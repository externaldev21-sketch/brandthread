/**
 * Product Analytics — Brandthread Seller App
 *
 * Mobbin reference: eBay "Performance" listing-stat tiles + ranked list
 * (https://mobbin.com/screens/14328f90-76c9-44b6-8675-f0c534c2fba7) informed
 * the compact KPI tiles above a ranked, status-badged product list.
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
import { getProductAnalytics, getFilterState } from '@/services/analyticsService';
import { formatCents } from '@/lib/money';
import { ProductAnalytics, ProductAnalyticsRow, AnalyticsFilterState } from '@/services/analyticsTypes';
import { EmptyState } from '@/components/BrandthreadUI';
import {
  AnalyticsHeader, AnalyticsSkeleton, Card, CardDivider, PillTabs, SectionTitle, StatTileRow,
} from '@/components/analytics/AnalyticsKit';

type SortKey = 'topByRevenue' | 'topByUnits';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'topByRevenue', label: 'Revenue' },
  { key: 'topByUnits',   label: 'Units' },
];

function statusColor(colors: ReturnType<typeof useColors>, status: ProductAnalyticsRow['inventoryStatus']): string {
  switch (status) {
    case 'in_stock':    return colors.success;
    case 'low':         return colors.warning;
    case 'out_of_stock':return colors.destructive;
    default:            return colors.mutedForeground;
  }
}
function statusLabel(status: ProductAnalyticsRow['inventoryStatus']): string {
  switch (status) {
    case 'in_stock':    return 'In Stock';
    case 'low':         return 'Low Stock';
    case 'out_of_stock':return 'Out of Stock';
    default:            return '—';
  }
}

function ProductRow({ p, rank }: { p: ProductAnalyticsRow; rank: number }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const color = statusColor(colors, p.inventoryStatus);
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); router.push(`/product-detail?id=${p.productId}` as never); }}
      style={s.prodRow}
      activeOpacity={0.8}
    >
      <View style={s.rankBadge}><Text style={s.rankText}>{rank}</Text></View>
      <View style={s.prodThumb}>
        <Feather name="package" size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.prodName} numberOfLines={1}>{p.name}</Text>
        <View style={s.prodMeta}>
          <Text style={s.prodStat}>{formatCents(p.revenueCents)}</Text>
          <Text style={s.dotSep}>·</Text>
          <Text style={s.prodStat}>{p.unitsSold} units</Text>
          {typeof p.conversionRate === 'number' && (
            <>
              <Text style={s.dotSep}>·</Text>
              <Text style={s.prodStat}>{p.conversionRate.toFixed(1)}% conv.</Text>
            </>
          )}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View style={[s.statusDot, { backgroundColor: color + '22', borderColor: color }]}>
          <Text style={[s.statusText, { color }]}>{statusLabel(p.inventoryStatus)}</Text>
        </View>
        {typeof p.refundRate === 'number' && p.refundRate > 3 && (
          <View style={s.refundWarn}>
            <Feather name="alert-triangle" size={10} color={colors.destructive} />
            <Text style={s.refundWarnText}>{p.refundRate.toFixed(1)}% refunds</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function AnalyticsProductsScreen() {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = insets.top;

  const [data,       setData]       = useState<ProductAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey,    setSortKey]    = useState<SortKey>('topByRevenue');
  const requestUser = useRef<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!authLoaded || !userId) return;
    const requestedUser = userId;
    requestUser.current = requestedUser;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const next = await getProductAnalytics(f);
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

  const rows: ProductAnalyticsRow[] = data?.[sortKey] ?? [];

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
      <AnalyticsHeader title="Product Analytics" subtitle="All time" />

      <PillTabs options={SORT_OPTIONS} value={sortKey} onChange={setSortKey} />

      <StatTileRow
        items={[
          { key: 'count', label: 'Products', value: String(rows.length) },
          { key: 'rev', label: 'Total Revenue', value: formatCents(rows.reduce((a, b) => a + b.revenueCents, 0)) },
          { key: 'units', label: 'Total Units', value: rows.reduce((a, b) => a + b.unitsSold, 0).toLocaleString() },
        ]}
      />

      <SectionTitle>{SORT_OPTIONS.find(o => o.key === sortKey)?.label}</SectionTitle>
      {rows.length === 0 ? (
        <EmptyState
          icon="package"
          title="No product data"
          description="Product performance will appear after products receive views or orders."
        />
      ) : (
        <Card>
          {rows.map((p, i) => (
            <View key={p.productId}>
              {i > 0 && <CardDivider />}
              <ProductRow p={p} rank={i + 1} />
            </View>
          ))}
        </Card>
      )}
      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: SP.md },
  prodRow:  { flexDirection: 'row', alignItems: 'center', minHeight: COMP.minTouchTarget, paddingHorizontal: SP.sm + 2, paddingVertical: SP.sm, gap: SP.sm },
  rankBadge:{ width: 22, height: 22, borderRadius: RADIUS.xs, backgroundColor: colors.elevated, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: FS.xs, fontFamily: FONT.bold, color: colors.mutedForeground },
  prodThumb:{ width: 40, height: 40, borderRadius: RADIUS.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  prodName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground, marginBottom: 3 },
  prodMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  prodStat: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  dotSep:   { fontSize: FS.xs, color: colors.subtle },
  statusDot:{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: RADIUS.pill, borderWidth: 1 },
  statusText:{ fontSize: FS.xs, fontFamily: FONT.medium },
  refundWarn:{ flexDirection: 'row', alignItems: 'center', gap: 3 },
  refundWarnText:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.destructive },
});
