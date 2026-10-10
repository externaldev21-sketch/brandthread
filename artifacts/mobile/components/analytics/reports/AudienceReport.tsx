/**
 * Audience — follower growth, new vs returning, top locations and devices.
 * Mobbin reference: TikTok Studio Analytics "Followers" (key metrics + growth
 * chart + "Follower insights" breakdowns) and Shopify Analytics "Top
 * locations", reskinned. Groups under 5 people are never shown (k-anonymity);
 * age bands are absent because no birthdate is stored. Data:
 * GET /api/analytics/insights/audience.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { formatCompactCount } from '@/lib/compactFormat';
import { EmptyState } from '@/components/BrandthreadUI';
import { Card, CardDivider, SectionTitle, StatRow } from '@/components/analytics/AnalyticsKit';
import { InsightFrame } from '@/components/analytics/InsightFrame';
import { InsightLineChart, KpiGrid, ShareBarRow } from '@/components/analytics/InsightCharts';
import { useSellerInsight } from '@/hooks/useSellerInsight';
import { DEFAULT_INSIGHT_RANGE, getAudienceStats, type InsightRange, type SplitCounts } from '@/services/sellerInsightsService';

const fmt = (v: number | null) => (v === null ? '—' : v.toLocaleString());
const regionNames = typeof Intl !== 'undefined' && (Intl as any).DisplayNames ? new (Intl as any).DisplayNames(['en'], { type: 'region' }) : null;
const countryName = (code: string) => { try { return regionNames?.of(code) ?? code; } catch { return code; } };
const DEVICE_LABEL = { ios: 'iPhone', android: 'Android', web: 'Web', unknown: 'Other' } as const;

function SplitCard({ title, split }: { title: string; split: SplitCounts }) {
  if (split.new === null && split.returning === null) return null;
  const total = (split.new ?? 0) + (split.returning ?? 0);
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card padded>
        <ShareBarRow label="New" value={fmt(split.new)} pct={total > 0 && split.new !== null ? (split.new / total) * 100 : 0} />
        <ShareBarRow label="Returning" value={fmt(split.returning)} pct={total > 0 && split.returning !== null ? (split.returning / total) * 100 : 0} last />
      </Card>
    </>
  );
}

export default function AudienceReport() {
  const colors = useColors();
  const s = React.useMemo(() => styles(colors), [colors]);
  const [range, setRange] = useState<InsightRange>(DEFAULT_INSIGHT_RANGE);
  const { data, loading, error, reload } = useSellerInsight(() => getAudienceStats(range), [range]);

  const hasData = !!data && (data.followers.total > 0 || data.topCountries.length > 0 || data.devices.length > 0
    || data.buyers.new !== null || data.buyers.returning !== null || data.viewers.new !== null || data.viewers.returning !== null);
  const topCountry = Math.max(1, ...(data?.topCountries.map(c => c.people) ?? [1]));
  return (
    <InsightFrame title="Audience" loading={loading && !data} error={error && !data} onRetry={reload} onRefresh={reload} range={range} onRangeChange={setRange}>
      {!data ? null : !hasData ? (
        <EmptyState icon="users" title="No audience yet" description={`Followers, locations and devices show here. Groups under ${data.minGroupSize} people stay hidden.`} />
      ) : (
        <>
          <KpiGrid range={range} items={[
            { key: 'followers', label: 'Total followers', value: formatCompactCount(data.followers.total), featured: true, caption: 'All time' },
            { key: 'gained', label: 'New followers', value: formatCompactCount(data.followers.gained), changePct: data.followers.gainedPct },
          ]} />

          <SectionTitle>Follower growth</SectionTitle>
          <Card padded>
            <InsightLineChart range={range} points={data.buckets.map(b => ({ bucket: b.bucket, value: b.followers }))} />
          </Card>

          <SplitCard title="Buyers" split={data.buyers} />
          <SplitCard title="Store visitors" split={data.viewers} />

          <SectionTitle>Top locations</SectionTitle>
          {data.topCountries.length === 0 ? (
            <Card><Text style={s.empty}>{data.hiddenLocations > 0 ? `Hidden until ${data.minGroupSize} buyers share a location.` : 'No orders with a shipping address yet.'}</Text></Card>
          ) : (
            <Card padded>
              {data.topCountries.map((c, i) => (
                <ShareBarRow key={c.country} label={countryName(c.country)} value={c.people.toLocaleString()} pct={(c.people / topCountry) * 100} last={i === data.topCountries.length - 1} />
              ))}
            </Card>
          )}
          {data.topRegions.length > 0 && (
            <>
              <SectionTitle>Top regions</SectionTitle>
              <Card>
                {data.topRegions.map((r, i) => (
                  <View key={`${r.country}-${r.region}`}>
                    {i > 0 && <CardDivider />}
                    <StatRow label={`${r.region}, ${r.country}`} value={r.people.toLocaleString()} />
                  </View>
                ))}
              </Card>
            </>
          )}

          <SectionTitle>Devices</SectionTitle>
          {data.devices.length === 0 ? (
            <Card><Text style={s.empty}>No store visits in this period.</Text></Card>
          ) : (
            <Card padded>
              {data.devices.map((d, i) => (
                <ShareBarRow key={d.device} label={DEVICE_LABEL[d.device]} value={`${d.sharePct}%`} pct={d.sharePct} last={i === data.devices.length - 1} />
              ))}
            </Card>
          )}
          <Text style={s.note}>Groups with fewer than {data.minGroupSize} people are hidden.</Text>
        </>
      )}
    </InsightFrame>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  empty: { fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground, padding: SP.md },
  note: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginBottom: SP.md },
});
