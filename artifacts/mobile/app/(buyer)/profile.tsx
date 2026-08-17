import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions, Modal, Animated, Share,
  RefreshControl, Image, Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@clerk/expo';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_DIM, CYAN,
  GRAD_PRIMARY, FONT, FS, SP, RADIUS, COMP, ICON, OVERLAY,
  RED, RED_DIM,
} from '@/lib/theme';
import {
  getMyProfile, getMyPosts, getMyReposts, getSavedItems,
  getPrivacySettings, archivePost, deletePost,
  subscribeSocial, MY_USER_ID, MY_COLOR, MY_INITIALS, MY_HANDLE,
} from '@/services/socialService';
import { useApi } from '@/lib/api';
import { loadBuyerProfile } from '@/lib/buyerProfile';
import { loadHighlights, type Highlight } from '@/lib/highlightsService';
import type {
  BuyerSocialProfile, BuyerPost, RepostRecord, SavedItem, PrivacySettings,
} from '@/services/socialTypes';

const { width } = Dimensions.get('window');
const GRID_GAP = SP.xs;
const CELL_SIZE = (width - SP.md * 2 - GRID_GAP * 2) / 3;

const TABS = ['Posts', 'Tagged', 'Reposts', 'Saved'] as const;
type Tab = typeof TABS[number];

// ─── Bottom Sheet ─────────────────────────────────────────────────────────────
function BottomSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" onRequestClose={onClose} visible={visible}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + SP.md },
            { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }] },
          ]}
        >
          <TouchableOpacity activeOpacity={1}>
            <View style={styles.sheetHandle} />
            {children}
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

