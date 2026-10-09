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
import { Alert, Linking, Modal, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useSignInGate } from '@/hooks/useSignInGate';
import { useApi } from '@/hooks/useApi';
import { useStoreGiftCards } from '@/hooks/useStoreGiftCards';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { getSellerFollowState, setSellerFollowing } from '@/services/socialService';
import type { SellerThreadPost } from '@/services/socialService';
import { formatCompactCount } from '@/lib/compactFormat';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { buildCanonicalProfileUrl, shareLinkWithFallback } from '@/lib/shareProfile';
import { subscribeProfileEvents } from '@/lib/profileEvents';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  connectionsHref, messageSellerHref, productDetailHref, profileVideosHref, resolveStoreVisitSource,
} from '@/lib/profileNavigation';
import {
  hasPaidPlan, isVisitorPreviewParam, planChipLabel, profileCapabilities, resolveProfileMode, viewAsVisitorHref,
} from '@/lib/profileAccess';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';
import { getSellerShopPage, taggedItemHref, type ShopProduct } from '@/services/profileService';
import { ProfileMenuSheet, type ProfileMenuItem } from '@/components/profile/ProfileMenuSheet';
import { ProfileProductTile } from '@/components/profile/ProfileProductTile';
import { useTaggedPosts } from '@/components/profile/useTaggedPosts';
import { BrandDropsCard } from '@/components/BrandDropsCard';
import { ShareProfileSheet } from '@/components/ShareProfileSheet';
import { confirmBlock, reportHref } from '@/lib/safety';
import { EmptyState, PressableScale } from '@/components/BrandthreadUI';
import { FollowMorphButton } from '@/components/ui/MotionPrimitives';
import { Snackbar } from '@/components/ui/Snackbar';
import { ListRow } from '@/components/ui/ListRow';
import { haptics } from '@/lib/haptics';
import { ProfileShell, ProfileMeta } from '@/components/profile/ProfileShell';
import {
  ProfileButton, ProfileChip, ProfileGlassButton, type ProfileStat, type ProfileTab,
} from '@/components/profile/ProfileControls';
import { ProfileVideoTile, gridItemFromThreadPost, type ProfileGridItem } from '@/components/profile/ProfileVideoGrid';
import { ProfileGridFooter, ProfileGridPlaceholder } from '@/components/profile/ProfileGridStates';
import { TILE_ASPECT_3_4, useProfileLayout } from '@/components/profile/profileLayout';
import { useCreatorVideos } from '@/components/profile/useCreatorVideos';
import { profileEmptyState } from '@/components/profile/profileEmptyStates';
import {
  CoverCoachmarkSheet, CoverHeroAffordance, CoverManageSheet, CoverTrimSheet, useProfileCover,
} from '@/components/profile/ProfileCover';

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
  avatarUrl: string | null;
  bannerUrl: string | null;
  vacationMode: boolean;
  vacationMessage?: string;
  productsCount: number;
  videosCount: number;
  coverVideoUrl: string | null;
  coverPosterUrl: string | null;
  /** Authoritative public totals from the API (likes on public posts, follower / following counts). */
  likesCount: number | null;
  followersCount: number | null;
  followingCount: number | null;
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
    avatarUrl: httpOrNull(profile?.profileImageUrl) ?? httpOrNull(profile?.avatarUrl),
    bannerUrl: httpOrNull(profile?.bannerUrl),
    vacationMode: Boolean(profile?.vacationMode),
    vacationMessage: profile?.vacationMessage ?? undefined,
    productsCount: Number(profile?.productsCount ?? 0),
    videosCount: Number(profile?.videosCount ?? 0),
    coverVideoUrl: httpOrNull(profile?.coverVideoUrl),
    coverPosterUrl: httpOrNull(profile?.coverPosterUrl),
    likesCount: typeof profile?.likesCount === 'number' ? profile.likesCount : null,
    followersCount: typeof profile?.followersCount === 'number' ? profile.followersCount : null,
    followingCount: typeof profile?.followingCount === 'number' ? profile.followingCount : null,
  };
}

