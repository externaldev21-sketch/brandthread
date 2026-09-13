import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TouchableWithoutFeedback,
  Dimensions, Animated, Alert, Share, TextInput, Modal,
  Platform, ScrollView, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  createThreadFeedCursor,
  getSellerFollowState,
  getThreadPostsPage,
  setSellerFollowing,
  subscribeSocial,
} from '@/services/socialService';
import type { SellerThreadPost } from '@/services/socialService';
import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { ViewToken } from 'react-native';
import { useApi } from '@/lib/api';
import {
  BG, SCREEN_BG, SURFACE, CARD, OVERLAY,
  BORDER, BORDER_SUBTLE,
  FG, MUTED, SUBTLE, ON_DARK,
  SUCCESS, RED,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FeedSkeleton } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { formatCents } from '@/lib/money';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const THREAD_PAGE_SIZE = 30;

// ─── Feed item display type ───────────────────────────────────────────────────

interface SpotlightItem {
  id: string;
  creator: string;
  handle: string;
  avatarColor: string;
  initials: string;
  verified: boolean;
  mediaUris: string[];
  contentType: 'photo' | 'slideshow' | 'video';
  caption: string;
  sound: string;
  productName: string;
  productPrice: string;
  productOriginalPrice: string | null;
  accentColor: string;
  likes: number;
  comments: { id: string; user: string; text: string }[];
  reposts: number;
  shares: number;
  saves: number;
  location?: string;
  // Optional fields present on real seller posts
  productId?: string;
  sellerId?: string;
  productTags?: { productId: string; productName: string; priceCents: number }[];
}
type SpotlightProductTag = NonNullable<SpotlightItem['productTags']>[number];

// ─── Live Stream feed item ────────────────────────────────────────────────────
interface LiveStreamFeedItem {
  _isLive: true;
  id: string;
  streamId: string;
  sellerName: string;
  brandName: string | null;
  thumbnailUrl: string | null;
  title: string;
  viewerCount: number;
  productTags: { productName: string; priceCents: number }[];
}