function SheetRow({
  icon, label, destructive, onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.sheetRow} onPress={onPress} activeOpacity={0.7}>
      <Feather name={icon} size={ICON.md} color={destructive ? RED : FG} />
      <Text style={[styles.sheetRowText, destructive && { color: RED }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { signOut } = useAuth();
  const api     = useApi();

  const [profile, setProfile] = useState<BuyerSocialProfile | null>(null);
  const [hasActiveStory, setHasActiveStory] = useState(false);
  const [posts, setPosts] = useState<BuyerPost[]>([]);
  const [reposts, setReposts] = useState<RepostRecord[]>([]);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Posts');
  const [refreshing, setRefreshing] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);

  // Sheets
  const [menuOpen, setMenuOpen] = useState(false);
  const [postSheet, setPostSheet] = useState<BuyerPost | null>(null);

  const loadData = useCallback(async () => {
    const [p, po, rp, sv, pr, bp, hl, myStories] = await Promise.all([
      getMyProfile(),
      getMyPosts(),
      getMyReposts(),
      getSavedItems(),
      getPrivacySettings(),
      loadBuyerProfile(),
      loadHighlights(),
      api.social.myStories().catch(() => []),
    ]);
    setProfile(p);
    setPosts(po.filter(x => !x.isArchived && !x.isDraft));
    setReposts(rp);
    setSavedItems(sv);
    setPrivacySettings(pr);
    setAvatarUri(bp.avatarUri || null);
    setHighlights(hl);
    setHasActiveStory(Array.isArray(myStories) && myStories.length > 0);
  }, [api]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  useEffect(() => {
    const unsub = subscribeSocial(() => { loadData(); });
    return unsub;
  }, [loadData]);

  // ── Menu actions ──
  const handleMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMenuOpen(true);
  };

  const handleShareProfile = async () => {
    setMenuOpen(false);
    const handle = profile?.username ? `@${profile.username}` : MY_HANDLE;
    try {
      await Share.share({ message: `Find me on Brandthread: ${handle}`, title: 'Share Profile' });
    } catch {}
  };

  const handleSignOut = async () => {
    setMenuOpen(false);
    try { await signOut(); } catch {}
    router.replace('/welcome' as never);
  };

  // ── Post sheet ──
  const handlePostLongPress = (post: BuyerPost) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPostSheet(post);
  };

  const handleArchivePost = async () => {
    if (!postSheet) return;
    setPostSheet(null);
    await archivePost(postSheet.id);
    await loadData();
  };

  const handleDeletePost = async () => {
    if (!postSheet) return;
    setPostSheet(null);
    await deletePost(postSheet.id);
    await loadData();
  };

  const handleShareCurrentPost = async () => {
    const post = postSheet;
    setPostSheet(null);
    if (!post) return;
    const handle = profile?.username ? `@${profile.username}` : MY_HANDLE;
    try {
      await Share.share({
        message: `${handle} on Brandthread: "${post.caption || 'Check this out'}"`,
        title: 'Share Post',
      });
    } catch {}
  };

  const handlePostTap = (post: BuyerPost) => {
    Haptics.selectionAsync();
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
    // Navigate to the full post detail viewer
    router.push(`/buyer-post-viewer?${params.toString()}` as never);
  };

  const postTypeIcon = (type: BuyerPost['type']): keyof typeof Feather.glyphMap => {
    if (type === 'photo') return 'image';
    if (type === 'slideshow') return 'layers';
    return 'video';
  };

  const savedTypeIcon = (type: string): keyof typeof Feather.glyphMap => {
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
          <Feather name={isPrivate ? 'lock' : 'globe'} size={ICON.sm} color={MUTED} />
          <Text style={styles.topHandle}>{profile?.username ? `@${profile.username}` : MY_HANDLE}</Text>
        </View>
        <View style={styles.topBarRight}>
          <TouchableOpacity onPress={() => router.push('/buyer-notifications' as any)} style={styles.iconBtn}>
            <Feather name="bell" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleMenu} style={styles.iconBtn}>
            <Feather name="menu" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE} />}
      >
        {/* Hero Row */}
        <View style={styles.heroRow}>
          <TouchableOpacity onPress={() => router.push('/buyer-story-create' as any)} style={styles.avatarWrap}>
            {/* Purple ring when user has an active story */}
            {hasActiveStory ? (
              <LinearGradient
                colors={GRAD_PRIMARY as unknown as [string, string, ...string[]]}
                start={{ x: 0, y: 1 }} end={{ x: 1, y: 0 }}
                style={styles.storyRing}
              >
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={[styles.avatar, { resizeMode: 'cover', margin: 3 }]} />
                ) : (
                  <LinearGradient colors={GRAD_PRIMARY} style={[styles.avatar, { margin: 3 }]}>
                    <Text style={styles.avatarText}>{profile?.avatarInitials || MY_INITIALS}</Text>
                  </LinearGradient>
                )}
              </LinearGradient>
            ) : avatarUri ? (
              <Image source={{ uri: avatarUri }} style={[styles.avatar, { resizeMode: 'cover' }]} />
            ) : (
              <LinearGradient colors={GRAD_PRIMARY} style={styles.avatar}>
                <Text style={styles.avatarText}>{profile?.avatarInitials || MY_INITIALS}</Text>
              </LinearGradient>
            )}
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
            <TouchableOpacity style={styles.statCol} onPress={() => router.push('/buyer-friend-requests' as any)}>
              <Text style={styles.statNum}>{profile?.friendsCount ?? 0}</Text>
              <Text style={styles.statLabel}>Friends</Text>
            </TouchableOpacity>
            <View style={styles.statDivider} />
            <TouchableOpacity style={styles.statCol} onPress={() => router.push('/buyer-saved' as any)}>
              <Text style={styles.statNum}>{savedItems.length}</Text>
              <Text style={styles.statLabel}>Saved</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Name Section */}
        <View style={styles.nameSection}>
          <Text style={styles.profileName}>{profile?.name || 'Jordan'}</Text>
          {profile?.pronouns ? <Text style={styles.pronouns}>({profile.pronouns})</Text> : null}
          <Text style={styles.handleYear}>
            {profile?.username ? `@${profile.username}` : MY_HANDLE}{joinedYear ? ` · Joined ${joinedYear}` : ''}
          </Text>
          {profile?.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
          {profile?.website ? (
            <TouchableOpacity onPress={() => { const url = profile.website.startsWith('http') ? profile.website : 'https://' + profile.website; Linking.openURL(url); }}>
              <Text style={styles.website}>{profile.website}</Text>
            </TouchableOpacity>
          ) : null}
          {profile?.location ? (
            <View style={styles.locationRow}>
              <Feather name="map-pin" size={12} color={MUTED} />
              <Text style={styles.locationText}>{profile.location}</Text>
            </View>
          ) : null}
          <View style={styles.privacyBadge}>
            <Feather name={isPrivate ? 'lock' : 'globe'} size={12} color={PURPLE} />
            <Text style={styles.privacyBadgeText}>{isPrivate ? 'Private' : 'Public'}</Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(buyer)/edit-profile')}>
            <Text style={styles.actionBtnText}>Edit Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtn} onPress={handleShareProfile}>
            <Text style={styles.actionBtnText}>Share Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionIconBtn} onPress={() => router.push('/buyer-friend-requests' as any)}>
            <Feather name="user-plus" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>

        {/* Story Highlights Row — real highlights from highlightsService + New button */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlightsRow}>
          {/* New / Manage button */}
          <TouchableOpacity
            style={styles.highlightNew}
            onPress={() => router.push('/buyer-highlights-manager' as any)}
          >
            <View style={styles.highlightCircle}>
              <Feather name="plus" size={22} color={PURPLE} />
            </View>
            <Text style={styles.highlightLabel}>New</Text>
          </TouchableOpacity>
          {/* Saved highlights */}
          {highlights.map(h => (
            <TouchableOpacity
              key={h.id}
              style={styles.highlight}
              onPress={() => router.push('/buyer-highlights-manager' as any)}
            >
              <View style={[styles.highlightCircleGrad, { backgroundColor: h.coverColor }]}>
                <Text style={styles.highlightEmoji}>{h.emoji}</Text>
              </View>
              <Text style={styles.highlightLabel} numberOfLines={1}>{h.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Tab Bar */}
        <View style={styles.tabBar}>
          {TABS.map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabPill, activeTab === tab && styles.tabPillActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
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
                <TouchableOpacity style={styles.emptyAction} onPress={() => router.push('/create-post?accountType=buyer' as any)}>
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
                      <Feather name={postTypeIcon(post.type)} size={ICON.md} color={MUTED} />
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
            <TouchableOpacity style={styles.emptyAction} onPress={() => router.push('/(buyer)/discover')}>
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
                  <View style={styles.repostHeader}>
                    <Feather name="repeat" size={12} color={MUTED} />
                    <Text style={styles.repostMeta}>You reposted</Text>
                  </View>
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
                <TouchableOpacity style={styles.emptyAction} onPress={() => router.push('/buyer-saved' as any)}>
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
                    <Feather name={savedTypeIcon(item.type)} size={ICON.md} color={item.accentColor || PURPLE} />
                    <Text style={styles.savedTitle} numberOfLines={2}>{item.title}</Text>
                    {item.subtitle ? <Text style={styles.savedSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* ── Profile Menu Sheet ── */}
      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text style={styles.sheetTitle}>Profile</Text>
        <SheetRow icon="edit-3" label="Edit Profile" onPress={() => { setMenuOpen(false); router.push('/(buyer)/edit-profile'); }} />
        <SheetRow icon="share-2" label="Share Profile" onPress={handleShareProfile} />
        <SheetRow icon="star" label="Close Friends" onPress={() => { setMenuOpen(false); router.push('/buyer-close-friends' as any); }} />
        <SheetRow icon="archive" label="Archive" onPress={() => { setMenuOpen(false); router.push('/buyer-archive' as any); }} />
        <SheetRow icon="activity" label="Your Activity" onPress={() => { setMenuOpen(false); router.push('/buyer-your-activity' as any); }} />
        <SheetRow icon="package" label="My Orders" onPress={() => { setMenuOpen(false); router.push('/(buyer)/orders'); }} />
        <SheetRow icon="briefcase" label="My Freelancer Jobs" onPress={() => { setMenuOpen(false); router.push('/freelancer-jobs' as any); }} />
        <SheetRow icon="gift" label="Rewards & Points" onPress={() => { setMenuOpen(false); router.push('/loyalty' as any); }} />
        <SheetRow icon="bookmark" label="Saved Items" onPress={() => { setMenuOpen(false); router.push('/buyer-saved' as any); }} />
        <SheetRow icon="grid" label="QR Code" onPress={() => { setMenuOpen(false); router.push('/buyer-qr-code' as any); }} />
        <SheetRow icon="settings" label="Settings" onPress={() => { setMenuOpen(false); router.push('/buyer-settings' as any); }} />
        <View style={styles.sheetDivider} />
        <SheetRow icon="log-out" label="Sign Out" destructive onPress={handleSignOut} />
      </BottomSheet>

      {/* ── Post Long-Press Sheet ── */}
      <BottomSheet visible={!!postSheet} onClose={() => setPostSheet(null)}>
        <Text style={styles.sheetTitle} numberOfLines={1}>{postSheet?.caption || 'Post'}</Text>
        <SheetRow icon="share-2" label="Share Post" onPress={handleShareCurrentPost} />
        <SheetRow icon="archive" label="Archive" onPress={handleArchivePost} />
        <View style={styles.sheetDivider} />
        <SheetRow icon="trash-2" label="Delete Post" destructive onPress={handleDeletePost} />
      </BottomSheet>
    </View>
  );
}

const SAVED_TILE = (width - SP.md * 2 - SP.sm) / 2;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  topHandle: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, marginLeft: SP.xs },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  heroRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, marginTop: SP.md, gap: SP.lg },
  avatarWrap: { position: 'relative' },
  storyRing: { borderRadius: 43, padding: 3 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONT.bold, fontSize: FS.lg, color: '#FFFFFF' },
  avatarBadge: { position: 'absolute', bottom: -2, right: -2, backgroundColor: BG, borderRadius: 12, padding: 1 },
  statsRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  statCol: { alignItems: 'center', flex: 1 },
  statNum: { fontFamily: FONT.bold, fontSize: FS.lg, color: FG },
  statLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
  statDivider: { width: 1, height: 24, backgroundColor: BORDER },

  nameSection: { paddingHorizontal: SP.md, marginTop: SP.md, gap: 4 },
  profileName: { fontFamily: FONT.bold, fontSize: FS.md, color: FG },
  pronouns: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  handleYear: { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE },
  bio: { fontFamily: FONT.regular, fontSize: FS.base, color: FG, marginTop: 4 },
  website: { fontFamily: FONT.regular, fontSize: FS.sm, color: CYAN },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  locationText: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  privacyBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: PURPLE_DIM, borderWidth: 1, borderColor: BORDER_ACTIVE, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 4, marginTop: SP.xs, gap: 4 },
  privacyBadgeText: { fontFamily: FONT.medium, fontSize: FS.xs, color: PURPLE },

  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, marginTop: SP.md, gap: SP.sm },
  actionBtn: { flex: 1, height: 40, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center' },
  actionBtnText: { fontFamily: FONT.medium, fontSize: FS.sm, color: FG },
  actionIconBtn: { width: 44, height: 44, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  highlightsRow: { paddingHorizontal: SP.md, paddingVertical: SP.md, gap: SP.md },
  highlight: { alignItems: 'center', gap: 6 },
  highlightNew: { alignItems: 'center', gap: 6 },
  highlightCircle: { width: 60, height: 60, borderRadius: 30, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  highlightCircleGrad: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  highlightEmoji: { fontSize: 22 },
  highlightLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },

  tabBar: { flexDirection: 'row', paddingHorizontal: SP.md, marginTop: SP.sm, gap: SP.xs },
  tabPill: { flex: 1, paddingVertical: SP.xs + 2, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.pill, alignItems: 'center' },
  tabPillActive: { backgroundColor: PURPLE_DIM, borderColor: BORDER_ACTIVE },
  tabText: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED },
  tabTextActive: { color: PURPLE },

  gridContainer: { marginTop: SP.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SP.md, gap: GRID_GAP },
  gridCell: { width: CELL_SIZE, height: CELL_SIZE, borderRadius: RADIUS.sm, overflow: 'hidden' },
  gridCellInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xs },
  gridCaption: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, position: 'absolute', bottom: SP.xs, left: SP.xs, right: SP.xs },

  repostRow: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, marginHorizontal: SP.md, marginVertical: SP.xs, padding: SP.md },
  repostHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  repostMeta: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  repostAuthor: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  repostHandle: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, marginTop: 2 },
  repostCaption: { fontFamily: FONT.regular, fontSize: FS.sm, color: SUBTLE, marginTop: SP.xs },

  savedGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SP.md, gap: SP.sm, marginTop: SP.sm },
  savedTile: { width: SAVED_TILE, aspectRatio: 1, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.sm, justifyContent: 'space-between' },
  savedTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, marginTop: SP.xs },
  savedSubtitle: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },

  emptyState: { alignItems: 'center', paddingHorizontal: SP.lg, paddingVertical: SP.xl },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG, marginTop: SP.md },
  emptyDesc: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', marginTop: SP.sm },
  emptyAction: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER_ACTIVE, borderRadius: RADIUS.md, paddingHorizontal: SP.lg, paddingVertical: SP.sm, marginTop: SP.md },
  emptyActionText: { fontFamily: FONT.medium, fontSize: FS.sm, color: PURPLE },

  // Bottom sheet
  backdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingTop: SP.sm, paddingHorizontal: SP.md },
  sheetHandle: { width: 36, height: 4, backgroundColor: BORDER, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  sheetTitle: { fontFamily: FONT.semibold, fontSize: FS.base, color: MUTED, paddingVertical: SP.sm, paddingHorizontal: SP.xs, marginBottom: SP.xs },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: 14, paddingHorizontal: SP.xs, borderRadius: RADIUS.md },
  sheetRowText: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  sheetDivider: { height: 1, backgroundColor: BORDER, marginVertical: SP.xs },
});
