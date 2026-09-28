/**
 * Buyer's own profile — Instagram's own-profile layout in Brandthread
 * branding (Mobbin references in the PR description):
 *
 *  - the profile video plays full-bleed from the very top of the screen
 *    behind the top bar, avatar, name/@handle/chip and bio, fading into the
 *    solid page background exactly where the stats row begins
 *    (`ProfileVideoHeader`); with no video the same layout sits on the plain
 *    background;
 *  - Posts · Followers · Following as number-over-label columns;
 *  - Edit profile · Share profile · discover-people (shared `Button`);
 *  - Story Highlights row (circles + "New");
 *  - the Thread Cash streak card;
 *  - icon-only tabs with an underline (Posts / Saved / Liked / Orders) over a
 *    3-column, 1pt-gutter, 4:5 grid.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, Animated, Share, Linking, Alert, ScrollView, Platform, Pressable,
  useWindowDimensions, type LayoutChangeEvent,
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
  getMyProfile, getMyPosts, getSavedItems,
  getPrivacySettings, archivePost, deletePost,
  subscribeSocial,
} from '@/services/socialService';
import { useApi } from '@/lib/api';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { formatCents } from '@/lib/money';
import { CachedImage } from '@/components/CachedImage';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { loadBuyerProfile } from '@/lib/buyerProfile';
import { getBuyerOrdersWithStatus } from '@/services/orderService';
import { OrderStatusTimeline } from '@/components/orders/OrderStatusTimeline';
import type { BuyerOrderView } from '@/services/orderTypes';
import type {
  BuyerSocialProfile, BuyerPost, SavedItem, PrivacySettings,
} from '@/services/socialTypes';
import { subscribeProfileEvents } from '@/lib/profileEvents';
import { connectionsHref, profileVideosHref } from '@/lib/profileNavigation';
import { formatProfileCount } from '@/services/profileService';
import { ProfileMeta } from '@/components/profile/ProfileShell';
import { InteractionLayer, ProfileChip, ProfileTabs, type ProfileStat, type ProfileTab } from '@/components/profile/ProfileControls';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { ProfileVideoAffordance, ProfileVideoHeader, useHeroPosterOnly } from '@/components/profile/ProfileVideoHeader';
import { ProfileStoryAvatar } from '@/components/profile/ProfileStoryAvatar';
import { activeStoryIds } from '@/components/profile/profileAvatarGeometry';
import { ProfileStoriesRow, type ProfileStoryItem } from '@/components/profile/ProfileStoriesRow';
import { loadHighlights, type Highlight } from '@/lib/highlightsService';
import { Button } from '@/components/ui/Button';
import { ProfileVideoTile, gridItemFromBuyerPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { ProfileEmptyAreaContext } from '@/components/profile/ProfileEmptyAreaContext';
import {
  CoverCoachmarkSheet, CoverManageSheet, CoverTrimSheet, useProfileCover, type CoverMedia,
} from '@/components/profile/ProfileCover';
import { profileEmptyState, computeEmptyArea, type ProfileEmptyTab } from '@/components/profile/profileEmptyStates';
import { TILE_ASPECT_4_5, useProfileLayout } from '@/components/profile/profileLayout';
import { ThreadCashStreakRow } from '@/components/thread-cash/ThreadCashStreakRow';
import { useCelebrateThreadCash } from '@/components/thread-cash/CelebrationHost';
import { isPreviewThreadCashEnabled, PREVIEW_THREAD_CASH_STATUS } from '@/lib/previewThreadCash';
import type { ThreadCashStreakState } from '@/lib/threadCashTypes';

// Realistic identity shown only when there is truly no signed-in user at all
// (the dev `?bt_preview=buyer` bypass skips Clerk entirely) — a real,
// authenticated user always has at least a Clerk username, so this never
// fires in production and the screen never falls back to a generic
// "Your profile" placeholder.
const PREVIEW_NAME = 'Ava Buyer';
const PREVIEW_HANDLE = '@ava';

const TABS = ['Posts', 'Saved', 'Liked', 'Orders'] as const;
type Tab = typeof TABS[number];

const TAB_ITEMS: ProfileTab[] = [
  { key: 'Posts', label: 'Posts', icon: 'grid' },
  { key: 'Saved', label: 'Saved', icon: 'bookmark' },
  { key: 'Liked', label: 'Liked', icon: 'heart' },
  { key: 'Orders', label: 'Orders', icon: 'package' },
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
  icon, label, destructive, onPress, last,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
  /** Skips the divider under the last row in a group. */
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    // Plain `Pressable` (not `PressableScale`, whose forced style-forwarding
    // to an inner wrapper — see the profile header's own fixes — was
    // silently dropping this row's real height/divider here too).
    <Pressable
      style={({ pressed }) => [sheetStyles.sheetRow, !last && sheetStyles.sheetRowDivider, pressed && sheetStyles.sheetRowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={22} color={destructive ? theme.error : theme.text} />
      <Text style={[sheetStyles.sheetRowText, { color: destructive ? theme.error : theme.text }]}>{label}</Text>
      {!destructive ? <Feather name="chevron-right" size={18} color={theme.subtle} style={sheetStyles.sheetRowChevron} /> : null}
    </Pressable>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────────
function CompactWalletChip({ balanceLabel, onPress, onLongPress, theme }: {
  balanceLabel: string;
  onPress: () => void;
  /** Dev-only: replays the money-burst celebration on demand (hidden, no visual affordance). */
  onLongPress?: () => void;
  theme: AppThemePreset;
}) {
  return (
    <PressableScale
      onPress={() => { hapticSelection(); onPress(); }}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Thread Cash wallet, ${balanceLabel}`}
      testID="profile-wallet-chip"
      hitSlop={4}
      style={[topBarStyles.walletChip, { backgroundColor: theme.cardGlass, borderColor: theme.border }]}
    >
      <ThreadCashBillIcon size={16} />
      <Text style={[topBarStyles.walletText, { color: theme.text }]} numberOfLines={1}>{balanceLabel}</Text>
    </PressableScale>
  );
}

function TopBarIcon({ name, onPress, accessibilityLabel, theme, badge }: {
  name: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
  theme: AppThemePreset;
  badge?: boolean;
}) {
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={topBarStyles.iconButton}
    >
      <Feather name={name} size={24} color={theme.text} />
      {badge ? <View style={[topBarStyles.iconBadge, { backgroundColor: theme.accent, borderColor: theme.background }]} /> : null}
    </Pressable>
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

const OrderRow = React.memo(function OrderRow({ order, theme, onPress }: {
  order: BuyerOrderView; theme: AppThemePreset; onPress: (order: BuyerOrderView) => void;
}) {
  const handlePress = useCallback(() => onPress(order), [onPress, order]);
  return (
    <PressableScale
      style={[cellStyles.orderCard, { backgroundColor: theme.card, borderColor: theme.border }]}
      onPress={handlePress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.orderNumber}, ${order.status.replace(/_/g, ' ')}`}
    >
      {order.lineItems[0]?.imageUri ? (
        <CachedImage source={{ uri: order.lineItems[0].imageUri }} style={cellStyles.orderCardImage} contentFit="cover" />
      ) : (
        <View style={[cellStyles.orderCardImage, cellStyles.orderCardImagePlaceholder, { backgroundColor: theme.cardElevated }]}>
          <Feather name="shopping-bag" size={ICON.md} color={theme.muted} />
        </View>
      )}
      <View style={cellStyles.orderCardBody}>
        <Text style={[cellStyles.orderCardSeller, { color: theme.text }]} numberOfLines={1}>{order.sellerName}</Text>
        <Text style={[cellStyles.orderCardMeta, { color: theme.muted }]} numberOfLines={1}>
          {order.orderNumber} · {order.lineItems.length} item{order.lineItems.length === 1 ? '' : 's'}
        </Text>
        <OrderStatusTimeline status={order.status} compact />
      </View>
      <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
    </PressableScale>
  );
});

