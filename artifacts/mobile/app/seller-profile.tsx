import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Animated,
  Dimensions,
  Share,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import type { SellerPost } from '@/services/types';
import type { Product } from '@/services/productTypes';
import { useApi } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import { formatCents } from '@/lib/money';
import { getSellerFollowState, setSellerFollowing } from '@/services/socialService';
import {
  BG, SURFACE, CARD, BORDER, FG, MUTED, SUBTLE,
  BLUE, ORANGE, RED, FONT, FS, SP, RADIUS, ICON, ACCENT,
} from '@/lib/theme';
import { buildCanonicalProfileUrl } from '@/lib/shareProfile';
import { confirmBlock, reportHref } from '@/lib/safety';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TILE_SIZE = Math.floor((SCREEN_WIDTH - 2) / 3);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

function typeIcon(type: string): keyof typeof Feather.glyphMap {
  if (type === 'video' || type === 'behind_scenes') return 'play';
  if (type === 'slideshow') return 'layers';
  if (type === 'announcement') return 'bell';
  return 'image';
}

function tabIcon(tab: string): keyof typeof Feather.glyphMap {
  switch (tab) {
    case 'Posts': return 'grid';
    case 'Products': return 'shopping-bag';
    case 'Tagged': return 'at-sign';
    case 'Reposts': return 'repeat';
    case 'Saved': return 'bookmark';
    default: return 'circle';
  }
}

function statusBadgeColor(status: string): string {
  if (status === 'draft') return ORANGE;
  if (status === 'scheduled') return BLUE;
  if (status === 'failed') return RED;
  return MUTED;
}

function mapApiPost(post: any): SellerPost {
  const authorName = post.seller?.brandName ?? post.seller?.displayName ?? 'Seller';
  return {
    id: post.id,
    sellerId: post.userId ?? '',
    brandId: post.userId ?? '',
    type: post.mediaType ?? 'image',
    status: 'published',
    caption: post.caption ?? '',
    hashtags: post.styleTags ?? [],
    aspectRatio: '9:16',
    mediaUrls: post.mediaUrl ? [post.mediaUrl] : [],
    overlays: [],
    productTags: (post.taggedProducts ?? []).map((tag: any) => ({
      productId: tag.productId,
      productName: tag.name ?? 'Product',
      priceCents: typeof tag.priceCents === 'number' ? tag.priceCents : 0,
    })),
    visibility: { isPublic: true, allowComments: true, allowReposts: true, showLikeCount: true },
    isPinned: false,
    isSellerContent: true,
    createdAt: post.createdAt ?? new Date().toISOString(),
    publishedAt: post.createdAt ?? new Date().toISOString(),
    analytics: {
      postId: post.id,
      views: 0,
      uniqueViewers: 0,
      likes: Number(post.likesCount ?? post.likeCount ?? 0),
      comments: Number(post.commentsCount ?? 0),
      reposts: Number(post.repostsCount ?? post.repostCount ?? 0),
      saves: 0,
      shares: 0,
      profileVisits: 0,
      productClicks: 0,
      addToCartActions: 0,
      purchases: 0,
      revenue: 0,
      avgWatchTime: 0,
      completionRate: 0,
      retentionData: [],
      topCountries: [],
      peakHour: 0,
    },
    __analyticsUnavailable: true,
  } as unknown as SellerPost;
}

function mapApiProfile(profile: any, postsCount = 0, productsCount = 0): import('@/services/types').SellerProfile {
  const brandName = profile.brandName ?? profile.displayName ?? 'Seller';
  return {
    id: profile.clerkId ?? profile.id ?? '',
    sellerId: profile.clerkId ?? profile.id ?? '',
    brandName,
    username: profile.username ?? brandName.toLowerCase().replace(/[^a-z0-9]/g, ''),
    bio: profile.bio ?? '',
    website: profile.website ?? undefined,
    avatarColor: '#0F766E',
    initials: brandName.slice(0, 2).toUpperCase(),
    verified: profile.verified === true,
    isPublic: true,
    followers: Number(profile.followersCount ?? 0),
    following: Number(profile.followingCount ?? 0),
    totalLikes: Number(profile.totalLikes ?? 0),
    productCount: productsCount,
    postCount: postsCount,
    vacationMode: Boolean(profile.vacationMode),
    vacationMessage: profile.vacationMessage ?? undefined,
    createdAt: new Date().toISOString(),
  } as import('@/services/types').SellerProfile & {
    vacationMode: boolean;
    vacationMessage?: string;
  };
}

// ─── Post Tile ─────────────────────────────────────────────────────────────────

interface PostTileProps {
  post: SellerPost;
  index: number;
  isOwner: boolean;
  onPress: (post: SellerPost) => void;
}

