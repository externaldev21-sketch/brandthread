/**
 * Seller's own Profile tab — ProfileShell in its Instagram own-profile
 * `headerVariant="video"` (profile video behind the controls, avatar, name
 * and bio, fading to solid at the stats row), with the owner's tools:
 * account switcher, notifications / share / settings, Edit Profile (brand
 * name + bio sheet), Go Live, Create Post, quick actions, and Instagram's
 * icon-only Posts / Shop / Tagged tabs over a 4:5 grid.
 *
 * Drafts and scheduled posts (formerly their own tabs) are a sub-filter under
 * Posts (Published / Drafts / Scheduled) so nothing a seller relied on is
 * lost; the Shop tab shows the live listings (tap → product), and Tagged is
 * an honest empty state (sellers have no tagged-post data yet).
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/expo';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Modal, Platform, TextInput,
} from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { getSellerPosts, subscribeSocial, type SellerThreadPost } from '@/services/socialService';
import { useApi } from '@/lib/api';
import { reportNetworkError } from '@/lib/networkNotice';
import {
  CARD, BORDER, FG, MUTED,
  FONT, FS, SP, RADIUS, SURFACE,
} from '@/lib/theme';
import { SheetRise } from '@/components/motion/SheetRise';
import { Button } from '@/components/ui/Button';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { AccountSwitcherSheet } from '@/components/AccountSwitcherSheet';
import { ListRow } from '@/components/ui/ListRow';
import { subscribeProfileEvents } from '@/lib/profileEvents';
import { connectionsHref, productDetailHref, profileProductsHref, profileVideosHref } from '@/lib/profileNavigation';
import { getSellerShopPage, taggedItemHref, type ShopProduct } from '@/services/profileService';
import { formatCompactCount } from '@/lib/compactFormat';
import { ProfileShell, ProfileMeta } from '@/components/profile/ProfileShell';
import {
  ProfileChip, ProfileEditMessagesRow, ShopPill, type ProfileStat, type ProfileTab,
} from '@/components/profile/ProfileControls';
import { ProfileAccountSwitcher, ProfileTopBarIcon, ProfileTopBarIconRow } from '@/components/profile/ProfileTopBar';
import { useSellerActivityUnread } from '@/hooks/useSellerActivityUnread';
import { ProfileVideoTile, gridItemFromThreadPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { profileEmptyState } from '@/components/profile/profileEmptyStates';
import {
  CoverCoachmarkSheet, CoverManageSheet, CoverTrimSheet, useProfileCover,
} from '@/components/profile/ProfileCover';
import { activeStoryIds } from '@/components/profile/profileAvatarGeometry';
import { TILE_ASPECT_3_4, useProfileLayout } from '@/components/profile/profileLayout';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { isSellerDevPreview } from '@/lib/devPreview';
import { profileCapabilities, viewAsVisitorHref } from '@/lib/profileAccess';
import { ProfileMenuSheet, type ProfileMenuItem } from '@/components/profile/ProfileMenuSheet';
import { ProfileProductTile } from '@/components/profile/ProfileProductTile';
import { useTaggedPosts } from '@/components/profile/useTaggedPosts';
import { PREVIEW_SELLER_IDENTITY, previewSellerBrandName } from '@/lib/previewIdentity';

// ─── Profile data shape ──────────────────────────────────────────────────────

interface SellerProfileData {
  brandName:          string | null;
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
        <Feather name="file-text" size={22} color={MUTED} />
        <Text style={s.draftsTileTitle}>Drafts</Text>
        <Text style={s.draftsTileCount}>{count}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function ProfileScreen() {
  const router  = useRouter();
  const api = useApi();
  const hasUnreadActivity = useSellerActivityUnread();
  // Instagram's own-profile grid: 3 columns, 1pt gutters, 4:5 tiles.
  const layout = useProfileLayout({ tileAspect: TILE_ASPECT_3_4 });
  // The seller tab bar floats over content (same metrics as the global bar).
  const sellerBarInset = useTabBarMetrics(2).occupiedHeight;
  const { isLoaded: authLoaded, userId } = useAuth();
  const [activeTab, setActiveTab] = useState<ContentTab>('Posts');
  const [shopProducts, setShopProducts] = useState<ShopProduct[]>([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopError, setShopError] = useState(false);
  const [sellerPosts, setSellerPosts] = useState<SellerThreadPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState(false);
  const [myStoryIds, setMyStoryIds] = useState<string[]>([]);
  const [profile, setProfile] = useState<SellerProfileData | null>(null);
  const coverFlow = useProfileCover({
    own: true,
    cover: { videoUrl: profile?.coverVideoUrl ?? null, posterUrl: profile?.coverPosterUrl ?? null },
    userId,
  });
  const tagged = useTaggedPosts(userId, activeTab === 'Tagged' && !!userId && !isSellerDevPreview());
  const [socialCounts, setSocialCounts] = useState<SocialCounts>({ followers: 0, following: 0, likes: 0 });
  const [productsCount, setProductsCount] = useState<number | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [profileEditorVisible, setProfileEditorVisible] = useState(false);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const caps = profileCapabilities('seller', 'owner');
  const [brandNameInput, setBrandNameInput] = useState('');
  const [bioInput, setBioInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Gates the stats row's "–" placeholder. Tied only to the FIRST load
  // attempt settling (success or failure) via Promise.allSettled below —
  // never to `!profile` — so a slow or failing seller-profile fetch can't
  // strand Posts/Followers/Following/Likes on "–" forever even though those
  // three come from independent, already-resolved sources.
  const [statsInitialLoading, setStatsInitialLoading] = useState(true);
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
      setProfile({
        brandName:          data.brandName   ?? null,
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

  const loadUnreadMessages = useCallback(async () => {
    // isSellerDevPreview() (not just !userId): a stubbed/fake-signed-in
    // Clerk session (this app's own audit/e2e harnesses fake a signed-in
    // user so protected screens render at all) still reports a truthy
    // userId, which would otherwise fall through to the real backend-less
    // endpoints below and log a console 404 — see the identical
    // isSellerDevPreview() fix in app/seller-inbox.tsx.
    if (!authLoaded || !userId || isSellerDevPreview()) return;
    try {
      const list = await api.conversations.list();
      const total = (list as Array<{ unreadCount?: number; type?: string }>)
        .filter((c) => c.type !== 'buyer_to_buyer')
        .reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
      setUnreadMessages(total);
    } catch { /* badge just stays at its last known count */ }
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

  useEffect(() => {
    requestUserRef.current = userId ?? null;
    setSellerPosts([]);
    setMyStoryIds([]);
    setProfile(null);
    setPostsLoading(true);
    setSocialCounts({ followers: 0, following: 0, likes: 0 });
    setStatsInitialLoading(true);
    if (authLoaded && userId && !isSellerDevPreview()) void loadPage();
    if (authLoaded && (!userId || isSellerDevPreview())) { setPostsLoading(false); setStatsInitialLoading(false); }
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
    void loadUnreadMessages();
  }, [loadShopCount, loadSocialCounts, loadUnreadMessages]));

  // Following someone from the feed or a list moves "Following" immediately.
  useEffect(() => subscribeProfileEvents((event) => {
    if (event.type !== 'follow' || !userId) return;
    if (event.viewerId && event.viewerId !== userId) return;
    if (event.targetId === userId) return;
    setSocialCounts((counts) => ({ ...counts, following: Math.max(0, counts.following + (event.isFollowing ? 1 : -1)) }));
  }), [userId]);

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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  function openProfileEditor() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBrandNameInput(profile?.brandName ?? profile?.displayName ?? '');
    setBioInput(profile?.bio ?? '');
    setProfileEditorVisible(true);
  }

  function closeProfileEditor() {
    if (!savingProfile) setProfileEditorVisible(false);
  }

  async function saveProfileDetails() {
    const brandName = brandNameInput.trim();
    const bio = bioInput.trim();
    if (!brandName) {
      Alert.alert('Add a brand name', 'Your Profile needs a brand name before you can save.');
      return;
    }
    if (savingProfile) return;

    setSavingProfile(true);
    try {
      const updated = await api.auth.updateProfile({ brandName, bio });
      setProfile((current) => ({
        brandName: updated.brandName ?? brandName,
        displayName: updated.displayName ?? current?.displayName ?? null,
        bio: updated.bio ?? bio,
        subscriptionStatus: current?.subscriptionStatus ?? null,
        subscriptionPlanId: current?.subscriptionPlanId ?? null,
        totalLikes: current?.totalLikes ?? 0,
        profileImageUrl: current?.profileImageUrl ?? null,
        verified: current?.verified ?? false,
        coverVideoUrl: current?.coverVideoUrl ?? null,
        coverPosterUrl: current?.coverPosterUrl ?? null,
        avatarVideoUrl: current?.avatarVideoUrl ?? null,
        avatarPosterUrl: current?.avatarPosterUrl ?? null,
        metrics: current?.metrics ?? {
          revenueCents: 0,
          visitors: 0,
          orders: 0,
          conversionRate: 0,
        },
      }));
      setProfileEditorVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void loadProfile();
    } catch (error) {
      reportNetworkError(error, saveProfileDetails);
      Alert.alert('Could not save changes', 'Check your connection and try again.');
    } finally {
      setSavingProfile(false);
    }
  }

  // In the dev preview there is no account, so the one shared preview identity is shown here and in Settings / Edit profile.
  const brandTitle = previewSellerBrandName() ?? (profile?.brandName || profile?.displayName || 'My Brand');
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
    const post = sellerPosts.find(candidate => candidate.id === item.id);
    if (!post || !userId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
  }, [brandTitle, router, sellerPosts, userId]);

  const handleShopTilePress = useCallback((item: ProfileGridItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(productDetailHref(item.id, { isOwner: true }) as never);
  }, [router]);

  // The seller's existing full drafts/scheduled list (already supports
  // ?tab=draft) is the destination behind the Instagram-style Drafts tile —
  // no need for a second, in-page filter control.
  const handleDraftsTilePress = useCallback(() => {
    Haptics.selectionAsync();
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
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setAccountSwitcherOpen(true); }}
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
            : profile?.brandName && profile?.displayName && profile.brandName !== profile.displayName
            ? `@${profile.displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}`
            : null,
          initials: avatarInitials,
          avatarUrl: profile?.avatarPosterUrl || profile?.profileImageUrl || null,
          avatarVideoUrl: profile?.avatarVideoUrl ?? null,
          verified: !!profile?.verified,
          roleLabel: 'Seller',
          // Dev's header layout: "Seller" chip on top, the plan chip
          // directly below it — stacked, same height and style.
          extraChips: [{ label: planLabel, icon: hasPaidPlan ? 'award' : 'layers' }],
        }}
        avatar={{
          // Accent ring = an unexpired story (verified shows as the check by the name).
          ring: myStoryIds.length > 0,
          onPressStoryBadge: () => nav('/create-post'),
          onLongPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            setAccountSwitcherOpen(true);
          },
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
              name="share-2"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShareSheetVisible(true);
              }}
              accessibilityLabel="Share profile"
              accessibilityHint="Opens a shareable profile card, QR code, and link"
              testID="seller-share-profile-btn"
            />
            <ProfileTopBarIcon
              name="more-horizontal"
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMenuOpen(true); }}
              accessibilityLabel="More options"
              testID="seller-profile-more"
            />
            <ProfileTopBarIcon name="settings" onPress={() => nav('/settings')} accessibilityLabel="Seller settings" />
          </ProfileTopBarIconRow>
        )}
        meta={(
          <ProfileMeta bio={profile?.bio} />
        )}
        stats={stats}
        statsLoading={statsInitialLoading}
        actions={(
          <>
            {/* Instagram's own business-profile shape (mobbin.com/screens/
                7b7b7c39-39a7-4ba6-bf3a-45c009a4769d, same reference used for
                the visited /seller-profile route in PR #232): a full-width
                "Professional dashboard" row above the action row below.
                Dev's call: drop Share and Contact from the action row
                entirely (Share stays reachable from the top-bar share
                icon above) and replace the old three-button row with just
                Edit (compact, left) + one long Messages button (fills the
                rest of the row) — the nearest real destination for "how
                buyers reach me". Go Live and Create Post live in the Studio
                control center's Sell section (the "+" grid button in the
                tab bar) — Create Post was already there as "Post video";
                Go Live is added alongside it. Settings was already
                duplicated in the top-right gear above. */}
            <ListRow
              icon="bar-chart-2"
              title="Professional dashboard"
              subtitle="Views, followers and content stats"
              chevron
              onPress={() => nav('/(tabs)/')}
              style={s.dashboardRow}
              testID="profile-dashboard-row"
            />
            <View style={s.actionRow}>
              <ProfileEditMessagesRow
                onEdit={() => nav('/edit-profile')}
                onEditLongPress={openProfileEditor}
                onMessages={() => nav('/seller-inbox')}
                unreadCount={unreadMessages}
              />
            </View>
          </>
        )}
        tabs={{
          items: CONTENT_TAB_ITEMS,
          active: activeTab,
          onChange: (key) => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
            icon={empty.icon as keyof typeof Feather.glyphMap}
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
        title={brandTitle}
        onClose={() => setMenuOpen(false)}
        items={[
          caps.showShare && { key: 'share', icon: 'share-2', label: 'Share profile', onPress: () => setShareSheetVisible(true) },
          caps.showViewAsVisitor && userId && {
            key: 'view-as-visitor', icon: 'eye', label: 'View as visitor',
            onPress: () => nav(viewAsVisitorHref('seller', userId)),
          },
        ].filter(Boolean) as ProfileMenuItem[]}
      />

      {/* ── Profile Editor Modal ── */}
      <Modal
        visible={profileEditorVisible}
        transparent
        animationType="fade"
        onRequestClose={closeProfileEditor}
      >
        <KeyboardAvoidingView
          style={s.sheetModal}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity
            style={s.sheetBackdrop}
            activeOpacity={1}
            onPress={closeProfileEditor}
            accessibilityLabel="Close profile editor"
          />
          <SheetRise style={s.sheet}>
            <View style={s.sheetHandle} />
            <View style={s.sheetHeader}>
              <View>
                <Text style={s.sheetTitle}>Edit brand</Text>
                <Text style={s.sheetSubtitle}>Keep your Profile details up to date.</Text>
              </View>
              <TouchableOpacity
                style={s.sheetClose}
                onPress={closeProfileEditor}
                disabled={savingProfile}
                accessibilityLabel="Close profile editor"
              >
                <Feather name="x" size={18} color={FG} />
              </TouchableOpacity>
            </View>

            <Text style={s.inputLabel}>Brand name</Text>
            <TextInput
              value={brandNameInput}
              onChangeText={setBrandNameInput}
              style={s.textInput}
              placeholder="Your brand name"
              placeholderTextColor={MUTED}
              autoCapitalize="words"
              autoCorrect={false}
              maxLength={80}
              returnKeyType="next"
              editable={!savingProfile}
              testID="profile-edit-brand-name"
            />

            <View style={s.bioLabelRow}>
              <Text style={s.inputLabel}>Bio</Text>
              <Text style={s.characterCount}>{bioInput.length}/280</Text>
            </View>
            <TextInput
              value={bioInput}
              onChangeText={setBioInput}
              style={[s.textInput, s.bioInput]}
              placeholder="Tell people about your brand"
              placeholderTextColor={MUTED}
              multiline
              maxLength={280}
              textAlignVertical="top"
              editable={!savingProfile}
              testID="profile-edit-bio"
            />

            <View style={s.sheetActions}>
              <Button
                label="Cancel"
                variant="secondary"
                style={s.cancelButton}
                onPress={closeProfileEditor}
                disabled={savingProfile}
              />
              <Button
                label="Save changes"
                variant="primary"
                loading={savingProfile}
                style={s.saveButton}
                onPress={saveProfileDetails}
                disabled={savingProfile}
                testID="profile-edit-save"
              />
            </View>
          </SheetRise>
        </KeyboardAvoidingView>
      </Modal>

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
        avatarUrl={profile?.profileImageUrl ?? null}
        sellerExtra={{
          rating: null,
          products: sellerPosts.slice(0, 3).map(p => ({ id: p.id, uri: p.thumbnailUri ?? p.mediaUris?.[0] })),
        }}
      />

      <AccountSwitcherSheet visible={accountSwitcherOpen} onClose={() => setAccountSwitcherOpen(false)} />
    </>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  dashboardRow: {
    backgroundColor: CARD, borderColor: BORDER, borderWidth: 1,
    borderRadius: RADIUS.md, marginBottom: SP.sm,
  },
  actionRow: { flexDirection: 'row', gap: SP.sm },
  shopPillWrap: { paddingTop: SP.sm, paddingBottom: SP.sm },
  draftsTile: {
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD,
    alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  draftsTileTitle: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
  draftsTileCount: { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED },

  // Profile editor sheet
  sheetModal:       { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop:    { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.68)' },
  sheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1, borderColor: BORDER, paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: 26,
  },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.lg },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: SP.lg },
  sheetTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg, marginBottom: 4 },
  sheetSubtitle: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm },
  sheetClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center' },
  inputLabel: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, marginBottom: SP.sm },
  bioLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.md },
  characterCount: { color: MUTED, fontFamily: FONT.regular, fontSize: 11, marginBottom: SP.sm },
  textInput: {
    minHeight: 48, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER,
    backgroundColor: SURFACE, color: FG, fontFamily: FONT.regular, fontSize: FS.base,
    paddingHorizontal: SP.md, paddingVertical: 12,
  },
  bioInput: { minHeight: 96, maxHeight: 128 },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: SP.lg },
  cancelButton: { flex: 1 },
  saveButton: { flex: 1.45 },
});
