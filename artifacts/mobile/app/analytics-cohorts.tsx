/**
 * Advanced Analytics — Brandthread Pro.
 * New module (existing analytics screens are unchanged and stay free):
 * customer cohorts by first-order month, lifetime value and average order
 * value over the last six months, all from real orders via
 * GET /api/analytics/advanced. Sellers below Pro see a locked state that
 * leads to the plans screen with Pro preselected.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { getEntitlementRejection } from '@/lib/entitlementError';
import { monthLabel } from '@/lib/proPerks';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProLockedState } from '@/components/analytics/ProLockedState';
import {
  AnalyticsBarChart, AnalyticsSkeleton, Card, CardDivider, SectionTitle,
} from '@/components/analytics/AnalyticsKit';

type Advanced = Awaited<ReturnType<ReturnType<typeof useApi>['analytics']['advanced']>>;

const DEMO_DATA: Advanced = {
  months: ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'],
  cohorts: [
    { month: '2026-04', customers: 12, repeatCustomers: 5, repeatRate: 42, revenueCents: 61200 },
    { month: '2026-05', customers: 18, repeatCustomers: 7, repeatRate: 39, revenueCents: 88400 },
    { month: '2026-06', customers: 15, repeatCustomers: 6, repeatRate: 40, revenueCents: 79100 },
    { month: '2026-07', customers: 24, repeatCustomers: 11, repeatRate: 46, revenueCents: 124800 },
    { month: '2026-08', customers: 31, repeatCustomers: 14, repeatRate: 45, revenueCents: 163500 },
    { month: '2026-09', customers: 27, repeatCustomers: 8, repeatRate: 30, revenueCents: 139200 },
  ],
  orderValue: [
    { month: '2026-04', orders: 17, revenueCents: 61200, averageOrderCents: 3600 },
    { month: '2026-05', orders: 25, revenueCents: 88400, averageOrderCents: 3536 },
    { month: '2026-06', orders: 21, revenueCents: 79100, averageOrderCents: 3767 },
    { month: '2026-07', orders: 35, revenueCents: 124800, averageOrderCents: 3566 },
    { month: '2026-08', orders: 45, revenueCents: 163500, averageOrderCents: 3633 },
    { month: '2026-09', orders: 35, revenueCents: 139200, averageOrderCents: 3977 },
  ],
  lifetime: { customers: 127, revenueCents: 656200, averageLifetimeValueCents: 5167 },
};

const EMPTY_DATA: Advanced = {
  months: [], cohorts: [], orderValue: [],
  lifetime: { customers: 0, revenueCents: 0, averageLifetimeValueCents: 0 },
};

function wantsLockedPreview(): boolean {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('locked') === '1';
  } catch {
    return false;
  }
}

function dollars(cents: number): string {
  const d = cents / 100;
  return d >= 1000 ? `$${(d / 1000).toFixed(1)}k` : `$${d.toFixed(0)}`;
}

export default function AnalyticsAdvancedScreen() {
  const colors = useColors();
  const api = useApi();
  const { isLoaded: authLoaded, userId } = useAuth();
  const s = useMemo(() => createStyles(colors), [colors]);

  const previewDemo = isPreviewDemoMode();
  const previewFresh = !previewDemo && isSellerDevPreview();
  const isPreview = previewDemo || previewFresh;

  const [data, setData] = useState<Advanced | null>(null);
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestUser = useRef<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    // Previews never call the protected API.
    if (isPreview) {
      setLocked(previewDemo && wantsLockedPreview());
      setData(previewDemo ? DEMO_DATA : EMPTY_DATA);
      setLoading(false);
      return;
    }
    if (!authLoaded || !userId) return;
    const requestedUser = userId;
    requestUser.current = requestedUser;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const result = await api.analytics.advanced();
      if (requestUser.current !== requestedUser) return;
      setData(result); setLocked(false); setLoadError(false);
    } catch (err) {
      if (requestUser.current !== requestedUser) return;
      if (getEntitlementRejection(err)) { setLocked(true); setLoadError(false); }
      else { setData(null); setLoadError(true); }
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [api, authLoaded, userId, isPreview, previewDemo]);

  useEffect(() => {
    requestUser.current = null;
    setData(null); setLocked(false);
    setLoading(true);
    load();
  }, [authLoaded, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const avgRepeat = useMemo(() => {
    const customers = (data?.cohorts ?? []).reduce((n, c) => n + c.customers, 0);
    const repeat = (data?.cohorts ?? []).reduce((n, c) => n + c.repeatCustomers, 0);
    return customers > 0 ? Math.round((repeat / customers) * 100) : 0;
  }, [data]);

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Customer cohorts" />
      {loading ? (
        <AnalyticsSkeleton kpiCount={2} listRows={4} />
      ) : locked ? (
        <View style={s.centered}><ProLockedState source="analytics-advanced" /></View>
      ) : loadError || !data ? (
        <View style={s.centered}>
          <ErrorState message="Couldn't load advanced analytics." onRetry={() => load()} />
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
        >
          <Card>
            {[
              ['Average lifetime value', formatCents(data.lifetime.averageLifetimeValueCents)],
              ['Customers', data.lifetime.customers.toLocaleString()],
              ['Repeat rate, last 6 months', `${avgRepeat}%`],
            ].map(([label, value], i) => (
              <React.Fragment key={label}>
                {i > 0 && <CardDivider />}
                <View style={s.statRow}>
                  <Text style={s.statLabel}>{label}</Text>
                  <Text style={s.statValue}>{value}</Text>
                </View>
              </React.Fragment>
            ))}
          </Card>

          <Card padded>
            <SectionTitle>Average order value</SectionTitle>
            <AnalyticsBarChart
              points={data.orderValue.map((m) => ({ label: monthLabel(m.month), value: m.averageOrderCents }))}
              color={colors.primary}
              formatValue={dollars}
              emptyLabel="No orders yet"
            />
          </Card>

          <SectionTitle note="Customers grouped by the month of their first order">Customer cohorts</SectionTitle>
          <Card>
            <View style={s.row}>
              <Text style={[s.cell, s.monthCell, s.head]}>Month</Text>
              <Text style={[s.cell, s.head]}>New</Text>
              <Text style={[s.cell, s.head]}>Repeat</Text>
              <Text style={[s.cell, s.revCell, s.head]}>Revenue</Text>
            </View>
            {data.cohorts.map((c) => (
              <React.Fragment key={c.month}>
                <CardDivider />
                <View style={s.row}>
                  <Text style={[s.cell, s.monthCell, s.value]}>{monthLabel(c.month)}</Text>
                  <Text style={[s.cell, s.value]}>{c.customers}</Text>
                  <Text style={[s.cell, s.value]}>{c.repeatRate}%</Text>
                  <Text style={[s.cell, s.revCell, s.value]}>{formatCents(c.revenueCents)}</Text>
                </View>
              </React.Fragment>
            ))}
          </Card>
          {data.cohorts.every((c) => c.customers === 0) ? (
            <Text style={s.note}>Cohorts fill in as customers place orders.</Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: 120 },
  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm, minHeight: 52, paddingHorizontal: SP.md },
  statLabel: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  statValue: { fontSize: FS.base, fontFamily: FONT.semibold, color: colors.foreground },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm + 2 },
  cell: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: colors.foreground, textAlign: 'right' },
  monthCell: { textAlign: 'left' },
  revCell: { flex: 1.4 },
  head: { fontSize: FS.xs, fontFamily: FONT.medium, color: colors.mutedForeground },
  value: { fontFamily: FONT.semibold },
  note: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center' },
});
