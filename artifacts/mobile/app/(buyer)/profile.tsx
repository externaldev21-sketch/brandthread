import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Dimensions, Modal, Animated, Share,
  RefreshControl, Image, Linking, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth, useUser } from '@clerk/expo';
import {
  BG, SCREEN_BG, CARD, CARD_ELEVATED, BORDER,
  FG, MUTED, SUBTLE,
  FONT, FS, SP, RADIUS, COMP, ICON, OVERLAY,
  RED, RED_DIM, SURFACE, ACCENT,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  getMyProfile, getMyPosts, getMyReposts, getSavedItems,
  getPrivacySettings, archivePost, deletePost,
  subscribeSocial,
} from '@/services/socialService';
import { useApi } from '@/lib/api';
import { loadBuyerProfile } from '@/lib/buyerProfile';
import { loadHighlights, type Highlight } from '@/lib/highlightsService';
import type {
  BuyerSocialProfile, BuyerPost, RepostRecord, SavedItem, PrivacySettings,
} from '@/services/socialTypes';

const { width } = Dimensions.get('window');
const GRID_GAP = 1;
const CELL_SIZE = (width - GRID_GAP * 2) / 3;

const TABS = ['Posts', 'Tagged', 'Reposts', 'Saved'] as const;
type Tab = typeof TABS[number];

