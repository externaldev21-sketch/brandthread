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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  DEMO_SELLER_PROFILE,
  DEMO_SELLER_POSTS,
  DEMO_PRODUCTS,
  getPublishedPosts,
} from '@/services/sellerContent';
import type { SellerPost } from '@/services/types';
import { getProducts } from '@/services/productService';
import type { Product } from '@/services/productTypes';

// ─── Design Tokens ─────────────────────────────────────────────────────────────
const BG        = '#0A0B0A';
const CARD      = '#111311';
const BORDER    = '#1E221E';
const FG        = '#EAF2ED';
const MUTED     = '#5A6B5C';
const GREEN     = '#39FF88';
const GREEN_DIM = '#0A2B18';
const PURPLE    = '#8B5CF6';
const BLUE      = '#3B82F6';
const ORANGE    = '#F97316';
const ERR       = '#F87171';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Helpers ───────────────────────────────────────────────────────────────────

const TILE_SIZE = Math.floor((SCREEN_WIDTH - 2) / 3);

const GRADIENT_PAIRS: [string, string][] = [
  ['#4A3B7A', '#1E1540'],
  ['#1F3A5F', '#0A1828'],
  ['#3D1F0F', '#1A0A05'],
  ['#1A1A1A', '#0A0A0A'],
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

function statusBadgeColor(status: string): string {
  if (status === 'draft') return ORANGE;
  if (status === 'scheduled') return BLUE;
  if (status === 'failed') return ERR;
  return MUTED;
}

// ─── Post Tile ─────────────────────────────────────────────────────────────────

interface PostTileProps {
  post: SellerPost;
  index: number;
  isOwner: boolean;
  onPress: (post: SellerPost) => void;
}

function PostTile({ post, index, isOwner, onPress }: PostTileProps) {
  const colors = GRADIENT_PAIRS[index % GRADIENT_PAIRS.length];
  const icon = typeIcon(post.type);
  const views = post.analytics?.views ?? 0;

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
      <View style={styles.tileViews}>
        <Feather name="eye" size={8} color="white" />
        <Text style={styles.tileViewsText}>{formatCount(views)}</Text>
      </View>
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
          <Text style={styles.productPrice}>${product.pricing.price.toFixed(2)}</Text>
          {product.pricing.compareAtPrice != null && (
            <Text style={styles.productCompare}>${product.pricing.compareAtPrice.toFixed(2)}</Text>
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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; isOwner?: string }>();
  const isOwner = params.isOwner === 'true';

  const profile = DEMO_SELLER_PROFILE;

  const [activeTab, setActiveTab] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followers, setFollowers] = useState(profile.followers);
  const [selectedPost, setSelectedPost] = useState<SellerPost | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [liveProducts, setLiveProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

  useEffect(() => {
    getProducts({ filter: 'active' })
      .then(setLiveProducts)
      .catch(() => {})
      .finally(() => setProductsLoading(false));
  }, []);

  const posts = isOwner ? DEMO_SELLER_POSTS : getPublishedPosts();

  const tabs = isOwner
    ? ['Posts', 'Products', 'Tagged', 'Reposts', 'Saved']
    : ['Posts', 'Products', 'Tagged', 'Reposts'];

  const handleFollow = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsFollowing(prev => {
      const next = !prev;
      setFollowers(f => next ? f + 1 : f - 1);
      return next;
    });
  }, []);

  const handleShare = useCallback(() => {
    Share.share({ message: 'Check out @' + profile.username + ' on Brandthread' });
  }, [profile.username]);

  const handleMessageSeller = useCallback(() => {
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

  const displayProducts = liveProducts.length > 0 ? liveProducts : DEMO_PRODUCTS;

  return (
    <View style={styles.root}>
      {/* ─── Absolute Header ───────────────────────────────────────────────── */}
      <View style={[styles.absHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={20} color={FG} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.headerBtn} onPress={handleShare}>
          <Feather name="share" size={20} color={FG} />
        </TouchableOpacity>
      </View>

      {/* ─── Main ScrollView ───────────────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[tabBarIndex]}
      >
        {/* 0: Cover Area */}
        <LinearGradient
          colors={[profile.avatarColor, BG]}
          style={styles.cover}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
        />

        {/* 1: Profile Info */}
        <View style={styles.profileSection}>
          {/* Avatar + action buttons row */}
          <View style={styles.avatarActionRow}>
            {/* Avatar */}
            {profile.verified ? (
              <View style={styles.verifiedRing}>
                <View style={[styles.avatar, { backgroundColor: profile.avatarColor }]}>
                  <Text style={styles.avatarInitials}>{profile.initials}</Text>
                </View>
              </View>
            ) : (
              <View style={[styles.avatar, { backgroundColor: profile.avatarColor }]}>
                <Text style={styles.avatarInitials}>{profile.initials}</Text>
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
                  <LinearGradient
                    colors={[GREEN, '#00D4FF']}
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
                    style={[styles.followBtn, isFollowing && styles.followingBtn]}
                    onPress={handleFollow}
                  >
                    <Text style={[styles.followBtnText, isFollowing && styles.followingBtnText]}>
                      {isFollowing ? 'Following' : 'Follow'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.iconOutlineBtn}
                    onPress={handleMessageSeller}
                  >
                    <Feather name="mail" size={16} color={FG} />
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
              <Feather name="check-circle" size={14} color={GREEN} style={{ marginLeft: 6 }} />
            )}
          </View>

          {/* Username */}
          <Text style={styles.username}>@{profile.username}</Text>

          {/* Bio */}
          <Text style={styles.bio}>
            {truncatedBio}
            {profile.bio.length > 120 && !bioExpanded && (
              <Text onPress={() => setBioExpanded(true)} style={styles.bioMore}> more</Text>
            )}
          </Text>

          {/* Website */}
          {profile.website && (
            <View style={styles.metaRow}>
              <Feather name="link" size={12} color={GREEN} />
              <Text style={styles.websiteText}>{profile.website}</Text>
            </View>
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
            onPress={() => Alert.alert('Followers', 'Followers list coming soon')}
          >
            <Text style={styles.statNumber}>{formatCount(followers)}</Text>
            <Text style={styles.statLabel}>Followers</Text>
          </TouchableOpacity>
          <View style={styles.statDivider} />
          <TouchableOpacity
            style={styles.statItem}
            onPress={() => Alert.alert('Following', 'Following list coming soon')}
          >
            <Text style={styles.statNumber}>{formatCount(profile.following)}</Text>
            <Text style={styles.statLabel}>Following</Text>
          </TouchableOpacity>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{formatCount(profile.totalLikes)}</Text>
            <Text style={styles.statLabel}>Likes</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{formatCount(profile.productCount)}</Text>
            <Text style={styles.statLabel}>Products</Text>
          </View>
          {isOwner && (
            <>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statNumber}>{formatCount(profile.postCount)}</Text>
                <Text style={styles.statLabel}>Posts</Text>
              </View>
            </>
          )}
        </View>

        {/* 3 (buyer only): Shop Button */}
        {!isOwner && (
          <View style={styles.shopBtnWrapper}>
            <LinearGradient
              colors={[GREEN, '#00D4FF']}
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
            <View style={styles.productsGrid}>
              {productsLoading ? (
                <ActivityIndicator color={GREEN} style={{ marginTop: 40, alignSelf: 'center' }} />
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
              color={ERR}
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
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} activeOpacity={0.7}>
      <Feather name={icon} size={18} color={color} />
      <Text style={[styles.actionRowLabel, { color }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={MUTED} />
    </TouchableOpacity>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    flex: 1,
    backgroundColor: BG,
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
    height: 200,
  },

  // ── Profile Section ──
  profileSection: {
    paddingHorizontal: 20,
    marginTop: -30,
    paddingBottom: 16,
  },
  avatarActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  verifiedRing: {
    borderWidth: 1.5,
    borderColor: GREEN,
    borderRadius: 40,
    padding: 2,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: BG,
    fontSize: 22,
    fontWeight: '700',
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  outlineBtnText: {
    color: FG,
    fontSize: 13,
    fontWeight: '500',
  },
  gradientBtnWrap: {
    borderRadius: 20,
  },
  gradientBtnInner: {
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  gradientBtnText: {
    color: BG,
    fontSize: 13,
    fontWeight: '700',
  },
  followBtn: {
    borderWidth: 1,
    borderColor: GREEN,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 7,
  },
  followingBtn: {
    backgroundColor: GREEN,
  },
  followBtnText: {
    color: GREEN,
    fontSize: 13,
    fontWeight: '600',
  },
  followingBtnText: {
    color: BG,
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
    marginBottom: 2,
  },
  brandName: {
    color: FG,
    fontSize: 20,
    fontWeight: '700',
  },
  username: {
    color: MUTED,
    fontSize: 14,
    marginBottom: 8,
  },
  bio: {
    color: FG,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  bioMore: {
    color: MUTED,
    fontSize: 14,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 4,
  },
  websiteText: {
    color: GREEN,
    fontSize: 13,
  },
  locationText: {
    color: MUTED,
    fontSize: 13,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    backgroundColor: BORDER,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 8,
  },
  categoryBadgeText: {
    color: FG,
    fontSize: 12,
  },

  // ── Stats Row ──
  statsRow: {
    flexDirection: 'row',
    backgroundColor: CARD,
    marginHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
    paddingVertical: 14,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    color: FG,
    fontSize: 16,
    fontWeight: '700',
  },
  statLabel: {
    color: MUTED,
    fontSize: 11,
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
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tabBarContent: {
    paddingHorizontal: 20,
  },
  tabItem: {
    paddingVertical: 12,
    marginRight: 24,
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
    backgroundColor: GREEN,
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
    padding: 12,
    gap: 12,
  },
  productCard: {
    width: (SCREEN_WIDTH - 36) / 2,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    overflow: 'hidden',
  },
  productImageContainer: {
    position: 'relative',
    height: 80,
    width: '100%',
  },
  productImagePlaceholder: {
    height: 80,
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
    padding: 10,
  },
  productName: {
    color: FG,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  productPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  productPrice: {
    color: GREEN,
    fontSize: 14,
    fontWeight: '700',
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
    fontSize: 12,
    marginTop: 2,
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
