/**
 * Content Analytics — Brandthread Seller App
 *
 * Mobbin reference: eBay "Performance" scrollable metric-tile row + Shopify
 * "Marketing" channel-card grid (https://mobbin.com/screens/14328f90-76c9-44b6-8675-f0c534c2fba7,
 * https://mobbin.com/screens/6122bfe2-f660-4354-8c46-545ed12c96ba) informed the
 * metric tile strip, attribution card and ranked post list.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import { useColors } from '@/hooks/useColors';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, COMP } from '@/lib/theme';
import { getContentAnalytics, getFilterState } from '@/services/analyticsService';
import { ContentAnalytics, ContentPostRow, VideoRetentionPoint, AnalyticsFilterState } from '@/services/analyticsTypes';
import { EmptyState } from '@/components/BrandthreadUI';
import {
  AnalyticsHeader, AnalyticsSkeleton, Card, CardDivider, PillTabs, SectionTitle, StatTileRow,
} from '@/components/analytics/AnalyticsKit';

function PostCard({ p }: { p: ContentPostRow }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); router.push(`/post-analytics?id=${p.postId}` as never); }}
      style={s.postCard}
      activeOpacity={0.8}
    >
      <View style={s.postThumb}>
        <Feather name={p.type === 'video' ? 'play-circle' : 'image'} size={22} color={colors.primary} />
        <View style={s.postTypeBadge}>
          <Text style={s.postTypeText}>{p.type === 'video' ? 'Vid' : p.type === 'slideshow' ? 'SS' : 'Img'}</Text>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.postCaption} numberOfLines={1}>{p.caption}</Text>
        <View style={s.postMetaRow}>
          <Feather name="eye" size={10} color={colors.mutedForeground} />
          <Text style={s.postMeta}>{(p.views / 1000).toFixed(1)}K</Text>
          <Feather name="heart" size={10} color={colors.mutedForeground} />
          <Text style={s.postMeta}>{p.likes.toLocaleString()}</Text>
          <Feather name="shopping-bag" size={10} color={colors.mutedForeground} />
          <Text style={s.postMeta}>{p.productClicks}</Text>
        </View>
        <View style={s.postRevenueRow}>
          <Text style={s.postRevenue}>${p.revenue.toLocaleString()}</Text>
          <Text style={s.postCompletion}>{p.completionRate}% completion</Text>
        </View>
      </View>
      <Feather name="chevron-right" size={16} color={colors.subtle} />
    </TouchableOpacity>
  );
}

function RetentionGraph({ points }: { points: VideoRetentionPoint[] }) {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  return (
    <View>
      <View style={s.retentionWrap}>
        {points.map((p, i) => (
          <View key={i} style={s.retentionBarWrap}>
            <View style={[s.retentionBar, { height: `${p.retentionPct}%`, backgroundColor: p.retentionPct < 40 ? colors.destructive : p.retentionPct < 60 ? colors.warning : colors.success }]} />
          </View>
        ))}
      </View>
      <View style={s.retentionXRow}>
        {['0%', '25%', '50%', '75%', '100%'].map(l => (
          <Text key={l} style={s.retentionX}>{l}</Text>
        ))}
      </View>
      <View style={s.retentionLegend}>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: colors.success }]} /><Text style={s.legendText}>High retention</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: colors.warning }]} /><Text style={s.legendText}>Drop-off</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: colors.destructive }]} /><Text style={s.legendText}>Low</Text></View>
      </View>
    </View>
  );
}

export default function AnalyticsContentScreen() {
  const colors = useColors();
  const s = React.useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { isLoaded: authLoaded, userId } = useAuth();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [data,       setData]       = useState<ContentAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<'videos' | 'slideshows' | 'top_revenue'>('videos');
  const requestUser = useRef<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!authLoaded || !userId) return;
    const requestedUser = userId;
    requestUser.current = requestedUser;
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const f = filter ?? await getFilterState();
      if (!filter) setFilter(f);
      const next = await getContentAnalytics(f);
      if (requestUser.current !== requestedUser) return;
      setData(next);
    } catch (err) {
      if (requestUser.current !== requestedUser) return;
    } finally { setLoading(false); setRefreshing(false); }
  }, [filter, authLoaded, userId]);

  useEffect(() => {
    requestUser.current = null;
    setData(null); setFilter(null);
    setLoading(!authLoaded);
    if (authLoaded && userId) { setLoading(true); load(); }
  }, [authLoaded, userId]); // load reads the current filter

  const posts: ContentPostRow[] = data
    ? (tab === 'videos' ? data.topVideos : tab === 'slideshows' ? data.topSlideshows : data.highestRevenuePosts)
    : [];

  if (loading) {
    return <AnalyticsSkeleton topPad={topPad} kpiCount={3} listRows={3} />;
  }
  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={colors.primary} />}
    >
      <AnalyticsHeader title="Content Analytics" subtitle={filter?.dateRange.label ?? '30 days'} />

      {!data ? (
        <EmptyState
          icon="video"
          title="Content insights are on the way"
          description="We'll show post performance once your Seller posts start getting views."
          style={{ marginTop: SP.lg }}
        />
      ) : (
        <>
          {/* Metric tiles grid */}
          <SectionTitle>Performance</SectionTitle>
          <StatTileRow
            scroll
            items={[data.views, data.uniqueViewers, data.likes, data.saves, data.shares, data.productClicks, data.purchases, data.revenueAttributed, data.avgWatchTime, data.completionRate, data.followerGrowth]
              .map(m => ({ key: m.key, label: m.label, value: m.formatted, changePct: m.changePct }))}
          />

          {/* Attribution summary */}
          <View style={s.attrCard}>
            <Feather name="dollar-sign" size={16} color={colors.warning} />
            <View style={{ flex: 1 }}>
              <Text style={s.attrTitle}>Content-attributed revenue</Text>
              <Text style={s.attrSub}>Purchases that started from a Seller post in the last 7 days</Text>
            </View>
            <Text style={s.attrValue}>{data.revenueAttributed.formatted}</Text>
          </View>

          {/* Post rankings */}
          <PillTabs
            scroll={false}
            options={[
              { key: 'videos', label: 'Top Videos' },
              { key: 'slideshows', label: 'Slideshows' },
              { key: 'top_revenue', label: 'By Revenue' },
            ] as const}
            value={tab}
            onChange={setTab}
          />

          {posts.length === 0 ? (
            <EmptyState icon="video" title="No post stats yet" description="Post stats will land here soon." />
          ) : (
            <Card>
              {posts.map((p, i) => (
                <View key={p.postId}>
                  {i > 0 && <CardDivider />}
                  <PostCard p={p} />
                </View>
              ))}
            </Card>
          )}

          {/* Video retention */}
          {data.retention.length > 0 && (
            <>
              <SectionTitle>Video Retention</SectionTitle>
              <Card padded>
                <View style={s.retentionStats}>
                  <View style={s.retStat}><Text style={s.retStatValue}>{data.avgWatchTime.formatted}s</Text><Text style={s.retStatLabel}>Avg watch time</Text></View>
                  <View style={s.retStat}><Text style={s.retStatValue}>{data.completionRate.formatted}</Text><Text style={s.retStatLabel}>Completion</Text></View>
                </View>
                <RetentionGraph points={data.retention} />
              </Card>
            </>
          )}
        </>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const createStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: 'transparent' },
  content:  { paddingHorizontal: SP.md },
  attrCard: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: colors.elevated, borderRadius: RADIUS.md, padding: SP.sm + 2, borderWidth: 1, borderColor: colors.border, marginBottom: SP.lg },
  attrTitle:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground },
  attrSub:  { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground, marginTop: 2 },
  attrValue:{ fontSize: FS.lg, fontFamily: FONT.bold, color: colors.warning },
  postCard: { flexDirection: 'row', alignItems: 'center', minHeight: COMP.minTouchTarget, paddingHorizontal: SP.sm + 2, paddingVertical: SP.sm, gap: SP.sm },
  postThumb:{ width: 50, height: 50, borderRadius: RADIUS.sm, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  postTypeBadge:{ position: 'absolute', top: 2, right: 2, backgroundColor: colors.card, borderRadius: 4, paddingHorizontal: 3 },
  postTypeText:{ fontSize: FS.xs, fontFamily: FONT.bold, color: colors.mutedForeground },
  postCaption:{ fontSize: FS.sm, fontFamily: FONT.semibold, color: colors.foreground, marginBottom: 4 },
  postMetaRow:{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  postMeta: { fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  postRevenueRow:{ flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  postRevenue:{ fontSize: FS.sm, fontFamily: FONT.bold, color: colors.success },
  postCompletion:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  retentionStats:{ flexDirection: 'row', gap: SP.lg, marginBottom: SP.md },
  retStat:  { gap: 2 },
  retStatValue:{ fontSize: FS.lg, fontFamily: FONT.bold, color: colors.foreground },
  retStatLabel:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
  retentionWrap:{ flexDirection: 'row', alignItems: 'flex-end', height: 80, gap: 3, marginBottom: 6 },
  retentionBarWrap:{ flex: 1, height: 80, justifyContent: 'flex-end' },
  retentionBar:{ width: '100%', borderRadius: 3 },
  retentionXRow:{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  retentionX:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.subtle },
  retentionLegend:{ flexDirection: 'row', gap: SP.sm + 4, marginTop: SP.sm },
  legendItem:{ flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:{ width: 8, height: 8, borderRadius: 4 },
  legendText:{ fontSize: FS.xs, fontFamily: FONT.regular, color: colors.mutedForeground },
});
