/**
 * Audience — top locations and new vs returning. Groups under 5 people are
 * never shown (k-anonymity). Age bands are intentionally absent: no birthdate
 * is stored server-side.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { EmptyState } from '@/components/BrandthreadUI';
import { Card, CardDivider, ProgressBar, SectionTitle, StatRow } from '@/components/analytics/AnalyticsKit';
import { InsightFrame } from '@/components/analytics/InsightFrame';
import { useSellerInsight } from '@/hooks/useSellerInsight';
import { getAudienceStats, type InsightRange, type SplitCounts } from '@/services/sellerInsightsService';

const fmt = (v: number | null) => (v === null ? '—' : v.toLocaleString());
const regionNames = typeof Intl !== 'undefined' && (Intl as any).DisplayNames ? new (Intl as any).DisplayNames(['en'], { type: 'region' }) : null;
const countryName = (code: string) => { try { return regionNames?.of(code) ?? code; } catch { return code; } };

function SplitCard({ title, split }: { title: string; split: SplitCounts }) {
  const shown = split.new !== null || split.returning !== null;
  if (!shown) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card>
        <StatRow label="New" value={fmt(split.new)} />
        <CardDivider />
        <StatRow label="Returning" value={fmt(split.returning)} />
      </Card>
    </>
  );
}

export default function AnalyticsAudienceScreen() {
  const colors = useColors();
  const s = React.useMemo(() => styles(colors), [colors]);
  const [range, setRange] = useState<InsightRange>('30d');
  const { data, loading, error, reload } = useSellerInsight(() => getAudienceStats(range), [range]);

  const empty = !data || (data.topCountries.length === 0 && data.buyers.new === null && data.buyers.returning === null
    && data.viewers.new === null && data.viewers.returning === null);
  const top = Math.max(1, ...(data?.topCountries.map(c => c.people) ?? [1]));
  return (
    <InsightFrame title="Audience" loading={loading && !data} error={error && !data} onRetry={reload} onRefresh={reload} range={range} onRangeChange={setRange}>
      {empty ? (
        <EmptyState icon="users" title="Audience not available yet" description={`Audience groups appear once at least ${data?.minGroupSize ?? 5} people are in them.`} />
      ) : (
        <>
          <SplitCard title="Buyers" split={data!.buyers} />
          <SplitCard title="Store viewers" split={data!.viewers} />
          {data!.topCountries.length > 0 && (
            <>
              <SectionTitle>Top locations</SectionTitle>
              <Card padded>
                {data!.topCountries.map((c, i) => (
                  <View key={c.country} style={{ marginTop: i ? SP.md : 0 }}>
                    <View style={s.rowBetween}>
                      <Text style={s.label}>{countryName(c.country)}</Text>
                      <Text style={s.value}>{c.people.toLocaleString()}</Text>
                    </View>
                    <ProgressBar pct={(c.people / top) * 100} height={8} />
                  </View>
                ))}
              </Card>
              {data!.topRegions.length > 0 && (
                <>
                <SectionTitle>Top regions</SectionTitle>
                <Card>
                  {data!.topRegions.map((r, i) => (
                    <View key={`${r.country}-${r.region}`}>
                      {i > 0 && <CardDivider />}
                      <StatRow label={`${r.region}, ${r.country}`} value={r.people.toLocaleString()} />
                    </View>
                  ))}
                </Card>
                </>
              )}
            </>
          )}
          <Text style={s.note}>Groups with fewer than {data!.minGroupSize} people are hidden to protect shoppers.</Text>
        </>
      )}
    </InsightFrame>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label: { fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  value: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  note: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginBottom: SP.md },
});
