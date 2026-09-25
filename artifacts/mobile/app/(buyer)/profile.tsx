import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, Modal, Animated, Share,
  RefreshControl, Linking, Alert, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth, useUser } from '@clerk/expo';
import {
  FONT, FS, SP, RADIUS, ICON, TYPE, GRID_MAX_WIDTH, OVERLAY,
} from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import {
  getMyProfile, getMyPosts, getMyReposts, getSavedItems,
  getPrivacySettings, archivePost, deletePost,
  subscribeSocial,
} from '@/services/socialService';
import { useApi } from '@/lib/api';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { formatCents } from '@/lib/money';
import { CachedImage } from '@/components/CachedImage';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { loadBuyerProfile } from '@/lib/buyerProfile';
import { loadHighlights, type Highlight } from '@/lib/highlightsService';
import {
  GridSkeleton, ListSkeleton, ResponsiveContainer, useGridColumns, useBreakpoint,
} from '@/components/layout';
import { EmptyState } from '@/components/BrandthreadUI';
import { getBuyerOrdersWithStatus } from '@/services/orderService';
import { OrderStatusTimeline } from '@/components/orders/OrderStatusTimeline';
import type { BuyerOrderView } from '@/services/orderTypes';
import type {
  BuyerSocialProfile, BuyerPost, RepostRecord, SavedItem, PrivacySettings,
} from '@/services/socialTypes';

// Statuses still "in flight" — an order in one of these is what the My Orders
// card surfaces first; a fully-resolved order (delivered/cancelled/refunded/
// disputed) falls back to just showing the most recent order overall.
const ACTIVE_ORDER_STATUSES: BuyerOrderView['status'][] = ['new', 'processing', 'ready_to_ship', 'shipped'];

const GRID_GAP = 2;
// Rough height of everything above the tab strip (avatar, name, stats, actions,
// highlights) — used to fade the sticky segmented control in once the hero has
// scrolled out of view, and to drive the avatar's scroll-linked parallax.
const STICKY_THRESHOLD = 430;
const PARALLAX_DISTANCE = 160;

const TABS = ['Posts', 'Tagged', 'Reposts', 'Saved'] as const;
type Tab = typeof TABS[number];

function profileTabIcon(tab: Tab): keyof typeof Feather.glyphMap {
  if (tab === 'Posts') return 'grid';
  if (tab === 'Tagged') return 'user';
  if (tab === 'Reposts') return 'repeat';
  return 'bookmark';
}

function postTypeIcon(type: BuyerPost['type']): keyof typeof Feather.glyphMap {
  if (type === 'photo') return 'image';
  if (type === 'slideshow') return 'layers';
  return 'video';
}

