import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, Image,
  StyleSheet, Dimensions, Modal, ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import {
  BG, CARD, BORDER,
  FG, MUTED, SUBTLE, ON_DARK, RED, OVERLAY,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import { PrimaryButton, SecondaryButton } from '@/components/BrandthreadUI';
import {
  muteUser, restrictUser, createOrGetConversation,
} from '@/services/socialService';
import { useApi } from '@/lib/api';
import { useAuth } from '@clerk/expo';
import { requestContextualPushPermission } from '@/lib/contextualPushPermission';

const { width } = Dimensions.get('window');
const GRID_GAP  = 2;
const CELL_SIZE = (width - GRID_GAP * 2) / 3;

type ProfilePost = { id: string; mediaUrl?: string; mediaColors: string[]; type: string };

type RemoteProfile = {
  name: string; username: string | null; displayName: string | null;
  bio: string | null; followersCount: number; followingCount: number;
  isFollowing: boolean; isFollowedBy: boolean; isMutual: boolean;
  iBlockedThem: boolean;
  postsCount: number;
};

export default function BuyerOtherProfileScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = colors.accent, CYAN = theme.secondary, CYAN_DIM = theme.secondaryDim;
  const BORDER_ACTIVE = `${theme.accent}73`;
  const GRAD_PRIMARY = theme.primaryGradient;
  const styles = makeStyles(theme);
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
  const color    = params.color   || PURPLE;

  // ── Remote profile state (from API) ────────────────────────────────────────
  const [profile, setProfile]           = useState<RemoteProfile | null>(null);
  const [apiLoaded, setApiLoaded]       = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [msgLoading, setMsgLoading]     = useState(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  // Story ring — active stories for this user, visible to any viewer
  const [storyIds, setStoryIds]         = useState<string[]>([]);
  const [posts, setPosts]               = useState<ProfilePost[]>([]);

  // Derived display values — prefer API data, fall back to route params
  const displayName = profile ? (profile.displayName || profile.name || name) : name;
  const displayBio  = profile?.bio ?? null;
  const isFollowing   = profile?.isFollowing  ?? false;
  const isFollowedBy  = profile?.isFollowedBy ?? false;
  const isMutual      = profile?.isMutual     ?? false;
  const followersCount = profile?.followersCount ?? 0;
  const followingCount = profile?.followingCount ?? 0;

  // ── Load profile + stories from API ───────────────────────────────────────
  const loadProfile = useCallback(async () => {
    // Only try real API if userId looks like a Clerk ID
    if (!userId || userId.startsWith('u_')) { setApiLoaded(true); return; }
    try {
      const [profileData, storiesData, postsData] = await Promise.allSettled([
        api.social.profile(userId),
        api.social.storiesForUser(userId),
        api.social.profilePosts(userId),
      ]);
      if (profileData.status === 'fulfilled') setProfile(profileData.value as RemoteProfile);
      if (storiesData.status === 'fulfilled') {
        setStoryIds((storiesData.value as any[]).map((s: any) => s.id));
      }
      if (postsData.status === 'fulfilled') setPosts(Array.isArray(postsData.value) ? postsData.value : []);
    } catch {
      // Non-existent user or network error — degrade gracefully
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

  // ── Follow / unfollow ──────────────────────────────────────────────────────
  const handleFollow = async () => {
    if (!apiLoaded || userId.startsWith('u_')) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        await api.social.unfollow(userId);
        setProfile(prev => prev ? { ...prev, isFollowing: false, isMutual: false, followersCount: Math.max(0, prev.followersCount - 1) } : prev);
      } else {
        await api.social.follow(userId);
        setProfile(prev => prev ? { ...prev, isFollowing: true, isMutual: prev.isFollowedBy, followersCount: prev.followersCount + 1 } : prev);
        // This API call has completed successfully for a non-demo profile, so
        // it is an appropriate first-value moment to ask about native push.
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
      const conv = await createOrGetConversation({
        type: 'buyer_to_buyer',
        participant: { userId, name: displayName, handle, initials, color, accountType: 'buyer' },
      });
      router.push(`/buyer-conversation?id=${conv.id}` as any);
    } catch {
      Alert.alert('Error', 'Could not open conversation.');
    } finally {
      setMsgLoading(false);
    }
  };

  const iBlockedThem = profile?.iBlockedThem ?? false;

  const handleMute     = async () => { setMoreSheetOpen(false); await muteUser({ userId, name: displayName, handle, initials, color }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };
  const handleRestrict = async () => { setMoreSheetOpen(false); await restrictUser({ userId, name: displayName, handle, initials, color }); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };
  const handleBlock = async () => {
    setMoreSheetOpen(false);
    try {
      if (iBlockedThem) {
        await api.social.unblock(userId);
        setProfile(prev => prev ? { ...prev, iBlockedThem: false } : prev);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        await api.social.block(userId);
        router.back();
      }
    } catch {
      Alert.alert('Error', 'Could not update block status.');
    }
  };
  const handleReport   = () => { setMoreSheetOpen(false); router.push(`/buyer-report?targetType=profile&targetId=${userId}&targetLabel=${encodeURIComponent(displayName)}&targetUserId=${userId}` as any); };

  const postTypeIcon = (type: string) => type === 'photo' ? 'image' : type === 'slideshow' ? 'layers' : 'video';

  // ── Button label helpers ───────────────────────────────────────────────────
  function renderFollowButton() {
    if (!apiLoaded || userId.startsWith('u_')) {
      // Demo user — no real follow
      return (
        <SecondaryButton label="Follow" onPress={() => {}} disabled style={{ flex: 1 }} />
      );
    }
    if (followLoading) {
      return (
        <View style={[styles.outlineBtn, { flex: 1 }]}>
          <ActivityIndicator size="small" color={PURPLE} />
        </View>
      );
    }
    if (isFollowing) {
      // Show "Following" — tap to unfollow
      return (
        <SecondaryButton label={isMutual ? 'Friends' : 'Following'} icon="check" onPress={handleFollow} style={{ flex: 1 }} />
      );
    }
    if (isFollowedBy) {
      // They follow me — show "Follow Back"
      return (
        <PrimaryButton label="Follow Back" onPress={handleFollow} style={{ flex: 1 }} />
      );
    }
    // Stranger — show "Follow"
    return (
      <PrimaryButton label="Follow" onPress={handleFollow} style={{ flex: 1 }} />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Back */}
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + SP.md }]}
        onPress={() => router.back()}
      >
        <Feather name="arrow-left" size={ICON.md} color={FG} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.inboxBtn, { top: insets.top + SP.md }]}
        onPress={() => router.push('/(buyer)/inbox' as never)}
      >
        <Feather name="message-circle" size={ICON.sm} color={FG} />
        <Text style={styles.inboxBtnText}>Messages</Text>
      </TouchableOpacity>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
        {/* Cover gradient */}
        <LinearGradient colors={[color, BG] as [string, string]} style={styles.cover} />

        {/* Profile row */}
        <View style={styles.profileRow}>
          {/* Avatar — with story ring if active stories exist */}
          {storyIds.length > 0 ? (
            <TouchableOpacity onPress={openStories} activeOpacity={0.85}>
              <LinearGradient
                colors={GRAD_PRIMARY as unknown as [string, string, ...string[]]}
                start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }}
                style={styles.storyRing}
              >
                <View style={[styles.avatar, { backgroundColor: color, margin: 3 }]}>
                  <Text style={styles.avatarText}>{initials}</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={[styles.avatar, { backgroundColor: color }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
          )}

          {/* Action buttons */}
          <View style={styles.actionButtons}>
            {renderFollowButton()}

            {/* Message — always visible */}
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
        </View>

        {/* Profile info */}
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
        </View>

        {/* Stats row */}
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

        {/* Content grid */}
        <View style={styles.postsSection}>
          {posts.length === 0 ? (
            <View style={styles.emptyState}>
              <Feather name="image" size={32} color={MUTED} />
              <Text style={styles.emptyTitle}>No posts yet.</Text>
            </View>
          ) : (
            <View style={styles.grid}>
              {posts.map(post => (
                <View key={post.id} style={styles.gridCell}>
                  {post.mediaUrl
                    ? <Image source={{ uri: post.mediaUrl }} style={styles.gridCellInner} resizeMode="cover" />
                    : <LinearGradient colors={post.mediaColors as [string, string]} style={styles.gridCellInner}>
                        <Feather name={postTypeIcon(post.type) as any} size={ICON.md} color={MUTED} />
                      </LinearGradient>
                  }
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* More options sheet */}
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

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent, PURPLE_LIGHT = theme.accentLight, PURPLE_DIM = theme.accentDim, CYAN = theme.secondary, CYAN_DIM = theme.secondaryDim;
  const BORDER_ACTIVE = `${theme.accent}73`;
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  backBtn: {
    position: 'absolute', left: SP.md, zIndex: 10,
    width: 40, height: 40, backgroundColor: 'rgba(7,7,15,0.7)',
    borderRadius: 20, alignItems: 'center', justifyContent: 'center',
  },
  inboxBtn: {
    position: 'absolute', right: SP.md, zIndex: 5,
    height: 40, flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    paddingHorizontal: SP.sm, borderRadius: RADIUS.pill,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
  },
  inboxBtnText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  cover: { height: 180, width: '100%' },
  profileRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: SP.md, marginTop: -40, gap: SP.md,
  },
  storyRing: {
    borderRadius: 46,
    padding: 3,
  },
  avatar: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: BG,
  },
  avatarText: { fontFamily: FONT.bold, fontSize: FS.xl, color: ON_DARK },
  actionButtons: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    gap: SP.xs, flexWrap: 'wrap', marginBottom: SP.xs,
  },
  outlineBtn: {
    flex: 1, minWidth: 70, height: 40,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER_ACTIVE,
    borderRadius: RADIUS.pill, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
  },
  outlineBtnText: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  moreBtn: {
    width: 40, height: 40, backgroundColor: CARD,
    borderWidth: 1, borderColor: BORDER, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  infoSection: { paddingHorizontal: SP.md, marginTop: SP.sm, gap: 4 },
  nameText:    { fontFamily: FONT.bold,    fontSize: FS.lg,   color: FG },
  handleText:  { fontFamily: FONT.regular, fontSize: FS.sm,   color: MUTED },
  bioText:     { fontFamily: FONT.regular, fontSize: FS.base, color: SUBTLE, marginTop: SP.xs },
  followsYouPill: {
    alignSelf: 'flex-start', marginTop: SP.xs,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 3,
  },
  followsYouText: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED },
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: SP.md, marginTop: SP.md,
    backgroundColor: CARD,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER,
    paddingVertical: SP.md,
  },
  statItem:    { flex: 1, alignItems: 'center' },
  statNum:     { fontFamily: FONT.bold, fontSize: FS.md, color: FG },
  statLabel:   { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
  statDivider: { width: 1, height: 24, backgroundColor: BORDER },
  postsSection: { marginTop: SP.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gridCell: { width: CELL_SIZE, height: CELL_SIZE, overflow: 'hidden' },
  gridCellInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: SP.xl, gap: SP.md },
  emptyTitle: { fontFamily: FONT.medium, fontSize: FS.base, color: MUTED },
  moreBackdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  moreSheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SP.md, paddingTop: SP.md,
  },
  moreHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.md },
  moreTitle:  { fontFamily: FONT.bold, fontSize: FS.md, color: FG, paddingBottom: SP.sm },
  moreRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  moreRowText: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  moreDivider: { height: 1, backgroundColor: BORDER },
  });
};
