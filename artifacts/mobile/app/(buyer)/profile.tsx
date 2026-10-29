import { openContextMenu, anchorFromEvent, type MenuAnchor } from '@/lib/contextMenu';
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
 *  - Edit profile · Share profile · Discover people live only in the button
 *    row under the bio; the ••• sheet keeps the rest (Notifications, View as
 *    visitor, Orders, Closet, Tagged posts) — one control per action;
 *  - Story Highlights row (circles + "New");
 *  - the Thread Cash streak card;
 *  - icon-only tabs with an underline (Posts / Saved / Liked / Orders) over a
 *    3-column, 1pt-gutter, 4:5 grid.
 */
import { useProfileTabSwipe } from '@/components/profile/useProfileTabSwipe';
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStickyState } from '@/lib/stickyState';
import { getCachedTabData } from '@/lib/tabDataCache';
import {
  View, Text, StyleSheet, Animated, Share, Linking, Platform,
  useWindowDimensions, type LayoutChangeEvent, type FlatList,
} from 'react-native';
import { showAlert } from '@/lib/actionSheet';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useProfilePostsDefault } from '@/hooks/useProfilePostsDefault';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useFocusEffect, useRouter } from 'expo-router';
import { usePreloadedSceneEffect } from '@/hooks/usePreloadedSceneEffect';
import { useUser } from '@clerk/expo';
import { ProfileSongLine } from '@/components/profile/ProfileSongLine';
import { useProfileMusicEnabled } from '@/hooks/useProfileMusic';
import { PressableScale, EmptyState } from '@/components/BrandthreadUI';
import { haptics, hapticLight, hapticMedium, hapticSelection, hapticDestructiveConfirm } from '@/lib/haptics';
import { FONT, FS, SP, RADIUS, ICON, OVERLAY } from '@/lib/theme';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import {
  getMyProfile, getMyPosts, getSavedItems,
  getPrivacySettings, archivePost, deletePost,
  subscribeSocial, setPostPinned, pinErrorMessage,
} from '@/services/socialService';
import { Snackbar } from '@/components/ui/Snackbar';
import { useApi, type LikedPost } from '@/lib/api';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { formatCents } from '@/lib/money';
import { CachedImage } from '@/components/CachedImage';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { AccountSwitcherSheet } from '@/components/AccountSwitcherSheet';
import { loadBuyerProfile } from '@/lib/buyerProfile';
import { getBuyerOrdersWithStatus } from '@/services/orderService';
import { OrderStatusTimeline } from '@/components/orders/OrderStatusTimeline';
import type { BuyerOrderView } from '@/services/orderTypes';
import type {
  BuyerSocialProfile, BuyerPost, SavedItem, PrivacySettings,
} from '@/services/socialTypes';
import { followingCountAfter, subscribeProfileEvents } from '@/lib/profileEvents';
import { connectionsHref, profileVideosHref } from '@/lib/profileNavigation';
import { formatCompactCount } from '@/lib/compactFormat';
import { ProfileMeta } from '@/components/profile/ProfileShell';
import { ProfileChip, ProfileTabs, type ProfileStat, type ProfileTab } from '@/components/profile/ProfileControls';
import { ProfileAccountSwitcher, ProfileTopBarIcon, ProfileTopBarIconRow } from '@/components/profile/ProfileTopBar';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { ProfileVideoHeader, useHeroPosterOnly } from '@/components/profile/ProfileVideoHeader';
import { Button } from '@/components/ui/Button';
import { ProfileStoryAvatar } from '@/components/profile/ProfileStoryAvatar';
import { ProfileBannerHeader } from '@/components/profile/ProfileBannerHeader';
import { bannerCoversStatusBar, bannerHeight, resolveProfileBanner, type ProfileBanner } from '@/components/profile/profileBannerRules';
import { useProfileBannerState } from '@/components/profile/useProfileBanner';
import { useProfileNote } from '@/components/profile/useProfileNote';
import { useProfileBanner } from '@/components/profile/ProfileBannerEditor';
import { activeStoryIds } from '@/components/profile/profileAvatarGeometry';
import { ProfileStoriesRow, type ProfileStoryItem } from '@/components/profile/ProfileStoriesRow';
import { ProfileBrandsRow } from '@/components/profile/ProfileBrandsRow';
import { useProfileBrands } from '@/hooks/useProfileBrands';
import { loadHighlights, type Highlight } from '@/lib/highlightsService';
import { ProfileVideoTile, gridItemFromBuyerPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { ProfileEmptyAreaContext } from '@/components/profile/ProfileEmptyAreaContext';
import {
  CoverCoachmarkSheet, CoverManageSheet, CoverTrimSheet, useProfileCover, type CoverMedia,
} from '@/components/profile/ProfileCover';
import { profileEmptyState, computeEmptyArea, type ProfileEmptyTab } from '@/components/profile/profileEmptyStates';
import { TILE_ASPECT_3_4, useProfileLayout } from '@/components/profile/profileLayout';
import { ThreadCashStreakRow } from '@/components/thread-cash/ThreadCashStreakRow';
import { useCelebrateThreadCash } from '@/components/thread-cash/CelebrationHost';
import { isPreviewThreadCashEnabled, getPreviewThreadCashStatus } from '@/lib/previewThreadCash';
import type { ThreadCashStreakState } from '@/lib/threadCashTypes';
import { getPreviewSocialCounts } from '@/lib/previewSocialCounts';
import { isBuyerDevPreview, isPreviewDemoMode } from '@/lib/devPreview';
import { getDemoLikedPosts } from '@/components/profile/previewProfileDemo';
import type { DiscoverPost } from '@/lib/discoverFeed';
import { profileCapabilities, viewAsVisitorHref } from '@/lib/profileAccess';
import { ProfileMenuSheet, type ProfileMenuItem } from '@/components/profile/ProfileMenuSheet';
import { buyerOwnMenuItems } from '@/components/profile/buyerProfileMenu';
import { MenuSheet } from '@/components/ui/MenuSheet';
import { useTaggedPosts } from '@/components/profile/useTaggedPosts';
import { useRepostedPosts } from '@/components/profile/useRepostedPosts';
import { ProfileStickyHeader, PROFILE_STICKY_HEADER_HEIGHT } from '@/components/profile/ProfileStickyHeader';
import { taggedItemHref } from '@/services/profileService';
import { radius } from '@/constants/radii';
import { subscribeThreadCashChanged } from '@/lib/threadCashEvents';
import { useScreenInteractive } from '@/lib/perf';
import { updateBuyerCashWidget } from '@/lib/nativeSystem';
import { getClosetOutfits, getClosetPieces, type ClosetOutfit, type ClosetPiece } from '@/services/closetService';
import { ClosetEmpty, ClosetOutfitTile, ClosetPieceTile, ClosetSubBar, PieceEditionLine, type ClosetView } from '@/components/closet/ClosetViews';
import { ClosetProofCard } from '@/components/closet/ClosetProofCard';
import { WrappedProfileCard } from '@/components/closet/WrappedProfileCard';

// Realistic identity shown only when there is truly no signed-in user at all
// (the dev `?bt_preview=buyer` bypass skips Clerk entirely) — a real,
// authenticated user always has at least a Clerk username, so this never
// fires in production and the screen never falls back to a generic
// "Your profile" placeholder.
const PREVIEW_NAME = 'Ava Buyer';
const PREVIEW_HANDLE = '@ava';

const TABS = ['Posts', 'Reposts', 'Saved', 'Liked'] as const;
// Existing Closet, Tagged and Orders views remain reachable outside the tab strip.
type Tab = typeof TABS[number] | 'Closet' | 'Tagged' | 'Orders';

const TAB_ITEMS: ProfileTab[] = [
  { key: 'Posts', label: 'Posts', icon: 'grid' },
  { key: 'Reposts', label: 'Reposts', icon: 'repeat' },
  { key: 'Saved', label: 'Saved', icon: 'bookmark' },
  { key: 'Liked', label: 'Liked', icon: 'heart' },
];

function savedTypeIcon(type: string): IconName {
  if (type === 'post') return 'bookmark';
  if (type === 'product') return 'shopping-bag';
  if (type === 'collection') return 'folder';
  return 'home';
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
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Thread Cash wallet, ${balanceLabel}`}
      testID="profile-wallet-chip"
      hitSlop={4}
      style={[topBarStyles.walletChip, { backgroundColor: theme.cardGlass, borderColor: theme.border }]}
    >
      <Icon name="credit-card" size={16} color={theme.text} />
      <Text style={[topBarStyles.walletText, { color: theme.text }]} numberOfLines={1}>{balanceLabel}</Text>
    </PressableScale>
  );
}

// The plain (no circle background) icon button and the plain-text account
// switcher live in ProfileTopBar.tsx, shared with the seller own-profile
// screen so the two headers stay pixel-identical.

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
          <Icon name={savedTypeIcon(item.type)} size={ICON.md} color={item.accentColor || theme.accent} />
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
          <Icon name="shopping-bag" size={ICON.md} color={theme.muted} />
        </View>
      )}
      <View style={cellStyles.orderCardBody}>
        <Text style={[cellStyles.orderCardSeller, { color: theme.text }]} numberOfLines={1}>{order.sellerName}</Text>
        <Text style={[cellStyles.orderCardMeta, { color: theme.muted }]} numberOfLines={1}>
          {order.orderNumber} · {order.lineItems.length} item{order.lineItems.length === 1 ? '' : 's'}
        </Text>
        <OrderStatusTimeline status={order.status} compact />
      </View>
      <Icon name="chevron-right" size={ICON.sm} color={theme.muted} />
    </PressableScale>
  );
});

const DraftsFolderTile = React.memo(function DraftsFolderTile({
  count, width, height, theme, onPress,
}: {
  count: number; width: number; height: number; theme: AppThemePreset; onPress: () => void;
}) {
  return (
    <View style={{ width, marginBottom: 1 }}>
      <PressableScale
        onPress={onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Drafts, ${count} saved`}
        testID="buyer-profile-drafts-tile"
        style={[cellStyles.draftsTile, { width, height, backgroundColor: theme.cardElevated, borderColor: theme.border }]}
      >
        <Icon name="file-text" size={ICON.md} color={theme.muted} />
        <Text style={[cellStyles.draftsTitle, { color: theme.text }]}>Drafts</Text>
        <Text style={[cellStyles.draftsCount, { color: theme.muted }]}>{count}</Text>
      </PressableScale>
    </View>
  );
});

