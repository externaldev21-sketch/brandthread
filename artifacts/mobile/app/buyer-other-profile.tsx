import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, Image,
  StyleSheet, Dimensions, Modal, ActivityIndicator, Animated, RefreshControl,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import {
  BG, CARD, BORDER,
  FG, MUTED, SUBTLE, ON_DARK, RED, OVERLAY,
  FONT, FS, SP, RADIUS, ICON, SURFACE, ACCENT, GRID_MAX_WIDTH,
} from '@/lib/theme';
import { PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
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
  const color    = params.color   || ACCENT;

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

  // Derived display values
  const displayName = profile ? (profile.displayName || profile.name || name) : name;
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    if (!apiLoaded || canonicalUserId.startsWith('u_')) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await api.social.unfollow(canonicalUserId);
        setProfile(prev => prev ? { ...prev, isFollowing: false, isMutual: false, followersCount: Math.max(0, prev.followersCount - 1) } : prev);
      } else {
        await api.social.follow(canonicalUserId);
        setProfile(prev => prev ? { ...prev, isFollowing: true, isMutual: prev.isFollowedBy, followersCount: prev.followersCount + 1 } : prev);
        void requestContextualPushPermission(currentUserId, api);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      Alert.alert('Error', 'Could not update follow status.');
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
      Alert.alert('Error', 'Could not open conversation.');
    } finally {
      setMsgLoading(false);
    }
  };

  const iBlockedThem = profile?.iBlockedThem ?? false;

  const handleMute     = async () => { setMoreSheetOpen(false); await muteUser({ userId: canonicalUserId, name: displayName, handle, initials, color }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };
  const handleRestrict = async () => { setMoreSheetOpen(false); await restrictUser({ userId: canonicalUserId, name: displayName, handle, initials, color }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };
  const handleBlock = async () => {
    setMoreSheetOpen(false);
    const subject = { userId: canonicalUserId, name: displayName };
    if (iBlockedThem) {
      if (await confirmUnblock(subject, api.social.unblock)) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await loadProfile();
      }
    } else if (await confirmBlock(subject, api.social.block)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
    if (!apiLoaded || canonicalUserId.startsWith('u_')) {
      return <SecondaryButton label="Follow" onPress={() => {}} disabled style={{ flex: 1 }} />;
    }
    if (followLoading) {
      return (
        <View style={[styles.outlineBtn, { flex: 1 }]}>
          <ActivityIndicator size="small" color={ACCENT} />
        </View>
      );
    }
    if (isFollowing) {
      return <SecondaryButton label={isMutual ? 'Friends' : 'Following'} icon="check" onPress={handleFollow} style={{ flex: 1 }} />;
    }
    if (isFollowedBy) {
      return <PrimaryButton label="Follow Back" onPress={handleFollow} style={{ flex: 1 }} />;
    }
    return <PrimaryButton label="Follow" onPress={handleFollow} style={{ flex: 1 }} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Compact collapsed bar — avatar thumbnail + name, fades in on scroll */}
      <Animated.View pointerEvents="none" style={[styles.compactBar, { top: insets.top, opacity: compactOpacity }]}>
        <View style={[styles.compactAvatar, { backgroundColor: color }]}>
          <Text style={styles.compactAvatarText}>{initials}</Text>
        </View>
        <Text style={styles.compactName} numberOfLines={1}>{displayName}</Text>
      </Animated.View>

      {/* Back button */}
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + SP.sm }]}
        onPress={() => router.back()}
      >
        <Feather name="arrow-left" size={ICON.md} color={FG} />
      </TouchableOpacity>
      {/* Inbox shortcut */}
      <TouchableOpacity
        style={[styles.inboxBtn, { top: insets.top + SP.sm }]}
        onPress={() => router.push('/(buyer)/inbox' as never)}
      >
        <Feather name="message-circle" size={ICON.sm} color={FG} />
        <Text style={styles.inboxBtnText}>Messages</Text>
      </TouchableOpacity>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={MUTED} />}
      >
        {/* Spacer below floating back button */}
        <View style={{ height: 56 }} />

        {/* ── Centered avatar ── */}
        <View style={styles.avatarSection}>
          <TouchableOpacity
            onPress={storyIds.length > 0 ? openStories : undefined}
            activeOpacity={storyIds.length > 0 ? 0.85 : 1}
          >
            {/* No gradient ring — just a plain border when stories active */}
            <View style={[styles.avatar, { backgroundColor: color }, storyIds.length > 0 && styles.avatarActive]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Name / Handle / Bio ── */}
        <View style={styles.infoSection}>
          <Text style={styles.nameText}>{displayName}</Text>
          <Text style={styles.handleText}>{handle}</Text>
          {displayBio
            ? <Text style={styles.bioText}>{displayBio}</Text>
            : <Text style={styles.bioText}>No bio yet.</Text>
          }
          {isFollowedBy && !isMutual && (
            <View style={styles.followsYouPill}>
              <Text style={styles.followsYouText}>Follows you</Text>
            </View>
          )}
          {iBlockedThem ? (
            <TouchableOpacity
              onPress={handleBlock}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={`Unblock ${displayName}`}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14,
                padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
              }}
            >
              <Feather name="slash" size={16} color={theme.text} />
              <Text style={{ flex: 1, color: theme.muted, fontSize: 13, lineHeight: 18 }}>
                You blocked {displayName}. You won’t see each other’s posts, comments or messages.
              </Text>
              <Text style={{ color: theme.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Unblock</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* ── Stats ── */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{profile?.postsCount ?? posts.length}</Text>
            <Text style={styles.statLabel}>Posts</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{followersCount}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{followingCount}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </View>
        </View>

        {/* ── Action buttons ── */}
        <View style={styles.actionButtons}>
          {renderFollowButton()}
          <TouchableOpacity
            onPress={handleMessage}
            disabled={msgLoading}
            style={[styles.outlineBtn, { flex: 1 }]}
          >
            {msgLoading
              ? <ActivityIndicator size="small" color={FG} />
              : <Text style={styles.outlineBtnText}>Message</Text>
            }
          </TouchableOpacity>
          <TouchableOpacity style={styles.moreBtn} onPress={() => { Haptics.selectionAsync(); setMoreSheetOpen(true); }}>
            <Feather name="more-horizontal" size={ICON.md} color={FG} />
          </TouchableOpacity>
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
                  <View key={post.id} style={[styles.gridCell, { width: gridCellSize, height: gridCellSize }]}>
                    {post.mediaUrl
                      ? <Image source={{ uri: post.mediaUrl }} style={styles.gridCellInner} resizeMode="cover" />
                      : <View style={[styles.gridCellInner, { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' }]}>
                          <Feather name={postTypeIcon(post.type) as any} size={ICON.md} color={MUTED} />
                        </View>
                    }
                  </View>
                ))}
              </View>
            </ResponsiveContainer>
          )}
        </View>
      </Animated.ScrollView>

      {/* ── More options sheet ── */}
      <Modal visible={moreSheetOpen} transparent animationType="slide" onRequestClose={() => setMoreSheetOpen(false)}>
        <TouchableOpacity style={styles.moreBackdrop} activeOpacity={1} onPress={() => setMoreSheetOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.moreSheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.moreHandle} />
            <Text style={styles.moreTitle}>{displayName}</Text>
            <TouchableOpacity style={styles.moreRow} onPress={handleMute}     activeOpacity={0.7}><Feather name="volume-x"   size={20} color={FG}  /><Text style={styles.moreRowText}>Mute</Text></TouchableOpacity>
            <View style={styles.moreDivider} />
            <TouchableOpacity style={styles.moreRow} onPress={handleRestrict} activeOpacity={0.7}><Feather name="user-x"     size={20} color={FG}  /><Text style={styles.moreRowText}>Restrict</Text></TouchableOpacity>
            <View style={styles.moreDivider} />
            <TouchableOpacity style={styles.moreRow} onPress={handleReport}   activeOpacity={0.7}><Feather name="flag"       size={20} color={FG}  /><Text style={styles.moreRowText}>Report</Text></TouchableOpacity>
            <View style={styles.moreDivider} />
            <TouchableOpacity style={styles.moreRow} onPress={handleBlock}    activeOpacity={0.7}><Feather name="slash"      size={20} color={RED} /><Text style={[styles.moreRowText, { color: RED }]}>{iBlockedThem ? 'Unblock' : 'Block'}</Text></TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },

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
  compactAvatarText: { fontFamily: FONT.bold, fontSize: 10, color: ON_DARK },
  compactName: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, maxWidth: '70%' },

  // Floating nav buttons
  backBtn: {
    position: 'absolute', left: SP.md, zIndex: 10,
    width: 40, height: 40, backgroundColor: 'rgba(10,10,11,0.75)',
    borderRadius: 20, alignItems: 'center', justifyContent: 'center',
  },
  inboxBtn: {
    position: 'absolute', right: SP.md, zIndex: 9,
    height: 36, flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    paddingHorizontal: SP.sm, borderRadius: RADIUS.pill,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
  },
  inboxBtnText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },

  // Centered avatar
  avatarSection: { alignItems: 'center', paddingTop: SP.md, paddingBottom: SP.md },
  avatar: {
    width: 96, height: 96, borderRadius: 48,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarActive: { borderWidth: 2, borderColor: ACCENT },
  avatarText: { fontFamily: FONT.bold, fontSize: FS.xl, color: ON_DARK },

  // Info
  infoSection: { alignItems: 'center', paddingHorizontal: SP.lg, marginTop: SP.sm, gap: 4 },
  nameText: { fontFamily: FONT.bold, fontSize: FS.lg, color: FG, textAlign: 'center' },
  handleText: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  bioText: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', lineHeight: 19, marginTop: 2 },
  followsYouPill: {
    marginTop: SP.xs, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm, paddingVertical: 3,
  },
  followsYouText: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED },

  // Stats — centered horizontal
  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SP.md, marginTop: SP.md,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER,
    paddingVertical: SP.md,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNum:  { fontFamily: FONT.bold, fontSize: FS.md, color: FG },
  statLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
  statDivider: { width: 1, height: 24, backgroundColor: BORDER },

  // Action buttons
  actionButtons: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.md, paddingVertical: SP.md,
    gap: SP.sm,
  },
  outlineBtn: {
    minWidth: 70, height: 40,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
  },
  outlineBtnText: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  moreBtn: {
    width: 40, height: 40, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md,
    alignItems: 'center', justifyContent: 'center',
  },

  // Posts grid
  postsSection: { marginTop: SP.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gridCell: { width: CELL_SIZE, height: CELL_SIZE, overflow: 'hidden' },
  gridCellInner: { width: '100%', height: '100%' },
  emptyState: { alignItems: 'center', paddingVertical: SP.xl, gap: SP.md },
  emptyTitle: { fontFamily: FONT.medium, fontSize: FS.base, color: MUTED },

  // More sheet
  moreBackdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  moreSheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SP.md, paddingTop: SP.md,
  },
  moreHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.md },
  moreTitle: { fontFamily: FONT.bold, fontSize: FS.md, color: FG, paddingBottom: SP.sm },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  moreRowText: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  moreDivider: { height: 1, backgroundColor: BORDER },
});
