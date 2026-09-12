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
  Platform,
  ActivityIndicator,
  Alert,
  Image,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import type { SellerPost } from '@/services/types';
import type { Product } from '@/services/productTypes';
import { useApi } from '@/hooks/useApi';
import { useColors } from '@/hooks/useColors';
import { formatCents } from '@/lib/money';
import { getSellerFollowState, setSellerFollowing } from '@/services/socialService';
import { BG, SURFACE, CARD, BORDER, FG, MUTED, BLUE, ORANGE, RED, FONT, FS, SP, RADIUS } from '@/lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TILE_SIZE = Math.floor((SCREEN_WIDTH - 2) / 3);

const GRADIENT_PAIRS: [string, string][] = [
  [CARD, BG],
  [SURFACE, BG],
  [CARD, SURFACE],
  [SURFACE, CARD],
];

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
    // Only an explicit server boolean grants this public credential.
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
  const styles = React.useMemo(() => createStyles(colorsTheme), [colorsTheme]);
  const GREEN = colorsTheme.primary;
  const colors = GRADIENT_PAIRS[index % GRADIENT_PAIRS.length];
  const icon = typeIcon(post.type);
  const views = post.analytics?.views;

  return (
    <TouchableOpacity
      style={[styles.postTile, { width: TILE_SIZE, height: TILE_SIZE }]}
      onPress={() => onPress(post)}
      activeOpacity={0.85}
    >
      <LinearGradient
        colors={colors}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      {/* Pinned indicator */}
      {post.isPinned && (
        <View style={styles.tilePinned}>
          <Feather name="map-pin" size={10} color={GREEN} />
        </View>
      )}
      {/* Type icon top-right */}
      <View style={styles.tileTypeIcon}>
        <Feather name={icon} size={11} color="rgba(255,255,255,0.85)" />
      </View>
      {/* Views bottom-left */}
      {views != null && !(post as any).__analyticsUnavailable && (
        <View style={styles.tileViews}>
          <Feather name="eye" size={8} color="white" />
          <Text style={styles.tileViewsText}>{formatCount(views)}</Text>
        </View>
      )}
      {/* Status badge for owner non-published */}
      {isOwner && post.status !== 'published' && (
        <View style={[styles.tileStatusBadge, { backgroundColor: statusBadgeColor(post.status) + '33', borderColor: statusBadgeColor(post.status) }]}>
          <Text style={[styles.tileStatusText, { color: statusBadgeColor(post.status) }]}>
            {post.status}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Create Post Tile ──────────────────────────────────────────────────────────

function CreatePostTile({ onPress }: { onPress: () => void }) {
  const colorsTheme = useColors();
  const styles = React.useMemo(() => createStyles(colorsTheme), [colorsTheme]);
  const GREEN = colorsTheme.primary;
  return (
    <TouchableOpacity
      style={[styles.postTile, styles.createTile, { width: TILE_SIZE, height: TILE_SIZE }]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Feather name="plus" size={24} color={GREEN} />
      <Text style={styles.createTileLabel}>New post</Text>
    </TouchableOpacity>
  );
}

// ─── Product Card ──────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: Product;
  index: number;
  onPress: (id: string) => void;
}

function ProductCard({ product, index, onPress }: ProductCardProps) {
  const colorsTheme = useColors();
  const styles = React.useMemo(() => createStyles(colorsTheme), [colorsTheme]);
  const GREEN = colorsTheme.primary;
  const GREEN_DIM = colorsTheme.accent;
  const PURPLE = colorsTheme.primary;
  const gradColors = GRADIENT_PAIRS[index % GRADIENT_PAIRS.length];
  const totalInventory = product.inventory.totalStock;
  const lowStockThreshold = product.inventory.lowStockThreshold;
  const isLowStock = totalInventory > 0 && totalInventory <= lowStockThreshold;
  const isOutOfStock = totalInventory === 0 && product.salesModel !== 'pre-order';

  let stockLabel = 'In stock';
  let stockColor = GREEN;
  if (product.salesModel === 'pre-order') { stockLabel = 'Pre-order'; stockColor = PURPLE; }
  else if (isOutOfStock) { stockLabel = 'Out of stock'; stockColor = MUTED; }
  else if (isLowStock) { stockLabel = 'Low stock'; stockColor = ORANGE; }

  const coverMedia = product.media && product.media[0];
  const hasCoverImage = coverMedia && coverMedia.uri && coverMedia.uri.startsWith('http');

  const isDraftOrArchived = product.status === 'draft' || product.status === 'archived';

  return (
    <TouchableOpacity
      style={styles.productCard}
      onPress={() => onPress(product.id)}
      activeOpacity={0.85}
    >
      <View style={styles.productImageContainer}>
        {hasCoverImage ? (
          <Image
            source={{ uri: coverMedia.uri }}
            style={styles.productImagePlaceholder}
            resizeMode="cover"
          />
        ) : (
          <LinearGradient
            colors={gradColors}
            style={styles.productImagePlaceholder}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
        )}
        {isDraftOrArchived && (
          <View style={styles.productStatusBadge}>
            <Text style={styles.productStatusBadgeText}>
              {product.status === 'draft' ? 'Draft' : 'Archived'}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.productInfo}>
        <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
        <View style={styles.productPriceRow}>
          <Text style={styles.productPrice}>{formatCents(product.pricing.priceCents)}</Text>
          {product.pricing.compareAtPriceCents != null && (
            <Text style={styles.productCompare}>{formatCents(product.pricing.compareAtPriceCents)}</Text>
          )}
        </View>
        <View style={styles.productBadgeRow}>
          <View style={[styles.productBadge, { backgroundColor: product.salesModel === 'pre-order' ? PURPLE + '22' : GREEN_DIM, borderColor: product.salesModel === 'pre-order' ? PURPLE : GREEN }]}>
            <Text style={[styles.productBadgeText, { color: product.salesModel === 'pre-order' ? PURPLE : GREEN }]}>
              {product.salesModel === 'pre-order' ? 'Pre-order' : 'Pre-made'}
            </Text>
          </View>
        </View>
        <Text style={[styles.productStock, { color: stockColor }]}>{stockLabel}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ icon, title, subtitle }: { icon: keyof typeof Feather.glyphMap; title: string; subtitle?: string }) {
  const colorsTheme = useColors();
  const styles = React.useMemo(() => createStyles(colorsTheme), [colorsTheme]);
  return (
    <View style={styles.emptyState}>
      <Feather name={icon} size={48} color={MUTED} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle && <Text style={styles.emptySubtitle}>{subtitle}</Text>}
    </View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function SellerProfileScreen() {
  const colorsTheme = useColors();
  const styles = React.useMemo(() => createStyles(colorsTheme), [colorsTheme]);
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; isOwner?: string }>();
  const isOwner = params.isOwner === 'true';

  const api = useApi();

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
  const [profileError, setProfileError] = useState<string | null>(null);
  const [followPending, setFollowPending] = useState(false);

  // Load seller data from the real API. Never fill a signed-in view with demo data.
  useEffect(() => {
    const sellerId = params.id as string | undefined;
    (async () => {
      setProfileLoading(true);
      setProductsLoading(true);
      setProfileError(null);
      try {
        if (!sellerId && isOwner) {
          const [p, postRows] = await Promise.all([
            api.seller.getProfile(),
            api.posts.publicList(),
          ]);
          const ownPosts = postRows.filter((post: any) => post.userId === p.clerkId).map(mapApiPost);
          setProfile(mapApiProfile(p, ownPosts.length));
          setPosts(ownPosts);
          setProfileImageUrl(p.profileImageUrl ?? null);
          setLiveProducts([]);
        } else {
          if (!sellerId) throw new Error('Seller not found.');
          api.publicSellers.recordVisit(sellerId).catch(() => {});
          const [data, postRows, followState] = await Promise.all([
            api.publicSellers.get(sellerId),
            api.posts.publicList(sellerId),
            getSellerFollowState(sellerId),
          ]);
          const sellerPosts = postRows.map(mapApiPost);
          const products = Array.isArray(data.products) ? data.products as Product[] : [];
          setProfile(mapApiProfile(data.profile ?? {}, sellerPosts.length, products.length));
          setFollowers(Number(followState.followersCount ?? data.profile?.followersCount ?? 0));
          setIsFollowing(followState.isFollowing);
          setProfileImageUrl(typeof data.profile?.profileImageUrl === 'string' ? data.profile.profileImageUrl : null);
          setLiveProducts(products);
          setPosts(sellerPosts);
        }
      } catch {
        setPosts([]);
        setLiveProducts([]);
        setProfileError('We couldn’t load this seller profile. Check your connection and try again.');
      } finally {
        setProfileLoading(false);
        setProductsLoading(false);
      }
    })();
  }, [api, isOwner, params.id]);

  // Load reviews separately (keep as-is)
  useEffect(() => {
    const sellerId = (params.id ?? (profile as any).sellerId) as string | undefined;
    if (!sellerId) return;
    api.reviews.forSeller(sellerId)
      .then((data: any) => setApiRating({ avgRating: data.avgRating ?? 0, totalCount: data.totalCount ?? 0 }))
      .catch(() => {});
  }, [params.id]);

  const tabs = ['Posts', 'Products'];

  const handleFollow = useCallback(async () => {
    if (followPending) return;
    const sellerId = params.id ?? profile.sellerId;
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
      Alert.alert('Couldn’t update follow', 'Check your connection and try again.');
    } finally {
      setFollowPending(false);
    }
  }, [followPending, followers, isFollowing, params.id, profile.sellerId]);

  const handleShare = useCallback(() => {
    Share.share({ message: 'Check out @' + profile.username + ' on Brandthread' });
  }, [profile.username]);

  const handleMessageSeller = useCallback(() => {
    if ((profile as any).vacationMode) {
      Alert.alert(
        'Seller is away',
        (profile as any).vacationMessage ?? 'This seller is currently away and is not accepting new messages.',
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const sellerId = params.id ?? profile.sellerId;
    router.push((
      '/buyer-conversation?participantId=' + encodeURIComponent(sellerId) +
      '&participantName=' + encodeURIComponent(profile.brandName) +
      '&participantHandle=%40' + encodeURIComponent(profile.username) +
      '&participantInitials=' + encodeURIComponent(profile.initials) +
      '&participantColor=' + encodeURIComponent(profile.avatarColor) +
      '&participantAccountType=seller&type=buyer_to_seller'
    ) as never);
  }, [router, profile, params.id]);

  const handleOpenInbox = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push((isOwner ? '/seller-inbox' : '/(buyer)/inbox') as never);
  }, [isOwner, router]);

  const handleMoreOptions = useCallback(() => {
    const sellerId = params.id ?? profile.sellerId;
    Alert.alert(
      profile.brandName,
      'What would you like to do?',
      [
        { text: 'Share profile', onPress: handleShare },
        {
          text: 'Report seller',
          style: 'destructive',
          onPress: () => router.push((
            '/buyer-report?targetType=seller&targetId=' + encodeURIComponent(sellerId) +
            '&targetLabel=' + encodeURIComponent(profile.brandName)
          ) as never),
        },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }, [profile, handleShare, router, params.id]);

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

  // stickyHeaderIndices: [0]=cover, [1]=profile, [2]=stats, [3]=shopBtn or tabBar
  // Layout in ScrollView: [0] Cover, [1] ProfileInfo, [2] StatsRow, [3] ShopBtn (if !isOwner), [N] TabBar
  // We need tabBarIndex:
  const tabBarIndex = isOwner ? 3 : 4;

  if (profileLoading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', gap: 12 }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={{ color: MUTED }}>Loading seller profile…</Text>
      </View>
    );
  }

  if (profileError) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 28 }]}>
        <Feather name="alert-circle" size={32} color={RED} />
        <Text style={{ color: FG, fontSize: 16, fontFamily: FONT.semibold }}>Couldn’t load profile</Text>
        <Text style={{ color: MUTED, textAlign: 'center' }}>{profileError}</Text>
        <TouchableOpacity
          style={styles.followBtn}
          onPress={() => router.replace((params.id ? '/seller-profile?id=' + params.id : '/seller-profile?isOwner=true') as never)}
        >
          <Text style={styles.followBtnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const displayProducts = liveProducts;

  return (
    <View style={styles.root}>
      {/* ─── Absolute Header ───────────────────────────────────────────────── */}
      <View style={[styles.absHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.headerBtn} onPress={handleOpenInbox}>
            <Feather name="message-circle" size={20} color={FG} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={handleShare}>
            <Feather name="share" size={20} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ─── Main ScrollView ───────────────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[tabBarIndex]}
      >
        {/* 0: Cover Area */}
        <LinearGradient
          colors={[BG, SURFACE, FG, SURFACE, BG]}
          locations={[0, 0.28, 0.52, 0.72, 1]}
          style={styles.cover}
          start={{ x: 0.05, y: 0 }}
          end={{ x: 0.95, y: 1 }}
        >
          <View style={styles.coverContent}>
            <View style={styles.coverRule} />
            <Text style={styles.coverKicker}>THREAD THEME / EDITION 01</Text>
            <Text style={styles.coverTitle} numberOfLines={1}>{profile.brandName}</Text>
            <Text style={styles.coverSubline}>THE ORIGINALS</Text>
          </View>
        </LinearGradient>

        {/* 1: Profile Info */}
        <View style={styles.profileSection}>
          {/* Avatar + action buttons row */}
          <View style={styles.avatarActionRow}>
            {/* Avatar */}
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

            {/* Action buttons */}
            <View style={styles.actionButtons}>
              {isOwner ? (
                <>
                  <TouchableOpacity
                    style={styles.outlineBtn}
                    onPress={() => router.push('/edit-profile' as never)}
                  >
                    <Text style={styles.outlineBtnText}>Edit Profile</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.outlineBtn}
                    onPress={handleOpenInbox}
                  >
                    <Text style={styles.outlineBtnText}>Messages</Text>
                  </TouchableOpacity>
                  <LinearGradient
                    colors={[colors.primary, colors.accentForeground] as const}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.gradientBtnWrap}
                  >
                    <TouchableOpacity
                      style={styles.gradientBtnInner}
                      onPress={() => router.push('/create-post' as never)}
                    >
                      <Text style={styles.gradientBtnText}>Create Post</Text>
                    </TouchableOpacity>
                  </LinearGradient>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.profileActionBtn, styles.followBtn, isFollowing && styles.followingBtn]}
                    onPress={handleFollow}
                    disabled={followPending}
                    accessibilityState={{ disabled: followPending, selected: isFollowing }}
                  >
                    <Text style={[styles.followBtnText, isFollowing && styles.followingBtnText]}>
                      {followPending ? 'Updating…' : isFollowing ? 'Following' : 'Follow'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.profileActionBtn, styles.chatBtn]}
                    onPress={handleMessageSeller}
                  >
                    <Feather name="message-circle" size={16} color={FG} />
                    <Text style={styles.chatBtnText}>Chat</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.iconOutlineBtn} onPress={handleMoreOptions}>
                    <Feather name="more-horizontal" size={16} color={FG} />
                  </TouchableOpacity>
                </>
              )}
            </View>
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
          <Text style={styles.bio}>
            {truncatedBio}
            {profile.bio.length > 120 && !bioExpanded && (
              <Text onPress={() => setBioExpanded(true)} style={styles.bioMore}> more</Text>
            )}
          </Text>

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
              <Text style={styles.websiteText}>{profile.website}</Text>
            </TouchableOpacity>
          )}

          {/* Location */}
          {profile.location && (
            <View style={styles.metaRow}>
              <Feather name="map-pin" size={12} color={MUTED} />
              <Text style={styles.locationText}>{profile.location}</Text>
            </View>
          )}

          {/* Category badge */}
          {profile.category && (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{profile.category}</Text>
            </View>
          )}
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
            <LinearGradient
              colors={[colors.primary, colors.accentForeground] as const}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.shopBtnGradient}
            >
              <TouchableOpacity style={styles.shopBtnInner} activeOpacity={0.85} onPress={() => setActiveTab(1)}>
                <Feather name="shopping-bag" size={18} color={BG} />
                <Text style={styles.shopBtnText}>Shop</Text>
              </TouchableOpacity>
            </LinearGradient>
          </View>
        )}

        {/* TAB BAR — this is the sticky element */}
        <View style={styles.tabBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabBarContent}
          >
            {tabs.map((tab, i) => (
              <TouchableOpacity
                key={tab}
                style={styles.tabItem}
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
                {activeTab === i && <View style={styles.tabUnderline} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* TAB CONTENT */}
        <View style={styles.tabContent}>
          {/* ── POSTS TAB ────────────────────────────────────────────────── */}
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
            </View>
          )}

          {/* ── PRODUCTS TAB ─────────────────────────────────────────────── */}
          {activeTab === 1 && (
            <View>
              <View style={styles.collectionHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.collectionKicker}>THE COLLECTION</Text>
                  <Text style={styles.collectionTitle}>{isOwner ? 'Your products' : 'Shop the edit'}</Text>
                </View>
                <Text style={styles.collectionCount}>{displayProducts.length} piece{displayProducts.length === 1 ? '' : 's'}</Text>
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

          {/* ── TAGGED TAB ───────────────────────────────────────────────── */}
          {activeTab === 2 && (
            <EmptyState
              icon="at-sign"
              title="No tagged posts yet"
              subtitle="When sellers tag you, posts appear here."
            />
          )}

          {/* ── REPOSTS TAB ──────────────────────────────────────────────── */}
          {activeTab === 3 && (
            <EmptyState icon="repeat" title="No reposts yet" />
          )}

          {/* ── SAVED TAB (owner only) ───────────────────────────────────── */}
          {isOwner && activeTab === 4 && (
            <EmptyState icon="bookmark" title="Nothing saved yet" />
          )}
        </View>
      </ScrollView>

      {/* ─── Post Action Sheet Modal ───────────────────────────────────────── */}
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
          <View style={[styles.actionSheet, { paddingBottom: insets.bottom + 16 }]}>
            {/* Handle */}
            <View style={styles.sheetHandle} />

            {/* Post info row */}
            <View style={styles.sheetPostInfo}>
              <LinearGradient
                colors={GRADIENT_PAIRS[0]}
                style={styles.sheetThumb}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              />
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

            {/* Actions */}
            <ActionRow
              icon="eye"
              label="Open post"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleActionSheetClose();
              }}
            />
            <ActionRow
              icon="edit-2"
              label="Edit post"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleActionSheetClose();
                router.push(('/create-post?editId=' + selectedPost.id) as never);
              }}
            />
            <ActionRow
              icon="bar-chart-2"
              label="View analytics"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleActionSheetClose();
                router.push(('/post-analytics?id=' + selectedPost.id) as never);
              }}
            />
            <ActionRow
              icon="map-pin"
              label={selectedPost.isPinned ? 'Unpin post' : 'Pin post'}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleActionSheetClose();
              }}
            />
            <ActionRow
              icon="archive"
              label="Archive post"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleActionSheetClose();
              }}
            />
            <ActionRow
              icon="copy"
              label="Copy link"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleActionSheetClose();
                Alert.alert('Link copied');
              }}
            />
            <ActionRow
              icon="bookmark"
              label="Save post"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleActionSheetClose();
              }}
            />

            {/* Separator */}
            <View style={styles.sheetSeparator} />

            <ActionRow
              icon="trash-2"
              label="Delete post"
              color={RED}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleActionSheetClose();
              }}
            />

            {/* Cancel */}
            <TouchableOpacity style={styles.sheetCancel} onPress={handleActionSheetClose}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>
    </View>
  );
}

