import React, { useState, useEffect, useCallback } from 'react';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  Alert, StyleSheet, Dimensions, Share, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useFocusEffect } from 'expo-router';
import { useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { CachedImage } from '@/components/CachedImage';
import * as Haptics from 'expo-haptics';
import {
  BG, SCREEN_BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE, SUCCESS, RED, ORANGE, BLUE,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import {
  MY_USER_ID, MY_COLOR, MY_INITIALS,
  getStories, subscribeSocial, saveItem, createOrGetConversation,
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
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Post Card ───────────────────────────────────────────────────────────────

function PostCard({
  post,
  onLike,
  onRepost,
  onSave,
  onOpenComments,
}: {
  post: BuyerPost;
  onLike: (post: BuyerPost) => void;
  onRepost: (id: string) => void;
  onSave: (post: BuyerPost) => void;
  onOpenComments: (post: BuyerPost) => void;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.cardHeader}>
        <View style={[s.avatar40, { backgroundColor: post.authorColor }]}>
          <Text style={s.avatarText}>{post.authorInitials}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: SP.sm }}>
          <Text style={s.authorName}>{post.authorName}</Text>
          <Text style={s.authorMeta}>
            {post.authorHandle}
            {' · '}
            {timeAgo(post.createdAt)}
          </Text>
        </View>
        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() =>
            Alert.alert('Options', undefined, [
              {
                text: 'Report',
                onPress: () =>
                  router.push(
                    `/buyer-report?targetType=post&targetId=${post.id}&targetLabel=Post` as never,
                  ),
              },
              { text: 'Not Interested' },
              { text: 'Cancel', style: 'cancel' },
            ])
          }
        >
          <Feather name="more-horizontal" size={ICON.md} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Media */}
      <TouchableOpacity activeOpacity={0.9} onPress={() => onOpenComments(post)}>
        {post.mediaUrl ? (
          <Image source={{ uri: post.mediaUrl }} style={s.media} resizeMode="cover" />
        ) : (
          <View style={[s.media, { backgroundColor: CARD_ELEVATED }]}>
          <Feather
            name={post.type === 'video' ? 'video' : 'image'}
            size={44}
            color="rgba(255,255,255,0.3)"
          />
          {post.type === 'video' && (
            <View style={s.playBtn}>
              <Feather name="play" size={ICON.md} color={theme.accent} />
            </View>
          )}
          </View>
        )}
      </TouchableOpacity>

      {/* Actions */}
      <View style={s.actionRow}>
        <TouchableOpacity style={s.actionItem} onPress={() => onLike(post)}>
          <Feather
            name={post.likedByMe ? 'heart' : 'heart'}
            size={ICON.lg}
            color={post.likedByMe ? RED : MUTED}
          />
          <Text style={[s.actionCount, post.likedByMe && { color: RED }]}>{post.likesCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionItem} onPress={() => onOpenComments(post)}>
          <Feather name="message-circle" size={ICON.lg} color={MUTED} />
          <Text style={s.actionCount}>{post.commentsCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionItem} onPress={() => onRepost(post.id)}>
          <Feather
            name="repeat"
            size={ICON.lg}
            color={post.repostedByMe ? theme.accent : MUTED}
          />
          <Text style={s.actionCount}>{post.repostsCount}</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={s.actionIcon}
          onPress={() => onSave(post)}
        >
          <Feather name="bookmark" size={ICON.lg} color={MUTED} />
        </TouchableOpacity>
        <TouchableOpacity
          style={s.actionIcon}
          onPress={() => Share.share({ message: `${post.authorName} posted on Brandthread — check it out!` })}
        >
          <Feather name="send" size={ICON.lg} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Caption */}
      <View style={s.captionBlock}>
        <Text style={s.captionText}>
          <Text style={s.captionAuthor}>{post.authorName} </Text>
          {post.caption}
        </Text>
        {post.hashtags.length > 0 && (
          <View style={s.hashtagRow}>
            {post.hashtags.map(tag => (
              <Text key={tag} style={[s.hashtag, { color: theme.accent }]}>
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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
      setLoadError(false);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    saveItem({
      type: 'post',
      targetId: post.id,
      title: post.authorName + '\'s post',
      accentColor: post.authorColor,
    }, {
      onRemoteSaved: () => { void requestContextualPushPermission(userId, api); },
    });
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

  return (
    <View style={[s.container, { backgroundColor: SCREEN_BG }]}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.md }]}>
        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.push('/create-post?accountType=buyer' as never)}
        >
          <Feather name="plus" size={ICON.lg} color={MUTED} />
        </TouchableOpacity>

        <Text style={s.headerTitle}>Friends</Text>

        <TouchableOpacity
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => router.push('/buyer-friend-requests' as never)}
        >
          <View>
            <Feather name="user-plus" size={ICON.lg} color={MUTED} />
            {pendingCount > 0 && (
                <View style={[s.badge, { backgroundColor: theme.accent }]}>
                <Text style={[s.badgeText, { color: theme.onAccent }]}>{pendingCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <FlatList
        data={feedPosts}
        keyExtractor={p => p.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: barInset + SP.md }}
        ListEmptyComponent={loading ? <View style={s.emptyState}><Text style={s.emptyBody}>Loading activity…</Text></View> : null}
        ListHeaderComponent={() => (
          <>
            {/* Stories row */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.storiesScroll}
            >
              {/* Your story */}
              <TouchableOpacity
                style={s.storyItem}
                activeOpacity={0.8}
                onPress={() => router.push('/buyer-story-create' as never)}
              >
                <View style={[s.storyCircle, { backgroundColor: theme.cardElevated, overflow: 'hidden' }]}>
                  {myAvatarUrl
                    ? <CachedImage source={{ uri: myAvatarUrl }} style={StyleSheet.absoluteFill} />
                    : <Text style={[s.storyInitials, { color: theme.text }]}>{myInitials}</Text>}
                  <View style={[s.plusBadge, { backgroundColor: theme.accent }]}>
                    <Feather name="plus" size={10} color={theme.onAccent} />
                  </View>
                </View>
                <Text style={s.storyLabel} numberOfLines={1}>
                  Your story
                </Text>
              </TouchableOpacity>

              {/* Friend stories */}
              {stories.map(story => {
                const viewed = story.viewers.some(v => v.userId === MY_USER_ID);
                return (
                  <TouchableOpacity
                    key={story.id}
                    style={s.storyItem}
                    activeOpacity={0.8}
                    onPress={() =>
                      router.push(
                        `/buyer-story-viewer?storyId=${story.id}&allStoryIds=${allStoryIds.join(',')}` as never,
                      )
                    }
                  >
                    <View
                      style={[
                        s.storyCircle,
                        { backgroundColor: story.authorColor },
                        viewed ? s.storyRingViewed : [s.storyRingUnviewed, { borderColor: theme.accent }],
                      ]}
                    >
                      <Text style={s.storyInitials}>{story.authorInitials}</Text>
                    </View>
                    <Text style={s.storyLabel} numberOfLines={1}>
                      {story.authorName.slice(0, 8)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* ── People You Follow (real DB data) ──────────────────── */}
            {apiFollowing.length > 0 && (
              <View style={{ marginBottom: SP.sm }}>
                <View style={s.sectionHeader}>
                  <Text style={s.sectionTitle}>Following</Text>
                  <TouchableOpacity onPress={() => router.push('/buyer-friend-requests' as never)}>
                    <Text style={[s.seeAll, { color: theme.accent }]}>See all</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: SP.md, gap: SP.md, paddingBottom: SP.sm }}
                >
                  {apiFollowing.map(f => (
                    <TouchableOpacity
                      key={f.userId}
                      style={s.followingItem}
                      activeOpacity={0.8}
                      onPress={() =>
                        router.push({
                          pathname: '/buyer-other-profile' as any,
                          params: { userId: f.userId, name: f.name, handle: f.handle, initials: f.initials, color: f.color },
                        })
                      }
                    >
                      <View style={[s.storyCircle, { backgroundColor: f.color }]}>
                        <Text style={s.storyInitials}>{f.initials}</Text>
                      </View>
                      <Text style={s.storyLabel} numberOfLines={1}>
                        {f.name.split(' ')[0]}
                      </Text>
                      <TouchableOpacity
                        style={[s.msgBubble, { backgroundColor: theme.accentDim }]}
                        onPress={() => handleMessageFriend({ userId: f.userId, name: f.name, handle: f.handle, initials: f.initials, color: f.color } as any)}
                      >
                        <Feather name="message-circle" size={14} color={theme.accent} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Section header */}
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Friend Activity</Text>
              <TouchableOpacity
                onPress={() => router.push('/(tabs)/discover' as never)}
              >
                <Text style={[s.seeAll, { color: theme.accent }]}>See all</Text>
              </TouchableOpacity>
            </View>

            {/* Empty state */}
            {!hasFriends && feedPosts.length === 0 && apiFollowing.length === 0 && (
              <View style={s.emptyState}>
                <Feather name="users" size={48} color={MUTED} />
                <Text style={s.emptyTitle}>Find your crew</Text>
                <Text style={s.emptyBody}>
                  Add friends to see what they're copping, saving, and dropping.
                </Text>
                <TouchableOpacity
                  onPress={() => router.push('/buyer-friend-requests' as never)}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={[...theme.primaryGradient]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={s.findFriendsBtn}
                  >
                    <Text style={[s.findFriendsBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Find Friends</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
        ListFooterComponent={() =>
          friends.length > 0 ? (
            <View style={s.friendsSection}>
              <Text style={s.sectionTitle2}>Message Friends</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.friendsScroll}
              >
                {friends.map(f => (
                  <TouchableOpacity
                    key={f.id}
                    style={s.friendItem}
                    activeOpacity={0.8}
                    onPress={() => handleMessageFriend(f)}
                  >
                    <View style={[s.avatar48, { backgroundColor: f.color }]}>
                      <Text style={s.avatar48Text}>{f.initials}</Text>
                      {isOnline(f) && <View style={s.onlineDot} />}
                    </View>
                    <Text style={s.friendName} numberOfLines={1}>
                      {f.name.split(' ')[0]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <PostCard post={item} onLike={handleLike} onRepost={handleRepost} onSave={handleSave} onOpenComments={handleOpenComments} />
        )}
      />
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
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
  },

  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontFamily: FONT.bold,
    fontSize: FS.xs,
    color: '#fff',
  },

  storiesScroll: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    gap: SP.md,
    alignItems: 'flex-start',
  },
  followingItem: { alignItems: 'center', gap: SP.xs, width: 68 },
  msgBubble: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  storyItem: { alignItems: 'center', gap: SP.xs },
  storyCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyRingViewed: { borderWidth: 2, borderColor: MUTED },
  storyRingUnviewed: { borderWidth: 2 },
  storyInitials: {
    fontFamily: FONT.bold,
    fontSize: FS.base,
    color: '#fff',
  },
  plusBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 18,
    height: 18,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: BG,
  },
  storyLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
    textAlign: 'center',
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    marginTop: SP.sm,
    marginBottom: SP.sm,
  },
  sectionTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
  },
  seeAll: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
  },

  emptyState: {
    alignItems: 'center',
    paddingHorizontal: SP.xl,
    paddingVertical: SP.xl,
    gap: SP.sm,
  },
  emptyTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
    marginTop: SP.sm,
  },
  emptyBody: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    textAlign: 'center',
  },
  findFriendsBtn: {
    marginTop: SP.sm,
    paddingHorizontal: SP.xl,
    height: COMP.buttonH,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  findFriendsBtnText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: '#fff',
  },

  // Post card
  card: {
    marginHorizontal: SP.md,
    marginBottom: SP.md,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    paddingBottom: SP.sm,
  },
  avatar40: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: FONT.bold,
    fontSize: FS.sm,
    color: '#fff',
  },
  authorName: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
  },
  authorMeta: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    marginTop: 1,
  },

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
    backgroundColor: CARD_ELEVATED,
    alignItems: 'center',
    justifyContent: 'center',
  },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    gap: SP.lg,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  actionCount: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
  },
  actionIcon: { padding: 2 },

  captionBlock: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
  },
  captionText: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: FG,
    lineHeight: 20,
  },
  captionAuthor: {
    fontFamily: FONT.semibold,
    color: FG,
  },
  hashtagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SP.xs,
  },
  hashtag: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    marginRight: SP.xs,
  },

  // Friends section
  friendsSection: {
    paddingTop: SP.sm,
    paddingBottom: SP.md,
  },
  sectionTitle2: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: FG,
    paddingHorizontal: SP.md,
    marginBottom: SP.sm,
  },
  friendsScroll: {
    paddingHorizontal: SP.md,
    gap: SP.md,
    alignItems: 'flex-start',
  },
  friendItem: { alignItems: 'center', gap: SP.xs, width: 56 },
  avatar48: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar48Text: {
    fontFamily: FONT.bold,
    fontSize: FS.sm,
    color: '#fff',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: SUCCESS,
    borderWidth: 1.5,
    borderColor: BG,
  },
  friendName: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    textAlign: 'center',
  },
});
