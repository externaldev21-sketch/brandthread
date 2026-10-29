/**
 * Seller's own Profile tab — ProfileShell in its Instagram own-profile
 * `headerVariant="video"` (profile video behind the controls, avatar, name
 * and bio, fading to solid at the stats row), with the owner's tools:
 * account switcher, notifications, the ••• menu (settings, view as
 * visitor), Edit profile + Share profile, Go Live, Create Post, quick actions, and Instagram's
 * icon-only Posts / Shop / Tagged tabs over a 4:5 grid.
 *
 * Drafts and scheduled posts (formerly their own tabs) are a sub-filter under
 * Posts (Published / Drafts / Scheduled) so nothing a seller relied on is
 * lost; the Shop tab shows the live listings (tap → product), and Tagged is
 * an honest empty state (sellers have no tagged-post data yet).
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStickyState } from '@/lib/stickyState';
import { useAuth } from '@clerk/expo';
import {
  View, Text, StyleSheet, TouchableOpacity,
} from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { haptics } from '@/lib/haptics';
import { getSellerPosts, subscribeSocial, type SellerThreadPost } from '@/services/socialService';
import { useApi } from '@/lib/api';
import {
  CARD, BORDER, FG, MUTED,
  FONT, FS, SP,
} from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { AccountSwitcherSheet } from '@/components/AccountSwitcherSheet';
import { followingCountAfter, subscribeProfileEvents } from '@/lib/profileEvents';
import { connectionsHref, productDetailHref, profileProductsHref, profileVideosHref } from '@/lib/profileNavigation';
import { getSellerShopPage, taggedItemHref, type ShopProduct } from '@/services/profileService';
import { formatCompactCount } from '@/lib/compactFormat';
import { ProfileShell, ProfileMeta } from '@/components/profile/ProfileShell';
import { resolveProfileBanner, type ProfileBanner } from '@/components/profile/profileBannerRules';
import { useProfileBannerState } from '@/components/profile/useProfileBanner';
import { useProfileNote } from '@/components/profile/useProfileNote';
import { useProfileBanner } from '@/components/profile/ProfileBannerEditor';
import { FoundingSellerBadge, foundingSellerNumberOf } from '@/components/profile/FoundingSellerBadge';
import {
  ProfileChip, ShopPill, type ProfileStat, type ProfileTab,
} from '@/components/profile/ProfileControls';
import { ProfileAccountSwitcher, ProfileTopBarIcon, ProfileTopBarIconRow } from '@/components/profile/ProfileTopBar';
import { useSellerActivityUnread } from '@/hooks/useSellerActivityUnread';
import { useProfilePostsDefault } from '@/hooks/useProfilePostsDefault';
import { ProfileVideoTile, gridItemFromThreadPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { profileEmptyState } from '@/components/profile/profileEmptyStates';
import {
  CoverCoachmarkSheet, CoverManageSheet, CoverTrimSheet, useProfileCover,
} from '@/components/profile/ProfileCover';
import { activeStoryIds } from '@/components/profile/profileAvatarGeometry';
import { TILE_ASPECT_3_4, useProfileLayout } from '@/components/profile/profileLayout';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { getPreviewSocialCounts } from '@/lib/previewSocialCounts';
import { getDemoSellerProfile } from '@/components/profile/previewProfileDemo';
import type { DiscoverPost } from '@/lib/discoverFeed';
import { profileCapabilities, viewAsVisitorHref } from '@/lib/profileAccess';
import { ProfileMenuSheet, type ProfileMenuItem } from '@/components/profile/ProfileMenuSheet';
import { anchorFromEvent, type MenuAnchor } from '@/lib/contextMenu';
import { ProfileProductTile } from '@/components/profile/ProfileProductTile';
import { useTaggedPosts } from '@/components/profile/useTaggedPosts';
import { PREVIEW_SELLER_IDENTITY, previewSellerBrandName } from '@/lib/previewIdentity';
import { atHandle, sellerDisplayName } from '@/lib/identity';
import { useSellerUnreadThreads } from '@/hooks/useSellerUnreadThreads';

// ─── Profile data shape ──────────────────────────────────────────────────────

interface SellerProfileData {
  brandName:          string | null;
  /** The account's @username — the share sheet's QR/link is built from it. */
  username?:          string | null;
  displayName:        string | null;
  bio:                string | null;
  subscriptionStatus: string | null;
  subscriptionPlanId: string | null;
  totalLikes:         number;
  profileImageUrl:    string | null;
  verified:           boolean;
  coverVideoUrl?:     string | null;
  coverPosterUrl?:    string | null;
  /** A moving profile picture — when set, plays instead of the static photo. */
  avatarVideoUrl?:    string | null;
  avatarPosterUrl?:   string | null;
  /** "Founding Seller #N" (first 100 sellers), else null. */
  foundingSellerNumber?: number | null;
  metrics: {
    revenueCents: number;
    visitors: number;
    orders: number;
    conversionRate: number;
  };
}

