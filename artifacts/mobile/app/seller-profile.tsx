/**
 * Seller profile — ONE screen, two modes, like Instagram's own-profile vs
 * other-profile: the mode is decided only by `viewerId === sellerId`
 * (lib/profileAccess.ts), never by a route param.
 *
 *  - VISITOR (a buyer / another seller): avatar, name, @username, seller
 *    badge, followers / following / rating, bio + links, then the tabs
 *    Posts | Products | Tagged. Products open the buyer product page (Buy now /
 *    Add to cart). Actions: Follow, Message, and a "..." menu
 *    (Share profile, Report, Block). No plan, dashboard, edit or inbox.
 *  - OWNER: all of the above plus the plan chip, Professional dashboard, Edit
 *    profile, inbox, and edit affordances (not Buy) on the product grid. The
 *    "..." menu has "View as visitor", which re-opens this screen with
 *    `asVisitor=1` — that param can only ever downgrade an owner to visitor.
 *
 * Renders into the shared ProfileShell. Tapping a post opens the full-screen
 * feed player at that post.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { plural } from '@/lib/plural';
import type { MembershipLevel } from '@/lib/api';
import { LEVEL_LABEL } from '@/lib/membershipLevels';
import { Alert, Linking, Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useProfilePostsDefault } from '@/hooks/useProfilePostsDefault';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { enqueueEngagementRetry, ensureEngagementRetryPump, isRetryableFailure } from '@/lib/engagementRetryQueue';
import { useQueryClient } from '@tanstack/react-query';
import { PRESS_IN_REUSE_MS, queryKeys } from '@/lib/queryClient';
import { useAuth } from '@clerk/expo';
import { useSignInGate } from '@/hooks/useSignInGate';
import { useApi } from '@/hooks/useApi';
import { useStoreGiftCards } from '@/hooks/useStoreGiftCards';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { getSellerFollowState, setSellerFollowing, setPostPinned, pinErrorMessage } from '@/services/socialService';
import type { SellerThreadPost } from '@/services/socialService';
import { formatCompactCount } from '@/lib/compactFormat';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { buildCanonicalProfileUrl, shareLinkWithFallback } from '@/lib/shareProfile';
import { followingCountAfter, subscribeProfileEvents } from '@/lib/profileEvents';
import { copyProfileLink } from '@/lib/copyProfileLink';

import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  connectionsHref, messageSellerHref, productDetailHref, profileVideosHref, resolveStoreVisitSource,
} from '@/lib/profileNavigation';
import {
  hasPaidPlan, isVisitorPreviewParam, planChipLabel, profileCapabilities, resolveProfileMode, viewAsVisitorHref,
} from '@/lib/profileAccess';
import { isBuyerDevPreview, isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import { previewOfficialProfile } from '@/lib/previewOfficialAccount';
import { getSellerShopPage, taggedItemHref, type ShopProduct } from '@/services/profileService';
import { ProfileMenuSheet, type ProfileMenuItem } from '@/components/profile/ProfileMenuSheet';
import { anchorFromEvent, type MenuAnchor, openContextMenu } from '@/lib/contextMenu';
import { MenuSheet } from '@/components/ui/MenuSheet';
import { LookbookView } from '@/components/profile/LookbookView';
import { lookbookPreviewHref, parseStoreLayout, resolveStoreLayout, type StoreLayout } from '@/lib/storeLayout';
import { ProfileProductTile } from '@/components/profile/ProfileProductTile';
import { useTaggedPosts } from '@/components/profile/useTaggedPosts';
import { StoreBundlesRow } from '@/components/bundles/StoreBundlesRow';
import { BrandDropsCard } from '@/components/BrandDropsCard';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { confirmBlock, reportHref } from '@/lib/safety';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { MissingItemState } from '@/components/states/MissingItemState';
import { shipsInLabel } from '@/lib/storeTrust';
import { FollowMorphButton } from '@/components/ui/MotionPrimitives';
import { Snackbar } from '@/components/ui/Snackbar';
import { ListRow } from '@/components/ui/ListRow';
import { haptics, hapticLight, hapticSelection, hapticSuccessAction } from '@/lib/haptics';
import { ProfileShell, ProfileMeta } from '@/components/profile/ProfileShell';
import { FoundingSellerBadge, foundingSellerNumberOf } from '@/components/profile/FoundingSellerBadge';
import { ProfileTopBarIcon, ProfileTopBarIconRow } from '@/components/profile/ProfileTopBar';
import {
  ProfileButton, ProfileChip, type ProfileStat, type ProfileTab,
} from '@/components/profile/ProfileControls';
import { ProfileVideoTile, gridItemFromThreadPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { isOfficialAccountId, officialAvatarUri } from '@/lib/officialAccount';
import { ProfileGridFooter, ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { TILE_ASPECT_3_4, useProfileLayout } from '@/components/profile/profileLayout';
import { useCreatorVideos } from '@/components/profile/useCreatorVideos';
import { profileEmptyState } from '@/components/profile/profileEmptyStates';
import {
  CoverCoachmarkSheet, CoverHeroAffordance, CoverManageSheet, CoverTrimSheet, useProfileCover,
} from '@/components/profile/ProfileCover';
import { shareLink } from '@/lib/shareActions';
import { buildPostUrl } from '@/lib/shareLinks';
import { resolveProfileBanner, type ProfileBanner } from '@/components/profile/profileBannerRules';
import { useProfileBannerState } from '@/components/profile/useProfileBanner';
import { useProfileNote } from '@/components/profile/useProfileNote';
import { useProfileBanner } from '@/components/profile/ProfileBannerEditor';

type ContentTab = 'Posts' | 'Shop' | 'Tagged';
// Internal key stays 'Shop'; the label (and accessibility name) is "Products".
const CONTENT_TAB_ITEMS: ProfileTab[] = [
  { key: 'Posts', label: 'Posts', icon: 'grid' },
  { key: 'Shop', label: 'Products', icon: 'shopping-bag' },
  { key: 'Tagged', label: 'Tagged', icon: 'tag' },
];

type GridRow =
  | { kind: 'post'; item: ProfileGridItem }
  | { kind: 'product'; product: ShopProduct };

interface SellerView {
  sellerId: string;
  brandName: string;
  username: string;
  bio: string;
  website?: string;
  location?: string;
  category?: string;
  initials: string;
  verified: boolean;
  /** The official @brandthread account: silver B avatar, "Official" chip, no DMs. */
  isOfficial: boolean;
  avatarUrl: string | null;
  bannerUrl: string | null;
  vacationMode: boolean;
  vacationMessage?: string;
  productsCount: number;
  videosCount: number;
  coverVideoUrl: string | null;
  coverPosterUrl: string | null;
  /** TikTok-style profile banner (image or looping video), null when unset. */
  profileBanner: ProfileBanner | null;
  /** Authoritative public totals from the API (likes on public posts, follower / following counts). */
  likesCount: number | null;
  followersCount: number | null;
  followingCount: number | null;
  /** "Founding Seller #N" (first 100 sellers), else null. */
  foundingSellerNumber: number | null;
  /** Store page layout the seller chose (Store Settings > Lookbook). */
  storeLayout: StoreLayout;
}

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase();
}

function httpOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('http') ? value : null;
}

/** Adapts GET /api/public/sellers/:id (profile block) or GET /api/seller/profile. */
function toSellerView(profile: any, fallbackId: string): SellerView {
  const brandName = profile?.brandName ?? profile?.displayName ?? 'Seller';
  return {
    sellerId: profile?.clerkId ?? profile?.id ?? fallbackId,
    brandName,
    username: profile?.username ?? brandName.toLowerCase().replace(/[^a-z0-9]/g, ''),
    bio: profile?.bio ?? '',
    website: profile?.website ?? undefined,
    location: profile?.location ?? undefined,
    category: profile?.category ?? undefined,
    initials: initialsOf(brandName),
    verified: profile?.verified === true,
    isOfficial: profile?.isOfficial === true || isOfficialAccountId(profile?.clerkId),
    // The official account always wears the bundled app mark — its stored
    // avatar URL may be stale or broken, and the mark must match feed/comments/share.
    avatarUrl: (profile?.isOfficial === true || isOfficialAccountId(profile?.clerkId))
      ? (officialAvatarUri() ?? httpOrNull(profile?.profileImageUrl) ?? httpOrNull(profile?.avatarUrl))
      : (httpOrNull(profile?.profileImageUrl) ?? httpOrNull(profile?.avatarUrl)),
    bannerUrl: httpOrNull(profile?.bannerUrl),
    vacationMode: Boolean(profile?.vacationMode),
    vacationMessage: profile?.vacationMessage ?? undefined,
    productsCount: Number(profile?.productsCount ?? 0),
    videosCount: Number(profile?.videosCount ?? 0),
    coverVideoUrl: httpOrNull(profile?.coverVideoUrl),
    coverPosterUrl: httpOrNull(profile?.coverPosterUrl),
    profileBanner: resolveProfileBanner(profile),
    likesCount: typeof profile?.likesCount === 'number' ? profile.likesCount : null,
    followersCount: typeof profile?.followersCount === 'number' ? profile.followersCount : null,
    followingCount: typeof profile?.followingCount === 'number' ? profile.followingCount : null,
    foundingSellerNumber: foundingSellerNumberOf(profile?.foundingSellerNumber),
    storeLayout: parseStoreLayout(profile?.storeLayout),
  };
}

