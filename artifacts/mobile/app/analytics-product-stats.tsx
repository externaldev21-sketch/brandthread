/**
 * Product Stats — views, add-to-cart, purchases and conversion per product.
 * Mobbin reference: TikTok Studio analytics (range pills + key metric tiles)
 * and Shopify reports list rows, reskinned to the Brandthread palette.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { EmptyState } from '@/components/BrandthreadUI';
import { Card, CardDivider, ProgressBar, SectionTitle, StatTileRow } from '@/components/analytics/AnalyticsKit';
import { InsightFrame } from '@/components/analytics/InsightFrame';
import { useSellerInsight } from '@/hooks/useSellerInsight';
import { getProductStats, type InsightRange } from '@/services/sellerInsightsService';

const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

export default function AnalyticsProductStatsScreen() {
  const colors = useColors();
  const s = React.useMemo(() => styles(colors), [colors]);
  const [range, setRange] = useState<InsightRange>('30d');
  const { data, loading, error, reload } = useSellerInsight(() => getProductStats(range), [range]);

  const t = data?.totals;
  const top = Math.max(1, t?.views ?? 0);
  return (
    <InsightFrame title="Product stats" loading={loading && !data} error={error && !data} onRetry={reload} onRefresh={reload} range={range} onRangeChange={setRange}>
      {!data || data.products.length === 0 ? (
        <EmptyState icon="bar-chart-2" title="No product activity yet" description="Views, add-to-carts and purchases appear here as shoppers find your products." />
      ) : (
        <>
          <StatTileRow items={[
            { key: 'views', label: 'Views', value: t!.views.toLocaleString() },
            { key: 'carts', label: 'Add to cart', value: t!.addToCarts.toLocaleString() },
            { key: 'buys', label: 'Purchases', value: t!.purchases.toLocaleString() },
          ]} />
          <SectionTitle>Funnel</SectionTitle>
          <Card padded>
            {[
              { label: 'Views', value: t!.views, rate: null as string | null },
              { label: 'Add to cart', value: t!.addToCarts, rate: pct(t!.viewToCartPct) },
              { label: 'Purchases', value: t!.purchases, rate: pct(t!.cartToPurchasePct) },
            ].map((step, i) => (
              <View key={step.label} style={{ marginTop: i ? SP.md : 0 }}>
                <View style={s.rowBetween}>
                  <Text style={s.label}>{step.label}</Text>
                  <Text style={s.value}>{step.value.toLocaleString()}{step.rate ? `  ·  ${step.rate}` : ''}</Text>
                </View>
                <ProgressBar pct={(step.value / top) * 100} height={8} />
              </View>
            ))}
          </Card>
          <SectionTitle>By product</SectionTitle>
          <Card>
            {data.products.map((p, i) => (
              <View key={p.productId}>
                {i > 0 && <CardDivider />}
                <View style={s.product}>
                  <View style={s.rowBetween}>
                    <Text style={[s.value, { flex: 1 }]} numberOfLines={1}>{p.name}</Text>
                    <Text style={s.value}>{formatCents(p.revenueCents)}</Text>
                  </View>
                  <Text style={s.meta}>
                    {p.views.toLocaleString()} views  ·  {p.addToCarts.toLocaleString()} carts  ·  {p.purchases.toLocaleString()} purchases
                  </Text>
                  <Text style={s.meta}>View to cart {pct(p.viewToCartPct)}  ·  Cart to purchase {pct(p.cartToPurchasePct)}</Text>
                </View>
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
  meta: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  product: { padding: SP.md },
});
