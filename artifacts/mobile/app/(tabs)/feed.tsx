import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TouchableWithoutFeedback,
  Animated, TextInput, Modal, Pressable, PanResponder,
  AccessibilityInfo, Platform, ScrollView, RefreshControl, ActivityIndicator, KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createThreadFeedCursor,
  getSellerFollowState,
  getThreadPostsPage,
  setSellerFollowing,
  subscribeSocial,
} from '@/services/socialService';
import type { SellerThreadPost } from '@/services/socialService';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
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
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM, GRID_MAX_WIDTH,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FeedSkeleton } from '@/components/BrandthreadUI';
import { EmptyState, ListSkeleton, ResponsiveContainer } from '@/components/layout';
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
import { FeedGestureGuide } from '@/components/FeedGestureGuide';
import { hasSeenFeedGestureGuide, markFeedGestureGuideSeen } from '@/lib/feedGestureGuideStorage';
import type { BuyerProduct } from '@/services/cartTypes';
import { getCart } from '@/services/cartService';
import {
  EngagementButton,
  FeedToastProvider,
  useFeedToast,
} from '@/components/EngagementButton';
import { formatCount } from '@/lib/engagementUtils';
import { ThreadShareSheet } from '@/components/ThreadShareSheet';
import { shouldAnimateCartSuccess } from '@/lib/cartFlight';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { BuyerNavIcon } from '@/components/buyer-nav/BuyerNavIcon';
import { SheetRise } from '@/components/motion/SheetRise';
import ActivityBellButton from '@/components/ActivityBellButton';
import { RADII } from '@/constants/radii';
import { TABULAR_NUMS } from '@/constants/typography';

const THREAD_PAGE_SIZE = 30;

// ─── Buyer demand page — sentinel and type guard ──────────────────────────────
// The sentinel is the first element in displayItems when buyerMode=true.
// It is never stored in the DB and is never passed through the regular feed
// pipeline. getItemLayout is uniform for all items, using the measured tab scene
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

