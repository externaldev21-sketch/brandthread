/**
 * Buyer's own profile — TikTok/Instagram/Threads-style layout (see the
 * Mobbin references cited in this change's PR description): a compact top
 * bar clear of the notch/Dynamic Island, a short cover strip, an overlapping
 * avatar, inline TikTok-style stats, one row of small actions, the Thread
 * Cash streak, and a content tab bar (Posts / Saved / Liked / Orders).
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, Animated, Share, Linking, Alert, ScrollView, Platform, Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
import { ProfileHeroMedia } from '@/components/profile/ProfileHeroMedia';
import { ProfileVideoTile, gridItemFromBuyerPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import {
  CoverCoachmarkSheet, CoverManageSheet, CoverTrimSheet, useProfileCover, type CoverMedia,
} from '@/components/profile/ProfileCover';
import { profileEmptyState, type ProfileEmptyTab } from '@/components/profile/profileEmptyStates';
import { useProfileLayout } from '@/components/profile/profileLayout';
import { ThreadCashStreakRow } from '@/components/thread-cash/ThreadCashStreakRow';
import { useCelebrateThreadCash } from '@/components/thread-cash/CelebrationHost';
import { isPreviewThreadCashEnabled, PREVIEW_THREAD_CASH_STATUS } from '@/lib/previewThreadCash';
import type { ThreadCashStreakState } from '@/lib/threadCashTypes';

const AVATAR = 88;
const AVATAR_OVERLAP = 36;
const COVER_HEIGHT = 160;
// Same reasoning as TabPageHeader: outside a real device (or a preview frame
// that emulates one) react-native-safe-area-context's web implementation
// reads 0 for insets.top, which used to push this bar's pills up into the
// Dynamic Island corner in the plain web preview.
const WEB_TOP_FALLBACK = 67;

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

// ─── Actions row ──────────────────────────────────────────────────────────────
function DarkActionButton({ label, onPress, testID, accessibilityHint }: {
  label: string;
  onPress: () => void;
  testID?: string;
  accessibilityHint?: string;
}) {
  return (
    <View style={actionStyles.wrap}>
      <PressableScale
        onPress={() => { hapticLight(); onPress(); }}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        testID={testID}
        style={actionStyles.button}
      >
        {(state) => (
          <>
            <InteractionLayer state={state as { pressed: boolean }} radius={8} theme={{ text: '#FFFFFF', accent: '#FFFFFF' } as AppThemePreset} />
            <Text style={actionStyles.buttonText} numberOfLines={1}>{label}</Text>
          </>
        )}
      </PressableScale>
    </View>
  );
}

function SquareIconButton({ icon, onPress, accessibilityLabel }: {
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <PressableScale
      onPress={() => { hapticLight(); onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={actionStyles.square}
    >
      {(state) => (
        <>
          <InteractionLayer state={state as { pressed: boolean }} radius={8} theme={{ text: '#FFFFFF', accent: '#FFFFFF' } as AppThemePreset} />
          <Feather name={icon} size={16} color="#FFFFFF" /* theme-exempt: fixed dark chip */ />
        </>
      )}
    </PressableScale>
  );
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function TikTokStatsRow({ stats, loading, theme }: { stats: ProfileStat[]; loading?: boolean; theme: AppThemePreset }) {
  return (
    <View style={statsStyles.row}>
      {stats.map((stat) => {
        const content = (
          <>
            <Text style={[statsStyles.value, { color: loading ? theme.subtle : theme.text }]} numberOfLines={1}>
              {loading ? '–' : stat.value}
            </Text>
            <Text style={[statsStyles.label, { color: theme.muted }]} numberOfLines={1}>{stat.label}</Text>
          </>
        );
        return stat.onPress ? (
          <PressableScale
            key={stat.key}
            style={statsStyles.cell}
            onPress={() => { hapticSelection(); stat.onPress?.(); }}
            accessibilityRole="button"
            accessibilityLabel={stat.accessibilityLabel ?? `${stat.value} ${stat.label}`}
            testID={`profile-stat-${stat.key}`}
          >
            {content}
          </PressableScale>
        ) : (
          <View
            key={stat.key}
            style={statsStyles.cell}
            accessible
            accessibilityLabel={stat.accessibilityLabel ?? `${stat.value} ${stat.label}`}
            testID={`profile-stat-${stat.key}`}
          >
            {content}
          </View>
        );
      })}
    </View>
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
  const layout = useProfileLayout();
  const threadCashEnabled = useFeatureFlag('threadCash');
  const celebrateThreadCash = useCelebrateThreadCash();
  // Clears the floating buyer tab bar.
  const listPadding = { paddingBottom: barInset + SP.lg };
  const savedColumns = layout.gridColumns >= 4 ? 3 : 2;
  const savedCellSize = Math.floor((layout.columnWidth - SP.md * 2) / savedColumns);
  const topPad = Platform.OS === 'web' ? WEB_TOP_FALLBACK : insets.top;

  const accountRef = useRef(user?.id);
  accountRef.current = user?.id;

  const [profile, setProfile] = useState<BuyerSocialProfile | null>(null);
  const [posts, setPosts] = useState<BuyerPost[]>([]);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [, setPrivacySettings] = useState<PrivacySettings | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Posts');
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
      setPosts(po.filter(x => !x.isArchived && !x.isDraft));
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
    let active = true;
    if (user?.id && threadCashEnabled) {
      void api.threadCash.get()
        .then(status => {
          if (!active) return;
          setThreadCashBalanceCents(Math.max(0, status.balanceCents));
          setThreadCashStreak(status.streak);
        })
        .catch(() => {
          // No live backend in the dev-web preview — fall back to seeded
          // preview data so the streak row isn't silently invisible there.
          if (!active || !isPreviewThreadCashEnabled()) return;
          setThreadCashBalanceCents(Math.max(0, PREVIEW_THREAD_CASH_STATUS.balanceCents));
          setThreadCashStreak(PREVIEW_THREAD_CASH_STATUS.streak);
        });
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
  const displayHandle = profile?.username
    ? `@${profile.username}`
    : (user?.username ? `@${user.username}` : '');
  // Real display name → @username → the generic fallback, in that order —
  // never the giant hardcoded "Your profile" title unless there's truly no
  // data yet to show.
  const displayName = profile?.name || clerkName || displayHandle || 'Your profile';

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

  const avatarInitials = profile?.avatarInitials
    || displayName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    || '•';

  // ── Per-tab rows ──
  const rows: ListRow[] = useMemo(() => {
    if (activeTab === 'Posts') return posts.map((post) => ({ kind: 'post' as const, post, item: gridItemFromBuyerPost(post) }));
    if (activeTab === 'Saved') return savedItems.map((saved) => ({ kind: 'saved' as const, saved }));
    if (activeTab === 'Orders') return myOrders.map((order) => ({ kind: 'order' as const, order }));
    // Liked has no backing data yet — a clean empty slot rather than
    // inventing engagement history.
    return [];
  }, [activeTab, posts, savedItems, myOrders]);

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
  const hasCover = coverFlow.hasCover;
  const coverAddLabel = coverFlow.busy === 'uploading'
    ? 'Uploading cover…'
    : coverFlow.busy === 'removing'
      ? 'Removing cover…'
      : hasCover ? 'Edit cover' : '+ Add cover video';

  const stats: ProfileStat[] = [
    {
      key: 'following', label: 'Following',
      value: formatProfileCount(socialCounts?.following ?? profile?.followingBrandsCount ?? 0),
      onPress: () => router.push(connectionsHref('following') as any),
    },
    {
      key: 'followers', label: 'Followers',
      value: formatProfileCount(socialCounts?.followers ?? profile?.friendsCount ?? 0),
      onPress: () => router.push(connectionsHref('followers') as any),
    },
    { key: 'posts', label: 'Posts', value: formatProfileCount(posts.length) },
  ];

  const header = (
    <View>
      {/* ── Top bar — always clear of the notch/Dynamic Island ── */}
      <View style={[styles.topBar, { paddingTop: topPad + 6 }]}>
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
              <Text style={[styles.topBarUsername, { color: theme.text }]} numberOfLines={1}>{displayHandle || displayName}</Text>
              <Feather name="chevron-down" size={16} color={theme.text} />
            </>
          )}
        </PressableScale>
        <View style={styles.topBarRight}>
          {threadCashEnabled ? (
            <CompactWalletChip
              balanceLabel={formatCents(threadCashBalanceCents)}
              onPress={() => router.push('/thread-cash' as never)}
              onLongPress={__DEV__ ? () => celebrateThreadCash({ amount: 500, from: 'Preview' }) : undefined}
              theme={theme}
            />
          ) : null}
          <TopBarIcon name="bell" onPress={() => router.push('/buyer-notifications' as any)} accessibilityLabel="Notifications" theme={theme} />
          <TopBarIcon name="menu" onPress={handleMenu} accessibilityLabel="More options" theme={theme} />
        </View>
      </View>

      {/* ── Cover — a subtle dark gradient when empty, never a placeholder squiggle ── */}
      <View style={styles.cover}>
        {hasCover ? (
          <ProfileHeroMedia videoUri={coverFlow.cover.videoUrl} posterUri={coverFlow.cover.posterUrl} active height={COVER_HEIGHT} />
        ) : (latestVideo?.mediaUrl || latestPhoto?.mediaUrl) ? (
          <ProfileHeroMedia videoUri={latestVideo?.mediaUrl ?? null} posterUri={latestPhoto?.mediaUrl ?? null} active={false} height={COVER_HEIGHT} posterOnly />
        ) : (
          <LinearGradient
            colors={['#2A2A2E', '#0B0B0D']} // theme-exempt: fixed monochrome empty-cover gradient
            style={StyleSheet.absoluteFill}
          />
        )}
        <PressableScale
          onPress={hasCover ? coverFlow.openManage : coverFlow.startAdd}
          disabled={!!coverFlow.busy}
          accessibilityRole="button"
          accessibilityLabel={coverAddLabel}
          accessibilityHint={hasCover ? 'Change or remove your profile cover video' : 'Pick or record a short video to play behind your profile'}
          testID="profile-cover-affordance"
          style={styles.coverAdd}
        >
          <Text style={styles.coverAddText} numberOfLines={1}>{coverAddLabel}</Text>
        </PressableScale>
      </View>

      {/* ── Identity — avatar overlapping the cover, real name, handle, tag, bio ── */}
      <View style={styles.identity}>
        <PressableScale
          onPress={() => { hapticSelection(); router.push('/buyer-story-create' as any); }}
          accessibilityRole="button"
          accessibilityLabel="Create a story"
          testID="profile-avatar"
          style={styles.avatarPress}
        >
          <View style={styles.avatarRing}>
            <View style={styles.avatar}>
              {avatarUri ? (
                <CachedImage source={{ uri: avatarUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Text style={[styles.avatarInitials, { color: theme.text }]}>{avatarInitials}</Text>
              )}
            </View>
            <View style={[styles.avatarBadge, { backgroundColor: theme.accent, borderColor: theme.background }]}>
              <Feather name="plus" size={12} color={theme.onAccent} />
            </View>
          </View>
        </PressableScale>

        <Text style={[styles.displayName, { color: theme.text }]} numberOfLines={2} accessibilityRole="header">{displayName}</Text>
        {displayHandle && displayHandle !== displayName ? (
          <Text style={[styles.handle, { color: theme.muted }]} numberOfLines={1}>{displayHandle}</Text>
        ) : null}
        <ProfileChip label="Buyer" icon="user" />

        <View style={styles.meta}>
          <ProfileMeta
            bio={profile?.bio}
            website={profile?.website}
            location={profile?.location}
            onOpenWebsite={(url) => { void Linking.openURL(url); }}
          />
        </View>
      </View>

      <TikTokStatsRow stats={stats} loading={loading} theme={theme} />

      {/* ── One action row: Edit profile / Share profile / Add friends ── */}
      <View style={styles.actionsRow}>
        <DarkActionButton label="Edit profile" onPress={() => router.push('/(buyer)/edit-profile')} />
        <DarkActionButton
          label="Share profile"
          onPress={handleShareProfile}
          accessibilityHint="Opens your shareable profile link and QR code"
        />
        <SquareIconButton icon="user-plus" onPress={() => router.push('/(buyer)/friends' as any)} accessibilityLabel="Add friends" />
      </View>

      {threadCashEnabled ? (
        <ThreadCashStreakRow streak={threadCashStreak} onPress={() => router.push('/thread-cash' as never)} />
      ) : null}

      <View style={styles.tabsBlock}>
        <ProfileTabs tabs={TAB_ITEMS} active={activeTab} onChange={handleTabPress} />
      </View>
    </View>
  );

  return (
    <View style={styles.root} testID="buyer-profile">
      <Animated.FlatList
        key={`buyer-${numColumns}`}
        data={loading ? [] : rows}
        renderItem={renderRow as any}
        keyExtractor={keyForRow as any}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? styles.gridRow : undefined}
        ListHeaderComponent={header}
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
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: listPadding.paddingBottom }}
        refreshing={refreshing}
        onRefresh={onRefresh}
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
    gridRow: { gap: 1 },

    topBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: SP.md, paddingBottom: SP.sm,
    },
    topBarLeft: {
      flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 32, maxWidth: '55%',
      borderRadius: RADIUS.sm, overflow: 'hidden',
    },
    topBarUsername: { fontFamily: FONT.semibold, fontSize: 17, flexShrink: 1 },
    topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },

    cover: { height: COVER_HEIGHT, overflow: 'hidden', backgroundColor: theme.card },
    coverAdd: { position: 'absolute', right: 12, bottom: 10 },
    coverAddText: {
      fontFamily: FONT.semibold, fontSize: 13, color: '#FFFFFF', // theme-exempt: legible over cover media
      textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
    },

    identity: { paddingHorizontal: SP.md, gap: 4 },
    avatarPress: { marginTop: -AVATAR_OVERLAP, alignSelf: 'flex-start', marginBottom: SP.sm },
    avatarRing: {
      width: AVATAR + 6, height: AVATAR + 6, borderRadius: (AVATAR + 6) / 2,
      borderWidth: 3, borderColor: '#000000', // theme-exempt: fixed black ring per spec
      padding: 3, backgroundColor: theme.background,
    },
    avatar: {
      width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, overflow: 'hidden',
      backgroundColor: theme.cardElevated, alignItems: 'center', justifyContent: 'center',
    },
    avatarInitials: { fontFamily: FONT.bold, fontSize: 28 },
    avatarBadge: {
      position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11,
      borderWidth: 2, alignItems: 'center', justifyContent: 'center',
    },
    displayName: { fontFamily: FONT.bold, fontSize: 22, letterSpacing: -0.4 },
    handle: { fontFamily: FONT.medium, fontSize: 14 },
    meta: { marginTop: SP.xs },

    actionsRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.sm, alignItems: 'center' },
    tabsBlock: { paddingTop: SP.sm },
  });
}

const statsStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: SP.lg, paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.sm },
  cell: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  value: { fontFamily: FONT.bold, fontSize: 17, fontVariant: ['tabular-nums'] },
  label: { fontFamily: FONT.medium, fontSize: 13 },
});

const topBarStyles = StyleSheet.create({
  walletChip: {
    height: 28, borderRadius: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center',
    gap: 4, paddingHorizontal: 8, overflow: 'hidden',
  },
  walletText: { fontFamily: FONT.bold, fontSize: FS.xs, fontVariant: ['tabular-nums'] },
  iconButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  iconBadge: { position: 'absolute', top: -2, right: -2, width: 9, height: 9, borderRadius: 5, borderWidth: 1.5 },
});

const actionStyles = StyleSheet.create({
  wrap: { flex: 1 },
  button: {
    height: 34, borderRadius: 8, backgroundColor: '#1f1f1f', // theme-exempt: fixed dark action per spec
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  buttonText: { fontFamily: FONT.semibold, fontSize: 14, color: '#FFFFFF' /* theme-exempt: fixed dark action */ },
  square: {
    width: 34, height: 34, borderRadius: 8, backgroundColor: '#1f1f1f', // theme-exempt: fixed dark action per spec
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
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
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md, minHeight: 50, paddingHorizontal: SP.xs, borderRadius: RADIUS.md },
  sheetRowText: { fontFamily: FONT.medium, fontSize: FS.base },
  sheetDivider: { height: 1, marginVertical: SP.xs },
});
