import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TouchableWithoutFeedback,
  Dimensions, Animated, Alert, Share, TextInput, Modal,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getThreadPosts, subscribeSocial } from '@/services/socialService';
import type { SellerThreadPost } from '@/services/socialService';
import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import type { ViewToken } from 'react-native';
import { useApi } from '@/lib/api';
import {
  BG, SURFACE, CARD, OVERLAY,
  BORDER, BORDER_SUBTLE,
  FG, MUTED, SUBTLE, ON_DARK,
  PURPLE, PURPLE_LIGHT, CYAN, SUCCESS, RED,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM
} from '@/lib/theme';
import { BrandedLoadingState } from '@/components/BrandthreadUI';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

// ─── Mock spotlight (video) feed data ────────────────────────────────────────
// Videos are public sample clips standing in for creator-submitted footage.

const SPOTLIGHT_ITEMS = [
  {
    id: '1',
    creator: 'Vault Studio',
    handle: '@vaultstudio',
    avatarColor: '#8B5CF6',
    initials: 'VS',
    verified: true,
    videoUri: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
    caption: 'New drop just landed 🔥 Oversized canvas jacket — limited run of 50.',
    sound: 'Original Sound · vaultstudio',
    productName: 'Canvas Cargo Jacket',
    productPrice: '$189',
    productOriginalPrice: null as string | null,
    accentColor: '#8B5CF6',
    likes: 1240,
    comments: [
      { id: 'c1', user: '@dropzone', text: 'need this in black 😍' },
      { id: 'c2', user: '@street.era', text: 'copped one already' },
    ],
    reposts: 118,
    shares: 340,
  },
  {
    id: '2',
    creator: 'Meridian Co.',
    handle: '@meridianclothing',
    avatarColor: '#0F766E',
    initials: 'MC',
    verified: false,
    videoUri: 'https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4',
    caption: 'Clean minimalist tees now in 8 colorways. Basics shouldn\'t be boring.',
    sound: 'Original Sound · meridianclothing',
    productName: 'Essential Relaxed Tee',
    productPrice: '$48',
    productOriginalPrice: null as string | null,
    accentColor: '#14B8A6',
    likes: 892,
    comments: [
      { id: 'c1', user: '@basics.only', text: 'the fit on this is clean' },
    ],
    reposts: 44,
    shares: 210,
  },
  {
    id: '3',
    creator: 'NXGEN',
    handle: '@nxgendrops',
    avatarColor: '#B45309',
    initials: 'NX',
    verified: true,
    videoUri: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    caption: 'The cargo trousers everyone\'s been asking about. Back in stock 🙌',
    sound: 'Original Sound · nxgendrops',
    productName: 'Ripstop Cargo Trousers',
    productPrice: '$134',
    productOriginalPrice: '$160',
    accentColor: '#B98A2E',
    likes: 3410,
    comments: [
      { id: 'c1', user: '@cargofit', text: 'been waiting weeks for this restock' },
      { id: 'c2', user: '@yn.drip', text: 'link??' },
    ],
    reposts: 215,
    shares: 980,
  },
  {
    id: '4',
    creator: 'Softwear',
    handle: '@softwearstudio',
    avatarColor: '#BE185D',
    initials: 'SW',
    verified: false,
    videoUri: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4',
    caption: 'Sunday hoodies are here. 400gsm French terry, washed finish.',
    sound: 'Original Sound · softwearstudio',
    productName: 'Sunday Washed Hoodie',
    productPrice: '$98',
    productOriginalPrice: null as string | null,
    accentColor: '#EC4899',
    likes: 2180,
    comments: [
      { id: 'c1', user: '@hoodiehoarder', text: 'the washed finish 😩' },
    ],
    reposts: 132,
    shares: 670,
  },
  {
    id: '5',
    creator: 'Atlas Goods',
    handle: '@atlasgoods',
    avatarColor: '#1D4ED8',
    initials: 'AG',
    verified: true,
    videoUri: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
    caption: 'Workwear inspired, streetwear executed. Built for the city.',
    sound: 'Original Sound · atlasgoods',
    productName: 'City Chore Coat',
    productPrice: '$215',
    productOriginalPrice: '$260',
    accentColor: '#4A6FA5',
    likes: 975,
    comments: [
      { id: 'c1', user: '@city.slate', text: 'sand or slate, which one 👀' },
    ],
    reposts: 58,
    shares: 290,
  },
];

type SpotlightItem = typeof SPOTLIGHT_ITEMS[number];

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
  productTags: { productName: string; price: number }[];
}

function LiveStreamPage({ stream, onJoin }: { stream: LiveStreamFeedItem; onJoin: () => void }) {
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
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(80,20,100,0.18)' }} />
      {/* Centre glow */}
      <View style={{ position: 'absolute', top: SCREEN_H * 0.25, alignSelf: 'center', width: 280, height: 280, borderRadius: 140, backgroundColor: 'rgba(139,92,246,0.08)' }} />

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
        <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center', marginBottom: 20, borderWidth: 3, borderColor: '#fff' }}>
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
  saved: boolean;
  reposted: boolean; reposts: number;
  following: boolean;
  comments: { id: string; user: string; text: string }[];
};

