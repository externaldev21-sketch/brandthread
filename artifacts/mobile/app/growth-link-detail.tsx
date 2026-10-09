/** Per-link detail: clicks, orders, revenue, conversion, daily clicks, countries, referrers. */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Alert, Share } from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { AnalyticsBarChart, AnalyticsSkeleton, Card, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { CopyRow, MetricRow, MetricTiles, dollars } from '@/components/growth/GrowthUI';
import { formatRate } from '@/lib/growthValidation';
import { archiveLink, getLinkDetail, type LinkDetail } from '@/services/growthService';

export default function GrowthLinkDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [d, setD] = useState<LinkDetail | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try { setD(await getLinkDetail(String(id))); setFailed(false); } catch { setFailed(true); }
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const remove = () => Alert.alert('Archive this link?', 'The short link stops working. Its stats are kept.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Archive', style: 'destructive', onPress: async () => { try { await archiveLink(String(id)); router.back(); } catch { Alert.alert("Couldn't archive link"); } } },
  ]);

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={d?.label || 'Link'} />
      {failed && !d ? <ErrorState onRetry={load} /> : !d ? <AnalyticsSkeleton kpiCount={4} listRows={2} /> : (
        <ScrollView contentContainerStyle={{ padding: SP.md, paddingBottom: 140 }}>
          <CopyRow value={d.url} />
          <View style={{ height: SP.md }} />
          <MetricTiles cols={2} items={[
            { key: 'c', label: 'Clicks', value: String(d.clicks) },
            { key: 'o', label: 'Orders', value: String(d.orders) },
            { key: 'r', label: 'Revenue', value: dollars(d.revenueCents) },
            { key: 'cv', label: 'Conversion', value: formatRate(d.conversionRate) },
          ]} />
          <View style={{ height: SP.lg }} />
          <SectionTitle note="Last 30 days">Clicks</SectionTitle>
          <Card padded>
            <AnalyticsBarChart points={d.series.map((p) => ({ label: p.day.slice(5), value: p.clicks }))} emptyLabel="No clicks yet" />
          </Card>
          <SectionTitle>Top countries</SectionTitle>
          <Card padded>
            {d.countries.length === 0 ? <Text style={muted(colors)}>No clicks yet</Text>
              : d.countries.map((c, i) => <MetricRow key={c.label} label={c.label} value={String(c.count)} last={i === d.countries.length - 1} />)}
          </Card>
          <SectionTitle>Top referrers</SectionTitle>
          <Card padded>
            {d.referrers.length === 0 ? <Text style={muted(colors)}>No clicks yet</Text>
              : d.referrers.map((c, i) => <MetricRow key={c.label} label={c.label} value={String(c.count)} last={i === d.referrers.length - 1} />)}
          </Card>
          <SectionTitle>Campaign</SectionTitle>
          <Card padded>
            <MetricRow label="Source" value={d.utmSource ?? '-'} />
            <MetricRow label="Medium" value={d.utmMedium ?? '-'} />
            <MetricRow label="Campaign" value={d.utmCampaign ?? '-'} last />
          </Card>
          <PrimaryButton label="Share link" icon="share-2" onPress={() => Share.share({ message: d.url, url: d.url }).catch(() => {})} />
          <View style={{ height: SP.sm }} />
          <SecondaryButton label="Archive link" onPress={remove} />
        </ScrollView>
      )}
    </View>
  );
}

const muted = (c: ReturnType<typeof useColors>) => ({ color: c.mutedForeground, fontFamily: FONT.medium, fontSize: FS.sm });