function LiveStreamPage({ stream, onJoin }: { stream: LiveStreamFeedItem; onJoin: () => void }) {
  const { theme } = useAppTheme();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <View style={{ width: SCREEN_W, height: SCREEN_H, backgroundColor: '#0a0209' }}>
      {/* Gradient background */}
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,80,100,0.18)' }} />
      {/* Centre glow */}
      <View style={{ position: 'absolute', top: SCREEN_H * 0.25, alignSelf: 'center', width: 280, height: 280, borderRadius: 140, backgroundColor: theme.accentDim }} />

      {/* Top bar */}
      <View style={{ position: 'absolute', top: 52, left: 16, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FF3B30', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff', opacity: pulseAnim }} />
          <Text style={{ color: '#fff', fontFamily: FONT.bold, fontSize: 11, letterSpacing: 1.4 }}>LIVE</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 }}>
          <Feather name="eye" size={12} color="#fff" />
          <Text style={{ color: '#fff', fontFamily: FONT.semibold, fontSize: 12 }}>
            {stream.viewerCount > 0 ? stream.viewerCount.toLocaleString() : 'Live now'}
          </Text>
        </View>
      </View>

      {/* Centre content */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        {/* Avatar circle */}
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 20, borderWidth: 3, borderColor: '#fff' }}>
          <Text style={{ color: '#fff', fontFamily: FONT.bold, fontSize: 32 }}>
            {(stream.brandName ?? stream.sellerName).slice(0, 1).toUpperCase()}
          </Text>
        </View>
        <Text style={{ color: '#fff', fontFamily: FONT.bold, fontSize: FS.xl, textAlign: 'center', marginBottom: 8 }}>
          {stream.brandName ?? stream.sellerName}
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 20, marginBottom: 32 }}>
          {stream.title}
        </Text>

        {/* Product tags preview */}
        {stream.productTags.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 28 }}>
            {stream.productTags.slice(0, 3).map((tag, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Feather name="shopping-bag" size={11} color="#FF3B30" />
                <Text style={{ color: '#fff', fontFamily: FONT.semibold, fontSize: 12 }} numberOfLines={1}>{tag.productName}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Join button */}
        <TouchableOpacity
          onPress={onJoin}
          activeOpacity={0.85}
          style={{ backgroundColor: '#FF3B30', borderRadius: 28, paddingHorizontal: 40, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <Feather name="video" size={18} color="#fff" />
          <Text style={{ color: '#fff', fontFamily: FONT.bold, fontSize: FS.base }}>Join live stream</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom label */}
      <View style={{ position: 'absolute', bottom: 90, left: 16, right: 16 }}>
        <Text style={{ color: 'rgba(255,255,255,0.45)', fontFamily: FONT.regular, fontSize: FS.xs, textAlign: 'center' }}>
          Tap to join — live shopping is on
        </Text>
      </View>
    </View>
  );
}
type EngagementState = {
  liked: boolean; likes: number;
  saved: boolean; saves: number;
  reposted: boolean; reposts: number;
  following: boolean;
  comments: { id: string; user: string; text: string }[];
};

function initialEngagement(item: SpotlightItem): EngagementState {
  return {
    liked: false, likes: item.likes,
    saved: false, saves: item.saves,
    reposted: false, reposts: item.reposts,
    following: false,
    comments: item.comments,
  };
}

const DEFAULT_ENGAGEMENT: EngagementState = {
  liked: false, likes: 0, saved: false, saves: 0, reposted: false, reposts: 0, following: false, comments: [],
};

function formatCount(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}K`;
  return String(n);
}

// ─── Full-screen media page ───────────────────────────────────────────────────

function VideoVisual({ uri, isActive, paused }: { uri: string; isActive: boolean; paused: boolean }) {
  const player = useVideoPlayer(uri, p => { p.loop = true; p.muted = false; });
  React.useEffect(() => {
    if (isActive && !paused) player.play();
    else player.pause();
  }, [isActive, paused, player]);
  return (
    <>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      {paused && (
        <View style={styles.pauseOverlay}>
          <Feather name="play" size={56} color="#FFFFFFCC" />
        </View>
      )}
    </>
  );
}

function PhotoVisual({ uris }: { uris: string[] }) {
  const pages = uris.length > 0 ? uris : [''];
  return (
    <FlatList
      data={pages}
      style={StyleSheet.absoluteFill}
      keyExtractor={(uri, index) => `${uri}-${index}`}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      directionalLockEnabled
      nestedScrollEnabled
      renderItem={({ item: uri }) => (
        <View style={{ width: SCREEN_W, height: SCREEN_H }}>
          {uri ? <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : (
            <View style={[StyleSheet.absoluteFill, styles.mediaPlaceholder]}>
              <Feather name="image" size={42} color="#FFFFFF99" />
            </View>
          )}
        </View>
      )}
      getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
    />
  );
}

function SpotlightPage({
  item, isActive, engagement, onLike, onDoubleTapLike, onSave, onRepost, onFollow, onOpenComments, onShop, onShopTag,
}: {
  item: SpotlightItem;
  isActive: boolean;
  engagement: EngagementState | undefined;
  onLike: (id: string) => void;
  onDoubleTapLike: (id: string) => void;
  onSave: (id: string) => void;
  onRepost: (id: string) => void;
  onFollow: (id: string) => void;
  onOpenComments: (id: string) => void;
  onShop: (item: SpotlightItem) => void;
  onShopTag: (item: SpotlightItem, tag: { productId: string; productName: string; priceCents: number }) => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { push } = useThreadPull();
  // Clear the floating pill tab bar (see (tabs)/_layout.tsx: bottomOffset + height 72 + margin).
  const tabBarClearance = Math.max(insets.bottom, 8) + 12 + 72 + 14;
  const [paused, setPaused] = useState(false);
  const heartBurst = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  const lastTap = useRef(0);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => { if (pauseTimer.current) clearTimeout(pauseTimer.current); }, []);

  function burstHeart() {
    heartBurst.setValue(1);
    Animated.timing(heartBurst, { toValue: 0, duration: 700, delay: 250, useNativeDriver: true }).start();
  }

  function bumpHeart() {
    Animated.sequence([
      Animated.spring(heartScale, { toValue: 1.35, useNativeDriver: true, speed: 40 }),
      Animated.spring(heartScale, { toValue: 1, useNativeDriver: true, speed: 40 }),
    ]).start();
  }

  function handlePress() {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      if (pauseTimer.current) { clearTimeout(pauseTimer.current); pauseTimer.current = null; }
      onDoubleTapLike(item.id);
      bumpHeart();
      burstHeart();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      lastTap.current = now;
      pauseTimer.current = setTimeout(() => {
        pauseTimer.current = null;
        setPaused(p => !p);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }, 290);
    }
  }

  return (
    <View style={{ width: SCREEN_W, height: SCREEN_H, backgroundColor: '#000' }}>
      <TouchableWithoutFeedback onPress={handlePress}>
        <View style={StyleSheet.absoluteFill}>
          {item.contentType === 'video'
            ? <VideoVisual uri={item.mediaUris[0]} isActive={isActive} paused={paused} />
            : <PhotoVisual uris={item.mediaUris} />}
          {item.contentType !== 'video' && item.mediaUris.length > 1 && (
            <View style={styles.mediaDots} pointerEvents="none">
              {item.mediaUris.slice(0, 5).map((_, index) => <View key={index} style={[styles.mediaDot, index === 0 && styles.mediaDotActive]} />)}
            </View>
          )}
          <Animated.View
            pointerEvents="none"
            style={[styles.heartBurst, {
              opacity: heartBurst,
              transform: [{ scale: heartBurst.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.5] }) }],
            }]}
          >
            <Feather name="heart" size={110} color="#FFFFFF" />
          </Animated.View>
        </View>
      </TouchableWithoutFeedback>

      {/* ─ Product tags live on the media surface ─ */}
      {!!item.productTags?.length && (
        <View style={[styles.mediaTags, { top: insets.top + 84 }]} pointerEvents="box-none">
          {item.productTags.slice(0, 3).map(tag => (
            <TouchableOpacity
              key={tag.productId}
              style={[styles.mediaTag, { borderColor: `${item.accentColor}99` }]}
              activeOpacity={0.82}
              onPress={() => onShopTag(item, tag)}
            >
              <Feather name="shopping-bag" size={13} color="#FFFFFF" />
              <View style={styles.mediaTagCopy}>
                <Text style={styles.mediaTagName} numberOfLines={1}>{tag.productName}</Text>
                <Text style={styles.mediaTagPrice}>{formatCents(tag.priceCents)}</Text>
              </View>
              <Feather name="chevron-right" size={14} color="#FFFFFFBB" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ─ Right action rail ─ */}
      <View style={[styles.rail, { bottom: tabBarClearance }]}>
        <View style={styles.railAvatarWrap}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(('/seller-profile?id=' + encodeURIComponent(item.sellerId ?? item.id)) as never);
            }}
          >
            <View style={[styles.railAvatar, { backgroundColor: item.avatarColor }]}>
              <Text style={styles.railAvatarText}>{item.initials}</Text>
            </View>
          </TouchableOpacity>
          {!(engagement?.following) && (
            <TouchableOpacity
              onPress={() => onFollow(item.id)}
              activeOpacity={0.8}
              style={[styles.railFollowBadge, { backgroundColor: item.accentColor }]}
            >
              <Feather name="plus" size={11} color={ON_DARK} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => { onLike(item.id); bumpHeart(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Animated.View style={{ transform: [{ scale: heartScale }] }}>
            <Feather name="heart" size={30} color={engagement?.liked ? '#EF4444' : '#FFFFFF'} />
          </Animated.View>
          <Text style={styles.railCount}>{formatCount(engagement?.likes ?? 0)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => onOpenComments(item.id)}
        >
          <Feather name="message-circle" size={26} color="#FFFFFF" />
          <Text style={styles.railCount}>{formatCount((engagement?.comments ?? []).length)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => {
            onRepost(item.id);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
        >
          <Feather name="repeat" size={28} color={engagement?.reposted ? theme.accent : '#FFFFFF'} />
          <Text style={styles.railCount}>{formatCount(engagement?.reposts ?? 0)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => { onSave(item.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Feather name="bookmark" size={27} color={engagement?.saved ? theme.accent : '#FFFFFF'} />
          <Text style={styles.railCount}>{formatCount(engagement?.saves ?? item.saves)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 10, left: 10, right: 10 }}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Share.share({ message: `Check out ${item.productName} by ${item.creator} — ${item.productPrice} 🔥 on Brandthread` });
          }}
        >
          <Feather name="share-2" size={27} color="#FFFFFF" />
          <Text style={styles.railCount}>{formatCount(item.shares)}</Text>
        </TouchableOpacity>

        {(item as any).productTags && (item as any).productTags.length > 0 && (
          <TouchableOpacity
            style={styles.railBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
               const tags = (item as any).productTags as Array<{ productId: string; productName: string; priceCents: number }>;
              if (tags.length === 1) {
                push(('/thread-product-detail?productId=' + tags[0].productId) as never);
              } else {
                Alert.alert('Shop this post', tags.map(t => t.productName).join('\n'));
              }
            }}
          >
            <Feather name="shopping-bag" size={27} color="#FFFFFF" />
            <Text style={styles.railCount}>Shop</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ─ Bottom-left overlay: shop CTA, creator, caption, sound ─ */}
      <View style={[styles.bottomInfo, { bottom: tabBarClearance }]} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.shopBtn, { backgroundColor: theme.accent }]}
          activeOpacity={0.85}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => onShop(item)}
        >
          <Feather name="shopping-bag" size={18} color="#FFFFFF" />
          <Text style={styles.shopBtnText}>SHOP</Text>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(('/seller-profile?id=' + encodeURIComponent(item.sellerId ?? item.id)) as never);
          }}
        >
          <View style={styles.creatorRow}>
            <View style={[styles.creatorAvatar, { backgroundColor: item.avatarColor }]}>
              <Text style={styles.creatorAvatarText}>{item.initials}</Text>
            </View>
            <Text style={styles.creatorName}>{item.creator}</Text>
            {item.verified && <Feather name="check-circle" size={13} color="#4FA8FF" style={{ marginLeft: 4 }} />}
          </View>
        </TouchableOpacity>

         {!!item.location && (
           <View style={styles.locationRow}>
              <Feather name="map-pin" size={12} color={`${theme.onAccent}CC`} />
              <Text style={[styles.locationText, { color: `${theme.onAccent}CC` }]} numberOfLines={1}>{item.location}</Text>
           </View>
         )}
         <Text style={styles.caption} numberOfLines={2}>
           {item.caption}
            {item.caption.length > 86 && <Text style={[styles.moreText, { color: theme.onAccent }]}> …more</Text>}
         </Text>

        <View style={styles.soundRow}>
           <Feather name="music" size={12} color={theme.onAccent} />
          <Text style={styles.soundText} numberOfLines={1}>{item.sound}</Text>
        </View>
      </View>
    </View>
  );
}

// CommentsModal replaced by navigation to /buyer-post-comments (see handleOpenComments).

// ─── Type guard for the feed union ───────────────────────────────────────────

function isLiveStreamItem(item: SpotlightItem | LiveStreamFeedItem): item is LiveStreamFeedItem {
  return (item as LiveStreamFeedItem)._isLive === true;
}

// ─── Map a service SellerThreadPost to the feed display format ────────────────
// Returns null only when a post has no displayable media. Photo, slideshow, and
// video posts all share the same full-screen Thread surface.

function mapSellerPost(post: SellerThreadPost): SpotlightItem | null {
  if (!post.mediaUris?.length) return null;
  const tag = post.productTags?.[0];
  return {
    id: post.id,
    creator: post.authorName,
    handle: post.authorHandle,
    avatarColor: post.authorColor,
    initials: post.authorInitials,
    verified: false,
    mediaUris: post.mediaUris,
    contentType: post.contentType === 'video' || post.contentType === 'slideshow' ? post.contentType : 'photo',
    caption: post.caption,
    sound: post.sound
      ? `${post.sound.soundTitle} · ${post.sound.artist}`
      : `Original Sound · ${post.authorHandle.slice(1)}`,
    productName: tag?.productName ?? 'Shop Now',
    productPrice: tag ? formatCents(tag.priceCents) : '',
    productOriginalPrice: null,
    accentColor: post.authorColor,
    likes: post.likesCount,
    comments: [],
    reposts: post.repostsCount,
    shares: 0,
    saves: Number((post as any).savedCount ?? (post as any).savesCount ?? 0),
    location: (post as any).location ?? (post as any).locationName ?? undefined,
    productId: tag?.productId,
    sellerId: post.authorId,
    productTags: post.productTags ?? [],
  };
}

function ShopProductSheet({
  selection,
  onClose,
  onBuy,
}: {
  selection: { item: SpotlightItem; tag?: SpotlightProductTag };
  onClose: () => void;
  onBuy: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState('M');
  const [color, setColor] = useState(0);
  const product = selection.tag;
  const name = product?.productName ?? selection.item.productName;
  const price = product ? formatCents(product.priceCents) : selection.item.productPrice;
  const swatches = [FG, SURFACE, MUTED, SUBTLE];

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.shopSheetBackdrop}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>
        <View style={[styles.shopSheet, { paddingBottom: insets.bottom + SP.sm }]}>
          <View style={styles.commentsHandle} />
          <View style={styles.shopSheetHeader}>
            <Text style={styles.shopSheetEyebrow}>SHOP THE POST</Text>
            <TouchableOpacity style={styles.shopSheetClose} onPress={onClose} accessibilityLabel="Close shop preview">
              <Feather name="x" size={18} color={FG} />
            </TouchableOpacity>
          </View>
          <View style={styles.shopProductRow}>
            <CachedImage
              source={{ uri: selection.item.mediaUris[0] }}
              style={styles.shopProductImage}
              contentFit="cover"
            />
            <View style={styles.shopProductCopy}>
              <Text style={styles.shopProductName} numberOfLines={2}>{name}</Text>
              <Text style={[styles.shopProductPrice, { color: theme.accent }]}>{price}</Text>
              <Text style={styles.shopProductSeller}>From @{selection.item.handle.replace(/^@/, '')}</Text>
            </View>
          </View>
          <Text style={styles.shopOptionLabel}>Color</Text>
          <View style={styles.shopSwatches}>
            {swatches.map((swatch, index) => (
              <TouchableOpacity
                key={swatch}
                onPress={() => setColor(index)}
                style={[styles.shopSwatch, color === index && { borderColor: theme.accent }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: color === index }}
              >
                <View style={[styles.shopSwatchDot, { backgroundColor: swatch }]} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.shopOptionHeader}>
            <Text style={styles.shopOptionLabel}>Size</Text>
            <Text style={styles.shopSizeGuide}>Size guide</Text>
          </View>
          <View style={styles.shopSizes}>
            {['XS', 'S', 'M', 'L', 'XL'].map(option => (
              <TouchableOpacity
                key={option}
                onPress={() => setSize(option)}
                style={[styles.shopSize, size === option && { borderColor: theme.accent, backgroundColor: theme.accentDim }]}
              >
                <Text style={[styles.shopSizeText, size === option && { color: theme.accent }]}>{option}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.shopBuyButton, { backgroundColor: theme.accent }]}
            onPress={onBuy}
            activeOpacity={0.85}
          >
            <Text style={[styles.shopBuyText, { color: theme.onAccent }]}>Buy now</Text>
            <Feather name="arrow-right" size={17} color={theme.onAccent} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { push } = useThreadPull();

  const [engagements, setEngagements] = useState<Record<string, EngagementState>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifs, setShowNotifs] = useState(false);
  const [feedTab, setFeedTab] = useState<'following' | 'for-you'>('for-you');
  const [shopSelection, setShopSelection] = useState<{ item: SpotlightItem; tag?: SpotlightProductTag } | null>(null);
  const [hasUnread, setHasUnread] = useState(true);
  const [sellerFeedPosts, setSellerFeedPosts] = useState<SpotlightItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [activeLiveStreams, setActiveLiveStreams] = useState<LiveStreamFeedItem[]>([]);
  const api = useApi();
  const feedCursorRef = useRef(createThreadFeedCursor());
  const feedGenerationRef = useRef(0);
  const feedLoadingMoreRef = useRef(false);
  const feedHasMoreRef = useRef(true);

  // Load published seller posts and subscribe to real-time changes
  const loadFeed = useCallback(async (initial = false) => {
    const generation = feedGenerationRef.current + 1;
    feedGenerationRef.current = generation;
    const initialCursor = createThreadFeedCursor();
    feedCursorRef.current = initialCursor;
    feedHasMoreRef.current = true;
    setFeedHasMore(true);
    setFeedLoadingMore(false);
    if (initial) setFeedLoading(true);
    else setFeedRefreshing(true);
    setFeedError(null);
    try {
      const page = await getThreadPostsPage(initialCursor, THREAD_PAGE_SIZE, feedTab);
      if (feedGenerationRef.current !== generation) return;
      const rows = page.posts;
      const mapped = (Array.isArray(rows) ? rows : [])
        .map(mapSellerPost)
        .filter((p): p is SpotlightItem => p !== null);
      setSellerFeedPosts(mapped);
      feedCursorRef.current = page.cursor;
      feedHasMoreRef.current = page.hasMore;
      setFeedHasMore(page.hasMore);
    } catch {
      if (feedGenerationRef.current !== generation) return;
      // Keep the current feed visible when a pull-to-refresh or social
      // notification fails; only the first load needs an empty state.
      if (initial) setSellerFeedPosts([]);
      setFeedError('We couldn’t load Thread. Check your connection and try again.');
    } finally {
      if (feedGenerationRef.current !== generation) return;
      if (initial) setFeedLoading(false);
      else setFeedRefreshing(false);
    }
  }, [feedTab]);

  const loadMoreFeed = useCallback(async () => {
    if (feedLoadingMoreRef.current || !feedHasMoreRef.current || feedLoading || feedRefreshing) return;
    feedLoadingMoreRef.current = true;
    setFeedLoadingMore(true);
    const generation = feedGenerationRef.current;
    const cursor = feedCursorRef.current;
    try {
      const page = await getThreadPostsPage(cursor, THREAD_PAGE_SIZE, feedTab);
      if (feedGenerationRef.current !== generation) return;
      const rows = page.posts;
      const mapped = (Array.isArray(rows) ? rows : [])
        .map(mapSellerPost)
        .filter((p): p is SpotlightItem => p !== null);

      setSellerFeedPosts(prev => {
        const existingIds = new Set(prev.map(item => item.id));
        const additions = mapped.filter(item => {
          if (existingIds.has(item.id)) return false;
          existingIds.add(item.id);
          return true;
        });
        return [...prev, ...additions];
      });
      feedCursorRef.current = page.cursor;
      feedHasMoreRef.current = page.hasMore;
      setFeedHasMore(page.hasMore);
    } catch {
      // Keep the current feed and cursor so a later scroll can retry the page.
    } finally {
      feedLoadingMoreRef.current = false;
      if (feedGenerationRef.current === generation) setFeedLoadingMore(false);
    }
  }, [feedLoading, feedRefreshing, feedTab]);

  useEffect(() => {
    void loadFeed(true);
    const unsub = subscribeSocial(() => { void loadFeed(); });
    return unsub;
  }, [loadFeed]);

  const handleRefresh = useCallback(() => {
    if (feedRefreshing) return;
    void loadFeed();
  }, [feedRefreshing, loadFeed]);

  // Poll active live streams every 30 seconds
  useEffect(() => {
    async function fetchLive() {
      try {
        const data = await (api as any).live.active() as { streams: any[] };
        const rows = Array.isArray(data?.streams) ? data.streams : [];
        setActiveLiveStreams(rows.map((s: any) => ({
          _isLive: true as const,
          id:          `live_${s.id}`,
          streamId:    s.id,
          sellerName:  s.seller_name ?? 'Seller',
          brandName:   s.brand_name ?? null,
          thumbnailUrl: s.thumbnail_url ?? null,
          title:       s.title,
          viewerCount: s.viewer_count ?? 0,
          productTags: Array.isArray(s.product_tags) ? s.product_tags : [],
        })));
      } catch {
        setActiveLiveStreams([]);
      }
    }
    fetchLive();
    const id = setInterval(fetchLive, 30_000);
    return () => clearInterval(id);
  }, []);

  // Add engagement entries for newly loaded seller posts
  useEffect(() => {
    if (sellerFeedPosts.length === 0) return;
    setEngagements(prev => {
      const next = { ...prev };
      sellerFeedPosts.forEach(item => { if (!next[item.id]) next[item.id] = initialEngagement(item); });
      return next;
    });
  }, [sellerFeedPosts]);

  // Real published seller posts only — no demo fallback.
  // Live streams are woven in at roughly 1 per 10 regular posts (occasional, not dominant).
  const allItems = useMemo(() => {
    const regular: (SpotlightItem | LiveStreamFeedItem)[] = [...sellerFeedPosts];
    if (feedTab === 'following') return regular;
    if (!activeLiveStreams.length) return regular;
    // Weave live streams in: first at index 4, then every 10 after
    const result: (SpotlightItem | LiveStreamFeedItem)[] = [...regular];
    activeLiveStreams.slice(0, 3).forEach((liveItem, i) => {
      const insertAt = Math.min(4 + i * 10, result.length);
      result.splice(insertAt, 0, liveItem);
    });
    return result;
  }, [sellerFeedPosts, activeLiveStreams, feedTab]);

  const displayItems = searchQuery.trim()
    ? allItems.filter(item => {
        const q = searchQuery.toLowerCase();
        if (isLiveStreamItem(item)) {
          return (item.brandName ?? item.sellerName).toLowerCase().includes(q) ||
            item.title.toLowerCase().includes(q);
        }
        return item.creator.toLowerCase().includes(q) ||
          item.handle.toLowerCase().includes(q) ||
          item.productName.toLowerCase().includes(q);
      })
    : allItems;

  function update(id: string, patch: Partial<EngagementState> | ((e: EngagementState) => Partial<EngagementState>)) {
    setEngagements(prev => {
      const cur = prev[id] ?? DEFAULT_ENGAGEMENT;
      const delta = typeof patch === 'function' ? patch(cur) : patch;
      return { ...prev, [id]: { ...cur, ...delta } };
    });
  }

  const handleLike = useCallback((id: string) => {
    const currentlyLiked = engagements[id]?.liked ?? false;
    update(id, e => ({ liked: !e.liked, likes: e.liked ? e.likes - 1 : e.likes + 1 }));
    // Fire-and-forget — real posts get persisted; demo IDs are silently ignored server-side
    try {
      const { api } = require('@/lib/api');
      api.posts.interact(id, { type: 'like', value: currentlyLiked ? 'remove' : 'add' }).catch(() => {});
    } catch {}
  }, [engagements]);

  const handleDoubleTapLike = useCallback((id: string) => {
    setEngagements(prev => {
      const e = prev[id] ?? DEFAULT_ENGAGEMENT;
      if (e.liked) return prev;
      try { const { api } = require('@/lib/api'); api.posts.interact(id, { type: 'like' }).catch(() => {}); } catch {}
      return { ...prev, [id]: { ...e, liked: true, likes: e.likes + 1 } };
    });
  }, []);

  const handleSave = useCallback((id: string) => {
    // Read current saved state before toggling so we know which API to call
    setEngagements(prev => {
      const cur = prev[id] ?? DEFAULT_ENGAGEMENT;
      try {
        const { api } = require('@/lib/api');
        if (cur.saved) {
          api.saved.remove(id).catch(() => {});
        } else {
          api.saved.add({ targetId: id, targetType: 'post' }).catch(() => {});
        }
      } catch {}
      return { ...prev, [id]: { ...cur, saved: !cur.saved, saves: cur.saved ? Math.max(0, cur.saves - 1) : cur.saves + 1 } };
    });
  }, []);

  const handleRepost = useCallback((id: string) => {
    update(id, e => ({ reposted: !e.reposted, reposts: e.reposted ? e.reposts - 1 : e.reposts + 1 }));
    try { const { api } = require('@/lib/api'); api.posts.interact(id, { type: 'repost' }).catch(() => {}); } catch {}
  }, []);

  const handleFollow = useCallback((id: string) => {
    const item = sellerFeedPosts.find(post => post.id === id);
    if (!item?.sellerId) return;
    const sellerId = item.sellerId;
    const wasFollowing = engagements[id]?.following ?? false;
    setEngagements(prev => Object.fromEntries(Object.entries(prev).map(([postId, state]) => [
      postId,
      sellerFeedPosts.find(post => post.id === postId)?.sellerId === sellerId
        ? { ...state, following: !wasFollowing }
        : state,
    ])));
    void setSellerFollowing(sellerId, !wasFollowing).then((state) => {
      setEngagements(prev => Object.fromEntries(Object.entries(prev).map(([postId, engagement]) => [
        postId,
        sellerFeedPosts.find(post => post.id === postId)?.sellerId === sellerId
          ? { ...engagement, following: state.isFollowing }
          : engagement,
      ])));
      if (feedTab === 'following' && !state.isFollowing) void loadFeed();
    }).catch(() => {
      setEngagements(prev => Object.fromEntries(Object.entries(prev).map(([postId, engagement]) => [
        postId,
        sellerFeedPosts.find(post => post.id === postId)?.sellerId === sellerId
          ? { ...engagement, following: wasFollowing }
          : engagement,
      ])));
      Alert.alert('Couldn’t update follow', 'Check your connection and try again.');
    });
  }, [engagements, feedTab, loadFeed, sellerFeedPosts]);

  useEffect(() => {
    const sellerIds = [...new Set(sellerFeedPosts.map(post => post.sellerId).filter((id): id is string => !!id))];
    if (sellerIds.length === 0) return;
    let cancelled = false;
    void Promise.all(sellerIds.map(async sellerId => [sellerId, await getSellerFollowState(sellerId)] as const))
      .then(states => {
        if (cancelled) return;
        const bySeller = new Map(states);
        setEngagements(prev => Object.fromEntries(Object.entries(prev).map(([postId, engagement]) => {
          const sellerId = sellerFeedPosts.find(post => post.id === postId)?.sellerId;
          return [postId, sellerId && bySeller.has(sellerId)
            ? { ...engagement, following: bySeller.get(sellerId)!.isFollowing }
            : engagement];
        })));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sellerFeedPosts]);

  function handleOpenComments(id: string) {
    const item = allItems.find(i => i.id === id);
    if (!item || isLiveStreamItem(item)) return;
    const qs = [
      'postId=' + encodeURIComponent(item.id),
      'postAuthorName=' + encodeURIComponent(item.creator),
      'postAuthorInitials=' + encodeURIComponent(item.initials),
      'postAuthorColor=' + encodeURIComponent(item.avatarColor),
      'postCaption=' + encodeURIComponent(item.caption),
      'postMediaColor1=' + encodeURIComponent('#0a0a0a'),
      'postMediaColor2=' + encodeURIComponent('#1a1a1a'),
      'postType=video',
    ].join('&');
    router.push(('/buyer-post-comments?' + qs) as never);
  }

  function handleShop(item: SpotlightItem) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShopSelection({ item });
  }

  function handleShopTag(item: SpotlightItem, tag: { productId: string; productName: string; priceCents: number }) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShopSelection({ item, tag });
  }

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setActiveIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  return (
    <View style={styles.container}>
      {feedLoading && (
        <FeedSkeleton
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }}
        />
      )}
      <FlatList
        data={displayItems}
        keyExtractor={item => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={SCREEN_H}
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={loadMoreFeed}
        onEndReachedThreshold={0.5}
        getItemLayout={(_, index) => ({ length: SCREEN_H, offset: SCREEN_H * index, index })}
        refreshControl={
          <RefreshControl
            refreshing={feedRefreshing}
            onRefresh={handleRefresh}
            tintColor={PURPLE}
            colors={[PURPLE]}
          />
        }
        ListEmptyComponent={
          searchQuery.trim() ? (
            <View style={{ width: SCREEN_W, height: SCREEN_H, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Feather name="search" size={32} color="#8C8577" />
              <Text style={{ fontSize: FS.base, fontFamily: FONT.medium, color: '#8C8577' }}>
                No results for "{searchQuery}"
              </Text>
            </View>
          ) : feedError && displayItems.length === 0 ? (
            <View style={{ width: SCREEN_W, height: SCREEN_H, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 40 }}>
              <Feather name="alert-circle" size={40} color={MUTED} />
              <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: FG, textAlign: 'center' }}>Couldn’t load Thread</Text>
              <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center' }}>{feedError}</Text>
              <TouchableOpacity onPress={() => void loadFeed(true)}>
                <Text style={{ color: PURPLE, fontFamily: FONT.semibold }}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : !feedLoading ? (
            <View style={{ width: SCREEN_W, height: SCREEN_H, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 40 }}>
              <Feather name="film" size={40} color={MUTED} />
              <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: FG, textAlign: 'center' }}>
                {feedTab === 'following' ? 'No posts from followed sellers yet' : 'No posts yet'}
              </Text>
              <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, textAlign: 'center', lineHeight: 20 }}>
                {feedTab === 'following' ? 'Follow sellers to build your Following feed' : 'Check back soon for new drops'}
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          feedLoadingMore ? (
            <View style={styles.feedFooter}>
              <ActivityIndicator size="small" color={MUTED} />
            </View>
          ) : !feedHasMore && sellerFeedPosts.length > 0 ? (
            <View style={styles.feedFooter}>
              <Text style={styles.feedFooterText}>You’re all caught up</Text>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          if ((item as any)._isLive) {
            const live = item as unknown as LiveStreamFeedItem;
            return (
              <LiveStreamPage
                stream={live}
                onJoin={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push(`/buyer-live?streamId=${encodeURIComponent(live.streamId)}` as never);
                }}
              />
            );
          }
          const spotlight = item as SpotlightItem;
          return (
            <SpotlightPage
              item={spotlight}
              isActive={index === activeIndex && !showNotifs}
              engagement={engagements[spotlight.id] ?? initialEngagement(spotlight)}
              onLike={handleLike}
              onDoubleTapLike={handleDoubleTapLike}
              onSave={handleSave}
              onRepost={handleRepost}
              onFollow={handleFollow}
              onOpenComments={handleOpenComments}
              onShop={handleShop}
              onShopTag={handleShopTag}
            />
          );
        }}
      />

      {/* ─ Top bar overlay ─ */}
      <View style={[styles.topBar, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        {showSearch ? (
          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search creators, products…"
              placeholderTextColor={SUBTLE}
              autoFocus
              returnKeyType="search"
              onSubmitEditing={() => setShowSearch(false)}
            />
            <TouchableOpacity
              style={styles.topIconBtn}
              activeOpacity={0.7}
              onPress={() => { setShowSearch(false); setSearchQuery(''); }}
            >
              <Feather name="x" size={20} color={ON_DARK} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.topRow}>
            <TouchableOpacity
              style={styles.topAvatarBtn}
              activeOpacity={0.75}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              onPress={() => { setShowNotifs(true); setHasUnread(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
            >
              <View style={[styles.topAvatar, { backgroundColor: SURFACE }]}>
                <Feather name="user" size={16} color={ON_DARK} />
              </View>
              {hasUnread && <View style={styles.unreadDot} />}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.topIconBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowSearch(true); }}
            >
              <Feather name="search" size={21} color={ON_DARK} />
            </TouchableOpacity>

            <Text style={styles.topTitle}>Thread</Text>

            <TouchableOpacity
              style={styles.topIconBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                (async () => { const { Share } = await import('react-native'); Share.share({ message: 'Join me on Brandthread! https://brandthread.app' }); })();
              }}
            >
              <Feather name="user-plus" size={20} color={ON_DARK} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.topIconBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/create-post' as never); }}
            >
              <Feather name="plus-square" size={21} color={ON_DARK} />
            </TouchableOpacity>
          </View>
        )}
        {!showSearch && (
          <View style={styles.feedTabs}>
            {([
              ['following', 'Following'],
              ['for-you', 'For You'],
            ] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={styles.feedTab}
                onPress={() => {
                  setActiveIndex(0);
                  setFeedTab(key);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: feedTab === key }}
              >
                <Text style={[styles.feedTabText, feedTab === key && styles.feedTabTextActive]}>{label}</Text>
                {feedTab === key && <View style={[styles.feedTabUnderline, { backgroundColor: theme.accent }]} />}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* ─ Notifications sheet ─ */}
      <Modal visible={showNotifs} animationType="slide" transparent onRequestClose={() => setShowNotifs(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableWithoutFeedback onPress={() => setShowNotifs(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.commentsSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <View style={styles.commentsHandle} />
            <Text style={styles.commentsTitle}>Notifications</Text>
            <View style={{ gap: 14, paddingTop: 4 }}>
              <Text style={styles.notifRow}>❤️ NXGEN liked your comment on Ripstop Cargo Trousers</Text>
              <Text style={styles.notifRow}>👤 Meridian Co. started following you</Text>
              <Text style={styles.notifRow}>💬 @street.era replied to your comment</Text>
            </View>
          </View>
        </View>
      </Modal>
      {shopSelection && (
        <ShopProductSheet
          selection={shopSelection}
          onClose={() => setShopSelection(null)}
          onBuy={() => {
            const productId = shopSelection.tag?.productId ?? shopSelection.item.productId ?? shopSelection.item.id;
            const productName = shopSelection.tag?.productName ?? shopSelection.item.productName;
            const sourcePostId = shopSelection.item.id;
            setShopSelection(null);
            push(('/thread-product-detail?productId=' + encodeURIComponent(productId) +
              '&productName=' + encodeURIComponent(productName) + '&sourcePostId=' + encodeURIComponent(sourcePostId)) as never);
          }}
        />
      )}

    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SCREEN_BG },

  pauseOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  mediaPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#17131D' },
  heartBurst: { position: 'absolute', top: '38%', left: '50%', marginLeft: -55, marginTop: -55 },
  mediaDots: { position: 'absolute', top: '50%', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  mediaDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFFFFF80' },
  mediaDotActive: { width: 18, backgroundColor: '#FFFFFF' },
  mediaTags: { position: 'absolute', left: 14, right: 76, gap: 8 },
  mediaTag: {
    alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 15, paddingVertical: 8, paddingHorizontal: 10,
    backgroundColor: '#120F18CC',
  },
  mediaTagCopy: { flexShrink: 1 },
  mediaTagName: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: FS.xs },
  mediaTagPrice: { color: '#FFFFFFCC', fontFamily: FONT.bold, fontSize: 12, marginTop: 1 },

  rail: {
    position: 'absolute', right: 10, bottom: 116, alignItems: 'center', gap: 18,
  },
  railAvatarWrap: { alignItems: 'center', marginBottom: 4 },
  railAvatar: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  railAvatarText: { fontSize: FS.base, fontFamily: FONT.bold, color: '#FFFFFF' },
  railFollowBadge: {
    position: 'absolute', bottom: -8, width: 19, height: 19, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#000',
  },
  railBtn: { alignItems: 'center', gap: 3 },
  railCount: { fontSize: FS.xs, fontFamily: FONT.semibold, color: '#FFFFFF' },

  shopBtn: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 18, borderRadius: 24, marginBottom: 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 8,
  },
  shopBtnText: { fontSize: FS.sm, fontFamily: FONT.bold, color: '#FFFFFF', letterSpacing: 0.4 },

  bottomInfo: { position: 'absolute', left: 16, right: 84, bottom: 26, gap: 8 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  locationText: { fontSize: FS.xs, fontFamily: FONT.medium, color: ON_DARK },
  caption: { fontSize: 14, fontFamily: FONT.regular, color: '#FFFFFF', lineHeight: 19 },
  moreText: { fontFamily: FONT.semibold, color: ON_DARK },
  creatorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 8 },
  creatorAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFFFFF' },
  creatorAvatarText: { fontSize: 10, fontFamily: FONT.bold, color: '#FFFFFF' },
  creatorName: { fontSize: FS.base, fontFamily: FONT.bold, color: '#FFFFFF' },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  soundText: { fontSize: FS.xs, fontFamily: FONT.regular, color: '#FFFFFFCC', flexShrink: 1 },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingBottom: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  topAvatarBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  unreadDot: { position: 'absolute', top: 4, right: 4, width: 9, height: 9, borderRadius: 4.5, backgroundColor: RED, borderWidth: 1.5, borderColor: BG },
  topIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { flex: 1, textAlign: 'center', fontSize: FS.md, fontFamily: FONT.bold, color: '#FFFFFF' },
  feedTabs: { alignSelf: 'center', flexDirection: 'row', gap: 26, marginTop: 2, paddingBottom: 2 },
  feedTab: { paddingHorizontal: 4, paddingVertical: 5, alignItems: 'center' },
  feedTabText: { color: ON_DARK, opacity: 0.6, fontFamily: FONT.semibold, fontSize: FS.sm },
  feedTabTextActive: { color: ON_DARK, opacity: 1 },
  feedTabUnderline: { height: 2, width: 24, borderRadius: 2, marginTop: 5 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: {
    flex: 1, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BORDER,
    backgroundColor: SURFACE, paddingHorizontal: 14, fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
  },

  modalBackdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  commentsSheet: {
    backgroundColor: SURFACE, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingTop: 10, paddingHorizontal: 18,
  },
  commentsHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: 14 },
  commentsTitle: { fontSize: FS.base, fontFamily: FONT.bold, color: FG, marginBottom: 6 },
  commentsEmpty: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, paddingVertical: 20, textAlign: 'center' },
  commentRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  commentUser: { fontSize: FS.sm, fontFamily: FONT.bold, color: FG, marginBottom: 3 },
  commentText: { fontSize: 14, fontFamily: FONT.regular, color: FG },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14, paddingBottom: 4 },
  commentInput: {
    flex: 1, height: 44, borderRadius: 22, backgroundColor: SURFACE,
    paddingHorizontal: 16, fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
  },
  commentSendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },

  notifRow: { fontSize: 13.5, fontFamily: FONT.regular, color: FG, paddingBottom: 14 },
  shopSheetBackdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  shopSheet: {
    backgroundColor: SURFACE, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: SP.md, paddingTop: SP.sm, borderTopWidth: 1, borderColor: BORDER,
  },
  shopSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.md },
  shopSheetEyebrow: { fontFamily: FONT.bold, fontSize: FS.xs, color: MUTED, letterSpacing: 1.2 },
  shopSheetClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  shopProductRow: { flexDirection: 'row', gap: SP.md, alignItems: 'center', marginBottom: SP.md },
  shopProductImage: { width: 92, height: 112, borderRadius: RADIUS.md, backgroundColor: CARD },
  shopProductCopy: { flex: 1, gap: 5 },
  shopProductName: { fontFamily: FONT.bold, fontSize: FS.md, color: FG, lineHeight: 21 },
  shopProductPrice: { fontFamily: FONT.bold, fontSize: FS.lg },
  shopProductSeller: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs },
  shopOptionLabel: { color: FG, fontFamily: FONT.semibold, fontSize: FS.sm, marginBottom: SP.sm },
  shopOptionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.md },
  shopSizeGuide: { color: MUTED, fontFamily: FONT.medium, fontSize: FS.xs },
  shopSwatches: { flexDirection: 'row', gap: 12 },
  shopSwatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  shopSwatchDot: { width: 24, height: 24, borderRadius: 12 },
  shopSizes: { flexDirection: 'row', gap: 8, marginBottom: SP.md },
  shopSize: { width: 44, height: 38, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  shopSizeText: { fontFamily: FONT.semibold, fontSize: FS.xs, color: FG },
  shopBuyButton: { minHeight: 52, borderRadius: RADIUS.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  shopBuyText: { fontFamily: FONT.bold, fontSize: FS.base },
  feedFooter: {
    width: SCREEN_W, height: 72, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#000000',
  },
  feedFooterText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
});
