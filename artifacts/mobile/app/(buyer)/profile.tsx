import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert,
  StyleSheet, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, CYAN,
  GRAD_PRIMARY, FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import {
  getMyProfile, getMyPosts, getMyReposts, getSavedItems,
  getPrivacySettings, archivePost, deletePost, likePost, repostPost,
  subscribeSocial, MY_USER_ID, MY_COLOR, MY_INITIALS, MY_HANDLE,
} from '@/services/socialService';
import type {
  BuyerSocialProfile, BuyerPost, RepostRecord, SavedItem, PrivacySettings,
} from '@/services/socialTypes';

const { width } = Dimensions.get('window');
const GRID_GAP = SP.xs;
const CELL_SIZE = (width - SP.md * 2 - GRID_GAP * 2) / 3;

const TABS = ['Posts', 'Tagged', 'Reposts', 'Saved'] as const;
type Tab = typeof TABS[number];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [profile, setProfile] = useState<BuyerSocialProfile | null>(null);
  const [posts, setPosts] = useState<BuyerPost[]>([]);
  const [reposts, setReposts] = useState<RepostRecord[]>([]);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Posts');

  const loadData = useCallback(async () => {
    const [p, po, rp, sv, pr] = await Promise.all([
      getMyProfile(),
      getMyPosts(),
      getMyReposts(),
      getSavedItems(),
      getPrivacySettings(),
    ]);
    setProfile(p);
    setPosts(po.filter(x => !x.isArchived && !x.isDraft));
    setReposts(rp);
    setSavedItems(sv);
    setPrivacySettings(pr);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  useEffect(() => {
    const unsub = subscribeSocial(() => { loadData(); });
    return unsub;
  }, [loadData]);

  const handleMenu = () => {
    Alert.alert('Menu', undefined, [
      { text: 'My Orders', onPress: () => router.push('/(buyer)/orders') },
      { text: 'Edit Profile', onPress: () => router.push('/(buyer)/edit-profile') },
      { text: 'Notifications', onPress: () => router.push('/buyer-notifications' as any) },
      { text: 'Privacy', onPress: () => router.push('/buyer-privacy-settings' as any) },
      { text: 'Help', onPress: () => {} },
      { text: 'Sign out', style: 'destructive', onPress: () => {} },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handlePostLongPress = (post: BuyerPost) => {
    Alert.alert('Post', post.caption, [
      { text: 'Archive', onPress: () => archivePost(post.id) },
      { text: 'Delete', style: 'destructive', onPress: () => deletePost(post.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handlePostTap = (post: BuyerPost) => {
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
  };

  const postTypeIcon = (type: BuyerPost['type']): string => {
    if (type === 'photo') return 'image';
    if (type === 'slideshow') return 'layers';
    return 'video';
  };

  const savedTypeIcon = (type: string): string => {
    if (type === 'post') return 'bookmark';
    if (type === 'product') return 'shopping-bag';
    if (type === 'collection') return 'folder';
    return 'home';
  };

  const joinedYear = profile ? new Date(profile.createdAt).getFullYear() : '';
  const isPrivate = privacySettings?.profileVisibility === 'private';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Feather
            name={isPrivate ? 'lock' : 'globe'}
            size={ICON.sm}
            color={MUTED}
          />
          <Text style={styles.topHandle}>{profile?.username ? `@${profile.username}` : MY_HANDLE}</Text>
        </View>
        <View style={styles.topBarRight}>
          <TouchableOpacity
            onPress={() => router.push('/buyer-notifications' as any)}
            style={styles.iconBtn}
          >
            <Feather name="bell" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleMenu} style={styles.iconBtn}>
            <Feather name="menu" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
        {/* Hero Row */}
        <View style={styles.heroRow}>
          <TouchableOpacity onPress={() => router.push('/buyer-story-create' as any)} style={styles.avatarWrap}>
            <View style={[styles.avatar, { backgroundColor: MY_COLOR }]}>
              <Text style={styles.avatarText}>{profile?.avatarInitials || MY_INITIALS}</Text>
            </View>
            <View style={styles.avatarBadge}>
              <Feather name="plus-circle" size={20} color={PURPLE} />
            </View>
          </TouchableOpacity>

          <View style={styles.statsRow}>
            <TouchableOpacity style={styles.statCol}>
              <Text style={styles.statNum}>{posts.length}</Text>
              <Text style={styles.statLabel}>Posts</Text>
            </TouchableOpacity>
            <View style={styles.statDivider} />
            <TouchableOpacity
              style={styles.statCol}
              onPress={() => router.push('/buyer-friend-requests' as any)}
            >
              <Text style={styles.statNum}>{profile?.friendsCount ?? 0}</Text>
              <Text style={styles.statLabel}>Friends</Text>
            </TouchableOpacity>
            <View style={styles.statDivider} />
            <TouchableOpacity
              style={styles.statCol}
              onPress={() => router.push('/buyer-saved' as any)}
            >
              <Text style={styles.statNum}>{savedItems.length}</Text>
              <Text style={styles.statLabel}>Saved</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Name Section */}
        <View style={styles.nameSection}>
          <Text style={styles.profileName}>{profile?.name || 'Jordan'}</Text>
          {profile?.pronouns ? (
            <Text style={styles.pronouns}>({profile.pronouns})</Text>
          ) : null}
          <Text style={styles.handleYear}>
            {profile?.username ? `@${profile.username}` : MY_HANDLE}{joinedYear ? ` · Joined ${joinedYear}` : ''}
          </Text>
          {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          {profile?.website ? <Text style={styles.website}>{profile.website}</Text> : null}
          <View style={styles.privacyBadge}>
            <Feather name={isPrivate ? 'lock' : 'globe'} size={12} color={PURPLE} />
            <Text style={styles.privacyBadgeText}>{isPrivate ? 'Private' : 'Public'}</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push('/(buyer)/edit-profile')}
          >
            <Text style={styles.actionBtnText}>Edit Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => Alert.alert('Share', 'Profile link copied!')}
          >
            <Text style={styles.actionBtnText}>Share Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionIconBtn}
            onPress={() => router.push('/buyer-friend-requests' as any)}
          >
            <Feather name="user-plus" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabPill, activeTab === tab && styles.tabPillActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab Content */}
        {activeTab === 'Posts' && (
          <View style={styles.gridContainer}>
            {posts.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="image" size={32} color={MUTED} />
                <Text style={styles.emptyTitle}>No posts yet</Text>
                <Text style={styles.emptyDesc}>Your posts will appear here.</Text>
                <TouchableOpacity
                  style={styles.emptyAction}
                  onPress={() => router.push('/buyer-post-create' as any)}
                >
                  <Text style={styles.emptyActionText}>Create Post</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.grid}>
                {posts.map(post => (
                  <TouchableOpacity
                    key={post.id}
                    style={styles.gridCell}
                    onPress={() => handlePostTap(post)}
                    onLongPress={() => handlePostLongPress(post)}
                  >
                    <LinearGradient
                      colors={(post.mediaColors?.length >= 2 ? post.mediaColors : ['#1a1a2e', '#0d0d1a']) as [string, string]}
                      style={styles.gridCellInner}
                    >
                      <Feather name={postTypeIcon(post.type) as any} size={ICON.md} color={MUTED} />
                      {post.caption ? (
                        <Text style={styles.gridCaption} numberOfLines={1}>{post.caption}</Text>
                      ) : null}
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {activeTab === 'Tagged' && (
          <View style={styles.emptyState}>
            <Feather name="tag" size={32} color={MUTED} />
            <Text style={styles.emptyTitle}>No tagged posts</Text>
            <Text style={styles.emptyDesc}>Posts that tag you will appear here.</Text>
            <TouchableOpacity
              style={styles.emptyAction}
              onPress={() => router.push('/(buyer)/discover')}
            >
              <Text style={styles.emptyActionText}>Discover</Text>
            </TouchableOpacity>
          </View>
        )}

        {activeTab === 'Reposts' && (
          <View>
            {reposts.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="repeat" size={32} color={MUTED} />
                <Text style={styles.emptyTitle}>No reposts yet</Text>
                <Text style={styles.emptyDesc}>Posts you repost will appear here.</Text>
              </View>
            ) : (
              reposts.map(rp => (
                <View key={rp.id} style={styles.repostRow}>
                  <Text style={styles.repostAuthor}>{rp.originalAuthorName}</Text>
                  <Text style={styles.repostHandle}>{rp.originalAuthorHandle}</Text>
                  <Text style={styles.repostCaption} numberOfLines={2}>{rp.originalCaption}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {activeTab === 'Saved' && (
          <View>
            {savedItems.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="bookmark" size={32} color={MUTED} />
                <Text style={styles.emptyTitle}>Nothing saved yet</Text>
                <Text style={styles.emptyDesc}>Items you save will appear here.</Text>
                <TouchableOpacity
                  style={styles.emptyAction}
                  onPress={() => router.push('/buyer-saved' as any)}
                >
                  <Text style={styles.emptyActionText}>View Saved</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.savedGrid}>
                {savedItems.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.savedTile}
                    onPress={() => router.push('/buyer-saved' as any)}
                  >
                    <Feather name={savedTypeIcon(item.type) as any} size={ICON.md} color={item.accentColor || PURPLE} />
                    <Text style={styles.savedTitle} numberOfLines={2}>{item.title}</Text>
                    {item.subtitle ? (
                      <Text style={styles.savedSubtitle} numberOfLines={1}>{item.subtitle}</Text>
                    ) : null}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const SAVED_TILE = (width - SP.md * 2 - SP.sm) / 2;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  topHandle: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
    marginLeft: SP.xs,
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    marginTop: SP.md,
    gap: SP.lg,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    color: '#FFFFFF',
  },
  avatarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: BG,
    borderRadius: 12,
    padding: 1,
  },
  statsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  statCol: {
    alignItems: 'center',
    flex: 1,
  },
  statNum: {
    fontFamily: FONT.bold,
    fontSize: FS.lg,
    color: FG,
  },
  statLabel: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: BORDER,
  },
  nameSection: {
    paddingHorizontal: SP.md,
    marginTop: SP.md,
    gap: 4,
  },
  profileName: {
    fontFamily: FONT.bold,
    fontSize: FS.md,
    color: FG,
  },
  pronouns: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
  },
  handleYear: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
  },
  bio: {
    fontFamily: FONT.regular,
    fontSize: FS.base,
    color: FG,
    marginTop: 4,
  },
  website: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: CYAN,
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: PURPLE_DIM,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 4,
    marginTop: SP.xs,
    gap: 4,
  },
  privacyBadgeText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: PURPLE,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    marginTop: SP.md,
    gap: SP.sm,
  },
  actionBtn: {
    flex: 1,
    height: 40,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: FG,
  },
  actionIconBtn: {
    width: 44,
    height: 44,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: SP.md,
    marginTop: SP.md,
    gap: SP.xs,
  },
  tabPill: {
    flex: 1,
    paddingVertical: SP.xs + 2,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
  },
  tabPillActive: {
    backgroundColor: PURPLE_DIM,
    borderColor: BORDER_ACTIVE,
  },
  tabText: {
    fontFamily: FONT.medium,
    fontSize: FS.xs,
    color: MUTED,
  },
  tabTextActive: {
    color: PURPLE,
  },
  gridContainer: {
    marginTop: SP.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SP.md,
    gap: GRID_GAP,
  },
  gridCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
  },
  gridCellInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SP.xs,
  },
  gridCaption: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    position: 'absolute',
    bottom: SP.xs,
    left: SP.xs,
    right: SP.xs,
  },
  repostRow: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    marginHorizontal: SP.md,
    marginVertical: SP.xs,
    padding: SP.md,
  },
  repostAuthor: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
  },
  repostHandle: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    marginTop: 2,
  },
  repostCaption: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: SUBTLE,
    marginTop: SP.xs,
  },
  savedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SP.md,
    gap: SP.sm,
    marginTop: SP.sm,
  },
  savedTile: {
    width: SAVED_TILE,
    aspectRatio: 1,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.md,
    padding: SP.sm,
    justifyContent: 'space-between',
  },
  savedTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.sm,
    color: FG,
    marginTop: SP.xs,
  },
  savedSubtitle: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
  },
  emptyState: {
    alignItems: 'center',
    paddingHorizontal: SP.lg,
    paddingVertical: SP.xl,
  },
  emptyTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
    marginTop: SP.md,
  },
  emptyDesc: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
    textAlign: 'center',
    marginTop: SP.sm,
  },
  emptyAction: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
    marginTop: SP.md,
  },
  emptyActionText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: PURPLE,
  },
});