export default function SellerProfileScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const headerTopInset = useHeaderTopInset();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; sellerId?: string; isOwner?: string; src?: string; asVisitor?: string; lookbook?: string }>();
  const routeSellerId = params.id ?? params.sellerId;
  const api = useApi();
  const { isLoaded: authLoaded, userId } = useAuth();
  const { requireSignIn, goToSignIn } = useSignInGate();
  const layout = useProfileLayout({ tileAspect: TILE_ASPECT_3_4 });
  // Clears the floating buyer tab bar when this screen is reached from the
  // buyer shell (viewing a brand's public profile); a no-op elsewhere.
  const barInset = useBuyerTabBarInset();

  // Cache-first (visitor view): the public seller row warmed by a press-in
  // prefetch or a recent visit paints the header on the first frame; the
  // load below refreshes it. Owner loads (isOwner=true, no id) are unchanged.
  const queryClient = useQueryClient();
  const [cachedSellerView] = useState<SellerView | null>(() => {
    if (!routeSellerId || (params.isOwner === 'true' && !routeSellerId)) return null;
    const data = queryClient.getQueryData<{ profile?: any }>(queryKeys.publicSeller(routeSellerId));
    return data?.profile ? toSellerView(data.profile, routeSellerId) : null;
  });
  const [seller, setSeller] = useState<SellerView | null>(cachedSellerView);
  const hasSellerRef = useRef(false);
  hasSellerRef.current = !!seller;
  const sellsGiftCards = useStoreGiftCards(seller?.sellerId);
  const [profileLoading, setProfileLoading] = useState(!cachedSellerView);
  const [profileError, setProfileError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followsMe, setFollowsMe] = useState(false);
  const [followers, setFollowers] = useState<number | null>(cachedSellerView?.followersCount ?? null);
  const [following, setFollowing] = useState<number | null>(cachedSellerView?.followingCount ?? null);
  const [likes, setLikes] = useState<number | null>(cachedSellerView?.likesCount ?? null);
  const [pronouns, setPronouns] = useState<string | null>(null);
  const [followPending, setFollowPending] = useState(false);
  const [rating, setRating] = useState<{ avgRating: number; totalCount: number } | null>(null);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState<SellerThreadPost | null>(null);
  const [snackbar, setSnackbar] = useState('');
  const [activeTab, setActiveTab] = useState<ContentTab>('Posts');
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);
  const [shopProducts, setShopProducts] = useState<ShopProduct[]>([]);
  const [shopLoading, setShopLoading] = useState(false);
  const [shopError, setShopError] = useState(false);
  const [plan, setPlan] = useState<{ planId: string | null; status: string | null } | null>(null);

  // `isOwner=true` only means "load my own profile when no id is given" (the
  // /seller/profile read is scoped to the signed-in user, so it can only ever
  // return the caller's own record). It never grants owner UI by itself.
  const loadOwnProfile = params.isOwner === 'true' && !routeSellerId;
  const previewAsVisitor = isVisitorPreviewParam(params.asVisitor);
  // Canonical Clerk id from the API — follow/message/report/videos all use it,
  // never the route alias (which may be the users.id UUID from /u/:username).
  const canonicalSellerId = seller?.sellerId ?? null;
  const mode = resolveProfileMode({ viewerId: userId, ownerId: canonicalSellerId, previewAsVisitor });
  const isOwner = mode === 'owner';
  // The viewing buyer's own level with this brand, shown quietly in the header (never to anyone else).
  const [myLevel, setMyLevel] = useState<MembershipLevel | null>(null);
  useEffect(() => {
    if (!canonicalSellerId || isOwner || !userId) { setMyLevel(null); return; }
    let active = true;
    Promise.resolve().then(() => api.brandMembership.brand(canonicalSellerId))
      .then((m) => { if (active) setMyLevel(m.level); })
      .catch(() => { if (active) setMyLevel(null); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canonicalSellerId, isOwner, userId]);
  const caps = profileCapabilities('seller', mode);
  useProfilePostsDefault(setActiveTab, `${routeSellerId ?? 'own'}:${userId ?? ''}`);
  // Lookbook (Store Settings): visitors get the full-screen editorial swipe
  // when the seller turned it on; the owner's "Preview lookbook" forces it.
  // A visitor can still open the full store page from inside it.
  const [visitorChoseGrid, setVisitorChoseGrid] = useState(false);
  const storeLayout = resolveStoreLayout({
    saved: seller?.storeLayout,
    isOwner,
    previewLookbook: previewAsVisitor && isVisitorPreviewParam(params.lookbook),
    visitorChoseGrid,
  });
  const showLookbook = !!seller && storeLayout === 'lookbook';
  // The signed-out web preview (?bt_preview=…) must never reach protected APIs.
  const devPreview = isSellerDevPreview() || isBuyerDevPreview();

  // Replays row in the "..." menu: only when this seller has >=1 saved live
  // replay the viewer may see (public API; never called from the dev preview).
  const [replayCount, setReplayCount] = useState(0);
  useEffect(() => {
    if (!canonicalSellerId || devPreview) return undefined;
    let active = true;
    api.liveReplays.bySeller(canonicalSellerId, { limit: 1 })
      .then((res) => { if (active) setReplayCount(res.replays.length); })
      .catch(() => { if (active) setReplayCount(0); });
    return () => { active = false; };
  }, [api, canonicalSellerId, devPreview]);

  // ── Profile load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    // The signed-out preview has no Clerk session; its own profile comes from
    // the preview data layer (lib/previewApiData.ts) instead of an error.
    if (loadOwnProfile && !devPreview && (!authLoaded || !userId)) {
      if (authLoaded) { setProfileLoading(false); setProfileError(true); }
      return () => { active = false; };
    }
    (async () => {
      if (reloadTick === 0 && !hasSellerRef.current) setProfileLoading(true);
      setProfileError(false);
      try {
        let view: SellerView;
        if (loadOwnProfile) {
          const own = await api.seller.getProfile();
          const publicData = devPreview ? null : await api.publicSellers.get(own.clerkId).catch(() => null);
          // The public read carries the signed avatar URL, live counts and the
          // derived verified badge; the owner read adds private fields.
          view = toSellerView({ ...own, ...(publicData?.profile ?? {}) }, own.clerkId);
          setPlan({ planId: own.subscriptionPlanId ?? null, status: own.subscriptionStatus ?? null });
        } else {
          if (!routeSellerId) throw new Error('Seller not found.');
          if (devPreview && isPreviewDemoMode() && isOfficialAccountId(routeSellerId)) {
            // demo=1 preview only: the official account's sample profile.
            view = toSellerView(previewOfficialProfile(), routeSellerId);
            if (!active) return;
            setSeller(view);
            setLikes(view.likesCount ?? 0);
            setFollowers(view.followersCount);
            setFollowing(view.followingCount);
            return;
          }
          api.publicSellers.recordVisit(routeSellerId).catch(() => {});
          // Real per-source traffic tracking for the seller's own Dashboard —
          // fire-and-forget, never blocks this screen's own load.
          api.publicSellers
            .recordStoreVisit(routeSellerId, { source: resolveStoreVisitSource(params.src) })
            .catch(() => {});
          const data = await queryClient.fetchQuery({
            queryKey: queryKeys.publicSeller(routeSellerId),
            queryFn: () => api.publicSellers.get(routeSellerId),
            // Reuse only a press-in prefetch from moments ago; counts change.
            staleTime: reloadTick === 0 ? PRESS_IN_REUSE_MS : 0,
          });
          view = toSellerView(data.profile ?? {}, routeSellerId);
        }
        if (!active) return;
        setSeller(view);
        // The public profile's totals are authoritative (computed server-side, not from a loaded page).
        if (view.likesCount != null) setLikes(view.likesCount);
        if (view.followersCount != null) setFollowers((count) => count ?? view.followersCount);
        if (view.followingCount != null) setFollowing((count) => count ?? view.followingCount);
      } catch {
        // A cached profile already on screen stays up on a bad connection.
        if (active && reloadTick === 0 && !hasSellerRef.current) setProfileError(true);
      } finally {
        if (active) { setProfileLoading(false); setRefreshing(false); }
      }
    })();
    return () => { active = false; };
  }, [api, authLoaded, devPreview, loadOwnProfile, routeSellerId, userId, reloadTick]);

  // ── Social counts + follow state (public counts for everyone; follow
  // state only once signed in) ──────────────────────────────────────────────
  useEffect(() => {
    // The public seller response supplies guest-safe totals; signed-in viewers
    // also fetch their relationship state from the social endpoint.
    if (!canonicalSellerId || !userId) return;
    let active = true;
    Promise.allSettled([
      (!isOwner && userId) ? getSellerFollowState(canonicalSellerId) : Promise.resolve(null),
      api.social.profile(canonicalSellerId),
    ]).then(([followState, social]) => {
      if (!active) return;
      if (followState.status === 'fulfilled' && followState.value) {
        setIsFollowing(followState.value.isFollowing);
        setFollowsMe(followState.value.isFollowedBy === true);
        if (typeof followState.value.followersCount === 'number') setFollowers(followState.value.followersCount);
      }
      if (social.status === 'fulfilled' && social.value) {
        setFollowers(Number(social.value.followersCount ?? 0));
        setFollowing(Number(social.value.followingCount ?? 0));
        if (typeof social.value.likesCount === 'number') setLikes(social.value.likesCount);
        setPronouns(social.value.pronouns ?? null);
      }
    });
    return () => { active = false; };
  }, [api, canonicalSellerId, isOwner, userId, reloadTick]);

  // ── Ships in N days (feature 65): from the seller's own shipping zones ───────
  const [processingDays, setProcessingDays] = useState<number | null>(null);
  useEffect(() => {
    if (!canonicalSellerId) return;
    let active = true;
    api.reviews.storeTrust(canonicalSellerId)
      .then((data) => { if (active) setProcessingDays(data.processingDays ?? null); })
      .catch(() => {});
    return () => { active = false; };
  }, [api, canonicalSellerId, reloadTick]);
  const shipsIn = shipsInLabel(processingDays);

  // ── Rating ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canonicalSellerId) return;
    let active = true;
    api.reviews.forSeller(canonicalSellerId)
      .then((data: any) => { if (active) setRating({ avgRating: data.avgRating ?? 0, totalCount: data.totalCount ?? 0 }); })
      .catch(() => {});
    return () => { active = false; };
  }, [api, canonicalSellerId, reloadTick]);

  // ── Owner-only: the plan chip. Fetched only in owner mode (never in the
  // visitor preview), and the endpoint itself is scoped to the caller. ─────────
  useEffect(() => {
    if (!isOwner || loadOwnProfile || devPreview || !authLoaded || !userId) { if (!isOwner) setPlan(null); return; }
    let active = true;
    api.seller.getProfile()
      .then((own: any) => { if (active) setPlan({ planId: own?.subscriptionPlanId ?? null, status: own?.subscriptionStatus ?? null }); })
      .catch(() => {});
    return () => { active = false; };
  }, [api, authLoaded, devPreview, isOwner, loadOwnProfile, userId, reloadTick]);

  // ── Products tab: the seller's live listings (public read, same source as
  // product detail and checkout) ────────────────────────────────────────────────
  const loadShop = useCallback(async () => {
    if (!canonicalSellerId) return;
    setShopLoading(true);
    setShopError(false);
    try {
      const page = await getSellerShopPage(canonicalSellerId, 0);
      setShopProducts(page.products);
    } catch {
      setShopError(true);
    } finally {
      setShopLoading(false);
    }
  }, [canonicalSellerId]);
  useEffect(() => {
    if (activeTab === 'Shop' || showLookbook) void loadShop();
  }, [activeTab, loadShop, reloadTick, showLookbook]);

  const tagged = useTaggedPosts(canonicalSellerId, activeTab === 'Tagged' && !!userId && !devPreview);

  // ── Follow changes made anywhere else (feed rail, lists) update counts here ─
  useEffect(() => subscribeProfileEvents((event) => {
    if (event.type !== 'follow' || !canonicalSellerId) return;
    if (event.targetId === canonicalSellerId) {
      setIsFollowing(event.isFollowing);
      if (typeof event.followersCount === 'number') setFollowers(event.followersCount);
    } else if (isOwner && event.viewerId === canonicalSellerId) {
      setFollowing((count) => (count == null ? count : followingCountAfter(count, event)));
    }
  }), [canonicalSellerId, isOwner]);

  const videos = useCreatorVideos(canonicalSellerId, { fresh: isOwner, asVisitor: previewAsVisitor });
  const coverFlow = useProfileCover({
    own: isOwner,
    cover: { videoUrl: seller?.coverVideoUrl ?? null, posterUrl: seller?.coverPosterUrl ?? null },
    userId: canonicalSellerId,
  });
  const banner = useProfileBannerState({ server: seller?.profileBanner ?? null, ownerId: canonicalSellerId, own: isOwner });
  const bannerNote = useProfileNote({ userId: canonicalSellerId, own: isOwner, enabled: !!banner });
  // Owner (not "view as visitor") with no banner: a dark "Add banner" placeholder.
  const bannerFlow = useProfileBanner({ banner, userId: canonicalSellerId });

  // Returning to this profile (after posting, editing listings, deleting a
  // video, or following from another screen) silently refetches counts,
  // products and videos instead of showing the pre-change snapshot.
  const focusCountRef = useRef(0);
  const reloadVideos = videos.reload;
  useFocusEffect(useCallback(() => {
    focusCountRef.current += 1;
    if (focusCountRef.current === 1) return;
    setReloadTick((tick) => tick + 1);
    void reloadVideos({ fresh: true });
  }, [reloadVideos]));

  useEffect(() => {
    if (!snackbar) return;
    const timer = setTimeout(() => setSnackbar(''), 2200);
    return () => clearTimeout(timer);
  }, [snackbar]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setReloadTick((tick) => tick + 1);
    void videos.reload({ fresh: true });
  }, [videos]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleFollow = useCallback(async () => {
    if (followPending || !canonicalSellerId || !authLoaded) return;
    // The signed-out developer preview must not invent a follow on a real
    // official account. A real identity is required for server persistence.
    if (seller?.isOfficial && !userId && !isPreviewDemoMode()) {
      goToSignIn();
      return;
    }
    if (!requireSignIn()) return;
    const previous = { isFollowing, followers };
    const next = !isFollowing;
    setFollowPending(true);
    setIsFollowing(next);
    setFollowers((count) => (count == null ? count : Math.max(0, count + (next ? 1 : -1))));
    try {
      const confirmed = await setSellerFollowing(canonicalSellerId, next);
      setIsFollowing(confirmed.isFollowing);
      if (confirmed.followersCount != null) setFollowers(confirmed.followersCount);
    } catch (error) {
      // Bad connection: keep what the buyer tapped and deliver it in the
      // background (lib/engagementRetryQueue.ts). Only a real refusal rolls back.
      if (isRetryableFailure(error)) {
        void enqueueEngagementRetry({ kind: 'follow', targetId: canonicalSellerId, payload: { value: next ? undefined : 'unfollow' } });
        ensureEngagementRetryPump();
        return;
      }
      setIsFollowing(previous.isFollowing);
      setFollowers(previous.followers);
      Alert.alert('Couldn’t update follow', 'Check your connection and try again.');
    } finally {
      setFollowPending(false);
    }
  }, [authLoaded, canonicalSellerId, followPending, followers, goToSignIn, isFollowing, requireSignIn, seller?.isOfficial, userId]);

  const handleShare = useCallback(() => {
    if (!seller) return;
    if (isOwner) {
      setShareSheetVisible(true);
      return;
    }
    const url = buildCanonicalProfileUrl(seller.username);
    if (!url) {
      if (Platform.OS !== 'web') void Share.share({ message: `Check out @${seller.username} on Brandthread` }).catch(() => {});
      return;
    }
    void shareLinkWithFallback({
      url,
      message: `Check out ${seller.brandName} on Brandthread:`,
      platformOS: Platform.OS,
      nativeShare: (content) => Share.share(content),
      webNavigator: typeof navigator !== 'undefined' ? (navigator as any) : null,
    })
      .then((result) => { if (result === 'copied') setSnackbar('Profile link copied'); })
      .catch(() => {});
  }, [isOwner, seller]);

  const handleMessageSeller = useCallback(() => {
    if (!seller) return;
    if (seller.vacationMode) {
      Alert.alert('Seller is away', seller.vacationMessage ?? 'This seller is currently away and is not accepting new messages.');
      return;
    }
    if (!requireSignIn()) return;
    router.push(messageSellerHref({
      sellerId: seller.sellerId,
      sellerName: seller.brandName,
      handle: seller.username,
      initials: seller.initials,
    }) as never);
  }, [router, seller, requireSignIn]);

  const handleOpenInbox = useCallback(() => {
    router.push((isOwner ? '/seller-inbox' : '/(buyer)/inbox') as never);
  }, [isOwner, router]);

  const menuItems = useMemo<ProfileMenuItem[]>(() => {
    if (!seller) return [];
    const sellerId = seller.sellerId;
    const items: ProfileMenuItem[] = [];
    if (caps.showShare) items.push({ key: 'share', icon: 'share-2', label: 'Share profile', onPress: handleShare });
    if (caps.showShare && seller.username) {
      items.push({
        key: 'copy-link', icon: 'link', label: 'Copy profile link',
        onPress: () => { void copyProfileLink(seller.username, Clipboard.setStringAsync).then((ok) => { if (ok) { hapticSuccessAction(); setSnackbar('Link copied'); } }); },
      });
    }
    if (replayCount > 0) {
      items.push({
        key: 'replays', icon: 'video', label: 'Replays',
        onPress: () => router.push(`/live-replays?sellerId=${encodeURIComponent(sellerId)}` as never),
      });
    }
    if (caps.showViewAsVisitor) {
      items.push({
        key: 'view-as-visitor', icon: 'eye', label: 'View as visitor',
        onPress: () => router.push(viewAsVisitorHref('seller', sellerId) as never),
      });
      // Owner-only: see the store page as buyers will in Lookbook mode,
      // whether or not it is switched on yet.
      items.push({
        key: 'preview-lookbook', icon: 'image', label: 'Preview lookbook',
        onPress: () => router.push(lookbookPreviewHref(sellerId) as never),
      });
    }
    if (caps.showVisitorMenu && sellsGiftCards) {
      items.push({
        key: 'gift-cards', icon: 'gift', label: 'Gift cards',
        onPress: () => router.push(`/gift-card-buy?sellerId=${encodeURIComponent(sellerId)}&name=${encodeURIComponent(seller.brandName)}` as never),
      });
    }
    if (caps.showVisitorMenu) {
      items.push(
        {
          key: 'report', icon: 'flag', label: 'Report',
          onPress: () => router.push(reportHref({
            targetType: 'profile', targetId: sellerId, label: seller.brandName, ownerId: sellerId, ownerName: seller.brandName,
          }) as never),
        },
        {
          key: 'block', icon: 'slash', label: `Block ${seller.brandName}`, destructive: true,
          onPress: async () => {
            if (await confirmBlock({ userId: sellerId, name: seller.brandName }, api.social.block)) {
              if (router.canGoBack()) goBackOr(router);
              else router.replace('/(buyer)/' as never);
            }
          },
        },
      );
    }
    return items;
  }, [api, caps.showShare, caps.showViewAsVisitor, caps.showVisitorMenu, handleShare, replayCount, router, seller, sellsGiftCards]);

  const openVideo = useCallback((item: ProfileGridItem) => {
    if (!seller) return;
    if (item.surface === 'profile') {
      // POST (3:4 carousel): its own viewer, not the Threads video player.
      router.push(('/buyer-post-viewer?postId=' + encodeURIComponent(item.id)) as never);
      return;
    }
    router.push(profileVideosHref({ source: 'creator', id: seller.sellerId, startPostId: item.id, title: seller.brandName }) as never);
  }, [router, seller]);

  // Instagram "Pin to your profile" / "Unpin from profile" (max 3, pinned first).
  const handleTogglePin = useCallback(async (post: SellerThreadPost) => {
    const pin = !post.pinnedAt;
    try {
      const result = await setPostPinned(post.id, pin);
      if (!result) return;
      hapticSuccessAction();
      setSnackbar(pin ? 'Pinned to your profile' : 'Unpinned from profile');
      void videos.reload({ fresh: true });
    } catch (error) {
      Alert.alert(pin ? 'Couldn’t pin post' : 'Couldn’t unpin post', pinErrorMessage(error));
    }
  }, [videos]);

  const handleCopyPostLink = useCallback(async (post: SellerThreadPost) => {
    const profileUrl = seller ? buildCanonicalProfileUrl(seller.username) : null;
    const url = profileUrl ? `${profileUrl}?post=${encodeURIComponent(post.id)}` : null;
    if (!url) { Alert.alert('Couldn’t copy link', 'Try again.'); return; }
    await Clipboard.setStringAsync(url);
    setSnackbar('Link copied');
  }, [seller]);

  // Long-press a tile: the Instagram grid preview menu (the post enlarged
  // over a blurred screen, actions under it). Tapping the preview plays it.
  const handleTileLongPress = useCallback((item: ProfileGridItem) => {
    if (!isOwner) return;
    const post = videos.posts.find((candidate) => candidate.id === item.id) ?? null;
    if (!post) return;
    const shareUrl = buildPostUrl(post.id);
    const opened = openContextMenu({
      preview: {
        imageUri: item.posterUri,
        aspectRatio: 9 / 16,
        title: seller?.brandName,
        subtitle: post.caption || undefined,
        avatarUri: seller?.avatarUrl,
      },
      onPreviewPress: () => openVideo(gridItemFromThreadPost(post)),
      items: [
        { key: 'edit', label: 'Edit post', icon: 'edit-2', onPress: () => router.push(('/create-post?editId=' + post.id) as never) },
        { key: 'analytics', label: 'View analytics', icon: 'bar-chart-2', onPress: () => router.push(('/post-analytics?id=' + post.id) as never) },
        ...(shareUrl ? [{ key: 'share', label: 'Share', icon: 'share' as const, onPress: () => { void shareLink(shareUrl, post.caption || 'My post on Brandthread'); } }] : []),
        { key: 'copy', label: 'Copy link', icon: 'link', onPress: () => { void handleCopyPostLink(post); } },
      ],
    });
    if (!opened) setSelectedPost(post);
  }, [isOwner, videos.posts, seller, openVideo, router, handleCopyPostLink]);

  // Owner → the seller's own product screen (edit); visitor → the buyer
  // product page, where Buy now / Add to cart / gallery / sizes / reviews live.
  const openProduct = useCallback((product: ShopProduct) => {
    router.push(productDetailHref(product.id, { isOwner: caps.canEditProducts, src: 'profile' }) as never);
  }, [caps.canEditProducts, router]);

  const openTagged = useCallback((item: ProfileGridItem) => {
    const entry = tagged.items.find((candidate) => candidate.id === item.id);
    if (!entry) return;
    router.push(taggedItemHref(entry) as never);
  }, [router, tagged.items]);

  const postItems = useMemo(() => videos.posts.map(gridItemFromThreadPost), [videos.posts]);
  const taggedItems = useMemo<ProfileGridItem[]>(() => tagged.items.map((entry) => ({
    id: entry.id,
    kind: entry.mediaType === 'video' ? 'video' : entry.mediaType === 'slideshow' ? 'slideshow' : 'photo',
    posterUri: entry.posterUri,
    caption: entry.caption ?? '',
    productCount: 0,
  })), [tagged.items]);
  const gridData = useMemo<GridRow[]>(() => {
    if (activeTab === 'Shop') return shopProducts.map((product) => ({ kind: 'product' as const, product }));
    const source = activeTab === 'Tagged' ? taggedItems : postItems;
    return source.map((item) => ({ kind: 'post' as const, item }));
  }, [activeTab, postItems, shopProducts, taggedItems]);
  const gridItems = postItems;
  const renderTile = useCallback(({ item, index }: { item: GridRow; index: number }) => {
    if (item.kind === 'product') {
      return (
        <ProfileProductTile
          product={item.product}
          width={layout.tileWidth}
          height={layout.tileHeight}
          owner={caps.canEditProducts}
          onPress={openProduct}
        />
      );
    }
    return (
      <ProfileVideoTile
        item={item.item}
        index={index}
        width={layout.tileWidth}
        height={layout.tileHeight}
        onPress={activeTab === 'Tagged' ? openTagged : openVideo}
        onLongPress={isOwner && activeTab === 'Posts' ? handleTileLongPress : undefined}
      />
    );
  }, [activeTab, caps.canEditProducts, handleTileLongPress, isOwner, layout.tileHeight, layout.tileWidth, openProduct, openTagged, openVideo]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) goBackOr(router);
    else router.replace('/' as never);
  }, [router]);

  // ── No seller id and not the own-profile route: nothing to load ────────────
  if (!routeSellerId && !loadOwnProfile) {
    return <MissingItemState headerTitle="Profile" icon="user-x" title="Profile not found" message="This link is missing the seller it belongs to." />;
  }

  // ── Error: the profile itself couldn't load ────────────────────────────────
  if (profileError && !seller) {
    return (
      <View style={[styles.errorRoot, { paddingTop: headerTopInset + SP.sm }]}>
        <View style={styles.errorBar}>
          <ProfileTopBarIcon name="arrow-left" onPress={goBack} accessibilityLabel="Go back" />
        </View>
        <EmptyState
          icon="alert-triangle"
          title="Couldn't load this profile"
          description="Check your connection and try again."
          action={{ label: 'Retry', onPress: () => { setProfileLoading(true); setProfileError(false); setReloadTick((tick) => tick + 1); } }}
        />
      </View>
    );
  }

  const brandName = seller?.brandName ?? '';
  const firstVideo = videos.posts.find((post) => post.contentType === 'video' && post.mediaUris[0]);
  const heroPoster = firstVideo?.thumbnailUri
    ?? seller?.bannerUrl
    ?? (gridItems[0]?.posterUri ?? null);
  const videosCount = Math.max(videos.total, seller?.videosCount ?? 0);
  const productsCount = seller?.productsCount ?? 0;

  // Likes comes from the public profile total, not the paginated video grid.
  const stats: ProfileStat[] = [
    {
      key: 'followers', label: 'Followers', value: followers == null ? '–' : formatCompactCount(followers),
      onPress: canonicalSellerId ? () => router.push(connectionsHref('followers', isOwner ? null : canonicalSellerId) as never) : undefined,
    },
    {
      key: 'following', label: 'Following', value: following == null ? '–' : formatCompactCount(following),
      onPress: canonicalSellerId ? () => router.push(connectionsHref('following', isOwner ? null : canonicalSellerId) as never) : undefined,
    },
    { key: 'likes', label: 'Likes', value: likes == null ? '–' : formatCompactCount(likes) },
  ];

  const actions = isOwner ? (
    <>
      {/* Instagram's own-profile shape: a full-width "Professional dashboard"
          row above Edit profile / Share profile. Owner-only — visitors never
          get the dashboard, edit, plan or inbox (lib/profileAccess.ts). */}
      {caps.showDashboard ? (
        <ListRow
          icon="bar-chart-2"
          title="Professional dashboard"
          subtitle="Views, followers and content stats"
          subtitleNumberOfLines={2}
          chevron
          // navigate (not push): this switches to the existing Dashboard tab
          // rather than stacking a duplicate instance of the whole tab
          // navigator on top of itself.
          onPress={() => router.navigate('/(tabs)' as never)}
          style={styles.dashboardRow}
          testID="seller-profile-dashboard"
        />
      ) : null}
      <View style={styles.actionRow}>
        {caps.showEditProfile ? (
          <ProfileButton label="Edit profile" icon="edit-3" variant="primary" onPress={() => router.push('/edit-profile' as never)} testID="seller-profile-edit" />
        ) : null}
        <ProfileButton
          label="Share profile"
          icon="share-2"
          onPress={handleShare}
          accessibilityHint="Opens your shareable profile link and QR code"
          testID="seller-profile-share-btn"
        />
      </View>
    </>
  ) : (
    <View style={styles.actionRow}>
      <View style={styles.flex} testID="seller-profile-follow-btn">
        <FollowMorphButton
          following={isFollowing}
          onChange={handleFollow}
          disabled={previewAsVisitor || followPending || !canonicalSellerId || !authLoaded || (!userId && !seller?.isOfficial)}
          followLabel={followsMe ? 'Follow back' : 'Follow'}
          followingLabel={followsMe ? 'Friends' : 'Following'}
          followingIcon={followsMe ? 'users' : undefined}
          style={styles.followBtn}
          labelStyle={{ fontFamily: FONT.bold, fontSize: FS.base }}
        />
      </View>
      {/* Nobody reads @brandthread's inbox — the account has no login. */}
      {seller?.isOfficial ? null : (
        <ProfileButton label="Message" icon="message-circle" variant="outline" onPress={handleMessageSeller} disabled={previewAsVisitor} testID="seller-profile-message" />
      )}
    </View>
  );

  const meta = seller ? (
    <ProfileMeta
      bio={seller.bio}
      website={seller.website}
      location={seller.location}
      onOpenWebsite={(url) => { void Linking.openURL(url); }}
    >
      <FoundingSellerBadge number={seller.foundingSellerNumber} />
      {myLevel ? <ProfileChip label={`Your level: ${LEVEL_LABEL[myLevel]}`} /> : null}
      {seller.category ? <ProfileChip label={seller.category} icon="tag" /> : null}
      {rating && rating.totalCount > 0 ? (
        <Pressable
          onPress={() => router.push({ pathname: '/store-reviews', params: { sellerId: canonicalSellerId ?? '' } } as never)}
          accessibilityRole="button"
          accessibilityLabel={`${rating.avgRating.toFixed(1)} stars, ${rating.totalCount} reviews. Open reviews`}
          testID="seller-profile-rating-chip"
        >
          <ProfileChip label={`${rating.avgRating.toFixed(1)} · ${plural(rating.totalCount, 'review')}`} icon="star" />
        </Pressable>
      ) : null}
      {shipsIn ? <ProfileChip label={shipsIn} icon="truck" /> : null}
      {seller.verified ? (
        <Pressable
          onPress={() => router.push('/verified-brands' as never)}
          accessibilityRole="button"
          accessibilityLabel="Verified brand. What this means"
          testID="seller-profile-verified-chip"
        >
          <ProfileChip label="Verified brand" icon="check-circle" />
        </Pressable>
      ) : null}
      {caps.showPlanChip && plan ? (
        <ProfileChip
          label={planChipLabel(plan)}
          icon={hasPaidPlan(plan) ? 'award' : 'layers'}
          tone={hasPaidPlan(plan) ? 'accent' : 'muted'}
        />
      ) : null}
      {previewAsVisitor ? (
        <View style={styles.previewBanner} testID="seller-profile-visitor-preview">
          <Icon name="eye" size={16} color={theme.text} />
          <Text style={styles.previewText}>You’re viewing your profile as a visitor</Text>
          <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Exit visitor view" testID="seller-profile-exit-preview">
            <Text style={styles.previewExit}>Exit</Text>
          </Pressable>
        </View>
      ) : null}
      {!isOwner && seller.vacationMode ? (
        <View style={styles.vacation} accessibilityRole="alert">
          <Icon name="sun" size={16} color={theme.warning} />
          <View style={styles.flex}>
            <Text style={styles.vacationTitle}>This seller is away</Text>
            <Text style={styles.vacationText}>{seller.vacationMessage ?? 'Purchases and new messages are paused for now.'}</Text>
          </View>
        </View>
      ) : null}
    </ProfileMeta>
  ) : null;

  const videosEmpty = profileEmptyState('seller:videos', isOwner);
  const emptyKey = activeTab === 'Shop' ? 'shop' as const : activeTab === 'Tagged' ? 'seller:tagged' as const : null;
  const tabEmpty = emptyKey ? profileEmptyState(emptyKey, isOwner) : null;
  const gridLoadingNow = activeTab === 'Shop' ? shopLoading && shopProducts.length === 0
    : activeTab === 'Tagged' ? tagged.loading
    : profileLoading || videos.loading;
  const gridErrorNow = activeTab === 'Shop' ? shopError : activeTab === 'Tagged' ? tagged.error : videos.error;

  if (showLookbook && seller) {
    return (
      <>
        <LookbookView
          brandName={brandName}
          products={shopProducts}
          loading={shopLoading}
          following={isFollowing}
          followDisabled={previewAsVisitor || followPending || !canonicalSellerId}
          onFollow={handleFollow}
          onBack={goBack}
          onOpenProduct={openProduct}
          onShowStore={() => setVisitorChoseGrid(true)}
          onMore={() => { hapticLight(); setMenuOpen(true); }}
          bottomInset={barInset}
        />
        <ProfileMenuSheet visible={menuOpen} title={brandName} items={menuItems} onClose={() => setMenuOpen(false)} />
        <Snackbar visible={!!snackbar} message={snackbar} onDismiss={() => setSnackbar('')} />
      </>
    );
  }

  return (
    <>
      <ProfileShell
        testID="seller-profile-hero"
        isOwnProfile={isOwner}
        identity={{
          name: brandName || ' ',
          handle: seller?.username ? `@${seller.username}` : null,
          initials: seller?.initials ?? '',
          avatarUrl: seller?.avatarUrl,
          verified: seller?.verified,
          pronouns,
          roleLabel: seller?.isOfficial ? 'Official' : 'Seller',
        }}
        avatar={{ liveHostId: canonicalSellerId ?? routeSellerId ?? null }}
        // A cover video, when set, leads the hero for every viewer (muted,
        // looping, poster first); otherwise the latest video.
        hero={coverFlow.hasCover
          ? { videoUri: coverFlow.cover.videoUrl, posterUri: coverFlow.cover.posterUrl }
          // The official account's blank cover is plain black, never a post.
          : seller?.isOfficial
            ? { videoUri: null, posterUri: null, plain: true }
            : { videoUri: firstVideo?.mediaUris[0] ?? null, posterUri: heroPoster }}
        banner={banner}
        onAddBanner={isOwner && !previewAsVisitor ? bannerFlow.openSheet : undefined}
        bannerNote={bannerNote}
        coverAffordance={isOwner ? (
          <CoverHeroAffordance hasCover={coverFlow.hasCover} busy={coverFlow.busy} onAdd={coverFlow.startAdd} onManage={coverFlow.openManage} />
        ) : undefined}
        // Dev's one profile layout (avatar + stats row, name below) — the
        // same header as the own profiles, collapsed to its content when
        // there is no video. Plain icons, no dark circles.
        headerVariant="video"
        topLeft={<ProfileTopBarIcon name="arrow-left" onPress={goBack} accessibilityLabel="Go back" />}
        topRight={(
          <ProfileTopBarIconRow>
            {caps.showInbox ? (
              <ProfileTopBarIcon name="message-circle" onPress={handleOpenInbox} accessibilityLabel="Inbox" />
            ) : null}
            <ProfileTopBarIcon
              name="more-horizontal"
              onPress={() => { hapticLight(); setMenuOpen(true); }}
              accessibilityLabel="More options"
              testID="seller-profile-more"
            />
          </ProfileTopBarIconRow>
        )}
        stickyHeader={{
          left: <ProfileTopBarIcon name="arrow-left" onPress={goBack} accessibilityLabel="Go back" />,
          right: <ProfileTopBarIcon name="more-horizontal" onPress={() => { hapticLight(); setMenuOpen(true); }} accessibilityLabel="More options" />,
        }}
        meta={meta}
        stats={stats}
        statsLoading={profileLoading}
        actions={actions}
        extras={canonicalSellerId ? <BrandDropsCard sellerId={canonicalSellerId} sellerName={brandName} /> : null}
        belowTabs={activeTab === 'Shop' ? <StoreBundlesRow sellerId={canonicalSellerId} /> : undefined}
        tabs={{
          // Labeled, with counts where the number is already known.
          items: CONTENT_TAB_ITEMS.map((tab) => ({
            ...tab,
            count: tab.key === 'Posts' ? videosCount : tab.key === 'Shop' ? productsCount : undefined,
          })),
          active: activeTab,
          onChange: (key) => { hapticSelection(); setActiveTab(key === 'Shop' || key === 'Tagged' ? key : 'Posts'); },
        }}
        data={gridData}
        renderItem={renderTile}
        keyExtractor={(row) => (row.kind === 'product' ? `p-${row.product.id}` : `i-${row.item.id}`)}
        numColumns={layout.gridColumns}
        listKey={`seller-grid-${activeTab}-${layout.gridColumns}`}
        ListEmptyComponent={(
          <ProfileGridPlaceholder
            loading={gridLoadingNow}
            error={gridErrorNow}
            onRetry={() => {
              if (activeTab === 'Shop') void loadShop();
              else if (activeTab === 'Tagged') void tagged.reload();
              else void videos.reload({ fresh: true });
            }}
            layout={layout}
            quiet
            icon={(tabEmpty?.icon ?? videosEmpty.icon) as never}
            title={tabEmpty?.title ?? videosEmpty.title}
            description={tabEmpty
              ? tabEmpty.message
              : isOwner ? videosEmpty.message : `${brandName || 'This brand'} hasn't posted any videos yet.`}
            action={(tabEmpty ?? videosEmpty).cta ? { label: (tabEmpty ?? videosEmpty).cta!.label, onPress: () => router.push((tabEmpty ?? videosEmpty).cta!.route as never) } : undefined}
            testID={`seller-profile-${activeTab.toLowerCase()}-empty`}
          />
        )}
        ListFooterComponent={<ProfileGridFooter loadingMore={videos.loadingMore} />}
        onEndReached={activeTab === 'Posts' ? videos.loadMore : undefined}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        bottomInset={barInset}
      />

      {/* ── Owner post actions (long-press a tile) ── */}
      <MenuSheet
        visible={!!selectedPost}
        onClose={() => setSelectedPost(null)}
        accessibilityLabel="Post options"
        testID="seller-post-menu"
        sections={[[
          { key: 'play', icon: 'play', label: 'Play', onPress: () => { const post = selectedPost; if (post) openVideo(gridItemFromThreadPost(post)); } },
          { key: 'edit', icon: 'edit-2', label: 'Edit post', onPress: () => { const post = selectedPost; if (post) router.push(('/create-post?editId=' + post.id) as never); } },
          { key: 'analytics', icon: 'bar-chart-2', label: 'View analytics', onPress: () => { const post = selectedPost; if (post) router.push(('/post-analytics?id=' + post.id) as never); } },
          ...(selectedPost && (selectedPost.postStatus === 'published' || selectedPost.pinnedAt) ? [{key: 'pin', icon: 'bookmark' as const, label: selectedPost.pinnedAt ? 'Unpin from profile' : 'Pin to your profile', onPress: () => { const post = selectedPost; setSelectedPost(null); if (post) void handleTogglePin(post); }}] : []),
          { key: 'copy-link', icon: 'link', label: 'Copy link', onPress: () => { const post = selectedPost; if (post) void handleCopyPostLink(post); } },
        ]]}
      />

      {isOwner ? (
        <>
          <CoverCoachmarkSheet
            visible={coverFlow.coachmarkVisible}
            onAdd={() => { coverFlow.dismissCoachmark(); coverFlow.startAdd(); }}
            onLater={coverFlow.dismissCoachmark}
          />
          <CoverManageSheet visible={coverFlow.manageOpen} onChange={coverFlow.changeFromManage} onRemove={() => { void coverFlow.remove(); }} onClose={coverFlow.closeManage} />
          <CoverTrimSheet source={coverFlow.trimSource} onCancel={coverFlow.cancelTrim} onConfirm={coverFlow.confirmTrim} />
          {bannerFlow.sheet}
        </>
      ) : null}
      {isOwner ? (
        <ShareProfileSheet
          visible={shareSheetVisible}
          onClose={() => setShareSheetVisible(false)}
          avatarUrl={seller?.avatarUrl ?? null}
          profileUsername={seller?.username}
          profileBrandName={seller?.brandName}
          sellerExtra={{
            rating,
            products: videos.posts.slice(0, 3).map((post) => ({ id: post.id, uri: post.thumbnailUri ?? post.mediaUris[0] })),
          }}
        />
      ) : null}

      <ProfileMenuSheet visible={menuOpen} anchor={menuAnchor} title={brandName} items={menuItems} onClose={() => setMenuOpen(false)} />

      <Snackbar visible={!!snackbar} message={snackbar} onDismiss={() => setSnackbar('')} />
    </>
  );
}

