/**
 * Product stats — views, add-to-cart, purchases and conversion per product.
 * Mobbin reference: TikTok Studio Analytics (range pills + "Key metrics" grid
 * + line chart) and Shopify Analytics "Top products", reskinned to the
 * Brandthread palette. Data: GET /api/analytics/insights/products.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { formatCentsCompact, formatCompactCount } from '@/lib/compactFormat';
import { EmptyState } from '@/components/BrandthreadUI';
import { Card, CardDivider, ProgressBar, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { InsightFrame } from '@/components/analytics/InsightFrame';
import { InsightLineChart, KpiGrid, RankedRow } from '@/components/analytics/InsightCharts';
import { useSellerInsight } from '@/hooks/useSellerInsight';
import { DEFAULT_INSIGHT_RANGE, getProductStats, type InsightRange } from '@/services/sellerInsightsService';

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

export default function ProductStatsReport() {
  const colors = useColors();
  const router = useRouter();
  const s = React.useMemo(() => styles(colors), [colors]);
  const [range, setRange] = useState<InsightRange>(DEFAULT_INSIGHT_RANGE);
  const { data, loading, error, reload } = useSellerInsight(() => getProductStats(range), [range]);

  const t = data?.totals;
  const hasData = !!data && (data.totals.views > 0 || data.totals.addToCarts > 0 || data.totals.purchases > 0);
  const top = Math.max(1, t?.views ?? 0);
  return (
    <InsightFrame title="Product stats" loading={loading && !data} error={error && !data} onRetry={reload} onRefresh={reload} range={range} onRangeChange={setRange}>
      {!data ? null : !hasData ? (
        <EmptyState icon="shopping-bag" title="No product activity" description="Views, add-to-carts and purchases for this period show here." />
      ) : (
        <>
          <KpiGrid range={range} items={[
            { key: 'views', label: 'Product views', value: formatCompactCount(t!.views), changePct: data.deltas.viewsPct, featured: true },
            { key: 'carts', label: 'Added to cart', value: formatCompactCount(t!.addToCarts), changePct: data.deltas.addToCartsPct },
            { key: 'buys', label: 'Purchases', value: formatCompactCount(t!.purchases), changePct: data.deltas.purchasesPct },
            { key: 'rev', label: 'Product revenue', value: formatCentsCompact(t!.revenueCents), changePct: data.deltas.revenuePct },
          ]} />

          <SectionTitle>Views</SectionTitle>
          <Card padded>
            <InsightLineChart range={range} points={data.buckets.map(b => ({ bucket: b.bucket, value: b.views }))} />
          </Card>

          <SectionTitle>Funnel</SectionTitle>
          <Card padded>
            {[
              { label: 'Viewed a product', value: t!.views, rate: null as string | null },
              { label: 'Added to cart', value: t!.addToCarts, rate: pct(t!.viewToCartPct) },
              { label: 'Purchased', value: t!.purchases, rate: pct(t!.cartToPurchasePct) },
            ].map((step, i) => (
              <View key={step.label} style={{ marginTop: i ? SP.md : 0 }}>
                <View style={s.rowBetween}>
                  <Text style={s.label}>{step.label}</Text>
                  <Text style={s.value}>{step.value.toLocaleString()}{step.rate ? `  ·  ${step.rate}` : ''}</Text>
                </View>
                <ProgressBar pct={(step.value / top) * 100} height={8} />
              </View>
            ))}
            <Text style={s.meta}>{t!.viewToPurchasePct === null ? 'Conversion needs product views.' : `${t!.viewToPurchasePct}% of product views led to a purchase.`}</Text>
          </Card>

          <SectionTitle>Top products</SectionTitle>
          <Card>
            {data.products.slice(0, 20).map((p, i) => (
              <View key={p.productId}>
                {i > 0 && <CardDivider />}
                <RankedRow
                  rank={i + 1}
                  thumbnailUrl={p.imageUrl}
                  icon="shopping-bag"
                  title={p.name}
                  subtitle={`${formatCompactCount(p.views)} views · ${p.addToCarts} carts · ${p.purchases} sold`}
                  value={formatCents(p.revenueCents)}
                  valueLabel={p.viewToPurchasePct === null ? undefined : `${p.viewToPurchasePct}% conv.`}
                  onPress={() => router.push(`/product-detail?id=${encodeURIComponent(p.productId)}&tab=analytics` as never)}
                />
              </View>
            ))}
          </Card>
        </>
      )}
    </InsightFrame>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: SP.sm },
  label: { fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  value: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  meta: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: SP.md },
});
