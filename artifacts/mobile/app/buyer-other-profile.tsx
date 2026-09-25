import React, { useMemo, useState, useCallback, useRef } from 'react';
import {
  View, Text, Alert, Image,
  StyleSheet, Dimensions, Modal, ActivityIndicator, Animated, RefreshControl,
} from 'react-native';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import {
  FONT, FS, SP, RADIUS, ICON, GRID_MAX_WIDTH, OVERLAY,
} from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { FollowMorphButton } from '@/components/ui/MotionPrimitives';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { hapticLight, hapticSelection, hapticSuccess } from '@/lib/haptics';
import {
  muteUser, restrictUser, createOrGetConversation,
} from '@/services/socialService';
import { useApi } from '@/lib/api';
import { useAuth } from '@clerk/expo';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { confirmBlock, confirmUnblock, reportHref } from '@/lib/safety';
import { EmptyState, GridSkeleton, ResponsiveContainer, useGridColumns, useBreakpoint } from '@/components/layout';

const { width } = Dimensions.get('window');
const GRID_GAP  = 1;
const CELL_SIZE = (width - GRID_GAP * 2) / 3;

// Compact bar fades in once the avatar/name section has scrolled past this offset.
const COMPACT_THRESHOLD = 130;

type ProfilePost = { id: string; mediaUrl?: string; mediaColors: string[]; type: string };

type RemoteProfile = {
  name: string; username: string | null; displayName: string | null;
  bio: string | null; followersCount: number; followingCount: number;
  isFollowing: boolean; isFollowedBy: boolean; isMutual: boolean;
  iBlockedThem: boolean;
  postsCount: number;
};