function savedTypeIcon(type: string): keyof typeof Feather.glyphMap {
  if (type === 'post') return 'bookmark';
  if (type === 'product') return 'shopping-bag';
  if (type === 'collection') return 'folder';
  return 'home';
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
  const { theme } = useAppTheme();
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
      <TouchableOpacity style={[styles.backdrop, { backgroundColor: OVERLAY }]} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: theme.card, borderColor: theme.border },
            { paddingBottom: insets.bottom + SP.md },
            { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }] },
          ]}
        >
          <TouchableOpacity activeOpacity={1}>
            <View style={[styles.sheetHandle, { backgroundColor: theme.border }]} />
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
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity style={styles.sheetRow} onPress={onPress} activeOpacity={0.7}>
      <Feather name={icon} size={ICON.md} color={destructive ? theme.error : theme.text} />
      <Text style={[styles.sheetRowText, { color: destructive ? theme.error : theme.text }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Memoized grid cells (kept out of inline render to stay smooth at 60fps) ──
const PostCell = React.memo(function PostCell({
  post, size, theme, onPress, onLongPress,
}: {
  post: BuyerPost; size: number; theme: AppThemePreset;
  onPress: (post: BuyerPost) => void; onLongPress: (post: BuyerPost) => void;
}) {
  const handlePress = useCallback(() => onPress(post), [onPress, post]);
  const handleLongPress = useCallback(() => onLongPress(post), [onLongPress, post]);
  return (
    <TouchableOpacity
      style={{ width: size, height: size, padding: GRID_GAP / 2 }}
      onPress={handlePress}
      onLongPress={handleLongPress}
      activeOpacity={0.85}
    >
      <View style={[styles.gridCellInner, { backgroundColor: theme.cardElevated }]}>
        {post.mediaUrl ? (
          <CachedImage
            source={{ uri: post.mediaUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
          />
        ) : (
          <Feather name={postTypeIcon(post.type)} size={ICON.md} color={theme.muted} />
        )}
        {(post.type === 'video' || post.type === 'slideshow') && (
          <View style={styles.gridTypeBadge}>
            <Feather
              name={post.type === 'video' ? 'play' : 'copy'}
              size={12}
              color="#FFFFFF" // theme-exempt: icon over media badge scrim
            />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
});

const SavedCell = React.memo(function SavedCell({
  item, size, theme, onPress,
}: {
  item: SavedItem; size: number; theme: AppThemePreset; onPress: (item: SavedItem) => void;
}) {
  const handlePress = useCallback(() => onPress(item), [onPress, item]);
  return (
    <TouchableOpacity
      style={{ width: size, padding: SP.xs / 2 }}
      onPress={handlePress}
      activeOpacity={0.85}
    >
      <View style={[styles.savedTile, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Feather name={savedTypeIcon(item.type)} size={ICON.md} color={item.accentColor || theme.accent} />
        <Text style={[styles.savedTitle, { color: theme.text }]} numberOfLines={2}>{item.title}</Text>
        {item.subtitle ? <Text style={[styles.savedSubtitle, { color: theme.muted }]} numberOfLines={1}>{item.subtitle}</Text> : null}
      </View>
    </TouchableOpacity>
  );
});

const RepostCard = React.memo(function RepostCard({ repost, theme }: { repost: RepostRecord; theme: AppThemePreset }) {
  return (
    <View style={[styles.repostRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={styles.repostHeader}>
        <Feather name="repeat" size={12} color={theme.muted} />
        <Text style={[styles.repostMeta, { color: theme.muted }]}>You reposted</Text>
      </View>
      <Text style={[styles.repostAuthor, { color: theme.text }]}>{repost.originalAuthorName}</Text>
      <Text style={[styles.repostHandle, { color: theme.muted }]}>{repost.originalAuthorHandle}</Text>
      <Text style={[styles.repostCaption, { color: theme.subtle }]} numberOfLines={2}>{repost.originalCaption}</Text>
    </View>
  );
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const router  = useRouter();
  const { signOut } = useAuth();
  const { user } = useUser();
  const api     = useApi();
  const { theme } = useAppTheme();
  const { width: winWidth, isTablet } = useBreakpoint();
  const postsColumns = useGridColumns({ phone: 3, tablet: 4, tabletLandscape: 5 });
  const savedColumns = useGridColumns({ phone: 2, tablet: 3, tabletLandscape: 4 });
  const gridWidth = isTablet ? Math.min(winWidth, GRID_MAX_WIDTH) : winWidth;
  const postCellSize = (gridWidth - GRID_GAP * (postsColumns - 1)) / postsColumns;
  const savedCellSize = (gridWidth - SP.xs * (savedColumns - 1)) / savedColumns;

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
  const [myOrders, setMyOrders] = useState<BuyerOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [stickyTabsVisible, setStickyTabsVisible] = useState(false);
  const [threadCashBalanceCents, setThreadCashBalanceCents] = useState(0);

  // Sheets
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [postSheet, setPostSheet] = useState<BuyerPost | null>(null);

  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      setStickyTabsVisible(prev => {
        const next = value > STICKY_THRESHOLD - 20;
        return prev === next ? prev : next;
      });
    });
    return () => scrollY.removeListener(id);
  }, [scrollY]);

  const stickyTabsOpacity = scrollY.interpolate({
    inputRange: [STICKY_THRESHOLD - 24, STICKY_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const stickyTabsTranslate = scrollY.interpolate({
    inputRange: [STICKY_THRESHOLD - 24, STICKY_THRESHOLD],
    outputRange: [-8, 0],
    extrapolate: 'clamp',
  });
  const avatarScale = scrollY.interpolate({
    inputRange: [0, PARALLAX_DISTANCE],
    outputRange: [1, 0.72],
    extrapolate: 'clamp',
  });
  const avatarTranslateY = scrollY.interpolate({
    inputRange: [0, PARALLAX_DISTANCE],
    outputRange: [0, -18],
    extrapolate: 'clamp',
  });
  const heroFade = scrollY.interpolate({
    inputRange: [0, PARALLAX_DISTANCE * 0.9],
    outputRange: [1, 0.35],
    extrapolate: 'clamp',
  });

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
      const [p, po, rp, sv, pr, bp, hl, myStories, ordersResult] = await Promise.all([
        getMyProfile(),
        getMyPosts(),
        getMyReposts(),
        getSavedItems(),
        getPrivacySettings(),
        loadBuyerProfile(),
        loadHighlights(),
        api.social.myStories().catch(() => []),
        getBuyerOrdersWithStatus(user.id).catch(() => ({ orders: [] as BuyerOrderView[], fromCache: true })),
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
      setMyOrders(ordersResult.orders);
    } catch (error) {
      setLoadError(true);
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

  useFocusEffect(useCallback(() => {
    let active = true;
    if (user?.id) {
      void api.threadCash.get()
        .then(status => { if (active) setThreadCashBalanceCents(Math.max(0, status.balanceCents)); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [api, user?.id]));

  useEffect(() => {
    const unsub = subscribeSocial(() => { loadData(); });
    return unsub;
  }, [loadData]);

  // ── Menu actions ──
  const handleMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMenuOpen(true);
  };

  const handleShareProfile = () => {
    setMenuOpen(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShareSheetOpen(true);
  };

  const handleSignOut = async () => {
    setMenuOpen(false);
    try { await signOut(); } catch {}
    router.replace('/sign-in' as never);
  };

  // ── Tab switch (haptic + spring-ish state change) ──
  const handleTabPress = useCallback((tab: Tab) => {
    Haptics.selectionAsync();
    setActiveTab(tab);
  }, []);

  // ── Highlights ──
  const handleHighlightPress = useCallback(() => {
    Haptics.selectionAsync();
    router.push('/buyer-highlights-manager' as any);
  }, [router]);

  // ── My Orders card: the latest in-flight order, or the latest order overall
  // once everything's resolved, so there's always a fast way back into orders. ──
  const featuredOrder = myOrders.find(o => ACTIVE_ORDER_STATUSES.includes(o.status)) ?? myOrders[0] ?? null;

  const handleOrdersSeeAll = useCallback(() => {
    Haptics.selectionAsync();
    router.push('/(buyer)/orders' as never);
  }, [router]);

  const handleFeaturedOrderPress = useCallback(() => {
    if (!featuredOrder) return;
    Haptics.selectionAsync();
    router.push(`/buyer-order-detail?id=${featuredOrder.id}` as never);
  }, [featuredOrder, router]);

  // ── Post sheet ──
  const handlePostLongPress = useCallback((post: BuyerPost) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPostSheet(post);
  }, []);

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

  const handlePostTap = useCallback((post: BuyerPost) => {
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
  }, [router]);

  const handleSavedTap = useCallback(() => {
    router.push('/buyer-saved' as any);
  }, [router]);

  const joinedYear = profile ? new Date(profile.createdAt).getFullYear() : '';
  const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || '';
  const displayName = profile?.name || clerkName || 'Your profile';
  const displayHandle = profile?.username
    ? `@${profile.username}`
    : (user?.username ? `@${user.username}` : '');
  const avatarInitials = profile?.avatarInitials
    || displayName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    || '•';

  // ── Per-tab list data (single FlashList remounts on tab change so each
  // tab keeps its own column layout / item shape while sharing one scroller
  // with the hero header for a single, consistent scroll-linked animation). ──
  const renderPostItem = useCallback(({ item, size }: { item: BuyerPost; size: number }) => (
    <PostCell post={item} size={size} theme={theme} onPress={handlePostTap} onLongPress={handlePostLongPress} />
  ), [theme, handlePostTap, handlePostLongPress]);

  const renderSavedItem = useCallback(({ item, size }: { item: SavedItem; size: number }) => (
    <SavedCell item={item} size={size} theme={theme} onPress={handleSavedTap} />
  ), [theme, handleSavedTap]);

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }],
    { useNativeDriver: false },
  );

  // ── Hero header shared by every tab's FlashList ──
  const renderHeader = () => (
    <View>
      {/* ── Avatar (scroll-linked parallax) ── */}
      <View style={styles.avatarSection}>
        <Animated.View style={{ transform: [{ scale: avatarScale }, { translateY: avatarTranslateY }] }}>
          <TouchableOpacity onPress={() => router.push('/buyer-story-create' as any)} style={styles.avatarWrap} activeOpacity={0.85}>
            {avatarUri ? (
              <CachedImage
                source={{ uri: avatarUri }}
                style={[styles.avatar, hasActiveStory && { borderWidth: 3, borderColor: theme.accent }]}
                contentFit="cover"
              />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: theme.cardElevated }, hasActiveStory && { borderWidth: 3, borderColor: theme.accent }]}>
                <Text style={[styles.avatarText, { color: theme.text }]}>{avatarInitials}</Text>
              </View>
            )}
            <View style={[styles.avatarBadge, { backgroundColor: theme.accent, borderColor: theme.background }]}>
              <Feather name="plus" size={12} color={theme.onAccent} />
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* ── Name / Handle / Bio — bold typographic identity block ── */}
      <Animated.View style={[styles.nameSection, { opacity: heroFade }]}>
        <Text style={[TYPE.largeTitle, styles.profileName, { color: theme.text }]} numberOfLines={1}>{displayName}</Text>
        {profile?.pronouns ? <Text style={[styles.pronouns, { color: theme.muted }]}>({profile.pronouns})</Text> : null}
        <Text style={[styles.handleYear, { color: theme.muted }]}>
          {displayHandle}{joinedYear ? ` · Joined ${joinedYear}` : ''}
        </Text>
        {profile?.bio ? (
          <Text style={[styles.bio, { color: theme.text }]} numberOfLines={3}>{profile.bio}</Text>
        ) : null}
        {profile?.website ? (
          <TouchableOpacity onPress={() => { const url = profile.website.startsWith('http') ? profile.website : 'https://' + profile.website; Linking.openURL(url); }}>
            <Text style={[styles.website, { color: theme.secondary }]}>{profile.website}</Text>
          </TouchableOpacity>
        ) : null}
        {profile?.location ? (
          <View style={styles.locationRow}>
            <Feather name="map-pin" size={12} color={theme.muted} />
            <Text style={[styles.locationText, { color: theme.muted }]}>{profile.location}</Text>
          </View>
        ) : null}
      </Animated.View>

      {/* ── Stats Row ── */}
      <View style={styles.statsRow}>
        <View style={styles.statCol}>
          <Text style={[styles.statNum, { color: theme.text }]}>{posts.length}</Text>
          <Text style={[styles.statLabel, { color: theme.muted }]}>Posts</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
        <TouchableOpacity style={styles.statCol} onPress={() => router.push('/connections?type=followers' as any)}>
          <Text style={[styles.statNum, { color: theme.text }]}>{profile?.friendsCount ?? 0}</Text>
          <Text style={[styles.statLabel, { color: theme.muted }]}>Followers</Text>
        </TouchableOpacity>
        <View style={[styles.statDivider, { backgroundColor: theme.border }]} />
        <TouchableOpacity style={styles.statCol} onPress={() => router.push('/connections?type=following' as any)}>
          <Text style={[styles.statNum, { color: theme.text }]}>{profile?.followingBrandsCount ?? 0}</Text>
          <Text style={[styles.statLabel, { color: theme.muted }]}>Following</Text>
        </TouchableOpacity>
      </View>

      {/* ── Thread Cash balance chip ── */}
      {useFeatureFlag('threadCash') && (
        <TouchableOpacity
          style={[styles.threadCashChip, { backgroundColor: theme.accentDim, borderColor: theme.accent }]}
          onPress={() => { Haptics.selectionAsync(); router.push('/thread-cash' as never); }}
          accessibilityRole="button"
          accessibilityLabel="Thread Cash wallet"
        >
          <Feather name="dollar-sign" size={14} color={theme.accent} />
          <Text style={[styles.threadCashChipText, { color: theme.accent }]}>
            {formatCents(threadCashBalanceCents)} Thread Cash
          </Text>
          <Feather name="chevron-right" size={14} color={theme.accent} />
        </TouchableOpacity>
      )}

      {/* ── Action Buttons ── */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnPrimary, { backgroundColor: theme.accent }]}
          onPress={() => router.push('/(buyer)/edit-profile')}
        >
          <Text style={[styles.actionBtnText, { color: theme.onAccent }]}>Edit Profile</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionIconBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={() => router.push('/(buyer)/inbox' as never)}
          accessibilityRole="button"
          accessibilityLabel="Messages"
        >
          <Feather name="send" size={ICON.sm} color={theme.text} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionIconBtn, { backgroundColor: theme.card, borderColor: theme.border }]}
          onPress={handleShareProfile}
          accessibilityRole="button"
          accessibilityLabel="Share profile"
          accessibilityHint="Opens your shareable profile link and QR code"
        >
          <Feather name="share-2" size={ICON.sm} color={theme.text} />
        </TouchableOpacity>
      </View>

      {/* ── My Orders — always-visible way back to order history ── */}
      {featuredOrder ? (
        <View style={styles.ordersSection}>
          <View style={styles.ordersSectionHeader}>
            <Text style={[styles.ordersSectionTitle, { color: theme.text }]}>My Orders</Text>
            <TouchableOpacity
              onPress={handleOrdersSeeAll}
              accessibilityRole="button"
              accessibilityLabel="See all orders"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.ordersSeeAll, { color: theme.secondary }]}>See all</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            style={[styles.orderCard, { backgroundColor: theme.card, borderColor: theme.border }]}
            onPress={handleFeaturedOrderPress}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Order ${featuredOrder.orderNumber}, ${featuredOrder.status.replace(/_/g, ' ')}`}
          >
            {featuredOrder.lineItems[0]?.imageUri ? (
              <CachedImage source={{ uri: featuredOrder.lineItems[0].imageUri }} style={styles.orderCardImage} contentFit="cover" />
            ) : (
              <View style={[styles.orderCardImage, styles.orderCardImagePlaceholder, { backgroundColor: theme.cardElevated }]}>
                <Feather name="shopping-bag" size={ICON.md} color={theme.muted} />
              </View>
            )}
            <View style={styles.orderCardBody}>
              <Text style={[styles.orderCardSeller, { color: theme.text }]} numberOfLines={1}>{featuredOrder.sellerName}</Text>
              <Text style={[styles.orderCardMeta, { color: theme.muted }]} numberOfLines={1}>
                {featuredOrder.orderNumber} · {featuredOrder.lineItems.length} item{featuredOrder.lineItems.length === 1 ? '' : 's'}
              </Text>
              <OrderStatusTimeline status={featuredOrder.status} compact />
            </View>
            <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
          </TouchableOpacity>
        </View>
      ) : null}

      {/* ── Story-style Highlights row ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.highlightsRow}>
        <TouchableOpacity style={styles.highlightNew} onPress={handleHighlightPress} activeOpacity={0.8}>
          <View style={[styles.highlightCircle, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <Feather name="plus" size={20} color={theme.muted} />
          </View>
          <Text style={[styles.highlightLabel, { color: theme.muted }]}>New</Text>
        </TouchableOpacity>
        {highlights.map(h => (
          <TouchableOpacity key={h.id} style={styles.highlight} onPress={handleHighlightPress} activeOpacity={0.8}>
            <View style={[styles.highlightCircleColored, { backgroundColor: h.coverColor }]}>
              <Text style={styles.highlightEmoji}>{h.emoji}</Text>
            </View>
            <Text style={[styles.highlightLabel, { color: theme.muted }]} numberOfLines={1}>{h.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Inline segmented tab control (scrolls away; sticky twin lives above) ── */}
      <View style={[styles.tabBar, { borderColor: theme.border }]}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={styles.tabItem}
            onPress={() => handleTabPress(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
            accessibilityLabel={`${tab} tab`}
          >
            <Feather name={profileTabIcon(tab)} size={16} color={activeTab === tab ? theme.text : theme.muted} />
            <Text style={[styles.tabText, { color: activeTab === tab ? theme.text : theme.muted }, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
            {activeTab === tab && <View style={[styles.tabUnderline, { backgroundColor: theme.accent }]} />}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  // ── Resolve active tab's list + renderer ──
  const numColumns = activeTab === 'Posts' ? postsColumns : activeTab === 'Saved' ? savedColumns : 1;

  let listData: BuyerPost[] | RepostRecord[] | SavedItem[] = [];
  let emptyIcon: keyof typeof Feather.glyphMap = 'grid';
  let emptyTitle = '';
  let emptyDescription = '';
  let emptyActionLabel: string | undefined;
  let emptyOnAction: (() => void) | undefined;

  if (activeTab === 'Posts') {
    listData = posts;
    emptyIcon = 'image';
    emptyTitle = 'No posts yet';
    emptyDescription = 'Your posts will appear here.';
    emptyActionLabel = 'Create Post';
    emptyOnAction = () => router.push('/create-post?accountType=buyer' as any);
  } else if (activeTab === 'Tagged') {
    listData = [];
    emptyIcon = 'tag';
    emptyTitle = 'No tagged posts';
    emptyDescription = 'Posts that tag you will appear here.';
    emptyActionLabel = 'Discover';
    emptyOnAction = () => router.push('/(buyer)/discover');
  } else if (activeTab === 'Reposts') {
    listData = reposts;
    emptyIcon = 'repeat';
    emptyTitle = 'No reposts yet';
    emptyDescription = 'Posts you repost will appear here.';
  } else {
    listData = savedItems;
    emptyIcon = 'bookmark';
    emptyTitle = 'No saved posts yet';
    emptyDescription = 'Items you save will appear here.';
    emptyActionLabel = 'View Saved';
    emptyOnAction = () => router.push('/buyer-saved' as any);
  }

  if (loadError) {
    return (
      <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.background }]}>
        <EmptyState
          icon="alert-triangle"
          title="Couldn't load your profile"
          description="Check your connection and try again."
          action={{ label: 'Retry', onPress: loadData }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.background }]}>
      {/* ── Persistent top bar: account switcher + notifications + menu ── */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topBarLeft}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/account-switcher' as never);
          }}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Switch account"
          testID="buyer-profile-account-switcher"
        >
          <Text style={[styles.topHandle, { color: theme.text }]} numberOfLines={1}>{displayName}</Text>
          <Feather name="chevron-down" size={16} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.topBarRight}>
          <TouchableOpacity onPress={() => router.push('/buyer-notifications' as any)} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Notifications">
            <Feather name="bell" size={ICON.md} color={theme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleMenu} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="More options">
            <Feather name="menu" size={ICON.md} color={theme.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Sticky segmented tab control — fades in once the hero scrolls past ── */}
      <Animated.View
        pointerEvents={stickyTabsVisible ? 'auto' : 'none'}
        style={[
          styles.stickyTabBar,
          { backgroundColor: theme.background, borderColor: theme.border },
          { opacity: stickyTabsOpacity, transform: [{ translateY: stickyTabsTranslate }] },
        ]}
      >
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab}
            style={styles.stickyTabItem}
            onPress={() => handleTabPress(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab }}
            accessibilityLabel={`${tab} tab`}
          >
            <Feather name={profileTabIcon(tab)} size={16} color={activeTab === tab ? theme.text : theme.muted} />
            {activeTab === tab && <View style={[styles.stickyTabUnderline, { backgroundColor: theme.accent }]} />}
          </TouchableOpacity>
        ))}
      </Animated.View>

      {loading ? (
        <ScrollView contentContainerStyle={{ paddingBottom: barInset + SP.lg }} showsVerticalScrollIndicator={false}>
          {renderHeader()}
          <ResponsiveContainer maxWidth={GRID_MAX_WIDTH} style={{ paddingHorizontal: SP.md }}>
            {activeTab === 'Reposts' ? (
              <ListSkeleton rows={4} />
            ) : (
              <GridSkeleton columns={activeTab === 'Saved' ? savedColumns : postsColumns} cardWidth={postCellSize} rows={2} gap={SP.sm} />
            )}
          </ResponsiveContainer>
        </ScrollView>
      ) : activeTab === 'Reposts' ? (
        <FlashList
          key={activeTab}
          data={listData as RepostRecord[]}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <RepostCard repost={item} theme={theme} />}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} action={emptyActionLabel && emptyOnAction ? { label: emptyActionLabel, onPress: emptyOnAction } : undefined} />
          }
          contentContainerStyle={{ paddingBottom: barInset + SP.lg } as any}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      ) : (
        <FlashList
          key={activeTab}
          data={listData as (BuyerPost | SavedItem)[]}
          keyExtractor={(item: any) => item.id}
          numColumns={numColumns}
          renderItem={({ item }: any) => {
            if (activeTab === 'Posts') {
              return renderPostItem({ item, size: postCellSize });
            }
            return renderSavedItem({ item, size: savedCellSize });
          }}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} action={emptyActionLabel && emptyOnAction ? { label: emptyActionLabel, onPress: emptyOnAction } : undefined} />
          }
          contentContainerStyle={{ paddingBottom: barInset + SP.lg } as any}
          showsVerticalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          refreshing={refreshing}
          onRefresh={onRefresh}
        />
      )}

      {/* ── Profile Menu Sheet ── */}
      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text style={[styles.sheetTitle, { color: theme.muted }]}>Profile</Text>
        <SheetRow icon="edit-3" label="Edit Profile" onPress={() => { setMenuOpen(false); router.push('/(buyer)/edit-profile'); }} />
        <SheetRow icon="share-2" label="Share Profile" onPress={handleShareProfile} />
        <SheetRow icon="users" label="Friends" onPress={() => { setMenuOpen(false); router.push('/(buyer)/friends' as any); }} />
        <SheetRow icon="star" label="Close Friends" onPress={() => { setMenuOpen(false); router.push('/buyer-close-friends' as any); }} />
        <SheetRow icon="archive" label="Archive" onPress={() => { setMenuOpen(false); router.push('/buyer-archive' as any); }} />
        <SheetRow icon="activity" label="Your Activity" onPress={() => { setMenuOpen(false); router.push('/buyer-your-activity' as any); }} />
        <SheetRow icon="package" label="My Orders" onPress={() => { setMenuOpen(false); router.push('/(buyer)/orders'); }} />
        <SheetRow icon="briefcase" label="My Freelancer Jobs" onPress={() => { setMenuOpen(false); router.push('/freelancer-jobs' as any); }} />
        <SheetRow icon="gift" label="Rewards & Points" onPress={() => { setMenuOpen(false); router.push('/loyalty' as any); }} />
        <SheetRow icon="bookmark" label="Saved Items" onPress={() => { setMenuOpen(false); router.push('/buyer-saved' as any); }} />
        <SheetRow icon="grid" label="QR Code" onPress={() => { setMenuOpen(false); router.push('/buyer-qr-code' as any); }} />
        <SheetRow icon="image" label="Highlights" onPress={() => { setMenuOpen(false); router.push('/buyer-highlights-manager' as any); }} />
        <SheetRow icon="settings" label="Settings" onPress={() => { setMenuOpen(false); router.push('/settings' as any); }} />
        <View style={[styles.sheetDivider, { backgroundColor: theme.border }]} />
        <SheetRow icon="log-out" label="Sign Out" destructive onPress={handleSignOut} />
      </BottomSheet>

      <ShareProfileSheet
        visible={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
        avatarUrl={avatarUri}
        buyerExtra={{
          statLabel: 'friends',
          statValue: profile?.friendsCount ?? 0,
          topPosts: posts.slice(0, 3).map(p => ({ id: p.id, uri: p.mediaUrl })),
        }}
      />

      {/* ── Post Long-Press Sheet ── */}
      <BottomSheet visible={!!postSheet} onClose={() => setPostSheet(null)}>
        <Text style={[styles.sheetTitle, { color: theme.muted }]} numberOfLines={1}>{postSheet?.caption || 'Post'}</Text>
        <SheetRow icon="share-2" label="Share Post" onPress={handleShareCurrentPost} />
        <SheetRow icon="archive" label="Archive" onPress={handleArchivePost} />
        <View style={[styles.sheetDivider, { backgroundColor: theme.border }]} />
        <SheetRow icon="trash-2" label="Delete Post" destructive onPress={handleDeletePost} />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, paddingVertical: SP.sm, zIndex: 10 },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  topHandle: { fontFamily: FONT.semibold, fontSize: FS.sm },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  stickyTabBar: {
    position: 'absolute', left: 0, right: 0, zIndex: 9,
    flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stickyTabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, position: 'relative' },
  stickyTabUnderline: { position: 'absolute', bottom: 0, left: '30%', right: '30%', height: 2, borderRadius: 1 },

  // Centered avatar
  avatarSection: { alignItems: 'center', paddingTop: SP.sm, paddingBottom: SP.md },
  avatarWrap: { position: 'relative' },
  avatar: { width: 104, height: 104, borderRadius: 52 },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONT.bold, fontSize: FS.xl },
  avatarBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 28, height: 28, borderRadius: 14, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },

  // Centered name/bio — bold typographic identity block
  nameSection: { alignItems: 'center', paddingHorizontal: SP.lg, gap: 3 },
  profileName: { textAlign: 'center' },
  pronouns: { fontFamily: FONT.regular, fontSize: FS.sm },
  handleYear: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
  bio: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 19, marginTop: 6 },
  website: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  locationText: { fontFamily: FONT.regular, fontSize: FS.xs },

  // Stats — horizontal centered
  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: SP.md, marginTop: SP.lg, gap: 0,
  },
  statCol: { alignItems: 'center', flex: 1 },
  statNum: { fontFamily: FONT.bold, fontSize: FS.md },
  statLabel: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  statDivider: { width: 1, height: 22, marginHorizontal: SP.xs },

  // Thread Cash chip
  threadCashChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs,
    alignSelf: 'center', marginTop: SP.md, paddingHorizontal: SP.md, paddingVertical: SP.xs,
    borderRadius: RADIUS.pill, borderWidth: 1,
  },
  threadCashChipText: { fontFamily: FONT.semibold, fontSize: FS.xs },

  // Action buttons
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, marginTop: SP.md, gap: SP.sm },
  actionBtn: {
    flex: 1, height: 40,
    borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center',
  },
  actionBtnPrimary: {},
  actionBtnText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  actionIconBtn: {
    width: 40, height: 40, borderWidth: 1,
    borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center',
  },

  // My Orders
  ordersSection: { paddingHorizontal: SP.md, marginTop: SP.lg },
  ordersSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
  ordersSectionTitle: { fontFamily: FONT.bold, fontSize: FS.md },
  ordersSeeAll: { fontFamily: FONT.semibold, fontSize: FS.sm },
  orderCard: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: RADIUS.md, padding: SP.sm, gap: SP.sm,
  },
  orderCardImage: { width: 52, height: 52, borderRadius: RADIUS.sm },
  orderCardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  orderCardBody: { flex: 1, gap: 2 },
  orderCardSeller: { fontFamily: FONT.semibold, fontSize: FS.sm },
  orderCardMeta: { fontFamily: FONT.regular, fontSize: FS.xs, marginBottom: 2 },

  // Highlights
  highlightsRow: { paddingHorizontal: SP.md, paddingVertical: SP.md, gap: SP.md },
  highlight: { alignItems: 'center', gap: 5 },
  highlightNew: { alignItems: 'center', gap: 5 },
  highlightCircle: {
    width: 60, height: 60, borderRadius: 30, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  highlightCircleColored: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  highlightEmoji: { fontSize: 22 },
  highlightLabel: { fontFamily: FONT.regular, fontSize: FS.xs, maxWidth: 64 },

  // Inline segmented tabs
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1, borderBottomWidth: 1,
    marginTop: SP.xs,
  },
  tabItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 12, position: 'relative',
  },
  tabText: { fontFamily: FONT.medium, fontSize: FS.xs },
  tabTextActive: { fontFamily: FONT.semibold },
  tabUnderline: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: 2, borderRadius: 1,
  },

  // Grid
  gridCellInner: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: RADIUS.sm },
  gridTypeBadge: {
    position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.45)', // theme-exempt: scrim over media
    alignItems: 'center', justifyContent: 'center',
  },

  // Reposts
  repostRow: { borderWidth: 1, borderRadius: RADIUS.md, marginHorizontal: SP.md, marginVertical: SP.xs, padding: SP.md },
  repostHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  repostMeta: { fontFamily: FONT.regular, fontSize: FS.xs },
  repostAuthor: { fontFamily: FONT.semibold, fontSize: FS.sm },
  repostHandle: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
  repostCaption: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.xs },

  // Saved
  savedTile: { flex: 1, aspectRatio: 1, borderWidth: 1, borderRadius: RADIUS.md, padding: SP.sm, justifyContent: 'space-between' },
  savedTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: SP.xs },
  savedSubtitle: { fontFamily: FONT.regular, fontSize: FS.xs },

  // Bottom sheet
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingTop: SP.sm, paddingHorizontal: SP.md, borderWidth: 1, borderBottomWidth: 0 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  sheetTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, paddingVertical: SP.sm, paddingHorizontal: SP.xs, marginBottom: SP.xs },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: 14, paddingHorizontal: SP.xs, borderRadius: RADIUS.md },
  sheetRowText: { fontFamily: FONT.medium, fontSize: FS.base },
  sheetDivider: { height: 1, marginVertical: SP.xs },
});