function makeStyles(theme: AppThemePreset) {
  return StyleSheet.create({
    flex: { flex: 1 },
    actionRow: { flexDirection: 'row', gap: SP.sm },
    dashboardRow: {
      backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1,
      borderRadius: RADIUS.md, marginBottom: SP.sm,
    },
    followBtn: { width: '100%', minHeight: 48, borderRadius: RADIUS.md },
    previewBanner: {
      flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginTop: SP.xs,
      borderWidth: 1, borderColor: theme.border, backgroundColor: theme.card, borderRadius: RADIUS.md, padding: SP.sm,
    },
    previewText: { flex: 1, color: theme.text, fontFamily: FONT.medium, fontSize: FS.sm },
    previewExit: { color: theme.text, fontFamily: FONT.bold, fontSize: FS.sm, textDecorationLine: 'underline' },
    vacation: {
      flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, marginTop: SP.xs,
      borderWidth: 1, borderColor: `${theme.warning}55`, borderRadius: RADIUS.md, padding: SP.sm,
    },
    vacationTitle: { color: theme.warning, fontFamily: FONT.bold, fontSize: FS.sm, marginBottom: 3 },
    vacationText: { color: theme.text, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18 },
    errorRoot: { flex: 1, backgroundColor: theme.background },
    errorBar: { paddingHorizontal: SP.md, alignItems: 'flex-start' },
  });
}