interface SocialCounts {
  followers: number;
  following: number;
  likes:     number;
}

const CONTENT_TABS = ['Posts', 'Shop', 'Tagged'] as const;
type ContentTab = typeof CONTENT_TABS[number];
// Label (and accessibility name, since these render icon-only) is "Products"
// — the tab shows the seller's live catalog — while the internal key stays
// 'Shop' so every existing activeTab === 'Shop' branch below is untouched.
const CONTENT_TAB_ITEMS: ProfileTab[] = [
  { key: 'Posts', label: 'Posts', icon: 'grid' },
  { key: 'Shop', label: 'Products', icon: 'shopping-bag' },
  { key: 'Tagged', label: 'Tagged', icon: 'tag' },
];

// Grid cell union — an Instagram-style folder tile (first cell, only when
// there's at least one draft/scheduled post) alongside the normal post/
// product tiles, so the Posts grid can show it without a second filter row.
type GridRow =
  | { kind: 'draftsTile'; count: number }
  | { kind: 'item'; item: ProfileGridItem }
  | { kind: 'product'; product: ShopProduct };

function DraftsFolderTile({
  count, width, height, onPress,
}: {
  count: number; width: number; height: number; onPress: () => void;
}) {
  return (
    <View style={{ width, marginBottom: 1 }}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Drafts, ${count} saved`}
        testID="seller-profile-drafts-tile"
        style={[s.draftsTile, { width, height }]}
      >
        <Icon name="file-text" size={22} color={MUTED} />
        <Text style={s.draftsTileTitle}>Drafts</Text>
        <Text style={s.draftsTileCount}>{count}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const { theme } = useAppTheme();
  const router  = useRouter();
  const api = useApi();
  const insets = useSafeAreaInsets();
  const hasUnreadActivity = useSellerActivityUnread();
  // Instagram's own-profile grid: 3 columns, 1pt gutters, 4:5 tiles.
  const layout = useProfileLayout({ tileAspect: TILE_ASPECT_3_4 });
  // The seller tab bar floats over content (same metrics as the global bar).
  const sellerBarInset = useTabBarMetrics(2).occupiedHeight;
  const { isLoaded: authLoaded, userId } = useAuth();
  const [activeTab, setActiveTab] = useState<ContentTab>('Posts');
  useProfilePostsDefault(setActiveTab, userId);
  const [shopProducts, setShopProducts] = useState<ShopProduct[]>([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopError, setShopError] = useState(false);
  // Sticky (memory-only, account-scoped — lib/stickyState.ts): a remount or
  // revisit paints the last-known grid, header and stats on frame one
  // instead of skeleton tiles, "–" stats and a bio/cover that pop in late.
  const [sellerPosts, setSellerPosts, hadPosts] = useStickyState<SellerThreadPost[]>('sellerProfile:posts', []);
  const [postsLoading, setPostsLoading] = useState(!hadPosts);
  const [postsError, setPostsError] = useState(false);
  const [myStoryIds, setMyStoryIds] = useStickyState<string[]>('sellerProfile:storyIds', []);
  const [profile, setProfile, hadProfile] = useStickyState<SellerProfileData | null>('sellerProfile:profile', null);
  const coverFlow = useProfileCover({
    own: true,
    cover: { videoUrl: profile?.coverVideoUrl ?? null, posterUrl: profile?.coverPosterUrl ?? null },
    userId,
  });
  const [serverBanner, setServerBanner] = useState<ProfileBanner | null>(null);
  const banner = useProfileBannerState({ server: serverBanner, ownerId: userId, own: true });
  const bannerNote = useProfileNote({ userId, own: true, enabled: true });
  // Own profile: always the banner layout; no banner = a dark "Add banner"
  // placeholder that opens the same Edit banner sheet as Edit profile.
  const bannerFlow = useProfileBanner({ banner, userId });
  const tagged = useTaggedPosts(userId, activeTab === 'Tagged' && !!userId && !isSellerDevPreview());
  const [socialCounts, setSocialCounts] = useStickyState<SocialCounts>('sellerProfile:socialCounts', { followers: 0, following: 0, likes: 0 });
  const [productsCount, setProductsCount] = useState<number | null>(null);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const caps = profileCapabilities('seller', 'owner');
  const [refreshing, setRefreshing] = useState(false);
  // Gates the stats row's "–" placeholder. Tied only to the FIRST load
  // attempt settling (success or failure) via Promise.allSettled below —
  // never to `!profile` — so a slow or failing seller-profile fetch can't
  // strand Posts/Followers/Following/Likes on "–" forever even though those
  // three come from independent, already-resolved sources.
  const [statsInitialLoading, setStatsInitialLoading] = useState(!(hadProfile && profile));
  const requestUserRef = useRef<string | null>(null);

  const loadPosts = useCallback(async () => {
    // isSellerDevPreview() (not just !userId): a stubbed/fake-signed-in
    // Clerk session (this app's own audit/e2e harnesses fake a signed-in
    // user so protected screens render at all) still reports a truthy
    // userId, which would otherwise fall through to the real backend-less
    // endpoints below and log a console 404 — see the identical
    // isSellerDevPreview() fix in app/seller-inbox.tsx.
    if (!authLoaded || !userId || isSellerDevPreview()) return;
    const requestUser = userId;
    setPostsError(false);
    try {
      const posts = await getSellerPosts();
      if (requestUserRef.current === requestUser) setSellerPosts(posts);
    } catch {
      // Keep the profile usable when posts are unavailable; the grid offers Retry.
      if (requestUserRef.current === requestUser) setPostsError(true);
    } finally {
      if (requestUserRef.current === requestUser) setPostsLoading(false);
    }
  }, [authLoaded, userId]);

  const loadMyStories = useCallback(async () => {
    // isSellerDevPreview() (not just !userId): a stubbed/fake-signed-in
    // Clerk session (this app's own audit/e2e harnesses fake a signed-in
    // user so protected screens render at all) still reports a truthy
    // userId, which would otherwise fall through to the real backend-less
    // endpoints below and log a console 404 — see the identical
    // isSellerDevPreview() fix in app/seller-inbox.tsx.
    if (!authLoaded || !userId || isSellerDevPreview()) return;
    const requestUser = userId;
    try {
      const rows = await api.social.myStories();
      if (requestUserRef.current === requestUser) setMyStoryIds(activeStoryIds(rows));
    } catch { /* stories are optional profile content */ }
  }, [api, authLoaded, userId]);

  const loadProfile = useCallback(async () => {
    // isSellerDevPreview() (not just !userId): a stubbed/fake-signed-in
    // Clerk session (this app's own audit/e2e harnesses fake a signed-in
    // user so protected screens render at all) still reports a truthy
    // userId, which would otherwise fall through to the real backend-less
    // endpoints below and log a console 404 — see the identical
    // isSellerDevPreview() fix in app/seller-inbox.tsx.
    if (!authLoaded || !userId || isSellerDevPreview()) return;
    const requestUser = userId;
    try {
      const data = await api.seller.getProfile();
      if (requestUserRef.current !== requestUser) return;
      setServerBanner(resolveProfileBanner(data as any));
      setProfile({
        brandName:          data.brandName   ?? null,
        username:           (data as any).username ?? null,
        displayName:        data.displayName ?? null,
        bio:                data.bio         ?? null,
        subscriptionStatus: data.subscriptionStatus ?? null,
        subscriptionPlanId: data.subscriptionPlanId ?? null,
        totalLikes:         data.totalLikes ?? 0,
        profileImageUrl:    data.profileImageUrl ?? null,
        verified:           data.verified === true,
        coverVideoUrl:      (data as any).coverVideoUrl ?? null,
        coverPosterUrl:     (data as any).coverPosterUrl ?? null,
        avatarVideoUrl:     (data as any).avatarVideoUrl ?? null,
        avatarPosterUrl:    (data as any).avatarPosterUrl ?? null,
        foundingSellerNumber: foundingSellerNumberOf((data as any).foundingSellerNumber),
        metrics: data.metrics ?? {
          revenueCents: 0,
          visitors: 0,
          orders: 0,
          conversionRate: 0,
        },
      });
      setSocialCounts((current) => ({ ...current, likes: data.totalLikes ?? 0 }));
    } catch { /* nullable profile fields already render safely */ }
  }, [api, authLoaded, userId]);

  const loadSocialCounts = useCallback(async () => {
    // isSellerDevPreview() (not just !userId): a stubbed/fake-signed-in
    // Clerk session (this app's own audit/e2e harnesses fake a signed-in
    // user so protected screens render at all) still reports a truthy
    // userId, which would otherwise fall through to the real backend-less
    // endpoints below and log a console 404 — see the identical
    // isSellerDevPreview() fix in app/seller-inbox.tsx.
    if (!authLoaded || !userId || isSellerDevPreview()) return;
    const requestUser = userId;
    try {
      // True totals from the profile endpoint — the follower/following lists
      // are paged (100 per page), so their lengths undercounted large brands.
      const counts = typeof api.social.profile === 'function'
        ? await api.social.profile(userId).catch(() => null)
        : null;
      if (requestUserRef.current !== requestUser) return;
      if (counts) {
        setSocialCounts((current) => ({
          ...current,
          followers: Number(counts.followersCount ?? 0),
          following: Number(counts.followingCount ?? 0),
        }));
        return;
      }
      const [followersArr, followingArr] = await Promise.all([
        api.social.followers(),
        api.social.following(),
      ]);
      if (requestUserRef.current !== requestUser) return;
      setSocialCounts((current) => ({
        ...current,
        followers: Array.isArray(followersArr) ? followersArr.length : 0,
        following: Array.isArray(followingArr) ? followingArr.length : 0,
      }));
    } catch { /* zero counts remain visible */ }
  }, [api, authLoaded, userId]);


  const loadShopCount = useCallback(async () => {
    // isSellerDevPreview() (not just !userId): a stubbed/fake-signed-in
    // Clerk session (this app's own audit/e2e harnesses fake a signed-in
    // user so protected screens render at all) still reports a truthy
    // userId, which would otherwise fall through to the real backend-less
    // endpoints below and log a console 404 — see the identical
    // isSellerDevPreview() fix in app/seller-inbox.tsx.
    if (!authLoaded || !userId || isSellerDevPreview()) return;
    const requestUser = userId;
    try {
      const data = await api.publicSellers?.get?.(userId);
      if (requestUserRef.current !== requestUser) return;
      setProductsCount(Number(data?.profile?.productsCount ?? 0));
    } catch { /* the pill falls back to "Shop" without a count */ }
  }, [api, authLoaded, userId]);

  const loadPage = useCallback(async () => {
    // isSellerDevPreview() (not just !userId): a stubbed/fake-signed-in
    // Clerk session (this app's own audit/e2e harnesses fake a signed-in
    // user so protected screens render at all) still reports a truthy
    // userId, which would otherwise fall through to the real backend-less
    // endpoints below and log a console 404 — see the identical
    // isSellerDevPreview() fix in app/seller-inbox.tsx.
    if (!authLoaded || !userId || isSellerDevPreview()) return;
    void loadMyStories();
    void loadShopCount();
    // The three sources behind the four visible stats — awaited together so
    // statsInitialLoading always resolves once, whichever finish first or
    // fail; loadPosts/loadProfile/loadSocialCounts each already swallow
    // their own errors, but allSettled is the belt-and-braces guarantee.
    await Promise.allSettled([loadPosts(), loadProfile(), loadSocialCounts()]);
    setStatsInitialLoading(false);
  }, [authLoaded, userId, loadPosts, loadMyStories, loadProfile, loadSocialCounts, loadShopCount]);

  // Only wipe what's on screen when the account actually changes — not on
  // the first run, and not when this effect merely re-runs because a
  // loader's identity changed — so the profile never blanks and refills.
  const shownUserRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    requestUserRef.current = userId ?? null;
    const accountChanged = shownUserRef.current !== undefined && shownUserRef.current !== (userId ?? null);
    shownUserRef.current = userId ?? null;
    if (accountChanged) {
      setSellerPosts([]);
      setMyStoryIds([]);
      setProfile(null);
      setPostsLoading(true);
      setSocialCounts({ followers: 0, following: 0, likes: 0 });
      setStatsInitialLoading(true);
    }
    if (authLoaded && userId && !isSellerDevPreview()) void loadPage();
    // Preview never loads Clerk (authLoaded stays false) — settle right away, not after the stall guard.
    if ((authLoaded && !userId) || isSellerDevPreview()) { setPostsLoading(false); setStatsInitialLoading(false); }
    // New / edited / deleted posts publish through socialService — refresh.
    const unsub = subscribeSocial(() => { loadPosts(); loadMyStories(); });
    // Belt-and-braces: if auth itself never resolves (a slow or stuck Clerk
    // session) statsInitialLoading would otherwise never flip, since
    // loadPage() only runs once authLoaded && userId are both true. Never
    // leave the stats row stuck on "–" indefinitely — fall back to showing
    // real (zero) values after a few seconds regardless.
    const stallGuard = setTimeout(() => setStatsInitialLoading(false), 6000);
    return () => { unsub(); clearTimeout(stallGuard); };
  }, [authLoaded, userId, loadPage, loadPosts, loadMyStories]);

  // Returning from add-product / create-post / edit-profile refreshes counts.
  useFocusEffect(useCallback(() => {
    void loadShopCount();
    void loadSocialCounts();
  }, [loadShopCount, loadSocialCounts]));

  // Following someone from the feed or a list moves "Following" immediately.
  useEffect(() => subscribeProfileEvents((event) => {
    if (event.type !== 'follow' || !userId) return;
    if (event.viewerId && event.viewerId !== userId) return;
    if (event.targetId === userId) return;
    setSocialCounts((counts) => ({ ...counts, following: followingCountAfter(counts.following, event) }));
  }), [userId]);

  // Preview `demo=1` only: the seeded catalog (lib/previewSellerProducts.ts)
  // fills Posts and Shop, and the demo's follower counts fill the stats, so
  // the demo seller isn't a blank new account. A fresh preview and every real
  // account never reach this (getDemoSellerProfile returns null).
  const [demoPosts, setDemoPosts] = useState<DiscoverPost[]>([]);
  useEffect(() => {
    if (!isSellerDevPreview() || !isPreviewDemoMode()) return;
    let alive = true;
    void (async () => {
      const [demo, counts, queue] = await Promise.all([
        getDemoSellerProfile(),
        getPreviewSocialCounts(),
        import('@/lib/discoverPlayerQueue'),
      ]);
      if (!alive || !demo) return;
      setDemoPosts(demo.posts);
      setSellerPosts(demo.posts.map(queue.discoverPostToThreadPost));
      setShopProducts(demo.products);
      setProductsCount(demo.products.length);
      if (counts) setSocialCounts((current) => ({ ...current, ...counts }));
    })();
    return () => { alive = false; };
  }, []);

  // Shop tab: the seller's live listings (same source as the full products page).
  const loadShopProducts = useCallback(async () => {
    // isSellerDevPreview() (not just !userId): a stubbed/fake-signed-in
    // Clerk session (this app's own audit/e2e harnesses fake a signed-in
    // user so protected screens render at all) still reports a truthy
    // userId, which would otherwise fall through to the real backend-less
    // endpoints below and log a console 404 — see the identical
    // isSellerDevPreview() fix in app/seller-inbox.tsx.
    if (!authLoaded || !userId || isSellerDevPreview()) return;
    const requestUser = userId;
    setShopError(false);
    setShopLoading(true);
    try {
      const page = await getSellerShopPage(userId, 0);
      if (requestUserRef.current === requestUser) setShopProducts(page.products);
    } catch {
      if (requestUserRef.current === requestUser) setShopError(true);
    } finally {
      if (requestUserRef.current === requestUser) setShopLoading(false);
    }
  }, [authLoaded, userId]);

  useEffect(() => {
    if (activeTab === 'Shop') void loadShopProducts();
  }, [activeTab, loadShopProducts]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadPage();
    setRefreshing(false);
  }, [loadPage]);

  function nav(route: string) {
    router.push(route as never);
  }

  // In the dev preview there is no account, so the one shared preview identity is shown here and in Settings / Edit profile.
  // Business name + @username from onboarding (lib/identity.ts) — no placeholder.
  const brandTitle = previewSellerBrandName() ?? (sellerDisplayName(profile ?? {}) || '');
  const unreadThreads = useSellerUnreadThreads();
  const avatarInitials = brandTitle
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const isFutureScheduled = (p: SellerThreadPost) => !!p.scheduledAt && new Date(p.scheduledAt).getTime() > Date.now();
  const publishedPosts = sellerPosts.filter(p => !p.isDraft && !p.isArchived && !isFutureScheduled(p));
  const draftPosts = sellerPosts.filter(p => !p.isArchived && (p.isDraft || isFutureScheduled(p)));

  const handleTilePress = useCallback((item: ProfileGridItem) => {
    // Demo posts have no backend row: open the feed player on the seeded grid.
    const demoIndex = demoPosts.findIndex(candidate => candidate.id === item.id);
    if (demoIndex >= 0) {
      void import('@/lib/discoverPlayerQueue').then(({ setDiscoverPlayerQueue }) => {
        const token = setDiscoverPlayerQueue(demoPosts, demoIndex);
        router.push(`/discover-player?q=${encodeURIComponent(token)}` as never);
      });
      return;
    }
    const post = sellerPosts.find(candidate => candidate.id === item.id);
    if (!post || !userId) return;
    const isLive = !post.isDraft && !(post.scheduledAt && new Date(post.scheduledAt).getTime() > Date.now());
    // Published posts play in the feed player; drafts and scheduled posts open the editor.
    if (isLive && post.surface === 'profile') {
      // POST (profile surface): the 3:4 carousel viewer, not the Threads video player.
      router.push(('/buyer-post-viewer?postId=' + encodeURIComponent(post.id)) as never);
    } else if (isLive) {
      router.push(profileVideosHref({ source: 'creator', id: userId, startPostId: post.id, title: brandTitle }) as never);
    } else {
      router.push(('/create-post?editId=' + encodeURIComponent(post.id)) as never);
    }
  }, [brandTitle, demoPosts, router, sellerPosts, userId]);

  const handleShopTilePress = useCallback((item: ProfileGridItem) => {
    router.push(productDetailHref(item.id, { isOwner: true }) as never);
  }, [router]);

  // The seller's existing full drafts/scheduled list (already supports
  // ?tab=draft) is the destination behind the Instagram-style Drafts tile —
  // no need for a second, in-page filter control.
  const handleDraftsTilePress = useCallback(() => {
    router.push('/content?tab=draft' as never);
  }, [router]);

  const handleTaggedPress = useCallback((item: ProfileGridItem) => {
    const entry = tagged.items.find((candidate) => candidate.id === item.id);
    if (!entry) return;
    router.push(taggedItemHref(entry) as never);
  }, [router, tagged.items]);

  const showingProductsGrid = activeTab === 'Shop';
  const renderTile = useCallback(({ item, index }: { item: GridRow; index: number }) => {
    if (item.kind === 'draftsTile') {
      return (
        <DraftsFolderTile
          count={item.count}
          width={layout.tileWidth}
          height={layout.tileHeight}
          onPress={handleDraftsTilePress}
        />
      );
    }
    if (item.kind === 'product') {
      // Owner mode: an edit affordance instead of Buy; tap opens the seller's own product screen.
      return (
        <ProfileProductTile
          product={item.product}
          width={layout.tileWidth}
          height={layout.tileHeight}
          owner={caps.canEditProducts}
          onPress={(product) => handleShopTilePress({ id: product.id } as ProfileGridItem)}
        />
      );
    }
    return (
      <ProfileVideoTile
        item={item.item}
        index={index}
        width={layout.tileWidth}
        height={layout.tileHeight}
        onPress={activeTab === 'Tagged' ? handleTaggedPress : handleTilePress}
      />
    );
  }, [activeTab, caps.canEditProducts, handleShopTilePress, handleTaggedPress, handleTilePress, handleDraftsTilePress, layout.tileHeight, layout.tileWidth]);

  // Followers · Following · Likes — Posts was dropped (dev: a seller with a
  // high count of any of these was getting cut off; three columns instead of
  // four gives each one enough room, and formatCompactCount keeps any of
  // them from overflowing regardless of magnitude).
  const stats: ProfileStat[] = [
    { key: 'followers', label: 'Followers', value: formatCompactCount(socialCounts.followers), onPress: () => nav(connectionsHref('followers')) },
    { key: 'following', label: 'Following', value: formatCompactCount(socialCounts.following), onPress: () => nav(connectionsHref('following')) },
    { key: 'likes', label: 'Likes', value: formatCompactCount(socialCounts.likes) },
  ];

  const planLabel = profile?.subscriptionPlanId
    ? `${profile.subscriptionPlanId.charAt(0).toUpperCase()}${profile.subscriptionPlanId.slice(1)} Plan`
    : profile?.subscriptionStatus === 'active' ? 'Active Plan' : 'Free Plan';
  const hasPaidPlan = !!(profile?.subscriptionPlanId || profile?.subscriptionStatus === 'active');

  // Plain text + chevron, no pill background — shared with the buyer
  // own-profile header (components/profile/ProfileTopBar.tsx) so the two
  // stay pixel-identical.
  const accountSwitcher = (
    <ProfileAccountSwitcher
      label={brandTitle}
      onPress={() => { setAccountSwitcherOpen(true); }}
      overMedia={coverFlow.hasCover}
      accessibilityLabel="Switch account"
      testID="profile-account-switcher"
    />
  );

  // One table decides every tab's empty copy; each CTA opens the real flow.
  const emptyKey = showingProductsGrid
    ? 'shop' as const
    : activeTab === 'Tagged'
      ? 'seller:tagged' as const
      : 'seller:post' as const;
  const empty = profileEmptyState(emptyKey, true);
  const postsGridData: GridRow[] = postsLoading ? [] : publishedPosts.map(p => ({ kind: 'item' as const, item: gridItemFromThreadPost(p) }));
  const gridData: GridRow[] = showingProductsGrid
    ? (shopLoading ? [] : shopProducts.map(p => ({ kind: 'product' as const, product: p })))
    : activeTab === 'Posts'
      ? (draftPosts.length > 0 ? [{ kind: 'draftsTile' as const, count: draftPosts.length }, ...postsGridData] : postsGridData)
      : tagged.items.map(entry => ({
          kind: 'item' as const,
          item: {
            id: entry.id,
            kind: entry.mediaType === 'video' ? 'video' as const : entry.mediaType === 'slideshow' ? 'slideshow' as const : 'photo' as const,
            posterUri: entry.posterUri,
            caption: entry.caption ?? '',
            productCount: 0,
          },
        }));
  const gridLoading = showingProductsGrid ? shopLoading && shopProducts.length === 0 : activeTab === 'Posts' ? postsLoading : tagged.loading;
  const gridError = showingProductsGrid ? shopError : activeTab === 'Posts' ? postsError : tagged.error;
  const shopLabel = productsCount && productsCount > 0
    ? `Shop ${productsCount} product${productsCount === 1 ? '' : 's'}`
    : 'Set up your shop';

  return (
    <>
      <ProfileShell
        testID="profile-hero"
        isOwnProfile
        headerVariant="video"
        tabsVariant="iconOnly"
        identity={{
          name: brandTitle,
          handle: previewSellerBrandName()
            ? PREVIEW_SELLER_IDENTITY.handle
            : atHandle(profile?.username),
          initials: avatarInitials,
          avatarUrl: profile?.avatarPosterUrl || profile?.profileImageUrl || null,
          avatarVideoUrl: profile?.avatarVideoUrl ?? null,
          verified: !!profile?.verified,
          roleLabel: 'Seller',
          // "Seller" chip then the plan chip, side by side on one line,
          // same height and style.
          extraChips: [{ label: planLabel, icon: hasPaidPlan ? 'award' : 'layers' }],
        }}
        avatar={{
          // Accent ring = an unexpired story (verified shows as the check by the name).
          ring: myStoryIds.length > 0,
          onPressStoryBadge: () => nav('/create-post'),
          onLongPress: () => {
            haptics.rigid();
            setAccountSwitcherOpen(true);
          },
          onPress: () => {
            if (myStoryIds.length > 0) {
              router.push({
                pathname: '/buyer-story-viewer' as any,
                params: { storyId: myStoryIds[0], allStoryIds: myStoryIds.join(',') },
              });
            } else {
              router.push('/create-post' as any);
            }
          },
          accessibilityLabel: myStoryIds.length > 0 ? 'View your active story' : 'Create your first story',
        }}
        // The profile video plays behind the header; none set → plain background.
        hero={{ videoUri: coverFlow.cover.videoUrl, posterUri: coverFlow.cover.posterUrl }}
        // TikTok-style banner (image or video) — replaces the header when set.
        banner={banner}
        bannerNote={bannerNote}
        onAddBanner={bannerFlow.openSheet}
        // No edit pencil: "Edit profile" in the action row is its one home.
        topLeft={accountSwitcher}
        topRight={(
          <ProfileTopBarIconRow>
            <ProfileTopBarIcon name="bell"
              onPress={() => nav('/seller-activity')}
              accessibilityLabel={hasUnreadActivity ? 'Activity, new activity' : 'Activity'}
              badge={hasUnreadActivity}
              testID="seller-activity-bell"
            />
            <ProfileTopBarIcon
              name="more-horizontal"
              onPress={(event) => { setMenuAnchor(anchorFromEvent(event)); setMenuOpen(true); }}
              accessibilityLabel="More options"
              testID="seller-profile-more"
            />
          </ProfileTopBarIconRow>
        )}
        meta={(
          <ProfileMeta bio={profile?.bio}>
            <FoundingSellerBadge number={profile?.foundingSellerNumber} />
          </ProfileMeta>
        )}
        stats={stats}
        statsLoading={statsInitialLoading}
        actions={(
          <>
            {/* Polish #99 / #86: on your OWN profile the two actions are
                Edit profile + Share profile, both secondary and equal —
                Depop's own shop (mobbin.com/screens/2cf32147-3d07-4b1e-
                beb5-f5b255c194a0) and the buyer own-profile row, 1:1.
                Messages was the filled "primary" here, which read as the
                main thing to do on your own profile; buyer messages stay
                one tap away in the Studio menu. The labelled Share button
                replaces the unlabelled top-bar share icon. Messages is back
                (Dev: one tap to the inbox from Profile too), with the
                unread-thread count. Dev's TestFlight polish: two buttons —
                Edit profile + a white primary Messages — and Share profile
                moved into the ••• menu. */}
            <View style={s.actionRow}>
              <View style={s.actionFlex}>
                <Button
                  label="Edit profile"
                  variant="secondary"
                  size="compact"
                  fullWidth
                  onPress={() => nav('/edit-profile')}
                  accessibilityHint="Opens your full profile editor."
                  style={[s.actionButton, { backgroundColor: theme.cardElevated, borderColor: theme.cardElevated }]}
                  testID="profile-edit-details"
                />
              </View>
              <View style={s.actionFlex}>
                <Button
                  label="Messages"
                  variant="primary"
                  size="compact"
                  fullWidth
                  onPress={() => { haptics.light(); nav('/seller-inbox'); }}
                  accessibilityLabel={unreadThreads > 0 ? `Messages, ${unreadThreads} unread` : 'Messages'}
                  style={s.actionButton}
                  testID="seller-profile-messages-btn"
                />
                {unreadThreads > 0 && (
                  // Inverted on the white button so the count stays readable.
                  <View pointerEvents="none" style={[s.messagesBadge, { backgroundColor: theme.background, borderColor: theme.accent }]} testID="seller-profile-messages-badge">
                    <Text style={[s.messagesBadgeText, { color: theme.text }]} allowFontScaling={false}>
                      {unreadThreads > 99 ? '99+' : unreadThreads}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </>
        )}
        tabs={{
          items: CONTENT_TAB_ITEMS,
          active: activeTab,
          onChange: (key) => {
            setActiveTab((CONTENT_TABS as readonly string[]).includes(key) ? key as ContentTab : 'Posts');
          },
        }}
        belowTabs={activeTab === 'Shop' && userId && shopProducts.length > 0 ? (
          <View style={s.shopPillWrap}>
            <ShopPill
              label={shopLabel}
              sublabel="Your live listings"
              onPress={() => nav(profileProductsHref({ sellerId: userId, sellerName: brandTitle, isOwner: true }))}
            />
          </View>
        ) : null}
        data={gridData}
        renderItem={renderTile}
        keyExtractor={(row) => row.kind === 'draftsTile' ? 'drafts-tile' : row.kind === 'product' ? `p-${row.product.id}` : row.item.id}
        numColumns={layout.gridColumns}
        listKey={`seller-own-${layout.gridColumns}`}
        ListEmptyComponent={(
          <ProfileGridPlaceholder
            loading={gridLoading}
            error={gridError}
            onRetry={() => {
              if (showingProductsGrid) { void loadShopProducts(); return; }
              if (activeTab === 'Tagged') { void tagged.reload(); return; }
              setPostsLoading(true); void loadPosts();
            }}
            layout={layout}
            icon={empty.icon as IconName}
            title={empty.title}
            description={empty.message}
            action={empty.cta ? { label: empty.cta.label, onPress: () => nav(empty.cta!.route) } : undefined}
            testID={`seller-own-empty-${activeTab.toLowerCase()}`}
            // All three tabs: one shared empty state, identical layout (Dev)
            // — badge + title (+ a slim white pill), ~32px under the tabs.
            actionStyle="pill"
          />
        )}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        bottomInset={sellerBarInset}
      />

      <ProfileMenuSheet
        visible={menuOpen}
        anchor={menuAnchor}
        title={brandTitle}
        onClose={() => setMenuOpen(false)}
        items={[
          // Only what has no other home on this page: Activity is the bell,
          // Edit profile / Messages are the action row, and Share store
          // lives on the Dashboard and My store.
          // Share profile moved here from the action row (same share sheet).
          {
            key: 'share-profile', icon: 'share', label: 'Share profile',
            onPress: () => { haptics.light(); setShareSheetVisible(true); },
          },
          // One menu (polish #98): Settings moved here from its own gear icon.
          { key: 'settings', icon: 'settings', label: 'Settings', onPress: () => nav('/settings') },
          caps.showViewAsVisitor && userId && {
            key: 'view-as-visitor', icon: 'eye', label: 'View as visitor',
            onPress: () => nav(viewAsVisitorHref('seller', userId)),
          },
        ].filter(Boolean) as ProfileMenuItem[]}
      />

      <CoverCoachmarkSheet
        visible={coverFlow.coachmarkVisible}
        onAdd={() => { coverFlow.dismissCoachmark(); coverFlow.startAdd(); }}
        onLater={coverFlow.dismissCoachmark}
      />
      <CoverManageSheet visible={coverFlow.manageOpen} onChange={coverFlow.changeFromManage} onRemove={() => { void coverFlow.remove(); }} onClose={coverFlow.closeManage} />
      <CoverTrimSheet source={coverFlow.trimSource} onCancel={coverFlow.cancelTrim} onConfirm={coverFlow.confirmTrim} />

      <ShareProfileSheet
        visible={shareSheetVisible}
        onClose={() => setShareSheetVisible(false)}
        avatarUrl={profile?.avatarPosterUrl || profile?.profileImageUrl || null}
        // The seller's own @username, so the sheet never has to re-fetch it
        // (and the preview, which has no session, still gets its QR code).
        profileUsername={previewSellerBrandName() ? PREVIEW_SELLER_IDENTITY.username : profile?.username ?? null}
        profileDisplayName={brandTitle}
        profileBrandName={brandTitle}
        sellerExtra={{
          rating: null,
          products: sellerPosts.slice(0, 3).map(p => ({ id: p.id, uri: p.thumbnailUri ?? p.mediaUris?.[0] })),
        }}
      />

      <AccountSwitcherSheet visible={accountSwitcherOpen} onClose={() => setAccountSwitcherOpen(false)} />
      {bannerFlow.sheet}
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  actionRow: { flexDirection: 'row', gap: SP.sm },
  actionFlex: { flex: 1, minWidth: 0 },
  actionButton: { borderRadius: 8, paddingHorizontal: SP.sm },
  // Unread-thread count on the Messages button's corner (same pill as the dashboard icon).
  messagesBadge: {
    position: 'absolute', top: -6, right: -4, minWidth: 18, height: 18, borderRadius: 9,
    paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5,
  },
  messagesBadgeText: { fontSize: FS.xs, lineHeight: 12, fontFamily: FONT.bold },
  shopPillWrap: { paddingTop: SP.sm, paddingBottom: SP.sm },
  draftsTile: {
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  draftsTileTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  draftsTileCount: { fontFamily: FONT.regular, fontSize: FS.meta, color: MUTED },
});
