/**
 * Buyer's own profile — rendered into the same ProfileShell as every seller
 * profile, filled with the buyer's own pieces: their posted photos/videos,
 * stories + highlights, Posts / Tagged / Reposts / Saved tabs, My Orders,
 * the Thread Cash pill (flag-gated), friends and messages.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, Animated, Share, Linking, Alert, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth, useUser } from '@clerk/expo';
import { PressableScale, EmptyState } from '@/components/BrandthreadUI';
import { hapticLight, hapticMedium, hapticSelection, hapticDestructiveConfirm } from '@/lib/haptics';
import { FONT, FS, SP, RADIUS, ICON, OVERLAY } from '@/lib/theme';
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
import { getBuyerOrdersWithStatus } from '@/services/orderService';
import { OrderStatusTimeline } from '@/components/orders/OrderStatusTimeline';
import type { BuyerOrderView } from '@/services/orderTypes';
import type {
  BuyerSocialProfile, BuyerPost, RepostRecord, SavedItem, PrivacySettings,
} from '@/services/socialTypes';
import { subscribeProfileEvents } from '@/lib/profileEvents';
import { connectionsHref, profileVideosHref } from '@/lib/profileNavigation';
import { formatProfileCount } from '@/services/profileService';
import { ProfileShell, ProfileMeta } from '@/components/profile/ProfileShell';
import {
  InteractionLayer, ProfileButton, ProfileGlassButton, type ProfileStat, type ProfileTab,
} from '@/components/profile/ProfileControls';
import { ProfileVideoTile, gridItemFromBuyerPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { ProfileStoriesRow } from '@/components/profile/ProfileStoriesRow';
import {
  CoverCoachmarkSheet, CoverHeroAffordance, CoverManageSheet, CoverTrimSheet, useProfileCover, type CoverMedia,
} from '@/components/profile/ProfileCover';
import { profileEmptyState, type ProfileEmptyTab } from '@/components/profile/profileEmptyStates';
import { useProfileLayout } from '@/components/profile/profileLayout';

// Statuses still "in flight" — an order in one of these is what the My Orders
// card surfaces first; a fully-resolved order (delivered/cancelled/refunded/
// disputed) falls back to just showing the most recent order overall.
const ACTIVE_ORDER_STATUSES: BuyerOrderView['status'][] = ['new', 'processing', 'ready_to_ship', 'shipped'];

const TABS = ['Posts', 'Tagged', 'Reposts', 'Saved'] as const;
type Tab = typeof TABS[number];

const TAB_ITEMS: ProfileTab[] = [
  { key: 'Posts', label: 'Posts', icon: 'grid' },
  { key: 'Tagged', label: 'Tagged', icon: 'user' },
  { key: 'Reposts', label: 'Reposts', icon: 'repeat' },
  { key: 'Saved', label: 'Saved', icon: 'bookmark' },
];

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
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      if (!visible) setMounted(false);
    });
  }, [visible, anim]);

  if (!mounted) return null;

  return (
    <Modal transparent animationType="none" onRequestClose={onClose} visible={mounted}>
      <View style={[sheetStyles.backdrop, { backgroundColor: OVERLAY }]}>
        <PressableScale style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close menu" />
        <Animated.View
          style={[
            sheetStyles.sheet,
            { backgroundColor: theme.card, borderColor: theme.border },
            { paddingBottom: insets.bottom + SP.md },
            { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) }] },
          ]}
        >
          <View style={[sheetStyles.sheetHandle, { backgroundColor: theme.border }]} />
          <ScrollView style={sheetStyles.sheetScroll} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
        </Animated.View>
      </View>
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
    <PressableScale style={sheetStyles.sheetRow} onPress={onPress} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={label}>
      {(state) => (
        <>
          <InteractionLayer state={state as { pressed: boolean }} radius={RADIUS.md} theme={theme} />
          <Feather name={icon} size={ICON.md} color={destructive ? theme.error : theme.text} />
          <Text style={[sheetStyles.sheetRowText, { color: destructive ? theme.error : theme.text }]}>{label}</Text>
        </>
      )}
    </PressableScale>
  );
}

// ─── Memoized non-grid cells ─────────────────────────────────────────────────
const SavedCell = React.memo(function SavedCell({
  item, size, theme, onPress,
}: {
  item: SavedItem; size: number; theme: AppThemePreset; onPress: (item: SavedItem) => void;
}) {
  const handlePress = useCallback(() => onPress(item), [onPress, item]);
  return (
    <View style={{ width: size, padding: SP.xs / 2 }}>
      <PressableScale onPress={handlePress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={item.title}>
        <View style={[cellStyles.savedTile, { backgroundColor: theme.card, borderColor: theme.border }]}>
          <Feather name={savedTypeIcon(item.type)} size={ICON.md} color={item.accentColor || theme.accent} />
          <Text style={[cellStyles.savedTitle, { color: theme.text }]} numberOfLines={2}>{item.title}</Text>
          {item.subtitle ? <Text style={[cellStyles.savedSubtitle, { color: theme.muted }]} numberOfLines={1}>{item.subtitle}</Text> : null}
        </View>
      </PressableScale>
    </View>
  );
});

const RepostCard = React.memo(function RepostCard({ repost, theme }: { repost: RepostRecord; theme: AppThemePreset }) {
  return (
    <View style={[cellStyles.repostRow, { backgroundColor: theme.card, borderColor: theme.border }]}>
      <View style={cellStyles.repostHeader}>
        <Feather name="repeat" size={12} color={theme.muted} />
        <Text style={[cellStyles.repostMeta, { color: theme.muted }]}>You reposted</Text>
      </View>
      <Text style={[cellStyles.repostAuthor, { color: theme.text }]}>{repost.originalAuthorName}</Text>
      <Text style={[cellStyles.repostHandle, { color: theme.muted }]}>{repost.originalAuthorHandle}</Text>
      <Text style={[cellStyles.repostCaption, { color: theme.subtle }]} numberOfLines={2}>{repost.originalCaption}</Text>
    </View>
  );
});

type ListRow =
  | { kind: 'post'; item: ProfileGridItem; post: BuyerPost }
  | { kind: 'repost'; repost: RepostRecord }
  | { kind: 'saved'; saved: SavedItem };

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const barInset = useBuyerTabBarInset();
  const router  = useRouter();
  const { signOut } = useAuth();
  const { user } = useUser();
  const api     = useApi();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const layout = useProfileLayout();
  const threadCashEnabled = useFeatureFlag('threadCash');
  // Clears the floating buyer tab bar.
  const listPadding = { paddingBottom: barInset + SP.lg };
  const savedColumns = layout.gridColumns >= 4 ? 3 : 2;
  const savedCellSize = Math.floor((layout.columnWidth - SP.md * 2) / savedColumns);

  const accountRef = useRef(user?.id);
  accountRef.current = user?.id;

  const [profile, setProfile] = useState<BuyerSocialProfile | null>(null);
  const [hasActiveStory, setHasActiveStory] = useState(false);
  const [posts, setPosts] = useState<BuyerPost[]>([]);
  const [reposts, setReposts] = useState<RepostRecord[]>([]);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [, setPrivacySettings] = useState<PrivacySettings | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Posts');
  const [refreshing, setRefreshing] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [myOrders, setMyOrders] = useState<BuyerOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [threadCashBalanceCents, setThreadCashBalanceCents] = useState(0);
  // Live follower/following counts from the server (the locally cached
  // profile counts went stale after every follow).
  const [socialCounts, setSocialCounts] = useState<{ followers: number; following: number } | null>(null);
  const [serverCover, setServerCover] = useState<CoverMedia>({ videoUrl: null, posterUrl: null });
  const coverFlow = useProfileCover({ own: true, cover: serverCover, userId: user?.id });

  // Sheets
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [postSheet, setPostSheet] = useState<BuyerPost | null>(null);

  const loadCounts = useCallback(async () => {
    const id = user?.id;
    if (!id) return;
    try {
      const data = await api.social.profile(id);
      if (accountRef.current !== id || !data) return;
      setSocialCounts({ followers: Number(data.followersCount ?? 0), following: Number(data.followingCount ?? 0) });
      setServerCover({ videoUrl: (data as any).coverVideoUrl ?? null, posterUrl: (data as any).coverPosterUrl ?? null });
    } catch { /* keep the last known counts */ }
  }, [api, user?.id]);

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
    void loadCounts();
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
  }, [api, loadCounts, user?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadData(); } finally { setRefreshing(false); }
  }, [loadData]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  useFocusEffect(useCallback(() => {
    let active = true;
    if (user?.id && threadCashEnabled) {
      void api.threadCash.get()
        .then(status => { if (active) setThreadCashBalanceCents(Math.max(0, status.balanceCents)); })
        .catch(() => {});
    }
    return () => { active = false; };
  }, [api, threadCashEnabled, user?.id]));

  useEffect(() => {
    const unsub = subscribeSocial(() => { loadData(); });
    return unsub;
  }, [loadData]);

  // A follow/unfollow anywhere in the app moves this buyer's Following count now.
  useEffect(() => subscribeProfileEvents((event) => {
    if (event.type !== 'follow' || !user?.id) return;
    if (event.viewerId && event.viewerId !== user.id) return;
    if (event.targetId === user.id) return;
    setSocialCounts((counts) => counts
      ? { ...counts, following: Math.max(0, counts.following + (event.isFollowing ? 1 : -1)) }
      : counts);
  }), [user?.id]);

  // ── Menu actions ──
  const handleMenu = () => {
    hapticLight();
    setMenuOpen(true);
  };

  const handleShareProfile = () => {
    setMenuOpen(false);
    hapticLight();
    setShareSheetOpen(true);
  };

  const handleSignOut = () => {
    setMenuOpen(false);
    Alert.alert('Sign out of Brandthread?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          hapticDestructiveConfirm();
          try { await signOut(); } catch {}
          router.replace('/sign-in' as never);
        },
      },
    ]);
  };

  const handleTabPress = useCallback((tab: string) => {
    hapticSelection();
    setActiveTab(tab as Tab);
  }, []);

  const handleHighlightPress = useCallback(() => {
    hapticSelection();
    router.push('/buyer-highlights-manager' as any);
  }, [router]);

  // ── My Orders card: the latest in-flight order, or the latest order overall
  // once everything's resolved, so there's always a fast way back into orders. ──
  const featuredOrder = myOrders.find(o => ACTIVE_ORDER_STATUSES.includes(o.status)) ?? myOrders[0] ?? null;

  const handleOrdersSeeAll = useCallback(() => {
    hapticSelection();
    router.push('/(buyer)/orders' as never);
  }, [router]);

  const handleFeaturedOrderPress = useCallback(() => {
    if (!featuredOrder) return;
    hapticSelection();
    router.push(`/buyer-order-detail?id=${featuredOrder.id}` as never);
  }, [featuredOrder, router]);

  // ── Post sheet ──
  const handlePostLongPress = useCallback((item: ProfileGridItem) => {
    const post = posts.find((candidate) => candidate.id === item.id);
    if (!post) return;
    hapticMedium();
    setPostSheet(post);
  }, [posts]);

  const handleArchivePost = async () => {
    if (!postSheet) return;
    const post = postSheet;
    setPostSheet(null);
    setPosts(prev => prev.filter(item => item.id !== post.id));
    try { await archivePost(post.id); await loadData(); } catch { setPosts(prev => [...prev, post]); Alert.alert('Could not archive post', 'Try again.'); }
  };

  const handleDeletePost = () => {
    if (!postSheet) return;
    const post = postSheet;
    setPostSheet(null);
    Alert.alert("Delete this post? This can't be undone.", undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          hapticDestructiveConfirm();
          setPosts(prev => prev.filter(item => item.id !== post.id));
          try { await deletePost(post.id); await loadData(); } catch { setPosts(prev => [...prev, post]); Alert.alert("Couldn't delete post", 'Try again.'); }
        },
      },
    ]);
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
        title: 'Share post',
      });
    } catch {}
  };

  const clerkName = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || '';
  const displayName = profile?.name || clerkName || 'Your profile';

  // Tapping a post opens the full-screen feed player on this buyer's own
  // posts, starting at the tapped one.
  const handlePostTap = useCallback((item: ProfileGridItem) => {
    if (!user?.id) return;
    hapticSelection();
    router.push(profileVideosHref({ source: 'creator', id: user.id, startPostId: item.id, title: displayName }) as never);
  }, [displayName, router, user?.id]);

  const handleSavedTap = useCallback(() => {
    router.push('/buyer-saved' as any);
  }, [router]);

  const joinedYear = profile ? new Date(profile.createdAt).getFullYear() : '';
  const displayHandle = profile?.username
    ? `@${profile.username}`
    : (user?.username ? `@${user.username}` : '');
  const avatarInitials = profile?.avatarInitials
    || displayName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    || '•';

  // ── Per-tab rows ──
  const rows: ListRow[] = useMemo(() => {
    if (activeTab === 'Posts') return posts.map((post) => ({ kind: 'post' as const, post, item: gridItemFromBuyerPost(post) }));
    if (activeTab === 'Reposts') return reposts.map((repost) => ({ kind: 'repost' as const, repost }));
    if (activeTab === 'Saved') return savedItems.map((saved) => ({ kind: 'saved' as const, saved }));
    return [];
  }, [activeTab, posts, reposts, savedItems]);

  const numColumns = activeTab === 'Posts' ? layout.gridColumns : activeTab === 'Saved' ? savedColumns : 1;

  const renderRow = useCallback(({ item, index }: { item: ListRow; index: number }) => {
    if (item.kind === 'post') {
      return (
        <ProfileVideoTile
          item={item.item}
          index={index}
          width={layout.tileWidth}
          height={layout.tileHeight}
          onPress={handlePostTap}
          onLongPress={handlePostLongPress}
        />
      );
    }
    if (item.kind === 'repost') return <RepostCard repost={item.repost} theme={theme} />;
    return <SavedCell item={item.saved} size={savedCellSize} theme={theme} onPress={handleSavedTap} />;
  }, [handlePostLongPress, handlePostTap, handleSavedTap, layout.tileHeight, layout.tileWidth, savedCellSize, theme]);

  const keyForRow = useCallback((row: ListRow) => (
    row.kind === 'post' ? row.post.id : row.kind === 'repost' ? row.repost.id : row.saved.id
  ), []);

  // One table decides every tab's empty copy + CTA (own profile → CTA).
  const empty = profileEmptyState(`buyer:${activeTab.toLowerCase()}` as ProfileEmptyTab, true);
  const emptyIcon = empty.icon as keyof typeof Feather.glyphMap;
  const emptyTitle = empty.title;
  const emptyDescription = empty.message;
  const emptyAction = empty.cta
    ? { label: empty.cta.label, onPress: () => router.push(empty.cta!.route as any) }
    : undefined;

  if (loadError) {
    return (
      <View style={[styles.errorRoot, listPadding]}>
        <EmptyState
          icon="alert-triangle"
          title="Couldn't load your profile"
          description="Check your connection and try again."
          action={{ label: 'Retry', onPress: loadData }}
        />
      </View>
    );
  }

  const latestVideo = posts.find((post) => post.type === 'video' && post.mediaUrl);
  const latestPhoto = posts.find((post) => post.type !== 'video' && post.mediaUrl);

  const stats: ProfileStat[] = [
    { key: 'posts', label: 'Posts', value: formatProfileCount(posts.length) },
    {
      key: 'followers', label: 'Followers',
      value: formatProfileCount(socialCounts?.followers ?? profile?.friendsCount ?? 0),
      onPress: () => router.push(connectionsHref('followers') as any),
    },
    {
      key: 'following', label: 'Following',
      value: formatProfileCount(socialCounts?.following ?? profile?.followingBrandsCount ?? 0),
      onPress: () => router.push(connectionsHref('following') as any),
    },
  ];

  const accountSwitcher = (
    <PressableScale
      style={[styles.switcher, { backgroundColor: theme.cardGlass, borderColor: theme.border }]}
      onPress={() => {
        hapticLight();
        router.push('/account-switcher' as never);
      }}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel="Switch account"
      testID="buyer-profile-account-switcher"
    >
      {(state) => (
        <>
          <InteractionLayer state={state as { pressed: boolean }} radius={22} theme={theme} />
          <Text style={[styles.switcherText, { color: theme.text }]} numberOfLines={1}>{displayName}</Text>
          <Feather name="chevron-down" size={16} color={theme.text} />
        </>
      )}
    </PressableScale>
  );

  const extras = (
    <>
      {/* ── My Orders — always-visible way back to order history ── */}
      {featuredOrder ? (
        <View style={styles.inset}>
          <View style={styles.ordersSectionHeader}>
            <Text style={[styles.ordersSectionTitle, { color: theme.text }]}>My Orders</Text>
            <PressableScale
              onPress={handleOrdersSeeAll}
              accessibilityRole="button"
              accessibilityLabel="See all orders"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.seeAll}
            >
              <Text style={[styles.ordersSeeAll, { color: theme.secondary }]}>See all</Text>
            </PressableScale>
          </View>
          <PressableScale
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
          </PressableScale>
        </View>
      ) : null}

      {/* ── Stories & highlights ── */}
      <ProfileStoriesRow
        items={highlights.map((h) => ({ id: h.id, label: h.label, emoji: h.emoji, coverColor: h.coverColor }))}
        onNew={handleHighlightPress}
        onPressItem={handleHighlightPress}
      />
    </>
  );

  return (
    <View style={styles.root}>
      <ProfileShell
        testID="buyer-profile"
        identity={{
          name: displayName,
          handle: displayHandle ? `${displayHandle}${joinedYear ? ` · Joined ${joinedYear}` : ''}` : (joinedYear ? `Joined ${joinedYear}` : null),
          initials: avatarInitials,
          avatarUrl: avatarUri,
          roleLabel: 'Buyer',
          pronouns: profile?.pronouns || null,
        }}
        avatar={{
          ring: hasActiveStory,
          badgeIcon: 'plus',
          onPress: () => router.push('/buyer-story-create' as any),
          accessibilityLabel: hasActiveStory ? 'Add to your story' : 'Create a story',
        }}
        // A cover video, when set, leads the hero; otherwise the latest post
        // (and with neither, the default thread motif).
        hero={coverFlow.hasCover
          ? { videoUri: coverFlow.cover.videoUrl, posterUri: coverFlow.cover.posterUrl }
          : { videoUri: latestVideo?.mediaUrl ?? null, posterUri: latestPhoto?.mediaUrl ?? null }}
        coverAffordance={(
          <CoverHeroAffordance hasCover={coverFlow.hasCover} busy={coverFlow.busy} onAdd={coverFlow.startAdd} onManage={coverFlow.openManage} />
        )}
        topLeft={accountSwitcher}
        isOwnProfile
        // Thread Cash: compact owner-only balance chip (flag-gated; P2P stays off).
        walletChip={threadCashEnabled
          ? { balanceLabel: formatCents(threadCashBalanceCents), onPress: () => router.push('/thread-cash' as never) }
          : null}
        topRight={(
          <>
            <ProfileGlassButton icon="bell" onPress={() => router.push('/buyer-notifications' as any)} accessibilityLabel="Notifications" />
            <ProfileGlassButton icon="menu" onPress={handleMenu} accessibilityLabel="More options" />
          </>
        )}
        meta={(
          <ProfileMeta
            bio={profile?.bio}
            website={profile?.website}
            location={profile?.location}
            onOpenWebsite={(url) => { void Linking.openURL(url); }}
          />
        )}
        stats={stats}
        statsLoading={loading}
        actions={(
          <>
            <View style={styles.actionRow}>
              <ProfileButton label="Edit profile" icon="edit-3" variant="primary" onPress={() => router.push('/(buyer)/edit-profile')} />
              <ProfileButton
                label="Share profile"
                icon="share-2"
                onPress={handleShareProfile}
                accessibilityHint="Opens your shareable profile link and QR code"
              />
            </View>
            <View style={styles.actionRow}>
              <ProfileButton label="Messages" icon="send" onPress={() => router.push('/(buyer)/inbox' as never)} />
              <ProfileButton label="Friends" icon="users" onPress={() => router.push('/(buyer)/friends' as any)} />
            </View>
          </>
        )}
        extras={extras}
        tabs={{ items: TAB_ITEMS, active: activeTab, onChange: handleTabPress }}
        data={loading ? [] : rows}
        renderItem={renderRow}
        keyExtractor={keyForRow}
        numColumns={numColumns}
        listKey={`buyer-${activeTab}-${numColumns}`}
        ListEmptyComponent={(
          <ProfileGridPlaceholder
            loading={loading}
            error={false}
            onRetry={loadData}
            layout={layout}
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
          />
        )}
        refreshing={refreshing}
        onRefresh={onRefresh}
        bottomInset={listPadding.paddingBottom}
      />

      {/* ── Profile Menu Sheet ── */}
      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text style={[sheetStyles.sheetTitle, { color: theme.muted }]}>Profile</Text>
        <SheetRow icon="edit-3" label="Edit profile" onPress={() => { setMenuOpen(false); router.push('/(buyer)/edit-profile'); }} />
        <SheetRow icon="share-2" label="Share profile" onPress={handleShareProfile} />
        <SheetRow icon="users" label="Friends" onPress={() => { setMenuOpen(false); router.push('/(buyer)/friends' as any); }} />
        <SheetRow icon="star" label="Close friends" onPress={() => { setMenuOpen(false); router.push('/buyer-close-friends' as any); }} />
        <SheetRow icon="archive" label="Archive" onPress={() => { setMenuOpen(false); router.push('/buyer-archive' as any); }} />
        <SheetRow icon="activity" label="Your activity" onPress={() => { setMenuOpen(false); router.push('/buyer-your-activity' as any); }} />
        <SheetRow icon="package" label="Orders" onPress={() => { setMenuOpen(false); router.push('/(buyer)/orders'); }} />
        <SheetRow icon="briefcase" label="Freelancer jobs" onPress={() => { setMenuOpen(false); router.push('/freelancer-jobs' as any); }} />
        <SheetRow icon="gift" label="Rewards" onPress={() => { setMenuOpen(false); router.push('/loyalty' as any); }} />
        <SheetRow icon="bookmark" label="Saved" onPress={() => { setMenuOpen(false); router.push('/buyer-saved' as any); }} />
        <SheetRow icon="grid" label="QR code" onPress={() => { setMenuOpen(false); router.push('/buyer-qr-code' as any); }} />
        <SheetRow icon="image" label="Highlights" onPress={() => { setMenuOpen(false); router.push('/buyer-highlights-manager' as any); }} />
        <SheetRow icon="settings" label="Settings" onPress={() => { setMenuOpen(false); router.push('/settings' as any); }} />
        <View style={[sheetStyles.sheetDivider, { backgroundColor: theme.border }]} />
        <SheetRow icon="log-out" label="Sign out" destructive onPress={handleSignOut} />
      </BottomSheet>

      <CoverCoachmarkSheet
        visible={coverFlow.coachmarkVisible}
        onAdd={() => { coverFlow.dismissCoachmark(); coverFlow.startAdd(); }}
        onLater={coverFlow.dismissCoachmark}
      />
      <CoverManageSheet visible={coverFlow.manageOpen} onChange={coverFlow.changeFromManage} onRemove={() => { void coverFlow.remove(); }} onClose={coverFlow.closeManage} />
      <CoverTrimSheet source={coverFlow.trimSource} onCancel={coverFlow.cancelTrim} onConfirm={coverFlow.confirmTrim} />

      <ShareProfileSheet
        visible={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
        avatarUrl={avatarUri}
        buyerExtra={{
          statLabel: 'followers',
          statValue: socialCounts?.followers ?? profile?.friendsCount ?? 0,
          topPosts: posts.slice(0, 3).map(p => ({ id: p.id, uri: p.mediaUrl })),
        }}
      />

      {/* ── Post Long-Press Sheet ── */}
      <BottomSheet visible={!!postSheet} onClose={() => setPostSheet(null)}>
        <Text style={[sheetStyles.sheetTitle, { color: theme.muted }]} numberOfLines={1}>{postSheet?.caption || 'Post'}</Text>
        <SheetRow icon="share-2" label="Share post" onPress={handleShareCurrentPost} />
        <SheetRow icon="archive" label="Archive" onPress={handleArchivePost} />
        <View style={[sheetStyles.sheetDivider, { backgroundColor: theme.border }]} />
        <SheetRow icon="trash-2" label="Delete post" destructive onPress={handleDeletePost} />
      </BottomSheet>
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    errorRoot: { flex: 1, backgroundColor: theme.background, justifyContent: 'center' },
    inset: { paddingHorizontal: SP.md },
    actionRow: { flexDirection: 'row', gap: SP.sm },

    switcher: {
      flexDirection: 'row', alignItems: 'center', gap: SP.xs, maxWidth: 220,
      minHeight: 44, borderRadius: 22, borderWidth: 1, paddingLeft: SP.md, paddingRight: SP.sm, overflow: 'hidden',
    },
    switcherText: { fontFamily: FONT.semibold, fontSize: FS.sm, flexShrink: 1 },

    threadCashChip: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs,
      alignSelf: 'flex-start', paddingHorizontal: SP.md, minHeight: 44,
      borderRadius: RADIUS.pill, borderWidth: 1,
    },
    threadCashChipText: { fontFamily: FONT.semibold, fontSize: FS.xs },

    ordersSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.xs },
    ordersSectionTitle: { fontFamily: FONT.bold, fontSize: FS.md },
    seeAll: { justifyContent: 'center', paddingHorizontal: SP.xs },
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
  });
}

