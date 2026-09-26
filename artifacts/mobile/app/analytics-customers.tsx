/**
 * Customer Analytics — Brandthread Seller App
 *
 * Mobbin reference: Stripe Dashboard "Home" (Gross Volume / Payments /
 * Customers stat row) (https://mobbin.com/screens/f972bbd5-699d-42c3-942e-1cf9f3d25eda)
 * informed the KPI-list-then-ranked-table structure used here.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { formatCents } from '@/lib/money';
import { getCustomerAnalytics, getFilterState } from '@/services/analyticsService';
import { CustomerAnalytics, AnalyticsFilterState } from '@/services/analyticsTypes';
import { EmptyState } from '@/components/BrandthreadUI';
import {
  AnalyticsHeader, AnalyticsSkeleton, Card, CardDivider, SectionTitle, StatRow, ProgressBar,
} from '@/components/analytics/AnalyticsKit';

type TopCustomer = {
  buyerId: string | null;
  customerId: string | null;
  name: string;
  email: string;
  orderCount: number;
  totalCents: number;
  lastOrderAt: string | null;
  firstOrderAt: string | null;
};

function retColor(colors: ReturnType<typeof useColors>, pct: number): string {
  if (pct === 0) return colors.subtle;
  if (pct >= 40) return colors.success;
  if (pct >= 25) return colors.warning;
  return colors.destructive;
}

export default function AnalyticsCustomersScreen() {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = insets.top;

  const [data,       setData]       = useState<CustomerAnalytics | null>(null);
  const [topCustomers, setTopCustomers] = useState<TopCustomer[]>([]);
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
      const [analytics, customerResponse] = await Promise.all([
        getCustomerAnalytics(f), api.analytics.customers(10).catch(() => null),
      ]);
      if (requestUser.current !== requestedUser) return;
      setData(analytics);
      setTopCustomers(customerResponse ? (customerResponse.topCustomers ?? []) : []);
    } catch (err) {
      if (requestUser.current !== requestedUser) return;
      setData(null); setTopCustomers([]);
    } finally { setLoading(false); setRefreshing(false); }
  }, [api, filter, authLoaded, userId]);

  useEffect(() => {
    requestUser.current = null;
    setData(null); setFilter(null); setTopCustomers([]);
    setLoading(!authLoaded);
    if (authLoaded && userId) { setLoading(true); load(); }
  }, [authLoaded, userId]); // load reads the current filter

  if (loading) {
    return <AnalyticsSkeleton topPad={topPad} kpiCount={0} listRows={4} />;
  }
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      <AnalyticsHeader title="Customer Analytics" subtitle="All time" />

      {/* KPIs */}
      <SectionTitle>Overview</SectionTitle>
      <Card>
        {data && <>
          <StatRow label={data.totalCustomers.label} value={data.totalCustomers.formatted} icon="users" iconColor={colors.primary} />
          <CardDivider />
          <StatRow label={data.returningCustomers.label} value={data.returningCustomers.formatted} changePct={data.returningCustomers.changePct} icon="repeat" iconColor={colors.info} />
          <CardDivider />
          <StatRow label={data.repeatRate.label} value={data.repeatRate.formatted} changePct={data.repeatRate.changePct} icon="refresh-cw" iconColor={colors.primary} />
          <CardDivider />
          <StatRow label={data.purchaseFrequency.label} value={data.purchaseFrequency.formatted} changePct={data.purchaseFrequency.changePct} icon="shopping-bag" iconColor={colors.info} />
        </>}
      </Card>

      {/* Top customers */}
      <SectionTitle>Top Customers</SectionTitle>
      <Card>
        {topCustomers.length === 0 ? (
          <View style={s.customerEmpty}>
            <Feather name="users" size={22} color={colors.mutedForeground} />
            <Text style={s.customerEmptyText}>No customer orders yet</Text>
          </View>
        ) : (
          topCustomers.map((customer, i) => {
            const rowKey = customer.customerId ?? customer.buyerId ?? (customer.email || String(i));
            const rowContent = (
              <>
                <View style={s.customerRank}>
                  <Text style={s.customerRankText}>{i + 1}</Text>
                </View>
                <View style={s.customerInfo}>
                  <Text style={s.customerName} numberOfLines={1}>{customer.name}</Text>
                  <Text style={s.customerMeta}>
                    {customer.orderCount} {customer.orderCount === 1 ? 'order' : 'orders'} · Last order {customer.lastOrderAt ? fmtDate(customer.lastOrderAt) : '—'}
                  </Text>
                </View>
                <View style={s.customerSpend}>
                  <Text style={s.customerSpendValue}>{formatCents(customer.totalCents)}</Text>
                  {customer.customerId ? <Feather name="chevron-right" size={16} color={colors.mutedForeground} /> : null}
                </View>
              </>
            );
            return (
              <View key={rowKey}>
                {i > 0 && <CardDivider />}
                {customer.customerId ? (
                  <TouchableOpacity
                    style={s.customerRow}
                    onPress={() => router.push(`/customer-orders?customerId=${encodeURIComponent(customer.customerId!)}` as never)}
                    accessibilityRole="button"
                    accessibilityLabel={`View order history for ${customer.name}`}
                  >
                    {rowContent}
                  </TouchableOpacity>
                ) : (
                  <View style={s.customerRow}>{rowContent}</View>
                )}
              </View>
            );
          })
        )}
      </Card>

      {/* Cohorts */}
      <SectionTitle>Cohort Retention</SectionTitle>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: SP.lg }}>
        <View>
          <View style={s.cohortHeaderRow}>
            <Text style={[s.cohortCell, s.cohortLabelCell]}>Cohort</Text>
            <Text style={s.cohortCell}>Customers</Text>
            <Text style={s.cohortCell}>M+1</Text>
            <Text style={s.cohortCell}>M+2</Text>
            <Text style={s.cohortCell}>M+3</Text>
            <Text style={s.cohortCell}>Avg LTV</Text>
          </View>
          {data?.cohorts.map(c => (
            <View key={c.cohortLabel} style={s.cohortRow}>
              <Text style={[s.cohortCell, s.cohortLabelCell, { color: colors.foreground }]}>{c.cohortLabel}</Text>
              <Text style={s.cohortCell}>{c.customers}</Text>
              <Text style={[s.cohortCell, { color: retColor(colors, c.month1RetentionPct) }]}>{c.month1RetentionPct > 0 ? `${c.month1RetentionPct}%` : '—'}</Text>
              <Text style={[s.cohortCell, { color: retColor(colors, c.month2RetentionPct) }]}>{c.month2RetentionPct > 0 ? `${c.month2RetentionPct}%` : '—'}</Text>
              <Text style={[s.cohortCell, { color: retColor(colors, c.month3RetentionPct) }]}>{c.month3RetentionPct > 0 ? `${c.month3RetentionPct}%` : '—'}</Text>
              <Text style={[s.cohortCell, { color: colors.warning }]}>{formatCents(c.avgLtvCents)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Locations */}
      <SectionTitle>Top Locations</SectionTitle>
      <Card>
        {data?.topLocations.map((loc, i) => (
          <View key={loc.location}>
            {i > 0 && <CardDivider />}
            <View style={s.locRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.locName}>{loc.location}</Text>
                <View style={{ marginTop: 4 }}>
                  <ProgressBar pct={loc.sharePct} />
                </View>
              </View>
              <View style={{ alignItems: 'flex-end', marginLeft: SP.sm }}>
                <Text style={s.locCount}>{loc.customers.toLocaleString()}</Text>
                <Text style={s.locShare}>{loc.sharePct.toFixed(1)}%</Text>
              </View>
            </View>
          </View>
        ))}
      </Card>

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: SP.md },
  cohortHeaderRow:{ flexDirection: 'row', backgroundColor: colors.elevated, borderRadius: RADIUS.sm, marginBottom: 4, padding: 4 },
  cohortRow:{ flexDirection: 'row', backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border, padding: 4 },
  cohortCell:{ width: 80, textAlign: 'center', fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground, paddingVertical: 8 },
  cohortLabelCell:{ width: 90, textAlign: 'left', fontFamily: FONT.medium },
  locRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm + 1, minHeight: COMP.minTouchTarget },
  locName:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  locCount: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  locShare: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  customerRow: { flexDirection: 'row', alignItems: 'center', minHeight: COMP.minTouchTarget, paddingHorizontal: SP.md, paddingVertical: SP.sm + 1, gap: SP.sm },
  customerRank: { width: 28, height: 28, borderRadius: RADIUS.pill, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  customerRankText: { fontSize: FS.xs, fontFamily: FONT.bold, color: colors.accentForeground },
  customerInfo: { flex: 1, minWidth: 0, gap: 3 },
  customerName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  customerMeta: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  customerSpend: { alignItems: 'flex-end', gap: 3 },
  customerSpendValue: { fontSize: FS.base, fontFamily: FONT.semibold, color: colors.foreground },
  customerEmpty: { minHeight: 90, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg, gap: SP.sm },
  customerEmptyText: { fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center' },
});
