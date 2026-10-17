import { Icon as Feather } from '@/components/ui/Icon';
/**
 * Your Activity — real engagement counts and recent history: posts, saved
 * items and reposts (social / saved-items services), likes and comments
 * (GET /api/buyer/activity) and search history (GET /api/public/search/recent).
 * No hard-coded numbers. Time spent in the app is not tracked anywhere, so
 * this screen does not show it (item 110).
 */
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { FONT, ICON } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { getMyPosts, getSavedItems } from '@/services/socialService';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card, ErrorState, ListRow, SkeletonBlock, SkeletonLine } from '@/components/ui';
import { useApi, type BuyerActivityResponse } from '@/lib/api';
import { activityDateLabel, activitySnippet, searchCountLabel } from '@/lib/yourActivity';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';

function StatsSkeleton({ s }: { s: Styles }) {
  return (
    <>
      <SkeletonLine width={72} height={12} style={{ marginBottom: SPACING.sm, marginTop: SPACING.md }} />
      <View style={s.statsGrid}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={s.statCard}>
            <SkeletonBlock width={20} height={20} radius={4} />
            <SkeletonLine width="40%" height={22} style={{ marginTop: SPACING.xs }} />
            <SkeletonLine width="60%" height={12} />
            <SkeletonLine width="80%" height={11} />
          </View>
        ))}
      </View>
    </>
  );
}

type Styles = ReturnType<typeof makeStyles>;