type ListRow =
  | { kind: 'post'; item: ProfileGridItem; post: BuyerPost }
  | { kind: 'tagged'; item: ProfileGridItem; authorId: string; authorName: string | null; source: 'post' | 'story' }
  | { kind: 'saved'; saved: SavedItem }
  | { kind: 'liked'; item: ProfileGridItem; liked: LikedPost }
  | { kind: 'order'; order: BuyerOrderView }
  | { kind: 'closetPiece'; piece: ClosetPiece }
  | { kind: 'closetOutfit'; outfit: ClosetOutfit }
  // Instagram-style folder tile — first cell of the Posts grid, only when
  // there's at least one draft. Opens the drafts list; does not filter the
  // grid in place (there is no second tab/pill row on this screen anymore).
  | { kind: 'draftsTile'; count: number };

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const barInset = useBuyerTabBarInset();
  const router  = useRouter();
  const { user } = useUser();
  const profileMusicOn = useProfileMusicEnabled();
  const api     = useApi();
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  // Instagram's own-profile grid: 3 columns, 1pt gutters, 4:5 tiles.
  const layout = useProfileLayout({ tileAspect: TILE_ASPECT_3_4 });
  const heroPosterOnly = useHeroPosterOnly();
  const threadCashEnabled = useFeatureFlag('threadCash');
  const celebrateThreadCash = useCelebrateThreadCash();
  const { height: winHeight } = useWindowDimensions();
  // Clears the floating buyer tab bar.
  const listPadding = { paddingBottom: barInset + SP.lg };
  const savedColumns = layout.gridColumns >= 4 ? 3 : 2;
  const savedCellSize = Math.floor((layout.columnWidth - SP.md * 2) / savedColumns);
  const topPad = useHeaderTopInset();

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
  const profileLoadedRef = useRef(false);

  // Sticky (memory-only, account-scoped — lib/stickyState.ts): a remount
  // or revisit paints the last-known profile on frame one instead of a
  // skeleton, and late-arriving rows (streak, cover, counts) are already in
  // place rather than pushing the grid down when they land.
  const [profile, setProfile, hadProfile] = useStickyState<BuyerSocialProfile | null>('buyerProfile:profile', null);
  const [posts, setPosts] = useStickyState<BuyerPost[]>('buyerProfile:posts', []);
  const [savedItems, setSavedItems] = useStickyState<SavedItem[]>('buyerProfile:saved', []);
  const [, setPrivacySettings] = useState<PrivacySettings | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Posts');
  useProfilePostsDefault(setActiveTab, user?.id);
  const [refreshing, setRefreshing] = useState(false);
  const [avatarUri, setAvatarUri] = useStickyState<string | null>('buyerProfile:avatarUri', null);
  // Set only when the buyer has a moving profile picture — the poster frame
  // above (`avatarUri`) always stays in sync too, so every OTHER screen that
  // just shows a static avatar (feed, chat, calls) never needs to know this
  // exists; only the profile header plays it.
  const [avatarVideoUri, setAvatarVideoUri] = useStickyState<string | null>('buyerProfile:avatarVideoUri', null);
  const [myOrders, setMyOrders] = useStickyState<BuyerOrderView[]>('buyerProfile:orders', []);
  const [closetPieces, setClosetPieces] = useState<ClosetPiece[]>([]);
  const [closetOutfits, setClosetOutfits] = useState<ClosetOutfit[]>([]);
  const [closetView, setClosetView] = useState<ClosetView>('pieces');
  const [proofPiece, setProofPiece] = useState<ClosetPiece | null>(null);
  const [loading, setLoading] = useState(!hadProfile);
  useScreenInteractive('profile', !loading);
  if (hadProfile && profile) profileLoadedRef.current = true;
  const [loadError, setLoadError] = useState(false);
  // First visit seeds from the app-start warmer (lib/appStartPrefetch.ts's
  // 'threadCash' entry) so the streak row is in place on frame one rather
  // than popping in above the tabs and grid.
  const [threadCashBalanceCents, setThreadCashBalanceCents] = useStickyState(
    'buyerProfile:threadCashBalance',
    () => Math.max(0, getCachedTabData<{ balanceCents?: number }>('threadCash')?.balanceCents ?? 0),
  );
  const [threadCashStreak, setThreadCashStreak] = useStickyState<ThreadCashStreakState | null>(
    'buyerProfile:threadCashStreak',
    () => {
      const streak = getCachedTabData<{ streak?: ThreadCashStreakState }>('threadCash')?.streak;
      return streak && streak.currentStreak > 0 ? streak : null;
    },
  );
  // Live follower/following counts from the server (the locally cached
  // profile counts went stale after every follow).
  const [socialCounts, setSocialCounts] = useStickyState<{ followers: number; following: number } | null>('buyerProfile:socialCounts', null);
  const [serverCover, setServerCover] = useStickyState<CoverMedia>('buyerProfile:cover', { videoUrl: null, posterUrl: null });
  const [myStoryIds, setMyStoryIds] = useStickyState<string[]>('buyerProfile:storyIds', []);
  const [highlights, setHighlights] = useStickyState<Highlight[]>('buyerProfile:highlights', []);
  // The profile video only decodes while this tab is focused AND the video
  // layer is still on screen (paused once it scrolls away).
  const [focused, setFocused] = useState(true);
  const [heroHeight, setHeroHeight] = useState(0);
  const [heroOnScreen, setHeroOnScreen] = useState(true);
  const coverFlow = useProfileCover({ own: true, cover: serverCover, userId: user?.id });
  // TikTok-style banner (image or looping video): replaces the header when set.
  const [serverBanner, setServerBanner] = useState<ProfileBanner | null>(null);
  const banner = useProfileBannerState({ server: serverBanner, ownerId: user?.id, own: true });
  const bannerNote = useProfileNote({
    userId: user?.id,
    own: true,
    enabled: true,
    onCompose: () => router.push('/(buyer)/inbox' as any),
  });
  // Existing covers keep the banner flow. Without one, use the approved
  // compact profile header; adding a banner stays available in Edit profile.
  const bannerFlow = useProfileBanner({ banner, userId: user?.id });
  const { height: windowHeight } = useWindowDimensions();
  const bannerH = bannerHeight(windowHeight);
  useEffect(() => { setHeroHeight(bannerH); }, [bannerH]);
  const profileBrands = useProfileBrands(user?.id, true);

  // Sheets
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  // Owner mode: private saved / liked / orders / Thread Cash are this screen's alone.
  const caps = profileCapabilities('buyer', 'owner');
  const tagged = useTaggedPosts(user?.id, activeTab === 'Tagged' && !!user?.id && !isBuyerDevPreview());
  const reposts = useRepostedPosts(user?.id, activeTab === 'Reposts' && !!user?.id && !isBuyerDevPreview());
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [postSheet, setPostSheet] = useState<BuyerPost | null>(null);
  const [pinSnackbar, setPinSnackbar] = useState('');
  // Liked tab (GET /api/social/me/liked-posts, newest like first). Loaded the
  // first time the tab opens, then paged on scroll via `nextCursor`.
  const [likedPosts, setLikedPosts] = useState<LikedPost[]>([]);
  const [likedCursor, setLikedCursor] = useState<string | null>(null);
  const [likedLoading, setLikedLoading] = useState(false);
  const [likedError, setLikedError] = useState(false);
  const [likedLoaded, setLikedLoaded] = useState(false);
  // demo=1 only: the seeded liked posts in Discover shape, for the feed player.
  const [demoLikedDiscover, setDemoLikedDiscover] = useState<DiscoverPost[]>([]);
  const likedRequestRef = useRef(0);

  const loadCounts = useCallback(async () => {
    const id = user?.id;
    // isBuyerDevPreview() (not just !id): a stubbed/fake-signed-in Clerk
    // session (this app's own audit/e2e harnesses fake a signed-in user so
    // protected screens render at all) still reports a truthy id, which
    // would otherwise fall through to the real backend-less endpoint below
    // and log a console 404 — see the identical fix in app/seller-inbox.tsx.
    if (id && isBuyerDevPreview()) {
      // demo=1 only: counts consistent with the seeded Activity/Friends data.
      const previewCounts = await getPreviewSocialCounts();
      if (previewCounts && accountRef.current === id) setSocialCounts(previewCounts);
    }
    if (!id || isBuyerDevPreview()) return;
    try {
      const data = await api.social.profile(id);
      if (accountRef.current !== id || !data) return;
      setSocialCounts({ followers: Number(data.followersCount ?? 0), following: Number(data.followingCount ?? 0) });
      setServerCover({ videoUrl: (data as any).coverVideoUrl ?? null, posterUrl: (data as any).coverPosterUrl ?? null });
      setServerBanner(resolveProfileBanner(data as any));
    } catch { /* keep the last known counts */ }
  }, [api, user?.id]);

  const loadLiked = useCallback(async (mode: 'first' | 'more' = 'first') => {
    const id = user?.id;
    if (mode === 'more' && (!likedCursor || likedLoading)) return;
    const request = ++likedRequestRef.current;
    setLikedLoading(true);
    if (mode === 'first') setLikedError(false);
    try {
      if (isBuyerDevPreview()) {
        // No backend in the preview: demo=1 shows the seeded Discover cast's
        // posts; a fresh preview stays an honest empty Liked tab.
        const demo = await getDemoLikedPosts();
        if (request !== likedRequestRef.current) return;
        setLikedPosts(demo?.posts ?? []);
        setDemoLikedDiscover(demo?.discover ?? []);
        setLikedCursor(null);
        return;
      }
      if (!id) { setLikedPosts([]); setLikedCursor(null); return; }
      const page = await api.social.likedPosts({ cursor: mode === 'more' ? likedCursor ?? undefined : undefined, limit: 30 });
      if (request !== likedRequestRef.current || accountRef.current !== id) return;
      const next = Array.isArray(page?.posts) ? page.posts : [];
      setLikedPosts((prev) => {
        if (mode === 'first') return next;
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...next.filter((p) => !seen.has(p.id))];
      });
      setLikedCursor(page?.nextCursor ?? null);
    } catch {
      if (request === likedRequestRef.current && mode === 'first') setLikedError(true);
    } finally {
      if (request === likedRequestRef.current) {
        setLikedLoading(false);
        setLikedLoaded(true);
      }
    }
  }, [api, likedCursor, likedLoading, user?.id]);

  // Opening Liked (or switching accounts while on it) loads the first page;
  // pull-to-refresh reloads it too (onRefresh below).
  const loadLikedRef = useRef(loadLiked);
  loadLikedRef.current = loadLiked;
  useEffect(() => {
    if (activeTab === 'Liked') void loadLikedRef.current('first');
  }, [activeTab, user?.id]);

  // The closet is its own request so a slow closet never holds up the profile.
  const loadCloset = useCallback(async () => {
    const id = user?.id;
    const [pieces, outfits] = await Promise.all([
      getClosetPieces().catch(() => null),
      getClosetOutfits().catch(() => null),
    ]);
    if (accountRef.current !== id) return;
    if (pieces) setClosetPieces(pieces);
    if (outfits) setClosetOutfits(outfits);
  }, [user?.id]);

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
    // getSavedItems() and getBuyerOrdersWithStatus() are real, backend-less-
    // in-preview network calls with no preview branch of their own (unlike
    // getMyProfile/getPrivacySettings/loadBuyerProfile, which only ever read
    // local storage, and getMyPosts, which already checks isBuyerDevPreview()
    // internally) — skip them here in dev-preview (including a Clerk-
    // stubbed audit/e2e session, which still reports a truthy user.id) so
    // they never log a console 404, same as app/seller-inbox.tsx's fix.
    const devPreview = isBuyerDevPreview();
    try {
      const [p, po, sv, pr, bp, ordersResult] = await Promise.all([
        getMyProfile(),
        getMyPosts(),
        devPreview ? Promise.resolve([]) : getSavedItems(),
        getPrivacySettings(),
        loadBuyerProfile(),
        devPreview
          ? Promise.resolve({ orders: [] as BuyerOrderView[], fromCache: true })
          : getBuyerOrdersWithStatus(user.id).catch(() => ({ orders: [] as BuyerOrderView[], fromCache: true })),
      ]);
      if (accountRef.current !== user?.id) return;
      setProfile(p);
      setPosts(po.filter(x => !x.isArchived));
      setSavedItems(sv);
      setPrivacySettings(pr);
      setAvatarUri(bp.avatarUri || null);
      setAvatarVideoUri(bp.avatarVideoUri || null);
      setMyOrders(ordersResult.orders);
      void loadCloset();
      profileLoadedRef.current = true;
    } catch (error) {
      // A failed background refresh keeps what's already on screen; only a
      // first load with nothing to show falls back to the error state.
      if (!profileLoadedRef.current) {
        setLoadError(true);
        setProfile(null);
        setPosts([]);
        setSavedItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [api, loadCloset, loadCounts, user?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadData(), activeTab === 'Liked' ? loadLikedRef.current('first') : Promise.resolve()]);
    } finally { setRefreshing(false); }
  }, [activeTab, loadData]);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));
  // Pre-mounted by the tab preloader: load now so the first visit paints data.
  usePreloadedSceneEffect(() => { void loadData(); });

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  // Accent story ring: the same "unexpired story" rule the seller profile
  // uses (api.social.myStories() filtered by expiresAt > now).
  useFocusEffect(useCallback(() => {
    let alive = true;
    if (user?.id && !isBuyerDevPreview()) {
      api.social.myStories()
        .then((rows) => { if (alive) setMyStoryIds(activeStoryIds(rows)); })
        .catch(() => { /* no ring rather than a wrong one */ });
    }
    loadHighlights().then((items) => { if (alive) setHighlights(items); }).catch(() => {});
    return () => { alive = false; };
  }, [api, user?.id]));

  // Posts/Saved use a different `numColumns` than Liked/Orders (FlatList
  // can't change numColumns on a live instance, so the grid tabs force a
  // `key` change below — a real remount). A remounted FlatList always
  // starts at offset 0, which read as the whole profile "jumping to the
  // top" on exactly those two tabs while Liked<->Orders (same numColumns,
  // no remount) stayed put. Tracking the live offset here and handing it
  // back to the next instance via an imperative `scrollToOffset` right
  // after it mounts makes every tab switch behave like Instagram's: the
  // scroll position itself never moves, only the content below the tab bar
  // changes. (react-native-web's ScrollView never reads a `contentOffset`
  // prop at all — it's a native-only mount option — so the restore has to
  // be imperative to actually work on web, which is where this ships.)
  const scrollYRef = useRef(0);
  const listRef = useRef<FlatList<ListRow> | null>(null);
  // Banner mode: at rest at the top, the banner runs up behind the status bar.
  const [bannerCoversTop, setBannerCoversTop] = useState(true);
  const [profileStickyVisible, setProfileStickyVisible] = useState(false);
  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number } } }) => {
    scrollYRef.current = event.nativeEvent.contentOffset.y;
    setProfileStickyVisible(event.nativeEvent.contentOffset.y > topPad + PROFILE_STICKY_HEADER_HEIGHT);
    const next = event.nativeEvent.contentOffset.y < Math.max(heroHeight, 1);
    setHeroOnScreen((prev) => (prev === next ? prev : next));
    const covers = bannerCoversStatusBar(event.nativeEvent.contentOffset.y);
    setBannerCoversTop((prev) => (prev === covers ? prev : covers));
  }, [heroHeight, topPad]);

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
      if (!active || !isPreviewThreadCashEnabled() || !isPreviewDemoMode()) return;
      const status = getPreviewThreadCashStatus();
      setThreadCashBalanceCents(Math.max(0, status.balanceCents));
      setThreadCashStreak(status.streak);
    };

    // isBuyerDevPreview() (not just !user?.id): a stubbed/fake-signed-in
    // Clerk session (this app's own audit/e2e harnesses fake a signed-in
    // user so protected screens render at all) still reports a truthy
    // user.id, which would otherwise fall through to the real backend-less
    // endpoint below and log a console 404.
    if (!user?.id || isBuyerDevPreview()) {
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
        // Home Screen Thread Cash widget — real balance + streak only.
        updateBuyerCashWidget({
          balanceCents: Math.max(0, status?.balanceCents ?? 0),
          streakDays: Math.max(0, status?.streak?.currentStreak ?? 0),
        });
        if (status?.streak && status.streak.currentStreak > 0) {
          setThreadCashStreak(status.streak);
        } else {
          applyPreviewFallback();
        }
      })
      .catch(applyPreviewFallback);

    return () => { active = false; };
  }, [api, threadCashEnabled, user?.id]));

  // Thread Cash received (or spent elsewhere) while the profile is open: the
  // balance chip refetches instead of waiting for the next focus.
  useEffect(() => {
    if (!threadCashEnabled || !user?.id || isBuyerDevPreview()) return;
    return subscribeThreadCashChanged(() => {
      void api.threadCash.get()
        .then(status => setThreadCashBalanceCents(Math.max(0, status?.balanceCents ?? 0)))
        .catch(() => {});
    });
  }, [api, threadCashEnabled, user?.id]);

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
      ? { ...counts, following: followingCountAfter(counts.following, event) }
      : counts);
  }), [user?.id]);

  // ── Menu actions ──
  // The hamburger opens "Settings and activity" (app/buyer-settings.tsx), a
  // full-screen pushed page instead of a bottom sheet — the old translucent
  // sheet had no backdrop dim and no reliable way to close.
  const handleMenu = () => {
    router.push('/buyer-settings' as any);
  };

  const handleShareProfile = () => {
    setShareSheetOpen(true);
  };

  const handleTabPress = useCallback((tab: string) => {
    setActiveTab(tab as Tab);
  }, []);
  // Swipe the grid between tabs, underline tracking the finger (pack 2, item 31).
  const { width: tabSwipeWidth } = useWindowDimensions();
  const tabSwipe = useProfileTabSwipe({
    keys: TAB_ITEMS.map((t) => t.key),
    active: activeTab,
    onChange: handleTabPress,
    width: tabSwipeWidth,
  });

  const handleClosetPiecePress = useCallback((piece: ClosetPiece) => {
    // A numbered piece opens its proof card; everything else its product page.
    if (piece.edition) { hapticSelection(); setProofPiece(piece); return; }
    if (!piece.productId) return;
    hapticSelection();
    router.push(`/buyer-product-detail?productId=${encodeURIComponent(piece.productId)}` as never);
  }, [router]);

  const handleNewOutfit = useCallback(() => {
    hapticSelection();
    router.push('/closet-outfit' as never);
  }, [router]);

  const handleOrdersPress = useCallback((order: BuyerOrderView) => {
    router.push(`/buyer-order-detail?id=${order.id}` as never);
  }, [router]);

  // ── Post sheet ──
  const handleArchivePost = async (target?: BuyerPost) => {
    const post = target ?? postSheet;
    if (!post) return;
    setPostSheet(null);
    setPosts(prev => prev.filter(item => item.id !== post.id));
    try { await archivePost(post.id); await loadData(); } catch { setPosts(prev => [...prev, post]); showAlert('Could not archive post', 'Try again.'); }
  };

  // Instagram "Pin to your profile" / "Unpin from profile" (max 3, pinned first).
  const handleTogglePin = async () => {
    const post = postSheet;
    setPostSheet(null);
    if (!post) return;
    const pin = !post.pinnedAt;
    try {
      const result = await setPostPinned(post.id, pin);
      if (!result) return;
      setPinSnackbar(pin ? 'Pinned to your profile' : 'Unpinned from profile');
      await loadData();
    } catch (error) {
      showAlert(pin ? 'Couldn’t pin post' : 'Couldn’t unpin post', pinErrorMessage(error));
    }
  };

  const handleDeletePost = (target?: BuyerPost) => {
    const post = target ?? postSheet;
    if (!post) return;
    setPostSheet(null);
    showAlert("Delete this post? This can't be undone.", undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          haptics.warning();
          setPosts(prev => prev.filter(item => item.id !== post.id));
          try { await deletePost(post.id); await loadData(); } catch { setPosts(prev => [...prev, post]); showAlert("Couldn't delete post", 'Try again.'); }
        },
      },
    ]);
  };

  const handleShareCurrentPost = async (target?: BuyerPost) => {
    const post = target ?? postSheet;
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

  // Long-press a tile: the Instagram grid preview menu (the post enlarged
  // over a blurred screen, actions under it); the sheet is the fallback.
  const postLongPressRef = useRef<(item: ProfileGridItem) => void>(() => {});
  postLongPressRef.current = (item: ProfileGridItem) => {
    const post = posts.find((candidate) => candidate.id === item.id);
    if (!post) return;
    const opened = openContextMenu({
      preview: {
        imageUri: item.posterUri,
        aspectRatio: item.kind === 'video' ? 9 / 16 : 4 / 5,
        title: profile?.username ? `@${profile.username}` : undefined,
        subtitle: post.caption || undefined,
      },
      onPreviewPress: () => postTapRef.current(item),
      items: [
        { key: 'share', label: 'Share', icon: 'share', onPress: () => { void handleShareCurrentPost(post); } },
        { key: 'archive', label: 'Archive', icon: 'archive', onPress: () => { void handleArchivePost(post); } },
        { key: 'delete', label: 'Delete', icon: 'trash-2', destructive: true, onPress: () => handleDeletePost(post) },
      ],
    });
    if (!opened) setPostSheet(post);
  };
  const handlePostLongPress = useCallback((item: ProfileGridItem) => postLongPressRef.current(item), []);

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
    router.push(profileVideosHref({ source: 'creator', id: user.id, startPostId: item.id, title: displayName }) as never);
  }, [displayName, router, user?.id]);
  const postTapRef = useRef(handlePostTap);
  postTapRef.current = handlePostTap;

  // A saved cell opens the thing that was saved (same destinations as the
  // full Saved list, app/buyer-saved.tsx), not the generic list.
  const handleSavedTap = useCallback((item: SavedItem) => {
    const id = encodeURIComponent(item.targetId);
    if (item.type === 'post') router.push(`/buyer-post-viewer?postId=${id}` as never);
    else if (item.type === 'product') router.push(`/thread-product-detail?productId=${id}&productName=${encodeURIComponent(item.title)}` as never);
    else if (item.type === 'store') router.push(`/seller-profile?sellerId=${id}` as never);
    else if (item.type === 'collection') router.push(`/buyer-collection?collectionId=${id}` as never);
    else router.push('/buyer-saved' as never);
  }, [router]);

  // A liked post opens in the post viewer; demo posts (no backend row) open
  // the feed player on the seeded set instead.
  const handleLikedTap = useCallback((item: ProfileGridItem) => {
    const demoIndex = demoLikedDiscover.findIndex((p) => p.id === item.id);
    if (demoIndex >= 0) {
      void import('@/lib/discoverPlayerQueue').then(({ setDiscoverPlayerQueue }) => {
        const token = setDiscoverPlayerQueue(demoLikedDiscover, demoIndex);
        router.push(`/discover-player?q=${encodeURIComponent(token)}` as never);
      });
      return;
    }
    router.push(`/buyer-post-viewer?postId=${encodeURIComponent(item.id)}` as never);
  }, [demoLikedDiscover, router]);

  const handleDraftsTilePress = useCallback(() => {
    router.push('/buyer-drafts' as never);
  }, [router]);

  const avatarInitials = profile?.avatarInitials
    || displayName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    || '•';

  // ── Per-tab rows ──
  const rows: ListRow[] = useMemo(() => {
    if (activeTab === 'Posts') {
      const published = posts.filter(p => !p.isDraft);
      const draftsCount = posts.filter(p => p.isDraft).length;
      const publishedRows: ListRow[] = published.map((post) => ({ kind: 'post' as const, post, item: gridItemFromBuyerPost(post) }));
      return draftsCount > 0 ? [{ kind: 'draftsTile' as const, count: draftsCount }, ...publishedRows] : publishedRows;
    }
    if (activeTab === 'Tagged' || activeTab === 'Reposts') {
      return (activeTab === 'Reposts' ? reposts.items : tagged.items).map((entry) => ({
        kind: 'tagged' as const,
        source: entry.source,
        authorId: entry.authorId,
        authorName: entry.authorName,
        item: {
          id: entry.id,
          kind: entry.mediaType === 'video' ? 'video' as const : entry.mediaType === 'slideshow' ? 'slideshow' as const : 'photo' as const,
          posterUri: entry.posterUri,
          caption: entry.caption ?? '',
          productCount: 0,
        },
      }));
    }
    if (activeTab === 'Saved') return savedItems.map((saved) => ({ kind: 'saved' as const, saved }));
    if (activeTab === 'Orders') return myOrders.map((order) => ({ kind: 'order' as const, order }));
    if (activeTab === 'Closet') {
      return closetView === 'outfits'
        ? closetOutfits.map((outfit) => ({ kind: 'closetOutfit' as const, outfit }))
        : closetPieces.map((piece) => ({ kind: 'closetPiece' as const, piece }));
    }
    // Liked: posts this buyer has liked, newest like first.
    return likedPosts.map((liked) => ({
      kind: 'liked' as const,
      liked,
      item: {
        id: liked.id,
        kind: liked.mediaType === 'video' ? 'video' as const : 'photo' as const,
        posterUri: liked.thumbnailUri ?? (liked.mediaType === 'image' ? liked.mediaUris[0] ?? null : null),
        caption: liked.caption ?? '',
        productCount: 0,
        slideCount: liked.mediaUris.length > 1 ? liked.mediaUris.length : undefined,
      },
    }));
  }, [activeTab, posts, savedItems, myOrders, tagged.items, reposts.items, likedPosts, closetView, closetPieces, closetOutfits]);

  const closetOutfitColumns = 2;
  const closetOutfitWidth = Math.floor((layout.columnWidth - (closetOutfitColumns - 1)) / closetOutfitColumns);
  const numColumns = activeTab === 'Posts' || activeTab === 'Tagged' || activeTab === 'Reposts' || activeTab === 'Liked' ? layout.gridColumns
    : activeTab === 'Closet' ? (closetView === 'outfits' ? closetOutfitColumns : layout.gridColumns)
    : activeTab === 'Saved' ? savedColumns : 1;

  // Posts/Saved force the FlatList above to remount (new `key`, since a
  // live FlatList can't change numColumns) — restore the offset it had
  // right before the remount so the switch never visibly scrolls, matching
  // Liked<->Orders (same numColumns, no remount, already stayed put).
  useEffect(() => {
    // Guarded rather than a bare requestAnimationFrame call: not defined in
    // the vitest/node test environment this screen's own tests run under.
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 0) as unknown as number;
    const caf = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
    const frame = raf(() => {
      listRef.current?.scrollToOffset({ offset: scrollYRef.current, animated: false });
    });
    return () => caf(frame);
  }, [numColumns]);

  const renderRow = useCallback(({ item, index }: { item: ListRow; index: number }) => {
    if (item.kind === 'draftsTile') {
      return (
        <DraftsFolderTile
          count={item.count}
          width={layout.tileWidth}
          height={layout.tileHeight}
          theme={theme}
          onPress={handleDraftsTilePress}
        />
      );
    }
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
    if (item.kind === 'tagged') {
      return (
        <ProfileVideoTile
          item={item.item}
          index={index}
          width={layout.tileWidth}
          height={layout.tileHeight}
          onPress={() => {
            router.push(taggedItemHref({ id: item.item.id, source: item.source, authorId: item.authorId, authorName: item.authorName }) as never);
          }}
        />
      );
    }
    if (item.kind === 'liked') {
      return (
        <ProfileVideoTile
          item={item.item}
          index={index}
          width={layout.tileWidth}
          height={layout.tileHeight}
          onPress={handleLikedTap}
        />
      );
    }
    if (item.kind === 'order') return <OrderRow order={item.order} theme={theme} onPress={handleOrdersPress} />;
    if (item.kind === 'closetPiece') {
      return (
        <ClosetPieceTile
          piece={item.piece}
          width={layout.tileWidth}
          onPress={handleClosetPiecePress}
          footer={item.piece.edition ? <PieceEditionLine edition={item.piece.edition} /> : undefined}
          testID={`closet-piece-${item.piece.id}`}
        />
      );
    }
    if (item.kind === 'closetOutfit') {
      return (
        <ClosetOutfitTile
          pieces={item.outfit.pieces}
          width={closetOutfitWidth}
          onPress={() => { hapticSelection(); router.push(`/closet-outfit?id=${encodeURIComponent(item.outfit.id)}` as never); }}
          testID={`closet-outfit-${item.outfit.id}`}
        />
      );
    }
    return <SavedCell item={item.saved} size={savedCellSize} theme={theme} onPress={handleSavedTap} />;
  }, [closetOutfitWidth, handleClosetPiecePress, handleDraftsTilePress, handleLikedTap, handleOrdersPress, handlePostLongPress, handlePostTap, handleSavedTap, layout.tileHeight, layout.tileWidth, router, savedCellSize, theme]);

  const keyForRow = useCallback((row: ListRow) => (
    row.kind === 'draftsTile' ? 'drafts-tile' : row.kind === 'post' ? row.post.id : row.kind === 'tagged' ? `t-${row.item.id}` : row.kind === 'liked' ? `l-${row.liked.id}` : row.kind === 'order' ? row.order.id
      : row.kind === 'closetPiece' ? `cp-${row.piece.id}` : row.kind === 'closetOutfit' ? `co-${row.outfit.id}` : row.saved.id
  ), []);

  // One table decides every tab's empty copy + CTA (own profile → CTA).
  const emptyTabKey = activeTab === 'Posts' ? 'buyer:posts'
    : activeTab === 'Closet' && closetView === 'outfits' ? 'buyer:closet-outfits'
    : `buyer:${activeTab.toLowerCase()}`;
  const empty = profileEmptyState(emptyTabKey as ProfileEmptyTab, true);
  const emptyIcon = empty.icon as IconName;
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

  const hasActiveStory = myStoryIds.length > 0;
  const heroActive = focused && heroOnScreen && !heroPosterOnly;

  // Drafts never count toward "published" (they aren't public); still used
  // below for the share sheet's topPosts.
  const publishedPosts = posts.filter(p => !p.isDraft);
  // Followers · Following · Likes — Posts was dropped (dev: a high count in
  // any column was getting cut off; three columns gives each enough room).
  // Likes is a real total summed from this buyer's own posts (never
  // paginated — getMyPosts() always returns the full list), not fabricated.
  const totalLikes = publishedPosts.reduce((sum, p) => sum + (p.likesCount || 0), 0);
  const stats: ProfileStat[] = [
    {
      key: 'followers', label: 'Followers',
      value: formatCompactCount(socialCounts?.followers ?? profile?.friendsCount ?? 0),
      onPress: () => router.push(connectionsHref('followers') as any),
    },
    {
      key: 'following', label: 'Following',
      value: formatCompactCount(socialCounts?.following ?? profile?.followingBrandsCount ?? 0),
      onPress: () => router.push(connectionsHref('following') as any),
    },
    { key: 'likes', label: 'Likes', value: formatCompactCount(totalLikes) },
  ];

  const highlightItems: ProfileStoryItem[] = highlights.map((h) => ({
    id: h.id, label: h.label, emoji: h.emoji, coverColor: h.coverColor, imageUri: h.coverUrl ?? null,
  }));

  const accountSwitcherNode = (
    <ProfileAccountSwitcher
      label={displayHandle || displayName}
      onPress={() => { haptics.light(); setAccountSwitcherOpen(true); }}
      overMedia
      accessibilityLabel="Switch account"
      testID="buyer-profile-account-switcher"
    />
  );
  const topBarIcons = (
    <ProfileTopBarIconRow>
      {threadCashEnabled ? (
        <CompactWalletChip
          balanceLabel={formatCents(threadCashBalanceCents)}
          onPress={() => router.push('/thread-cash' as never)}
          onLongPress={__DEV__ ? () => celebrateThreadCash({ amount: 500, from: 'Daily reward' }) : undefined}
          theme={theme}
        />
      ) : null}
      <ProfileTopBarIcon
        name="more-horizontal"
        onPress={(event) => { setMenuAnchor(anchorFromEvent(event)); setMenuOpen(true); }}
        accessibilityLabel="Profile options"
        testID="buyer-profile-more"
      />
      <ProfileTopBarIcon name="menu" onPress={handleMenu} accessibilityLabel="More options" />
    </ProfileTopBarIconRow>
  );

  const profileAvatar = (
    <ProfileStoryAvatar
      uri={avatarUri}
      videoUri={avatarVideoUri}
      initials={avatarInitials}
      hasActiveStory={hasActiveStory}
      accessibilityLabel={hasActiveStory ? 'View your story' : 'Create a story'}
      onPress={() => {
        haptics.selection();
        if (hasActiveStory) {
          router.push({ pathname: '/buyer-story-viewer' as any, params: { storyId: myStoryIds[0], allStoryIds: myStoryIds.join(',') } });
        } else {
          router.push('/buyer-story-create' as any);
        }
      }}
      onPressBadge={() => { haptics.selection(); router.push('/buyer-story-create' as any); }}
      onLongPress={() => { haptics.selection(); setAccountSwitcherOpen(true); }}
    />
  );
  const profileMeta = (profile?.bio || profile?.website || profile?.location || profileMusicOn) ? (
    <ProfileMeta
      bio={profile?.bio}
      website={profile?.website}
      location={profile?.location}
      onOpenWebsite={(url) => { void Linking.openURL(url); }}
    >
      <ProfileSongLine userId={user?.id} />
    </ProfileMeta>
  ) : null;
  // Banner layout: the @username ▾ account switcher leads the top bar (Edit
  // profile lives only in the button row under the bio).
  const bannerTopBar = (
    <>
      <View style={topBarStyles.bannerLeft}>
        <View style={topBarStyles.bannerSwitcher}>{accountSwitcherNode}</View>
      </View>
      {topBarIcons}
    </>
  );

  const header = (
    <View onLayout={handleHeaderLayout}>
      {/* Existing covers remain editable; no empty banner placeholder. */}
      {banner ? <ProfileBannerHeader
        banner={banner}
        height={bannerH}
        active={heroActive}
        posterOnly={heroPosterOnly}
        topPad={topPad}
        topBar={bannerTopBar}
        avatar={profileAvatar}
        note={bannerNote}
        name={displayName}
        handle={displayHandle && displayHandle !== displayName ? displayHandle : null}
        stats={stats}
        // Buyer's own profile: avatar on the left, name / @handle / stats to its right.
        avatarSide="left"
        statsLoading={loading}
        coversTop={focused && bannerCoversTop}
        onAddBanner={bannerFlow.openSheet}
      /> : <ProfileVideoHeader
        hero={{ videoUri: coverFlow.cover.videoUrl, posterUri: coverFlow.cover.posterUrl }}
        heroActive={heroActive}
        posterOnly={heroPosterOnly}
        topPad={topPad}
        topBar={bannerTopBar}
        avatar={profileAvatar}
        name={displayName}
        handle={displayHandle && displayHandle !== displayName ? displayHandle : null}
        stats={stats}
        statsLoading={loading}
        onHeroHeight={setHeroHeight}
      />}
      {/* Below the banner the profile continues as before: chip, bio, link. */}
      <View style={topBarStyles.bannerBelow} testID="profile-banner-below">
        {profileMeta}
      </View>
      {/* Same row geometry as the seller own profile (app/(tabs)/profile.tsx
          actionRow): token gap/padding/radius, 36pt compact buttons. */}
      <View style={styles.actionRow}>
        <View style={styles.actionFlex}>
          <Button label="Edit profile" variant="secondary" size="compact" fullWidth style={[styles.actionButton, styles.actionSurface]} onPress={() => router.push('/(buyer)/edit-profile')} testID="profile-edit-button" />
        </View>
        <View style={styles.actionFlex}>
          <Button label="Share profile" variant="secondary" size="compact" fullWidth style={[styles.actionButton, styles.actionSurface]} onPress={handleShareProfile} testID="profile-share-button" />
        </View>
        <Button label="" icon="user-plus" variant="secondary" size="compact" style={[styles.actionSquare, styles.actionSurface]} accessibilityLabel="Discover people" onPress={() => router.push('/(buyer)/friends' as any)} testID="profile-discover-people" />
      </View>

      {/* ── Story Highlights: circles + "New" ── */}
      <View style={styles.highlightsWrap} testID="profile-highlights">
        <ProfileStoriesRow
          size="sm"
          items={highlightItems}
          onNew={() => { router.push('/buyer-highlights-manager?create=1' as any); }}
          onPressItem={(item) => {
            // Tapping one of my highlights opens it in the manager, where its
            // name, cover and saved stories are edited.
            router.push(`/buyer-highlights-manager?edit=${encodeURIComponent(item.id)}` as any);
          }}
        />
      </View>

      {/* Monthly Wrapped: the one card, days 1–7 only, dismissible for good. */}
      <WrappedProfileCard userId={user?.id} />
      {profileBrands.length > 0 ? (
        <View style={styles.brandsWrap}>
          <ProfileBrandsRow items={profileBrands} />
        </View>
      ) : null}

      {threadCashEnabled ? (
        <View style={styles.streakWrap}>
          <ThreadCashStreakRow streak={threadCashStreak} onPress={() => router.push('/thread-cash' as never)} />
        </View>
      ) : null}

      <View style={styles.tabsBlock}>
        <ProfileTabs
          tabs={TAB_ITEMS.map(tab => ({
            ...tab,
            count: tab.key === 'Posts' ? publishedPosts.length : tab.key === 'Saved' ? savedItems.length : undefined,
          }))}
          variant="labeled"
          active={activeTab}
          onChange={handleTabPress}
          position={tabSwipe.position}
        />
      </View>
      {activeTab === 'Closet' && closetPieces.length > 0 ? (
        <ClosetSubBar
          view={closetView}
          pieceCount={closetPieces.length}
          outfitCount={closetOutfits.length}
          onView={(view) => { hapticSelection(); setClosetView(view); }}
          onNewOutfit={handleNewOutfit}
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.root} testID="buyer-profile">
      <ProfileEmptyAreaContext.Provider value={emptyArea.minHeight}>
      <View style={[{ flex: 1 }, Platform.OS === 'web' ? ({ touchAction: 'pan-y' } as object) : null]} {...tabSwipe.panHandlers} testID="profile-tab-swipe-area">
      <Animated.FlatList
        key={`buyer-${numColumns}`}
        ref={listRef as any}
        data={loading ? [] : rows}
        renderItem={renderRow as any}
        keyExtractor={keyForRow as any}
        numColumns={numColumns}
        columnWrapperStyle={numColumns > 1 ? (activeTab === 'Saved' ? [styles.gridRow, styles.savedRow] : styles.gridRow) : undefined}
        ListHeaderComponent={header}
        ListEmptyComponent={activeTab === 'Closet' && !loading ? (
          <ClosetEmpty title={emptyTitle} action={emptyAction} minHeight={emptyArea.minHeight} />
        ) : (
          // `emptyArea` (computeEmptyArea, shared with ProfileShell) sizes
          // this to fill the rest of the viewport below the (measured, video
          // hero included) header, and `emptyArea.paddingBottom` below
          // reserves the floating tab bar's own footprint — so at the end of
          // the scroll the CTA sits fully clear of the bar, on any header
          // height, not just a fixed constant.
          <ProfileGridPlaceholder
            quiet
            loading={loading || (activeTab === 'Liked' && !likedLoaded && likedLoading)}
            error={activeTab === 'Liked' && likedError}
            onRetry={activeTab === 'Liked' ? () => { void loadLiked('first'); } : loadData}
            layout={layout}
            icon={emptyIcon}
            illustration={emptyIllustration}
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
            actionStyle="text"
            alignTop={activeTab === 'Posts'}
          />
        )}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        contentContainerStyle={{ paddingBottom: emptyArea.paddingBottom }}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReached={activeTab === 'Liked' && likedCursor ? () => { void loadLiked('more'); } : undefined}
        onEndReachedThreshold={0.5}
      />
      </View>
      </ProfileEmptyAreaContext.Provider>
      <ProfileStickyHeader
        visible={profileStickyVisible && focused}
        topPad={topPad}
        title={displayHandle ? `@${displayHandle.replace(/^@/, '')}` : displayName}
      />

      <ClosetProofCard
        piece={proofPiece}
        onClose={() => setProofPiece(null)}
        onViewProduct={(piece) => {
          setProofPiece(null);
          router.push(`/buyer-product-detail?productId=${encodeURIComponent(piece.productId ?? '')}` as never);
        }}
      />
      <CoverCoachmarkSheet
        visible={coverFlow.coachmarkVisible}
        onAdd={() => { coverFlow.dismissCoachmark(); coverFlow.startAdd(); }}
        onLater={coverFlow.dismissCoachmark}
      />
      <CoverManageSheet visible={coverFlow.manageOpen} onChange={coverFlow.changeFromManage} onRemove={() => { void coverFlow.remove(); }} onClose={coverFlow.closeManage} />
      <CoverTrimSheet source={coverFlow.trimSource} onCancel={coverFlow.cancelTrim} onConfirm={coverFlow.confirmTrim} />
      {/* "Add banner" on the placeholder: the same Edit banner sheet as Edit profile. */}
      {bannerFlow.sheet}

      {/* ••• sheet: only actions without a home elsewhere on this screen.
          Edit / Share / Discover people live in the button row under the bio. */}
      <ProfileMenuSheet
        visible={menuOpen}
        anchor={menuAnchor}
        title={displayHandle || displayName}
        appearance="list"
        onClose={() => setMenuOpen(false)}
        items={buyerOwnMenuItems({
          onNotifications: () => router.push('/buyer-notifications' as any),
          onViewAsVisitor: caps.showViewAsVisitor && user?.id
            ? () => router.push(viewAsVisitorHref('buyer', user.id) as never)
            : null,
        }).concat([
          { key: 'orders', label: 'Orders', icon: 'package', separatorBefore: true, onPress: () => router.navigate('/(buyer)/orders' as never) },
          { key: 'closet', label: 'Closet', icon: 'layers', onPress: () => handleTabPress('Closet') },
          { key: 'tagged', label: 'Tagged posts', icon: 'tag', onPress: () => handleTabPress('Tagged') },
        ])}
      />

      <ShareProfileSheet
        visible={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
        avatarUrl={avatarUri}
        profileUsername={profile?.username}
        profileDisplayName={displayName}
        buyerExtra={{
          statLabel: 'followers',
          statValue: socialCounts?.followers ?? profile?.friendsCount ?? 0,
          topPosts: publishedPosts.slice(0, 3).map(p => ({ id: p.id, uri: p.mediaUrl })),
        }}
      />

      <AccountSwitcherSheet visible={accountSwitcherOpen} onClose={() => setAccountSwitcherOpen(false)} />

      {/* ── Post Long-Press Sheet ── */}
      <MenuSheet
        visible={!!postSheet}
        onClose={() => setPostSheet(null)}
        accessibilityLabel="Post options"
        testID="profile-post-menu"
        sections={[
          [
            { key: 'share', icon: 'share-2', label: 'Share post', onPress: () => { void handleShareCurrentPost(); } },
            ...(postSheet && (!postSheet.isDraft || postSheet.pinnedAt) ? [{key: 'pin', icon: 'bookmark' as const, label: postSheet.pinnedAt ? 'Unpin from profile' : 'Pin to your profile', onPress: () => { void handleTogglePin(); }}] : []),
            { key: 'archive', icon: 'archive', label: 'Archive', onPress: () => { void handleArchivePost(); } },
          ],
          [{ key: 'delete', icon: 'trash-2', label: 'Delete post', destructive: true, onPress: handleDeletePost }],
        ]}
      />
      <Snackbar visible={!!pinSnackbar} message={pinSnackbar} onDismiss={() => setPinSnackbar('')} />
    </View>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    errorRoot: { flex: 1, backgroundColor: theme.background, justifyContent: 'center' },
    gridRow: { gap: 1 },
    // Saved cells are sized from the column minus a 16pt gutter each side.
    savedRow: { paddingHorizontal: SP.md },

    // Bio → action row: 16pt; buttons 8pt apart (the seller row's SP.sm).
    actionRow: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.md, alignItems: 'center' },
    actionFlex: { flex: 1, minWidth: 0 },
    actionButton: { borderRadius: RADIUS.sm, paddingHorizontal: SP.sm },
    // Icon-only: a square at the compact Button's own 36pt height.
    actionSquare: { width: 36, borderRadius: RADIUS.sm, paddingHorizontal: 0 },
    actionSurface: { backgroundColor: theme.cardElevated, borderColor: theme.cardElevated },
    // Bio → highlights: 16pt.
    highlightsWrap: { paddingTop: 16 },
    brandsWrap: { paddingTop: 12 },
    // Highlights → streak card (or tabs, when Thread Cash is off): 16pt.
    streakWrap: { marginTop: 16 },
    // Streak card (or highlights) → tabs: 16pt above; tabs → grid: 1pt
    // (Instagram's grid starts right under the underline).
    tabsBlock: { paddingTop: 16, paddingBottom: 1 },
  });
}

