/**
 * Growth links — list of trackable UTM short links with clicks / orders / revenue.
 * Mobbin reference: Shopify "Marketing" campaigns list + Linktree links list.
 */
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { Card, AnalyticsSkeleton } from '@/components/analytics/AnalyticsKit';
import { MetricTiles, dollars } from '@/components/growth/GrowthUI';
import { listLinks, type TrackedLink } from '@/services/growthService';

const DEST_LABEL = { store: 'Store', product: 'Product', bio: 'Link in bio' } as const;

export default function GrowthLinksScreen() {
  const colors = useColors();
  const router = useRouter();
  const [links, setLinks] = useState<TrackedLink[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setLinks(await listLinks()); setFailed(false); } catch { setFailed(true); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = (links ?? []).reduce((a, l) => ({ c: a.c + l.clicks, o: a.o + l.orders, r: a.r + l.revenueCents }), { c: 0, o: 0, r: 0 });

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Links" actions={[{ icon: 'plus', onPress: () => router.push('/growth-link-new' as never), accessibilityLabel: 'Create link' }]} />
      {failed && !links ? (
        <ErrorState onRetry={load} />
      ) : !links ? (
        <AnalyticsSkeleton kpiCount={3} listRows={3} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: SP.md, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        >
          {links.length === 0 ? (
            <EmptyState
              icon="link"
              title="No links yet"
              description="Create a trackable link for Instagram, TikTok or email and see the clicks and sales it brings."
              action={{ label: 'Create link', onPress: () => router.push('/growth-link-new' as never) }}
            />
          ) : (
            <>
              <MetricTiles cols={3} items={[
                { key: 'c', label: 'Clicks', value: String(total.c) },
                { key: 'o', label: 'Orders', value: String(total.o) },
                { key: 'r', label: 'Revenue', value: dollars(total.r) },
              ]} />
              <View style={{ height: SP.md }} />
              {links.map((l) => (
                <PressableScale
                  key={l.id}
                  onPress={() => router.push(`/growth-link-detail?id=${encodeURIComponent(l.id)}` as never)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${l.label || l.utmSource} link`}
                >
                  <Card padded>
                    <Text style={[s.title, { color: colors.foreground }]} numberOfLines={1}>{l.label || `${l.utmSource} · ${l.utmMedium}`}</Text>
                    <Text style={[s.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {DEST_LABEL[l.destinationType]} · {l.utmSource}{l.utmCampaign ? ` · ${l.utmCampaign}` : ''}
                    </Text>
                    <Text style={[s.url, { color: colors.subtle }]} numberOfLines={1}>{l.url}</Text>
                    <View style={[s.stats, { borderTopColor: colors.border }]}>
                      <Stat label="Clicks" value={String(l.clicks)} />
                      <Stat label="Orders" value={String(l.orders)} />
                      <Stat label="Revenue" value={dollars(l.revenueCents)} />
                    </View>
                  </Card>
                </PressableScale>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontSize: FS.meta, fontFamily: FONT.medium, color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ fontSize: FS.md, fontFamily: FONT.bold, color: colors.foreground }}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: FS.md, fontFamily: FONT.bold },
  sub: { fontSize: FS.sm, fontFamily: FONT.medium, marginTop: 2 },
  url: { fontSize: FS.meta, fontFamily: FONT.regular, marginTop: 2 },
  stats: { flexDirection: 'row', marginTop: SP.md, paddingTop: SP.md, borderTopWidth: StyleSheet.hairlineWidth },
});
