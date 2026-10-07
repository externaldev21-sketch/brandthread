/**
 * Live summary — the host's numbers for one live: how long it ran, who
 * watched, what sold. Opened when the host ends a live (seller-live.tsx)
 * and from the Lives card on the Analytics tab.
 *
 * Data: GET /api/live/:id/analytics (api-server routes/live-analytics.ts).
 * Sales are the orders attributed to this live (paid, not cancelled,
 * revenue net of refunds — the same definition as the rest of Analytics).
 * Polls every 15 s while the live is still on. `&demo=1` shows sample data
 * with no API calls.
 *
 * Mobbin reference: Shopee "Live Ended" summary
 * (https://mobbin.com/screens/28fcc56b-62a4-4e55-bdb3-90b3db9f726c) — title
 * + duration up top, a centered sales headline over a three-column metric
 * grid per card — and Twitch "Stream Summary"
 * (https://mobbin.com/screens/5277d9ef-ec0c-4538-93e9-e8f5611b5977) for the
 * audience grid; reskinned to the monochrome palette.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, CardDivider } from '@/components/analytics/AnalyticsKit';
import { Avatar } from '@/components/ui/Avatar';
import { CachedImage } from '@/components/CachedImage';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { LIVE_RED } from '@/components/live/LiveAvatarRing';
import {
  formatConversion, formatCount, formatLiveDate, formatLiveDuration, revenueLabel, type LiveAnalytics,
} from '@/lib/live/liveAnalytics';

const DEMO: LiveAnalytics = {
  stream: {
    id: 'demo', title: 'Fall drop — first look', status: 'ended',
    startedAt: '2026-10-07T18:02:00Z', endedAt: '2026-10-07T19:06:40Z', thumbnailUrl: null, durationSeconds: 3880,
  },
  audience: { peakViewers: 412, uniqueViewers: 1286, comments: 934, likes: 18420 },
  gifts: { count: 23, threadCashCents: 8650 },
  sales: { orders: 37, buyers: 33, units: 44, grossCents: 612400, refundedCents: 12800, revenueCents: 599600, conversionRate: 0.0257 },
  topProducts: [
    { productId: 'p1', name: 'Wool Overshirt', imageUrl: null, units: 18, revenueCents: 261000 },
    { productId: 'p2', name: 'Raw Denim Jacket', imageUrl: null, units: 11, revenueCents: 207900 },
    { productId: 'p3', name: 'Merino Crew', imageUrl: null, units: 15, revenueCents: 143500 },
  ],
  cohosts: [
    { userId: 'c1', displayName: 'Rue Studio', username: 'ruestudio', avatarUrl: null, joinedAt: '2026-10-07T18:20:00Z', orders: 6, revenueCents: 74400 },
  ],
};

export default function LiveSummaryScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const params = useLocalSearchParams<{ streamId?: string; demo?: string }>();
  const demo = params.demo === '1';
  const streamId = params.streamId ? String(params.streamId) : '';
  const s = React.useMemo(() => makeStyles(colors), [colors]);

  const [data, setData] = useState<LiveAnalytics | null>(demo ? DEMO : null);
  const [loading, setLoading] = useState(!demo);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const generation = useRef(0);

  const load = useCallback(async (isRefresh = false) => {
    if (demo || !streamId || !isSignedIn) { setLoading(false); return; }
    const mine = ++generation.current;
    if (isRefresh) setRefreshing(true);
    try {
      const r = await api.live.analytics(streamId);
      if (mine !== generation.current) return;
      setData(r);
      setFailed(false);
    } catch {
      if (mine === generation.current) setFailed(true);
    } finally {
      if (mine === generation.current) { setLoading(false); setRefreshing(false); }
    }
  }, [api, demo, streamId, isSignedIn]);

  useEffect(() => { void load(); }, [load]);

  // Numbers keep moving while the live is on (orders paid in the grace window too).
  const isLive = data?.stream.status === 'live';
  useEffect(() => {
    if (!isLive || demo) return undefined;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [isLive, demo, load]);

  const back = () => goBackOr(router, '/(tabs)/' as never);

  if (loading) {
    return (
      <View style={s.root}>
        <ScreenHeader title="Live summary" onBack={back} />
        <View style={s.center}><ActivityIndicator color={colors.foreground} /></View>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={s.root}>
        <ScreenHeader title="Live summary" onBack={back} />
        <View style={s.center}>
          <Text style={s.muted}>{failed ? 'Couldn’t load this live.' : 'This live isn’t available.'}</Text>
          {failed && <Button label="Retry" variant="secondary" size="small" onPress={() => void load()} style={{ marginTop: SP.md }} />}
        </View>
      </View>
    );
  }

  const { stream, audience, gifts, sales, topProducts, cohosts } = data;

  return (
    <View style={s.root}>
      <ScreenHeader title="Live summary" onBack={back} />
      <ScrollView
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.foreground} />}
        testID="live-summary"
      >
        {/* Hero: status, title, duration · date */}
        <View style={s.hero}>
          {isLive ? (
            <View style={s.livePill}><View style={s.liveDot} /><Text style={s.livePillText}>LIVE</Text></View>
          ) : (
            <Text style={s.heroKicker}>Live ended</Text>
          )}
          <Text style={s.heroTitle} numberOfLines={2}>{stream.title}</Text>
          <Text style={s.heroMeta}>
            {formatLiveDuration(stream.durationSeconds)} · {formatLiveDate(stream.startedAt)}
          </Text>
        </View>

        {/* Sales */}
        <Card padded>
          <Text style={s.cardTitle}>Sales</Text>
          <View style={s.headline}>
            <Text style={s.headlineLabel}>Revenue</Text>
            <Text style={s.headlineValue} testID="live-summary-revenue">{revenueLabel(sales.revenueCents)}</Text>
            {sales.refundedCents > 0 && (
              <Text style={s.headlineNote}>
                {revenueLabel(sales.grossCents)} sold · {revenueLabel(sales.refundedCents)} refunded
              </Text>
            )}
          </View>
          <View style={s.grid}>
            <Metric label="Orders" value={formatCount(sales.orders)} s={s} />
            <Metric label="Items sold" value={formatCount(sales.units)} s={s} />
            <Metric label="Conversion" value={formatConversion(sales.conversionRate)} s={s} />
          </View>
        </Card>

        {/* Audience */}
        <Card padded>
          <Text style={s.cardTitle}>Audience</Text>
          <View style={s.grid}>
            <Metric label="Viewers" value={formatCount(audience.uniqueViewers)} s={s} />
            <Metric label="Peak viewers" value={formatCount(audience.peakViewers)} s={s} />
            <Metric label="Comments" value={formatCount(audience.comments)} s={s} />
          </View>
          <View style={[s.grid, { marginTop: SP.md }]}>
            <Metric label="Likes" value={formatCount(audience.likes)} s={s} />
            <Metric label="Gifts" value={formatCount(gifts.count)} s={s} />
            <Metric label="Thread Cash" value={revenueLabel(gifts.threadCashCents)} s={s} accent={gifts.threadCashCents > 0 ? colors.success : undefined} />
          </View>
        </Card>

        {/* Top products */}
        <Card>
          <Text style={[s.cardTitle, s.cardTitleInset]}>Top products</Text>
          {topProducts.length === 0 ? (
            <Text style={[s.muted, s.emptyRow]}>No sales from this live.</Text>
          ) : topProducts.map((p, i) => (
            <React.Fragment key={p.productId ?? p.name}>
              {i > 0 && <CardDivider />}
              <View style={s.row}>
                <Text style={s.rank}>{i + 1}</Text>
                {p.imageUrl ? (
                  <CachedImage source={{ uri: p.imageUrl }} style={s.thumb} />
                ) : (
                  <View style={[s.thumb, { backgroundColor: colors.elevated ?? colors.border }]} />
                )}
                <View style={s.rowText}>
                  <Text style={s.rowTitle} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.rowSub}>{p.units} sold</Text>
                </View>
                <Text style={s.rowValue}>{revenueLabel(p.revenueCents)}</Text>
              </View>
            </React.Fragment>
          ))}
        </Card>

        {/* Co-hosts */}
        {cohosts.length > 0 && (
          <Card>
            <Text style={[s.cardTitle, s.cardTitleInset]}>Co-hosts</Text>
            {cohosts.map((c, i) => (
              <React.Fragment key={c.userId}>
                {i > 0 && <CardDivider />}
                <View style={s.row}>
                  <Avatar uri={c.avatarUrl} name={c.displayName} size={40} />
                  <View style={s.rowText}>
                    <Text style={s.rowTitle} numberOfLines={1}>{c.displayName}</Text>
                    <Text style={s.rowSub}>{c.orders === 1 ? '1 order' : `${c.orders} orders`}</Text>
                  </View>
                  <Text style={s.rowValue}>{revenueLabel(c.revenueCents)}</Text>
                </View>
              </React.Fragment>
            ))}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

function Metric({ label, value, s, accent }: { label: string; value: string; s: ReturnType<typeof makeStyles>; accent?: string }) {
  return (
    <View style={s.metric}>
      <Text style={[s.metricValue, accent ? { color: accent } : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{value}</Text>
      <Text style={s.metricLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.lg },
  muted: { color: colors.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center' },
  content: { paddingHorizontal: SP.md, paddingTop: SP.sm },
  hero: { alignItems: 'center', paddingTop: SP.sm, paddingBottom: SP.lg, gap: 6 },
  heroKicker: { color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 0.8, textTransform: 'uppercase' },
  heroTitle: { color: colors.foreground, fontFamily: FONT.bold, fontSize: FS.lg, textAlign: 'center' },
  heroMeta: { color: colors.mutedForeground, fontFamily: FONT.regular, fontSize: FS.sm },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: LIVE_RED },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  livePillText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 11, letterSpacing: 1.2 },
  cardTitle: { color: colors.foreground, fontFamily: FONT.semibold, fontSize: FS.base, marginBottom: SP.md },
  cardTitleInset: { paddingHorizontal: SP.md, paddingTop: SP.md, marginBottom: SP.xs },
  headline: { alignItems: 'center', marginBottom: SP.lg, gap: 2 },
  headlineLabel: { color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: FS.xs },
  headlineValue: { color: colors.foreground, fontFamily: FONT.bold, fontSize: 32, letterSpacing: -0.5 },
  headlineNote: { color: colors.mutedForeground, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  grid: { flexDirection: 'row' },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  metricValue: { color: colors.foreground, fontFamily: FONT.bold, fontSize: FS.lg },
  metricLabel: { color: colors.mutedForeground, fontFamily: FONT.medium, fontSize: FS.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm + 2 },
  rank: { width: 16, color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: FS.sm, textAlign: 'center' },
  thumb: { width: 40, height: 40, borderRadius: RADIUS.sm },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.foreground, fontFamily: FONT.semibold, fontSize: FS.sm },
  rowSub: { color: colors.mutedForeground, fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  rowValue: { color: colors.foreground, fontFamily: FONT.semibold, fontSize: FS.sm },
  emptyRow: { paddingHorizontal: SP.md, paddingVertical: SP.md, textAlign: 'left' },
});
