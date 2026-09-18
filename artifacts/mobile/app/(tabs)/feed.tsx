import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TouchableWithoutFeedback,
  Dimensions, Animated, Share, TextInput, Modal,
  Platform, ScrollView, RefreshControl, ActivityIndicator, KeyboardAvoidingView, Image,
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
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { Asset } from 'expo-asset';
import type { ViewToken } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
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
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { formatCents } from '@/lib/money';
import {
  ClaimedRemainingLabel,
  TimeRemainingLabel,
  UrgencyBar,
  HighDemandSectionHead,
  URGENCY_UNITS_THRESHOLD,
  type CommerceSignalData,
} from '@/components/CommerceSignal';
import { ShopProductSheet } from '@/components/ShopProductSheet';
import type { ShopSheetSelection } from '@/components/ShopProductSheet';
import type { BuyerProduct } from '@/services/cartTypes';
import {
  EngagementButton,
  FeedToastProvider,
  useFeedToast,
} from '@/components/EngagementButton';
import { formatCount } from '@/lib/engagementUtils';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const THREAD_PAGE_SIZE = 30;

// ─── Buyer demand page — sentinel and type guard ──────────────────────────────
// The sentinel is the first element in displayItems when buyerMode=true.
// It is never stored in the DB and is never passed through the regular feed
// pipeline. getItemLayout is uniform (length: SCREEN_H) for all items including
// the sentinel so snapping works with zero per-index special cases.

const DEMAND_PAGE_SENTINEL: { _isDemandPage: true; id: string } = {
  _isDemandPage: true,
  id: '__buyer_demand_page__',
};

type BuyerDemandPageItem = typeof DEMAND_PAGE_SENTINEL;

function isDemandPageItem(item: FeedItem): item is BuyerDemandPageItem {
  return (item as BuyerDemandPageItem)._isDemandPage === true;
}

// ─── High Demand page (full-screen) ──────────────────────────────────────────
// Rendered at scroll index 0 only when buyerMode=true.
// Data from publicProducts.highDemand(6) — only qualified product-backed rows.
// Empty array = nothing qualifies → show empty state; no ordinary-product fallback.

interface HighDemandProduct {
  id: string;
  productId: string;
  brand: string;
  name: string;
  imageUri?: string;
  initials: string;
  commerce: CommerceSignalData;
}

