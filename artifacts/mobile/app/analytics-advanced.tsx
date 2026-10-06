/**
 * Advanced analytics (Pro) — average order value, conversion, repeat buyers,
 * refunds, sales by channel and top customers. Gated by the seller's real
 * plan entitlement (useSubscriptionPlan → /api/seller/subscription/status,
 * RevenueCat/Stripe-verified) and again server-side (requirePlan("pro") on
 * GET /api/analytics/insights/advanced). Mobbin reference: Shopify Analytics
 * "Customers" / "Sales by channel" cards, reskinned.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { formatCentsCompact, formatCompactCount } from '@/lib/compactFormat';
import { fmtDate } from '@/lib/format';
import { EmptyState, PrimaryButton } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AnalyticsSkeleton, Card, CardDivider, SectionTitle, StatRow } from '@/components/analytics/AnalyticsKit';
import { InsightFrame, useReportBottomInset } from '@/components/analytics/InsightFrame';
import { InsightLineChart, KpiGrid, RankedRow, ShareBarRow, formatAxisMoney } from '@/components/analytics/InsightCharts';
import { useSellerInsight } from '@/hooks/useSellerInsight';
import { useSubscriptionPlan } from '@/hooks/useSubscriptionPlan';
import { DEFAULT_INSIGHT_RANGE, getAdvancedStats, previewMode, type InsightRange } from '@/services/sellerInsightsService';

/** Pro check: the real plan when signed in; the demo preview shows the report, the fresh preview shows the gate. */
function useIsPro(): { isPro: boolean; checking: boolean } {
  const preview = previewMode();
  const { plan, loading } = useSubscriptionPlan();
  if (preview) return { isPro: preview === 'demo', checking: false };
  return { isPro: plan === 'pro', checking: loading && plan === null };
}

function ProGate() {
  const colors = useColors();
  const router = useRouter();
  const bottom = useReportBottomInset();
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Advanced analytics" />
      <View style={{ flex: 1, paddingHorizontal: SP.md, paddingBottom: bottom, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center', gap: SP.sm }}>
          <View style={{ width: 56, height: 56, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="lock" size={22} color={colors.foreground} />
          </View>
          <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: colors.foreground, textAlign: 'center' }}>Included with Pro</Text>
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground, textAlign: 'center', marginBottom: SP.md }}>
            Average order value, conversion, repeat buyers, refunds, sales by channel and top customers.
          </Text>
          <View style={{ width: '100%' }}><PrimaryButton label="See plans" onPress={() => router.push('/plans' as never)} /></View>
        </View>
      </View>
    </View>
  );
}

export default function AnalyticsAdvancedScreen() {
  const { isPro, checking } = useIsPro();
  if (checking) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Advanced analytics" />
        <AnalyticsSkeleton kpiCount={2} listRows={3} />
      </View>
    );
  }
  if (!isPro) return <ProGate />;
  return <AdvancedReport />;
}

function AdvancedReport() {
  const colors = useColors();
  const s = React.useMemo(() => styles(colors), [colors]);
  const [range, setRange] = useState<InsightRange>(DEFAULT_INSIGHT_RANGE);
  const { data, loading, error, reload } = useSellerInsight(() => getAdvancedStats(range), [range]);
  const t = data?.totals;
  const hasData = !!data && (data.totals.orders > 0 || data.totals.visits > 0);
  const channelTotal = Math.max(1, data?.totals.revenueCents ?? 0);
  return (
    <InsightFrame title="Advanced analytics" loading={loading && !data} error={error && !data} onRetry={reload} onRefresh={reload} range={range} onRangeChange={setRange}>
      {!data ? null : !hasData ? (
        <EmptyState icon="trending-up" title="No orders in this period" description="Order value, conversion, repeat buyers and refunds show here." />
      ) : (
        <>
          <KpiGrid range={range} items={[
            { key: 'aov', label: 'Average order', value: formatCents(t!.averageOrderCents), changePct: data.deltas.averageOrderPct, featured: true },
            { key: 'conv', label: 'Conversion', value: `${t!.conversionPct}%`, changePct: data.deltas.conversionPct },
            { key: 'repeat', label: 'Repeat buyers', value: `${t!.repeatBuyerPct}%`, changePct: null },
            { key: 'refund', label: 'Refund rate', value: `${t!.refundRatePct}%`, changePct: data.deltas.refundRatePct, invert: true },
          ]} />

          <SectionTitle>Average order value</SectionTitle>
          <Card padded>
            <InsightLineChart range={range} points={data.buckets.map(b => ({ bucket: b.bucket, value: b.averageOrderCents }))} formatValue={formatAxisMoney} />
          </Card>

          <SectionTitle>Orders</SectionTitle>
          <Card>
            <StatRow label="Orders" value={formatCompactCount(t!.orders)} />
            <CardDivider />
            <StatRow label="Revenue" value={formatCentsCompact(t!.revenueCents)} changePct={data.deltas.revenuePct ?? undefined} />
            <CardDivider />
            <StatRow label="Units per order" value={t!.unitsPerOrder.toFixed(2)} />
            <CardDivider />
            <StatRow label="Orders with a discount" value={`${t!.discountedOrders} · ${formatCentsCompact(t!.discountCents)}`} />
            <CardDivider />
            <StatRow label="Refunded" value={`${t!.refundedOrders} · ${formatCentsCompact(t!.refundedCents)}`} />
            <CardDivider />
            <StatRow label="Buyers" value={`${formatCompactCount(t!.buyers)} · ${t!.repeatBuyers} returning`} />
          </Card>

          <SectionTitle>Sales by channel</SectionTitle>
          <Card padded>
            {data.channels.map((c, i) => (
              <ShareBarRow
                key={c.channel}
                label={c.channel === 'threads' ? `Threads and videos · ${c.orders} orders` : `Store · ${c.orders} orders`}
                value={formatCents(c.revenueCents)}
                pct={(c.revenueCents / channelTotal) * 100}
                last={i === data.channels.length - 1}
              />
            ))}
          </Card>

          <SectionTitle>Top customers</SectionTitle>
          {data.topCustomers.length === 0 ? (
            <Card><Text style={s.empty}>No paid orders in this period.</Text></Card>
          ) : (
            <Card>
              {data.topCustomers.map((c, i) => (
                <View key={`${c.name}-${i}`}>
                  {i > 0 && <CardDivider />}
                  <RankedRow rank={i + 1} icon="user" title={c.name} subtitle={`${c.orders} order${c.orders === 1 ? '' : 's'} · last ${fmtDate(c.lastOrderAt)}`} value={formatCents(c.totalCents)} />
                </View>
              ))}
            </Card>
          )}
        </>
      )}
    </InsightFrame>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  empty: { fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground, padding: SP.md },
});