function PostTile({ post, index, isOwner, onPress }: PostTileProps) {
  const colorsTheme = useColors();
  const GREEN = colorsTheme.primary;
  const icon = typeIcon(post.type);
  const views = post.analytics?.views;

  return (
    <TouchableOpacity
      style={[tileStyles.postTile, { width: TILE_SIZE, height: TILE_SIZE }]}
      onPress={() => onPress(post)}
      activeOpacity={0.85}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: CARD }]} />
      {/* Pinned indicator */}
      {post.isPinned && (
        <View style={tileStyles.tilePinned}>
          <Feather name="map-pin" size={10} color={GREEN} />
        </View>
      )}
      {/* Type icon top-right */}
      <View style={tileStyles.tileTypeIcon}>
        <Feather name={icon} size={11} color={MUTED} />
      </View>
      {/* Views bottom-left */}
      {views != null && !(post as any).__analyticsUnavailable && (
        <View style={tileStyles.tileViews}>
          <Feather name="eye" size={8} color={MUTED} />
          <Text style={tileStyles.tileViewsText}>{formatCount(views)}</Text>
        </View>
      )}
      {/* Status badge for owner non-published */}
      {isOwner && post.status !== 'published' && (
        <View style={[tileStyles.tileStatusBadge, { backgroundColor: statusBadgeColor(post.status) + '33', borderColor: statusBadgeColor(post.status) }]}>
          <Text style={[tileStyles.tileStatusText, { color: statusBadgeColor(post.status) }]}>
            {post.status}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const tileStyles = StyleSheet.create({
  postTile: { overflow: 'hidden', position: 'relative' },
  tilePinned: { position: 'absolute', top: 5, left: 5 },
  tileTypeIcon: { position: 'absolute', top: 5, right: 5 },
  tileViews: { position: 'absolute', bottom: 5, left: 5, flexDirection: 'row', alignItems: 'center', gap: 2 },
  tileViewsText: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.semibold },
  tileStatusBadge: { position: 'absolute', bottom: 5, right: 5, borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  tileStatusText: { fontSize: FS.xs, fontFamily: FONT.semibold, textTransform: 'capitalize' },
});

// ─── Create Post Tile ──────────────────────────────────────────────────────────

function CreatePostTile({ onPress }: { onPress: () => void }) {
  const colorsTheme = useColors();
  const GREEN = colorsTheme.primary;
  return (
    <TouchableOpacity
      style={[tileStyles.postTile, createStyles.createTile, { width: TILE_SIZE, height: TILE_SIZE }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Feather name="plus" size={24} color={GREEN} />
      <Text style={createStyles.createTileLabel}>New post</Text>
    </TouchableOpacity>
  );
}

const createStyles = StyleSheet.create({
  createTile: { backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  createTileLabel: { color: MUTED, fontSize: 11, fontFamily: FONT.medium, marginTop: 4 },
});

// ─── Product Card ──────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: Product;
  index: number;
  onPress: (id: string) => void;
}

function ProductCard({ product, index, onPress }: ProductCardProps) {
  const colorsTheme = useColors();
  const GREEN = colorsTheme.primary;
  const GREEN_DIM = colorsTheme.accent;
  const totalInventory = product.inventory.totalStock;
  const lowStockThreshold = product.inventory.lowStockThreshold;
  const isLowStock = totalInventory > 0 && totalInventory <= lowStockThreshold;
  const isOutOfStock = totalInventory === 0 && product.salesModel !== 'pre-order';

  let stockLabel = 'In stock';
  let stockColor = GREEN;
  if (product.salesModel === 'pre-order') { stockLabel = 'Pre-order'; stockColor = ACCENT; }
  else if (isOutOfStock) { stockLabel = 'Out of stock'; stockColor = MUTED; }
  else if (isLowStock) { stockLabel = 'Low stock'; stockColor = ORANGE; }

  const coverMedia = product.media && product.media[0];
  const hasCoverImage = coverMedia && coverMedia.uri && coverMedia.uri.startsWith('http');
  const isDraftOrArchived = product.status === 'draft' || product.status === 'archived';

  return (
    <TouchableOpacity
      style={productStyles.productCard}
      onPress={() => onPress(product.id)}
      activeOpacity={0.85}
    >
      <View style={productStyles.productImageContainer}>
        {hasCoverImage ? (
          <Image
            source={{ uri: coverMedia.uri }}
            style={productStyles.productImage}
            resizeMode="cover"
          />
        ) : (
          <View style={[productStyles.productImage, { backgroundColor: CARD }]} />
        )}
        {isDraftOrArchived && (
          <View style={productStyles.productStatusBadge}>
            <Text style={productStyles.productStatusBadgeText}>
              {product.status === 'draft' ? 'Draft' : 'Archived'}
            </Text>
          </View>
        )}
      </View>
      <View style={productStyles.productInfo}>
        <Text style={productStyles.productName} numberOfLines={2}>{product.name}</Text>
        <View style={productStyles.productPriceRow}>
          <Text style={productStyles.productPrice}>{formatCents(product.pricing.priceCents)}</Text>
          {product.pricing.compareAtPriceCents != null && (
            <Text style={productStyles.productCompare}>{formatCents(product.pricing.compareAtPriceCents)}</Text>
          )}
        </View>
        <View style={productStyles.productBadgeRow}>
          <View style={[productStyles.productBadge, { borderColor: product.salesModel === 'pre-order' ? ACCENT : BORDER }]}>
            <Text style={[productStyles.productBadgeText, { color: product.salesModel === 'pre-order' ? ACCENT : MUTED }]}>
              {product.salesModel === 'pre-order' ? 'Pre-order' : 'Pre-made'}
            </Text>
          </View>
        </View>
        <Text style={[productStyles.productStock, { color: stockColor }]}>{stockLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

const productStyles = StyleSheet.create({
  productCard: { width: (SCREEN_WIDTH - 40) / 2, backgroundColor: BG, borderRadius: RADIUS.sm, overflow: 'hidden' },
  productImageContainer: { position: 'relative', height: 176, width: '100%', borderRadius: RADIUS.sm, overflow: 'hidden', backgroundColor: CARD },
  productImage: { height: 176, width: '100%' },
  productStatusBadge: { position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: ORANGE },
  productStatusBadgeText: { color: ORANGE, fontSize: FS.xs, fontFamily: FONT.semibold, textTransform: 'capitalize' },
  productInfo: { paddingHorizontal: 2, paddingTop: 10, paddingBottom: SP.md },
  productName: { color: FG, fontSize: FS.sm, lineHeight: 18, fontFamily: FONT.semibold, marginBottom: 4 },
  productPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  productPrice: { color: FG, fontSize: FS.sm, fontFamily: FONT.bold },
  productCompare: { color: MUTED, fontSize: 12, textDecorationLine: 'line-through' },
  productBadgeRow: { flexDirection: 'row', marginBottom: 4 },
  productBadge: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 2 },
  productBadgeText: { fontSize: 11, fontFamily: FONT.medium },
  productStock: { fontSize: FS.xs, fontFamily: FONT.medium, marginTop: 2 },
});

// ─── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ icon, title, subtitle }: { icon: keyof typeof Feather.glyphMap; title: string; subtitle?: string }) {
  return (
    <View style={emptyStyles.emptyState}>
      <Feather name={icon} size={48} color={MUTED} />
      <Text style={emptyStyles.emptyTitle}>{title}</Text>
      {subtitle && <Text style={emptyStyles.emptySubtitle}>{subtitle}</Text>}
    </View>
  );
}

const emptyStyles = StyleSheet.create({
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 40, gap: 12 },
  emptyTitle: { color: FG, fontSize: FS.base, fontFamily: FONT.semibold, textAlign: 'center' },
  emptySubtitle: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', lineHeight: 20 },
});

// ─── Action Row (sheet) ────────────────────────────────────────────────────────

interface ActionRowProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color?: string;
  onPress: () => void;
}

function ActionRow({ icon, label, color = FG, onPress }: ActionRowProps) {
  return (
    <TouchableOpacity style={sheetStyles.actionRow} onPress={onPress} activeOpacity={0.7}>
      <Feather name={icon} size={18} color={color} />
      <Text style={[sheetStyles.actionRowLabel, { color }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={MUTED} />
    </TouchableOpacity>
  );
}

const sheetStyles = StyleSheet.create({
  actionRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: 14, gap: 14 },
  actionRowLabel: { flex: 1, fontSize: FS.base, fontFamily: FONT.medium },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function SellerProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; sellerId?: string; isOwner?: string }>();
  const routeSellerId = params.id ?? params.sellerId;
  const isOwner = params.isOwner === 'true';
  const api = useApi();
  const { isLoaded: authLoaded, userId } = useAuth();

  const [profile, setProfile] = useState(() => mapApiProfile({}));
  const [activeTab, setActiveTab] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followers, setFollowers] = useState(0);
  const [selectedPost, setSelectedPost] = useState<SellerPost | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [liveProducts, setLiveProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [apiRating, setApiRating] = useState<{ avgRating: number; totalCount: number } | null>(null);
  const [posts, setPosts] = useState<SellerPost[]>([]);
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [followPending, setFollowPending] = useState(false);
  // Canonical seller clerkId — resolved from the API response after initial load.
  // This is what follow/message/review/posts actions must use, not the raw route param
  // (which may be a DB UUID alias when navigating from /u/[username]).
  const [canonicalSellerId, setCanonicalSellerId] = useState<string | null>(null);

  const tabs = ['Posts', 'Products'];
  const tabBarIndex = isOwner ? 3 : 4;

  // Load seller data
  useEffect(() => {
    const sellerId = routeSellerId as string | undefined;
    let active = true;
    setProfile(mapApiProfile({}));
    setPosts([]);
    setLiveProducts([]);
    setProfileImageUrl(null);
    setFollowers(0);
    setIsFollowing(false);
    setApiRating(null);
    setCanonicalSellerId(null);
    if (isOwner && (!authLoaded || !userId)) {
      setProfileLoading(!authLoaded);
      setProductsLoading(!authLoaded);
      return () => { active = false; };
    }
    (async () => {
      setProfileLoading(true);
      setProductsLoading(true);
      try {
        if (!sellerId && isOwner) {
          const [p, postRows] = await Promise.all([
            api.seller.getProfile(),
            api.posts.publicList(),
          ]);
          const ownPosts = postRows.filter((post: any) => post.userId === p.clerkId).map(mapApiPost);
           if (!active) return;
           setProfile(mapApiProfile(p, ownPosts.length));
          setPosts(ownPosts);
          setProfileImageUrl(p.profileImageUrl ?? null);
          setLiveProducts([]);
          // Owner: canonical ID is their own Clerk ID.
          if (p.clerkId) setCanonicalSellerId(p.clerkId);
        } else {
          if (!sellerId) throw new Error('Seller not found.');
          // Fire the visit record with the route alias — the server resolves it.
          api.publicSellers.recordVisit(sellerId).catch(() => {});
          // Use the route alias for the API call — server resolves UUID or clerkId.
          const data = await api.publicSellers.get(sellerId);
          // Extract the canonical clerkId returned by the server in profile.clerkId.
          // This is the authoritative ID for all follow/message/review/posts calls.
          const resolvedClerkId: string | undefined = data.profile?.clerkId;
          // Load follow state and posts in parallel, using canonical ID if available.
          const effectiveSellerId = resolvedClerkId ?? sellerId;
          const [postRows, followState] = await Promise.all([
            api.posts.publicList(effectiveSellerId),
            getSellerFollowState(effectiveSellerId),
          ]);
          const sellerPosts = postRows.map(mapApiPost);
          const products = Array.isArray(data.products) ? data.products as Product[] : [];
           if (!active) return;
           setProfile(mapApiProfile(data.profile ?? {}, sellerPosts.length, products.length));
          setFollowers(Number(followState.followersCount ?? data.profile?.followersCount ?? 0));
          setIsFollowing(followState.isFollowing);
          setProfileImageUrl(typeof data.profile?.profileImageUrl === 'string' ? data.profile.profileImageUrl : null);
          setLiveProducts(products);
          setPosts(sellerPosts);
          // Store canonical clerkId for downstream follow/message/review calls.
          if (resolvedClerkId) setCanonicalSellerId(resolvedClerkId);
        }
      } catch {
        if (!active) return;
        setProfile(mapApiProfile({}));
        setPosts([]);
        setLiveProducts([]);
        setProfileImageUrl(null);
        setFollowers(0);
        setIsFollowing(false);
        setApiRating(null);
        setCanonicalSellerId(null);
      } finally {
        if (active) {
          setProfileLoading(false);
          setProductsLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [api, authLoaded, isOwner, routeSellerId, userId]);

  // Load reviews — use canonical clerkId, not the raw route alias.
  useEffect(() => {
    // Prefer the canonical clerkId resolved from the profile API response.
    // Fall back to routeSellerId only if canonicalSellerId hasn't been set yet
    // (e.g. during initial render before the profile load completes).
    const sellerId = canonicalSellerId ?? (routeSellerId as string | undefined);
    let active = true;
    setApiRating(null);
    if (!sellerId) return () => { active = false; };
    api.reviews.forSeller(sellerId)
      .then((data: any) => {
        if (active) setApiRating({ avgRating: data.avgRating ?? 0, totalCount: data.totalCount ?? 0 });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [api, canonicalSellerId, routeSellerId]);

  const handleFollow = useCallback(async () => {
    if (followPending) return;
    // Always use canonical clerkId for follow actions — never the route alias.
    const sellerId = canonicalSellerId;
    if (!sellerId) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const previousFollowing = isFollowing;
    const previousFollowers = followers;
    const next = !previousFollowing;
    setFollowPending(true);
    setIsFollowing(next);
    setFollowers(count => Math.max(0, count + (next ? 1 : -1)));
    try {
      const canonical = await setSellerFollowing(sellerId, next);
      setIsFollowing(canonical.isFollowing);
      if (canonical.followersCount != null) setFollowers(canonical.followersCount);
    } catch {
      setIsFollowing(previousFollowing);
      setFollowers(previousFollowers);
      Alert.alert("Couldn\u2019t update follow", 'Check your connection and try again.');
    } finally {
      setFollowPending(false);
    }
  }, [canonicalSellerId, followPending, followers, isFollowing]);

  const handleShare = useCallback(() => {
    if (isOwner) {
      // Owner always gets the dedicated share-profile page with QR + canonical URL.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      router.push('/share-profile' as never);
    } else {
      // Non-owner (visitor) viewing a seller: share via native sheet using the canonical URL.
      const url = buildCanonicalProfileUrl(profile.username);
      if (url) {
        Share.share({ message: `Check out ${profile.brandName} on Brandthread: ${url}`, url });
      } else {
        Share.share({ message: `Check out @${profile.username} on Brandthread` });
      }
    }
  }, [isOwner, profile.username, profile.brandName, router]);

  const handleMessageSeller = useCallback(() => {
    if ((profile as any).vacationMode) {
      Alert.alert(
        'Seller is away',
        (profile as any).vacationMessage ?? 'This seller is currently away and is not accepting new messages.',
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Use canonical clerkId for messaging — never a DB UUID alias.
    const sellerId = canonicalSellerId ?? profile.sellerId;
    router.push((
      '/buyer-conversation?participantId=' + encodeURIComponent(sellerId) +
      '&participantName=' + encodeURIComponent(profile.brandName) +
      '&participantHandle=%40' + encodeURIComponent(profile.username) +
      '&participantInitials=' + encodeURIComponent(profile.initials) +
      '&participantColor=' + encodeURIComponent(profile.avatarColor) +
      '&participantAccountType=seller&type=buyer_to_seller'
    ) as never);
  }, [router, profile, canonicalSellerId]);

  const handleOpenInbox = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push((isOwner ? '/seller-inbox' : '/(buyer)/inbox') as never);
  }, [isOwner, router]);

  const handleMoreOptions = useCallback(() => {
    // Use canonical clerkId for report — never the route alias.
    const sellerId = canonicalSellerId ?? profile.sellerId;
    Alert.alert(
      profile.brandName,
      'What would you like to do?',
      [
        { text: 'Share profile', onPress: handleShare },
        ...(isOwner ? [] : [
          {
            text: 'Report seller',
            onPress: () => router.push(reportHref({
              targetType: 'profile',
              targetId: sellerId,
              label: profile.brandName,
              ownerId: sellerId,
              ownerName: profile.brandName,
            }) as never),
          },
          {
            text: `Block ${profile.brandName}`,
            style: 'destructive' as const,
            onPress: async () => {
              if (await confirmBlock({ userId: sellerId, name: profile.brandName }, api.social.block)) {
                if (router.canGoBack()) router.back();
                else router.replace('/(buyer)/' as never);
              }
            },
          },
        ]),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );
  }, [profile, handleShare, router, canonicalSellerId, isOwner, api]);

  const handlePostPress = useCallback((post: SellerPost) => {
    setSelectedPost(post);
    setShowActionSheet(true);
  }, []);

  const handleActionSheetClose = useCallback(() => {
    setShowActionSheet(false);
    setSelectedPost(null);
  }, []);

  const truncatedBio = profile.bio.length > 120 && !bioExpanded
    ? profile.bio.slice(0, 120) + '…'
    : profile.bio;

  if (profileLoading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: MUTED, fontFamily: FONT.medium, fontSize: FS.sm }}>Loading seller profile…</Text>
      </View>
    );
  }

  const displayProducts = liveProducts;

  return (
    <View style={styles.root}>
      {/* ── Absolute header bar ── */}
      <View style={[styles.absHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn} onPress={handleOpenInbox} accessibilityRole="button" accessibilityLabel={isOwner ? 'Inbox' : 'Message seller'}>
            <Feather name="message-circle" size={20} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerBtn}
            onPress={handleShare}
            accessibilityRole="button"
            accessibilityLabel={isOwner ? 'Share profile' : 'Share seller profile'}
            accessibilityHint={isOwner ? 'Opens your shareable profile link and QR code' : 'Share this seller profile'}
            testID={isOwner ? 'seller-profile-share-btn' : undefined}
          >
            <Feather name="share-2" size={20} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[tabBarIndex]}
      >
        {/* 0: Spacer — replaces the old cover gradient */}
        <View style={{ height: insets.top + 56 }} />

        {/* 1: Profile Info */}
        <View style={styles.profileSection}>
          {/* Centered avatar */}
          <View style={styles.avatarCenter}>
            {profile.verified ? (
              <View style={styles.verifiedRing}>
                <View style={styles.avatar}>
                  {profileImageUrl ? (
                    <Image source={{ uri: profileImageUrl }} style={styles.avatarImage} accessibilityLabel={`${profile.brandName} avatar`} />
                  ) : (
                    <Text style={styles.avatarInitials}>{profile.initials}</Text>
                  )}
                </View>
              </View>
            ) : (
              <View style={styles.avatar}>
                {profileImageUrl ? (
                  <Image source={{ uri: profileImageUrl }} style={styles.avatarImage} accessibilityLabel={`${profile.brandName} avatar`} />
                ) : (
                  <Text style={styles.avatarInitials}>{profile.initials}</Text>
                )}
              </View>
            )}
          </View>

          {/* Brand name + verified */}
          <View style={styles.brandNameRow}>
            <Text style={styles.brandName}>{profile.brandName}</Text>
            {profile.verified && (
              <Feather name="check-circle" size={14} color={colors.primary} style={{ marginLeft: 6 }} accessibilityLabel="Verified seller" accessibilityRole="image" />
            )}
          </View>

          {/* Username */}
          <Text style={styles.username}>@{profile.username}</Text>

          {/* Vacation banner */}
          {!isOwner && (profile as any).vacationMode && (
            <View style={styles.vacationBanner}>
              <Feather name="sun" size={16} color={ORANGE} />
              <View style={{ flex: 1 }}>
                <Text style={styles.vacationTitle}>This seller is away</Text>
                <Text style={styles.vacationText}>
                  {(profile as any).vacationMessage ?? 'Purchases and new messages are paused for now.'}
                </Text>
              </View>
            </View>
          )}

          {/* Bio */}
          {!!profile.bio && (
            <Text style={styles.bio} numberOfLines={bioExpanded ? undefined : 2}>
              {truncatedBio}
              {profile.bio.length > 120 && !bioExpanded && (
                <Text onPress={() => setBioExpanded(true)} style={styles.bioMore}> more</Text>
              )}
            </Text>
          )}

          {/* Website */}
          {profile.website && (
            <TouchableOpacity
              style={styles.metaRow}
              onPress={() => {
                const url = profile.website!.startsWith('http')
                  ? profile.website!
                  : 'https://' + profile.website;
                Linking.openURL(url);
              }}
              activeOpacity={0.7}
            >
              <Feather name="link" size={12} color={colors.primary} />
              <Text style={[styles.metaText, { color: colors.primary }]}>{profile.website}</Text>
            </TouchableOpacity>
          )}

          {/* Location */}
          {profile.location && (
            <View style={styles.metaRow}>
              <Feather name="map-pin" size={12} color={MUTED} />
              <Text style={styles.metaText}>{profile.location}</Text>
            </View>
          )}

          {/* Category */}
          {profile.category && (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{profile.category}</Text>
            </View>
          )}

          {/* Action buttons row */}
          <View style={styles.actionButtons}>
            {isOwner ? (
              <>
                <TouchableOpacity style={[styles.outlineBtn, styles.outlineBtnPrimary]} onPress={() => router.push('/edit-profile' as never)}>
                  <Text style={[styles.outlineBtnText, { color: ACCENT }]}>Edit Profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.outlineBtn} onPress={handleOpenInbox}>
                  <Text style={styles.outlineBtnText}>Messages</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.outlineBtn} onPress={() => router.push('/create-post' as never)}>
                  <Text style={styles.outlineBtnText}>Create Post</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity
                  style={[styles.outlineBtn, isFollowing && styles.outlineBtnPrimary]}
                  onPress={handleFollow}
                  disabled={followPending}
                  accessibilityState={{ disabled: followPending, selected: isFollowing }}
                >
                  <Text style={[styles.outlineBtnText, isFollowing && { color: ACCENT }]}>
                    {followPending ? 'Updating…' : isFollowing ? 'Following' : 'Follow'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.outlineBtn} onPress={handleMessageSeller}>
                  <Feather name="message-circle" size={14} color={FG} style={{ marginRight: 4 }} />
                  <Text style={styles.outlineBtnText}>Message</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={handleMoreOptions}>
                  <Feather name="more-horizontal" size={16} color={FG} />
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        {/* 2: Stats Row */}
        <View style={styles.statsRow}>
          <TouchableOpacity
            style={styles.statItem}
            onPress={() => router.push('/connections?type=followers' as never)}
          >
            <Text style={styles.statNumber}>{formatCount(followers)}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </TouchableOpacity>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{apiRating && apiRating.totalCount > 0 ? apiRating.avgRating.toFixed(1) : '—'}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{formatCount(profile.productCount)}</Text>
            <Text style={styles.statLabel}>Products</Text>
          </View>
        </View>

        {/* 3 (buyer only): Shop Button */}
        {!isOwner && (
          <View style={styles.shopBtnWrapper}>
            <TouchableOpacity
              style={[styles.shopBtn, { borderColor: ACCENT }]}
              activeOpacity={0.85}
              onPress={() => setActiveTab(1)}
            >
              <Feather name="shopping-bag" size={16} color={ACCENT} />
              <Text style={[styles.shopBtnText, { color: ACCENT }]}>Shop {profile.brandName}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* TAB BAR (sticky) */}
        <View style={styles.tabBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBarContent}
          >
            {tabs.map((tab, i) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tabItem, activeTab === i && styles.tabItemActive]}
                onPress={() => setActiveTab(i)}
              >
                <Feather
                  name={tabIcon(tab)}
                  size={14}
                  color={activeTab === i ? FG : MUTED}
                />
                <Text style={[styles.tabText, activeTab === i && styles.tabTextActive]}>
                  {tab}
                </Text>
                {activeTab === i && <View style={[styles.tabUnderline, { backgroundColor: colors.primary }]} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* TAB CONTENT */}
        <View style={styles.tabContent}>
          {/* POSTS TAB */}
          {activeTab === 0 && (
            <View style={styles.postsGrid}>
              {isOwner && (
                <CreatePostTile onPress={() => router.push('/create-post' as never)} />
              )}
              {posts.map((post, i) => (
                <PostTile
                  key={post.id}
                  post={post}
                  index={i}
                  isOwner={isOwner}
                  onPress={handlePostPress}
                />
              ))}
              {posts.length === 0 && !isOwner && (
                <EmptyState icon="image" title="No posts yet" />
              )}
            </View>
          )}

          {/* PRODUCTS TAB */}
          {activeTab === 1 && (
            <View>
              <View style={styles.collectionHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.collectionTitle}>{isOwner ? 'Your products' : 'Shop the collection'}</Text>
                </View>
                <Text style={styles.collectionCount}>{displayProducts.length} item{displayProducts.length === 1 ? '' : 's'}</Text>
              </View>
              <View style={styles.productsGrid}>
                {productsLoading ? (
                  <ActivityIndicator color={colors.primary} style={{ marginTop: 40, alignSelf: 'center' }} />
                ) : displayProducts.length === 0 ? (
                  <EmptyState icon="shopping-bag" title="No products available" />
                ) : (
                  displayProducts.map((product, i) => (
                    <ProductCard
                      key={product.id}
                      product={product as Product}
                      index={i}
                      onPress={(id) => router.push((isOwner ? '/product-detail?id=' : '/buyer-product-detail?productId=') + id as never)}
                    />
                  ))
                )}
              </View>
            </View>
          )}

          {activeTab === 2 && (
            <EmptyState
              icon="at-sign"
              title="No tagged posts yet"
              subtitle="When sellers tag you, posts appear here."
            />
          )}
          {activeTab === 3 && <EmptyState icon="repeat" title="No reposts yet" />}
          {isOwner && activeTab === 4 && <EmptyState icon="bookmark" title="Nothing saved yet" />}
        </View>
      </ScrollView>

      {/* ── Post Action Sheet ── */}
      <Modal
        visible={showActionSheet}
        transparent
        animationType="slide"
        onRequestClose={handleActionSheetClose}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleActionSheetClose}
        />
        {selectedPost && (
          <View style={[styles.actionSheet, { paddingBottom: insets.bottom + SP.md }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetPostInfo}>
              <View style={[styles.sheetThumb, { backgroundColor: CARD }]} />
              <View style={styles.sheetPostMeta}>
                <Text style={styles.sheetCaption} numberOfLines={1}>
                  {selectedPost.caption}
                </Text>
                <View style={[styles.sheetStatusBadge, { backgroundColor: statusBadgeColor(selectedPost.status) + '33' }]}>
                  <Text style={[styles.sheetStatusText, { color: statusBadgeColor(selectedPost.status) }]}>
                    {selectedPost.status}
                  </Text>
                </View>
              </View>
            </View>
            <ActionRow icon="eye" label="Open post" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleActionSheetClose(); }} />
            <ActionRow icon="edit-2" label="Edit post" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleActionSheetClose(); router.push(('/create-post?editId=' + selectedPost.id) as never); }} />
            <ActionRow icon="bar-chart-2" label="View analytics" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleActionSheetClose(); router.push(('/post-analytics?id=' + selectedPost.id) as never); }} />
            <ActionRow icon="map-pin" label={selectedPost.isPinned ? 'Unpin post' : 'Pin post'} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleActionSheetClose(); }} />
            <ActionRow icon="archive" label="Archive post" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleActionSheetClose(); }} />
            <ActionRow icon="copy" label="Copy link" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleActionSheetClose(); Alert.alert('Link copied'); }} />
            <ActionRow icon="bookmark" label="Save post" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleActionSheetClose(); }} />
            <View style={styles.sheetSeparator} />
            <ActionRow icon="trash-2" label="Delete post" color={RED} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleActionSheetClose(); }} />
            <TouchableOpacity style={styles.sheetCancel} onPress={handleActionSheetClose}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  scroll: { flex: 1, backgroundColor: 'transparent' },

  // Absolute header
  absHeader: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
    flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SP.md,
  },
  headerActions: { flexDirection: 'row', gap: SP.sm },
  headerBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(10,10,11,0.72)', borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },

  // Profile section — centered
  profileSection: {
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingBottom: SP.lg,
  },
  avatarCenter: { marginBottom: SP.md },
  verifiedRing: {
    borderWidth: 1.5, borderColor: ACCENT,
    borderRadius: RADIUS.pill, padding: 2,
  },
  avatar: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%', borderRadius: 48 },
  avatarInitials: { color: FG, fontSize: FS.xl, fontFamily: FONT.bold },

  brandNameRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  brandName: { color: FG, fontSize: FS.lg, fontFamily: FONT.bold, letterSpacing: -0.3 },
  username: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium, marginBottom: SP.sm },

  vacationBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
    marginVertical: SP.sm, borderWidth: 1, borderColor: `${ORANGE}55`,
    borderRadius: RADIUS.md, padding: SP.sm, alignSelf: 'stretch',
  },
  vacationTitle: { color: ORANGE, fontFamily: FONT.bold, fontSize: FS.sm, marginBottom: 3 },
  vacationText: { color: FG, fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 18 },

  bio: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.regular, lineHeight: 21, textAlign: 'center', marginBottom: SP.sm, maxWidth: 320 },
  bioMore: { color: MUTED, fontSize: FS.sm },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: SP.xs },
  metaText: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.regular },

  categoryBadge: {
    alignSelf: 'center', backgroundColor: SURFACE,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 11, paddingVertical: 5, marginTop: SP.xs, marginBottom: SP.sm,
  },
  categoryBadgeText: { color: FG, fontSize: FS.xs, fontFamily: FONT.semibold, letterSpacing: 0.5, textTransform: 'uppercase' },

  // Action buttons
  actionButtons: {
    flexDirection: 'row', gap: SP.sm, marginTop: SP.md, alignSelf: 'stretch', justifyContent: 'center',
  },
  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md,
    paddingHorizontal: SP.md, paddingVertical: 9, minWidth: 88,
  },
  outlineBtnPrimary: { borderColor: ACCENT },
  outlineBtnText: { color: FG, fontSize: FS.sm, fontFamily: FONT.semibold },
  iconBtn: {
    width: 38, height: 38, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER,
    marginBottom: SP.md, paddingVertical: SP.md, paddingHorizontal: SP.sm,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statNumber: { color: FG, fontSize: FS.md, fontFamily: FONT.bold },
  statLabel: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginTop: 2 },
  statDivider: { width: 1, backgroundColor: BORDER, marginVertical: 4 },

  // Shop button (buyer view only) — outline only, no gradient fill
  shopBtnWrapper: { marginHorizontal: SP.md, marginBottom: SP.sm },
  shopBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: SP.sm, paddingVertical: 12, borderWidth: 1, borderRadius: RADIUS.md,
  },
  shopBtnText: { fontSize: FS.base, fontFamily: FONT.semibold },

  // Tab bar
  tabBar: {
    backgroundColor: SURFACE,
    borderTopWidth: 1, borderTopColor: BORDER,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  tabBarContent: { paddingHorizontal: SP.md },
  tabItem: {
    flexDirection: 'row', gap: 6, paddingVertical: 13,
    marginRight: SP.lg, position: 'relative', alignItems: 'center',
  },
  tabItemActive: {},
  tabText: { color: MUTED, fontSize: FS.sm, fontFamily: FONT.medium },
  tabTextActive: { color: FG, fontFamily: FONT.semibold },
  tabUnderline: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, borderRadius: 1 },

  // Tab content
  tabContent: { paddingBottom: 120, minHeight: 300 },

  // Posts grid
  postsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 1 },

  // Products grid
  productsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: SP.md, paddingBottom: SP.lg, gap: SP.sm },
  collectionHeader: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: SP.md, paddingTop: SP.lg, paddingBottom: SP.md,
  },
  collectionTitle: { color: FG, fontSize: FS.md, fontFamily: FONT.bold },
  collectionCount: { color: MUTED, fontSize: FS.xs, fontFamily: FONT.medium, marginBottom: 3 },

  // Action sheet
  modalOverlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  actionSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
  },
  sheetHandle: { width: 36, height: 4, backgroundColor: BORDER, borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: SP.md },
  sheetPostInfo: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingBottom: SP.md, gap: 12, borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: 4 },
  sheetThumb: { width: 40, height: 40, borderRadius: RADIUS.sm },
  sheetPostMeta: { flex: 1 },
  sheetCaption: { color: FG, fontSize: FS.sm, fontFamily: FONT.medium, marginBottom: 4 },
  sheetStatusBadge: { alignSelf: 'flex-start', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  sheetStatusText: { fontSize: 11, fontFamily: FONT.semibold, textTransform: 'capitalize' },
  sheetSeparator: { height: 1, backgroundColor: BORDER, marginHorizontal: SP.md, marginVertical: 4 },
  sheetCancel: { paddingVertical: SP.md, alignItems: 'center', borderTopWidth: 1, borderTopColor: BORDER, marginTop: 4 },
  sheetCancelText: { color: FG, fontSize: FS.base, fontFamily: FONT.bold },
});