export default function BuyerYourActivity() {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const { userId } = useAuth();
  const [postCount, setPostCount] = useState(0);
  const [savedCount, setSavedCount] = useState(0);
  const [repostCount, setRepostCount] = useState(0);
  const [moreReposts, setMoreReposts] = useState(false);
  const [activity, setActivity] = useState<BuyerActivityResponse | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const loadData = useCallback(async () => {
    // isBuyerDevPreview() (not just !userId): a stubbed/fake-signed-in
    // Clerk session (this app's own audit/e2e harnesses fake a signed-in
    // user so protected screens render at all) still reports a truthy
    // userId, which would otherwise fall through to getSavedItems()'s real,
    // backend-less-in-preview endpoint below and log a console 404 (getMyPosts
    // already checks isBuyerDevPreview() internally; getMyReposts is local-
    // storage-only and already safe).
    if (!userId || isBuyerDevPreview()) {
      setPostCount(0);
      setSavedCount(0);
      setRepostCount(0);
      setActivity(null);
      setRecentSearches([]);
      setLoadError(false);
      setLoaded(true);
      return;
    }
    setLoadError(false);
    try {
      // Reposts come from the server (#146): feed reposts never touched the
      // old on-device list, so this count used to stay at 0.
      const [posts, saved, reposts, mine, recent] = await Promise.all([getMyPosts(), getSavedItems(), api.posts.myReposts(), api.buyer.activity(), api.public.recent(30)]);
      setPostCount(posts.filter(p => !p.isDraft && !p.isArchived).length);
      setSavedCount(saved.length);
      setRepostCount(reposts.items.length);
      setMoreReposts(!!reposts.nextCursor);
      setActivity(mine);
      setRecentSearches(recent.recent.map(r => r.query));
    } catch (error) {
      // Don't show a false "0 across the board" empty state on a failed
      // fetch — surface a real error with a retry instead.
      setLoadError(true);
    } finally {
      setLoaded(true);
    }
  }, [userId, api]);
  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  const activityItems = [
    { icon: 'image' as const, label: 'Posts', value: String(postCount), sub: 'Your profile', color: theme.accent },
    { icon: 'bookmark' as const, label: 'Saved items', value: String(savedCount), sub: 'Across all types', color: theme.accentLight },
    { icon: 'repeat' as const, label: 'Reposts', value: `${repostCount}${moreReposts ? '+' : ''}`, sub: 'To your profile', color: theme.accent, href: '/buyer-reposts' },
  ];
  const interactionItems = [
    { icon: 'heart' as const, label: 'Likes', value: String(activity?.likes.total ?? 0), sub: 'Posts you liked' },
    { icon: 'message-square' as const, label: 'Comments', value: String(activity?.comments.total ?? 0), sub: 'Comments and replies' },
    { icon: 'search' as const, label: 'Searches', value: searchCountLabel(recentSearches.length, 30), sub: 'Recent search terms' },
  ];
  const openPost = (postId: string) => router.push(`/buyer-post-viewer?postId=${encodeURIComponent(postId)}` as never);

  return (
    <View style={s.page}>
      <ScreenHeader title="Your activity" />

      <ScrollView
        contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + SPACING.xxxl }}
        showsVerticalScrollIndicator={false}
      >
        {!loaded ? (
          <StatsSkeleton s={s} />
        ) : loadError ? (
          <ErrorState
            message="Couldn't load your activity. Check your connection and try again."
            onRetry={() => { setLoaded(false); void loadData(); }}
          />
        ) : (
          <>
            {/* Interaction stats grid */}
            <Text style={s.groupLabel}>Content</Text>
            <View style={s.statsGrid}>
              {activityItems.map(item => {
                const card = (
                  <Card key={item.label} style={s.statCard}>
                    <Icon name={item.icon} size={ICON.md} color={item.color} />
                    <Text style={s.statValue}>{item.value}</Text>
                    <Text style={s.statLabel}>{item.label}</Text>
                    <Text style={s.statSub}>{item.sub}</Text>
                  </Card>
                );
                // Reposts opens the grid of what you reposted (#146).
                return 'href' in item && item.href ? (
                  <Pressable key={item.label} style={s.statCardPress} onPress={() => router.push(item.href as never)}
                    accessibilityRole="button" accessibilityLabel={`${item.label}, ${item.value}`} testID="your-activity-reposts">
                    {card}
                  </Pressable>
                ) : card;
              })}
            </View>

            <Text style={s.groupLabel}>Interactions</Text>
            <View style={s.statsGrid}>
              {interactionItems.map(item => (
                <Card key={item.label} style={s.statCard}>
                  <Feather name={item.icon} size={ICON.md} color={theme.text} />
                  <Text style={s.statValue}>{item.value}</Text>
                  <Text style={s.statLabel}>{item.label}</Text>
                  <Text style={s.statSub}>{item.sub}</Text>
                </Card>
              ))}
            </View>

            <Text style={s.groupLabel}>Recent likes</Text>
            {(activity?.likes.items.length ?? 0) === 0 ? (
              <Text style={s.empty}>Posts you like will show up here.</Text>
            ) : (
              <Card style={s.card}>
                {activity!.likes.items.slice(0, 5).map(item => (
                  <ListRow
                    key={`like-${item.postId}`}
                    icon="heart"
                    iconColor={theme.text}
                    title={item.authorName}
                    subtitle={[activitySnippet(item.caption), activityDateLabel(item.likedAt)].filter(Boolean).join(' · ')}
                    chevron
                    onPress={() => openPost(item.postId)}
                  />
                ))}
              </Card>
            )}

            <Text style={s.groupLabel}>Recent comments</Text>
            {(activity?.comments.items.length ?? 0) === 0 ? (
              <Text style={s.empty}>Comments you write will show up here.</Text>
            ) : (
              <Card style={s.card}>
                {activity!.comments.items.slice(0, 5).map(item => (
                  <ListRow
                    key={`comment-${item.id}`}
                    icon={item.isReply ? 'corner-down-right' : 'message-square'}
                    iconColor={theme.text}
                    title={activitySnippet(item.body) || 'Comment'}
                    subtitle={`On ${item.authorName}'s post · ${activityDateLabel(item.createdAt)}`}
                    chevron
                    onPress={() => openPost(item.postId)}
                  />
                ))}
              </Card>
            )}

            <Text style={s.groupLabel}>Search history</Text>
            <Card style={s.card}>
              {recentSearches.slice(0, 5).map(term => (
                <ListRow key={`search-${term}`} icon="clock" iconColor={theme.muted} title={term} />
              ))}
              <ListRow
                icon="search"
                iconColor={theme.text}
                title={recentSearches.length > 0 ? 'See all searches' : 'No recent searches'}
                subtitle="Review or clear what you've searched for"
                chevron
                onPress={() => router.push('/buyer-search-history' as never)}
              />
            </Card>
          </>
        )}
        <Text style={s.groupLabel}>History</Text>
        <Card style={s.card}>
          <ListRow
            icon="play-circle"
            iconColor={theme.text}
            title="Recently watched"
            subtitle="Videos from the last 36 hours"
            chevron
            onPress={() => router.push('/buyer-recently-watched' as never)}
          />
        </Card>
        {/* Archive lists archived posts; reachable even if the stats fail to load. */}
        <Text style={s.groupLabel}>Manage</Text>
        <Card style={s.card}>
          <ListRow
            icon="archive"
            iconColor={theme.accent}
            title="Archive"
            chevron
            onPress={() => router.push('/buyer-archive' as never)}
          />
        </Card>
      </ScrollView>
    </View>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.background },
  groupLabel: {
    ...TYPE_SCALE.caption,
    fontFamily: FONT.semibold,
    color: theme.muted,
    marginBottom: SPACING.sm,
    marginTop: SPACING.md,
  },
  // Three equal cards across — the 45% min width wrapped Reposts onto its
  // own full-width row.
  statsGrid: { flexDirection: 'row', gap: SPACING.sm },
  statCard: { flex: 1, minWidth: 0, gap: 4 },
  statValue: { fontVariant: ['tabular-nums'],  ...TYPE_SCALE.title2, color: theme.text },
  statCardPress: { flex: 1, minWidth: 0, display: 'flex' },
  statLabel: { ...TYPE_SCALE.footnote, fontFamily: FONT.medium, color: theme.text },
  statSub: { ...TYPE_SCALE.caption, color: theme.muted },
  empty: { ...TYPE_SCALE.footnote, color: theme.muted },
  card: { paddingVertical: SPACING.xxs, paddingHorizontal: SPACING.md, overflow: 'hidden' },
});