type ListRow =
  | { kind: 'post'; item: ProfileGridItem; post: BuyerPost }
  | { kind: 'saved'; saved: SavedItem }
  | { kind: 'order'; order: BuyerOrderView };

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const barInset = useBuyerTabBarInset();
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { signOut } = useAuth();
  const { user } = useUser();
  const api     = useApi();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // Instagram's own-profile grid: 3 columns, 1pt gutters, 4:5 tiles.
  const layout = useProfileLayout({ tileAspect: TILE_ASPECT_4_5 });
  const heroPosterOnly = useHeroPosterOnly();
  const threadCashEnabled = useFeatureFlag('threadCash');
  const celebrateThreadCash = useCelebrateThreadCash();
  const { height: winHeight } = useWindowDimensions();
  // Clears the floating buyer tab bar.
  const listPadding = { paddingBottom: barInset + SP.lg };
  const savedColumns = layout.gridColumns >= 4 ? 3 : 2;
  const savedCellSize = Math.floor((layout.columnWidth - SP.md * 2) / savedColumns);
  const topPad = Platform.OS === 'web' ? Math.max(insets.top, 54) : insets.top;

  // The whole header (video hero, identity, buttons, highlights, streak,
  // tabs) scrolls away with the list — nothing stays pinned above the empty
  // state — so `computeEmptyArea` (the same helper ProfileShell already uses
  // for this exact bug class) is given the header's own measured height as
  // its "tabsHeight" input. This sizes the empty state to fill the rest of
  // the viewport, guaranteeing its CTA clears the floating tab bar by
  // `EMPTY_AREA_BREATHING_ROOM` at the end of the scroll, on any header
  // height (the video hero makes this header much taller than a fixed
  // constant could safely assume).
  const [headerHeight, setHeaderHeight] = useState(0);
  const handleHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.height);
    setHeaderHeight((prev) => (prev === next ? prev : next));
  }, []);
  const emptyArea = computeEmptyArea({
    viewportHeight: winHeight,
    topChrome: 0,
    tabsHeight: headerHeight,
    bottomInset: barInset,
  });

  const accountRef = useRef(user?.id);
  accountRef.current = user?.id;

  const [profile, setProfile] = useState<BuyerSocialProfile | null>(null);
  const [posts, setPosts] = useState<BuyerPost[]>([]);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [, setPrivacySettings] = useState<PrivacySettings | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Posts');
  const [postFilter, setPostFilter] = useState<'Published' | 'Drafts'>('Published');
  const [refreshing, setRefreshing] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [myOrders, setMyOrders] = useState<BuyerOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [threadCashBalanceCents, setThreadCashBalanceCents] = useState(0);
  const [threadCashStreak, setThreadCashStreak] = useState<ThreadCashStreakState | null>(null);
  // Live follower/following counts from the server (the locally cached
  // profile counts went stale after every follow).
  const [socialCounts, setSocialCounts] = useState<{ followers: number; following: number } | null>(null);
  const [serverCover, setServerCover] = useState<CoverMedia>({ videoUrl: null, posterUrl: null });
  const [myStoryIds, setMyStoryIds] = useState<string[]>([]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  // The profile video only decodes while this tab is focused AND the video
  // layer is still on screen (paused once it scrolls away).
  const [focused, setFocused] = useState(true);
  const [heroHeight, setHeroHeight] = useState(0);
  const [heroOnScreen, setHeroOnScreen] = useState(true);
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
      setSavedItems([]);
      setLoading(false);
      return;
    }
    setLoadError(false);
    void loadCounts();
    try {
      const [p, po, sv, pr, bp, ordersResult] = await Promise.all([
        getMyProfile(),
        getMyPosts(),
        getSavedItems(),
        getPrivacySettings(),
        loadBuyerProfile(),
        getBuyerOrdersWithStatus(user.id).catch(() => ({ orders: [] as BuyerOrderView[], fromCache: true })),
      ]);
      if (accountRef.current !== user?.id) return;
      setProfile(p);
      setPosts(po.filter(x => !x.isArchived));
      setSavedItems(sv);
      setPrivacySettings(pr);
      setAvatarUri(bp.avatarUri || null);
      setMyOrders(ordersResult.orders);
    } catch (error) {
      setLoadError(true);
      setProfile(null);
      setPosts([]);
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
    setFocused(true);
    return () => setFocused(false);
  }, []));

  // Accent story ring: the same "unexpired story" rule the seller profile
  // uses (api.social.myStories() filtered by expiresAt > now).
  useFocusEffect(useCallback(() => {
    let alive = true;
    if (user?.id) {
      api.social.myStories()
        .then((rows) => { if (alive) setMyStoryIds(activeStoryIds(rows)); })
        .catch(() => { /* no ring rather than a wrong one */ });
    }
    loadHighlights().then((items) => { if (alive) setHighlights(items); }).catch(() => {});
    return () => { alive = false; };
  }, [api, user?.id]));

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    const next = event.nativeEvent.contentOffset.y < Math.max(heroHeight, 1);
    setHeroOnScreen((prev) => (prev === next ? prev : next));
  }, [heroHeight]);

  useFocusEffect(useCallback(() => {
    let active = true;
    if (!threadCashEnabled) return () => { active = false; };

    // No live backend in the dev-web preview (and, per #151, a Clerk token
    // that never resolves within its timeout can also leave `user` unset
    // there) — fall back to seeded preview data so the streak row isn't
    // silently invisible. Applied whenever there's no signed-in user id OR
    // the real response comes back with no usable streak data (the row's
    // own guard is `currentStreak > 0`); `isPreviewThreadCashEnabled()` is
    // `__DEV__`-gated, so none of this ever fires in a production build.
    const applyPreviewFallback = () => {
      if (!active || !isPreviewThreadCashEnabled()) return;
      setThreadCashBalanceCents(Math.max(0, PREVIEW_THREAD_CASH_STATUS.balanceCents));
      setThreadCashStreak(PREVIEW_THREAD_CASH_STATUS.streak);
    };

    if (!user?.id) {
      applyPreviewFallback();
      return () => { active = false; };
    }

    void api.threadCash.get()
      .then(status => {
        if (!active) return;
        // The real balance is always trustworthy (even a fresh streak-less
        // buyer can hold a nonzero balance from a gift/blast) — only the
        // streak itself falls back when the response has nothing to show.
        setThreadCashBalanceCents(Math.max(0, status?.balanceCents ?? 0));
        if (status?.streak && status.streak.currentStreak > 0) {
          setThreadCashStreak(status.streak);
        } else {
          applyPreviewFallback();
        }
      })
      .catch(applyPreviewFallback);

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

  const handleOrdersPress = useCallback((order: BuyerOrderView) => {
    hapticSelection();
    router.push(`/buyer-order-detail?id=${order.id}` as never);
  }, [router]);

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
  // Only true in the dev `?bt_preview=buyer` bypass, which never signs in
  // through Clerk at all — a real user always has at least a username.
  const isPreviewIdentity = !user?.id;
  const displayHandle = profile?.username
    ? `@${profile.username}`
    : user?.username
      ? `@${user.username}`
      : (isPreviewIdentity ? PREVIEW_HANDLE : '');
  // Real display name → @username → the generic fallback, in that order —
  // never the giant hardcoded "Your profile" title unless there's truly no
  // data yet to show.
  const displayName = profile?.name || clerkName || (isPreviewIdentity ? PREVIEW_NAME : displayHandle) || 'Your profile';

  // Tapping a post opens the full-screen feed player on this buyer's own
  // posts, starting at the tapped one.
  const handlePostTap = useCallback((item: ProfileGridItem) => {
    if (!user?.id) return;
    hapticSelection();
    // A draft has no published media to view — resume it in the composer,
    // same as the seller profile's Drafts filter does.
    if (postFilter === 'Drafts' && activeTab === 'Posts') {
      router.push((`/create-post?accountType=buyer&editId=` + encodeURIComponent(item.id)) as never);
      return;
    }
    router.push(profileVideosHref({ source: 'creator', id: user.id, startPostId: item.id, title: displayName }) as never);
  }, [activeTab, displayName, postFilter, router, user?.id]);

  const handleSavedTap = useCallback(() => {
    router.push('/buyer-saved' as any);
  }, [router]);

  const avatarInitials = profile?.avatarInitials
    || displayName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    || '•';

  // ── Per-tab rows ──
  const rows: ListRow[] = useMemo(() => {
    if (activeTab === 'Posts') {
      const filtered = posts.filter(p => postFilter === 'Drafts' ? p.isDraft : !p.isDraft);
      return filtered.map((post) => ({ kind: 'post' as const, post, item: gridItemFromBuyerPost(post) }));
    }
    if (activeTab === 'Saved') return savedItems.map((saved) => ({ kind: 'saved' as const, saved }));
    if (activeTab === 'Orders') return myOrders.map((order) => ({ kind: 'order' as const, order }));
    // Liked has no backing data yet — a clean empty slot rather than
    // inventing engagement history.
    return [];
  }, [activeTab, postFilter, posts, savedItems, myOrders]);

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
    if (item.kind === 'order') return <OrderRow order={item.order} theme={theme} onPress={handleOrdersPress} />;
    return <SavedCell item={item.saved} size={savedCellSize} theme={theme} onPress={handleSavedTap} />;
  }, [handleOrdersPress, handlePostLongPress, handlePostTap, handleSavedTap, layout.tileHeight, layout.tileWidth, savedCellSize, theme]);

  const keyForRow = useCallback((row: ListRow) => (
    row.kind === 'post' ? row.post.id : row.kind === 'order' ? row.order.id : row.saved.id
  ), []);

  // One table decides every tab's empty copy + CTA (own profile → CTA).
  const emptyTabKey = activeTab === 'Posts' && postFilter === 'Drafts' ? 'buyer:draft' : `buyer:${activeTab.toLowerCase()}`;
  const empty = profileEmptyState(emptyTabKey as ProfileEmptyTab, true);
  const emptyIcon = empty.icon as keyof typeof Feather.glyphMap;
  const emptyIllustration = empty.illustration;
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

  const hasCover = coverFlow.hasCover;
  const hasActiveStory = myStoryIds.length > 0;
  const heroActive = focused && heroOnScreen && !heroPosterOnly;

  // Instagram order: Posts · Followers · Following. Drafts never count toward
  // the public "Posts" stat (they aren't published).
  const publishedPosts = posts.filter(p => !p.isDraft);
  const stats: ProfileStat[] = [
    { key: 'posts', label: 'Posts', value: formatProfileCount(publishedPosts.length) },
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

  const highlightItems: ProfileStoryItem[] = highlights.map((h) => ({
    id: h.id, label: h.label, emoji: h.emoji, coverColor: h.coverColor,
  }));

  const topBar = (
    <>
      <PressableScale
        style={styles.topBarLeft}
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
            <InteractionLayer state={state as { pressed: boolean }} radius={RADIUS.sm} theme={theme} />
            <Text style={[styles.topBarUsername, { color: theme.text }, hasCover && styles.overMedia]} numberOfLines={1}>{displayHandle || displayName}</Text>
            <Feather name="chevron-down" size={16} color={theme.text} />
          </>
        )}
      </PressableScale>
      <View style={styles.topBarRight}>
        {threadCashEnabled ? (
          <CompactWalletChip
            balanceLabel={formatCents(threadCashBalanceCents)}
            onPress={() => router.push('/thread-cash' as never)}
            onLongPress={__DEV__ ? () => celebrateThreadCash({ amount: 500, from: 'Daily reward' }) : undefined}
            theme={theme}
          />
        ) : null}
        <TopBarIcon name="bell" onPress={() => router.push('/buyer-notifications' as any)} accessibilityLabel="Notifications" theme={theme} />
        <TopBarIcon name="menu" onPress={handleMenu} accessibilityLabel="More options" theme={theme} />
      </View>
    </>
  );

  const header = (
    <View onLayout={handleHeaderLayout}>
      {/* ── Video hero + identity: the profile video (when set) runs from the
          very top of the screen, behind the top bar, avatar, name/@handle/
          chip and bio, and fades into the solid background exactly where the
          stats row begins. No video → the same layout on the plain page. ── */}
      <ProfileVideoHeader
        hero={{ videoUri: coverFlow.cover.videoUrl, posterUri: coverFlow.cover.posterUrl }}
        heroActive={heroActive}
        posterOnly={heroPosterOnly}
        topPad={topPad}
        onHeroHeight={setHeroHeight}
        topBar={topBar}
        avatar={(
          <ProfileStoryAvatar
            uri={avatarUri}
            initials={avatarInitials}
            hasActiveStory={hasActiveStory}
            accessibilityLabel={hasActiveStory ? 'View your story' : 'Create a story'}
            onPress={() => {
              hapticSelection();
              if (hasActiveStory) {
                router.push({ pathname: '/buyer-story-viewer' as any, params: { storyId: myStoryIds[0], allStoryIds: myStoryIds.join(',') } });
              } else {
                router.push('/buyer-story-create' as any);
              }
            }}
            onPressBadge={() => { hapticSelection(); router.push('/buyer-story-create' as any); }}
          />
        )}
        name={displayName}
        handle={displayHandle && displayHandle !== displayName ? displayHandle : null}
        chip={<ProfileChip label="Buyer" icon="user" />}
        meta={(profile?.bio || profile?.website || profile?.location) ? (
          <ProfileMeta
            bio={profile?.bio}
            website={profile?.website}
            location={profile?.location}
            onOpenWebsite={(url) => { void Linking.openURL(url); }}
          />
        ) : null}
        coverAffordance={(
          <ProfileVideoAffordance
            hasVideo={hasCover}
            busy={coverFlow.busy}
            onAdd={coverFlow.startAdd}
            onManage={coverFlow.openManage}
          />
        )}
        stats={stats}
        statsLoading={loading}
      />

      {/* ── Edit profile · Share profile · discover people (shared Button) ── */}
      <View style={styles.actionsRow}>
        <View style={styles.actionFlex}>
          <Button
            label="Edit profile"
            variant="secondary"
            size="compact"
            fullWidth
            onPress={() => router.push('/(buyer)/edit-profile')}
            style={[styles.actionButton, { backgroundColor: theme.cardElevated, borderColor: theme.cardElevated }]}
            testID="profile-edit-button"
          />
        </View>
        <View style={styles.actionFlex}>
          <Button
            label="Share profile"
            variant="secondary"
            size="compact"
            fullWidth
            onPress={handleShareProfile}
            accessibilityHint="Opens your shareable profile link and QR code"
            style={[styles.actionButton, { backgroundColor: theme.cardElevated, borderColor: theme.cardElevated }]}
            testID="profile-share-button"
          />
        </View>
        <Button
          label=""
          icon="user-plus"
          variant="secondary"
          size="compact"
          accessibilityLabel="Discover people"
          onPress={() => router.push('/(buyer)/friends' as any)}
          style={[styles.actionButton, styles.actionSquare, { backgroundColor: theme.cardElevated, borderColor: theme.cardElevated }]}
          testID="profile-discover-people"
        />
      </View>

      {/* ── Story Highlights: circles + "New" ── */}
      <View style={styles.highlightsWrap} testID="profile-highlights">
        <ProfileStoriesRow
          items={highlightItems}
          onNew={() => { hapticSelection(); router.push('/buyer-highlights-manager?create=1' as any); }}
          onPressItem={(item) => {
            hapticSelection();
            // Highlights are local label/emoji/colour records with no story
            // media yet, so a tap opens that highlight in the manager.
            router.push(`/buyer-highlights-manager?edit=${encodeURIComponent(item.id)}` as any);
          }}
        />
      </View>

      {threadCashEnabled ? (
        <View style={styles.streakWrap}>
          <ThreadCashStreakRow streak={threadCashStreak} onPress={() => router.push('/thread-cash' as never)} />
        </View>
      ) : null}

      <View style={styles.tabsBlock}>
        <ProfileTabs tabs={TAB_ITEMS} active={activeTab} onChange={handleTabPress} variant="iconOnly" />
      </View>

      {/* Posts sub-filter (Published / Drafts) — same pattern as the seller
          profile's own filter row, minus Scheduled (buyers can't schedule). */}
      {activeTab === 'Posts' && (
        <View style={styles.filterRow} accessibilityRole="tablist" testID="buyer-post-filters">
          {(['Published', 'Drafts'] as const).map((filter) => {
            const selected = filter === postFilter;
            return (
              <Pressable
                key={filter}
                onPress={() => { hapticSelection(); setPostFilter(filter); }}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={`${filter} posts`}
                testID={`buyer-post-filter-${filter.toLowerCase()}`}
                style={({ pressed }) => [
                  styles.filterChip,
                  { borderColor: selected ? theme.text : theme.border, backgroundColor: selected ? theme.text : 'transparent' },
                  pressed && styles.filterChipPressed,
                ]}
              >
                <Text style={[styles.filterText, { color: selected ? theme.background : theme.muted }]}>{filter}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.root} testID="buyer-profile">
      <ProfileEmptyAreaContext.Provider value={emptyArea.minHeight}>
      <Animated.FlatList
        key={`buyer-${numColumns}`}
        data={loading ? [] : rows}
        renderItem={renderRow as any}
        keyExtractor={keyForRow as any}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? styles.gridRow : undefined}
        ListHeaderComponent={header}
        ListEmptyComponent={(
          // `emptyArea` (computeEmptyArea, shared with ProfileShell) sizes
          // this to fill the rest of the viewport below the (measured, video
          // hero included) header, and `emptyArea.paddingBottom` below
          // reserves the floating tab bar's own footprint — so at the end of
          // the scroll the CTA sits fully clear of the bar, on any header
          // height, not just a fixed constant.
          <ProfileGridPlaceholder
            loading={loading}
            error={false}
            onRetry={loadData}
            layout={layout}
            icon={emptyIcon}
            illustration={emptyIllustration}
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
            actionStyle="text"
            showGridPreview={activeTab === 'Posts'}
          />
        )}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: emptyArea.paddingBottom }}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
      </ProfileEmptyAreaContext.Provider>

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
        <SheetRow icon="settings" label="Settings" last onPress={() => { setMenuOpen(false); router.push('/settings' as any); }} />
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
          topPosts: publishedPosts.slice(0, 3).map(p => ({ id: p.id, uri: p.mediaUrl })),
        }}
      />

      {/* ── Post Long-Press Sheet ── */}
      <BottomSheet visible={!!postSheet} onClose={() => setPostSheet(null)}>
        <Text style={[sheetStyles.sheetTitle, { color: theme.muted }]} numberOfLines={1}>{postSheet?.caption || 'Post'}</Text>
        <SheetRow icon="share-2" label="Share post" onPress={handleShareCurrentPost} />
        <SheetRow icon="archive" label="Archive" last onPress={handleArchivePost} />
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
    gridRow: { gap: 1 },

    topBarLeft: {
      flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32,
      borderRadius: RADIUS.sm, overflow: 'hidden',
    },
    topBarUsername: { fontFamily: FONT.semibold, fontSize: 18, flexShrink: 1, minWidth: 0 },
    overMedia: {
      textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4, // theme-exempt: legibility over cover media
    },
    topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 0 },

    // Stats row → buttons: 16pt. Instagram proportions: two equal buttons
    // plus a square discover-people button, 6pt apart, 8pt corners.
    actionsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: SP.md, paddingTop: 16, alignItems: 'center' },
    actionFlex: { flex: 1, minWidth: 0 },
    actionButton: { borderRadius: 8, paddingHorizontal: SP.sm },
    actionSquare: { width: 36, paddingHorizontal: 0 },
    // Buttons → highlights: 16pt.
    highlightsWrap: { paddingTop: 16 },
    // Highlights → streak card (or tabs, when Thread Cash is off): 16pt.
    streakWrap: { marginTop: 16 },
    // Streak card (or highlights) → tabs: 16pt above; tabs → grid: 1pt
    // (Instagram's grid starts right under the underline).
    tabsBlock: { paddingTop: 16, paddingBottom: 1 },

    // Posts sub-filter (Published / Drafts) — same pattern as the seller
    // profile's own filterRow, buyer has no Scheduled (buyers can't schedule).
    filterRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.xs },
    filterChip: { height: 30, borderRadius: 15, borderWidth: 1, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
    filterChipPressed: { opacity: 0.7 },
    filterText: { fontFamily: FONT.semibold, fontSize: FS.xs },
  });
}

