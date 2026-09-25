import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, FlatList,
  Alert, StyleSheet, Dimensions, Share,
} from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { CachedImage } from '@/components/CachedImage';
import { PressableScale, FeedSkeleton, EmptyState } from '@/components/BrandthreadUI';
import { IconButton, Snackbar, ErrorState } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import {
  ICON, FONT,
} from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { hapticPrimaryAction, hapticSelection } from '@/lib/haptics';
import {
  MY_USER_ID, subscribeSocial, saveItem, createOrGetConversation, getStories,
} from '@/services/socialService';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import type { Friendship, Story, BuyerPost } from '@/services/socialTypes';
import { useApi } from '@/lib/api';

type ApiFollowing = {
  userId: string; name: string; username: string | null;
  handle: string; initials: string; color: string; followedAt: string;
};

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Post Card ───────────────────────────────────────────────────────────────

function PostCard({
  post,
  saved,
  onLike,
  onRepost,
  onSave,
  onOpenComments,
  onNotInterested,
}: {
  post: BuyerPost;
  saved: boolean;
  onLike: (post: BuyerPost) => void;
  onRepost: (id: string) => void;
  onSave: (post: BuyerPost) => void;
  onOpenComments: (post: BuyerPost) => void;
  onNotInterested: (post: BuyerPost) => void;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const palette = useColors();

  return (
    <View style={[s.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
      {/* Header */}
      <View style={s.cardHeader}>
        <View style={[s.avatar40, { backgroundColor: post.authorColor }]}>
          <Text style={[TYPE_SCALE.callout, s.avatarText]}>{post.authorInitials}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: SPACING.sm }}>
          <Text style={[TYPE_SCALE.body, s.authorName, { color: palette.foreground }]} numberOfLines={1}>{post.authorName}</Text>
          <Text style={[TYPE_SCALE.caption, s.authorMeta, { color: palette.mutedForeground }]} numberOfLines={1}>
            {post.authorHandle}
            {' · '}
            {timeAgo(post.createdAt)}
          </Text>
        </View>
        <IconButton
          name="more-horizontal"
          size={ICON.md}
          color={palette.mutedForeground}
          variant="plain"
          accessibilityLabel="Post options"
          onPress={() =>
            Alert.alert('Options', undefined, [
              {
                text: 'Report',
                onPress: () =>
                  router.push(
                    `/buyer-report?targetType=post&targetId=${post.id}&targetLabel=Post` as never,
                  ),
              },
              { text: 'Not interested', onPress: () => onNotInterested(post) },
              { text: 'Cancel', style: 'cancel' },
            ])
          }
        />
      </View>

      {/* Media */}
      <PressableScale onPress={() => onOpenComments(post)} style={s.mediaPress}>
        {post.mediaUrl ? (
          <CachedImage source={{ uri: post.mediaUrl }} style={s.media} contentFit="cover" />
        ) : (
          <View style={[s.media, { backgroundColor: palette.elevated }]}>
            <Feather
              name={post.type === 'video' ? 'video' : 'image'}
              size={44}
              color={palette.mutedForeground}
            />
            {post.type === 'video' && (
              <View style={[s.playBtn, { backgroundColor: palette.elevated }]}>
                <Feather name="play" size={ICON.md} color={theme.accent} />
              </View>
            )}
          </View>
        )}
      </PressableScale>

      {/* Actions */}
      <View style={s.actionRow}>
        <PressableScale style={s.actionItem} onPress={() => onLike(post)}>
          <FontAwesome
            name={post.likedByMe ? 'heart' : 'heart-o'}
            size={ICON.lg}
            color={post.likedByMe ? palette.destructive : palette.mutedForeground}
          />
          <Text style={[TYPE_SCALE.callout, s.actionCount, { color: palette.mutedForeground }, post.likedByMe && { color: palette.destructive }]}>{post.likesCount}</Text>
        </PressableScale>
        <PressableScale style={s.actionItem} onPress={() => onOpenComments(post)}>
          <Feather name="message-circle" size={ICON.lg} color={palette.mutedForeground} />
          <Text style={[TYPE_SCALE.callout, s.actionCount, { color: palette.mutedForeground }]}>{post.commentsCount}</Text>
        </PressableScale>
        <PressableScale style={s.actionItem} onPress={() => onRepost(post.id)}>
          <Feather
            name="repeat"
            size={ICON.lg}
            color={post.repostedByMe ? theme.accent : palette.mutedForeground}
          />
          <Text style={[TYPE_SCALE.callout, s.actionCount, { color: palette.mutedForeground }]}>{post.repostsCount}</Text>
        </PressableScale>
        <View style={{ flex: 1 }} />
        <PressableScale
          style={s.actionIcon}
          onPress={() => onSave(post)}
          accessibilityLabel={saved ? 'Remove from saved' : 'Save post'}
        >
          <FontAwesome name={saved ? 'bookmark' : 'bookmark-o'} size={ICON.lg} color={saved ? theme.accent : palette.mutedForeground} />
        </PressableScale>
        <PressableScale
          style={s.actionIcon}
          accessibilityLabel="Share post"
          onPress={() => Share.share({ message: `See ${post.authorName}'s post on Brandthread` })}
        >
          <Feather name="send" size={ICON.lg} color={palette.mutedForeground} />
        </PressableScale>
      </View>

      {/* Caption */}
      <View style={s.captionBlock}>
        <Text style={[TYPE_SCALE.callout, s.captionText, { color: palette.foreground }]}>
          <Text style={[s.captionAuthor, { color: palette.foreground }]}>{post.authorName} </Text>
          {post.caption}
        </Text>
        {post.hashtags.length > 0 && (
          <View style={s.hashtagRow}>
            {post.hashtags.map(tag => (
              <Text key={tag} style={[TYPE_SCALE.callout, s.hashtag, { color: theme.accent }]}>
                {tag}
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function FriendsScreen() {
  const { theme } = useAppTheme();
  const palette = useColors();
  const insets  = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const router  = useRouter();
  const api     = useApi();
  const { userId } = useAuth();
  const { user: clerkUser } = useUser();
  const myName = clerkUser?.fullName || clerkUser?.firstName || clerkUser?.username || 'You';
  const myInitials = myName.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'Y';
  const myAvatarUrl = clerkUser?.hasImage ? clerkUser.imageUrl : null;

  const [friends,      setFriends]      = useState<Friendship[]>([]);
  const [apiFollowing, setApiFollowing] = useState<ApiFollowing[]>([]);
  const [stories,      setStories]      = useState<Story[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [feedPosts,    setFeedPosts]    = useState<BuyerPost[]>([]);
  const [savedIds,     setSavedIds]     = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [snackbar, setSnackbar] = useState<{ visible: boolean; message: string }>({ visible: false, message: '' });
  const snackbarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSnackbar = useCallback((message: string) => {
    if (snackbarTimer.current) clearTimeout(snackbarTimer.current);
    setSnackbar({ visible: true, message });
    snackbarTimer.current = setTimeout(() => setSnackbar(prev => ({ ...prev, visible: false })), 2200);
  }, []);
  useEffect(() => () => { if (snackbarTimer.current) clearTimeout(snackbarTimer.current); }, []);

  async function loadData() {
    if (!userId) {
      setFriends([]);
      setApiFollowing([]);
      setStories([]);
      setFeedPosts([]);
      setLoading(false);
      return;
    }
    setLoadError(false);
    try {
      const [storyRows, followingRows, activityRows] = await Promise.all([
        getStories(),
        api.social.following(),
        api.social.friendActivity(),
      ]);
      const stories = Array.isArray(storyRows) ? storyRows : [];

      setFriends([]);
      setPendingCount(0);
      const now = Date.now();
      setStories(stories.filter(s => s.expiresAt > now));
      setApiFollowing(Array.isArray(followingRows) ? followingRows : []);
      setFeedPosts(Array.isArray(activityRows) ? activityRows : []);
    } catch (error) {
      setLoadError(true);
      setFriends([]);
      setApiFollowing([]);
      setStories([]);
      setFeedPosts([]);
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(useCallback(() => { loadData(); }, []));

  useEffect(() => {
    const unsub = subscribeSocial(() => { loadData(); });
    return unsub;
  }, []);

  function handleLike(post: BuyerPost) {
    hapticPrimaryAction();
    // Optimistic update
    setFeedPosts(prev =>
      prev.map(p =>
        p.id === post.id
          ? {
              ...p,
              likedByMe:  !p.likedByMe,
              likesCount: p.likedByMe ? p.likesCount - 1 : p.likesCount + 1,
            }
          : p,
      ),
    );
    api.posts.interact(post.id, {
      type: 'like',
      value: post.likedByMe ? 'remove' : 'add',
    }).catch(() => { setFeedPosts(prev => prev.map(p => p.id === post.id ? post : p)); Alert.alert('Could not update like', 'Try again.'); });
  }

  function handleRepost(postId: string) {
    hapticPrimaryAction();
    setFeedPosts(prev =>
      prev.map(p =>
        p.id === postId
          ? {
              ...p,
              repostedByMe: !p.repostedByMe,
              repostsCount: p.repostedByMe ? p.repostsCount - 1 : p.repostsCount + 1,
            }
          : p,
      ),
    );
    api.posts.interact(postId, { type: 'repost' }).catch(() => { setFeedPosts(prev => prev.map(p => p.id === postId ? { ...p, repostedByMe: !p.repostedByMe, repostsCount: p.repostedByMe ? p.repostsCount - 1 : p.repostsCount + 1 } : p)); Alert.alert('Could not update repost', 'Try again.'); });
  }

  function handleSave(post: BuyerPost) {
    hapticPrimaryAction();
    const wasSaved = savedIds.has(post.id);
    setSavedIds(prev => {
      const next = new Set(prev);
      if (wasSaved) next.delete(post.id); else next.add(post.id);
      return next;
    });
    if (wasSaved) {
      showSnackbar('Removed from saved');
      return;
    }
    saveItem({
      type: 'post',
      targetId: post.id,
      title: post.authorName + '\'s post',
      accentColor: post.authorColor,
    }, {
      onRemoteSaved: () => { void requestContextualPushPermission(userId, api); },
    });
    showSnackbar('Saved');
  }

  function handleNotInterested(post: BuyerPost) {
    hapticSelection();
    setFeedPosts(prev => prev.filter(p => p.id !== post.id));
    showSnackbar('Post hidden');
  }

  function handleOpenComments(post: BuyerPost) {
    const params = new URLSearchParams({
      postId: post.id,
      postAuthorName: post.authorName,
      postAuthorInitials: post.authorInitials,
      postAuthorColor: post.authorColor,
      postCaption: post.caption,
      postMediaColor1: post.mediaColors?.[0] ?? '#1a1a2e',
      postMediaColor2: post.mediaColors?.[1] ?? '#0d0d1a',
      postType: post.type,
    });
    router.push(`/buyer-post-comments?${params.toString()}` as never);
  }

  async function handleMessageFriend(f: Friendship) {
    try {
      const conv = await createOrGetConversation({
        type: 'buyer_to_buyer',
        participant: {
          userId: f.userId,
          name: f.name,
          handle: f.handle,
          initials: f.initials,
          color: f.color,
          accountType: 'buyer',
        },
      });
      router.push(`/buyer-conversation?id=${conv.id}` as never);
    } catch {
      Alert.alert('Error', 'Could not open conversation.');
    }
  }

  const allStoryIds = stories.map(s => s.id);
  const isOnline = (f: Friendship) =>
    !!f.lastSeenAt && Date.now() - new Date(f.lastSeenAt).getTime() < 5 * 60000;

  const hasFriends = friends.length > 0;

  // ── Memoized header/footer so FlatList doesn't remount the stories row (and
  // reset its scroll position) on every like/repost re-render. ──────────────
  const ListHeader = useMemo(() => (
    <>
      {/* Stories row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.storiesScroll}
      >
        {/* Your story */}
        <PressableScale
          style={s.storyItem}
          accessibilityLabel="Add to your story"
          onPress={() => { hapticPrimaryAction(); router.push('/buyer-story-create' as never); }}
        >
          <View style={[s.storyCircle, { backgroundColor: theme.cardElevated, overflow: 'hidden' }]}>
            {myAvatarUrl
              ? <CachedImage source={{ uri: myAvatarUrl }} style={StyleSheet.absoluteFill} />
              : <Text style={[TYPE_SCALE.body, s.storyInitials, { color: theme.text }]}>{myInitials}</Text>}
            <View style={[s.plusBadge, { backgroundColor: theme.accent, borderColor: theme.background }]}>
              <Feather name="plus" size={10} color={theme.onAccent} />
            </View>
          </View>
          <Text style={[TYPE_SCALE.caption, s.storyLabel, { color: palette.mutedForeground }]} numberOfLines={1}>
            Your story
          </Text>
        </PressableScale>

        {/* Friend stories */}
        {stories.map(story => {
          const viewed = story.viewers.some(v => v.userId === MY_USER_ID);
          return (
            <PressableScale
              key={story.id}
              style={s.storyItem}
              accessibilityLabel={`${story.authorName}'s story`}
              onPress={() => {
                hapticPrimaryAction();
                router.push(
                  `/buyer-story-viewer?storyId=${story.id}&allStoryIds=${allStoryIds.join(',')}` as never,
                );
              }}
            >
              <View
                style={[
                  s.storyCircle,
                  { backgroundColor: story.authorColor },
                  viewed ? [s.storyRingViewed, { borderColor: palette.mutedForeground }] : [s.storyRingUnviewed, { borderColor: theme.accent }],
                ]}
              >
                <Text style={[TYPE_SCALE.body, s.storyInitials]}>{story.authorInitials}</Text>
              </View>
              <Text style={[TYPE_SCALE.caption, s.storyLabel, { color: palette.mutedForeground }]} numberOfLines={1}>
                {story.authorName}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {/* ── People You Follow (real DB data) ──────────────────── */}
      {apiFollowing.length > 0 && (
        <View style={{ marginBottom: SPACING.sm }}>
          <View style={s.sectionHeader}>
            <Text style={[TYPE_SCALE.headline, s.sectionTitle, { color: palette.foreground }]}>Following</Text>
            <PressableScale onPress={() => { hapticPrimaryAction(); router.push('/buyer-friend-requests' as never); }}>
              <Text style={[TYPE_SCALE.callout, s.seeAll, { color: theme.accent }]}>See all</Text>
            </PressableScale>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: SPACING.md, gap: SPACING.md, paddingBottom: SPACING.sm }}
          >
            {apiFollowing.map(f => (
              <PressableScale
                key={f.userId}
                style={s.followingItem}
                onPress={() => {
                  hapticPrimaryAction();
                  router.push({
                    pathname: '/buyer-other-profile' as any,
                    params: { userId: f.userId, name: f.name, handle: f.handle, initials: f.initials, color: f.color },
                  });
                }}
              >
                <View style={[s.storyCircle, { backgroundColor: f.color }]}>
                  <Text style={[TYPE_SCALE.body, s.storyInitials]}>{f.initials}</Text>
                </View>
                <Text style={[TYPE_SCALE.caption, s.storyLabel, { color: palette.mutedForeground }]} numberOfLines={1}>
                  {f.name.split(' ')[0]}
                </Text>
                <PressableScale
                  style={[s.msgBubble, { backgroundColor: theme.accentDim }]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel={`Message ${f.name}`}
                  onPress={() => { hapticPrimaryAction(); handleMessageFriend({ userId: f.userId, name: f.name, handle: f.handle, initials: f.initials, color: f.color } as any); }}
                >
                  <Feather name="message-circle" size={14} color={theme.accent} />
                </PressableScale>
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Section header */}
      <View style={s.sectionHeader}>
        <Text style={[TYPE_SCALE.headline, s.sectionTitle, { color: palette.foreground }]}>Friend activity</Text>
        <PressableScale onPress={() => { hapticPrimaryAction(); router.push('/(buyer)/discover' as never); }}>
          <Text style={[TYPE_SCALE.callout, s.seeAll, { color: theme.accent }]}>See all</Text>
        </PressableScale>
      </View>

      {/* Empty state — converged on the shared EmptyState component */}
      {!hasFriends && feedPosts.length === 0 && apiFollowing.length === 0 && !loading && !loadError && (
        <EmptyState
          icon="users"
          title="Find your crew"
          description="Add friends to see what they're copping, saving, and dropping."
          action={{ label: 'Find friends', onPress: () => { hapticPrimaryAction(); router.push('/buyer-friend-requests' as never); } }}
        />
      )}
    </>
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [theme, palette, stories, apiFollowing, hasFriends, feedPosts.length, myAvatarUrl, myInitials, loading, loadError, allStoryIds.join(',')]);

  const ListFooter = useMemo(() => (
    friends.length > 0 ? (
      <View style={s.friendsSection}>
        <Text style={[TYPE_SCALE.headline, s.sectionTitle2, { color: palette.foreground }]}>Message friends</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.friendsScroll}
        >
          {friends.map(f => (
            <PressableScale
              key={f.id}
              style={s.friendItem}
              onPress={() => { hapticPrimaryAction(); handleMessageFriend(f); }}
            >
              <View style={[s.avatar48, { backgroundColor: f.color }]}>
                <Text style={[TYPE_SCALE.callout, s.avatar48Text]}>{f.initials}</Text>
                {isOnline(f) && <View style={[s.onlineDot, { backgroundColor: palette.success, borderColor: palette.background }]} />}
              </View>
              <Text style={[TYPE_SCALE.caption, s.friendName, { color: palette.mutedForeground }]} numberOfLines={1}>
                {f.name.split(' ')[0]}
              </Text>
            </PressableScale>
          ))}
        </ScrollView>
      </View>
    ) : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [friends, palette]);

  return (
    <View style={[s.container, { backgroundColor: palette.background }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SPACING.md }]}>
        <IconButton
          name="plus"
          variant="plain"
          size={ICON.lg}
          color={palette.mutedForeground}
          accessibilityLabel="Create post"
          onPress={() => router.push('/create-post?accountType=buyer' as never)}
        />

        <Text style={[TYPE_SCALE.headline, s.headerTitle, { color: palette.foreground }]}>Friends</Text>

        <View>
          <IconButton
            name="user-plus"
            variant="plain"
            size={ICON.lg}
            color={palette.mutedForeground}
            accessibilityLabel="Friend requests"
            onPress={() => router.push('/buyer-friend-requests' as never)}
          />
          {pendingCount > 0 && (
            <View pointerEvents="none" style={[s.badge, { backgroundColor: theme.accent }]}>
              <Text style={[TYPE_SCALE.caption, s.badgeText, { color: theme.onAccent }]}>{pendingCount}</Text>
            </View>
          )}
        </View>
      </View>

      {loadError && feedPosts.length === 0 && !loading ? (
        <ErrorState message="Couldn't load activity. Pull to refresh." onRetry={loadData} />
      ) : (
        <FlatList
          data={feedPosts}
          keyExtractor={p => p.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: barInset + SPACING.md }}
          ListEmptyComponent={loading ? <FeedSkeleton /> : null}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={ListFooter}
          renderItem={({ item }) => (
            <PostCard
              post={item}
              saved={savedIds.has(item.id)}
              onLike={handleLike}
              onRepost={handleRepost}
              onSave={handleSave}
              onOpenComments={handleOpenComments}
              onNotInterested={handleNotInterested}
            />
          )}
        />
      )}

      <Snackbar visible={snackbar.visible} message={snackbar.message} onDismiss={() => setSnackbar(prev => ({ ...prev, visible: false }))} />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
  },

  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {},

  storiesScroll: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    gap: SPACING.md,
    alignItems: 'flex-start',
  },
  followingItem: { alignItems: 'center', gap: SPACING.xs, width: 68 },
  msgBubble: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  storyItem: { alignItems: 'center', gap: SPACING.xs },
  storyCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyRingViewed: { borderWidth: 2 },
  storyRingUnviewed: { borderWidth: 2 },
  storyInitials: {
    color: '#FFFFFF', // theme-exempt: initials on a per-user identity color
  },
  plusBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  storyLabel: {
    textAlign: 'center',
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  sectionTitle: {},
  seeAll: {},

  // Post card
  card: {
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderRadius: RADII.card,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  avatar40: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF', // theme-exempt: initials on a per-user identity color
  },
  authorName: {},
  authorMeta: {
    marginTop: 1,
  },

  mediaPress: {},
  media: {
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    gap: SPACING.lg,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  actionCount: {},
  actionIcon: { padding: 2 },

  captionBlock: {
    paddingHorizontal: SPACING.md,
    paddingBottom: SPACING.md,
  },
  captionText: {
    lineHeight: 20,
  },
  captionAuthor: {
    fontFamily: FONT.semibold,
  },
  hashtagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SPACING.xs,
  },
  hashtag: {
    marginRight: SPACING.xs,
  },

  // Friends section
  friendsSection: {
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  sectionTitle2: {
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
  },
  friendsScroll: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.md,
    alignItems: 'flex-start',
  },
  friendItem: { alignItems: 'center', gap: SPACING.xs, width: 56 },
  avatar48: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar48Text: {
    color: '#FFFFFF', // theme-exempt: initials on a per-user identity color
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  friendName: {
    textAlign: 'center',
  },
});