export default function BuyerOtherProfileScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const api     = useApi();
  const { userId: currentUserId } = useAuth();
  const params  = useLocalSearchParams<{
    userId: string; name: string; handle: string; initials: string; color: string;
  }>();

  const userId   = params.userId  || 'u_unknown';
  const name     = params.name    || 'Unknown';
  const handle   = params.handle  || '@unknown';
  const initials = params.initials || '?';
  // Fallback avatar (no real color from route params): theme.cardElevated fill
  // with theme.text initials, never accent-on-accent (which is invisible on
  // every preset — every accent is light and every onAccent is dark).
  const hasRealColor = !!params.color;
  const color    = params.color   || theme.cardElevated;

  // ── Remote profile state ────────────────────────────────────────────────────
  const [profile, setProfile]           = useState<RemoteProfile | null>(null);
  const [apiLoaded, setApiLoaded]       = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [msgLoading, setMsgLoading]     = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [storyIds, setStoryIds]         = useState<string[]>([]);
  const [posts, setPosts]               = useState<ProfilePost[]>([]);
  // Canonical clerkId resolved from the profile API response.
  // The route `userId` param may be a DB UUID alias when arriving from /u/[username].
  // After the profile loads, profile.userId is always the canonical clerkId.
  // Use canonicalUserId for all follow/unfollow/message/block actions.
  const [canonicalUserId, setCanonicalUserId] = useState<string>(userId);
  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;
  const compactOpacity = scrollY.interpolate({
    inputRange: [COMPACT_THRESHOLD - 24, COMPACT_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const gridColumns = useGridColumns({ phone: 3, tablet: 4, tabletLandscape: 5 });
  const { width: winWidth, isTablet } = useBreakpoint();
  const gridWidth = isTablet ? Math.min(winWidth, GRID_MAX_WIDTH) : winWidth;
  const gridCellSize = (gridWidth - GRID_GAP * (gridColumns - 1)) / gridColumns;

  // Derived display values — once the real profile has loaded, it always
  // overrides the route-param placeholders (which may be stale or "@unknown"
  // when this screen was opened with only a userId, e.g. from Inbox → Follows).
  const displayName = profile ? (profile.displayName || profile.name || name) : name;
  const displayHandle = profile?.username ? `@${profile.username}` : handle;
  const displayInitials = profile
    ? (displayName.trim()[0]?.toUpperCase() || initials)
    : initials;
  const displayBio  = profile?.bio ?? null;
  const isFollowing   = profile?.isFollowing  ?? false;
  const isFollowedBy  = profile?.isFollowedBy ?? false;
  const isMutual      = profile?.isMutual     ?? false;
  const followersCount = profile?.followersCount ?? 0;
  const followingCount = profile?.followingCount ?? 0;

  // ── Load profile + stories ─────────────────────────────────────────────────
  const loadProfile = useCallback(async () => {
    if (!userId || userId.startsWith('u_')) { setApiLoaded(true); return; }
    try {
      // Load profile first to get canonical clerkId, then load stories/posts with it.
      const profileData = await api.social.profile(userId);
      // profile.userId is always canonical clerkId (set by formatUser on the server).
      const resolvedId: string = (profileData as any).userId ?? userId;
      setProfile(profileData as RemoteProfile);
      setCanonicalUserId(resolvedId);
      // Now fetch stories and posts using the canonical ID.
      const [storiesData, postsData] = await Promise.allSettled([
        api.social.storiesForUser(resolvedId),
        api.social.profilePosts(resolvedId),
      ]);
      if (storiesData.status === 'fulfilled') {
        setStoryIds((storiesData.value as any[]).map((s: any) => s.id));
      }
      if (postsData.status === 'fulfilled') setPosts(Array.isArray(postsData.value) ? postsData.value : []);
    } catch {
      // degrade gracefully
    } finally {
      setApiLoaded(true);
    }
  }, [userId]);

  const openStories = () => {
    if (storyIds.length === 0) return;
    hapticLight();
    router.push({
      pathname: '/buyer-story-viewer' as any,
      params: { storyId: storyIds[0], allStoryIds: storyIds.join(',') },
    });
  };

  useFocusEffect(useCallback(() => { loadProfile(); }, [loadProfile]));

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }, [loadProfile]);

  // ── Follow / unfollow ──────────────────────────────────────────────────────
  const handleFollow = async () => {
    // Use canonical clerkId — the route userId may be a DB UUID alias.
    if (!apiLoaded || canonicalUserId.startsWith('u_') || followLoading) return;
    // Optimistic flip — the button (and count) update immediately, then roll
    // back on failure, instead of swapping to a separate spinner box.
    const wasFollowing = isFollowing;
    setFollowLoading(true);
    setProfile(prev => prev ? {
      ...prev,
      isFollowing: !wasFollowing,
      isMutual: wasFollowing ? false : prev.isFollowedBy,
      followersCount: Math.max(0, prev.followersCount + (wasFollowing ? -1 : 1)),
    } : prev);
    try {
      if (wasFollowing) {
        await api.social.unfollow(canonicalUserId);
      } else {
        await api.social.follow(canonicalUserId);
        void requestContextualPushPermission(currentUserId, api);
      }
      hapticLight();
    } catch {
      setProfile(prev => prev ? {
        ...prev,
        isFollowing: wasFollowing,
        isMutual: wasFollowing ? prev.isMutual : false,
        followersCount: Math.max(0, prev.followersCount + (wasFollowing ? 1 : -1)),
      } : prev);
      Alert.alert("Couldn't follow", 'Try again.');
    } finally {
      setFollowLoading(false);
    }
  };

  // ── Message ────────────────────────────────────────────────────────────────
  const handleMessage = async () => {
    setMsgLoading(true);
    try {
      // Use canonical clerkId for conversation participant.
      const conv = await createOrGetConversation({
        type: 'buyer_to_buyer',
        participant: { userId: canonicalUserId, name: displayName, handle, initials, color, accountType: 'buyer' },
      });
      router.push(`/buyer-conversation?id=${conv.id}` as any);
    } catch {
      Alert.alert("Couldn't open conversation", 'Try again.');
    } finally {
      setMsgLoading(false);
    }
  };

  const iBlockedThem = profile?.iBlockedThem ?? false;

  const handleMute     = async () => { setMoreSheetOpen(false); await muteUser({ userId: canonicalUserId, name: displayName, handle, initials, color }); hapticSuccess(); };
  const handleRestrict = async () => { setMoreSheetOpen(false); await restrictUser({ userId: canonicalUserId, name: displayName, handle, initials, color }); hapticSuccess(); };
  const handleBlock = async () => {
    setMoreSheetOpen(false);
    const subject = { userId: canonicalUserId, name: displayName };
    if (iBlockedThem) {
      if (await confirmUnblock(subject, api.social.unblock)) {
        hapticSuccess();
        await loadProfile();
      }
    } else if (await confirmBlock(subject, api.social.block)) {
      hapticSuccess();
      router.back();
    }
  };
  const handleReport = () => {
    setMoreSheetOpen(false);
    router.push(reportHref({
      targetType: 'profile',
      targetId: canonicalUserId,
      label: displayName,
      ownerId: canonicalUserId,
      ownerName: displayName,
    }) as never);
  };

  const postTypeIcon = (type: string) => type === 'photo' ? 'image' : type === 'slideshow' ? 'layers' : 'video';

  function renderFollowButton() {
    const disabled = !apiLoaded || canonicalUserId.startsWith('u_') || followLoading;
    return (
      <FollowMorphButton
        following={isFollowing}
        onChange={handleFollow}
        disabled={disabled}
        followLabel={isFollowedBy ? 'Follow back' : 'Follow'}
        followingLabel={isMutual ? 'Friends' : 'Following'}
        style={styles.followMorphBtn}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Compact collapsed bar — avatar thumbnail + name, fades in on scroll */}
      <Animated.View pointerEvents="none" style={[styles.compactBar, { top: insets.top, opacity: compactOpacity }]}>
        <View style={[styles.compactAvatar, { backgroundColor: color }]}>
          <Text style={[styles.compactAvatarText, !hasRealColor && { color: theme.text }]}>{initials}</Text>
        </View>
        <Text style={styles.compactName} numberOfLines={1}>{displayName}</Text>
      </Animated.View>

      {/* Back button */}
      <PressableScale
        style={[styles.backBtn, { top: insets.top + SP.sm }]}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Feather name="arrow-left" size={ICON.md} color="#fff" />
      </PressableScale>
      {/* Inbox shortcut */}
      <PressableScale
        style={[styles.inboxBtn, { top: insets.top + SP.sm }]}
        onPress={() => { hapticLight(); router.push('/(buyer)/inbox' as never); }}
        accessibilityRole="button"
        accessibilityLabel="Messages"
      >
        <Feather name="message-circle" size={ICON.sm} color={theme.text} />
        <Text style={styles.inboxBtnText}>Messages</Text>
      </PressableScale>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.muted} />}
      >
        {/* Spacer below floating back button */}
        <View style={{ height: 56 }} />

        {/* ── Centered avatar ── */}
        <View style={styles.avatarSection}>
          <PressableScale
            onPress={storyIds.length > 0 ? openStories : undefined}
            activeOpacity={storyIds.length > 0 ? 0.85 : 1}
            accessibilityRole={storyIds.length > 0 ? 'button' : undefined}
            accessibilityLabel={storyIds.length > 0 ? `View ${displayName}'s story` : undefined}
          >
            {/* No gradient ring — just a plain border when stories active */}
            <View style={[styles.avatar, { backgroundColor: color }, storyIds.length > 0 && styles.avatarActive]}>
              <Text style={[styles.avatarText, !hasRealColor && { color: theme.text }]}>{displayInitials}</Text>
            </View>
          </PressableScale>
        </View>

        {/* ── Name / Handle / Bio ── */}
        <View style={styles.infoSection}>
          <Text style={styles.nameText}>{displayName}</Text>
          <Text style={styles.handleText}>{displayHandle}</Text>
          {displayBio ? <Text style={styles.bioText}>{displayBio}</Text> : null}
          {isFollowedBy && !isMutual && (
            <View style={styles.followsYouPill}>
              <Text style={styles.followsYouText}>Follows you</Text>
            </View>
          )}
          {iBlockedThem ? (
            <PressableScale
              onPress={handleBlock}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Unblock ${displayName}`}
              style={styles.blockedBanner}
            >
              <Feather name="slash" size={16} color={theme.text} />
              <Text style={styles.blockedBannerText}>
                You blocked {displayName}. You won’t see each other’s posts, comments or messages.
              </Text>
              <Text style={styles.blockedBannerAction}>Unblock</Text>
            </PressableScale>
          ) : null}
        </View>

        {/* ── Stats — skeleton until the real counts load, so they never show 0 then jump ── */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            {apiLoaded ? (
              <Text style={styles.statNum}>{profile?.postsCount ?? posts.length}</Text>
            ) : (
              <SkeletonBlock width={28} height={20} style={styles.statSkeleton} />
            )}
            <Text style={styles.statLabel}>Posts</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            {apiLoaded ? (
              <Text style={styles.statNum}>{followersCount}</Text>
            ) : (
              <SkeletonBlock width={28} height={20} style={styles.statSkeleton} />
            )}
            <Text style={styles.statLabel}>Followers</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            {apiLoaded ? (
              <Text style={styles.statNum}>{followingCount}</Text>
            ) : (
              <SkeletonBlock width={28} height={20} style={styles.statSkeleton} />
            )}
            <Text style={styles.statLabel}>Following</Text>
          </View>
        </View>

        {/* ── Action buttons — equal-width Follow + Message, per the Instagram
             profile action-row layout idea (same actions, restyled). ── */}
        <View style={styles.actionButtons}>
          <View style={{ flex: 1 }}>{renderFollowButton()}</View>
          <PressableScale
            onPress={handleMessage}
            disabled={msgLoading}
            style={[styles.outlineBtn, { flex: 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Message"
          >
            {msgLoading
              ? <ActivityIndicator size="small" color={theme.text} />
              : <Text style={styles.outlineBtnText}>Message</Text>
            }
          </PressableScale>
          <PressableScale
            style={styles.moreBtn}
            onPress={() => { hapticSelection(); setMoreSheetOpen(true); }}
            accessibilityRole="button"
            accessibilityLabel="More options"
          >
            <Feather name="more-horizontal" size={ICON.md} color={theme.text} />
          </PressableScale>
        </View>

        {/* ── Posts grid ── */}
        <View style={styles.postsSection}>
          {!apiLoaded ? (
            <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ paddingHorizontal: 0 }}>
              <GridSkeleton columns={gridColumns} cardWidth={gridCellSize} rows={2} gap={GRID_GAP} />
            </ResponsiveContainer>
          ) : posts.length === 0 ? (
            <EmptyState icon="image" message="No posts yet." />
          ) : (
            <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ paddingHorizontal: 0 }}>
              <View style={styles.grid}>
                {posts.map(post => (
                  <PressableScale
                    key={post.id}
                    style={[styles.gridCell, { width: gridCellSize, height: gridCellSize }]}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel="Open post"
                    onPress={() => {
                      hapticSelection();
                      const qs = new URLSearchParams({
                        postId: post.id,
                        postAuthorName: displayName,
                        postAuthorInitials: displayInitials,
                        postAuthorColor: hasRealColor ? color : theme.cardElevated,
                        postMediaColor1: post.mediaColors?.[0] ?? '#1a1a2e',
                        postMediaColor2: post.mediaColors?.[1] ?? '#0d0d1a',
                        postType: post.type,
                      });
                      router.push(`/buyer-post-viewer?${qs.toString()}` as never);
                    }}
                  >
                    {post.mediaUrl
                      ? <Image source={{ uri: post.mediaUrl }} style={styles.gridCellInner} resizeMode="cover" />
                      : <View style={[styles.gridCellInner, styles.gridCellPlaceholder]}>
                          <Feather name={postTypeIcon(post.type) as any} size={ICON.md} color={theme.muted} />
                        </View>
                    }
                  </PressableScale>
                ))}
              </View>
            </ResponsiveContainer>
          )}
        </View>
      </Animated.ScrollView>

      {/* ── More options sheet ── */}
      <Modal visible={moreSheetOpen} transparent animationType="slide" onRequestClose={() => setMoreSheetOpen(false)}>
        <PressableScale style={styles.moreBackdrop} activeOpacity={1} onPress={() => setMoreSheetOpen(false)}>
          <PressableScale activeOpacity={1} style={[styles.moreSheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.moreHandle} />
            <Text style={styles.moreTitle}>{displayName}</Text>
            <PressableScale style={styles.moreRow} onPress={handleMute} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Mute">
              <Feather name="volume-x" size={20} color={theme.text} /><Text style={styles.moreRowText}>Mute</Text>
            </PressableScale>
            <View style={styles.moreDivider} />
            <PressableScale style={styles.moreRow} onPress={handleRestrict} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Restrict">
              <Feather name="user-x" size={20} color={theme.text} /><Text style={styles.moreRowText}>Restrict</Text>
            </PressableScale>
            <View style={styles.moreDivider} />
            <PressableScale style={styles.moreRow} onPress={handleReport} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Report">
              <Feather name="flag" size={20} color={theme.text} /><Text style={styles.moreRowText}>Report</Text>
            </PressableScale>
            <View style={styles.moreDivider} />
            <PressableScale style={styles.moreRow} onPress={handleBlock} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={iBlockedThem ? 'Unblock' : 'Block'}>
              <Feather name="slash" size={20} color={theme.error} /><Text style={[styles.moreRowText, { color: theme.error }]}>{iBlockedThem ? 'Unblock' : 'Block'}</Text>
            </PressableScale>
          </PressableScale>
        </PressableScale>
      </Modal>
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },

    // Compact collapsed bar (avatar thumbnail + name), fades in on scroll
    compactBar: {
      position: 'absolute', left: 0, right: 0, zIndex: 8,
      height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs,
      paddingHorizontal: 72,
    },
    compactAvatar: {
      width: 26, height: 26, borderRadius: 13,
      alignItems: 'center', justifyContent: 'center',
    },
    compactAvatarText: { fontFamily: FONT.bold, fontSize: 10, color: theme.onAccent },
    compactName: { fontFamily: FONT.semibold, fontSize: FS.sm, color: theme.text, maxWidth: '70%' },

    // Floating nav buttons
    backBtn: {
      position: 'absolute', left: SP.md, zIndex: 10,
      width: 40, height: 40, backgroundColor: 'rgba(10,10,11,0.75)', // theme-exempt: scrim over media/hero backdrop
      borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    },
    inboxBtn: {
      position: 'absolute', right: SP.md, zIndex: 9,
      height: 36, flexDirection: 'row', alignItems: 'center', gap: SP.xs,
      paddingHorizontal: SP.sm, borderRadius: RADIUS.pill,
      backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
    },
    inboxBtnText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.text },

    // Centered avatar
    avatarSection: { alignItems: 'center', paddingTop: SP.md, paddingBottom: SP.md },
    avatar: {
      width: 96, height: 96, borderRadius: 48,
      alignItems: 'center', justifyContent: 'center',
    },
    avatarActive: { borderWidth: 2, borderColor: theme.accent },
    avatarText: { fontFamily: FONT.bold, fontSize: FS.xl, color: theme.onAccent },

    // Info
    infoSection: { alignItems: 'center', paddingHorizontal: SP.lg, marginTop: SP.sm, gap: 4 },
    nameText: { fontFamily: FONT.bold, fontSize: FS.lg, color: theme.text, textAlign: 'center' },
    handleText: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted },
    bioText: { fontFamily: FONT.regular, fontSize: FS.sm, color: theme.muted, textAlign: 'center', lineHeight: 19, marginTop: 2 },
    followsYouPill: {
      marginTop: SP.xs, backgroundColor: theme.card,
      borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.pill,
      paddingHorizontal: SP.sm, paddingVertical: 3,
    },
    followsYouText: { fontFamily: FONT.medium, fontSize: FS.xs, color: theme.muted },
    blockedBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14,
      padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
    },
    blockedBannerText: { flex: 1, color: theme.muted, fontSize: FS.xs, lineHeight: 18 },
    blockedBannerAction: { color: theme.text, fontSize: FS.xs, fontFamily: FONT.semibold },

    // Stats — centered horizontal
    statsRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: SP.md, marginTop: SP.md,
      borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.border,
      paddingVertical: SP.md,
    },
    statItem: { flex: 1, alignItems: 'center' },
    statNum:  { fontFamily: FONT.bold, fontSize: FS.md, color: theme.text },
    statSkeleton: { marginBottom: 2 },
    statLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: theme.muted, marginTop: 2 },
    statDivider: { width: 1, height: 24, backgroundColor: theme.border },

    // Action buttons
    actionButtons: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: SP.md, paddingVertical: SP.md,
      gap: SP.sm,
    },
    followMorphBtn: { width: '100%', height: 40 },
    outlineBtn: {
      minWidth: 70, height: 40,
      backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border,
      borderRadius: RADIUS.md, flexDirection: 'row',
      alignItems: 'center', justifyContent: 'center',
    },
    outlineBtnText: { fontFamily: FONT.medium, fontSize: FS.sm, color: theme.text },
    moreBtn: {
      width: 44, height: 44, backgroundColor: theme.card,
      borderWidth: 1, borderColor: theme.border, borderRadius: RADIUS.md,
      alignItems: 'center', justifyContent: 'center',
    },

    // Posts grid
    postsSection: { marginTop: SP.xs },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
    gridCell: { width: CELL_SIZE, height: CELL_SIZE, overflow: 'hidden' },
    gridCellInner: { width: '100%', height: '100%' },
    gridCellPlaceholder: { backgroundColor: theme.card, alignItems: 'center', justifyContent: 'center' },

    // More sheet
    moreBackdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' }, // theme-exempt: modal scrim
    moreSheet: {
      backgroundColor: theme.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
      paddingHorizontal: SP.md, paddingTop: SP.md,
    },
    moreHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: SP.md },
    moreTitle: { fontFamily: FONT.bold, fontSize: FS.md, color: theme.text, paddingBottom: SP.sm },
    moreRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, minHeight: 44 },
    moreRowText: { fontFamily: FONT.medium, fontSize: FS.base, color: theme.text },
    moreDivider: { height: 1, backgroundColor: theme.border },
  });
}