export default function SellerProfileScreen() {
  const { theme } = useAppTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; sellerId?: string; isOwner?: string; src?: string; asVisitor?: string }>();
  const routeSellerId = params.id ?? params.sellerId;
  const api = useApi();
  const { isLoaded: authLoaded, userId } = useAuth();
  const { requireSignIn } = useSignInGate();
  const layout = useProfileLayout({ tileAspect: TILE_ASPECT_3_4 });
  // Clears the floating buyer tab bar when this screen is reached from the
  // buyer shell (viewing a brand's public profile); a no-op elsewhere.
  const barInset = useBuyerTabBarInset();

  const [seller, setSeller] = useState<SellerView | null>(null);
  const sellsGiftCards = useStoreGiftCards(seller?.sellerId);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followers, setFollowers] = useState<number | null>(null);
  const [following, setFollowing] = useState<number | null>(null);
  const [likes, setLikes] = useState<number | null>(null);
  const [followPending, setFollowPending] = useState(false);
  const [rating, setRating] = useState<{ avgRating: number; totalCount: number } | null>(null);
  const [shareSheetVisible, setShareSheetVisible] = useState(false);
  const [selectedPost, setSelectedPost] = useState<SellerThreadPost | null>(null);
  const [snackbar, setSnackbar] = useState('');
  const [activeTab, setActiveTab] = useState<ContentTab>('Posts');
  const [menuOpen, setMenuOpen] = useState(false);
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
  const caps = profileCapabilities('seller', mode);
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
    if (loadOwnProfile && (!authLoaded || !userId)) {
      if (authLoaded) { setProfileLoading(false); setProfileError(true); }
      return () => { active = false; };
    }
    (async () => {
      if (reloadTick === 0) setProfileLoading(true);
      setProfileError(false);
      try {
        let view: SellerView;
        if (loadOwnProfile) {
          const own = await api.seller.getProfile();
          const publicData = await api.publicSellers.get(own.clerkId).catch(() => null);
          // The public read carries the signed avatar URL, live counts and the
          // derived verified badge; the owner read adds private fields.
          view = toSellerView({ ...own, ...(publicData?.profile ?? {}) }, own.clerkId);
          setPlan({ planId: own.subscriptionPlanId ?? null, status: own.subscriptionStatus ?? null });
        } else {
          if (!routeSellerId) throw new Error('Seller not found.');
          api.publicSellers.recordVisit(routeSellerId).catch(() => {});
          // Real per-source traffic tracking for the seller's own Dashboard —
          // fire-and-forget, never blocks this screen's own load.
          api.publicSellers
            .recordStoreVisit(routeSellerId, { source: resolveStoreVisitSource(params.src) })
            .catch(() => {});
          const data = await api.publicSellers.get(routeSellerId);
          view = toSellerView(data.profile ?? {}, routeSellerId);
        }
        if (!active) return;
        setSeller(view);
        // The public profile's totals are authoritative (computed server-side, not from a loaded page).
        if (view.likesCount != null) setLikes(view.likesCount);
        if (view.followersCount != null) setFollowers((count) => count ?? view.followersCount);
        if (view.followingCount != null) setFollowing((count) => count ?? view.followingCount);
      } catch {
        if (active && reloadTick === 0) setProfileError(true);
      } finally {
        if (active) { setProfileLoading(false); setRefreshing(false); }
      }
    })();
    return () => { active = false; };
  }, [api, authLoaded, loadOwnProfile, routeSellerId, userId, reloadTick]);

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
        if (typeof followState.value.followersCount === 'number') setFollowers(followState.value.followersCount);
      }
      if (social.status === 'fulfilled' && social.value) {
        setFollowers(Number(social.value.followersCount ?? 0));
        setFollowing(Number(social.value.followingCount ?? 0));
        if (typeof social.value.likesCount === 'number') setLikes(social.value.likesCount);
      }
    });
    return () => { active = false; };
  }, [api, canonicalSellerId, isOwner, userId, reloadTick]);

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
    if (activeTab === 'Shop') void loadShop();
  }, [activeTab, loadShop, reloadTick]);

  const tagged = useTaggedPosts(canonicalSellerId, activeTab === 'Tagged' && !!userId && !devPreview);

  // ── Follow changes made anywhere else (feed rail, lists) update counts here ─
  useEffect(() => subscribeProfileEvents((event) => {
    if (event.type !== 'follow' || !canonicalSellerId) return;
    if (event.targetId === canonicalSellerId) {
      setIsFollowing(event.isFollowing);
      if (typeof event.followersCount === 'number') setFollowers(event.followersCount);
    } else if (isOwner && event.viewerId === canonicalSellerId) {
      setFollowing((count) => (count == null ? count : Math.max(0, count + (event.isFollowing ? 1 : -1))));
    }
  }), [canonicalSellerId, isOwner]);

  const videos = useCreatorVideos(canonicalSellerId, { fresh: isOwner, asVisitor: previewAsVisitor });
  const coverFlow = useProfileCover({
    own: isOwner,
    cover: { videoUrl: seller?.coverVideoUrl ?? null, posterUrl: seller?.coverPosterUrl ?? null },
    userId: canonicalSellerId,
  });

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
    if (followPending || !canonicalSellerId) return;
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
    } catch {
      setIsFollowing(previous.isFollowing);
      setFollowers(previous.followers);
      Alert.alert('Couldn’t update follow', 'Check your connection and try again.');
    } finally {
      setFollowPending(false);
    }
  }, [canonicalSellerId, followPending, followers, isFollowing, requireSignIn]);

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

  const handleTileLongPress = useCallback((item: ProfileGridItem) => {
    if (!isOwner) return;
    const post = videos.posts.find((candidate) => candidate.id === item.id) ?? null;
    if (post) { haptics.rigid(); setSelectedPost(post); }
  }, [isOwner, videos.posts]);

  const handleCopyPostLink = useCallback(async (post: SellerThreadPost) => {
    const profileUrl = seller ? buildCanonicalProfileUrl(seller.username) : null;
    const url = profileUrl ? `${profileUrl}?post=${encodeURIComponent(post.id)}` : null;
    if (!url) { Alert.alert('Couldn’t copy link', 'Try again.'); return; }
    await Clipboard.setStringAsync(url);
    setSnackbar('Link copied');
  }, [seller]);

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

  // ── Error: the profile itself couldn't load ────────────────────────────────
  if (profileError && !seller) {
    return (
      <View style={[styles.errorRoot, { paddingTop: headerTopInset + SP.sm }]}>
        <View style={styles.errorBar}>
          <ProfileGlassButton icon="arrow-left" onPress={goBack} accessibilityLabel="Go back" />
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
          disabled={previewAsVisitor || followPending || !canonicalSellerId || !userId}
          style={styles.followBtn}
          labelStyle={{ fontFamily: FONT.bold, fontSize: FS.base }}
        />
      </View>
      <ProfileButton label="Message" icon="message-circle" onPress={handleMessageSeller} disabled={previewAsVisitor} testID="seller-profile-message" />
    </View>
  );

  const meta = seller ? (
    <ProfileMeta
      bio={seller.bio}
      website={seller.website}
      location={seller.location}
      onOpenWebsite={(url) => { void Linking.openURL(url); }}
    >
      {seller.category ? <ProfileChip label={seller.category} icon="tag" /> : null}
      {rating && rating.totalCount > 0 ? <ProfileChip label={`${rating.avgRating.toFixed(1)} · ${rating.totalCount} reviews`} icon="star" /> : null}
      {caps.showPlanChip && plan ? (
        <ProfileChip
          label={planChipLabel(plan)}
          icon={hasPaidPlan(plan) ? 'award' : 'layers'}
          tone={hasPaidPlan(plan) ? 'accent' : 'muted'}
        />
      ) : null}
      {previewAsVisitor ? (
        <View style={styles.previewBanner} testID="seller-profile-visitor-preview">
          <Feather name="eye" size={16} color={theme.text} />
          <Text style={styles.previewText}>You’re viewing your profile as a visitor</Text>
          <Pressable onPress={goBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Exit visitor view" testID="seller-profile-exit-preview">
            <Text style={styles.previewExit}>Exit</Text>
          </Pressable>
        </View>
      ) : null}
      {!isOwner && seller.vacationMode ? (
        <View style={styles.vacation} accessibilityRole="alert">
          <Feather name="sun" size={16} color={theme.warning} />
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
          roleLabel: 'Seller',
        }}
        avatar={{ ring: !!seller?.verified, liveHostId: canonicalSellerId ?? routeSellerId ?? null }}
        // A cover video, when set, leads the hero for every viewer (muted,
        // looping, poster first); otherwise the latest video.
        hero={coverFlow.hasCover
          ? { videoUri: coverFlow.cover.videoUrl, posterUri: coverFlow.cover.posterUrl }
          : { videoUri: firstVideo?.mediaUris[0] ?? null, posterUri: heroPoster }}
        coverAffordance={isOwner ? (
          <CoverHeroAffordance hasCover={coverFlow.hasCover} busy={coverFlow.busy} onAdd={coverFlow.startAdd} onManage={coverFlow.openManage} />
        ) : undefined}
        topLeft={<ProfileGlassButton icon="arrow-left" onPress={goBack} accessibilityLabel="Go back" />}
        topRight={(
          <>
            {caps.showInbox ? (
              <ProfileGlassButton icon="message-circle" onPress={handleOpenInbox} accessibilityLabel="Inbox" />
            ) : null}
            <ProfileGlassButton
              icon="more-horizontal"
              onPress={() => { setMenuOpen(true); }}
              accessibilityLabel="More options"
              testID="seller-profile-more"
            />
          </>
        )}
        meta={meta}
        stats={stats}
        statsLoading={profileLoading}
        actions={actions}
        extras={canonicalSellerId ? <BrandDropsCard sellerId={canonicalSellerId} sellerName={brandName} /> : null}
        tabsVariant="iconOnly"
        tabs={{
          items: CONTENT_TAB_ITEMS,
          active: activeTab,
          onChange: (key) => { setActiveTab(key === 'Shop' || key === 'Tagged' ? key : 'Posts'); },
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
      <Modal visible={!!selectedPost} transparent animationType="slide" onRequestClose={() => setSelectedPost(null)}>
        <PressableScale style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setSelectedPost(null)} accessibilityLabel="Close post actions" />
        {selectedPost ? (
          <View style={[styles.sheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle} numberOfLines={1}>{selectedPost.caption || 'Post'}</Text>
            <SheetRow icon="play" label="Play" onPress={() => { const post = selectedPost; setSelectedPost(null); openVideo(gridItemFromThreadPost(post)); }} />
            <SheetRow icon="edit-2" label="Edit post" onPress={() => { const post = selectedPost; setSelectedPost(null); router.push(('/create-post?editId=' + post.id) as never); }} />
            <SheetRow icon="bar-chart-2" label="View analytics" onPress={() => { const post = selectedPost; setSelectedPost(null); router.push(('/post-analytics?id=' + post.id) as never); }} />
            <SheetRow icon="copy" label="Copy link" onPress={() => { const post = selectedPost; setSelectedPost(null); void handleCopyPostLink(post); }} />
          </View>
        ) : null}
      </Modal>

      {isOwner ? (
        <>
          <CoverCoachmarkSheet
            visible={coverFlow.coachmarkVisible}
            onAdd={() => { coverFlow.dismissCoachmark(); coverFlow.startAdd(); }}
            onLater={coverFlow.dismissCoachmark}
          />
          <CoverManageSheet visible={coverFlow.manageOpen} onChange={coverFlow.changeFromManage} onRemove={() => { void coverFlow.remove(); }} onClose={coverFlow.closeManage} />
          <CoverTrimSheet source={coverFlow.trimSource} onCancel={coverFlow.cancelTrim} onConfirm={coverFlow.confirmTrim} />
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

      <ProfileMenuSheet visible={menuOpen} title={brandName} items={menuItems} onClose={() => setMenuOpen(false)} />

      <Snackbar visible={!!snackbar} message={snackbar} onDismiss={() => setSnackbar('')} />
    </>
  );
}

function SheetRow({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <PressableScale style={sheetRowStyles.row} onPress={() => { onPress(); }} accessibilityRole="button" accessibilityLabel={label}>
      <Feather name={icon} size={18} color={theme.text} />
      <Text style={[sheetRowStyles.label, { color: theme.text }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={theme.muted} />
    </PressableScale>
  );
}

const sheetRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: SP.md, minHeight: 52 },
  label: { flex: 1, fontFamily: FONT.medium, fontSize: FS.base },
});

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
    sheetBackdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' }, // theme-exempt: modal scrim
    sheet: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      backgroundColor: theme.card, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
      borderWidth: 1, borderBottomWidth: 0, borderColor: theme.border,
    },
    sheetHandle: { width: 36, height: 4, backgroundColor: theme.border, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: SP.sm },
    sheetTitle: { color: theme.muted, fontFamily: FONT.semibold, fontSize: FS.sm, paddingHorizontal: SP.md, paddingBottom: SP.sm },
  });
}