function BuyerHighDemandPage() {
  const { theme } = useAppTheme();
  const { push } = useThreadPull();
  const api = useApi();
  const insets = useSafeAreaInsets();

  const [items, setItems]       = useState<HighDemandProduct[]>([]);
  const [loading, setLoading]   = useState(true);

  // api.publicProducts.highDemand(limit) → PublicProduct[]
  // Direct array response — no {items} wrapper.
  // Only qualified product-backed rows; empty = nothing qualifies.
  // No fallback fetch — empty array shows the empty state.
  const fetchDemand = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.publicProducts.highDemand(6);
      const safe = Array.isArray(rows) ? rows : [];
      setItems(safe.map((p: any): HighDemandProduct => ({
        id:        `hd_${p.id}`,
        productId: p.id,
        brand:     p.sellerDisplayName ?? 'Seller',
        name:      p.name,
        imageUri:  (p.images ?? [])[0] ?? undefined,
        initials:  (p.name ?? 'P')[0].toUpperCase(),
        commerce: {
          currentPriceCents: p.currentPriceCents ?? (p.variants ?? [])[0]?.priceCents ?? null,
          claimedUnits:      typeof p.claimedUnits  === 'number' ? p.claimedUnits  : 0,
          remainingUnits:    typeof p.remainingUnits === 'number' ? p.remainingUnits : 0,
          demandCount:       typeof p.demandCount    === 'number' ? p.demandCount    : null,
          endsAt:            p.endsAt ?? null,
        },
      })));
    } catch {
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchDemand(); }, [fetchDemand]);

  const topPad = insets.top + 20;

  return (
    <View style={{ width: SCREEN_W, height: SCREEN_H, backgroundColor: BG }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: topPad, paddingHorizontal: 20, paddingBottom: 100 }}
        showsVerticalScrollIndicator={false}
      >
        <HighDemandSectionHead
          title="High Demand"
          subtitle="Products moving fast across the platform"
          style={{ marginBottom: 20 }}
        />

        {loading ? (
          <View style={{ gap: 12 }}>
            {[0, 1, 2].map(i => (
              <View key={i} style={hdStyles.skelRow}>
                <View style={hdStyles.skelAvatar} />
                <View style={{ flex: 1, gap: 8 }}>
                  <View style={[hdStyles.skelLine, { width: '65%' }]} />
                  <View style={[hdStyles.skelLine, { width: '45%' }]} />
                </View>
                <View style={[hdStyles.skelLine, { width: 48 }]} />
              </View>
            ))}
          </View>
        ) : items.length === 0 ? (
          <View style={{ alignItems: 'center', gap: 10, paddingTop: 40 }}>
            <Feather name="trending-up" size={28} color={SUBTLE} />
            <Text style={{ fontFamily: FONT.regular, fontSize: FS.sm, color: MUTED, textAlign: 'center' }}>
              No high-demand products right now
            </Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {items.map(item => {
              const isUrgent =
                (item.commerce.remainingUnits ?? 0) > 0 &&
                (item.commerce.remainingUnits ?? 0) <= URGENCY_UNITS_THRESHOLD;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[hdStyles.row, { borderColor: isUrgent ? `${theme.accent}44` : BORDER }]}
                  activeOpacity={0.8}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    push((`/thread-product-detail?productId=${encodeURIComponent(item.productId)}&productName=${encodeURIComponent(item.name)}`) as never);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name} by ${item.brand}`}
                >
                  {item.imageUri ? (
                    <CachedImage source={{ uri: item.imageUri }} style={hdStyles.avatar} contentFit="cover" />
                  ) : (
                    <View style={[hdStyles.avatar, { backgroundColor: theme.accentDim, alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={{ fontSize: 13, fontFamily: FONT.bold, color: ON_DARK }}>{item.initials}</Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={hdStyles.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={hdStyles.brand} numberOfLines={1}>{item.brand}</Text>
                    <ClaimedRemainingLabel
                      claimedUnits={item.commerce.claimedUnits ?? 0}
                      remainingUnits={item.commerce.remainingUnits ?? 0}
                      urgent={isUrgent}
                      accent={theme.accent}
                      style={{ marginTop: 3 }}
                    />
                    {!!item.commerce.endsAt && (
                      <TimeRemainingLabel endsAt={item.commerce.endsAt} accent={theme.accent} />
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 4 }}>
                    {item.commerce.currentPriceCents != null && (
                      <Text style={[hdStyles.price, isUrgent && { color: theme.accent }]}>
                        {formatCents(item.commerce.currentPriceCents)}
                      </Text>
                    )}
                    {isUrgent && (
                      <UrgencyBar
                        claimedUnits={item.commerce.claimedUnits ?? 0}
                        remainingUnits={item.commerce.remainingUnits ?? 0}
                        accentColor={theme.accent}
                        style={{ width: 64 }}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const hdStyles = StyleSheet.create({
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: RADIUS.xs, borderWidth: 1, backgroundColor: CARD },
  avatar:   { width: 44, height: 44, borderRadius: RADIUS.xs, overflow: 'hidden' },
  name:     { fontSize: 13, fontFamily: FONT.semibold, color: FG },
  brand:    { fontSize: 11, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  price:    { fontSize: 13, fontFamily: FONT.bold, color: FG },
  skelRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: RADIUS.xs, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  skelAvatar: { width: 44, height: 44, borderRadius: RADIUS.xs, backgroundColor: SURFACE },
  skelLine: { height: 10, borderRadius: 4, backgroundColor: SURFACE },
});

// ─── Feed item display type ───────────────────────────────────────────────────

interface SpotlightItem {
  id: string;
  creator: string;
  handle: string;
  avatarColor: string;
  initials: string;
  verified: boolean;
  mediaUris: string[];
  videoSource?: VideoSource;
  videoPosterUri?: string;
  videoPosterSource?: ImageSourcePropType;
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
  /** Authoritative comment count from the server (preferred over local comments array length) */
  commentsCount?: number;
}
type SpotlightProductTag = NonNullable<SpotlightItem['productTags']>[number];

const FASHION_PREVIEW_VIDEO_SOURCES: VideoSource[] = [
  require('../../assets/videos/fashion_runway_01.mp4'),
  require('../../assets/videos/fashion_runway_02.mp4'),
  require('../../assets/videos/fashion_runway_03.mp4'),
  require('../../assets/videos/fashion_runway_04.mp4'),
  require('../../assets/videos/fashion_runway_05.mp4'),
  require('../../assets/videos/fashion_runway_06.mp4'),
  require('../../assets/videos/fashion_runway_07.mp4'),
  require('../../assets/videos/fashion_runway_08.mp4'),
  require('../../assets/videos/fashion_runway_09.mp4'),
  require('../../assets/videos/fashion_runway_10.mp4'),
];

const FASHION_PREVIEW_VIDEO_URIS = FASHION_PREVIEW_VIDEO_SOURCES.map(
  module => Asset.fromModule(module as number).uri,
);

const FASHION_PREVIEW_POSTER_SOURCES = [
  require('../../assets/videos/fashion_runway_01.png'),
  require('../../assets/videos/fashion_runway_02.png'),
  require('../../assets/videos/fashion_runway_03.png'),
  require('../../assets/videos/fashion_runway_04.png'),
  require('../../assets/videos/fashion_runway_05.png'),
  require('../../assets/videos/fashion_runway_06.png'),
  require('../../assets/videos/fashion_runway_07.png'),
  require('../../assets/videos/fashion_runway_08.png'),
  require('../../assets/videos/fashion_runway_09.png'),
  require('../../assets/videos/fashion_runway_10.png'),
];

const FASHION_PREVIEW_POSTER_URIS = FASHION_PREVIEW_POSTER_SOURCES.map(
  module => Asset.fromModule(module).uri,
);

const FASHION_PREVIEW_POSTS: SpotlightItem[] = [
  {
    id: 'preview-fashion-01',
    creator: 'Atelier Noire',
    handle: '@ateliernoire',
    avatarColor: '#232323',
    initials: 'AN',
    verified: true,
    mediaUris: [FASHION_PREVIEW_VIDEO_URIS[0]],
    videoSource: FASHION_PREVIEW_VIDEO_SOURCES[0],
    videoPosterUri: FASHION_PREVIEW_POSTER_URIS[0],
    videoPosterSource: FASHION_PREVIEW_POSTER_SOURCES[0],
    contentType: 'video',
    caption: 'Preview · Midnight tailoring, cut for movement.',
    sound: 'After Dark · Atelier Noire',
    productName: 'Sculpted Wool Coat',
    productPrice: '$480',
    productOriginalPrice: null,
    accentColor: '#232323',
    likes: 12840,
    comments: [],
    reposts: 684,
    shares: 392,
    saves: 2103,
    location: 'Paris, France',
    productId: 'preview-product-01',
    sellerId: 'preview-seller-01',
    productTags: [{ productId: 'preview-product-01', productName: 'Sculpted Wool Coat', priceCents: 48000 }],
    commentsCount: 318,
  },
  {
    id: 'preview-fashion-02',
    creator: 'Maison Vela',
    handle: '@maisonvela',
    avatarColor: '#474747',
    initials: 'MV',
    verified: true,
    mediaUris: [FASHION_PREVIEW_VIDEO_URIS[1]],
    videoSource: FASHION_PREVIEW_VIDEO_SOURCES[1],
    videoPosterUri: FASHION_PREVIEW_POSTER_URIS[1],
    videoPosterSource: FASHION_PREVIEW_POSTER_SOURCES[1],
    contentType: 'video',
    caption: 'Preview · Silver lines and a clean architectural silhouette.',
    sound: 'Chrome Room · Vela Studios',
    productName: 'Liquid Silver Dress',
    productPrice: '$325',
    productOriginalPrice: '$390',
    accentColor: '#474747',
    likes: 9360,
    comments: [],
    reposts: 441,
    shares: 287,
    saves: 1745,
    location: 'Milan, Italy',
    productId: 'preview-product-02',
    sellerId: 'preview-seller-02',
    productTags: [{ productId: 'preview-product-02', productName: 'Liquid Silver Dress', priceCents: 32500 }],
    commentsCount: 204,
  },
  {
    id: 'preview-fashion-03',
    creator: 'Saint Rue',
    handle: '@saintrue',
    avatarColor: '#171717',
    initials: 'SR',
    verified: true,
    mediaUris: [FASHION_PREVIEW_VIDEO_URIS[2]],
    videoSource: FASHION_PREVIEW_VIDEO_SOURCES[2],
    videoPosterUri: FASHION_PREVIEW_POSTER_URIS[2],
    videoPosterSource: FASHION_PREVIEW_POSTER_SOURCES[2],
    contentType: 'video',
    caption: 'Preview · Street tailoring with couture proportions.',
    sound: 'Concrete Waltz · Saint Rue',
    productName: 'Oversized Tuxedo',
    productPrice: '$560',
    productOriginalPrice: null,
    accentColor: '#171717',
    likes: 18600,
    comments: [],
    reposts: 1204,
    shares: 875,
    saves: 3980,
    location: 'New York, NY',
    productId: 'preview-product-03',
    sellerId: 'preview-seller-03',
    productTags: [{ productId: 'preview-product-03', productName: 'Oversized Tuxedo', priceCents: 56000 }],
    commentsCount: 527,
  },
  {
    id: 'preview-fashion-04',
    creator: 'Orison',
    handle: '@orisonstudio',
    avatarColor: '#626262',
    initials: 'OR',
    verified: false,
    mediaUris: [FASHION_PREVIEW_VIDEO_URIS[3]],
    videoSource: FASHION_PREVIEW_VIDEO_SOURCES[3],
    videoPosterUri: FASHION_PREVIEW_POSTER_URIS[3],
    videoPosterSource: FASHION_PREVIEW_POSTER_SOURCES[3],
    contentType: 'video',
    caption: 'Preview · A study in ivory, volume, and soft structure.',
    sound: 'Still Form · Orison',
    productName: 'Ivory Column Set',
    productPrice: '$410',
    productOriginalPrice: null,
    accentColor: '#626262',
    likes: 7420,
    comments: [],
    reposts: 306,
    shares: 198,
    saves: 1390,
    location: 'London, UK',
    productId: 'preview-product-04',
    sellerId: 'preview-seller-04',
    productTags: [{ productId: 'preview-product-04', productName: 'Ivory Column Set', priceCents: 41000 }],
    commentsCount: 149,
  },
  {
    id: 'preview-fashion-05',
    creator: 'Kuro Line',
    handle: '@kuroline',
    avatarColor: '#0F0F0F',
    initials: 'KL',
    verified: true,
    mediaUris: [FASHION_PREVIEW_VIDEO_URIS[4]],
    videoSource: FASHION_PREVIEW_VIDEO_SOURCES[4],
    videoPosterUri: FASHION_PREVIEW_POSTER_URIS[4],
    videoPosterSource: FASHION_PREVIEW_POSTER_SOURCES[4],
    contentType: 'video',
    caption: 'Preview · Monochrome layers designed from every angle.',
    sound: 'Parallel · Kuro Line',
    productName: 'Asymmetric Layer Jacket',
    productPrice: '$295',
    productOriginalPrice: '$350',
    accentColor: '#0F0F0F',
    likes: 22100,
    comments: [],
    reposts: 1640,
    shares: 1118,
    saves: 5206,
    location: 'Tokyo, Japan',
    productId: 'preview-product-05',
    sellerId: 'preview-seller-05',
    productTags: [{ productId: 'preview-product-05', productName: 'Asymmetric Layer Jacket', priceCents: 29500 }],
    commentsCount: 731,
  },
  {
    id: 'preview-fashion-06',
    creator: 'Forme 22',
    handle: '@forme22',
    avatarColor: '#353535',
    initials: 'F2',
    verified: false,
    mediaUris: [FASHION_PREVIEW_VIDEO_URIS[5]],
    videoSource: FASHION_PREVIEW_VIDEO_SOURCES[5],
    videoPosterUri: FASHION_PREVIEW_POSTER_URIS[5],
    videoPosterSource: FASHION_PREVIEW_POSTER_SOURCES[5],
    contentType: 'video',
    caption: 'Preview · Draped jersey meets precision hardware.',
    sound: 'Soft Machine · Forme 22',
    productName: 'Draped Hardware Gown',
    productPrice: '$375',
    productOriginalPrice: null,
    accentColor: '#353535',
    likes: 6890,
    comments: [],
    reposts: 249,
    shares: 164,
    saves: 1187,
    location: 'Berlin, Germany',
    productId: 'preview-product-06',
    sellerId: 'preview-seller-06',
    productTags: [{ productId: 'preview-product-06', productName: 'Draped Hardware Gown', priceCents: 37500 }],
    commentsCount: 121,
  },
  {
    id: 'preview-fashion-07',
    creator: 'Astrae',
    handle: '@astraeofficial',
    avatarColor: '#555555',
    initials: 'AS',
    verified: true,
    mediaUris: [FASHION_PREVIEW_VIDEO_URIS[6]],
    videoSource: FASHION_PREVIEW_VIDEO_SOURCES[6],
    videoPosterUri: FASHION_PREVIEW_POSTER_URIS[6],
    videoPosterSource: FASHION_PREVIEW_POSTER_SOURCES[6],
    contentType: 'video',
    caption: 'Preview · Evening light caught in hand-finished crystal.',
    sound: 'Glass Light · Astrae',
    productName: 'Crystal Mesh Top',
    productPrice: '$245',
    productOriginalPrice: null,
    accentColor: '#555555',
    likes: 15300,
    comments: [],
    reposts: 908,
    shares: 622,
    saves: 2874,
    location: 'Los Angeles, CA',
    productId: 'preview-product-07',
    sellerId: 'preview-seller-07',
    productTags: [{ productId: 'preview-product-07', productName: 'Crystal Mesh Top', priceCents: 24500 }],
    commentsCount: 406,
  },
  {
    id: 'preview-fashion-08',
    creator: 'Noma Archive',
    handle: '@nomaarchive',
    avatarColor: '#292929',
    initials: 'NA',
    verified: true,
    mediaUris: [FASHION_PREVIEW_VIDEO_URIS[7]],
    videoSource: FASHION_PREVIEW_VIDEO_SOURCES[7],
    videoPosterUri: FASHION_PREVIEW_POSTER_URIS[7],
    videoPosterSource: FASHION_PREVIEW_POSTER_SOURCES[7],
    contentType: 'video',
    caption: 'Preview · Archival shapes, reconstructed for now.',
    sound: 'Reissue 08 · Noma Archive',
    productName: 'Reconstructed Trench',
    productPrice: '$520',
    productOriginalPrice: null,
    accentColor: '#292929',
    likes: 11800,
    comments: [],
    reposts: 715,
    shares: 483,
    saves: 2460,
    location: 'Copenhagen, Denmark',
    productId: 'preview-product-08',
    sellerId: 'preview-seller-08',
    productTags: [{ productId: 'preview-product-08', productName: 'Reconstructed Trench', priceCents: 52000 }],
    commentsCount: 276,
  },
  {
    id: 'preview-fashion-09',
    creator: 'Echelon',
    handle: '@echelonmode',
    avatarColor: '#404040',
    initials: 'EC',
    verified: false,
    mediaUris: [FASHION_PREVIEW_VIDEO_URIS[8]],
    videoSource: FASHION_PREVIEW_VIDEO_SOURCES[8],
    videoPosterUri: FASHION_PREVIEW_POSTER_URIS[8],
    videoPosterSource: FASHION_PREVIEW_POSTER_SOURCES[8],
    contentType: 'video',
    caption: 'Preview · Sharp shoulders. Fluid finish. No compromise.',
    sound: 'Forward Motion · Echelon',
    productName: 'Satin Power Suit',
    productPrice: '$445',
    productOriginalPrice: '$510',
    accentColor: '#404040',
    likes: 8470,
    comments: [],
    reposts: 378,
    shares: 244,
    saves: 1518,
    location: 'Seoul, South Korea',
    productId: 'preview-product-09',
    sellerId: 'preview-seller-09',
    productTags: [{ productId: 'preview-product-09', productName: 'Satin Power Suit', priceCents: 44500 }],
    commentsCount: 188,
  },
  {
    id: 'preview-fashion-10',
    creator: 'Vale Studio',
    handle: '@valestudio',
    avatarColor: '#1E1E1E',
    initials: 'VS',
    verified: true,
    mediaUris: [FASHION_PREVIEW_VIDEO_URIS[9]],
    videoSource: FASHION_PREVIEW_VIDEO_SOURCES[9],
    videoPosterUri: FASHION_PREVIEW_POSTER_URIS[9],
    videoPosterSource: FASHION_PREVIEW_POSTER_SOURCES[9],
    contentType: 'video',
    caption: 'Preview · Closing look: black silk, sculpted by hand.',
    sound: 'Finale · Vale Studio',
    productName: 'Sculpted Silk Gown',
    productPrice: '$690',
    productOriginalPrice: null,
    accentColor: '#1E1E1E',
    likes: 27400,
    comments: [],
    reposts: 1980,
    shares: 1320,
    saves: 6140,
    location: 'Paris, France',
    productId: 'preview-product-10',
    sellerId: 'preview-seller-10',
    productTags: [{ productId: 'preview-product-10', productName: 'Sculpted Silk Gown', priceCents: 69000 }],
    commentsCount: 902,
  },
];

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

// Union of all possible displayable items in the FlatList
type FeedItem = SpotlightItem | LiveStreamFeedItem | BuyerDemandPageItem;

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
      <View style={{ ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,80,100,0.18)' }} />
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

// formatCount is imported from @/components/EngagementButton

// ─── Full-screen media page ───────────────────────────────────────────────────

function VideoVisual({
  source,
  isActive,
  paused,
  muted = false,
  posterUri,
  posterSource,
}: {
  source: VideoSource;
  isActive: boolean;
  paused: boolean;
  muted?: boolean;
  posterUri?: string;
  posterSource?: ImageSourcePropType;
}) {
  const player = useVideoPlayer(source, p => { p.loop = true; p.muted = muted; });
  const [hasStarted, setHasStarted] = useState(false);
  const showPoster = Boolean(posterSource || posterUri) && !hasStarted;
  React.useEffect(() => {
    const subscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) setHasStarted(true);
    });
    return () => subscription.remove();
  }, [player]);
  React.useEffect(() => {
    if (isActive && !paused) player.play();
    else player.pause();
  }, [isActive, paused, player]);
  return (
    <>
      {showPoster && (
        <Image
          source={posterSource ?? { uri: posterUri! }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, showPoster && { opacity: 0 }]}
        contentFit="cover"
        nativeControls={false}
      />
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
  onLike: (id: string) => Promise<void>;
  onDoubleTapLike: (id: string) => void;
  onSave: (id: string) => Promise<void>;
  onRepost: (id: string) => Promise<void>;
  onFollow: (id: string) => Promise<void>;
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
            ? (
              <VideoVisual
                source={item.videoSource ?? item.mediaUris[0]}
                isActive={isActive}
                paused={paused}
                muted={item.videoSource != null}
                posterUri={item.videoPosterUri}
                posterSource={item.videoPosterSource}
              />
            )
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
        <View style={[styles.mediaTags, { bottom: tabBarClearance + 194 }]} pointerEvents="box-none">
          {item.productTags.slice(0, 1).map(tag => (
            <TouchableOpacity
              key={tag.productId}
              style={styles.mediaTag}
              activeOpacity={0.82}
              onPress={() => onShopTag(item, tag)}
              accessibilityRole="button"
              accessibilityLabel={`Shop ${tag.productName} for ${formatCents(tag.priceCents)}`}
            >
              <View style={styles.mediaTagIcon}>
                <Feather name="shopping-bag" size={19} color="#111111" />
              </View>
              <View style={styles.mediaTagCopy}>
                <Text style={styles.mediaTagName} numberOfLines={1}>
                  Shop · {tag.productName}
                </Text>
                <Text style={styles.mediaTagMeta} numberOfLines={1}>
                  {formatCents(tag.priceCents)} · Creator pick
                  {item.productTags!.length > 1 ? `s (${item.productTags!.length})` : ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color="#FFFFFFCC" />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* ─ Right action rail ─ */}
      <View style={[styles.rail, { bottom: tabBarClearance }]}>
        {/* Avatar + follow badge */}
        <View style={styles.railAvatarWrap}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(('/seller-profile?id=' + encodeURIComponent(item.sellerId ?? item.id)) as never);
            }}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.creator}'s profile`}
          >
            <View style={[styles.railAvatar, { backgroundColor: item.avatarColor }]}>
              <Text style={styles.railAvatarText}>{item.initials}</Text>
            </View>
          </TouchableOpacity>
          {!(engagement?.following) && (
            <EngagementButton
              icon="plus"
              iconSize={11}
              active={false}
              accessibilityLabel={`Follow ${item.creator}`}
              style={[styles.railFollowBadge, { backgroundColor: item.accentColor }]}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                await onFollow(item.id);
              }}
              testID={`follow-btn-${item.id}`}
            />
          )}
        </View>

        {/* Like */}
        <EngagementButton
          icon="heart"
          iconSize={30}
          count={formatCount(engagement?.likes ?? 0)}
          active={engagement?.liked ?? false}
          activeColor="#EF4444"
          inactiveColor="#FFFFFF"
          accessibilityLabel={`${engagement?.liked ? 'Unlike' : 'Like'}, ${formatCount(engagement?.likes ?? 0)} likes`}
          accessibilityState={{ checked: engagement?.liked ?? false }}
          scaleAnim={heartScale}
          onPress={async () => {
            bumpHeart();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            await onLike(item.id);
          }}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          testID={`like-btn-${item.id}`}
        />

        {/* Comments — not async, opens navigation */}
        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => onOpenComments(item.id)}
          accessibilityRole="button"
          accessibilityLabel={`Comments, ${formatCount(item.commentsCount ?? (engagement?.comments ?? []).length)}`}
        >
          <Feather name="message-circle" size={26} color="#FFFFFF" />
          <Text style={styles.railCount}>{formatCount(item.commentsCount ?? (engagement?.comments ?? []).length)}</Text>
        </TouchableOpacity>

        {/* Repost */}
        <EngagementButton
          icon="repeat"
          iconSize={28}
          count={formatCount(engagement?.reposts ?? 0)}
          active={engagement?.reposted ?? false}
          activeColor={theme.accent}
          inactiveColor="#FFFFFF"
          accessibilityLabel={`${engagement?.reposted ? 'Undo repost' : 'Repost'}, ${formatCount(engagement?.reposts ?? 0)} reposts`}
          accessibilityState={{ checked: engagement?.reposted ?? false }}
          onPress={async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            await onRepost(item.id);
          }}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          testID={`repost-btn-${item.id}`}
        />

        {/* Save */}
        <EngagementButton
          icon="bookmark"
          iconSize={27}
          count={formatCount(engagement?.saves ?? item.saves)}
          active={engagement?.saved ?? false}
          activeColor={theme.accent}
          inactiveColor="#FFFFFF"
          accessibilityLabel={`${engagement?.saved ? 'Unsave' : 'Save'}, ${formatCount(engagement?.saves ?? item.saves)} saves`}
          accessibilityState={{ checked: engagement?.saved ?? false }}
          onPress={async () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            await onSave(item.id);
          }}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          testID={`save-btn-${item.id}`}
        />

        {/* Share — fire-and-forget native sheet, not an engagement action */}
        <TouchableOpacity
          style={styles.shareRailBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Share post"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            const shareMsg = item.productName
              ? `${item.productName} by ${item.creator} on Brandthread`
              : `Check out ${item.creator}'s post on Brandthread`;
            void Share.share({ message: shareMsg });
          }}
        >
          <View style={styles.shareRailIcon}>
            <Feather name="send" size={21} color="#111111" />
          </View>
          <Text style={styles.railCount}>{formatCount(item.shares)}</Text>
        </TouchableOpacity>

        {/* Shop */}
        {(item.productTags?.length ?? 0) > 0 && (
          <TouchableOpacity
            style={styles.railBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
            onPress={() => onShop(item)}
            accessibilityRole="button"
            accessibilityLabel={`Shop — ${(item.productTags?.length ?? 1)} product${(item.productTags?.length ?? 1) > 1 ? 's' : ''} tagged`}
          >
            <Feather name="shopping-bag" size={27} color="#FFFFFF" />
            <Text style={styles.railCount}>Shop</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ─ Bottom-left overlay: shop CTA, creator, caption, sound ─ */}
      <View style={[styles.bottomInfo, { bottom: tabBarClearance }]} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.shopBtn}
          activeOpacity={0.85}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => onShop(item)}
        >
          <Feather name="shopping-bag" size={17} color="#111111" />
          <Text style={styles.shopBtnText}>Shop look</Text>
          <Feather name="arrow-up-right" size={15} color="#111111" />
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

         <View style={[styles.locationRow, !item.location && styles.infoSlotHidden]}>
            <Feather name="map-pin" size={12} color={`${theme.onAccent}CC`} />
            <Text style={[styles.locationText, { color: `${theme.onAccent}CC` }]} numberOfLines={1}>
              {item.location ?? '\u00A0'}
            </Text>
         </View>
         <Text style={styles.caption} numberOfLines={2}>
           {item.caption}
            {item.caption.length > 86 && <Text style={[styles.moreText, { color: theme.onAccent }]}> more</Text>}
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
    commentsCount: post.commentsCount,
  };
}