function BuyerHighDemandPage({ pageWidth, pageHeight, bottomClearance = 100, topInset }: { pageWidth: number; pageHeight: number; bottomClearance?: number; topInset: number }) {
  const { theme } = useAppTheme();
  const { push } = useThreadPull();
  const api = useApi();

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

  // Clear the floating top overlay (Friends/Following/For You/Cart row) plus
  // breathing room, so the "High Demand" header never renders behind it.
  const topPad = topInset + 16;

  return (
    <View style={{ width: pageWidth, height: pageHeight, backgroundColor: BG }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: topPad, paddingBottom: bottomClearance }}
        showsVerticalScrollIndicator={false}
      >
        <ResponsiveContainer maxWidth={GRID_MAX_WIDTH}>
        <HighDemandSectionHead
          title="High Demand"
          subtitle="Products moving fast across the platform"
          style={{ marginBottom: 20 }}
        />

        {loading ? (
          <ListSkeleton rows={3} />
        ) : items.length === 0 ? (
          <EmptyState icon="trending-up" message="No high-demand products right now" />
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
        </ResponsiveContainer>
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
  repostedByMe?: boolean;
  friendReposts?: SellerThreadPost['friendReposts'];
  shares: number;
  saves: number;
  location?: string;
  // Optional fields present on real seller posts
  productId?: string;
  sellerId?: string;
  productTags?: { productId: string; productName: string; priceCents: number; imageUri?: string }[];
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

function LiveStreamPage({
  stream,
  onJoin,
  pageWidth,
  pageHeight,
  bottomClearance = 90,
}: {
  bottomClearance?: number;
  stream: LiveStreamFeedItem;
  onJoin: () => void;
  pageWidth: number;
  pageHeight: number;
}) {
  const { theme } = useAppTheme();
  const palette = theme as typeof theme & { background?: string; surface?: string; card?: string; border?: string; text?: string; muted?: string; subtle?: string; };
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
    <View style={{ width: pageWidth, height: pageHeight, backgroundColor: '#0a0209' }}>
      {/* Gradient background */}
      <View style={{ ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,80,100,0.18)' }} />
      {/* Centre glow */}
      <View style={{ position: 'absolute', top: pageHeight * 0.25, alignSelf: 'center', width: 280, height: 280, borderRadius: 140, backgroundColor: theme.accentDim }} />

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
          <Text style={{ color: theme.onAccent, fontFamily: FONT.bold, fontSize: 32 }}>
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
      <View style={{ position: 'absolute', bottom: bottomClearance, left: 16, right: 16 }}>
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
    reposted: item.repostedByMe === true, reposts: item.reposts,
    following: false,
    comments: item.comments,
  };
}

const DEFAULT_ENGAGEMENT: EngagementState = {
  liked: false, likes: 0, saved: false, saves: 0, reposted: false, reposts: 0, following: false, comments: [],
};

// formatCount is imported from @/components/EngagementButton

// ─── Full-screen media page ───────────────────────────────────────────────────

/** mm:ss (or h:mm:ss past an hour) for the scrub bubble. */
function formatPlaybackTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`;
}

/** Scrubbable playback bar: tap/drag to seek, thickens while dragging, shows
 * a time bubble, and gives haptic feedback on grab and release. */
function ScrubProgressBar({
  player, progress, bottom,
}: {
  player: ReturnType<typeof useVideoPlayer>;
  progress: number;
  bottom: number;
}) {
  const [dragging, setDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(progress);
  const [trackWidth, setTrackWidth] = useState(0);
  const thickness = useRef(new Animated.Value(2)).current;
  const trackWidthRef = useRef(0);

  useEffect(() => { trackWidthRef.current = trackWidth; }, [trackWidth]);
  useEffect(() => { if (!dragging) setDragProgress(progress); }, [progress, dragging]);

  const seekToLocationX = useRef((x: number) => {
    const width = trackWidthRef.current;
    if (width <= 0) return;
    const fraction = Math.min(1, Math.max(0, x / width));
    setDragProgress(fraction);
    const duration = player.duration;
    if (duration > 0) player.currentTime = fraction * duration;
  }).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setDragging(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.timing(thickness, { toValue: 6, duration: 120, useNativeDriver: false }).start();
        seekToLocationX(evt.nativeEvent.locationX);
      },
      onPanResponderMove: (evt) => {
        seekToLocationX(evt.nativeEvent.locationX);
      },
      onPanResponderRelease: () => {
        setDragging(false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        Animated.timing(thickness, { toValue: 2, duration: 150, useNativeDriver: false }).start();
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        Animated.timing(thickness, { toValue: 2, duration: 150, useNativeDriver: false }).start();
      },
    }),
  ).current;

  const shown = dragging ? dragProgress : progress;
  const bubbleLeft = trackWidth > 0 ? Math.min(Math.max(shown * trackWidth - 20, 0), Math.max(trackWidth - 40, 0)) : 0;

  return (
    <View
      style={[styles.progressHitArea, { bottom: bottom - 13 }]}
      onLayout={e => setTrackWidth(e.nativeEvent.layout.width)}
      {...panResponder.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel="Video progress"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
    >
      {dragging && (
        <View style={[styles.scrubBubble, { left: bubbleLeft }]} pointerEvents="none">
          <Text style={styles.scrubBubbleText}>{formatPlaybackTime(shown * (player.duration || 0))}</Text>
        </View>
      )}
      <Animated.View style={[styles.progressTrack, { height: thickness }]}>
        <View style={[styles.progressFill, { width: `${shown * 100}%` }]} />
      </Animated.View>
    </View>
  );
}

function VideoVisual({
  source,
  isActive,
  paused,
  muted = false,
  posterUri,
  posterSource,
  immersive = false,
  progressBottom,
  pageAspect = 9 / 16,
  rate = 1,
  pageWidth,
  pageHeight,
  bottomStripHeight = 0,
}: {
  source: VideoSource;
  isActive: boolean;
  paused: boolean;
  muted?: boolean;
  posterUri?: string;
  posterSource?: ImageSourcePropType;
  /** Buyer Home: portrait clips fill the screen edge to edge behind the bar. */
  immersive?: boolean;
  /** When set, a thin playback progress line sits this far above the bottom. */
  progressBottom?: number;
  /** Width / height of the page the clip is shown in. */
  pageAspect?: number;
  /** Playback rate — 2 while the right side of the video is pressed and held. */
  rate?: number;
  /** Page pixel size — needed to clip the sharp frame above the tab bar. */
  pageWidth?: number;
  pageHeight?: number;
  /**
   * Height of the floating-tab-bar zone at the bottom of an immersive page.
   * The sharp video stops above it; a separate blurred/darkened mirror of the
   * same clip fills that strip instead, so nothing sharp ever plays under
   * the bar and the bar's icons stay pin-sharp on top.
   */
  bottomStripHeight?: number;
}) {
  const player = useVideoPlayer(source, p => {
    p.loop = true;
    p.muted = muted;
    if (progressBottom != null) p.timeUpdateEventInterval = 0.25;
  });
  const [hasStarted, setHasStarted] = useState(false);
  // Fill the page when that crops little (a vertical clip on a phone or a
  // portrait iPad); otherwise letterbox so a vertical clip on a landscape
  // iPad, or a wide clip on a phone, is never cropped to a sliver.
  const [videoAspect, setVideoAspect] = useState(9 / 16);
  const [progress, setProgress] = useState(0);
  const showPoster = Boolean(posterSource || posterUri) && !hasStarted;
  const cropFraction = 1 - Math.min(videoAspect, pageAspect) / Math.max(videoAspect, pageAspect);
  const fit = immersive && cropFraction <= 0.3 ? 'cover' : 'contain';
  const posterImage = posterSource ?? (posterUri ? { uri: posterUri } : undefined);
  React.useEffect(() => {
    const subscription = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) setHasStarted(true);
    });
    const trackSubscription = player.addListener('videoTrackChange', ({ videoTrack }) => {
      const size = videoTrack?.size;
      if (size && size.width > 0 && size.height > 0) setVideoAspect(size.width / size.height);
    });
    return () => { subscription.remove(); trackSubscription.remove(); };
  }, [player]);
  React.useEffect(() => {
    if (progressBottom == null || !isActive) return undefined;
    const subscription = player.addListener('timeUpdate', ({ currentTime }) => {
      const duration = player.duration;
      setProgress(duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0);
    });
    return () => subscription.remove();
  }, [isActive, player, progressBottom]);
  React.useEffect(() => {
    if (isActive && !paused) player.play();
    else player.pause();
  }, [isActive, paused, player]);
  React.useEffect(() => {
    player.playbackRate = rate;
  }, [player, rate]);

  // The playable frame stops just above the floating tab bar instead of
  // playing sharp underneath it. A second mirror of the same player (cheap —
  // it shares the already-decoding video, no extra decode) shows only the
  // bottom slice of the same frame in that strip, blurred and darkened, so it
  // reads as a soft continuation rather than a hard cut or missing content.
  const showBottomStrip = immersive && fit === 'cover' && bottomStripHeight > 0 && pageWidth != null && pageHeight != null;
  const sharpClipStyle = showBottomStrip ? { bottom: bottomStripHeight, overflow: 'hidden' as const } : null;

  return (
    <>
      <View style={[StyleSheet.absoluteFill, sharpClipStyle]}>
        {immersive && fit === 'contain' && posterImage && (
          <CachedImage
            source={posterImage}
            style={[StyleSheet.absoluteFill, styles.letterboxBackdrop]}
            contentFit="cover"
            blurRadius={40}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        )}
        {showPoster && (
          <CachedImage
            source={posterSource ?? { uri: posterUri! }}
            style={StyleSheet.absoluteFill}
            contentFit={fit}
          />
        )}
        <VideoView
          player={player}
          // Explicit size: on web the style lands on a <video>, which ignores
          // inset-only sizing and would otherwise render at its intrinsic size.
          style={[StyleSheet.absoluteFill, styles.videoFill, showPoster && { opacity: 0 }]}
          contentFit={fit}
          nativeControls={false}
        />
        {paused && (
          <View style={styles.pauseOverlay}>
            <Feather name="play" size={56} color={`${ON_DARK}CC`} />
          </View>
        )}
      </View>
      {showBottomStrip && (
        <View pointerEvents="none" style={[styles.bottomBlurStrip, { height: bottomStripHeight }]}>
          <View style={{ position: 'absolute', left: 0, width: pageWidth!, height: pageHeight!, top: -(pageHeight! - bottomStripHeight) }}>
            <VideoView
              player={player}
              style={[StyleSheet.absoluteFill, styles.videoFill]}
              contentFit="cover"
              nativeControls={false}
            />
          </View>
          {/* iOS/web can sample the live video through a real blur; Android's
              blur can't sample video surfaces (see TabBarGlass), so it falls
              back to a denser dark tint instead of redrawing every frame. */}
          {Platform.OS !== 'android' && (
            <BlurView intensity={70} tint="dark" style={StyleSheet.absoluteFill} />
          )}
          <View
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: Platform.OS === 'android' ? 'rgba(0,0,0,0.82)' : 'rgba(0,0,0,0.38)' },
            ]}
          />
        </View>
      )}
      {progressBottom != null && isActive && (
        <ScrubProgressBar player={player} progress={progress} bottom={progressBottom} />
      )}
    </>
  );
}

function PhotoVisual({ uris, pageWidth, pageHeight, onPageChange }: { uris: string[]; pageWidth: number; pageHeight: number; onPageChange?: (index: number) => void }) {
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
      onMomentumScrollEnd={(e) => {
        if (!onPageChange || pageWidth <= 0) return;
        const index = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
        onPageChange(Math.max(0, Math.min(pages.length - 1, index)));
      }}
      renderItem={({ item: uri }) => (
        <View style={{ width: pageWidth, height: pageHeight }}>
          {uri ? <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" /> : (
            <View style={[StyleSheet.absoluteFill, styles.mediaPlaceholder]}>
              <Feather name="image" size={42} color="#FFFFFF99" />
            </View>
          )}
        </View>
      )}
      getItemLayout={(_, index) => ({ length: pageWidth, offset: pageWidth * index, index })}
    />
  );
}

// ─── Shop pill — compact glass trigger above the creator name ────────────────

function ShopPill({
  tag, extraCount, onPress,
}: {
  tag: SpotlightProductTag;
  extraCount: number;
  onPress: () => void;
}) {
  const shimmer = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1400),
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  return (
    <TouchableOpacity
      style={styles.shopPill}
      activeOpacity={0.82}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Shop ${tag.productName}, ${formatCents(tag.priceCents)}`}
    >
      <BlurView intensity={38} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.shopPillThumb}>
        {tag.imageUri ? (
          <CachedImage source={{ uri: tag.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <Feather name="shopping-bag" size={13} color="#111111" />
        )}
      </View>
      <Text style={styles.shopPillPrice} numberOfLines={1}>
        {formatCents(tag.priceCents)}{extraCount > 0 ? ` · +${extraCount}` : ''}
      </Text>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.shopPillShimmer,
          {
            opacity: shimmer.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 0.55, 0.55, 0] }),
            transform: [{ translateX: shimmer.interpolate({ inputRange: [0, 1], outputRange: [-90, 90] }) }],
          },
        ]}
      >
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

