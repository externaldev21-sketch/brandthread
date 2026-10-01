/** Link in bio analytics: views, clicks, CTR, clicks per link, referrers, countries. */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ErrorState } from '@/components/ui/ErrorState';
import { AnalyticsSkeleton, Card, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { MetricRow, MetricTiles } from '@/components/growth/GrowthUI';
import { formatRate } from '@/lib/growthValidation';
import { getBioStats, type BioStats } from '@/services/growthService';

export default function LinkInBioStatsScreen() {
  const colors = useColors();
  const [d, setD] = useState<BioStats | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => { try { setD(await getBioStats()); setFailed(false); } catch { setFailed(true); } }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const none = <Text style={{ color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: FS.sm }}>No data yet</Text>;
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Page stats" />
      {failed && !d ? <ErrorState onRetry={load} /> : !d ? <AnalyticsSkeleton kpiCount={3} listRows={3} /> : (
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: 140 }}>
          <MetricTiles cols={3} items={[
            { key: 'v', label: 'Views', value: String(d.views) },
            { key: 'c', label: 'Clicks', value: String(d.clicks) },
            { key: 'r', label: 'Click rate', value: formatRate(d.clickThroughRate) },
          ]} />
          <View style={{ height: SP.lg }} />
          <SectionTitle note={`Last ${d.days} days`}>Clicks per link</SectionTitle>
          <Card padded>
            {d.shopClicks > 0 && <MetricRow label="Shop my store" value={String(d.shopClicks)} />}
            {d.productClicks > 0 && <MetricRow label="Featured products" value={String(d.productClicks)} />}
            {d.links.length === 0 && d.shopClicks === 0 && d.productClicks === 0 ? none
              : d.links.map((l, i) => <MetricRow key={l.id} label={l.title} value={String(l.clicks)} last={i === d.links.length - 1} />)}
          </Card>
          <SectionTitle>Top referrers</SectionTitle>
          <Card padded>{d.referrers.length === 0 ? none : d.referrers.map((r, i) => <MetricRow key={r.label} label={r.label} value={String(r.count)} last={i === d.referrers.length - 1} />)}</Card>
          <SectionTitle>Top countries</SectionTitle>
          <Card padded>{d.countries.length === 0 ? none : d.countries.map((r, i) => <MetricRow key={r.label} label={r.label} value={String(r.count)} last={i === d.countries.length - 1} />)}</Card>
        </ScrollView>
      )}
    </View>
  );
}
