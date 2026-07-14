/**
 * Product Analytics — Brandthread Seller App
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_DIM, PURPLE_LIGHT, SUCCESS, SUCCESS_DIM, RED, RED_DIM, ORANGE, ORANGE_DIM,
  FONT, FS,
} from '@/lib/theme';
import { getProductAnalytics, getFilterState } from '@/services/analyticsService';
import { ProductAnalytics, ProductAnalyticsRow, AnalyticsFilterState } from '@/services/analyticsTypes';

type SortKey = 'topByRevenue' | 'topByUnits' | 'topByProfit' | 'mostViewed' | 'highestConversion' | 'lowestConversion' | 'mostReturned' | 'lowPerforming';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'topByRevenue',      label: 'Revenue'      },
  { key: 'topByUnits',        label: 'Units'        },
  { key: 'topByProfit',       label: 'Profit'       },
  { key: 'mostViewed',        label: 'Most Viewed'  },
  { key: 'highestConversion', label: 'Conversion ↑' },
  { key: 'lowestConversion',  label: 'Conversion ↓' },
  { key: 'mostReturned',      label: 'Returns'      },
  { key: 'lowPerforming',     label: 'Low Perf.'    },
];

function statusColor(status: ProductAnalyticsRow['inventoryStatus']): string {
  switch (status) {
    case 'in_stock':    return SUCCESS;
    case 'low':         return ORANGE;
    case 'out_of_stock':return RED;
    default:            return MUTED;
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
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); router.push(`/product-detail?id=${p.productId}` as never); }}
      style={s.prodRow}
      activeOpacity={0.8}
    >
      <View style={s.rankBadge}><Text style={s.rankText}>{rank}</Text></View>
      <View style={s.prodThumb}>
        <Feather name="package" size={18} color={PURPLE} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.prodName} numberOfLines={1}>{p.name}</Text>
        <View style={s.prodMeta}>
          <Text style={s.prodStat}>${p.revenue.toLocaleString()}</Text>
          <Text style={s.dotSep}>·</Text>
          <Text style={s.prodStat}>{p.unitsSold} units</Text>
          <Text style={s.dotSep}>·</Text>
          <Text style={s.prodStat}>{p.conversionRate.toFixed(1)}% conv.</Text>
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <View style={[s.statusDot, { backgroundColor: statusColor(p.inventoryStatus) + '22', borderColor: statusColor(p.inventoryStatus) }]}>
          <Text style={[s.statusText, { color: statusColor(p.inventoryStatus) }]}>{statusLabel(p.inventoryStatus)}</Text>
        </View>
        {p.refundRate > 3 && (
          <View style={s.refundWarn}>
            <Feather name="alert-triangle" size={10} color={RED} />
            <Text style={s.refundWarnText}>{p.refundRate.toFixed(1)}% refunds</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function AnalyticsProductsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [data,       setData]       = useState<ProductAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortKey,    setSortKey]    = useState<SortKey>('topByRevenue');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const f = filter ?? await getFilterState();
    if (!filter) setFilter(f);
    const d = await getProductAnalytics(f);
    setData(d);
    setLoading(false); setRefreshing(false);
  }, [filter]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  const rows: ProductAnalyticsRow[] = data?.[sortKey] ?? [];

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
          <Text style={s.pageTitle}>Product Analytics</Text>
          <Text style={s.subtitle}>{filter?.dateRange.label ?? '30 days'}</Text>
        </View>
      </View>

      {/* Sort pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 8, flexDirection: 'row', paddingRight: 16 }}>
        {SORT_OPTIONS.map(opt => (
          <TouchableOpacity
            key={opt.key}
            onPress={() => { Haptics.selectionAsync(); setSortKey(opt.key); }}
            style={[s.pill, sortKey === opt.key && s.pillActive]}
          >
            <Text style={[s.pillText, sortKey === opt.key && s.pillTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Summary stats */}
      <View style={s.summaryRow}>
        {[
          { label: 'Products', value: rows.length },
          { label: 'Total Revenue', value: `$${rows.reduce((a,b) => a + b.revenue, 0).toLocaleString()}` },
          { label: 'Total Units', value: rows.reduce((a,b) => a + b.unitsSold, 0).toLocaleString() },
        ].map((item, i) => (
          <View key={i} style={s.summaryCard}>
            <Text style={s.summaryValue}>{item.value}</Text>
            <Text style={s.summaryLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* Product list */}
      <Text style={s.sectionTitle}>{SORT_OPTIONS.find(o => o.key === sortKey)?.label}</Text>
      {rows.length === 0 ? (
        <View style={s.emptyState}>
          <Feather name="package" size={36} color={MUTED} />
          <Text style={s.emptyTitle}>No product data</Text>
          <Text style={s.emptyBody}>Product performance will appear after products receive views or orders.</Text>
        </View>
      ) : (
        <View style={s.card}>
          {rows.map((p, i) => (
            <View key={p.productId}>
              {i > 0 && <View style={s.divider} />}
              <ProductRow p={p} rank={i + 1} />
            </View>
          ))}
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
  header:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  backBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  pageTitle:{ fontSize: 22, fontFamily: FONT.bold, color: FG },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, color: MUTED },
  pill:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  pillActive:{ backgroundColor: PURPLE, borderColor: PURPLE },
  pillText: { fontSize: 12, fontFamily: FONT.medium, color: MUTED },
  pillTextActive:{ color: '#FFF' },
  summaryRow:{ flexDirection: 'row', gap: 10, marginBottom: 20 },
  summaryCard:{ flex: 1, backgroundColor: CARD, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  summaryValue:{ fontSize: 17, fontFamily: FONT.bold, color: FG },
  summaryLabel:{ fontSize: 10, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  sectionTitle:{ fontSize: 15, fontFamily: FONT.semibold, color: FG, marginBottom: 10 },
  card:     { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 20, overflow: 'hidden' },
  divider:  { height: 1, backgroundColor: BORDER, marginHorizontal: 16 },
  prodRow:  { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 10 },
  rankBadge:{ width: 22, height: 22, borderRadius: 6, backgroundColor: CARD_ELEVATED, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 11, fontFamily: FONT.bold, color: MUTED },
  prodThumb:{ width: 40, height: 40, borderRadius: 10, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  prodName: { fontSize: 13, fontFamily: FONT.semibold, color: FG, marginBottom: 3 },
  prodMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  prodStat: { fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  dotSep:   { fontSize: 11, color: SUBTLE },
  statusDot:{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20, borderWidth: 1 },
  statusText:{ fontSize: 10, fontFamily: FONT.medium },
  refundWarn:{ flexDirection: 'row', alignItems: 'center', gap: 3 },
  refundWarnText:{ fontSize: 10, fontFamily: FONT.regular, color: RED },
  emptyState:{ alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyTitle:{ fontSize: 16, fontFamily: FONT.semibold, color: FG },
  emptyBody:{ fontSize: 13, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', paddingHorizontal: 24 },
});
