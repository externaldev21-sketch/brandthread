import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionHeader } from '@/components/SectionHeader';
import { Badge } from '@/components/Badge';
import { Feather } from '@expo/vector-icons';

const PERIODS = ['7D', '30D', '90D', '1Y'] as const;
type Period = typeof PERIODS[number];

const REVENUE_BARS = [62, 80, 55, 90, 70, 85, 95, 60, 78, 88, 72, 100, 68, 83];

const TOP_PRODUCTS = [
  { name: 'Classic Thread Tee', revenue: '$12,400', units: 298, trend: 'up' },
  { name: 'Drop-Shoulder Blazer', revenue: '$9,180', units: 51, trend: 'up' },
  { name: 'Oversized Hoodie', revenue: '$7,820', units: 68, trend: 'down' },
  { name: 'Wide-Leg Trousers', revenue: '$6,506', units: 66, trend: 'up' },
  { name: 'Logo Cap', revenue: '$3,960', units: 110, trend: 'up' },
];

const METRICS = [
  { label: 'Conversion Rate', value: '3.4%', change: '+0.6%', up: true, icon: 'trending-up' as const },
  { label: 'Avg. Order Value', value: '$128', change: '+$12', up: true, icon: 'dollar-sign' as const },
  { label: 'Returning Rate', value: '42%', change: '+4%', up: true, icon: 'refresh-cw' as const },
  { label: 'CLV', value: '$480', change: '+$30', up: true, icon: 'heart' as const },
];

export default function AnalyticsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<Period>('30D');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad + 120, paddingHorizontal: 16 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Text style={[styles.pageTitle, { color: colors.foreground }]}>Analytics</Text>
      <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>Track your brand's performance</Text>

      {/* Period Selector */}
      <View style={[styles.periodRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p}
            onPress={() => setPeriod(p)}
            activeOpacity={0.7}
            style={[styles.periodBtn, { backgroundColor: period === p ? colors.primary : 'transparent' }]}
          >
            <Text style={[styles.periodText, { color: period === p ? colors.primaryForeground : colors.mutedForeground }]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Revenue Chart */}
      <View style={[styles.chartCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.chartHeader}>
          <View>
            <Text style={[styles.chartTitle, { color: colors.mutedForeground }]}>Total Revenue</Text>
            <Text style={[styles.chartAmount, { color: colors.foreground }]}>$94,200</Text>
          </View>
          <Badge label="↑ 24.1%" variant="success" />
        </View>
        <View style={styles.barsRow}>
          {REVENUE_BARS.map((h, i) => (
            <View key={i} style={styles.barWrap}>
              <View
                style={[
                  styles.bar,
                  {
                    height: (h / 100) * 100,
                    backgroundColor: i === REVENUE_BARS.length - 1 ? colors.primary : colors.border,
                  },
                ]}
              />
            </View>
          ))}
        </View>
        <View style={styles.chartLabels}>
          <Text style={[styles.chartLabel, { color: colors.mutedForeground }]}>14 days ago</Text>
          <Text style={[styles.chartLabel, { color: colors.mutedForeground }]}>Today</Text>
        </View>
      </View>

      {/* Key Metrics */}
      <SectionHeader title="Key Metrics" />
      <View style={styles.metricsGrid}>
        {METRICS.map((m) => (
          <View key={m.label} style={[styles.metricCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name={m.icon} size={16} color={colors.primary} />
            <Text style={[styles.metricValue, { color: colors.foreground }]}>{m.value}</Text>
            <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{m.label}</Text>
            <Text style={[styles.metricChange, { color: m.up ? colors.success : colors.destructive }]}>{m.change}</Text>
          </View>
        ))}
      </View>

      {/* Top Products */}
      <SectionHeader title="Top Products" />
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {TOP_PRODUCTS.map((p, i) => (
          <View key={p.name} style={[styles.productRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.rank, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.rankText, { color: colors.mutedForeground }]}>{i + 1}</Text>
            </View>
            <View style={styles.productInfo}>
              <Text style={[styles.productName, { color: colors.foreground }]} numberOfLines={1}>{p.name}</Text>
              <Text style={[styles.productUnits, { color: colors.mutedForeground }]}>{p.units} units sold</Text>
            </View>
            <View style={styles.productRight}>
              <Text style={[styles.productRevenue, { color: colors.foreground }]}>{p.revenue}</Text>
              <Feather name={p.trend === 'up' ? 'trending-up' : 'trending-down'} size={14} color={p.trend === 'up' ? colors.success : colors.destructive} />
            </View>
          </View>
        ))}
      </View>

      {/* Funnel */}
      <SectionHeader title="Sales Funnel" />
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          { label: 'Store Visitors', value: 18400, pct: 100 },
          { label: 'Product Views', value: 9200, pct: 50 },
          { label: 'Added to Cart', value: 2300, pct: 12.5 },
          { label: 'Checkout', value: 840, pct: 4.6 },
          { label: 'Purchased', value: 627, pct: 3.4 },
        ].map((step, i) => (
          <View key={step.label} style={[styles.funnelRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={styles.funnelLeft}>
              <Text style={[styles.funnelLabel, { color: colors.foreground }]}>{step.label}</Text>
              <View style={[styles.funnelBar, { backgroundColor: colors.secondary }]}>
                <View style={[styles.funnelFill, { width: `${step.pct}%`, backgroundColor: colors.primary }]} />
              </View>
            </View>
            <Text style={[styles.funnelValue, { color: colors.mutedForeground }]}>{step.value.toLocaleString()}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  pageTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  periodRow: { flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3, marginBottom: 20 },
  periodBtn: { flex: 1, paddingVertical: 6, borderRadius: 8, alignItems: 'center' },
  periodText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  chartCard: { borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 24 },
  chartHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  chartTitle: { fontSize: 12, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.8 },
  chartAmount: { fontSize: 32, fontFamily: 'Inter_700Bold', marginTop: 4 },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', height: 100, gap: 4 },
  barWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: 100 },
  bar: { width: '100%', borderRadius: 4, minHeight: 4 },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  chartLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  metricCard: { width: '47.5%', borderRadius: 12, padding: 14, borderWidth: 1, gap: 3 },
  metricValue: { fontSize: 22, fontFamily: 'Inter_700Bold', marginTop: 4 },
  metricLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  metricChange: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  productRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  rank: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  productInfo: { flex: 1 },
  productName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  productUnits: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  productRight: { alignItems: 'flex-end', gap: 3 },
  productRevenue: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  funnelRow: { padding: 14, gap: 6 },
  funnelLeft: { gap: 6 },
  funnelLabel: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  funnelBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  funnelFill: { height: '100%', borderRadius: 3 },
  funnelValue: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});