const cellStyles = StyleSheet.create({
  repostRow: { borderWidth: 1, borderRadius: RADIUS.md, marginHorizontal: SP.md, marginVertical: SP.xs, padding: SP.md },
  repostHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  repostMeta: { fontFamily: FONT.regular, fontSize: FS.xs },
  repostAuthor: { fontFamily: FONT.semibold, fontSize: FS.sm },
  repostHandle: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
  repostCaption: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: SP.xs },
  savedTile: { aspectRatio: 1, borderWidth: 1, borderRadius: RADIUS.md, padding: SP.sm, justifyContent: 'space-between' },
  savedTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: SP.xs },
  savedSubtitle: { fontFamily: FONT.regular, fontSize: FS.xs },
});

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingTop: SP.sm, paddingHorizontal: SP.md, borderWidth: 1, borderBottomWidth: 0, maxHeight: '80%' },
  sheetScroll: { maxHeight: '100%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  sheetTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, paddingVertical: SP.sm, paddingHorizontal: SP.xs, marginBottom: SP.xs },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 50, paddingHorizontal: SP.xs, borderRadius: RADIUS.md },
  sheetRowText: { fontFamily: FONT.medium, fontSize: FS.base },
  sheetDivider: { height: 1, marginVertical: SP.xs },
});