const topBarStyles = StyleSheet.create({
  walletChip: {
    height: 28, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center',
    gap: 4, paddingHorizontal: 8, overflow: 'hidden',
  },
  walletText: { fontFamily: FONT.bold, fontSize: FS.xs, fontVariant: ['tabular-nums'] },
  iconButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  iconBadge: { position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
});

const cellStyles = StyleSheet.create({
  savedTile: { aspectRatio: 1, borderWidth: 1, borderRadius: RADIUS.md, padding: SP.sm, justifyContent: 'space-between' },
  savedTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: SP.xs },
  savedSubtitle: { fontFamily: FONT.regular, fontSize: FS.xs },
  orderCard: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: RADIUS.md, padding: SP.sm, gap: SP.sm,
    marginHorizontal: SP.md, marginVertical: SP.xs,
  },
  orderCardImage: { width: 52, height: 52, borderRadius: RADIUS.sm },
  orderCardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  orderCardBody: { flex: 1, gap: 2 },
  orderCardSeller: { fontFamily: FONT.semibold, fontSize: FS.sm },
  orderCardMeta: { fontFamily: FONT.regular, fontSize: FS.xs, marginBottom: 2 },
});

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl, paddingTop: SP.sm, paddingHorizontal: SP.md, borderWidth: 1, borderBottomWidth: 0, maxHeight: '80%' },
  sheetScroll: { maxHeight: '100%' },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  sheetTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, paddingVertical: SP.sm, paddingHorizontal: SP.xs, marginBottom: SP.xs },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, height: 52, paddingHorizontal: SP.xs },
  sheetRowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' /* theme-exempt: fixed 8% white divider per spec */ },
  sheetRowPressed: { backgroundColor: 'rgba(255,255,255,0.04)' /* theme-exempt: fixed press wash */ },
  sheetRowText: { fontFamily: FONT.medium, fontSize: FS.base, flex: 1 },
  sheetRowChevron: { marginLeft: 'auto' },
  sheetDivider: { height: 1, marginVertical: SP.xs },
});