const topBarStyles = StyleSheet.create({
  // Banner layout (TikTok): pencil + account switcher, chips/bio below the banner.
  bannerLeft: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginRight: SP.sm },
  bannerSwitcher: { flex: 1, minWidth: 0, overflow: 'hidden' },
  bannerBelow: { paddingHorizontal: SP.md, paddingTop: 12, gap: SP.xs },
  bannerChips: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  walletChip: {
    height: 28, borderRadius: radius.sm, borderWidth: 1, flexDirection: 'row', alignItems: 'center',
    gap: 4, paddingHorizontal: 8, overflow: 'hidden',
  },
  walletText: { fontFamily: FONT.bold, fontSize: FS.xs, fontVariant: ['tabular-nums'] },
});

const cellStyles = StyleSheet.create({
  savedTile: { aspectRatio: 1, borderWidth: 1, borderRadius: RADIUS.md, padding: SP.sm, justifyContent: 'space-between' },
  savedTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, marginTop: SP.xs },
  savedSubtitle: { fontFamily: FONT.regular, fontSize: FS.meta },
  draftsTile: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  draftsTitle: { fontFamily: FONT.semibold, fontSize: FS.sm },
  draftsCount: { fontFamily: FONT.regular, fontSize: FS.xs, fontVariant: ['tabular-nums'] },
  orderCard: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: RADIUS.md, padding: SP.sm, gap: SP.sm,
    marginHorizontal: SP.md, marginVertical: SP.xs,
  },
  orderCardImage: { width: 52, height: 52, borderRadius: RADIUS.sm },
  orderCardImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  orderCardBody: { flex: 1, gap: 2 },
  orderCardSeller: { fontFamily: FONT.semibold, fontSize: FS.sm },
  orderCardMeta: { fontFamily: FONT.regular, fontSize: FS.meta, marginBottom: 2 },
});