function buildPreviewShopProduct(
  item: SpotlightItem,
  tag: { productId: string; productName: string; priceCents: number },
): BuyerProduct {
  const optionId = `${tag.productId}-size`;
  const sizes = ['XS', 'S', 'M', 'L'].map(label => ({
    id: `${optionId}-${label.toLowerCase()}`,
    label,
  }));
  return {
    id: tag.productId,
    sellerId: item.sellerId ?? `preview-seller-${item.id}`,
    sellerName: item.creator,
    sellerHandle: item.handle,
    name: tag.productName,
    description: item.caption.replace(/^Preview ·\s*/, ''),
    priceCents: tag.priceCents,
    imageUris: item.videoPosterUri ? [item.videoPosterUri] : [],
    category: 'High Fashion',
    isPreOrder: false,
    cancellationPolicy: 'Preview item — no real order will be placed.',
    refundPolicy: 'Preview item — no payment will be collected.',
    options: [{ id: optionId, name: 'Size', values: sizes }],
    variants: sizes.map((size, index) => ({
      id: `${tag.productId}-variant-${size.label.toLowerCase()}`,
      title: size.label,
      optionValues: [{ optionId, valueId: size.id }],
      priceCents: tag.priceCents,
      inventoryQuantity: 3 + index * 2,
      isAvailable: true,
      imageUri: item.videoPosterUri,
    })),
    isActive: true,
    tags: ['runway', 'preview', 'high-fashion'],
  };
}

