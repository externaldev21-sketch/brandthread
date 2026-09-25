/**
 * Another buyer's profile — the same ProfileShell as every other profile,
 * filled with the buyer-to-buyer pieces: Follow / Follow back / Friends,
 * Message, stories, "Follows you", mute / restrict / report / block.
 *
 * Buyer posts are friends-only (mutual follows), exactly as the API enforces;
 * a non-friend sees a clear locked state instead of an empty grid.
 */
import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { View, Text, Alert, StyleSheet, Modal } from 'react-native';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { FONT, FS, SP, RADIUS, OVERLAY } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';
import { FollowMorphButton } from '@/components/ui/MotionPrimitives';
import { hapticLight, hapticSelection, hapticSuccess } from '@/lib/haptics';
import { muteUser, restrictUser, createOrGetConversation } from '@/services/socialService';
import { useApi } from '@/lib/api';
import { useAuth } from '@clerk/expo';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';
import { confirmBlock, confirmUnblock, reportHref } from '@/lib/safety';
import { emitProfileEvent, subscribeProfileEvents } from '@/lib/profileEvents';
import { connectionsHref, profileVideosHref } from '@/lib/profileNavigation';
import { formatProfileCount } from '@/services/profileService';
import { ProfileShell, ProfileMeta } from '@/components/profile/ProfileShell';
import {
  InteractionLayer, ProfileButton, ProfileChip, ProfileGlassButton, type ProfileStat,
} from '@/components/profile/ProfileControls';
import { ProfileVideoTile, gridItemFromThreadPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridFooter, ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { profileEmptyState } from '@/components/profile/profileEmptyStates';
import { useProfileLayout } from '@/components/profile/profileLayout';
import { useCreatorVideos } from '@/components/profile/useCreatorVideos';

type RemoteProfile = {
  userId?: string;
  name: string; username: string | null; displayName: string | null;
  bio: string | null; avatarUrl?: string | null;
  followersCount: number; followingCount: number;
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
  const layout  = useProfileLayout();
  const { userId: currentUserId } = useAuth();
  const params  = useLocalSearchParams<{
    userId: string; name: string; handle: string; initials: string; color: string;
  }>();

  const userId   = params.userId  || 'u_unknown';
  const name     = params.name    || 'Unknown';
  const handle   = params.handle  || '@unknown';
  const initials = params.initials || '?';
  const color    = params.color   || theme.cardElevated;

  const [profile, setProfile]           = useState<RemoteProfile | null>(null);
  const [apiLoaded, setApiLoaded]       = useState(false);
  const [loadFailed, setLoadFailed]     = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [msgLoading, setMsgLoading]     = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [storyIds, setStoryIds]         = useState<string[]>([]);
  const [refreshing, setRefreshing]     = useState(false);
  // Canonical clerkId resolved from the profile API response. The route
  // `userId` may be a DB UUID alias when arriving from /u/[username]; every
  // follow / message / block / videos call uses the canonical id.
  const [canonicalUserId, setCanonicalUserId] = useState<string>(userId);
  const canonicalReady = apiLoaded && !canonicalUserId.startsWith('u_') && !loadFailed;

  const displayName = profile ? (profile.displayName || profile.name || name) : name;
  const displayHandle = profile?.username ? `@${profile.username}` : handle;
  const displayInitials = profile ? (displayName.trim()[0]?.toUpperCase() || initials) : initials;
  const isFollowing   = profile?.isFollowing  ?? false;
  const isFollowedBy  = profile?.isFollowedBy ?? false;
  const isMutual      = profile?.isMutual     ?? false;
  const iBlockedThem  = profile?.iBlockedThem ?? false;

  const videos = useCreatorVideos(canonicalReady && !iBlockedThem ? canonicalUserId : null);

  // ── Load profile + stories ─────────────────────────────────────────────────
  const loadProfile = useCallback(async () => {
    if (!userId || userId.startsWith('u_')) { setApiLoaded(true); setLoadFailed(true); return; }
    try {
      const profileData = await api.social.profile(userId);
      const resolvedId: string = (profileData as RemoteProfile).userId ?? userId;
      setProfile(profileData as RemoteProfile);
      setCanonicalUserId(resolvedId);
      setLoadFailed(false);
      const stories = await api.social.storiesForUser(resolvedId).catch(() => []);
      setStoryIds((Array.isArray(stories) ? stories : []).map((s: any) => s.id));
    } catch {
      setLoadFailed(true);
    } finally {
      setApiLoaded(true);
    }
  }, [api, userId]);

  useFocusEffect(useCallback(() => { loadProfile(); }, [loadProfile]));

  // Follows made elsewhere (lists, feed) keep this profile's counts current.
  useEffect(() => subscribeProfileEvents((event) => {
    if (event.type !== 'follow' || event.targetId !== canonicalUserId) return;
    setProfile((prev) => prev ? {
      ...prev,
      isFollowing: event.isFollowing,
      isMutual: event.isFollowing && prev.isFollowedBy,
      followersCount: typeof event.followersCount === 'number' ? event.followersCount : prev.followersCount,
    } : prev);
  }), [canonicalUserId]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadProfile(), videos.reload()]);
    setRefreshing(false);
  }, [loadProfile, videos]);

  const openStories = () => {
    if (storyIds.length === 0) return;
    hapticLight();
    router.push({
      pathname: '/buyer-story-viewer' as any,
      params: { storyId: storyIds[0], allStoryIds: storyIds.join(',') },
    });
  };

  // ── Follow / unfollow ──────────────────────────────────────────────────────
  const handleFollow = async () => {
    if (!canonicalReady || followLoading) return;
    const wasFollowing = isFollowing;
    setFollowLoading(true);
    setProfile(prev => prev ? {
      ...prev,
      isFollowing: !wasFollowing,
      isMutual: wasFollowing ? false : prev.isFollowedBy,
      followersCount: Math.max(0, prev.followersCount + (wasFollowing ? -1 : 1)),
    } : prev);
    try {
      const result = wasFollowing
        ? await api.social.unfollow(canonicalUserId)
        : await api.social.follow(canonicalUserId);
      if (!wasFollowing) void requestContextualPushPermission(currentUserId, api);
      const confirmedCount = typeof result?.followersCount === 'number' ? result.followersCount : undefined;
      if (confirmedCount != null) {
        setProfile(prev => prev ? { ...prev, followersCount: confirmedCount } : prev);
      }
      emitProfileEvent({
        type: 'follow',
        targetId: canonicalUserId,
        isFollowing: !wasFollowing,
        followersCount: confirmedCount,
        viewerId: currentUserId ?? null,
      });
      // Becoming (or ceasing to be) friends changes which posts are visible.
      void videos.reload();
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
    if (msgLoading) return;
    setMsgLoading(true);
    try {
      const conv = await createOrGetConversation({
        type: 'buyer_to_buyer',
        participant: { userId: canonicalUserId, name: displayName, handle: displayHandle, initials: displayInitials, color, accountType: 'buyer' },
      });
      router.push(`/buyer-conversation?id=${conv.id}` as any);
    } catch {
      Alert.alert("Couldn't open conversation", 'Try again.');
    } finally {
      setMsgLoading(false);
    }
  };

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

  const openVideo = useCallback((item: ProfileGridItem) => {
    hapticSelection();
    router.push(profileVideosHref({ source: 'creator', id: canonicalUserId, startPostId: item.id, title: displayName }) as never);
  }, [canonicalUserId, displayName, router]);

  const gridItems = useMemo(() => videos.posts.map(gridItemFromThreadPost), [videos.posts]);
  const renderTile = useCallback(({ item, index }: { item: ProfileGridItem; index: number }) => (
    <ProfileVideoTile item={item} index={index} width={layout.tileWidth} height={layout.tileHeight} onPress={openVideo} />
  ), [layout.tileHeight, layout.tileWidth, openVideo]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(buyer)/' as never);
  };

  const postsCount = videos.restricted ? (profile?.postsCount ?? 0) : Math.max(videos.total, 0);
  const stats: ProfileStat[] = [
    { key: 'posts', label: 'Posts', value: formatProfileCount(postsCount) },
    {
      key: 'followers', label: 'Followers', value: formatProfileCount(profile?.followersCount ?? 0),
      onPress: canonicalReady ? () => router.push(connectionsHref('followers', canonicalUserId) as never) : undefined,
    },
    {
      key: 'following', label: 'Following', value: formatProfileCount(profile?.followingCount ?? 0),
      onPress: canonicalReady ? () => router.push(connectionsHref('following', canonicalUserId) as never) : undefined,
    },
  ];

  const meta = (
    <ProfileMeta bio={profile?.bio ?? null}>
      {isFollowedBy && !isMutual ? <ProfileChip label="Follows you" icon="user-check" /> : null}
      {isMutual ? <ProfileChip label="Friends" icon="users" tone="accent" /> : null}
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
    </ProfileMeta>
  );

  const followDisabled = !canonicalReady || followLoading || iBlockedThem;
  const actions = (
    <>
      <View style={styles.actionRow}>
        <View style={styles.flex}>
          <FollowMorphButton
            following={isFollowing}
            onChange={handleFollow}
            disabled={followDisabled}
            followLabel={isFollowedBy ? 'Follow back' : 'Follow'}
            followingLabel={isMutual ? 'Friends' : 'Following'}
            style={styles.followMorphBtn}
            labelStyle={{ fontFamily: FONT.bold, fontSize: FS.base }}
          />
        </View>
        <ProfileButton
          label={msgLoading ? 'Opening…' : 'Message'}
          icon="message-circle"
          onPress={handleMessage}
          disabled={msgLoading || !canonicalReady || iBlockedThem}
        />
      </View>
      <View style={styles.actionRow}>
        <ProfileButton
          label="Stories"
          icon="circle"
          onPress={openStories}
          disabled={storyIds.length === 0}
          accessibilityLabel={storyIds.length > 0 ? `View ${displayName}'s story` : 'No active stories'}
        />
        <ProfileButton label="More" icon="more-horizontal" onPress={() => { hapticSelection(); setMoreSheetOpen(true); }} accessibilityLabel="More options" />
      </View>
    </>
  );

  return (
    <>
      <ProfileShell
        testID="buyer-other-profile"
        identity={{
          name: displayName,
          handle: displayHandle,
          initials: displayInitials,
          avatarUrl: profile?.avatarUrl ?? null,
          roleLabel: 'Buyer',
        }}
        avatar={storyIds.length > 0
          ? { ring: true, onPress: openStories, accessibilityLabel: `View ${displayName}'s story` }
          : undefined}
        hero={{
          videoUri: videos.posts.find((post) => post.contentType === 'video')?.mediaUris[0] ?? null,
          posterUri: gridItems.find((item) => item.posterUri)?.posterUri ?? null,
        }}
        topLeft={<ProfileGlassButton icon="arrow-left" onPress={goBack} accessibilityLabel="Go back" />}
        topRight={(
          <ProfileGlassButton
            icon="message-circle"
            onPress={() => { hapticLight(); router.push('/(buyer)/inbox' as never); }}
            accessibilityLabel="Messages"
          />
        )}
        meta={meta}
        stats={stats}
        statsLoading={!apiLoaded}
        actions={actions}
        section={{ label: 'Posts', count: videos.restricted ? undefined : videos.total }}
        data={gridItems}
        renderItem={renderTile}
        keyExtractor={(item) => item.id}
        numColumns={layout.gridColumns}
        listKey={`buyer-other-${layout.gridColumns}`}
        ListEmptyComponent={
          loadFailed && apiLoaded ? (
            <ProfileGridPlaceholder
              loading={false}
              error
              onRetry={() => { setApiLoaded(false); void loadProfile(); }}
              layout={layout}
              title="Couldn't load this profile"
            />
          ) : (
            <ProfileGridPlaceholder
              loading={!apiLoaded || (!iBlockedThem && videos.loading)}
              error={videos.error}
              onRetry={() => { void videos.reload(); }}
              layout={layout}
              icon={videos.restricted ? 'lock' : 'image'}
              title={iBlockedThem ? 'Posts hidden' : videos.restricted ? 'Posts are for friends' : 'No posts yet'}
              description={iBlockedThem
                ? 'Unblock to see each other’s posts again.'
                : videos.restricted
                  ? `Follow each other to see ${displayName}'s posts.`
                  : profileEmptyState('buyer:posts', false).message}
            />
          )
        }
        ListFooterComponent={<ProfileGridFooter loadingMore={videos.loadingMore} />}
        onEndReached={videos.loadMore}
        refreshing={refreshing}
        onRefresh={handleRefresh}
      />

      {/* ── More options sheet ── */}
      <Modal visible={moreSheetOpen} transparent animationType="slide" onRequestClose={() => setMoreSheetOpen(false)}>
        <View style={styles.moreBackdrop}>
          <PressableScale style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMoreSheetOpen(false)} accessibilityLabel="Close options" />
          <View style={[styles.moreSheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.moreHandle} />
            <Text style={styles.moreTitle}>{displayName}</Text>
            <MoreRow icon="volume-x" label="Mute" onPress={handleMute} />
            <View style={styles.moreDivider} />
            <MoreRow icon="user-x" label="Restrict" onPress={handleRestrict} />
            <View style={styles.moreDivider} />
            <MoreRow icon="flag" label="Report" onPress={handleReport} />
            <View style={styles.moreDivider} />
            <MoreRow icon="slash" label={iBlockedThem ? 'Unblock' : 'Block'} onPress={handleBlock} destructive />
          </View>
        </View>
      </Modal>
    </>
  );
}