// ─── Action Row ────────────────────────────────────────────────────────────────

interface ActionRowProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color?: string;
  onPress: () => void;
}

function ActionRow({ icon, label, color = FG, onPress }: ActionRowProps) {
  const colorsTheme = useColors();
  const styles = React.useMemo(() => createStyles(colorsTheme), [colorsTheme]);
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} activeOpacity={0.7}>
      <Feather name={icon} size={18} color={color} />
      <Text style={[styles.actionRowLabel, { color }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={MUTED} />
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const createStyles = (colorsTheme: ReturnType<typeof useColors>) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  scroll: {
    flex: 1,
    backgroundColor: 'transparent',
  },

  // ── Absolute Header ──
  absHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Cover ──
  cover: {
    height: 230,
    overflow: 'hidden',
  },
  coverContent: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    paddingHorizontal: SP.lg,
    paddingBottom: 54,
  },
  coverRule: {
    width: 54,
    height: 2,
    backgroundColor: FG,
    marginBottom: SP.sm,
    shadowColor: BG,
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  coverKicker: {
    color: FG,
    fontFamily: FONT.bold,
    fontSize: 9,
    letterSpacing: 1.4,
    textShadowColor: BG,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  coverTitle: {
    maxWidth: '88%',
    color: FG,
    fontFamily: FONT.extrabold,
    fontSize: FS.h1,
    lineHeight: 40,
    letterSpacing: -1.5,
    textAlign: 'right',
    textTransform: 'uppercase',
    textShadowColor: BG,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  coverSubline: {
    color: FG,
    fontFamily: FONT.medium,
    fontSize: 10,
    letterSpacing: 2.2,
    textShadowColor: BG,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  // ── Profile Section ──
  profileSection: {
    paddingHorizontal: SP.md,
    marginTop: -44,
    paddingBottom: SP.lg,
  },
  avatarActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    gap: SP.sm,
    marginBottom: SP.md,
  },
  verifiedRing: {
    borderWidth: 1.5,
    borderColor: colorsTheme.primary,
    borderRadius: RADIUS.pill,
    padding: 2,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 4,
    borderColor: BG,
    backgroundColor: FG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 42,
  },
  avatarInitials: {
    color: BG,
    fontSize: FS.xxl,
    fontFamily: FONT.extrabold,
    letterSpacing: -1,
  },
  actionButtons: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  profileActionBtn: {
    minWidth: 92,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  outlineBtnText: {
    color: FG,
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },
  gradientBtnWrap: {
    borderRadius: RADIUS.pill,
  },
  gradientBtnInner: {
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  gradientBtnText: {
    color: BG,
    fontSize: FS.xs,
    fontFamily: FONT.bold,
  },
  followBtn: {
    borderWidth: 1,
    borderColor: colorsTheme.primary,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  followingBtn: {
    backgroundColor: colorsTheme.primary,
  },
  followBtnText: {
    color: colorsTheme.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  followingBtnText: {
    color: BG,
  },
  chatBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    backgroundColor: CARD,
  },
  chatBtnText: {
    color: FG,
    fontSize: 13,
    fontFamily: FONT.semibold,
  },
  iconOutlineBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  brandNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  brandName: {
    color: FG,
    fontSize: FS.h2,
    lineHeight: 34,
    fontFamily: FONT.extrabold,
    letterSpacing: -1,
  },
  username: {
    color: MUTED,
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    marginBottom: SP.md,
  },
  vacationBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginTop: 8, borderWidth: 1, borderColor: `${ORANGE}66`,
    backgroundColor: `${ORANGE}12`, borderRadius: 12, padding: 12,
  },
  vacationTitle: { color: ORANGE, fontWeight: '700', fontSize: 13, marginBottom: 3 },
  vacationText: { color: FG, fontSize: 12, lineHeight: 18 },
  bio: {
    color: FG,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    lineHeight: 23,
    marginBottom: SP.md,
    maxWidth: 560,
  },
  bioMore: {
    color: MUTED,
    fontSize: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: SP.sm,
  },
  websiteText: {
    color: colorsTheme.primary,
    fontSize: 13,
  },
  locationText: {
    color: MUTED,
    fontSize: 13,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: SURFACE,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 11,
    paddingVertical: 5,
    marginTop: SP.xs,
  },
  categoryBadgeText: {
    color: FG,
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  // ── Stats Row ──
  statsRow: {
    flexDirection: 'row',
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    marginBottom: SP.md,
    paddingVertical: SP.md,
    paddingHorizontal: SP.sm,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    color: FG,
    fontSize: FS.md,
    fontFamily: FONT.bold,
  },
  statLabel: {
    color: MUTED,
    fontSize: 10,
    fontFamily: FONT.medium,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: BORDER,
    marginVertical: 4,
  },

  // ── Shop Button ──
  shopBtnWrapper: {
    marginHorizontal: 20,
    marginBottom: 4,
  },
  shopBtnGradient: {
    borderRadius: 14,
  },
  shopBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  shopBtnText: {
    color: BG,
    fontSize: 16,
    fontWeight: '700',
  },

  // ── Tab Bar ──
  tabBar: {
    backgroundColor: SURFACE,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tabBarContent: {
    paddingHorizontal: 20,
  },
  tabItem: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 14,
    marginRight: 22,
    position: 'relative',
    alignItems: 'center',
  },
  tabText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '500',
  },
  tabTextActive: {
    color: FG,
    fontWeight: '600',
  },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colorsTheme.primary,
    borderRadius: 1,
  },

  // ── Tab Content ──
  tabContent: {
    paddingBottom: 120,
    minHeight: 300,
  },

  // ── Posts Grid ──
  postsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 1,
  },
  postTile: {
    overflow: 'hidden',
    position: 'relative',
  },
  createTile: {
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  createTileLabel: {
    color: MUTED,
    fontSize: 11,
    marginTop: 4,
  },
  tilePinned: {
    position: 'absolute',
    top: 5,
    left: 5,
  },
  tileTypeIcon: {
    position: 'absolute',
    top: 5,
    right: 5,
  },
  tileViews: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  tileViewsText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
  tileStatusBadge: {
    position: 'absolute',
    bottom: 5,
    right: 5,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  tileStatusText: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'capitalize',
  },

  // ── Products Grid ──
  productsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SP.md,
    paddingBottom: SP.lg,
    gap: SP.sm,
  },
  productCard: {
    width: (SCREEN_WIDTH - 40) / 2,
    backgroundColor: BG,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
  },
  productImageContainer: {
    position: 'relative',
    height: 176,
    width: '100%',
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    backgroundColor: CARD,
  },
  productImagePlaceholder: {
    height: 176,
    width: '100%',
  },
  productStatusBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: ORANGE,
  },
  productStatusBadgeText: {
    color: ORANGE,
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  productInfo: {
    paddingHorizontal: 2,
    paddingTop: 10,
    paddingBottom: SP.md,
  },
  productName: {
    color: FG,
    fontSize: FS.sm,
    lineHeight: 18,
    fontFamily: FONT.semibold,
    marginBottom: 4,
  },
  productPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  productPrice: {
    color: FG,
    fontSize: FS.sm,
    fontFamily: FONT.bold,
  },
  productCompare: {
    color: MUTED,
    fontSize: 12,
    textDecorationLine: 'line-through',
  },
  productBadgeRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  productBadge: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  productBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  productStock: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    marginTop: 2,
  },
  collectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SP.md,
    paddingTop: SP.lg,
    paddingBottom: SP.md,
  },
  collectionKicker: {
    color: colorsTheme.primary,
    fontSize: 9,
    fontFamily: FONT.bold,
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  collectionTitle: {
    color: FG,
    fontSize: FS.xl,
    fontFamily: FONT.extrabold,
    letterSpacing: -0.6,
  },
  collectionCount: {
    color: MUTED,
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    marginBottom: 3,
  },

  // ── Empty State ──
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyTitle: {
    color: FG,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtitle: {
    color: MUTED,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },

  // ── Action Sheet Modal ──
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  actionSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: CARD,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: BORDER,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  sheetPostInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    marginBottom: 4,
  },
  sheetThumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
  },
  sheetPostMeta: {
    flex: 1,
  },
  sheetCaption: {
    color: FG,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  sheetStatusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sheetStatusText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  actionRowLabel: {
    flex: 1,
    fontSize: 16,
  },
  sheetSeparator: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  sheetCancel: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: 4,
  },
  sheetCancelText: {
    color: FG,
    fontSize: 16,
    fontWeight: '700',
  },
});