// ShopProductSheet is now imported from @/components/ShopProductSheet

// ─── Screen ──────────────────────────────────────────────────────────────────
// buyerMode = false: standard seller/shared feed — no demand sentinel.
// buyerMode = true:  buyer feed — [DEMAND_PAGE_SENTINEL, ...contentItems].
//   Index 0 renders BuyerHighDemandPage; indices 1+ are regular SpotlightPage/LiveStreamPage items.
//   getItemLayout is uniform (length: SCREEN_H, offset: SCREEN_H * index) for all items.

export default function FeedScreen({
  buyerMode = false,
  showFashionPreview = false,
}: {
  buyerMode?: boolean;
  showFashionPreview?: boolean;
}) {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { push } = useThreadPull();
  const { showToast } = useFeedToast();

  const [engagements, setEngagements] = useState<Record<string, EngagementState>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifs, setShowNotifs] = useState(false);
  const [feedTab, setFeedTab] = useState<'following' | 'for-you'>('for-you');
  const [shopSelection, setShopSelection] = useState<ShopSheetSelection | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [hasUnread, setHasUnread] = useState(true);
  const [sellerFeedPosts, setSellerFeedPosts] = useState<SpotlightItem[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [activeLiveStreams, setActiveLiveStreams] = useState<LiveStreamFeedItem[]>([]);
  const api = useApi();
  const feedCursorRef = useRef(createThreadFeedCursor());
  const feedGenerationRef = useRef(0);
  const feedLoadKeyRef = useRef<string | null>(null);
  const feedLoadingMoreRef = useRef(false);
  const feedHasMoreRef = useRef(true);

  // Load published seller posts and subscribe to real-time changes
  const loadFeed = useCallback(async (initial = false) => {
    const loadKey = feedTab;
    if (feedLoadKeyRef.current === loadKey) return;
    feedLoadKeyRef.current = loadKey;
    const generation = feedGenerationRef.current + 1;
    feedGenerationRef.current = generation;
    const initialCursor = createThreadFeedCursor();
    feedCursorRef.current = initialCursor;
    feedHasMoreRef.current = true;
    setFeedHasMore(true);
    setFeedLoadingMore(false);
    if (initial) setFeedLoading(true);
    else setFeedRefreshing(true);
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
    } finally {
      if (feedLoadKeyRef.current === loadKey) feedLoadKeyRef.current = null;
      if (feedGenerationRef.current === generation) {
        if (initial) setFeedLoading(false);
        else setFeedRefreshing(false);
      }
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

  // Development buyer review prepends ten clearly labeled fashion previews.
  // Production and seller feeds remain real published seller posts only.
  // Live streams are woven in at roughly 1 per 10 regular posts (occasional, not dominant).
  const allItems = useMemo(() => {
    const previewPosts = __DEV__ && (buyerMode || showFashionPreview) && feedTab === 'for-you'
      ? FASHION_PREVIEW_POSTS
      : [];
    const regular: (SpotlightItem | LiveStreamFeedItem)[] = [...previewPosts, ...sellerFeedPosts];
    if (feedTab === 'following') return regular;
    if (!activeLiveStreams.length) return regular;
    // Weave live streams in: first at index 4, then every 10 after
    const result: (SpotlightItem | LiveStreamFeedItem)[] = [...regular];
    activeLiveStreams.slice(0, 3).forEach((liveItem, i) => {
      const insertAt = Math.min(4 + i * 10, result.length);
      result.splice(insertAt, 0, liveItem);
    });
    return result;
  }, [sellerFeedPosts, activeLiveStreams, buyerMode, feedTab, showFashionPreview]);

  // filteredContentItems: regular spotlight/live items after search filter
  const filteredContentItems = searchQuery.trim()
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

  // displayItems: sentinel at index 0 only when buyerMode=true.
  // Seller mode: if (!buyerMode) — sentinel never enters the array.
  // getItemLayout stays uniform (length: SCREEN_H, offset: SCREEN_H * index) for all items.
  const displayItems: FeedItem[] = useMemo(() => {
    if (!buyerMode) return filteredContentItems as FeedItem[];
    return [DEMAND_PAGE_SENTINEL, ...filteredContentItems] as FeedItem[];
  }, [buyerMode, filteredContentItems]);

  // buyerOffset: used to compute correct isActive for video playback when the
  // demand sentinel sits at index 0.
  const buyerOffset = buyerMode ? 1 : 0;

  function update(id: string, patch: Partial<EngagementState> | ((e: EngagementState) => Partial<EngagementState>)) {
    setEngagements(prev => {
      const cur = prev[id] ?? DEFAULT_ENGAGEMENT;
      const delta = typeof patch === 'function' ? patch(cur) : patch;
      return { ...prev, [id]: { ...cur, ...delta } };
    });
  }

  const handleLike = useCallback(async (id: string): Promise<void> => {
    const snapshot = engagements[id] ?? DEFAULT_ENGAGEMENT;
    const willLike = !snapshot.liked;
    // Optimistic update
    update(id, e => ({ liked: willLike, likes: willLike ? e.likes + 1 : Math.max(0, e.likes - 1) }));
    // Real post interaction — rollback on failure
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      try {
        const { api: _api } = require('@/lib/api');
        await _api.posts.interact(id, { type: 'like', value: willLike ? 'add' : 'remove' });
      } catch {
        // Rollback on failure
        update(id, () => ({ liked: snapshot.liked, likes: snapshot.likes }));
        showToast('Could not update like. Try again.', 'error');
      }
    }
  }, [engagements, showToast]);

  const handleDoubleTapLike = useCallback((id: string) => {
    setEngagements(prev => {
      const e = prev[id] ?? DEFAULT_ENGAGEMENT;
      if (e.liked) return prev;
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isUUID) {
        try { const { api: _api } = require('@/lib/api'); _api.posts.interact(id, { type: 'like' }).catch(() => {}); } catch {}
      }
      return { ...prev, [id]: { ...e, liked: true, likes: e.likes + 1 } };
    });
  }, []);

  const handleSave = useCallback(async (id: string): Promise<void> => {
    const cur = engagements[id] ?? DEFAULT_ENGAGEMENT;
    const willSave = !cur.saved;
    const snapshot = { saved: cur.saved, saves: cur.saves };
    // Optimistic update
    update(id, e => ({ saved: willSave, saves: willSave ? e.saves + 1 : Math.max(0, e.saves - 1) }));
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      try {
        const { api: _api } = require('@/lib/api');
        if (willSave) {
          await _api.saved.add({ targetId: id, targetType: 'post' });
        } else {
          await _api.saved.remove(id);
        }
      } catch {
        // Rollback
        update(id, () => ({ saved: snapshot.saved, saves: snapshot.saves }));
        showToast('Could not update save. Try again.', 'error');
      }
    }
  }, [engagements, showToast]);

  const handleRepost = useCallback(async (id: string): Promise<void> => {
    const snapshot = engagements[id] ?? DEFAULT_ENGAGEMENT;
    const willRepost = !snapshot.reposted;
    update(id, e => ({ reposted: willRepost, reposts: willRepost ? e.reposts + 1 : Math.max(0, e.reposts - 1) }));
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      try {
        const { api: _api } = require('@/lib/api');
        await _api.posts.interact(id, { type: 'repost' });
      } catch {
        // Rollback
        update(id, () => ({ reposted: snapshot.reposted, reposts: snapshot.reposts }));
        showToast('Could not repost. Try again.', 'error');
      }
    }
  }, [engagements, showToast]);

  const handleFollow = useCallback(async (id: string): Promise<void> => {
    const item = sellerFeedPosts.find(post => post.id === id);
    if (!item?.sellerId) return;
    const sellerId = item.sellerId;
    const wasFollowing = engagements[id]?.following ?? false;
    // Optimistic — flip all posts by this seller
    setEngagements(prev => Object.fromEntries(Object.entries(prev).map(([postId, state]) => [
      postId,
      sellerFeedPosts.find(post => post.id === postId)?.sellerId === sellerId
        ? { ...state, following: !wasFollowing }
        : state,
    ])));
    try {
      const state = await setSellerFollowing(sellerId, !wasFollowing);
      setEngagements(prev => Object.fromEntries(Object.entries(prev).map(([postId, engagement]) => [
        postId,
        sellerFeedPosts.find(post => post.id === postId)?.sellerId === sellerId
          ? { ...engagement, following: state.isFollowing }
          : engagement,
      ])));
      if (feedTab === 'following' && !state.isFollowing) void loadFeed();
    } catch {
      // Rollback
      setEngagements(prev => Object.fromEntries(Object.entries(prev).map(([postId, engagement]) => [
        postId,
        sellerFeedPosts.find(post => post.id === postId)?.sellerId === sellerId
          ? { ...engagement, following: wasFollowing }
          : engagement,
      ])));
      showToast('Could not update follow. Check your connection.', 'error');
    }
  }, [engagements, feedTab, loadFeed, sellerFeedPosts, showToast]);

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
    const tags = (item.productTags ?? []).length > 0
      ? (item.productTags as Array<{ productId: string; productName: string; priceCents: number }>)
      : item.productId
        ? [{ productId: item.productId, productName: item.productName, priceCents: 0, tagId: item.productId }]
        : [];
    if (tags.length === 0) return;
    setShopSelection({
      postId: item.id,
      postSellerId: item.sellerId,
      tags,
      activeTagIndex: 0,
      previewProduct: item.id.startsWith('preview-fashion-')
        ? buildPreviewShopProduct(item, tags[0])
        : undefined,
    });
  }

  function handleShopTag(item: SpotlightItem, tag: { productId: string; productName: string; priceCents: number }) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const allTags = (item.productTags ?? []).length > 0
      ? (item.productTags as Array<{ productId: string; productName: string; priceCents: number }>)
      : [tag];
    const tagIdx = allTags.findIndex(t => t.productId === tag.productId);
    setShopSelection({
      postId: item.id,
      postSellerId: item.sellerId,
      tags: allTags,
      activeTagIndex: Math.max(0, tagIdx),
      previewProduct: item.id.startsWith('preview-fashion-')
        ? buildPreviewShopProduct(item, tag)
        : undefined,
    });
  }

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setActiveIndex(viewableItems[0].index);
    }
  }).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  return (
    <FeedToastProvider>
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
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        snapToInterval={SCREEN_H}
        snapToAlignment="start"
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
              <Text style={styles.feedFooterText}>You're all caught up</Text>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => {
          // Buyer demand page — full-screen at index 0 in buyer mode
          if (isDemandPageItem(item as FeedItem)) {
            return <BuyerHighDemandPage />;
          }
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
          // Offset activeIndex comparison by buyerOffset so video playback is correct
          // when the demand sentinel occupies index 0.
          const contentIndex = index - buyerOffset;
          const activeContentIndex = activeIndex - buyerOffset;
          return (
            <SpotlightPage
              item={spotlight}
              isActive={contentIndex === activeContentIndex && !showNotifs}
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
              placeholder="Search creators, products..."
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
              <Text style={styles.notifRow}>NXGEN liked your comment on Ripstop Cargo Trousers</Text>
              <Text style={styles.notifRow}>Meridian Co. started following you</Text>
              <Text style={styles.notifRow}>@street.era replied to your comment</Text>
            </View>
          </View>
        </View>
      </Modal>
      {shopSelection && (
        <ShopProductSheet
          selection={shopSelection}
          onClose={() => setShopSelection(null)}
          onCartUpdated={(newCount) => setCartCount(newCount)}
        />
      )}

    </View>
    </FeedToastProvider>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SCREEN_BG },

  pauseOverlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  mediaPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#17131D' },
  heartBurst: { position: 'absolute', top: '38%', left: '50%', marginLeft: -55, marginTop: -55 },
  mediaDots: { position: 'absolute', top: '50%', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  mediaDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFFFFF80' },
  mediaDotActive: { width: 18, backgroundColor: '#FFFFFF' },
  mediaTags: { position: 'absolute', left: 16, right: 78 },
  mediaTag: {
    width: '100%', minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 11,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 14,
    paddingVertical: 9, paddingHorizontal: 10, backgroundColor: 'rgba(12,12,14,0.76)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.28,
    shadowRadius: 8, elevation: 7,
  },
  mediaTagIcon: {
    width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  mediaTagCopy: { flex: 1, minWidth: 0 },
  mediaTagName: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: 14, lineHeight: 19 },
  mediaTagMeta: { color: '#FFFFFFB8', fontFamily: FONT.medium, fontSize: 12, lineHeight: 17, marginTop: 1 },

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
  shareRailBtn: { alignItems: 'center', gap: 5 },
  shareRailIcon: {
    width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#FFFFFFCC',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 5, elevation: 5,
  },
  railCount: { fontSize: FS.xs, fontFamily: FONT.semibold, color: '#FFFFFF' },

  shopBtn: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 44, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 14, marginBottom: 2,
    backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#FFFFFFCC',
    shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  shopBtnText: { fontSize: FS.sm, fontFamily: FONT.bold, color: '#111111', letterSpacing: 0.1 },

  bottomInfo: {
    position: 'absolute', left: 16, right: 84, bottom: 26, height: 184,
    justifyContent: 'flex-end', gap: 8,
  },
  locationRow: { height: 16, flexDirection: 'row', alignItems: 'center', gap: 4 },
  infoSlotHidden: { opacity: 0 },
  locationText: { fontSize: FS.xs, fontFamily: FONT.medium, color: ON_DARK },
  caption: {
    height: 38, fontSize: 14, fontFamily: FONT.regular, color: '#FFFFFF',
    lineHeight: 19,
  },
  moreText: { fontFamily: FONT.semibold, color: ON_DARK },
  creatorRow: { height: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  creatorAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFFFFF' },
  creatorAvatarText: { fontSize: 10, fontFamily: FONT.bold, color: '#FFFFFF' },
  creatorName: { fontSize: FS.base, fontFamily: FONT.bold, color: '#FFFFFF' },
  soundRow: { height: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  feedFooter: {
    width: SCREEN_W, height: 72, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#000000',
  },
  feedFooterText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
});