function profileTabIcon(tab: Tab): keyof typeof Feather.glyphMap {
  if (tab === 'Posts') return 'grid';
  if (tab === 'Tagged') return 'user';
  if (tab === 'Reposts') return 'repeat';
  return 'bookmark';
}

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
  const { user } = useUser();
  const api     = useApi();
  const { theme } = useAppTheme();
  const accountRef = useRef(user?.id);
  accountRef.current = user?.id;

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Sheets
  const [menuOpen, setMenuOpen] = useState(false);
  const [postSheet, setPostSheet] = useState<BuyerPost | null>(null);

  const loadData = useCallback(async () => {
    if (!user?.id) {
      setProfile(null);
      setPosts([]);
      setReposts([]);
      setSavedItems([]);
      setLoading(false);
      return;
    }
    setLoadError(false);
    try {
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
    if (accountRef.current !== user?.id) return;
    setProfile(p);
    setPosts(po.filter(x => !x.isArchived && !x.isDraft));
    setReposts(rp);
    setSavedItems(sv);
    setPrivacySettings(pr);
    setAvatarUri(bp.avatarUri || null);
    setHighlights(hl);
    setHasActiveStory(Array.isArray(myStories) && myStories.length > 0);
    } catch (error) {
      setLoadError(false);
      setProfile(null);
      setPosts([]);
      setReposts([]);
      setSavedItems([]);
    } finally {
      setLoading(false);
    }
  }, [api, user?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadData(); } finally { setRefreshing(false); }
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
    const handle = profile?.username
      ? `@${profile.username}`
      : (user?.username ? `@${user.username}` : 'Brandthread');
    try {
      await Share.share({ message: `Find me on Brandthread: ${handle}`, title: 'Share Profile' });
    } catch {}
  };

  const handleSignOut = async () => {
    setMenuOpen(false);
    try { await signOut(); } catch {}
    router.replace('/sign-in' as never);
  };

  // ── Post sheet ──
  const handlePostLongPress = (post: BuyerPost) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPostSheet(post);
  };

  const handleArchivePost = async () => {
    if (!postSheet) return;
    const post = postSheet;
    setPostSheet(null);
    setPosts(prev => prev.filter(item => item.id !== post.id));
    try { await archivePost(post.id); await loadData(); } catch { setPosts(prev => [...prev, post]); Alert.alert('Could not archive post', 'Try again.'); }
  };

  const handleDeletePost = async () => {
    if (!postSheet) return;
    const post = postSheet;
    setPostSheet(null);
    setPosts(prev => prev.filter(item => item.id !== post.id));
    try { await deletePost(post.id); await loadData(); } catch { setPosts(prev => [...prev, post]); Alert.alert('Could not delete post', 'Try again.'); }
  };

  const handleShareCurrentPost = async () => {
    const post = postSheet;
    setPostSheet(null);
    if (!post) return;
    const handle = profile?.username
      ? `@${profile.username}`
      : (user?.username ? `@${user.username}` : 'Brandthread');
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
  const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || '';
  const displayName = profile?.name || clerkName || 'Your profile';
  const displayHandle = profile?.username
    ? `@${profile.username}`
    : (user?.username ? `@${user.username}` : '');
  const avatarInitials = profile?.avatarInitials
    || displayName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    || '•';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Feather name={isPrivate ? 'lock' : 'globe'} size={ICON.sm} color={MUTED} />
          <Text style={styles.topHandle}>{displayHandle}</Text>
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
      >
        {loading ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyDesc}>Loading profile…</Text>
          </View>
        ) : (
          <>
            {/* ── Centered Avatar ── */}
            <View style={styles.avatarSection}>
              <TouchableOpacity onPress={() => router.push('/buyer-story-create' as any)} style={styles.avatarWrap}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={[styles.avatar, hasActiveStory && styles.avatarActive]} resizeMode="cover" />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder, hasActiveStory && styles.avatarActive]}>
                    <Text style={styles.avatarText}>{avatarInitials}</Text>
                  </View>
                )}
                <View style={styles.avatarBadge}>
                  <Feather name="plus" size={12} color={FG} />
                </View>
              </TouchableOpacity>
            </View>

            {/* ── Name / Handle / Bio ── */}
            <View style={styles.nameSection}>
              <Text style={styles.profileName}>{displayName}</Text>
              {profile?.pronouns ? <Text style={styles.pronouns}>({profile.pronouns})</Text> : null}
              <Text style={styles.handleYear}>
                {displayHandle}{joinedYear ? ` · Joined ${joinedYear}` : ''}
              </Text>
              {profile?.bio ? (
                <Text style={styles.bio} numberOfLines={2}>{profile.bio}</Text>
              ) : null}
              {profile?.website ? (
                <TouchableOpacity onPress={() => { const url = profile.website.startsWith('http') ? profile.website : 'https://' + profile.website; Linking.openURL(url); }}>
                  <Text style={[styles.website, { color: theme.secondary }]}>{profile.website}</Text>
                </TouchableOpacity>
              ) : null}
              {profile?.location ? (
                <View style={styles.locationRow}>
                  <Feather name="map-pin" size={12} color={MUTED} />
                  <Text style={styles.locationText}>{profile.location}</Text>
                </View>
              ) : null}
            </View>

            {/* ── Stats Row ── */}
            <View style={styles.statsRow}>
              <TouchableOpacity style={styles.statCol}>
                <Text style={styles.statNum}>{posts.length}</Text>
                <Text style={styles.statLabel}>Posts</Text>
              </TouchableOpacity>
              <View style={styles.statDivider} />
              <TouchableOpacity style={styles.statCol} onPress={() => router.push('/connections?type=followers' as any)}>
                <Text style={styles.statNum}>{profile?.friendsCount ?? 0}</Text>
                <Text style={styles.statLabel}>Followers</Text>
              </TouchableOpacity>
              <View style={styles.statDivider} />
              <TouchableOpacity style={styles.statCol} onPress={() => router.push('/connections?type=following' as any)}>
                <Text style={styles.statNum}>{profile?.followingBrandsCount ?? 0}</Text>
                <Text style={styles.statLabel}>Following</Text>
              </TouchableOpacity>
            </View>

            {/* ── Action Buttons ── */}
            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={() => router.push('/(buyer)/edit-profile')}>
                <Text style={[styles.actionBtnText, styles.actionBtnPrimaryText]}>Edit Profile</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(buyer)/inbox' as never)}>
                <Text style={styles.actionBtnText}>Messages</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionIconBtn} onPress={handleShareProfile}>
                <Feather name="share-2" size={ICON.sm} color={FG} />
              </TouchableOpacity>
            </View>

            {/* ── Story Highlights Row ── */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlightsRow}>
              <TouchableOpacity
                style={styles.highlightNew}
                onPress={() => router.push('/buyer-highlights-manager' as any)}
              >
                <View style={styles.highlightCircle}>
                  <Feather name="plus" size={20} color={MUTED} />
                </View>
                <Text style={styles.highlightLabel}>New</Text>
              </TouchableOpacity>
              {highlights.map(h => (
                <TouchableOpacity
                  key={h.id}
                  style={styles.highlight}
                  onPress={() => router.push('/buyer-highlights-manager' as any)}
                >
                  <View style={[styles.highlightCircleColored, { backgroundColor: h.coverColor }]}>
                    <Text style={styles.highlightEmoji}>{h.emoji}</Text>
                  </View>
                  <Text style={styles.highlightLabel} numberOfLines={1}>{h.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* ── Tab Bar ── */}
            <View style={styles.tabBar}>
              {TABS.map(tab => (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tabItem, activeTab === tab && styles.tabItemActive]}
                  onPress={() => setActiveTab(tab)}
                >
                  <Feather name={profileTabIcon(tab)} size={16} color={activeTab === tab ? FG : MUTED} />
                  <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
                  {activeTab === tab && <View style={[styles.tabUnderline, { backgroundColor: theme.accent }]} />}
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Tab Content ── */}
            {activeTab === 'Posts' && (
              <View style={styles.gridContainer}>
                {posts.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Feather name="image" size={32} color={MUTED} />
                    <Text style={styles.emptyTitle}>No posts yet</Text>
                    <Text style={styles.emptyDesc}>Your posts will appear here.</Text>
                    <TouchableOpacity style={[styles.emptyAction, { borderColor: theme.accent }]} onPress={() => router.push('/create-post?accountType=buyer' as any)}>
                      <Text style={[styles.emptyActionText, { color: theme.accent }]}>Create Post</Text>
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
                        <View style={[styles.gridCellInner, { backgroundColor: CARD }]}>
                          <Feather name={postTypeIcon(post.type)} size={ICON.md} color={MUTED} />
                          {post.caption ? (
                            <Text style={styles.gridCaption} numberOfLines={1}>{post.caption}</Text>
                          ) : null}
                        </View>
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
                <TouchableOpacity style={[styles.emptyAction, { borderColor: theme.accent }]} onPress={() => router.push('/(buyer)/discover')}>
                  <Text style={[styles.emptyActionText, { color: theme.accent }]}>Discover</Text>
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
                    <TouchableOpacity style={[styles.emptyAction, { borderColor: theme.accent }]} onPress={() => router.push('/buyer-saved' as any)}>
                      <Text style={[styles.emptyActionText, { color: theme.accent }]}>View Saved</Text>
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
                        <Feather name={savedTypeIcon(item.type)} size={ICON.md} color={item.accentColor || theme.accent} />
                        <Text style={styles.savedTitle} numberOfLines={2}>{item.title}</Text>
                        {item.subtitle ? <Text style={styles.savedSubtitle} numberOfLines={1}>{item.subtitle}</Text> : null}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}
          </>
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
        <SheetRow icon="settings" label="Settings" onPress={() => { setMenuOpen(false); router.push('/settings' as any); }} />
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
  container: { flex: 1, backgroundColor: SCREEN_BG },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  topHandle: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  // Centered avatar
  avatarSection: { alignItems: 'center', paddingTop: SP.lg, paddingBottom: SP.md },
  avatarWrap: { position: 'relative' },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarActive: { borderWidth: 2, borderColor: ACCENT },
  avatarPlaceholder: { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONT.bold, fontSize: FS.xl, color: FG },
  avatarBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: CARD, borderWidth: 1.5, borderColor: BG,
    alignItems: 'center', justifyContent: 'center',
  },

  // Centered name/bio
  nameSection: { alignItems: 'center', paddingHorizontal: SP.lg, gap: 3 },
  profileName: { fontFamily: FONT.bold, fontSize: FS.lg, color: FG, textAlign: 'center' },
  pronouns: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED },
  handleYear: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  bio: { fontFamily: FONT.regular, fontSize: FS.sm, color: FG, textAlign: 'center', lineHeight: 19, marginTop: 2 },
  website: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  locationText: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },

  // Stats — horizontal centered
  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SP.md, marginTop: SP.md, gap: 0,
  },
  statCol: { alignItems: 'center', flex: 1 },
  statNum: { fontFamily: FONT.bold, fontSize: FS.md, color: FG },
  statLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, marginTop: 2 },
  statDivider: { width: 1, height: 22, backgroundColor: BORDER, marginHorizontal: SP.xs },

  // Action buttons
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, marginTop: SP.md, gap: SP.sm },
  actionBtn: {
    flex: 1, height: 38,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center',
  },
  actionBtnPrimary: { backgroundColor: 'transparent', borderColor: ACCENT },
  actionBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  actionBtnPrimaryText: { color: ACCENT },
  actionIconBtn: {
    width: 38, height: 38,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center',
  },

  // Highlights
  highlightsRow: { paddingHorizontal: SP.md, paddingVertical: SP.md, gap: SP.md },
  highlight: { alignItems: 'center', gap: 5 },
  highlightNew: { alignItems: 'center', gap: 5 },
  highlightCircle: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  highlightCircleColored: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  highlightEmoji: { fontSize: 22 },
  highlightLabel: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },

  // Text tabs
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER,
    marginTop: SP.xs,
  },
  tabItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 11, position: 'relative',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabItemActive: {},
  tabUnderline: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 2, borderRadius: 1,
  },
  tabText: { fontFamily: FONT.medium, fontSize: FS.xs, color: MUTED },
  tabTextActive: { color: FG, fontFamily: FONT.semibold },

  // Grid
  gridContainer: { marginTop: SP.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  gridCell: { width: CELL_SIZE, height: CELL_SIZE, overflow: 'hidden' },
  gridCellInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.xs },
  gridCaption: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, position: 'absolute', bottom: SP.xs, left: SP.xs, right: SP.xs },

  // Reposts
  repostRow: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, marginHorizontal: SP.md, marginVertical: SP.xs, padding: SP.md },
  repostHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  repostMeta: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },
  repostAuthor: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  repostHandle: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, marginTop: 2 },
  repostCaption: { fontFamily: FONT.regular, fontSize: FS.sm, color: SUBTLE, marginTop: SP.xs },

  // Saved
  savedGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SP.md, gap: SP.sm, marginTop: SP.sm },
  savedTile: { width: SAVED_TILE, aspectRatio: 1, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, padding: SP.sm, justifyContent: 'space-between' },
  savedTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG, marginTop: SP.xs },
  savedSubtitle: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },

  // Empty
  emptyState: { alignItems: 'center', paddingHorizontal: SP.lg, paddingVertical: SP.xl },
  emptyTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: FG, marginTop: SP.md },
  emptyDesc: { fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center', marginTop: SP.sm },
  emptyAction: { backgroundColor: 'transparent', borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SP.lg, paddingVertical: SP.sm, marginTop: SP.md },
  emptyActionText: { fontFamily: FONT.medium, fontSize: FS.sm },

  // Bottom sheet
  backdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  sheet: { backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingTop: SP.sm, paddingHorizontal: SP.md },
  sheetHandle: { width: 36, height: 4, backgroundColor: BORDER, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  sheetTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, color: MUTED, paddingVertical: SP.sm, paddingHorizontal: SP.xs, marginBottom: SP.xs },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: 14, paddingHorizontal: SP.xs, borderRadius: RADIUS.md },
  sheetRowText: { fontFamily: FONT.medium, fontSize: FS.base, color: FG },
  sheetDivider: { height: 1, backgroundColor: BORDER, marginVertical: SP.xs },
});