function initialEngagement(item: SpotlightItem): EngagementState {
  return {
    liked: false, likes: item.likes,
    saved: false,
    reposted: false, reposts: item.reposts,
    following: false,
    comments: item.comments,
  };
}

const DEFAULT_ENGAGEMENT: EngagementState = {
  liked: false, likes: 0, saved: false, reposted: false, reposts: 0, following: false, comments: [],
};

function formatCount(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 >= 100 ? 1 : 0)}K`;
  return String(n);
}

// ─── Single video page ────────────────────────────────────────────────────────

function SpotlightPage({
  item, isActive, engagement, onLike, onDoubleTapLike, onSave, onRepost, onFollow, onOpenComments, onShop,
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
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Clear the floating pill tab bar (see (tabs)/_layout.tsx: bottomOffset + height 72 + margin).
  const tabBarClearance = Math.max(insets.bottom, 8) + 12 + 72 + 14;
  const player = useVideoPlayer(item.videoUri, p => { p.loop = true; p.muted = false; });
  const [paused, setPaused] = useState(false);
  const heartBurst = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  const lastTap = useRef(0);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => { if (pauseTimer.current) clearTimeout(pauseTimer.current); }, []);

  React.useEffect(() => {
    if (isActive && !paused) player.play();
    else player.pause();
  }, [isActive, paused, player]);

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
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            nativeControls={false}
          />
          {paused && (
            <View style={styles.pauseOverlay}>
              <Feather name="play" size={56} color="#FFFFFFCC" />
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

      {/* ─ Right action rail ─ */}
      <View style={[styles.rail, { bottom: tabBarClearance }]}>
        <View style={styles.railAvatarWrap}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(('/seller-profile?id=' + item.id) as never);
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
          <Feather name="repeat" size={28} color={engagement?.reposted ? PURPLE : '#FFFFFF'} />
          <Text style={styles.railCount}>{formatCount(engagement?.reposts ?? 0)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => { onSave(item.id); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
        >
          <Feather name="bookmark" size={27} color={engagement?.saved ? PURPLE : '#FFFFFF'} />
          <Text style={styles.railCount}>Save</Text>
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
              const tags = (item as any).productTags as Array<{ productId: string; productName: string; price: number }>;
              if (tags.length === 1) {
                router.push(('/buyer-product-detail?productId=' + tags[0].productId) as never);
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
          style={[styles.shopBtn, { backgroundColor: PURPLE }]}
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
            router.push(('/seller-profile?id=' + item.id) as never);
          }}
        >
          <View style={styles.creatorRow}>
            <Text style={styles.creatorName}>{item.creator}</Text>
            {item.verified && <Feather name="check-circle" size={13} color="#4FA8FF" style={{ marginLeft: 4 }} />}
          </View>
        </TouchableOpacity>

        <Text style={styles.caption} numberOfLines={2}>{item.caption}</Text>

        <View style={styles.soundRow}>
          <Feather name="music" size={12} color="#FFFFFF" />
          <Text style={styles.soundText} numberOfLines={1}>{item.sound}</Text>
        </View>
      </View>
    </View>
  );
}

// CommentsModal replaced by navigation to /buyer-post-comments (see handleOpenComments).

// ─── Map a service SellerThreadPost to the feed display format ────────────────

function mapSellerPost(post: SellerThreadPost): SpotlightItem {
  const tag = post.productTags[0];
  return {
    id: post.id,
    creator: post.authorName,
    handle: post.authorHandle,
    avatarColor: post.authorColor,
    initials: post.authorInitials,
    verified: false,
    videoUri: post.mediaUris[0] ?? 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
    caption: post.caption,
    sound: post.sound
      ? `${post.sound.soundTitle} · ${post.sound.artist}`
      : `Original Sound · ${post.authorHandle.slice(1)}`,
    productName: tag?.productName ?? 'Shop Now',
    productPrice: tag ? `${Number(tag.price).toFixed(0)}` : '',
    productOriginalPrice: null as string | null,
    accentColor: post.authorColor,
    likes: post.likesCount,
    comments: [] as { id: string; user: string; text: string }[],
    reposts: post.repostsCount,
    shares: 0,
    // Extra fields used by handleShop via `(item as any).productId`
    productId: tag?.productId,
    sellerId: post.authorId,
    productTags: post.productTags,
  } as unknown as SpotlightItem;
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function FeedScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [engagements, setEngagements] = useState<Record<string, EngagementState>>(() => {
    const init: Record<string, EngagementState> = {};
    SPOTLIGHT_ITEMS.forEach(item => { init[item.id] = initialEngagement(item); });
    return init;
  });
  const [activeIndex, setActiveIndex] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifs, setShowNotifs] = useState(false);
  const [hasUnread, setHasUnread] = useState(true);
  const [sellerFeedPosts, setSellerFeedPosts] = useState<SpotlightItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [activeLiveStreams, setActiveLiveStreams] = useState<LiveStreamFeedItem[]>([]);
  const api = useApi();

  // Load published seller posts and subscribe to real-time changes
  useEffect(() => {
    async function loadFeed() {
      setFeedLoading(true);
      try {
        const posts = await getThreadPosts();
        setSellerFeedPosts(posts.map(mapSellerPost));
      } catch {} finally {
        setFeedLoading(false);
      }
    }
    loadFeed();
    const unsub = subscribeSocial(loadFeed);
    return unsub;
  }, []);

  // Poll active live streams every 30 seconds
  useEffect(() => {
    async function fetchLive() {
      try {
        const data = await (api as any).live.active() as { streams: any[] };
        setActiveLiveStreams((data.streams ?? []).map((s: any) => ({
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
      } catch {}
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

  // Real published seller posts first; demo items fill the rest.
  // Live streams are woven in at roughly 1 per 10 regular posts (occasional, not dominant).
  const allItems = useMemo(() => {
    const regular: (SpotlightItem | LiveStreamFeedItem)[] = [
      ...sellerFeedPosts,
      ...SPOTLIGHT_ITEMS.filter(s => !sellerFeedPosts.some(sp => sp.id === s.id)),
    ];
    if (!activeLiveStreams.length) return regular;
    // Weave live streams in: first at index 4, then every 10 after
    const result: (SpotlightItem | LiveStreamFeedItem)[] = [...regular];
    activeLiveStreams.slice(0, 3).forEach((liveItem, i) => {
      const insertAt = Math.min(4 + i * 10, result.length);
      result.splice(insertAt, 0, liveItem);
    });
    return result;
  }, [sellerFeedPosts, activeLiveStreams]);

  const displayItems = searchQuery.trim()
    ? allItems.filter(item => {
        const q = searchQuery.toLowerCase();
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
    update(id, e => ({ liked: !e.liked, likes: e.liked ? e.likes - 1 : e.likes + 1 }));
    // Fire-and-forget — real posts get persisted; demo IDs are silently ignored server-side
    try { const { api } = require('@/lib/api'); api.posts.interact(id, { type: 'like' }).catch(() => {}); } catch {}
  }, []);

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
      return { ...prev, [id]: { ...cur, saved: !cur.saved } };
    });
  }, []);

  const handleRepost = useCallback((id: string) => {
    update(id, e => ({ reposted: !e.reposted, reposts: e.reposted ? e.reposts - 1 : e.reposts + 1 }));
    try { const { api } = require('@/lib/api'); api.posts.interact(id, { type: 'repost' }).catch(() => {}); } catch {}
  }, []);

  const handleFollow = useCallback((id: string) => update(id, e => ({ following: !e.following })), []);

  function handleOpenComments(id: string) {
    const item = allItems.find(i => i.id === id);
    if (!item) return;
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
    // Track shop click for post analytics (fire-and-forget)
    try {
      const { api } = require('@/lib/api');
      api.posts.interact(item.id, { type: 'shop_click' }).catch(() => {/* non-critical */});
    } catch { /* non-critical */ }
    const productId = (item as any).productId ?? item.id;
    const productName = (item as any).productName ?? '';
    router.push(('/buyer-product-detail?productId=' + productId + '&productName=' + encodeURIComponent(productName ?? '') + '&sourcePostId=' + item.id) as never);
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
        <BrandedLoadingState
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
        getItemLayout={(_, index) => ({ length: SCREEN_H, offset: SCREEN_H * index, index })}
        ListEmptyComponent={
          <View style={{ width: SCREEN_W, height: SCREEN_H, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <Feather name="search" size={32} color="#8C8577" />
            <Text style={{ fontSize: FS.base, fontFamily: FONT.medium, color: '#8C8577' }}>
              No results for "{searchQuery}"
            </Text>
          </View>
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

            <Text style={styles.topTitle}>Spotlight</Text>

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

    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },

  pauseOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  heartBurst: { position: 'absolute', top: '38%', left: '50%', marginLeft: -55, marginTop: -55 },

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


  caption: { fontSize: 14, fontFamily: FONT.regular, color: '#FFFFFF', lineHeight: 19 },
  creatorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
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
  commentUser: { fontSize: FS.sm, fontFamily: FONT.bold, color: PURPLE_LIGHT, marginBottom: 3 },
  commentText: { fontSize: 14, fontFamily: FONT.regular, color: FG },
  commentInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 14, paddingBottom: 4 },
  commentInput: {
    flex: 1, height: 44, borderRadius: 22, backgroundColor: SURFACE,
    paddingHorizontal: 16, fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
  },
  commentSendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },

  notifRow: { fontSize: 13.5, fontFamily: FONT.regular, color: FG, paddingBottom: 14 },
});