function MoreRow({ icon, label, onPress, destructive }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; destructive?: boolean }) {
  const { theme } = useAppTheme();
  const color = destructive ? theme.error : theme.text;
  return (
    <PressableScale style={moreRowStyles.row} onPress={onPress} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={label}>
      {(state) => (
        <>
          <InteractionLayer state={state as { pressed: boolean }} radius={RADIUS.sm} theme={theme} />
          <Feather name={icon} size={20} color={color} />
          <Text style={[moreRowStyles.text, { color }]}>{label}</Text>
        </>
      )}
    </PressableScale>
  );
}

const moreRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 50, paddingHorizontal: SP.xs },
  text: { fontFamily: FONT.medium, fontSize: FS.base },
});

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    flex: { flex: 1 },
    actionRow: { flexDirection: 'row', gap: SP.sm },
    followMorphBtn: { width: '100%', minHeight: 48, borderRadius: RADIUS.md },
    blockedBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: SP.sm,
      padding: 12, borderRadius: RADIUS.md, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card,
    },
    blockedBannerText: { flex: 1, color: theme.muted, fontSize: FS.xs, lineHeight: 18 },
    blockedBannerAction: { color: theme.text, fontSize: FS.xs, fontFamily: FONT.semibold },
    moreBackdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' }, // theme-exempt: modal scrim
    moreSheet: {
      backgroundColor: theme.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
      paddingHorizontal: SP.md, paddingTop: SP.md,
    },
    moreHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border, alignSelf: 'center', marginBottom: SP.md },
    moreTitle: { fontFamily: FONT.bold, fontSize: FS.md, color: theme.text, paddingBottom: SP.sm },
    moreDivider: { height: 1, backgroundColor: theme.border },
  });
}
