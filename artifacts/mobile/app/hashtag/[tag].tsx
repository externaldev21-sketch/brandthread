/**
 * Hashtag page — #tag title, post count, Follow, Top / Recent tabs and a
 * 3-column grid of public posts. Layout follows Instagram's hashtag page
 * (Mobbin: profile-style header block, tab row, edge-to-edge 3-up grid),
 * reskinned monochrome. Tiles reuse the profile grid's ProfileVideoTile and
 * open the existing post viewer.
 *
 * Preview: no network. Fresh preview shows the empty state; `&demo=1` fills the
 * grid from the bundled demo posts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Icon } from '@/components/ui/Icon';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/BrandthreadUI';
import { ProfileGridSkeleton, ProfileVideoTile, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { PROFILE_GRID_GAP, useProfileLayout } from '@/components/profile/profileLayout';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi, type HashtagPostItem } from '@/lib/api';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { formatCompactCount } from '@/lib/compactFormat';
import { hapticSelection, hapticToggle } from '@/lib/haptics';
import { normalizeTag } from '@/lib/hashtagText';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING, SCREEN_GUTTER } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { FASHION_PREVIEW_POSTS } from '@/app/(tabs)/feed';

type Sort = 'top' | 'recent';

function toGridItem(post: HashtagPostItem): ProfileGridItem {
  const kind = post.mediaType === 'video' ? 'video' : post.mediaType === 'slideshow' ? 'slideshow' : 'photo';
  return {
    id: post.id,
    kind,
    posterUri: kind === 'video' ? post.thumbnailUrl : (post.thumbnailUrl || post.mediaUrls?.[0] || post.mediaUrl || null),
    caption: post.caption ?? '',
    likesCount: post.likesCount ?? undefined,
    productCount: 0,
  };
}

function demoItems(): ProfileGridItem[] {
  return FASHION_PREVIEW_POSTS.map((post) => ({
    id: post.id,
    kind: 'video' as const,
    posterUri: post.videoPosterUri ?? null,
    caption: post.caption ?? '',
    likesCount: post.likes,
    productCount: 0,
  }));
}

export default function HashtagScreen() {
  const params = useLocalSearchParams<{ tag: string }>();
  const tag = useMemo(() => normalizeTag(String(params.tag ?? '')), [params.tag]);
  const router = useRouter();
  const api = useApi();
  const { isSignedIn } = useAuth();
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const layout = useProfileLayout();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const longTag = tag.length > 13;

  const preview = isBuyerDevPreview();
  const demo = preview && isPreviewDemoMode();

  const [sort, setSort] = useState<Sort>('top');
  const [items, setItems] = useState<ProfileGridItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [postCount, setPostCount] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (nextSort: Sort) => {
    const id = ++requestId.current;
    setLoading(true);
    setFailed(false);
    if (preview) {
      const list = demo ? demoItems() : [];
      setItems(nextSort === 'recent' ? [...list].reverse() : list);
      setPostCount(list.length);
      setCursor(null);
      setLoading(false);
      return;
    }
    try {
      const page = await api.hashtags.page(tag, nextSort);
      if (id !== requestId.current) return;
      setItems(page.posts.items.map(toGridItem));
      setCursor(page.posts.nextCursor);
      setPostCount(page.postCount);
      setIsFollowing(page.isFollowing);
      setMissing(false);
    } catch (err: any) {
      if (id !== requestId.current) return;
      if (err?.status === 404) setMissing(true); else setFailed(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [api, tag, preview, demo]);

  useEffect(() => { void load(sort); }, [load, sort]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || loading || preview) return;
    setLoadingMore(true);
    try {
      const page = await api.hashtags.posts(tag, sort, cursor);
      setItems((current) => {
        const seen = new Set(current.map((i) => i.id));
        return [...current, ...page.items.filter((p) => !seen.has(p.id)).map(toGridItem)];
      });
      setCursor(page.nextCursor);
    } catch { /* keep what is already on screen */ }
    finally { setLoadingMore(false); }
  }, [api, tag, sort, cursor, loadingMore, loading, preview]);

  const toggleFollow = useCallback(async () => {
    if (preview) { setIsFollowing((v) => !v); hapticToggle(); return; }
    if (!isSignedIn) { router.push('/sign-in' as never); return; }
    const next = !isFollowing;
    setIsFollowing(next);
    hapticToggle();
    try {
      if (next) await api.hashtags.follow(tag); else await api.hashtags.unfollow(tag);
    } catch {
      setIsFollowing(!next);
    }
  }, [api, tag, isFollowing, isSignedIn, preview, router]);

  const openPost = useCallback((item: ProfileGridItem) => {
    hapticSelection();
    router.push(`/buyer-post-viewer?postId=${encodeURIComponent(item.id)}` as never);
  }, [router]);

  const header = (
    <View>
      <View style={styles.hero}>
        <View style={[styles.badge, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Icon name="hash" size={30} color={theme.text} />
        </View>
        <View style={styles.heroText}>
          {longTag ? null : <Text style={styles.title} accessibilityRole="header">#{tag}</Text>}
          <Text style={styles.count}>
            {loading && items.length === 0 ? ' ' : `${formatCompactCount(postCount)} ${postCount === 1 ? 'post' : 'posts'}`}
          </Text>
        </View>
      </View>
      {longTag ? (
        // Long tags get the full width on their own line, so they never break mid-word next to the badge.
        <Text style={[styles.title, styles.titleLong]} accessibilityRole="header" adjustsFontSizeToFit minimumFontScale={0.8}>#{tag}</Text>
      ) : null}
      <View style={styles.followRow}>
        <TouchableOpacity
          onPress={toggleFollow}
          accessibilityRole="button"
          accessibilityLabel={isFollowing ? `Unfollow #${tag}` : `Follow #${tag}`}
          accessibilityState={{ selected: isFollowing }}
          testID="hashtag-follow"
          style={[styles.followBtn, isFollowing ? styles.followBtnOn : styles.followBtnOff]}
          activeOpacity={0.85}
        >
          <Text style={[styles.followText, { color: isFollowing ? theme.text : theme.background }]}>
            {isFollowing ? 'Following' : 'Follow'}
          </Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.tabs, { borderBottomColor: theme.border }]} accessibilityRole="tablist">
        {(['top', 'recent'] as const).map((key) => {
          const active = sort === key;
          return (
            <TouchableOpacity
              key={key}
              style={styles.tab}
              onPress={() => { if (!active) { hapticSelection(); setSort(key); } }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={key === 'top' ? 'Top posts' : 'Recent posts'}
              testID={`hashtag-tab-${key}`}
            >
              <Text style={[styles.tabText, { color: active ? theme.text : theme.muted, fontFamily: active ? FONT.semibold : FONT.medium }]}>
                {key === 'top' ? 'Top' : 'Recent'}
              </Text>
              <View style={[styles.tabUnderline, { backgroundColor: active ? theme.text : 'transparent' }]} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScreenHeader title="" />
      <FlatList
        key={`cols-${layout.gridColumns}`}
        data={items}
        keyExtractor={(item) => item.id}
        numColumns={layout.gridColumns}
        columnWrapperStyle={{ gap: PROFILE_GRID_GAP }}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => (
          <ProfileVideoTile
            item={item}
            index={index}
            width={layout.tileWidth}
            height={layout.tileHeight}
            onPress={openPost}
          />
        )}
        ListEmptyComponent={
          loading ? (
            <ProfileGridSkeleton columns={layout.gridColumns} width={layout.tileWidth} height={layout.tileHeight} />
          ) : missing ? (
            <EmptyState icon="hash" title="Hashtag not available" description="This hashtag can't be shown." />
          ) : failed ? (
            <EmptyState
              icon="wifi-off"
              title="Couldn't load this hashtag"
              description="Check your connection and try again."
              action={{ label: 'Try again', onPress: () => void load(sort) }}
            />
          ) : (
            <EmptyState icon="hash" title="No posts yet" description={`Be the first to post with #${tag}.`} />
          )
        }
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginVertical: SPACING.md }} color={theme.muted} /> : null}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        contentContainerStyle={{ paddingBottom: insets.bottom + SPACING.xl, alignSelf: 'center', width: layout.columnWidth }}
        showsVerticalScrollIndicator={false}
        testID="hashtag-screen"
      />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.sm },
  badge: { width: 76, height: 76, borderRadius: RADII.avatar, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  heroText: { flex: 1 },
  title: { ...TYPE_SCALE.title1, color: theme.text, fontFamily: FONT.bold },
  titleLong: { ...TYPE_SCALE.title2, fontFamily: FONT.bold, paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.sm },
  count: { ...TYPE_SCALE.body, color: theme.muted, marginTop: 2 },
  followRow: { paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.md, paddingBottom: SPACING.md },
  followBtn: { height: 38, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center' },
  // Primary pill: inverted text/background so it is white-on-black in dark and black-on-white in light.
  followBtnOff: { backgroundColor: theme.text },
  followBtnOn: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  followText: { ...TYPE_SCALE.body, fontFamily: FONT.semibold },
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: PROFILE_GRID_GAP },
  tab: { flex: 1, alignItems: 'center', paddingTop: SPACING.sm },
  tabText: { ...TYPE_SCALE.body, paddingBottom: SPACING.sm },
  tabUnderline: { height: 2, alignSelf: 'stretch' },
});