function SpotlightPage({
  item, isActive, pageWidth, pageHeight, bottomClearance, immersive = false, engagement, onLike, onDoubleTapLike, onSave, onRepost, onFollow, onOpenComments, onShopTag,
}: {
  item: SpotlightItem;
  isActive: boolean;
  pageWidth: number;
  pageHeight: number;
  bottomClearance: number;
  /** Buyer Home behind the floating tab bar. */
  immersive?: boolean;
  engagement: EngagementState | undefined;
  onLike: (id: string) => Promise<void>;
  onDoubleTapLike: (id: string) => void;
  onSave: (id: string) => Promise<void>;
  onRepost: (id: string) => Promise<void>;
  onFollow: (id: string) => Promise<void>;
  onOpenComments: (id: string) => void;
  onShopTag: (item: SpotlightItem, tag: SpotlightProductTag) => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { push } = useThreadPull();
  const [paused, setPaused] = useState(false);
  /** Which page of a multi-photo post is currently visible, for the pager dots. */
  const [photoPageIndex, setPhotoPageIndex] = useState(0);
  /** Pause while the buyer is holding down on the left/center of the video — distinct from the tap-to-toggle `paused` above, so releasing always resumes rather than fighting a manual pause. */
  const [holdPaused, setHoldPaused] = useState(false);
  /** 2x while holding the right side of the video. */
  const [speedActive, setSpeedActive] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const { showToast } = useFeedToast();
  const heartBurst = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  const speedPillOpacity = useRef(new Animated.Value(0)).current;
  const repostSpin = useRef(new Animated.Value(0)).current;
  const saveDrop = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTriggered = useRef(false);
  const friendReposts = item.friendReposts ?? [];
  const hasRepostIdentity = engagement?.reposted === true || friendReposts.length > 0;
  const repostLabel = engagement?.reposted
    ? friendReposts.length > 0
      ? `You and ${friendReposts[0].displayName} reposted`
      : 'You reposted'
    : friendReposts.length > 1
      ? `${friendReposts[0].displayName} and ${friendReposts.length - 1} friend${friendReposts.length === 2 ? '' : 's'} reposted`
      : `${friendReposts[0]?.displayName ?? 'A friend'} reposted`;

  React.useEffect(() => () => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    if (holdTimer.current) clearTimeout(holdTimer.current);
  }, []);

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

  /** Arrows spin/morph a full turn — repost toggled either way. */
  function spinRepost() {
    repostSpin.setValue(0);
    Animated.timing(repostSpin, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }

  /** Bookmark lifts then drops/settles — save toggled either way. */
  function dropSave() {
    saveDrop.setValue(0);
    Animated.timing(saveDrop, { toValue: 1, duration: 360, useNativeDriver: true }).start();
  }

  function handleQuickTap() {
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

  /** Press and hold the right ~40% of the video = 2x speed with a small
   * "2x" pill; holding anywhere else pauses. Releasing restores 1x / plays.
   * A quick tap (release before the hold threshold) falls through to the
   * existing single/double-tap handling above. */
  function handlePressIn(evt: { nativeEvent: { locationX: number } }) {
    holdTriggered.current = false;
    const x = evt.nativeEvent.locationX;
    holdTimer.current = setTimeout(() => {
      holdTriggered.current = true;
      // A tap already queued for "toggle pause" must not also fire once the hold resolves.
      if (pauseTimer.current) { clearTimeout(pauseTimer.current); pauseTimer.current = null; }
      lastTap.current = 0;
      if (x > pageWidth * 0.6) {
        setSpeedActive(true);
        Animated.timing(speedPillOpacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
      } else {
        setHoldPaused(true);
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, 250);
  }

  function handlePressOut() {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (holdTriggered.current) {
      holdTriggered.current = false;
      if (speedActive) {
        setSpeedActive(false);
        Animated.timing(speedPillOpacity, { toValue: 0, duration: 120, useNativeDriver: true }).start();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      if (holdPaused) setHoldPaused(false);
      return;
    }
    handleQuickTap();
  }

  return (
    <View style={{ width: pageWidth, height: pageHeight, backgroundColor: '#000' }}>
      <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut}>
        <View style={StyleSheet.absoluteFill}>
          {item.contentType === 'video'
            ? (
              <VideoVisual
                source={item.videoSource ?? item.mediaUris[0]}
                isActive={isActive}
                paused={paused || holdPaused}
                rate={speedActive ? 2 : 1}
                muted={item.videoSource != null}
                posterUri={item.videoPosterUri}
                posterSource={item.videoPosterSource}
                immersive={immersive}
                progressBottom={immersive ? bottomClearance - 10 : undefined}
                pageAspect={pageHeight > 0 ? pageWidth / pageHeight : undefined}
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                bottomStripHeight={immersive ? bottomClearance : 0}
              />
            )
            : <PhotoVisual uris={item.mediaUris} pageWidth={pageWidth} pageHeight={pageHeight} onPageChange={setPhotoPageIndex} />}
          {item.contentType !== 'video' && item.mediaUris.length > 1 && (
            <View style={styles.mediaDots} pointerEvents="none">
              {item.mediaUris.slice(0, 5).map((_, index) => <View key={index} style={[styles.mediaDot, index === photoPageIndex && styles.mediaDotActive]} />)}
            </View>
          )}
          <Animated.View
            pointerEvents="none"
            style={[styles.heartBurst, {
              opacity: heartBurst,
              transform: [{ scale: heartBurst.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.5] }) }],
            }]}
          >
            <Feather name="heart" size={110} color={ON_DARK} />
          </Animated.View>
          {item.contentType === 'video' && (
            <Animated.View
              pointerEvents="none"
              style={[styles.speedPill, { opacity: speedPillOpacity, transform: [{ scale: speedPillOpacity.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}
              accessibilityElementsHidden
              importantForAccessibility="no"
            >
              <Feather name="fast-forward" size={12} color={ON_DARK} />
              <Text style={styles.speedPillText}>2x</Text>
            </Animated.View>
          )}
        </View>
      </Pressable>

      {/* ─ Legibility scrims: header and bottom overlays stay readable over bright footage ─ */}
      {immersive && (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0.42)', 'rgba(0,0,0,0)']}
            style={[styles.topScrim, { height: insets.top + 120 }]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.62)']}
            locations={[0, 0.45, 1]}
            style={[styles.bottomScrim, { height: bottomClearance + 240 }]}
          />
        </>
      )}

      {/* ─ Shop pill — compact, sits above the creator name ─ */}
      {!!item.productTags?.length && (
        <View style={[styles.mediaTags, { bottom: bottomClearance + (hasRepostIdentity ? 148 : 112) }]} pointerEvents="box-none">
          <ShopPill
            tag={item.productTags[0]}
            extraCount={Math.max(0, item.productTags.length - 1)}
            onPress={() => onShopTag(item, item.productTags![0])}
          />
        </View>
      )}

      {/* ─ Right action rail ─ */}
      <View style={[styles.rail, { bottom: bottomClearance }]}>
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
          solidIcon="heart"
          iconSize={22}
          count={formatCount(engagement?.likes ?? 0)}
          active={engagement?.liked ?? false}
          activeColor="#EF4444"
          inactiveColor={ON_DARK}
          accessibilityLabel={`${engagement?.liked ? 'Unlike' : 'Like'}, ${formatCount(engagement?.likes ?? 0)} likes`}
          accessibilityState={{ checked: engagement?.liked ?? false }}
          scaleAnim={heartScale}
          style={styles.railActionContent}
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
          <FontAwesome name="commenting" size={21} color={ON_DARK} />
          <Text style={styles.railCount}>{formatCount(item.commentsCount ?? (engagement?.comments ?? []).length)}</Text>
        </TouchableOpacity>

        {/* Repost */}
        <EngagementButton
          icon="repeat"
          solidIcon="retweet"
          iconSize={22}
          count={formatCount(engagement?.reposts ?? 0)}
          active={engagement?.reposted ?? false}
          activeColor={theme.accent}
          inactiveColor={ON_DARK}
          accessibilityLabel={`${engagement?.reposted ? 'Undo repost' : 'Repost'}, ${formatCount(engagement?.reposts ?? 0)} reposts`}
          accessibilityState={{ checked: engagement?.reposted ?? false }}
          style={styles.railActionContent}
          rotateAnim={repostSpin}
          onPress={async () => {
            spinRepost();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            await onRepost(item.id);
          }}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          testID={`repost-btn-${item.id}`}
        />

        {/* Save */}
        <EngagementButton
          icon="bookmark"
          solidIcon="bookmark"
          iconSize={21}
          count={formatCount(engagement?.saves ?? item.saves)}
          active={engagement?.saved ?? false}
          activeColor={theme.accent}
          inactiveColor={ON_DARK}
          accessibilityLabel={`${engagement?.saved ? 'Unsave' : 'Save'}, ${formatCount(engagement?.saves ?? item.saves)} saves`}
          accessibilityState={{ checked: engagement?.saved ?? false }}
          style={styles.railActionContent}
          translateYAnim={saveDrop}
          onPress={async () => {
            dropSave();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            await onSave(item.id);
          }}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          testID={`save-btn-${item.id}`}
        />

        {/* Share */}
        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Share post"
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShareOpen(true);
          }}
        >
          <FontAwesome name="share" size={21} color={ON_DARK} />
          <Text style={styles.railCount}>{formatCount(item.shares)}</Text>
        </TouchableOpacity>

      </View>

      <ThreadShareSheet
        visible={shareOpen}
        postId={item.id}
        creator={item.creator}
        caption={item.caption}
        productName={item.productName}
        mediaUri={item.mediaUris[0]}
        isVideo={item.contentType === 'video'}
        onClose={() => setShareOpen(false)}
        onReport={() => router.push(`/buyer-report?targetType=post&targetId=${encodeURIComponent(item.id)}&targetLabel=Post` as never)}
        onNotInterested={() => showToast('We’ll show you fewer posts like this.', 'info')}
        onFeedback={showToast}
      />

      {/* ─ Bottom-left overlay: shop CTA, creator, caption, sound ─ */}
      <View style={[styles.bottomInfo, hasRepostIdentity && styles.bottomInfoWithRepost, { bottom: bottomClearance }]} pointerEvents="box-none">
        {hasRepostIdentity && (
          <TouchableOpacity
            style={styles.repostIdentity}
            activeOpacity={friendReposts.length > 0 ? 0.8 : 1}
            disabled={friendReposts.length === 0}
            onPress={() => {
              const friend = friendReposts[0];
              if (friend) router.push(('/buyer-other-profile?id=' + encodeURIComponent(friend.userId)) as never);
            }}
            accessibilityRole={friendReposts.length > 0 ? 'button' : 'text'}
            accessibilityLabel={repostLabel}
          >
            <View style={styles.repostAvatarStack}>
              {friendReposts.slice(0, 3).map((friend, index) => (
                <View
                  key={friend.userId}
                  style={[styles.repostAvatar, { marginLeft: index === 0 ? 0 : -7, zIndex: 3 - index }]}
                >
                  {friend.avatarUrl ? (
                    <CachedImage source={{ uri: friend.avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                  ) : (
                    <View style={[StyleSheet.absoluteFill, styles.repostAvatarFallback]}>
                      <Text style={styles.repostAvatarInitials}>
                        {friend.displayName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>
              ))}
              {friendReposts.length === 0 && (
                <View style={[styles.repostAvatar, styles.repostAvatarFallback]}>
                  <Feather name="user" size={13} color={ON_DARK} />
                </View>
              )}
            </View>
            <Text style={styles.repostIdentityText} numberOfLines={1}>{repostLabel}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push(('/seller-profile?id=' + encodeURIComponent(item.sellerId ?? item.id)) as never);
          }}
        >
          <View style={styles.creatorRow}>
            <Text style={styles.creatorName} numberOfLines={1}>{item.creator}</Text>
            {item.verified && <Feather name="check-circle" size={13} color="#4FA8FF" style={{ marginLeft: 4 }} />}
          </View>
        </TouchableOpacity>

         <Text style={styles.caption} numberOfLines={2}>
           {item.caption}
            {item.caption.length > 86 && <Text style={styles.moreText}> more</Text>}
         </Text>

        <View style={styles.soundRow}>
           <Feather name="music" size={12} color={`${ON_DARK}CC`} />
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
    videoSource: post.contentType === 'video' ? post.mediaUris[0] : undefined,
    videoPosterUri: post.thumbnailUri,
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
    repostedByMe: post.repostedByMe,
    friendReposts: post.friendReposts,
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
//   getItemLayout is uniform for all items and uses the measured tab scene.

export default function FeedScreen({
  buyerMode = false,
  showFashionPreview = false,
}: {
  buyerMode?: boolean;
  showFashionPreview?: boolean;
}) {
  const { theme } = useAppTheme();
  const palette = theme as typeof theme & { background?: string; surface?: string; card?: string; border?: string; text?: string; muted?: string; subtle?: string; };
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const insets = useSafeAreaInsets();
  const previewTopInset = Platform.OS === 'web' ? 67 : insets.top;
  const previewBottomInset = insets.bottom;
  const isBuyerSurface = buyerMode || showFashionPreview;
  // Height of the floating top overlay (Friends/Following/For You/Cart row):
  // topBar's own paddingTop + paddingBottom, plus the buyerTopRow's height.
  // Single source of truth so BuyerHighDemandPage's content never renders
  // underneath it (see styles.topBar / styles.buyerTopRow below).
  const buyerHeaderHeight = Math.max(0, previewTopInset - 4) + 44 + 4;
  const buyerBarInset = useBuyerTabBarInset();
  const router = useRouter();
  const { userId } = useAuth();
  const { push } = useThreadPull();
  const { showToast } = useFeedToast();

  const [engagements, setEngagements] = useState<Record<string, EngagementState>>({});
  const [showGestureGuide, setShowGestureGuide] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const pageWidth = viewportSize.width || windowWidth;
  const pageHeight = viewportSize.height || windowHeight;
  const viewportReady = viewportSize.width > 0 && viewportSize.height > 0;
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifs, setShowNotifs] = useState(false);
  const [showRepostEducation, setShowRepostEducation] = useState(false);
  const [feedTab, setFeedTab] = useState<'following' | 'for-you'>('for-you');
  const [shopSelection, setShopSelection] = useState<ShopSheetSelection | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
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
  const repostPendingRef = useRef(new Set<string>());
  const cartPulse = useRef(new Animated.Value(1)).current;
  const cartTargetRef = useRef<View>(null);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  // First-time gesture coach — buyer home only, shown once per account.
  useEffect(() => {
    if (!isBuyerSurface) return;
    let active = true;
    void hasSeenFeedGestureGuide(userId).then(seen => {
      if (active && !seen) setShowGestureGuide(true);
    });
    return () => { active = false; };
  }, [isBuyerSurface, userId]);

  const dismissGestureGuide = useCallback(() => {
    setShowGestureGuide(false);
    void markFeedGestureGuideSeen(userId);
  }, [userId]);

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

  useEffect(() => {
    let active = true;
    setCartCount(0);
    void getCart()
      .then(cart => {
        if (active) setCartCount(cart.items.reduce((total, item) => total + item.quantity, 0));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [userId]);

  const handleCartUpdated = useCallback((newCount: number) => {
    setCartCount(newCount);
    if (!shouldAnimateCartSuccess(reduceMotion)) return;
    cartPulse.setValue(0.78);
    Animated.sequence([
      Animated.spring(cartPulse, { toValue: 1.18, speed: 28, bounciness: 8, useNativeDriver: true }),
      Animated.spring(cartPulse, { toValue: 1, speed: 24, bounciness: 4, useNativeDriver: true }),
    ]).start();
  }, [cartPulse, reduceMotion]);

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
      sellerFeedPosts.forEach(item => {
        if (!next[item.id]) {
          next[item.id] = initialEngagement(item);
        } else if (!repostPendingRef.current.has(item.id)) {
          next[item.id] = {
            ...next[item.id],
            reposted: item.repostedByMe === true,
            reposts: item.reposts,
          };
        }
      });
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
  // getItemLayout stays uniform using the measured tab-scene height for all items.
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

  const showRepostEducationOnce = useCallback(async () => {
    const key = `bt:repost-education:${userId ?? 'preview'}:v1`;
    try {
      if (await AsyncStorage.getItem(key)) return;
      await AsyncStorage.setItem(key, 'true');
    } catch {
      // The education sheet is still useful if device storage is unavailable;
      // it may appear again on a later repost because persistence failed.
    }
    setShowRepostEducation(true);
  }, [userId]);

  const handleRepost = useCallback(async (id: string): Promise<void> => {
    if (repostPendingRef.current.has(id)) return;
    repostPendingRef.current.add(id);
    const snapshot = engagements[id] ?? DEFAULT_ENGAGEMENT;
    const willRepost = !snapshot.reposted;
    update(id, e => ({ reposted: willRepost, reposts: willRepost ? e.reposts + 1 : Math.max(0, e.reposts - 1) }));
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      try {
        const result = await api.posts.interact(id, {
          type: 'repost',
          value: willRepost ? undefined : 'remove',
        });
        if ((result.action === 'added') !== willRepost) {
          update(id, e => ({
            reposted: result.action === 'added',
            reposts: typeof result.count === 'number' ? result.count : e.reposts,
          }));
        }
        if (result.action === 'added') await showRepostEducationOnce();
      } catch {
        // Rollback
        update(id, () => ({ reposted: snapshot.reposted, reposts: snapshot.reposts }));
        showToast('Could not repost. Try again.', 'error');
      }
    } else if (willRepost) {
      await showRepostEducationOnce();
    }
    repostPendingRef.current.delete(id);
  }, [api, engagements, showRepostEducationOnce, showToast]);

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
    const videoSource = item.videoSource;
    const videoUri = item.contentType === 'video'
      ? (
        typeof videoSource === 'number'
          ? Asset.fromModule(videoSource).uri
          : typeof videoSource === 'string'
            ? videoSource
            : videoSource?.uri ?? item.mediaUris[0] ?? ''
      )
      : item.mediaUris[0] ?? '';
    const qs = [
      'postId=' + encodeURIComponent(item.id),
      'postAuthorId=' + encodeURIComponent(item.sellerId ?? ''),
      'postAuthorName=' + encodeURIComponent(item.creator),
      'postAuthorInitials=' + encodeURIComponent(item.initials),
      'postAuthorColor=' + encodeURIComponent(item.avatarColor),
      'postCaption=' + encodeURIComponent(item.caption),
      'postMediaUri=' + encodeURIComponent(videoUri),
      'postPosterUri=' + encodeURIComponent(item.videoPosterUri ?? ''),
      'postMediaColor1=' + encodeURIComponent('#0a0a0a'),
      'postMediaColor2=' + encodeURIComponent('#1a1a1a'),
      'postType=' + encodeURIComponent(item.contentType),
    ].join('&');
    router.push(('/buyer-post-comments?' + qs) as never);
  }

  function handleShopTag(item: SpotlightItem, tag: SpotlightProductTag) {
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
  // Buyer Home plays edge to edge behind the floating tab bar, so every
  // overlay (shop tag, caption, rail, progress) starts above the bar.
  const bottomClearance = isBuyerSurface
    ? buyerBarInset + 6
    : Math.max(previewBottomInset, 8) + 14;

  return (
    <FeedToastProvider>
    <View
      style={[styles.container, { backgroundColor: palette.background ?? BG }]}
      onLayout={({ nativeEvent }) => {
        const measuredWidth = Math.round(nativeEvent.layout.width);
        const measuredHeight = Math.round(nativeEvent.layout.height);
        if (
          measuredWidth > 0 &&
          measuredHeight > 0 &&
          (measuredWidth !== viewportSize.width || measuredHeight !== viewportSize.height)
        ) {
          setViewportSize({ width: measuredWidth, height: measuredHeight });
        }
      }}
    >
      {feedLoading && (
        <FeedSkeleton
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5 }}
        />
      )}
      {viewportReady && <FlatList
        key={`thread-${pageWidth}x${pageHeight}`}
        data={displayItems}
        keyExtractor={item => item.id}
        pagingEnabled
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={loadMoreFeed}
        onEndReachedThreshold={0.5}
        // Bounds how many video players ever exist at once: the active
        // page plus roughly the next/previous 2 stay mounted (poster-first,
        // so they start instantly the moment they become active) — the
        // rest are unmounted rather than left decoding off-screen.
        initialNumToRender={3}
        maxToRenderPerBatch={2}
        windowSize={5}
        removeClippedSubviews={Platform.OS !== 'web'}
        getItemLayout={(_, index) => ({ length: pageHeight, offset: pageHeight * index, index })}
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
            <View style={{ width: pageWidth, height: pageHeight, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Feather name="search" size={32} color={theme.muted} />
              <Text style={{ fontSize: FS.base, fontFamily: FONT.medium, color: theme.muted }}>
                No results for "{searchQuery}"
              </Text>
            </View>
          ) : !feedLoading ? (
            <View style={{ width: pageWidth, height: pageHeight, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 40 }}>
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
            return <BuyerHighDemandPage pageWidth={pageWidth} pageHeight={pageHeight} bottomClearance={bottomClearance} topInset={buyerHeaderHeight} />;
          }
          if ((item as any)._isLive) {
            const live = item as unknown as LiveStreamFeedItem;
            return (
              <LiveStreamPage
                stream={live}
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                bottomClearance={bottomClearance}
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
                pageWidth={pageWidth}
              pageHeight={pageHeight}
              bottomClearance={bottomClearance}
              immersive={isBuyerSurface}
              engagement={engagements[spotlight.id] ?? initialEngagement(spotlight)}
              onLike={handleLike}
              onDoubleTapLike={handleDoubleTapLike}
              onSave={handleSave}
              onRepost={handleRepost}
              onFollow={handleFollow}
              onOpenComments={handleOpenComments}
              onShopTag={handleShopTag}
            />
          );
        }}
      />}

      {/* ─ Top bar overlay ─ */}
      {isBuyerSurface ? (
        <View style={[styles.topBar, { paddingTop: Math.max(0, previewTopInset - 4) }]} pointerEvents="box-none">
          {/* Buyer Home: Friends · Following | For You · Cart. Search lives in the tab bar. */}
          <View style={styles.buyerTopRow}>
            <TouchableOpacity
              style={styles.buyerTopBtn}
              activeOpacity={0.7}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                router.navigate('/(buyer)/friends' as never);
              }}
              accessibilityRole="button"
              accessibilityLabel="Friends"
              testID="buyer-home-friends"
            >
              <BuyerNavIcon name="friends" color={ON_DARK} size={24} strokeWidth={1.9} />
            </TouchableOpacity>
            {/* Drops entry point — small, additive */}
            <TouchableOpacity
              style={styles.buyerTopBtn}
              activeOpacity={0.7}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                router.push('/buyer-drops' as never);
              }}
              accessibilityRole="button"
              accessibilityLabel="Drops"
              testID="buyer-home-drops"
            >
              <Feather name="zap" size={22} color={ON_DARK} />
            </TouchableOpacity>
            <View style={styles.buyerFeedTabs}>
                {([
                  ['following', 'Following'],
                  ['for-you', 'Threads'],
                ] as const).map(([key, label]) => (
                  <TouchableOpacity
                    key={key}
                    style={[styles.feedTab, styles.buyerFeedTab]}
                    onPress={() => {
                      setActiveIndex(0);
                      setFeedTab(key);
                    }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: feedTab === key }}
                  >
                    <Text style={[styles.feedTabText, styles.buyerFeedTabText, feedTab === key && styles.feedTabTextActive]}>{label}</Text>
                    {feedTab === key && <View style={[styles.feedTabUnderline, styles.buyerFeedTabUnderline, { backgroundColor: theme.accent }]} />}
                  </TouchableOpacity>
                ))}
            </View>
            <ActivityBellButton color={ON_DARK} size={22} style={styles.buyerTopBtn} badgeBorderColor={BG} />
            <Animated.View ref={cartTargetRef} style={[styles.buyerTopBtn, { transform: [{ scale: cartPulse }] }]}>
            <TouchableOpacity
              style={styles.buyerTopBtn}
              activeOpacity={0.7}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/(buyer)/cart' as never);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
            >
              <Feather name="shopping-cart" size={22} color={ON_DARK} />
              {cartCount > 0 && (
                <View style={[styles.cartCountBadge, styles.buyerCartBadge, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.cartCountText, { color: theme.onAccent }]}>
                    {cartCount > 99 ? '99+' : cartCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            </Animated.View>
          </View>
        </View>
      ) : (
      <View style={[styles.topBar, { paddingTop: previewTopInset + 2 }]} pointerEvents="box-none">
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
              onPress={() => { setHasUnread(false); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push('/buyer-notifications' as never); }}
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
                <Feather name="search" size={19} color={ON_DARK} />
            </TouchableOpacity>

            <Text style={styles.topTitle}>Home</Text>

            <ActivityBellButton color={ON_DARK} size={20} badgeBorderColor={BG} />

            <Animated.View ref={cartTargetRef} style={{ transform: [{ scale: cartPulse }] }}>
            <TouchableOpacity
              style={styles.cartHeaderBtn}
              activeOpacity={0.7}
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/(buyer)/cart' as never);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Open cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
            >
              <Feather name="shopping-cart" size={20} color={ON_DARK} />
              {cartCount > 0 && (
                <View style={[styles.cartCountBadge, { backgroundColor: theme.accent }]}>
                  <Text style={[styles.cartCountText, { color: theme.onAccent }]}>
                    {cartCount > 99 ? '99+' : cartCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
            </Animated.View>

          </View>
        )}
        {!showSearch && (
          <View style={styles.feedTabs}>
            {([
              ['following', 'Following'],
              ['for-you', 'Threads'],
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
      )}

      {/* Notifications now open the real /buyer-notifications screen instead of
          this hardcoded fake sheet — see the bell button's onPress above. */}
      <Modal
        visible={showRepostEducation}
        animationType="fade"
        transparent
        statusBarTranslucent
        onRequestClose={() => setShowRepostEducation(false)}
      >
        <View style={styles.repostEducationBackdrop}>
          <TouchableWithoutFeedback onPress={() => setShowRepostEducation(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <SheetRise style={[styles.repostEducationSheet, { paddingBottom: Math.max(previewBottomInset, 16) }]}>
            <TouchableOpacity
              style={styles.repostEducationClose}
              onPress={() => setShowRepostEducation(false)}
              accessibilityRole="button"
              accessibilityLabel="Close repost information"
            >
              <Feather name="x" size={24} color={FG} />
            </TouchableOpacity>
            <View style={styles.repostEducationPreview}>
              <View style={styles.repostEducationPreviewMedia}>
                <View style={styles.repostEducationPreviewBadge}>
                  <View style={styles.repostEducationPreviewAvatar}>
                    <Feather name="user" size={11} color="#FFFFFF" />
                  </View>
                  <Text style={styles.repostEducationPreviewBadgeText}>You reposted</Text>
                </View>
                <Feather name="more-horizontal" size={18} color="#FFFFFF99" style={styles.repostEducationPreviewMore} />
                <View style={styles.repostEducationPreviewLines}>
                  <View style={styles.repostEducationPreviewLineShort} />
                  <View style={styles.repostEducationPreviewLineLong} />
                </View>
                <Feather name="corner-up-right" size={30} color="#FFFFFF99" style={styles.repostEducationPreviewShare} />
              </View>
            </View>
            <Text style={styles.repostEducationTitle}>Introduce this post to others by reposting</Text>
            <View style={styles.repostEducationPoint}>
              <Feather name="users" size={22} color={FG} />
              <Text style={styles.repostEducationPointText}>Your repost can appear to friends in their Thread.</Text>
            </View>
            <View style={styles.repostEducationPoint}>
              <Feather name="repeat" size={22} color={FG} />
              <Text style={styles.repostEducationPointText}>Use the Repost button again at any time to remove it.</Text>
            </View>
            <View style={styles.repostEducationPrivacy}>
              <Feather name="lock" size={15} color={MUTED} />
              <Text style={styles.repostEducationPrivacyText}>
                Only mutual friends can see your profile on a repost.
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.repostEducationOkay, { backgroundColor: theme.accent }]}
              onPress={() => setShowRepostEducation(false)}
              accessibilityRole="button"
              accessibilityLabel="Got it"
            >
              <Text style={[styles.repostEducationOkayText, { color: theme.onAccent }]}>OK</Text>
            </TouchableOpacity>
          </SheetRise>
        </View>
      </Modal>
      {shopSelection && (
        <ShopProductSheet
          selection={shopSelection}
          onClose={() => setShopSelection(null)}
          onCartUpdated={handleCartUpdated}
          cartTargetRef={cartTargetRef}
          reduceMotion={reduceMotion}
        />
      )}

      {isBuyerSurface && (
        <FeedGestureGuide visible={showGestureGuide} onDismiss={dismissGestureGuide} />
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
  videoFill: { width: '100%', height: '100%' },
  letterboxBackdrop: { opacity: 0.55 },
  bottomBlurStrip: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  progressHitArea: {
    position: 'absolute', left: 16, right: 16, height: 28, justifyContent: 'center',
  },
  progressTrack: {
    borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.92)' },
  scrubBubble: {
    position: 'absolute', bottom: 22, minWidth: 40, alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(0,0,0,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  scrubBubbleText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 11, ...TABULAR_NUMS },
  speedPill: {
    position: 'absolute', top: '42%', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(0,0,0,0.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
  },
  speedPillText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 13 },
  mediaDot: { width: 5, height: 5, borderRadius: RADII.pill, backgroundColor: `${ON_DARK}80` },
  mediaDotActive: { width: 18, backgroundColor: ON_DARK },
  mediaTags: { position: 'absolute', left: 16, right: 86, alignItems: 'flex-start' },
  shopPill: {
    height: 34, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: RADII.pill, paddingLeft: 4, paddingRight: 12, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.24,
    shadowRadius: 6, elevation: 5,
  },
  shopPillThumb: {
    width: 26, height: 26, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ON_DARK, overflow: 'hidden',
  },
  shopPillPrice: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 12.5, ...TABULAR_NUMS },
  shopPillShimmer: { position: 'absolute', top: 0, bottom: 0, width: 40 },

  rail: {
    position: 'absolute', right: 8, width: 48, bottom: 116, alignItems: 'center', gap: 15,
  },
  railAvatarWrap: { alignItems: 'center', marginBottom: 2 },
  railAvatar: { width: 40, height: 40, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: ON_DARK },
  railAvatarText: { fontSize: FS.sm, fontFamily: FONT.bold, color: ON_DARK },
  railFollowBadge: {
    position: 'absolute', bottom: -8, width: 19, height: 19, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#000',
  },
  railBtn: { width: 48, alignItems: 'center', gap: 2 },
  railActionContent: { width: 48, alignItems: 'center', gap: 2 },
  railCount: { fontSize: 11, lineHeight: 13, fontFamily: FONT.bold, color: ON_DARK, ...TABULAR_NUMS },

  bottomInfo: {
    position: 'absolute', left: 16, right: 84, bottom: 26, height: 104,
    justifyContent: 'flex-end', gap: 8,
  },
  bottomInfoWithRepost: { height: 140 },
  repostIdentity: {
    alignSelf: 'flex-start', maxWidth: '100%', minHeight: 32,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(8,8,10,0.78)', borderRadius: 7,
    paddingHorizontal: 7, paddingVertical: 5,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  repostAvatarStack: { minWidth: 22, height: 22, flexDirection: 'row', alignItems: 'center' },
  repostAvatar: {
    width: 22, height: 22, borderRadius: RADII.pill, overflow: 'hidden',
    borderWidth: 1.5, borderColor: ON_DARK,
  },
  repostAvatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#35353A' },
  repostAvatarInitials: { color: ON_DARK, fontFamily: FONT.bold, fontSize: FS.xs },
  repostIdentityText: { color: ON_DARK, fontFamily: FONT.semibold, fontSize: 12, flexShrink: 1 },
  caption: {
    height: 38, fontSize: 14, fontFamily: FONT.regular, color: ON_DARK,
    lineHeight: 19,
  },
  moreText: { fontFamily: FONT.semibold, color: ON_DARK },
  creatorRow: { height: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  creatorName: { fontSize: FS.base, fontFamily: FONT.bold, color: ON_DARK, flexShrink: 1 },
  soundRow: { height: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  soundText: { fontSize: FS.xs, fontFamily: FONT.regular, color: `${ON_DARK}CC`, flexShrink: 1 },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, paddingBottom: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  buyerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  buyerTopBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  buyerFeedTabs: { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 18 },
  buyerCartBadge: { top: 5, right: 3 },
  buyerFeedTabUnderline: { position: 'absolute', bottom: 6, alignSelf: 'center' },
  buyerFeedTab: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  buyerFeedTabText: { fontSize: FS.base, textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 1 },
  topAvatarBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  topAvatar: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  unreadDot: { position: 'absolute', top: 4, right: 4, width: 9, height: 9, borderRadius: 4.5, backgroundColor: RED, borderWidth: 1.5, borderColor: BG },
  topIconBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  cartHeaderBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  cartCountBadge: {
    position: 'absolute', top: 1, right: -1, minWidth: 17, height: 17,
    borderRadius: RADII.pill, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: BG,
  },
  cartCountText: { fontSize: FS.xs, lineHeight: 12, fontFamily: FONT.bold, ...TABULAR_NUMS },
  topTitle: { flex: 1, textAlign: 'center', fontSize: FS.base, fontFamily: FONT.bold, color: '#FFFFFF' },
  feedTabs: { alignSelf: 'center', flexDirection: 'row', gap: 22, marginTop: 0, paddingBottom: 1 },
  feedTab: { paddingHorizontal: 4, paddingVertical: 3, alignItems: 'center' },
  feedTabText: { color: ON_DARK, opacity: 0.6, fontFamily: FONT.semibold, fontSize: FS.xs },
  feedTabTextActive: { color: ON_DARK, opacity: 1 },
  feedTabUnderline: { height: 2, width: 22, borderRadius: 2, marginTop: 3 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: {
    flex: 1, height: 40, borderRadius: 20, borderWidth: 1, borderColor: BORDER,
    backgroundColor: SURFACE, paddingHorizontal: 14, fontSize: FS.sm, fontFamily: FONT.regular, color: FG,
  },

  modalBackdrop: { flex: 1, backgroundColor: OVERLAY, justifyContent: 'flex-end' },
  repostEducationBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.56)', justifyContent: 'flex-end' },
  repostEducationSheet: {
    backgroundColor: CARD, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 24, paddingTop: 22,
    borderWidth: 1, borderBottomWidth: 0, borderColor: BORDER,
  },
  repostEducationClose: {
    position: 'absolute', top: 12, right: 12, zIndex: 2,
    width: 42, height: 42, alignItems: 'center', justifyContent: 'center',
  },
  repostEducationPreview: { alignItems: 'center', marginBottom: 20 },
  repostEducationPreviewMedia: {
    width: 220, height: 150, borderRadius: 18, backgroundColor: '#313136',
    overflow: 'hidden', padding: 14, justifyContent: 'flex-end',
  },
  repostEducationPreviewBadge: {
    position: 'absolute', left: 14, top: 54, flexDirection: 'row', alignItems: 'center',
    gap: 5, backgroundColor: '#FFFFFF', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 4,
  },
  repostEducationPreviewAvatar: {
    width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#8B8B91',
  },
  repostEducationPreviewBadgeText: { color: '#151517', fontFamily: FONT.semibold, fontSize: 11 },
  repostEducationPreviewMore: { position: 'absolute', right: 15, top: 52 },
  repostEducationPreviewLines: { gap: 7, marginRight: 52 },
  repostEducationPreviewLineShort: { height: 8, width: 68, borderRadius: 4, backgroundColor: '#FFFFFF24' },
  repostEducationPreviewLineLong: { height: 8, width: 130, borderRadius: 4, backgroundColor: '#FFFFFF24' },
  repostEducationPreviewShare: { position: 'absolute', right: 16, bottom: 19 },
  repostEducationTitle: {
    color: FG, fontFamily: FONT.bold, fontSize: 26, lineHeight: 32,
    textAlign: 'center', paddingHorizontal: 12, marginBottom: 22,
  },
  repostEducationPoint: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 6, marginBottom: 16,
  },
  repostEducationPointText: { flex: 1, color: FG, fontFamily: FONT.regular, fontSize: 15, lineHeight: 20 },
  repostEducationPrivacy: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 7, marginTop: 1, marginBottom: 18,
  },
  repostEducationPrivacyText: { color: MUTED, fontFamily: FONT.regular, fontSize: 12 },
  repostEducationOkay: {
    minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  repostEducationOkayText: { fontFamily: FONT.bold, fontSize: FS.base },
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
    width: '100%', height: 72, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#000000',
  },
  feedFooterText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
});
