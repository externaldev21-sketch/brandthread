/**
 * Threads and videos — views, engagement and sales from the seller's posts.
 * Mobbin reference: TikTok Studio Analytics "Content" (range pills, "Key
 * metrics" grid, line chart, "Your top posts" ranked list with thumbnails),
 * reskinned to the Brandthread palette. Data: GET /api/analytics/insights/content.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, SP } from '@/lib/theme';
import { formatCompactCount } from '@/lib/compactFormat';
import { formatMoney } from '@/lib/format';
import { EmptyState } from '@/components/BrandthreadUI';
import { Card, CardDivider, PillTabs, SectionTitle, StatRow } from '@/components/analytics/AnalyticsKit';
import { InsightFrame } from '@/components/analytics/InsightFrame';
import { InsightLineChart, KpiGrid, RankedRow } from '@/components/analytics/InsightCharts';
import { useSellerInsight } from '@/hooks/useSellerInsight';
import { DEFAULT_INSIGHT_RANGE, getContentStats, getPostShopClicks, type ContentPost, type InsightRange } from '@/services/sellerInsightsService';

type Sort = 'views' | 'likes' | 'revenue';
const TYPE_LABEL = { video: 'Video', slideshow: 'Slideshow', image: 'Photo' } as const;

function sortPosts(posts: ContentPost[], sort: Sort): ContentPost[] {
  const key = sort === 'views' ? 'views' : sort === 'likes' ? 'likes' : 'revenueCents';
  return [...posts].sort((a, b) => b[key] - a[key] || b.views - a.views);
}

export default function ContentReport() {
  const colors = useColors();
  const router = useRouter();
  const s = React.useMemo(() => styles(colors), [colors]);
  const [range, setRange] = useState<InsightRange>(DEFAULT_INSIGHT_RANGE);
  const [sort, setSort] = useState<Sort>('views');
  const { data, loading, error, reload } = useSellerInsight(() => getContentStats(range), [range]);
  // Shop-button clicks per post (all time) — the existing post-clicks report.
  const shopClicks = useSellerInsight(() => getPostShopClicks(), []);

  const t = data?.totals;
  const hasData = !!data && (data.totals.views > 0 || data.posts.length > 0 || data.totals.followerGrowth > 0);
  const posts = data ? sortPosts(data.posts, sort).slice(0, 20) : [];
  return (
    <InsightFrame title="Content Analytics" loading={loading && !data} error={error && !data} onRetry={reload} onRefresh={() => { void reload(); void shopClicks.reload(); }} range={range} onRangeChange={setRange}>
      {!data ? null : !hasData ? (
        <EmptyState
          icon="video"
          title="No views yet"
          description="Post a Thread to see how it performs."
          action={{ label: 'Create post', onPress: () => router.push('/create-post' as never) }}
          actionVariant="pill"
          style={{ marginTop: SP.lg }}
          testID="content-analytics-empty"
        />
      ) : (
        <>
          <KpiGrid range={range} items={[
            { key: 'views', label: 'Post views', value: formatCompactCount(t!.views), changePct: data.deltas.viewsPct, featured: true },
            { key: 'likes', label: 'Likes', value: formatCompactCount(t!.likes), changePct: data.deltas.likesPct },
            { key: 'comments', label: 'Comments', value: formatCompactCount(t!.comments), changePct: data.deltas.commentsPct },
            { key: 'shares', label: 'Shares', value: formatCompactCount(t!.shares), changePct: data.deltas.sharesPct },
            { key: 'saves', label: 'Saves', value: formatCompactCount(t!.saves), changePct: data.deltas.savesPct },
            { key: 'followers', label: 'New followers', value: formatCompactCount(t!.followerGrowth), changePct: data.deltas.followerGrowthPct },
          ]} />

          <SectionTitle>Views</SectionTitle>
          <Card padded>
            <InsightLineChart range={range} points={data.buckets.map(b => ({ bucket: b.bucket, value: b.views }))} />
          </Card>

          <SectionTitle>Shopping from posts</SectionTitle>
          <Card>
            <StatRow label="Product taps" value={formatCompactCount(t!.productClicks)} />
            <CardDivider />
            <StatRow label="Added to bag" value={formatCompactCount(t!.addToCarts)} />
            <CardDivider />
            <StatRow label="Purchases" value={formatCompactCount(t!.purchases)} />
            <CardDivider />
            <StatRow label="Revenue from posts" value={formatMoney(t!.revenueCents)} changePct={data.deltas.revenuePct ?? undefined} />
            <CardDivider />
            <StatRow label="Profile visits from posts" value={formatCompactCount(t!.profileVisits)} />
            {t!.avgWatchSeconds !== null && (<><CardDivider /><StatRow label="Average watch time" value={`${t!.avgWatchSeconds}s`} /></>)}
          </Card>

          <SectionTitle note="All time, from the Shop button on each post.">Shop clicks by post</SectionTitle>
          {shopClicks.error && !shopClicks.data ? (
            <Card><Text style={s.empty}>Couldn{'\u2019'}t load shop clicks. Pull to refresh.</Text></Card>
          ) : !shopClicks.data ? null : shopClicks.data.length === 0 ? (
            <Card><Text style={s.empty}>No shop clicks on your posts yet.</Text></Card>
          ) : (
            <Card>
              {shopClicks.data.map((p, i) => (
                <View key={p.postId}>
                  {i > 0 && <CardDivider />}
                  <RankedRow
                    rank={i + 1}
                    thumbnailUrl={p.thumbnailUrl}
                    icon="shopping-bag"
                    title={p.caption || 'Untitled post'}
                    subtitle={`${formatCompactCount(p.uniqueClickers)} ${p.uniqueClickers === 1 ? 'person' : 'people'}`}
                    value={formatCompactCount(p.clicks)}
                    valueLabel={p.clicks === 1 ? 'click' : 'clicks'}
                    onPress={() => router.push(`/post-analytics?id=${encodeURIComponent(p.postId)}` as never)}
                  />
                </View>
              ))}
            </Card>
          )}

          <SectionTitle>Top posts</SectionTitle>
          <PillTabs
            scroll={false}
            options={[{ key: 'views', label: 'Most views' }, { key: 'likes', label: 'Most likes' }, { key: 'revenue', label: 'Most sales' }] as const}
            value={sort}
            onChange={setSort}
          />
          {posts.length === 0 ? (
            <Card><Text style={s.empty}>No posts were viewed in this period.</Text></Card>
          ) : (
            <Card>
              {posts.map((p, i) => (
                <View key={p.postId}>
                  {i > 0 && <CardDivider />}
                  <RankedRow
                    rank={i + 1}
                    thumbnailUrl={p.thumbnailUrl}
                    icon={p.type === 'video' ? 'play-circle' : 'image'}
                    title={p.caption || `Untitled ${TYPE_LABEL[p.type].toLowerCase()}`}
                    subtitle={`${TYPE_LABEL[p.type]} · ${formatCompactCount(p.likes)} likes · ${formatCompactCount(p.saves)} saves`}
                    value={sort === 'revenue' ? formatMoney(p.revenueCents) : sort === 'likes' ? formatCompactCount(p.likes) : formatCompactCount(p.views)}
                    valueLabel={sort === 'revenue' ? `${p.purchases} sold` : sort === 'likes' ? 'likes' : 'views'}
                    onPress={() => router.push(`/post-analytics?id=${encodeURIComponent(p.postId)}` as never)}
                  />
                </View>
              ))}
            </Card>
          )}

          <SectionTitle>By format</SectionTitle>
          <Card>
            {data.byType.map((row, i) => (
              <View key={row.type}>
                {i > 0 && <CardDivider />}
                <StatRow label={`${TYPE_LABEL[row.type]}s · ${row.posts} viewed`} value={`${formatCompactCount(row.views)} views`} />
              </View>
            ))}
          </Card>
        </>
      )}
    </InsightFrame>
  );
}

const styles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  empty: { fontSize: FS.sm, fontFamily: FONT.regular, color: colors.mutedForeground, padding: SP.md },
});
