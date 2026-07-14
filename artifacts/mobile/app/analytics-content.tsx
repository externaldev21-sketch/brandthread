/**
 * Content Analytics — Brandthread Seller App
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Platform, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, CARD, CARD_ELEVATED, BORDER, FG, MUTED, SUBTLE,
  PURPLE, PURPLE_DIM, PURPLE_LIGHT, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, GOLD, RED,
  FONT, FS,
} from '@/lib/theme';
import { getContentAnalytics, getFilterState } from '@/services/analyticsService';
import { ContentAnalytics, ContentPostRow, VideoRetentionPoint, AnalyticsMetric, AnalyticsFilterState } from '@/services/analyticsTypes';

function MetricTile({ m }: { m: AnalyticsMetric }) {
  const upColor = m.trend === 'up' ? SUCCESS : RED;
  return (
    <View style={s.tile}>
      <Text style={s.tileValue}>{m.formatted}</Text>
      <Text style={s.tileLabel} numberOfLines={1}>{m.label}</Text>
      <Text style={[s.tileChange, { color: m.trend === 'flat' ? MUTED : upColor }]}>
        {m.changePct > 0 ? '+' : ''}{m.changePct.toFixed(1)}%
      </Text>
    </View>
  );
}

function PostCard({ p }: { p: ContentPostRow }) {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => { Haptics.selectionAsync(); router.push(`/post-analytics?id=${p.postId}` as never); }}
      style={s.postCard}
      activeOpacity={0.8}
    >
      <View style={s.postThumb}>
        <Feather name={p.type === 'video' ? 'play-circle' : 'image'} size={22} color={PURPLE} />
        <View style={s.postTypeBadge}>
          <Text style={s.postTypeText}>{p.type === 'video' ? 'Vid' : p.type === 'slideshow' ? 'SS' : 'Img'}</Text>
        </View>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.postCaption} numberOfLines={1}>{p.caption}</Text>
        <View style={s.postMetaRow}>
          <Feather name="eye" size={10} color={MUTED} />
          <Text style={s.postMeta}>{(p.views / 1000).toFixed(1)}K</Text>
          <Feather name="heart" size={10} color={MUTED} />
          <Text style={s.postMeta}>{p.likes.toLocaleString()}</Text>
          <Feather name="shopping-bag" size={10} color={MUTED} />
          <Text style={s.postMeta}>{p.productClicks}</Text>
        </View>
        <View style={s.postRevenueRow}>
          <Text style={s.postRevenue}>${p.revenue.toLocaleString()}</Text>
          <Text style={s.postCompletion}>{p.completionRate}% completion</Text>
        </View>
      </View>
      <Feather name="chevron-right" size={16} color={SUBTLE} />
    </TouchableOpacity>
  );
}

function RetentionGraph({ points }: { points: VideoRetentionPoint[] }) {
  const max = 100;
  return (
    <View>
      <View style={s.retentionWrap}>
        {points.map((p, i) => (
          <View key={i} style={s.retentionBarWrap}>
            <View style={[s.retentionBar, { height: `${p.retentionPct}%`, backgroundColor: p.retentionPct < 40 ? RED : p.retentionPct < 60 ? ORANGE : SUCCESS }]} />
          </View>
        ))}
      </View>
      <View style={s.retentionXRow}>
        {['0%','25%','50%','75%','100%'].map(l => (
          <Text key={l} style={s.retentionX}>{l}</Text>
        ))}
      </View>
      <View style={s.retentionLegend}>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: SUCCESS }]} /><Text style={s.legendText}>High retention</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: ORANGE }]} /><Text style={s.legendText}>Drop-off</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: RED }]} /><Text style={s.legendText}>Low</Text></View>
      </View>
    </View>
  );
}

export default function AnalyticsContentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const [data,       setData]       = useState<ContentAnalytics | null>(null);
  const [filter,     setFilter]     = useState<AnalyticsFilterState | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<'videos' | 'slideshows' | 'top_revenue'>('videos');

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const f = filter ?? await getFilterState();
    if (!filter) setFilter(f);
    setData(await getContentAnalytics(f));
    setLoading(false); setRefreshing(false);
  }, [filter]);

  useEffect(() => { load(); }, []); // eslint-disable-line

  const posts: ContentPostRow[] = data
    ? (tab === 'videos' ? data.topVideos : tab === 'slideshows' ? data.topSlideshows : data.highestRevenuePosts)
    : [];

  if (loading) {
    return <View style={[s.loadWrap, { paddingTop: topPad + 48 }]}><ActivityIndicator size="large" color={PURPLE} /></View>;
  }

  return (
    <ScrollView
      style={s.scroll}
      contentContainerStyle={[s.content, { paddingTop: topPad + 12 }]}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={PURPLE} />}
    >
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.pageTitle}>Content Analytics</Text>
          <Text style={s.subtitle}>{filter?.dateRange.label ?? '30 days'}</Text>
        </View>
      </View>

      {/* Metric tiles grid */}
      <Text style={s.sectionTitle}>Performance</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 10, flexDirection: 'row', paddingRight: 16 }}>
        {data && [data.views, data.uniqueViewers, data.likes, data.saves, data.shares, data.productClicks, data.purchases, data.revenueAttributed, data.avgWatchTime, data.completionRate, data.followerGrowth].map(m => (
          <MetricTile key={m.key} m={m} />
        ))}
      </ScrollView>

      {/* Attribution summary */}
      <View style={s.attrCard}>
        <Feather name="dollar-sign" size={16} color={GOLD} />
        <View style={{ flex: 1 }}>
          <Text style={s.attrTitle}>Content-attributed revenue</Text>
          <Text style={s.attrSub}>Purchases that started from a Seller post in the last 7 days</Text>
        </View>
        <Text style={s.attrValue}>{data?.revenueAttributed.formatted ?? '—'}</Text>
      </View>

      {/* Post rankings */}
      <View style={s.tabRow}>
        {([['videos','Top Videos'],['slideshows','Slideshows'],['top_revenue','By Revenue']] as const).map(([k, l]) => (
          <TouchableOpacity key={k} onPress={() => { Haptics.selectionAsync(); setTab(k as never); }} style={[s.tabBtn, tab === k && s.tabBtnActive]}>
            <Text style={[s.tabBtnText, tab === k && s.tabBtnTextActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {posts.length === 0 ? (
        <View style={s.emptyState}>
          <Feather name="video" size={36} color={MUTED} />
          <Text style={s.emptyTitle}>No content data</Text>
          <Text style={s.emptyBody}>Publish Seller content to begin tracking performance.</Text>
        </View>
      ) : (
        <View style={s.card}>
          {posts.map((p, i) => (
            <View key={p.postId}>
              {i > 0 && <View style={s.divider} />}
              <PostCard p={p} />
            </View>
          ))}
        </View>
      )}

      {/* Video retention */}
      {data && data.retention.length > 0 && (
        <>
          <Text style={s.sectionTitle}>Video Retention</Text>
          <View style={[s.card, { padding: 16 }]}>
            <View style={s.retentionStats}>
              <View style={s.retStat}><Text style={s.retStatValue}>{data.avgWatchTime.formatted}s</Text><Text style={s.retStatLabel}>Avg watch time</Text></View>
              <View style={s.retStat}><Text style={s.retStatValue}>{data.completionRate.formatted}</Text><Text style={s.retStatLabel}>Completion</Text></View>
            </View>
            <RetentionGraph points={data.retention} />
          </View>
        </>
      )}

      <View style={{ height: 120 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll:   { flex: 1, backgroundColor: BG },
  content:  { paddingHorizontal: 16 },
  loadWrap: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' },
  header:   { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  backBtn:  { width: 36, height: 36, borderRadius: 18, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  pageTitle:{ fontSize: 22, fontFamily: FONT.bold, color: FG },
  subtitle: { fontSize: 12, fontFamily: FONT.regular, color: MUTED },
  sectionTitle:{ fontSize: 15, fontFamily: FONT.semibold, color: FG, marginBottom: 10 },
  card:     { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 20, overflow: 'hidden' },
  divider:  { height: 1, backgroundColor: BORDER, marginHorizontal: 16 },
  tile:     { width: 110, backgroundColor: CARD, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: BORDER },
  tileValue:{ fontSize: 18, fontFamily: FONT.bold, color: FG, marginBottom: 2 },
  tileLabel:{ fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginBottom: 2 },
  tileChange:{ fontSize: 10, fontFamily: FONT.medium },
  attrCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CARD_ELEVATED, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 20 },
  attrTitle:{ fontSize: 13, fontFamily: FONT.semibold, color: FG },
  attrSub:  { fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  attrValue:{ fontSize: 18, fontFamily: FONT.bold, color: GOLD },
  tabRow:   { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tabBtn:   { flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center' },
  tabBtnActive:{ backgroundColor: PURPLE_DIM, borderColor: PURPLE },
  tabBtnText:{ fontSize: 12, fontFamily: FONT.medium, color: MUTED },
  tabBtnTextActive:{ color: PURPLE_LIGHT },
  postCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  postThumb:{ width: 50, height: 50, borderRadius: 10, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  postTypeBadge:{ position: 'absolute', top: 2, right: 2, backgroundColor: CARD, borderRadius: 4, paddingHorizontal: 3 },
  postTypeText:{ fontSize: 8, fontFamily: FONT.bold, color: MUTED },
  postCaption:{ fontSize: 13, fontFamily: FONT.semibold, color: FG, marginBottom: 4 },
  postMetaRow:{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  postMeta: { fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  postRevenueRow:{ flexDirection: 'row', alignItems: 'center', gap: 8 },
  postRevenue:{ fontSize: 13, fontFamily: FONT.bold, color: SUCCESS },
  postCompletion:{ fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  retentionStats:{ flexDirection: 'row', gap: 20, marginBottom: 16 },
  retStat:  { gap: 2 },
  retStatValue:{ fontSize: 18, fontFamily: FONT.bold, color: FG },
  retStatLabel:{ fontSize: 11, fontFamily: FONT.regular, color: MUTED },
  retentionWrap:{ flexDirection: 'row', alignItems: 'flex-end', height: 80, gap: 3, marginBottom: 6 },
  retentionBarWrap:{ flex: 1, height: 80, justifyContent: 'flex-end' },
  retentionBar:{ width: '100%', borderRadius: 3 },
  retentionXRow:{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  retentionX:{ fontSize: 9, fontFamily: FONT.regular, color: SUBTLE },
  retentionLegend:{ flexDirection: 'row', gap: 12, marginTop: 10 },
  legendItem:{ flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:{ width: 8, height: 8, borderRadius: 4 },
  legendText:{ fontSize: 10, fontFamily: FONT.regular, color: MUTED },
  emptyState:{ alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyTitle:{ fontSize: 16, fontFamily: FONT.semibold, color: FG },
  emptyBody:{ fontSize: 13, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', paddingHorizontal: 24 },
});
