/**
 * Ad campaign results — what a paid Brandthread ad actually delivered, with
 * pause / resume / stop.
 *
 * Layout copied from Shopee "Ad Details" (creative card with Stop | Pause,
 * budget/duration/time rows, Performance metric tiles over a daily chart):
 *   https://mobbin.com/screens/2fb386db-1f72-4c12-84d7-995701b68606
 * with Instagram Insights' "Accounts reached" + per-type breakdown bars for
 * the placement section:
 *   https://mobbin.com/screens/15b04865-816f-40f6-b870-26a7ff9b450e
 * reskinned to the app's black / white / silver palette.
 *
 * Data: GET /api/ad-campaigns/:id/results (billed viewable impressions, unique
 * reach, clicks, CTR, spend, by surface, daily, orders within 7 days of a click).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { CachedImage } from '@/components/CachedImage';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Badge } from '@/components/Badge';
import { SecondaryButton } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';
import { AnalyticsBarChart, AnalyticsSkeleton, Card, CardDivider, ProgressBar, SectionTitle } from '@/components/analytics/AnalyticsKit';
import { useApi } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import { confirmDestructiveActionSheet } from '@/lib/actionSheet';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import type { AdCampaign, AdCampaignResults, AdSurface } from '@/lib/api';

type ChartMetric = 'impressions' | 'clicks' | 'spend';

const SURFACE_LABELS: Record<AdSurface, string> = {
  following: 'Following',
  for_you: 'For You',
  discover: 'Discover',
};

function statusBadge(c: AdCampaign): { label: string; variant: 'success' | 'info' | 'default' | 'warning' } {
  if (c.status === 'active') return { label: 'Active', variant: 'success' };
  if (c.status === 'paused') return { label: 'Paused', variant: 'info' };
  if (c.status === 'completed') return { label: 'Completed', variant: 'default' };
  return { label: c.status.replace('_', ' '), variant: 'warning' };
}

function completionText(c: AdCampaign): string | null {
  if (c.status !== 'completed') return null;
  if (c.completionReason === 'budget_spent') return 'Budget spent';
  if (c.completionReason === 'seller_stopped') return 'Stopped';
  return 'Ended';
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

async function confirmStop(): Promise<boolean> {
  const title = 'Stop this campaign?';
  const message = "It stops showing right away and can't be restarted. You're only charged for what was delivered.";
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(`${title}\n\n${message}`) : true;
  }
  return confirmDestructiveActionSheet({ title, message, confirmLabel: 'Stop campaign' });
}

export default function AdCampaignResultsScreen() {
  const colors = useColors();
  const s = useMemo(() => createStyles(colors), [colors]);
  const api = useApi();
  const { isSignedIn } = useAuth();
  const { campaignId } = useLocalSearchParams<{ campaignId?: string }>();

  const [campaign, setCampaign] = useState<AdCampaign | null>(null);
  const [results, setResults] = useState<AdCampaignResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<null | 'pause' | 'resume' | 'stop'>(null);
  const [metric, setMetric] = useState<ChartMetric>('impressions');

  const load = useCallback(async (isRefresh = false) => {
    if (!campaignId || !isSignedIn) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true);
    try {
      const res = await api.adCampaigns.results(campaignId);
      setCampaign(res.campaign);
      setResults(res.results);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [api, campaignId, isSignedIn]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const runAction = useCallback(async (action: 'pause' | 'resume' | 'stop') => {
    if (!campaign || busy) return;
    if (action === 'stop' && !(await confirmStop())) return;
    setBusy(action);
    try {
      const res = await api.adCampaigns[action](campaign.id);
      setCampaign(res.campaign);
      void load(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't update the campaign.";
      if (Platform.OS === 'web') { if (typeof window !== 'undefined') window.alert?.(msg); } else Alert.alert('Campaign', msg);
    } finally {
      setBusy(null);
    }
  }, [api, busy, campaign, load]);

  const chartPoints = useMemo(() => (results?.daily ?? []).map((d) => ({
    label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }),
    value: metric === 'impressions' ? d.impressions : metric === 'clicks' ? d.clicks : d.spendCents,
  })), [results, metric]);

  const header = <ScreenHeader title="Campaign results" />;

  if (loading) {
    return <View style={{ flex: 1 }}>{header}<AnalyticsSkeleton kpiCount={3} listRows={4} /></View>;
  }
  if (error || !campaign || !results) {
    return (
      <View style={{ flex: 1 }}>
        {header}
        <View style={s.center}>
          <ErrorState message="Couldn't load campaign results." onRetry={() => { setLoading(true); void load(); }} />
        </View>
      </View>
    );
  }

  const badge = statusBadge(campaign);
  const done = completionText(campaign);
  const thumb = campaign.mediaUrls?.[0];
  const spentPct = results.budgetCents > 0 ? (results.spentCents / results.budgetCents) * 100 : 0;
  const totalSurfaceImpressions = results.bySurface.reduce((sum, r) => sum + r.impressions, 0);

  const tiles: { key: string; label: string; value: string; chart?: ChartMetric }[] = [
    { key: 'impressions', label: 'Impressions', value: compact(results.impressions), chart: 'impressions' },
    { key: 'reach', label: 'Reach', value: compact(results.uniqueReach) },
    { key: 'clicks', label: 'Clicks', value: compact(results.clicks), chart: 'clicks' },
    { key: 'ctr', label: 'CTR', value: `${results.ctrPercent.toFixed(2)}%` },
    { key: 'spend', label: 'Spend', value: formatCents(results.spentCents), chart: 'spend' },
    { key: 'orders', label: 'Orders', value: compact(results.attribution.orders) },
  ];

  return (
    <View style={{ flex: 1 }}>
      {header}
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
      >
        {/* Creative + controls */}
        <Card padded>
          <View style={s.creativeRow}>
            <View style={s.thumb}>
              {thumb ? <CachedImage source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
            </View>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={s.headline} numberOfLines={2}>{campaign.headline?.trim() || 'Untitled campaign'}</Text>
              <View style={s.metaRow}>
                <Badge label={badge.label} variant={badge.variant} />
                {done ? <Text style={s.meta}>{done}</Text> : null}
              </View>
            </View>
          </View>
          {(campaign.status === 'active' || campaign.status === 'paused') && (
            <View style={s.actions}>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  small
                  label="Stop"
                  onPress={() => void runAction('stop')}
                  disabled={busy !== null}
                  accent={colors.foreground}
                  style={{ width: '100%' }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <SecondaryButton
                  small
                  label={campaign.status === 'paused' ? 'Resume' : 'Pause'}
                  onPress={() => void runAction(campaign.status === 'paused' ? 'resume' : 'pause')}
                  disabled={busy !== null}
                  accent={colors.foreground}
                  style={{ width: '100%' }}
                />
              </View>
            </View>
          )}
        </Card>

        {/* Budget / duration / time */}
        <Card>
          <View style={s.row}>
            <Text style={s.rowLabel}>Budget</Text>
            <Text style={s.rowValue}>{formatCents(results.budgetCents)}</Text>
          </View>
          <CardDivider />
          <View style={[s.row, { flexDirection: 'column', alignItems: 'stretch', gap: 8 }]}>
            <View style={{ flexDirection: 'row' }}>
              <Text style={s.rowLabel}>Spent</Text>
              <Text style={s.rowValue}>
                {formatCents(results.spentCents)}
                <Text style={s.rowMuted}>{`  ·  ${formatCents(results.remainingCents)} left`}</Text>
              </Text>
            </View>
            <ProgressBar pct={spentPct} color={colors.foreground} />
          </View>
          <CardDivider />
          <View style={s.row}>
            <Text style={s.rowLabel}>Duration</Text>
            <Text style={s.rowValue}>{campaign.durationDays} {campaign.durationDays === 1 ? 'day' : 'days'}</Text>
          </View>
          <CardDivider />
          <View style={s.row}>
            <Text style={s.rowLabel}>Time</Text>
            <Text style={s.rowValue}>{shortDate(campaign.startsAt)} – {shortDate(campaign.completedAt ?? campaign.endsAt)}</Text>
          </View>
        </Card>

        {/* Performance */}
        <SectionTitle>Performance</SectionTitle>
        <View style={s.tileGrid}>
          {tiles.map((t) => {
            const selected = t.chart === metric;
            return (
              <Pressable
                key={t.key}
                onPress={t.chart ? () => setMetric(t.chart!) : undefined}
                disabled={!t.chart}
                style={[s.tile, selected && s.tileSelected]}
                accessibilityRole={t.chart ? 'button' : undefined}
                accessibilityState={t.chart ? { selected } : undefined}
                accessibilityLabel={`${t.label} ${t.value}`}
              >
                <Text style={s.tileLabel} numberOfLines={1}>{t.label}</Text>
                <Text style={s.tileValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{t.value}</Text>
              </Pressable>
            );
          })}
        </View>
        <Card padded>
          <AnalyticsBarChart
            points={chartPoints}
            color={colors.foreground}
            formatValue={metric === 'spend' ? (v) => formatCents(v) : undefined}
            emptyLabel="No delivery yet"
          />
        </Card>

        {/* Placements */}
        <SectionTitle>Placements</SectionTitle>
        <Card padded>
          {results.bySurface.map((r, i) => {
            const pct = totalSurfaceImpressions > 0 ? Math.round((r.impressions / totalSurfaceImpressions) * 100) : 0;
            return (
              <View key={r.surface} style={{ marginTop: i === 0 ? 0 : SP.md }}>
                <View style={s.surfaceHead}>
                  <Text style={s.surfaceLabel}>{SURFACE_LABELS[r.surface]}</Text>
                  <Text style={s.surfaceValue}>{pct}%</Text>
                </View>
                <ProgressBar pct={pct} color={colors.foreground} />
                <Text style={s.surfaceMeta}>
                  {`${r.impressions.toLocaleString()} impressions · ${r.clicks.toLocaleString()} clicks · ${formatCents(r.spendCents)}`}
                </Text>
              </View>
            );
          })}
        </Card>

        {/* Sales */}
        <SectionTitle note={`Orders placed within ${results.attribution.windowDays} days of a click`}>Sales</SectionTitle>
        <Card>
          <View style={s.row}>
            <Text style={s.rowLabel}>Orders</Text>
            <Text style={s.rowValue}>{results.attribution.orders.toLocaleString()}</Text>
          </View>
          <CardDivider />
          <View style={s.row}>
            <Text style={s.rowLabel}>Sales</Text>
            <Text style={s.rowValue}>{formatCents(results.attribution.revenueCents)}</Text>
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll: { flex: 1, backgroundColor: 'transparent' },
  content: { paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: 120 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  creativeRow: { flexDirection: 'row', gap: SP.md, alignItems: 'center' },
  thumb: { width: 56, height: 70, borderRadius: RADIUS.xs, overflow: 'hidden', backgroundColor: colors.elevated },
  headline: { fontSize: FS.base, fontFamily: FONT.semibold, color: colors.foreground },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  meta: { fontSize: FS.meta, fontFamily: FONT.regular, color: colors.mutedForeground },
  actions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: SP.md, paddingVertical: SP.sm + 1 },
  rowLabel: { flex: 1, fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  rowValue: { fontSize: FS.base, fontFamily: FONT.semibold, color: colors.foreground },
  rowMuted: { fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.md },
  tile: {
    width: '31.5%', flexGrow: 1, minHeight: 64, padding: SP.sm + 2, gap: 4,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
  },
  tileSelected: { borderColor: colors.foreground },
  tileLabel: { fontSize: FS.xs, fontFamily: FONT.medium, color: colors.mutedForeground },
  tileValue: { fontSize: FS.lg, fontFamily: FONT.bold, color: colors.foreground },
  surfaceHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  surfaceLabel: { fontSize: FS.sm, fontFamily: FONT.medium, color: colors.foreground },
  surfaceValue: { fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  surfaceMeta: { fontSize: FS.meta, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 6 },
});
