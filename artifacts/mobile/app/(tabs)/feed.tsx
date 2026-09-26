import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TouchableWithoutFeedback,
  Animated, TextInput, Modal, Pressable, PanResponder,
  AccessibilityInfo, Platform, ScrollView, RefreshControl, ActivityIndicator, KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { useRouter, useIsFocused } from 'expo-router';
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
import { hapticLight, hapticSelection } from '@/lib/haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { Asset } from 'expo-asset';
import { Image as ExpoImage } from 'expo-image';
import {
  enqueueEngagementRetry, isRetryableFailure, setEngagementRetryExecutor, startEngagementRetryQueuePump,
} from '@/lib/engagementRetryQueue';
import { computeJustDroppedDrops, type FollowedDrop } from '@/lib/justDroppedDrops';
import type { ViewToken } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { useApi } from '@/lib/api';
import {
  BG, SCREEN_BG, SURFACE, CARD, OVERLAY,
  BORDER, BORDER_SUBTLE,
  FG, MUTED, SUBTLE, ON_DARK,
  SUCCESS, RED, GOLD,
  FONT, FS, SP, RADIUS, COMP, ICON, ANIM, GRID_MAX_WIDTH,
} from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PressableScale } from '@/components/BrandthreadUI';
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
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { hasSeenFeedGestureGuide, markFeedGestureGuideSeen } from '@/lib/feedGestureGuideStorage';
import { getCachedFeedPosts, hydrateFeedPostsCache, setCachedFeedPosts } from '@/lib/feedPostsCache';
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
import { getVideoFeedPage, loadVideoFeedThrough } from '@/services/profileService';
import { profileHref, type VideoFeedSource } from '@/lib/profileNavigation';

/**
 * Scopes the feed player to one creator's videos (profile grid tap) or to the
 * videos that feature one product (product detail "Featured in"), opened at
 * `startPostId`. Same pages, rail, comments, share and shop sheet as the main
 * feed — only the data source and the chrome differ.
 */
export interface CreatorFeedConfig {
  source: VideoFeedSource;
  id: string;
  startPostId?: string;
  title?: string;
}

const THREAD_PAGE_SIZE = 30;

// Vertical rhythm in the bottom chrome zone, measured from TikTok: the
// scrub/progress bar sits just above the tab bar (at `bottomClearance`,
// 0-4pt of gap to the bar), so the right rail's last item (share) and the
// caption block's last line (the sound row) both need extra clearance above
// that same `bottomClearance` anchor, or they end up touching/overlapping
// the bar — which is exactly what a bare `bottom: bottomClearance` on both
// of them used to do. These two constants are that clearance:
//   - RAIL_BOTTOM_GAP: >=16pt from the rail's last item to the bar's top.
//   - CAPTION_BOTTOM_GAP: >=12pt from the sound line to the bar's top.
const RAIL_BOTTOM_GAP = 22;
// How many times a feed's content repeats (under unique keys) once it has
// no more real pages behind it, so scrolling never dead-ends or shows an
// end card — see the `canLoopFeed`/`displayItems` comment below.
const FEED_LOOP_REPEAT = 6;
const CAPTION_BOTTOM_GAP = 18;

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
  likedByMe?: boolean;
  comments: { id: string; user: string; text: string }[];
  reposts: number;
  repostedByMe?: boolean;
  friendReposts?: SellerThreadPost['friendReposts'];
  shares: number;
  saves: number;
  savedByMe?: boolean;
  location?: string;
  // Optional fields present on real seller posts
  productId?: string;
  sellerId?: string;
  /** Who posted it — decides which profile the avatar/name opens. Feed posts default to seller. */
  authorAccountType?: 'seller' | 'buyer';
  productTags?: { productId: string; productName: string; priceCents: number; imageUri?: string }[];
  /** Authoritative comment count from the server (preferred over local comments array length) */
  commentsCount?: number;
}
type SpotlightProductTag = NonNullable<SpotlightItem['productTags']>[number];

const SOUND_PREF_KEY = 'bt:feed-sound-on:v1';

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
    likes: 0,
    comments: [],
    reposts: 0,
    shares: 0,
    saves: 0,
    location: 'Paris, France',
    productId: 'preview-product-01',
    sellerId: 'preview-seller-01',
    productTags: [{ productId: 'preview-product-01', productName: 'Sculpted Wool Coat', priceCents: 48000 }],
    commentsCount: 0,
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
    likes: 0,
    comments: [],
    reposts: 0,
    shares: 0,
    saves: 0,
    location: 'Milan, Italy',
    productId: 'preview-product-02',
    sellerId: 'preview-seller-02',
    productTags: [{ productId: 'preview-product-02', productName: 'Liquid Silver Dress', priceCents: 32500 }],
    commentsCount: 0,
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
    likes: 0,
    comments: [],
    reposts: 0,
    shares: 0,
    saves: 0,
    location: 'New York, NY',
    productId: 'preview-product-03',
    sellerId: 'preview-seller-03',
    productTags: [{ productId: 'preview-product-03', productName: 'Oversized Tuxedo', priceCents: 56000 }],
    commentsCount: 0,
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
    likes: 0,
    comments: [],
    reposts: 0,
    shares: 0,
    saves: 0,
    location: 'London, UK',
    productId: 'preview-product-04',
    sellerId: 'preview-seller-04',
    productTags: [{ productId: 'preview-product-04', productName: 'Ivory Column Set', priceCents: 41000 }],
    commentsCount: 0,
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
    likes: 0,
    comments: [],
    reposts: 0,
    shares: 0,
    saves: 0,
    location: 'Tokyo, Japan',
    productId: 'preview-product-05',
    sellerId: 'preview-seller-05',
    productTags: [{ productId: 'preview-product-05', productName: 'Asymmetric Layer Jacket', priceCents: 29500 }],
    commentsCount: 0,
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
    likes: 0,
    comments: [],
    reposts: 0,
    shares: 0,
    saves: 0,
    location: 'Berlin, Germany',
    productId: 'preview-product-06',
    sellerId: 'preview-seller-06',
    productTags: [{ productId: 'preview-product-06', productName: 'Draped Hardware Gown', priceCents: 37500 }],
    commentsCount: 0,
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
    likes: 0,
    comments: [],
    reposts: 0,
    shares: 0,
    saves: 0,
    location: 'Los Angeles, CA',
    productId: 'preview-product-07',
    sellerId: 'preview-seller-07',
    productTags: [{ productId: 'preview-product-07', productName: 'Crystal Mesh Top', priceCents: 24500 }],
    commentsCount: 0,
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
    likes: 0,
    comments: [],
    reposts: 0,
    shares: 0,
    saves: 0,
    location: 'Copenhagen, Denmark',
    productId: 'preview-product-08',
    sellerId: 'preview-seller-08',
    productTags: [{ productId: 'preview-product-08', productName: 'Reconstructed Trench', priceCents: 52000 }],
    commentsCount: 0,
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
    likes: 0,
    comments: [],
    reposts: 0,
    shares: 0,
    saves: 0,
    location: 'Seoul, South Korea',
    productId: 'preview-product-09',
    sellerId: 'preview-seller-09',
    productTags: [{ productId: 'preview-product-09', productName: 'Satin Power Suit', priceCents: 44500 }],
    commentsCount: 0,
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
    likes: 0,
    comments: [],
    reposts: 0,
    shares: 0,
    saves: 0,
    location: 'Paris, France',
    productId: 'preview-product-10',
    sellerId: 'preview-seller-10',
    productTags: [{ productId: 'preview-product-10', productName: 'Sculpted Silk Gown', priceCents: 69000 }],
    commentsCount: 0,
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

// ─── "Just dropped from brands you follow" rail ───────────────────────────────
interface JustDroppedRailItem {
  _isJustDropped: true;
  id: string;
  drops: FollowedDrop[];
}
function isJustDroppedItem(item: unknown): item is JustDroppedRailItem {
  return !!item && typeof item === 'object' && (item as JustDroppedRailItem)._isJustDropped === true;
}

// Union of all possible displayable items in the FlatList
type FeedItem = SpotlightItem | LiveStreamFeedItem | BuyerDemandPageItem | JustDroppedRailItem;

function JustDroppedRailPage({
  drops, pageWidth, pageHeight, bottomClearance, onOpenDrop, onSeeAll,
}: {
  drops: FollowedDrop[];
  pageWidth: number;
  pageHeight: number;
  bottomClearance: number;
  onOpenDrop: (drop: FollowedDrop) => void;
  onSeeAll: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={{ width: pageWidth, height: pageHeight, backgroundColor: theme.background, justifyContent: 'center' }}>
      <View style={{ paddingHorizontal: SP.md, marginBottom: SP.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text }}>Just dropped</Text>
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 }}>From brands you follow</Text>
        </View>
        <PressableScale onPress={onSeeAll} accessibilityRole="button" accessibilityLabel="See all drops from brands you follow">
          <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.accent }}>See all</Text>
        </PressableScale>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SP.md, gap: SP.sm }}>
        {drops.map(drop => (
          <PressableScale
            key={drop.id}
            onPress={() => onOpenDrop(drop)}
            style={{ width: 160 }}
            accessibilityRole="button"
            accessibilityLabel={`${drop.name} by ${drop.sellerName}`}
          >
            <View style={{ width: 160, height: 200, borderRadius: RADIUS.lg, overflow: 'hidden', backgroundColor: theme.cardElevated }}>
              {drop.heroImageUrl ? (
                <CachedImage source={{ uri: drop.heroImageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
                  <Feather name="zap" size={28} color={theme.muted} />
                </View>
              )}
              <View style={{ position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 10, fontFamily: FONT.bold, color: '#fff' }}>
                  {drop.releaseAt && new Date(drop.releaseAt).getTime() > Date.now() ? 'SOON' : 'LIVE'}
                </Text>
              </View>
            </View>
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text, marginTop: 6 }} numberOfLines={1}>{drop.name}</Text>
            <Text style={{ fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted }} numberOfLines={1}>{drop.sellerName}</Text>
          </PressableScale>
        ))}
      </ScrollView>
      <Text style={{ position: 'absolute', bottom: bottomClearance + 16, left: 0, right: 0, textAlign: 'center', fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted }}>
        Swipe to keep browsing
      </Text>
    </View>
  );
}

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
    liked: item.likedByMe === true, likes: item.likes,
    saved: item.savedByMe === true, saves: item.saves,
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

/** Scrubbable playback bar — sits exactly on the seam where the sharp video
 * stops and the blurred tab-bar strip begins (Reels-style: a thin line right
 * above the bar, not floating inside either region).
 *
 * Real scrubbing, not a passive indicator: drag anywhere on the hit area to
 * seek live; the video pauses for the duration of the drag (so it doesn't
 * fight the seek) and resumes automatically on release, unless the post was
 * already manually paused (tap-to-pause elsewhere on the video is untouched
 * — this component only ever touches the player directly, never the parent's
 * `paused`/`holdPaused` state). While dragging: the line thickens, a round
 * thumb appears on it, a "current / total" time bubble tracks the thumb, and
 * a light haptic "tick" fires every ~3% of the scrub so long drags feel
 * textured rather than silent. */
function ScrubProgressBar({
  player, progress, bottom, externallyPaused = false,
}: {
  player: ReturnType<typeof useVideoPlayer>;
  progress: number;
  bottom: number;
  /** True while the post is deliberately paused (tap or hold) — on release,
   * the scrubber leaves it paused instead of resuming playback. */
  externallyPaused?: boolean;
}) {
  const { theme } = useAppTheme();
  const [dragging, setDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(progress);
  const [trackWidth, setTrackWidth] = useState(0);
  const thickness = useRef(new Animated.Value(3)).current;
  const thumbScale = useRef(new Animated.Value(0)).current;
  const trackWidthRef = useRef(0);
  const lastTickFraction = useRef(0);

  useEffect(() => { trackWidthRef.current = trackWidth; }, [trackWidth]);
  useEffect(() => { if (!dragging) setDragProgress(progress); }, [progress, dragging]);

  const seekToLocationX = useRef((x: number) => {
    const width = trackWidthRef.current;
    if (width <= 0) return;
    const fraction = Math.min(1, Math.max(0, x / width));
    setDragProgress(fraction);
    const duration = player.duration;
    if (duration > 0) player.currentTime = fraction * duration;
    if (Math.abs(fraction - lastTickFraction.current) >= 0.03) {
      lastTickFraction.current = fraction;
      hapticSelection();
    }
  }).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        setDragging(true);
        lastTickFraction.current = progress;
        hapticLight();
        player.pause();
        Animated.parallel([
          Animated.timing(thickness, { toValue: 7, duration: 120, useNativeDriver: false }),
          Animated.spring(thumbScale, { toValue: 1, useNativeDriver: true, speed: 30 }),
        ]).start();
        seekToLocationX(evt.nativeEvent.locationX);
      },
      onPanResponderMove: (evt) => {
        seekToLocationX(evt.nativeEvent.locationX);
      },
      onPanResponderRelease: () => {
        setDragging(false);
        hapticLight();
        Animated.parallel([
          Animated.timing(thickness, { toValue: 3, duration: 150, useNativeDriver: false }),
          Animated.timing(thumbScale, { toValue: 0, duration: 120, useNativeDriver: true }),
        ]).start();
        if (!externallyPaused) player.play();
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        Animated.parallel([
          Animated.timing(thickness, { toValue: 3, duration: 150, useNativeDriver: false }),
          Animated.timing(thumbScale, { toValue: 0, duration: 120, useNativeDriver: true }),
        ]).start();
        if (!externallyPaused) player.play();
      },
    }),
  ).current;

  const shown = dragging ? dragProgress : progress;
  const thumbLeft = trackWidth > 0 ? shown * trackWidth : 0;
  const duration = player.duration || 0;
  const bubbleLeft = trackWidth > 0 ? Math.min(Math.max(thumbLeft - 34, 0), Math.max(trackWidth - 68, 0)) : 0;

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
          <Text style={styles.scrubBubbleText}>
            {formatPlaybackTime(shown * duration)} / {formatPlaybackTime(duration)}
          </Text>
        </View>
      )}
      <Animated.View style={[styles.progressTrack, { height: thickness }]}>
        <View style={[styles.progressFill, { width: `${shown * 100}%` }]}>
          <LinearGradient
            colors={[theme.accentLight ?? theme.accent, theme.accent]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </View>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.scrubThumb,
          {
            left: thumbLeft,
            backgroundColor: theme.accentLight ?? theme.accent,
            opacity: thumbScale,
            transform: [{ scale: thumbScale }],
          },
        ]}
      />
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
  fallbackColor,
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
  /** Solid cover shown pre-decode when there's no poster image at all — a
   * black frame before the first decoded frame paints is otherwise visible
   * for any clip whose post has no thumbnail. */
  fallbackColor?: string;
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
  const showFallbackCover = !showPoster && !hasStarted;
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
  const isScreenFocused = useIsFocused();
  React.useEffect(() => {
    // isFocused is required (not just isActive) so navigating to a modal on
    // top of the feed (e.g. the comments sheet) pauses this clip, and — the
    // real fix here — coming back explicitly re-issues play() rather than
    // relying on isActive alone, which never changes across that round trip
    // and left the last decoded frame frozen/gray on web until some other
    // state change happened to re-run this effect.
    //
    // pageWidth/pageHeight are also dependencies: on web, this cell can
    // mount (and this effect can first run) before the FlatList/parent has
    // measured a non-zero size for it, which — combined with the container-
    // sizing bug above — used to leave the player permanently paused with
    // nothing ever re-triggering play() once a real size arrived. Re-running
    // this effect when the page's measured size changes closes that gap.
    if (isActive && !paused && isScreenFocused && (pageWidth ?? 0) > 0 && (pageHeight ?? 0) > 0) {
      player.play();
    } else {
      player.pause();
    }
  }, [isActive, paused, isScreenFocused, player, pageWidth, pageHeight]);
  React.useEffect(() => {
    player.playbackRate = rate;
  }, [player, rate]);

  // The video now always plays full-bleed, edge to edge, including behind
  // the floating tab bar — a separate blurred "mirror" copy of the clip used
  // to sit in a strip behind the bar instead, but on web the blur can't
  // reliably sample the live <video> element and the mirror's own offset
  // math didn't line up with the real frame there, so it showed as a washed-
  // out, mis-aligned lighter band across the bottom of the video instead of
  // a clean continuation of it. A plain dark gradient (rendered once, fixed,
  // above the whole feed list — see the "Legibility scrims" block in
  // FeedScreen) gives the bar the same contrast without duplicating any
  // video content.
  void bottomStripHeight;
  const sharpClipStyle = null;

  // Explicit size on the sharp-clip wrapper itself rather than trusting it
  // to inherit height from an ancestor: on web, absoluteFill inside a
  // virtualized FlatList cell can resolve against an ancestor whose own
  // height collapsed to 0 (flex/auto sizing there doesn't behave like
  // native), which silently zeroed the entire video area while the
  // separately explicit-sized blurred mirror strip kept rendering fine —
  // exactly the all-black-with-nothing-playing symptom this was causing.
  const clipSize = pageWidth != null && pageHeight != null ? { width: pageWidth, height: pageHeight } : null;

  return (
    <>
      <View style={[StyleSheet.absoluteFill, clipSize, sharpClipStyle]}>
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
        {showFallbackCover && (
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: fallbackColor ?? '#0a0a0a' }]}
            pointerEvents="none"
          />
        )}
        <VideoView
          player={player}
          // Explicit size: on web the style lands on a <video>, which ignores
          // inset-only sizing and would otherwise render at its intrinsic size.
          style={[StyleSheet.absoluteFill, styles.videoFill, (showPoster || showFallbackCover) && { opacity: 0 }]}
          contentFit={fit}
          nativeControls={false}
        />
        {paused && (
          <View style={styles.pauseOverlay}>
            <Feather name="play" size={56} color={`${ON_DARK}CC`} />
          </View>
        )}
      </View>
      {progressBottom != null && isActive && (
        <ScrubProgressBar player={player} progress={progress} bottom={progressBottom} externallyPaused={paused} />
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

// ─── Shop side tab — a collapsed tab flush against the left screen edge ─────
// (the right edge is the action rail) that glides out into a full card on
// tap, rather than an always-visible price pill sitting over the video.
// Fully solid/flat (no BlurView/backdrop-filter, no shimmer): the earlier
// pill's frosted-glass background re-sampled the moving video behind it
// every frame during a swipe, which read as a shimmer/glitch — this has no
// live-sampling background at all, only a fixed solid fill. Collapsed by
// default with zero mount/entrance animation (only a user tap ever starts
// the expand/collapse spring), and force-collapses (no animation skipped —
// this one transition is allowed since it's a direct response to the cell
// leaving, matching "collapses back on swiping to the next video" in spec)
// when the cell stops being active, so it never carries an expanded state
// into a swipe.
const SHOP_TAB_COLLAPSE_MS = 4000;

function ShopSideTab({
  tag, extraCount, onPress, isActive,
}: {
  tag: SpotlightProductTag;
  extraCount: number;
  onPress: () => void;
  isActive: boolean;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }
  }, []);

  const collapse = useCallback(() => {
    clearCollapseTimer();
    setExpanded(false);
    Animated.spring(anim, { toValue: 0, useNativeDriver: false, speed: 18, bounciness: 0 }).start();
  }, [anim, clearCollapseTimer]);

  const expand = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded(true);
    Animated.spring(anim, { toValue: 1, useNativeDriver: false, speed: 18, bounciness: 0 }).start();
    clearCollapseTimer();
    collapseTimer.current = setTimeout(collapse, SHOP_TAB_COLLAPSE_MS);
  }, [anim, clearCollapseTimer, collapse]);

  useEffect(() => {
    if (!isActive) collapse();
    // Only reacting to the cell becoming inactive — becoming active must
    // never itself start an animation (see the module comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => () => clearCollapseTimer(), [clearCollapseTimer]);

  // A sleek, narrow strip when expanded — max ~62% of screen width, not a
  // big card — sized off the live window width so it holds at 375/390/430.
  const expandedWidth = Math.round(windowWidth * 0.62);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: [28, expandedWidth] });
  const collapsedOpacity = anim.interpolate({ inputRange: [0, 0.2, 1], outputRange: [1, 0, 0] });
  const expandedOpacity = anim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] });
  const expandedTranslate = anim.interpolate({ inputRange: [0, 0.55, 1], outputRange: [8, 8, 0] });

  return (
    <>
      {/* Tapping anywhere else on the video collapses the expanded card —
          rendered only while expanded, behind the tab itself in z-order. */}
      {expanded && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={collapse}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
      <Animated.View
        style={[styles.shopSideTab, { width }]}
        accessibilityRole="button"
        accessibilityLabel={
          expanded
            ? `Shop ${tag.productName}, ${formatCents(tag.priceCents)}`
            : 'Shop this video'
        }
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={0.85}
          onPress={expanded ? onPress : expand}
        >
          <Animated.View
            pointerEvents={expanded ? 'none' : 'auto'}
            style={[styles.shopSideTabCollapsed, { opacity: collapsedOpacity }]}
          >
            {/* Icon + label are laid out and rotated together as ONE unit,
                not rotated separately: rotating only the Text keeps its
                pre-rotation (unrotated) box for layout purposes, so
                anything positioned relative to that stale box — like the
                icon above it in a flex column — lands using the wrong
                effective width/height once the text is actually rotated,
                which is what put the bag icon on top of the "P". Laid out
                here as a plain horizontal row (label, then icon) and
                rotated as a whole: a -90deg turn maps "left" to the
                bottom and "right" to the top, so the label (left) reads
                bottom-to-top exactly as before and the icon (right) ends
                up above it, with real layout-computed spacing between
                them instead of a stale gap. */}
            <View style={styles.shopSideTabCollapsedStack}>
              <Text style={styles.shopSideTabLabel}>SHOP</Text>
              <Feather name="shopping-bag" size={11} color={ON_DARK} />
            </View>
          </Animated.View>
          <Animated.View
            pointerEvents={expanded ? 'auto' : 'none'}
            style={[
              styles.shopSideTabExpanded,
              { opacity: expandedOpacity, transform: [{ translateX: expandedTranslate }] },
            ]}
          >
            <View style={styles.shopSideTabThumb}>
              {tag.imageUri ? (
                <CachedImage source={{ uri: tag.imageUri }} style={StyleSheet.absoluteFill} contentFit="cover" />
              ) : (
                <Feather name="shopping-bag" size={11} color="#111111" />
              )}
            </View>
            {/* Name and price share one line so the whole card reads as a
                sleek, narrow strip at ~44pt tall rather than a two-line
                card — the name truncates first (flexShrink), the price
                never does (flexShrink: 0, its own Text so numberOfLines on
                the name can't cut it off too). */}
            <Text style={styles.shopSideTabName} numberOfLines={1}>{tag.productName}</Text>
            <Text style={styles.shopSideTabPrice} numberOfLines={1}>
              {formatCents(tag.priceCents)}{extraCount > 0 ? ` +${extraCount}` : ''}
            </Text>
            <Feather name="chevron-right" size={12} color="rgba(255,255,255,0.75)" />
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>
    </>
  );
}

function SpotlightPage({
  item, isActive, pageWidth, pageHeight, bottomClearance, immersive: immersiveProp = false, hasTabBar = true, engagement, onLike, onDoubleTapLike, onSave, onRepost, onFollow, onOpenComments, onShopTag, onOpenCreator, onNotInterested, soundOn, onToggleSound,
}: {
  item: SpotlightItem;
  isActive: boolean;
  pageWidth: number;
  pageHeight: number;
  bottomClearance: number;
  /** Buyer Home behind the floating tab bar. */
  immersive?: boolean;
  /** False for the full-screen creator player, which has no tab bar to blur under. */
  hasTabBar?: boolean;
  /** Opens the creator's profile (or returns to it from the creator player). */
  onOpenCreator: (item: SpotlightItem) => void;
  engagement: EngagementState | undefined;
  onLike: (id: string) => Promise<void>;
  onDoubleTapLike: (id: string) => void;
  onSave: (id: string) => Promise<void>;
  onRepost: (id: string) => Promise<void>;
  onFollow: (id: string) => Promise<void>;
  onOpenComments: (id: string) => void;
  onShopTag: (item: SpotlightItem, tag: SpotlightProductTag) => void;
  onNotInterested: (id: string) => void;
  /** Whether the app-wide feed sound preference is on. */
  soundOn: boolean;
  onToggleSound: () => void;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { push } = useThreadPull();
  // The creator player (no tab bar) always plays edge to edge like Buyer Home.
  const immersive = immersiveProp || !hasTabBar;
  const [paused, setPaused] = useState(false);
  /** Which page of a multi-photo post is currently visible, for the pager dots. */
  const [photoPageIndex, setPhotoPageIndex] = useState(0);
  /** Pause while the buyer is holding down on the left/center of the video — distinct from the tap-to-toggle `paused` above, so releasing always resumes rather than fighting a manual pause. */
  const [holdPaused, setHoldPaused] = useState(false);
  /** 2x while holding the right side of the video. */
  const [speedActive, setSpeedActive] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const { showToast } = useFeedToast();
  const heartBurst = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(1)).current;
  /** Ring that flashes out from behind the rail heart on like — a second,
   * smaller echo of the double-tap burst so a single tap on the rail icon
   * gets its own moment instead of only the icon itself popping. */
  const likeRing = useRef(new Animated.Value(0)).current;
  const speedPillOpacity = useRef(new Animated.Value(0)).current;
  const repostSpin = useRef(new Animated.Value(0)).current;
  const repostScale = useRef(new Animated.Value(1)).current;
  const saveDrop = useRef(new Animated.Value(0)).current;
  const saveScale = useRef(new Animated.Value(1)).current;
  const lastTap = useRef(0);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTriggered = useRef(false);
  // No entrance animation on the overlay chrome (rail + bottom-info block):
  // it must move 1:1 with its own page as part of the same cell, exactly
  // like the video does, with zero opacity/position animation when a cell
  // becomes active — a previous "rise and fade in" spring keyed off
  // `isActive` becoming true fired on every single swipe (every cell starts
  // inactive, becomes active, that transition ran the spring every time),
  // reading as the whole overlay bouncing in on every swipe instead of
  // holding sturdy with the page. `chromeStyle` is now a plain, static,
  // always-settled style — kept as a style object (not removed outright) so
  // every call site below stays unchanged.
  const chromeStyle = { opacity: 1 };
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
    likeRing.setValue(0);
    Animated.timing(likeRing, { toValue: 1, duration: 480, useNativeDriver: true }).start();
  }

  /** Arrows spin a full turn with a pop of scale — repost toggled either way. */
  function spinRepost() {
    repostSpin.setValue(0);
    Animated.timing(repostSpin, { toValue: 1, duration: 420, useNativeDriver: true }).start();
    Animated.sequence([
      Animated.spring(repostScale, { toValue: 1.3, useNativeDriver: true, speed: 40 }),
      Animated.spring(repostScale, { toValue: 1, useNativeDriver: true, speed: 40 }),
    ]).start();
  }

  /** Bookmark lifts, pops gold, then drops/settles — save toggled either way. */
  function dropSave() {
    saveDrop.setValue(0);
    Animated.timing(saveDrop, { toValue: 1, duration: 360, useNativeDriver: true }).start();
    Animated.sequence([
      Animated.spring(saveScale, { toValue: 1.4, useNativeDriver: true, speed: 40 }),
      Animated.spring(saveScale, { toValue: 1, useNativeDriver: true, speed: 40 }),
    ]).start();
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
      {/* Explicit width/height on the Pressable itself, not just its
          absoluteFill'd parent: on web, a plain Pressable/View with no
          intrinsic content and only absolutely-positioned children can
          collapse to 0 height inside a virtualized FlatList cell (flex/auto
          sizing there doesn't reliably inherit the ancestor's height the way
          native does) — which silently zeroed out the whole video area
          (390x0) while the separately-sized blurred mirror strip kept
          rendering, producing an all-black screen with nothing playing. */}
      <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} style={{ width: pageWidth, height: pageHeight }}>
        <View style={[StyleSheet.absoluteFill, { width: pageWidth, height: pageHeight }]}>
          {item.contentType === 'video'
            ? (
              <VideoVisual
                source={item.videoSource ?? item.mediaUris[0]}
                isActive={isActive}
                paused={paused || holdPaused}
                rate={speedActive ? 2 : 1}
                muted={!soundOn}
                posterUri={item.videoPosterUri}
                posterSource={item.videoPosterSource}
                fallbackColor={item.accentColor}
                immersive={immersive}
                progressBottom={immersive ? bottomClearance : undefined}
                pageAspect={pageHeight > 0 ? pageWidth / pageHeight : undefined}
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                bottomStripHeight={immersive && hasTabBar ? bottomClearance : 0}
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

      {/* Legibility scrims moved out of this per-cell component — see the
          fixed overlay siblings rendered once above the FlatList in
          FeedScreen, so they no longer scroll away with the page during a
          swipe (each cell used to carry its own copy, which visibly slid
          off with the content). */}

      {/* ─ Shop side tab ─ collapsed against the left edge (mirrors the
          rail on the right), only when this video has a tagged product.
          Lives at this top level, not inside the bottom-left info stack —
          it's a screen-edge affordance, not part of that stack's flow. */}
      {!!item.productTags?.length && (
        <ShopSideTab
          tag={item.productTags[0]}
          extraCount={Math.max(0, item.productTags.length - 1)}
          onPress={() => onShopTag(item, item.productTags![0])}
          isActive={isActive}
        />
      )}

      {/* ─ Right action rail ─
          Pinned at bottomClearance + RAIL_BOTTOM_GAP, not bare
          bottomClearance: the scrub/progress bar sits right around
          bottomClearance too (see ScrubProgressBar's `bottom - 13` math
          below), so anchoring the rail there put its last item (share)
          directly touching the bar with zero gap. RAIL_BOTTOM_GAP clears
          the bar's own height/hit-area with the required >=16pt to spare. */}
      <Animated.View style={[styles.rail, chromeStyle, { bottom: bottomClearance + RAIL_BOTTOM_GAP }]}>
        {/* Avatar + follow badge */}
        <View style={styles.railAvatarWrap}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onOpenCreator(item);
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

        {/* Like — a ring echoes outward from behind the icon on every tap
            that likes the post (not just the double-tap burst on the video
            itself), so the rail control has its own moment of feedback. */}
        <View style={styles.railLikeWrap} pointerEvents="box-none">
          <Animated.View
            pointerEvents="none"
            style={[
              styles.railLikeRing,
              {
                opacity: likeRing.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
                transform: [{ scale: likeRing.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.9] }) }],
              },
            ]}
          />
          <EngagementButton
            icon="heart"
            solidIcon="heart"
            iconSize={25}
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
        </View>

        {/* Comments — not async, opens navigation */}
        <TouchableOpacity
          style={styles.railBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 6, bottom: 6, left: 10, right: 10 }}
          onPress={() => onOpenComments(item.id)}
          accessibilityRole="button"
          accessibilityLabel={`Comments, ${formatCount(item.commentsCount ?? (engagement?.comments ?? []).length)}`}
        >
          <FontAwesome name="commenting" size={24} color={ON_DARK} />
          <Text style={styles.railCount}>{formatCount(item.commentsCount ?? (engagement?.comments ?? []).length)}</Text>
        </TouchableOpacity>

        {/* Repost */}
        <EngagementButton
          icon="repeat"
          solidIcon="retweet"
          iconSize={25}
          count={formatCount(engagement?.reposts ?? 0)}
          active={engagement?.reposted ?? false}
          activeColor={theme.accent}
          inactiveColor={ON_DARK}
          accessibilityLabel={`${engagement?.reposted ? 'Undo repost' : 'Repost'}, ${formatCount(engagement?.reposts ?? 0)} reposts`}
          accessibilityState={{ checked: engagement?.reposted ?? false }}
          style={styles.railActionContent}
          rotateAnim={repostSpin}
          scaleAnim={repostScale}
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
          iconSize={24}
          count={formatCount(engagement?.saves ?? item.saves)}
          active={engagement?.saved ?? false}
          activeColor={GOLD}
          inactiveColor={ON_DARK}
          accessibilityLabel={`${engagement?.saved ? 'Unsave' : 'Save'}, ${formatCount(engagement?.saves ?? item.saves)} saves`}
          accessibilityState={{ checked: engagement?.saved ?? false }}
          style={styles.railActionContent}
          translateYAnim={saveDrop}
          scaleAnim={saveScale}
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
          <FontAwesome name="share" size={24} color={ON_DARK} />
          <Text style={styles.railCount}>{formatCount(item.shares)}</Text>
        </TouchableOpacity>

      </Animated.View>

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
        onNotInterested={() => onNotInterested(item.id)}
        onFeedback={showToast}
      />

      {/* ─ Bottom-left overlay: creator, caption, sound ─
          Pinned at bottomClearance + CAPTION_BOTTOM_GAP for the same reason
          as the rail above: bare bottomClearance put the sound line's own
          bottom edge right where the scrub/progress bar sits, touching it
          with no gap. CAPTION_BOTTOM_GAP guarantees the required >=12pt of
          clearance from the sound line down to the bar. The shop tag used to
          live at the top of this stack as a pill; it's now the screen-edge
          ShopSideTab rendered above instead, so this stack starts straight
          at the repost/creator row with no leftover gap where the pill used
          to sit — nothing here reserves space for it any more (see
          bottomInfo/bottomInfoWithRepost's shrunk minHeight below). */}
      <Animated.View style={[styles.bottomInfo, chromeStyle, hasRepostIdentity && styles.bottomInfoWithRepost, { bottom: bottomClearance + CAPTION_BOTTOM_GAP }]} pointerEvents="box-none">
        {hasRepostIdentity && (
          <TouchableOpacity
            style={styles.repostIdentity}
            activeOpacity={friendReposts.length > 0 ? 0.8 : 1}
            disabled={friendReposts.length === 0}
            onPress={() => {
              const friend = friendReposts[0];
              // buyer-other-profile reads `userId` — the old `id` param opened a blank profile.
              if (friend) router.push(profileHref({ userId: friend.userId, accountType: 'buyer', name: friend.displayName }) as never);
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
            onOpenCreator(item);
          }}
          accessibilityRole="button"
          accessibilityLabel={`View ${item.creator}'s profile`}
        >
          <View style={styles.creatorRow}>
            <Text style={styles.creatorName} numberOfLines={1}>{item.creator}</Text>
            {item.verified && <Feather name="check-circle" size={13} color="#4FA8FF" style={{ marginLeft: 4 }} />}
          </View>
        </TouchableOpacity>

        <Pressable
          onPress={() => item.caption.length > 86 && setCaptionExpanded(v => !v)}
          accessibilityRole={item.caption.length > 86 ? 'button' : 'text'}
          accessibilityLabel={item.caption.length > 86 ? (captionExpanded ? 'Collapse caption' : 'Expand caption') : undefined}
          hitSlop={{ top: 4, bottom: 4 }}
        >
          <Text style={styles.caption} numberOfLines={captionExpanded ? undefined : 2}>
            {item.caption}
            {item.caption.length > 86 && (
              <Text style={styles.moreText}>{captionExpanded ? '  less' : '  more'}</Text>
            )}
          </Text>
        </Pressable>

        <Pressable
          style={styles.soundRow}
          onPress={onToggleSound}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={soundOn ? 'Mute sound' : 'Unmute sound'}
          accessibilityState={{ checked: soundOn }}
        >
           <Feather name={soundOn ? 'volume-2' : 'volume-x'} size={12} color={`${ON_DARK}CC`} />
          <Text style={styles.soundText} numberOfLines={1}>{item.sound}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// CommentsModal replaced by navigation to /buyer-post-comments (see handleOpenComments).

// ─── Type guard for the feed union ───────────────────────────────────────────

function isLiveStreamItem(item: SpotlightItem | LiveStreamFeedItem | JustDroppedRailItem): item is LiveStreamFeedItem {
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
    likedByMe: post.likedByMe === true,
    comments: [],
    reposts: post.repostsCount,
    repostedByMe: post.repostedByMe,
    friendReposts: post.friendReposts,
    shares: 0,
    saves: Number((post as any).savedCount ?? (post as any).savesCount ?? 0),
    savedByMe: post.savedByMe === true,
    location: (post as any).location ?? (post as any).locationName ?? undefined,
    productId: tag?.productId,
    sellerId: post.authorId,
    authorAccountType: post.authorAccountType === 'buyer' ? 'buyer' : 'seller',
    productTags: post.productTags ?? [],
    commentsCount: post.commentsCount,
  };
}

/**
 * Preview catalog products need a real multi-photo gallery to test the
 * full-bleed swipeable carousel (product shots + "model photos"), not just
 * the single video poster frame. Reuse the runway poster set — 3-5 images
 * per product, cycled by an offset derived from the product id so different
 * preview products don't all show the same sequence.
 */
function buildPreviewGalleryUris(item: SpotlightItem, productId: string): string[] {
  const pool = FASHION_PREVIEW_POSTER_URIS;
  if (pool.length === 0) return item.videoPosterUri ? [item.videoPosterUri] : [];
  let seed = 0;
  for (let i = 0; i < productId.length; i++) seed = (seed * 31 + productId.charCodeAt(i)) >>> 0;
  const count = 3 + (seed % 3); // 3-5 images
  const start = seed % pool.length;
  const uris = Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
  // Lead with this post's own poster so the first frame still matches the tag.
  if (item.videoPosterUri && !uris.includes(item.videoPosterUri)) uris[0] = item.videoPosterUri;
  return uris;
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
  const galleryUris = buildPreviewGalleryUris(item, tag.productId);
  return {
    id: tag.productId,
    sellerId: item.sellerId ?? `preview-seller-${item.id}`,
    sellerName: item.creator,
    sellerHandle: item.handle,
    name: tag.productName,
    description: item.caption.replace(/^Preview ·\s*/, ''),
    priceCents: tag.priceCents,
    imageUris: galleryUris,
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
  creatorFeed,
}: {
  buyerMode?: boolean;
  showFashionPreview?: boolean;
  creatorFeed?: CreatorFeedConfig;
}) {
  const { theme } = useAppTheme();
  const palette = theme as typeof theme & { background?: string; surface?: string; card?: string; border?: string; text?: string; muted?: string; subtle?: string; };
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, secondary: CYAN } = theme;
  const insets = useSafeAreaInsets();
  const previewTopInset = Platform.OS === 'web' ? 67 : insets.top;
  const previewBottomInset = insets.bottom;
  const isBuyerSurface = buyerMode || showFashionPreview;
  const isCreatorFeed = !!creatorFeed;
  const creatorSource = creatorFeed?.source;
  const creatorId = creatorFeed?.id;
  const creatorStartPostId = creatorFeed?.startPostId;
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
  // The feed's sound on/off choice — a single app-wide preference (not
  // per-post), persisted so it survives leaving and returning to the feed.
  const [soundOn, setSoundOn] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(SOUND_PREF_KEY).then(v => { if (v === 'on') setSoundOn(true); }).catch(() => {});
  }, []);
  const toggleSound = useCallback(() => {
    setSoundOn(prev => {
      const next = !prev;
      AsyncStorage.setItem(SOUND_PREF_KEY, next ? 'on' : 'off').catch(() => {});
      return next;
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);
  const [showGestureGuide, setShowGestureGuide] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const pageWidth = viewportSize.width || windowWidth;
  const pageHeight = viewportSize.height || windowHeight;
  const viewportReady = viewportSize.width > 0 && viewportSize.height > 0;
  const [showSearch, setShowSearch] = useState(false);
  /** Buyer Threads Home's own search toggle — the glass top bar swaps to a
   * search row in place, same searchQuery state as the legacy top bar. */
  const [buyerSearchOpen, setBuyerSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNotifs, setShowNotifs] = useState(false);
  const [showRepostEducation, setShowRepostEducation] = useState(false);
  const [feedTab, setFeedTab] = useState<'following' | 'for-you'>('for-you');
  const [shopSelection, setShopSelection] = useState<ShopSheetSelection | null>(null);
  const [cartCount, setCartCount] = useState(0);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  // Real TikTok never shows a placeholder/skeleton box over the feed. Seed
  // the very first render from whatever we already have in memory for this
  // tab (instant on a tab switch within the session) so there is a real post
  // — poster included — on screen from frame one instead of an empty list
  // that would otherwise need a loading state to cover. A cold app start has
  // nothing in memory yet; `hydrateFeedPostsCache` below fills it in from
  // AsyncStorage a beat later, still well before any skeleton would ever be
  // justified, and with no placeholder shapes in between either way.
  const [sellerFeedPosts, setSellerFeedPosts] = useState<SpotlightItem[]>(() => (
    creatorSource && creatorId ? [] : getCachedFeedPosts<SpotlightItem>('for-you') ?? []
  ));
  const [feedLoading, setFeedLoading] = useState(() => (
    creatorSource && creatorId ? true : (getCachedFeedPosts<SpotlightItem>('for-you') ?? []).length === 0
  ));
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  const [feedLoadingMore, setFeedLoadingMore] = useState(false);
  const [feedHasMore, setFeedHasMore] = useState(true);
  const [activeLiveStreams, setActiveLiveStreams] = useState<LiveStreamFeedItem[]>([]);
  const [feedError, setFeedError] = useState(false);
  const [creatorStartIndex, setCreatorStartIndex] = useState(0);
  const creatorOffsetRef = useRef(0);
  const viewedPostIdsRef = useRef(new Set<string>());
  const api = useApi();
  const feedCursorRef = useRef(createThreadFeedCursor());
  const feedGenerationRef = useRef(0);
  const feedLoadKeyRef = useRef<string | null>(null);
  const feedLoadingMoreRef = useRef(false);
  const feedHasMoreRef = useRef(true);
  const repostPendingRef = useRef(new Set<string>());
  const cartPulse = useRef(new Animated.Value(1)).current;
  const cartTargetRef = useRef<View>(null);
  const feedListRef = useRef<FlatList<FeedItem>>(null);

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

  // First-time gesture coach — buyer home only, shown once per account (and
  // once more per FEED_GESTURES_TIP_VERSION bump). Server is the source of
  // truth so it stays seen across reinstalls/devices; `api` falls back to
  // the local cache when there's no real backend user (e.g. preview/dev).
  useEffect(() => {
    if (!isBuyerSurface) return;
    let active = true;
    void hasSeenFeedGestureGuide(userId, api).then(seen => {
      if (active && !seen) setShowGestureGuide(true);
    });
    return () => { active = false; };
  }, [isBuyerSurface, userId, api]);

  const dismissGestureGuide = useCallback(() => {
    setShowGestureGuide(false);
    void markFeedGestureGuideSeen(userId, api);
  }, [userId, api]);

  // Load published seller posts and subscribe to real-time changes
  const loadFeed = useCallback(async (initial = false) => {
    if (creatorSource && creatorId) {
      // Creator/product player: that creator's videos only, opened at the tapped one.
      const generation = feedGenerationRef.current + 1;
      feedGenerationRef.current = generation;
      if (initial) setFeedLoading(true);
      else setFeedRefreshing(true);
      setFeedError(false);
      try {
        const result = await loadVideoFeedThrough(creatorSource, creatorId, initial ? creatorStartPostId : null);
        if (feedGenerationRef.current !== generation) return;
        setSellerFeedPosts(result.posts.map(mapSellerPost).filter((p): p is SpotlightItem => p !== null));
        creatorOffsetRef.current = result.nextOffset;
        feedHasMoreRef.current = result.hasMore;
        setFeedHasMore(result.hasMore);
        if (initial) {
          setCreatorStartIndex(result.startIndex);
          setActiveIndex(result.startIndex);
        }
      } catch {
        if (feedGenerationRef.current !== generation) return;
        if (initial) { setSellerFeedPosts([]); setFeedError(true); }
      } finally {
        if (feedGenerationRef.current === generation) {
          if (initial) setFeedLoading(false);
          else setFeedRefreshing(false);
        }
      }
      return;
    }
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
    if (initial) {
      setFeedLoading(true);
      // No skeleton ever covers this — instead, show whatever we last saw
      // for this tab (in memory instantly, or from AsyncStorage a beat
      // later on a cold start) while the real page loads underneath it.
      const cachedNow = getCachedFeedPosts<SpotlightItem>(loadKey);
      if (cachedNow) {
        setSellerFeedPosts(cachedNow);
      } else {
        void hydrateFeedPostsCache<SpotlightItem>(loadKey).then(cached => {
          if (cached && feedLoadKeyRef.current === loadKey) setSellerFeedPosts(cached);
        });
      }
    } else setFeedRefreshing(true);
    try {
      const page = await getThreadPostsPage(initialCursor, THREAD_PAGE_SIZE, feedTab);
      if (feedGenerationRef.current !== generation) return;
      const rows = page.posts;
      const mapped = (Array.isArray(rows) ? rows : [])
        .map(mapSellerPost)
        .filter((p): p is SpotlightItem => p !== null);
      setSellerFeedPosts(mapped);
      setCachedFeedPosts(loadKey, mapped);
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
  }, [feedTab, creatorSource, creatorId, creatorStartPostId]);

  const loadMoreFeed = useCallback(async () => {
    if (feedLoadingMoreRef.current || !feedHasMoreRef.current || feedLoading || feedRefreshing) return;
    feedLoadingMoreRef.current = true;
    setFeedLoadingMore(true);
    const generation = feedGenerationRef.current;
    const cursor = feedCursorRef.current;
    try {
      const page = creatorSource && creatorId
        ? await getVideoFeedPage(creatorSource, creatorId, creatorOffsetRef.current).then((result) => {
            creatorOffsetRef.current = result.nextOffset;
            return { posts: result.posts, cursor, hasMore: result.hasMore };
          })
        : await getThreadPostsPage(cursor, THREAD_PAGE_SIZE, feedTab);
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
  }, [feedLoading, feedRefreshing, feedTab, creatorSource, creatorId]);

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

  // Poll active live streams every 30 seconds (main feed only — a creator's
  // video player never weaves other sellers' streams in)
  useEffect(() => {
    if (isCreatorFeed) return undefined;
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
  }, [isCreatorFeed]);

  // "Just dropped from brands you follow" — real drops only: fetch the
  // buyer's follow graph and the platform's currently-live drops, then
  // intersect them client-side (no server change needed). Never shown if
  // empty — this is a rail, not a placeholder.
  const [justDroppedDrops, setJustDroppedDrops] = useState<FollowedDrop[]>([]);
  useEffect(() => {
    if (!isBuyerSurface) return;
    let active = true;
    Promise.all([
      api.social.following().catch(() => []),
      (api as any).publicDrops.list('live').catch(() => []),
    ]).then(([followingRows, liveDrops]: [any[], any[]]) => {
      if (!active) return;
      setJustDroppedDrops(computeJustDroppedDrops(
        Array.isArray(followingRows) ? followingRows : [],
        Array.isArray(liveDrops) ? liveDrops : [],
      ));
    }).catch(() => { if (active) setJustDroppedDrops([]); });
    return () => { active = false; };
  }, [api, isBuyerSurface]);

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
    const previewPosts = __DEV__ && !isCreatorFeed && (buyerMode || showFashionPreview) && feedTab === 'for-you'
      ? FASHION_PREVIEW_POSTS
      : [];
    const regular: (SpotlightItem | LiveStreamFeedItem | JustDroppedRailItem)[] = [...previewPosts, ...sellerFeedPosts];
    // A creator/product-scoped player shows only those videos — no live
    // streams or rails woven in.
    if (isCreatorFeed || feedTab === 'following') return regular;
    // Weave the "Just dropped" rail in once, early (index 2) — a real,
    // non-video page in the same vertical pager the live-stream cards use.
    if (isBuyerSurface && justDroppedDrops.length > 0) {
      regular.splice(Math.min(2, regular.length), 0, { _isJustDropped: true, id: 'just-dropped-rail', drops: justDroppedDrops });
    }
    if (!activeLiveStreams.length) return regular;
    // Weave live streams in: first at index 4, then every 10 after
    const result: (SpotlightItem | LiveStreamFeedItem | JustDroppedRailItem)[] = [...regular];
    activeLiveStreams.slice(0, 3).forEach((liveItem, i) => {
      const insertAt = Math.min(4 + i * 10, result.length);
      result.splice(insertAt, 0, liveItem);
    });
    return result;
  }, [sellerFeedPosts, activeLiveStreams, buyerMode, feedTab, showFashionPreview, isBuyerSurface, justDroppedDrops, isCreatorFeed]);

  // Every on-screen post's real engagement snapshot (server-backed likes/
  // saves/reposts/liked-by-me/saved-by-me), keyed by id. `engagements` state
  // is only populated lazily as posts are interacted with; before that, any
  // fallback MUST read from here (not a zeroed DEFAULT_ENGAGEMENT) or a first
  // tap on like/save/repost would optimistically count up from 0 and wipe
  // out the real count that was already showing.
  const itemsById = useMemo(() => {
    const map = new Map<string, SpotlightItem>();
    for (const item of allItems) {
      if (!isLiveStreamItem(item) && !isJustDroppedItem(item)) map.set(item.id, item);
    }
    return map;
  }, [allItems]);

  const engagementFor = useCallback((id: string): EngagementState => {
    const item = itemsById.get(id);
    return item ? initialEngagement(item) : DEFAULT_ENGAGEMENT;
  }, [itemsById]);

  // Offline-safe retry: the optimistic engagement state above already
  // updates instantly on every tap; this replays the actual persistence
  // call once connectivity returns, for whichever like/save/repost/follow
  // couldn't reach the server the first time. Re-registered whenever `api`
  // changes identity so the executor always calls through the live client.
  useEffect(() => {
    setEngagementRetryExecutor(async (action) => {
      switch (action.kind) {
        case 'like':
          await api.posts.interact(action.targetId, { type: 'like', value: action.payload?.value as string | undefined });
          break;
        case 'repost':
          await api.posts.interact(action.targetId, { type: 'repost', value: action.payload?.value as string | undefined });
          break;
        case 'save':
          if (action.payload?.value === 'remove') {
            await api.buyer.saved.remove(action.targetId);
          } else {
            const item = itemsById.get(action.targetId);
            const title = item?.caption?.trim() || `${item?.creator ?? 'Post'}'s post`;
            await api.buyer.saved.save({ type: 'post', targetId: action.targetId, title, subtitle: item?.creator, accentColor: item?.accentColor });
          }
          break;
        case 'follow':
          await setSellerFollowing(action.targetId, action.payload?.value !== 'unfollow');
          break;
        case 'not_interested':
          await api.posts.interact(action.targetId, { type: 'not_interested' });
          break;
      }
    });
    return () => setEngagementRetryExecutor(null);
  }, [api, itemsById]);
  useEffect(() => startEngagementRetryQueuePump(), []);

  // filteredContentItems: regular spotlight/live items after search filter
  const filteredContentItems = searchQuery.trim()
    ? allItems.filter(item => {
        if (isJustDroppedItem(item)) return false;
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
  //
  // Once there's no more real content to paginate in (the fixed preview set,
  // or a real account that's genuinely reached the end of their feed), the
  // same items are appended again under unique keys instead of ending —
  // there is no "You're all caught up" card any more; scrolling past the
  // last video should feel seamless and never-ending, the way the real app
  // does, not stop dead or show an end card. Not applied while a search
  // filter is active (a filtered result set has a real, meaningful end) or
  // to the single-creator/product player (a deliberate end there is fine).
  const canLoopFeed = !searchQuery.trim() && !feedHasMore && filteredContentItems.length > 1 && !isCreatorFeed;
  const displayItems: FeedItem[] = useMemo(() => {
    const base = filteredContentItems as FeedItem[];
    const content = canLoopFeed
      ? Array.from({ length: FEED_LOOP_REPEAT }, (_, cycle) => (
          cycle === 0 ? base : base.map(item => ({ ...item, id: `${item.id}__loop${cycle}` }))
        )).flat()
      : base;
    if (!buyerMode) return content;
    return [DEMAND_PAGE_SENTINEL, ...content];
  }, [buyerMode, filteredContentItems, canLoopFeed]);

  // buyerOffset: used to compute correct isActive for video playback when the
  // demand sentinel sits at index 0.
  const buyerOffset = buyerMode ? 1 : 0;

  // Avatar / name tap: open the creator's profile — or, inside that creator's
  // own video player, go back to the profile it was opened from.
  const handleOpenCreator = useCallback((item: SpotlightItem) => {
    if (!item.sellerId) return;
    if (creatorSource === 'creator' && creatorId && item.sellerId === creatorId && router.canGoBack()) {
      router.back();
      return;
    }
    router.push(profileHref({
      userId: item.sellerId,
      accountType: item.authorAccountType ?? 'seller',
      name: item.creator,
      handle: item.handle,
      initials: item.initials,
    }) as never);
  }, [creatorSource, creatorId, router]);

  // Record one view per post per session when it becomes the active page —
  // the view counts profile video tiles show.
  useEffect(() => {
    if (!userId) return;
    const item = displayItems[activeIndex];
    if (!item || isDemandPageItem(item) || (item as LiveStreamFeedItem)._isLive) return;
    const id = item.id;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
    if (viewedPostIdsRef.current.has(id)) return;
    viewedPostIdsRef.current.add(id);
    api.posts.interact(id, { type: 'view' }).catch(() => {});
  }, [activeIndex, api, displayItems, userId]);

  function update(id: string, patch: Partial<EngagementState> | ((e: EngagementState) => Partial<EngagementState>)) {
    setEngagements(prev => {
      const cur = prev[id] ?? engagementFor(id);
      const delta = typeof patch === 'function' ? patch(cur) : patch;
      return { ...prev, [id]: { ...cur, ...delta } };
    });
  }

  const handleLike = useCallback(async (id: string): Promise<void> => {
    const snapshot = engagements[id] ?? engagementFor(id);
    const willLike = !snapshot.liked;
    // Optimistic update
    update(id, e => ({ liked: willLike, likes: willLike ? e.likes + 1 : Math.max(0, e.likes - 1) }));
    // Real post interaction — rollback on failure
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      try {
        const { api: _api } = require('@/lib/api');
        await _api.posts.interact(id, { type: 'like', value: willLike ? 'add' : 'remove' });
      } catch (error) {
        if (isRetryableFailure(error)) {
          // Offline/server outage — keep the optimistic state and replay once connectivity returns.
          void enqueueEngagementRetry({ kind: 'like', targetId: id, payload: { value: willLike ? 'add' : 'remove' } });
        } else {
          update(id, () => ({ liked: snapshot.liked, likes: snapshot.likes }));
          showToast('Could not update like. Try again.', 'error');
        }
      }
    }
  }, [engagements, engagementFor, showToast]);

  const handleDoubleTapLike = useCallback((id: string) => {
    setEngagements(prev => {
      const e = prev[id] ?? engagementFor(id);
      if (e.liked) return prev;
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isUUID) {
        try { const { api: _api } = require('@/lib/api'); _api.posts.interact(id, { type: 'like' }).catch(() => {}); } catch {}
      }
      return { ...prev, [id]: { ...e, liked: true, likes: e.likes + 1 } };
    });
  }, [engagementFor]);

  const handleSave = useCallback(async (id: string): Promise<void> => {
    const cur = engagements[id] ?? engagementFor(id);
    const willSave = !cur.saved;
    const snapshot = { saved: cur.saved, saves: cur.saves };
    // Optimistic update
    update(id, e => ({ saved: willSave, saves: willSave ? e.saves + 1 : Math.max(0, e.saves - 1) }));
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (isUUID) {
      try {
        const { api: _api } = require('@/lib/api');
        if (willSave) {
          // saved.save requires targetId + title (400 without one) — a post
          // has no "title" field of its own, so fall back through caption
          // then creator name the same way the saved-items list would want
          // to display it.
          const item = itemsById.get(id);
          const title = item?.caption?.trim() || `${item?.creator ?? 'Post'}'s post`;
          await _api.buyer.saved.save({ type: 'post', targetId: id, title, subtitle: item?.creator, accentColor: item?.accentColor });
        } else {
          await _api.buyer.saved.remove(id);
        }
      } catch (error) {
        if (isRetryableFailure(error)) {
          void enqueueEngagementRetry({ kind: 'save', targetId: id, payload: { value: willSave ? 'add' : 'remove' } });
        } else {
          update(id, () => ({ saved: snapshot.saved, saves: snapshot.saves }));
          showToast('Could not update save. Try again.', 'error');
        }
      }
    }
  }, [engagements, engagementFor, itemsById, showToast]);

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
    const snapshot = engagements[id] ?? engagementFor(id);
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
      } catch (error) {
        if (isRetryableFailure(error)) {
          void enqueueEngagementRetry({ kind: 'repost', targetId: id, payload: { value: willRepost ? undefined : 'remove' } });
          if (willRepost) await showRepostEducationOnce();
        } else {
          update(id, () => ({ reposted: snapshot.reposted, reposts: snapshot.reposts }));
          showToast('Could not repost. Try again.', 'error');
        }
      }
    } else if (willRepost) {
      await showRepostEducationOnce();
    }
    repostPendingRef.current.delete(id);
  }, [api, engagements, engagementFor, showRepostEducationOnce, showToast]);

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
    } catch (error) {
      if (isRetryableFailure(error)) {
        void enqueueEngagementRetry({ kind: 'follow', targetId: sellerId, payload: { value: wasFollowing ? 'unfollow' : undefined } });
        return;
      }
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

  // "Not interested" removes the post from this session's feed immediately
  // (a real, visible effect — not just a toast) and records the signal so
  // ranking can downweight similar posts going forward. Fire-and-forget:
  // the post is already gone from the feed either way.
  const handleNotInterested = useCallback((id: string) => {
    setSellerFeedPosts(prev => prev.filter(post => post.id !== id));
    if (/^[0-9a-f-]{36}$/i.test(id)) {
      void api.posts.interact(id, { type: 'not_interested' }).catch((error) => {
        if (isRetryableFailure(error)) void enqueueEngagementRetry({ kind: 'not_interested', targetId: id });
      });
    }
    showToast('We’ll show you fewer posts like this.', 'info');
  }, [api, showToast]);

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

  /** Top-bar LIVE button: jumps the feed to the nearest active live stream
   * card already mixed into displayItems, ahead of the current position
   * when one exists downstream, otherwise the closest one behind it. */
  function jumpToNearestLive() {
    const indices: number[] = [];
    displayItems.forEach((it, i) => { if ((it as any)._isLive) indices.push(i); });
    if (!indices.length) return;
    const ahead = indices.find(i => i > activeIndex);
    const target = ahead ?? indices[indices.length - 1];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    feedListRef.current?.scrollToIndex({ index: target, animated: true });
  }

  function handleOpenComments(id: string) {
    const item = allItems.find(i => i.id === id);
    if (!item || isLiveStreamItem(item) || isJustDroppedItem(item)) return;
    // item.mediaUris[0] is already the fully-resolved, playable URI for both
    // real posts (server URL) and preview posts (FASHION_PREVIEW_VIDEO_URIS,
    // itself built via Asset.fromModule) — re-deriving it here from
    // item.videoSource duplicated that resolution with a narrower set of
    // cases and could disagree with what the feed itself is actually
    // playing, leaving the comments sheet's backdrop with a broken source.
    const videoUri = item.mediaUris[0] ?? '';
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

  // Prefetch the next 2 posts' poster images so the placeholder is already
  // decoded by the time a swipe reaches them — the video players themselves
  // are already buffering ahead of time via the FlatList's windowSize, but
  // the poster (what actually covers the screen until playback starts) was
  // only ever requested once its own cell mounted.
  useEffect(() => {
    for (let i = activeIndex + 1; i <= activeIndex + 2; i++) {
      const next = displayItems[i];
      if (!next || !('contentType' in next)) continue;
      const uri = next.videoPosterUri ?? (next.contentType !== 'video' ? next.mediaUris[0] : undefined);
      if (uri) ExpoImage.prefetch(uri).catch(() => {});
    }
  }, [activeIndex, displayItems]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;
  // Buyer Home plays edge to edge behind the floating tab bar, so every
  // overlay (shop tag, caption, rail, progress) starts above the bar.
  // Buyer Home: this is the exact height of the floating tab bar's zone
  // (its own bottom margin + the capsule + its breathing room) — nothing
  // extra added. The sharp video fills every pixel above it edge to edge;
  // the blurred tab-bar strip and the scrub line both key off this same
  // number so the seam between "sharp video" and "blurred bar backdrop"
  // lands in exactly one place, with no added gap or oversized band.
  const bottomClearance = isBuyerSurface
    ? buyerBarInset
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
      {viewportReady && <FlatList
        ref={feedListRef}
        // The creator player remounts once its videos load so it opens at the tapped one.
        key={`thread-${pageWidth}x${pageHeight}${isCreatorFeed && feedLoading ? '-loading' : ''}`}
        data={displayItems}
        // Creator player opens at the tapped video (uniform page height via getItemLayout).
        initialScrollIndex={isCreatorFeed && creatorStartIndex > 0 && creatorStartIndex < displayItems.length ? creatorStartIndex : undefined}
        keyExtractor={item => item.id}
        pagingEnabled
        disableIntervalMomentum
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        // A slow drag-then-release let the list rubber-band past the page
        // boundary before paging snapped it back — on iOS that's the default
        // vertical bounce, on Android the default overscroll glow/stretch,
        // and on web (react-native-web) the equivalent elastic overshoot.
        // Only the video itself should ever appear to move like that; the
        // overlay chrome doesn't animate at all (see chromeStyle above), so
        // that rubber-band snap-back read as the whole page — video and
        // overlay together — bouncing. Disabling native overscroll here
        // makes every release, slow or fast, land exactly on the page
        // boundary with no elastic overshoot to snap back from.
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        onEndReached={loadMoreFeed}
        onEndReachedThreshold={0.5}
        // Bounds how many video players ever exist at once: the active
        // page plus roughly the next/previous 2 stay mounted (poster-first,
        // so they start instantly the moment they become active) — the
        // rest are unmounted rather than left decoding off-screen. On web,
        // react-native-web's VirtualizedList batches renders off scroll
        // events rather than native's more reliable cell-recycling timers;
        // a low initialNumToRender/windowSize there let fast/paginated
        // swiping through the feed outrun the render batches, landing on
        // pages that were never mounted at all (a blank page) after only a
        // handful of swipes. Web renders the whole (small, ~10-item) preview
        // feed up front instead of virtualizing it away.
        initialNumToRender={Platform.OS === 'web' ? displayItems.length : 3}
        maxToRenderPerBatch={Platform.OS === 'web' ? displayItems.length : 2}
        windowSize={Platform.OS === 'web' ? 21 : 5}
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
          isCreatorFeed && !feedLoading ? (
            <View style={{ width: pageWidth, height: pageHeight, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 40 }}>
              <Feather name={feedError ? 'wifi-off' : 'film'} size={40} color={MUTED} />
              <Text style={{ fontSize: FS.lg, fontFamily: FONT.bold, color: FG, textAlign: 'center' }}>
                {feedError ? "Couldn't load these videos" : 'No videos yet'}
              </Text>
              {feedError ? (
                <TouchableOpacity
                  onPress={() => { void loadFeed(true); }}
                  style={styles.creatorRetry}
                  accessibilityRole="button"
                  accessibilityLabel="Retry"
                >
                  <Text style={styles.creatorRetryText}>Retry</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : searchQuery.trim() ? (
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
          ) : null
        }
        renderItem={({ item, index }) => {
          // Buyer demand page — full-screen at index 0 in buyer mode
          if (isDemandPageItem(item as FeedItem)) {
            return <BuyerHighDemandPage pageWidth={pageWidth} pageHeight={pageHeight} bottomClearance={bottomClearance} topInset={buyerHeaderHeight} />;
          }
          if (isJustDroppedItem(item)) {
            return (
              <JustDroppedRailPage
                drops={item.drops}
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                bottomClearance={bottomClearance}
                onOpenDrop={(drop) => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push(`/buyer-drop-detail?dropId=${encodeURIComponent(drop.id)}&dropName=${encodeURIComponent(drop.name)}` as never);
                }}
                onSeeAll={() => router.push('/(tabs)/following' as never)}
              />
            );
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
              hasTabBar={!isCreatorFeed}
              onOpenCreator={handleOpenCreator}
              engagement={engagements[spotlight.id] ?? initialEngagement(spotlight)}
              onLike={handleLike}
              onDoubleTapLike={handleDoubleTapLike}
              onSave={handleSave}
              onRepost={handleRepost}
              onFollow={handleFollow}
              onOpenComments={handleOpenComments}
              onShopTag={handleShopTag}
              onNotInterested={handleNotInterested}
              soundOn={soundOn}
              onToggleSound={toggleSound}
            />
          );
        }}
      />}

      {/* ─ Legibility scrims: fixed overlay above the list (not per-cell), so
          they stay put while the video underneath swipes past. Standard
          TikTok-style small gradients only — a short one at the very top
          (behind the top bar) and a short one at the very bottom (behind the
          caption/rail and the tab bar). Nothing here is a translucent panel:
          both are capped low enough that they never reach up into the
          middle of the right action rail, which previously read as a washed-
          out band over the comment/repost/save/share icons. */}
      {isBuyerSurface && (
        <>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)']}
            locations={[0, 1]}
            style={[styles.topScrim, { height: insets.top + 90 }]}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.22)', 'rgba(0,0,0,0.58)']}
            locations={[0, 0.45, 1]}
            style={[styles.bottomScrim, { height: bottomClearance + 130 }]}
          />
        </>
      )}

      {/* ─ Top bar overlay ─ */}
      {isCreatorFeed ? (
        <View style={[styles.topBar, { paddingTop: Math.max(0, previewTopInset - 4) }]} pointerEvents="box-none">
          <View style={styles.buyerTopRow}>
            <TouchableOpacity
              style={styles.buyerTopBtn}
              activeOpacity={0.7}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                if (router.canGoBack()) router.back();
                else router.replace('/' as never);
              }}
              accessibilityRole="button"
              accessibilityLabel="Back"
              testID="creator-feed-back"
            >
              <Feather name="arrow-left" size={24} color={ON_DARK} />
            </TouchableOpacity>
            <Text style={styles.creatorTitle} numberOfLines={1} accessibilityRole="header">
              {creatorFeed?.title || (creatorFeed?.source === 'product' ? 'Featured in' : 'Videos')}
            </Text>
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
      ) : isBuyerSurface ? (
        <View style={[styles.topBar, { paddingTop: Math.max(0, previewTopInset - 4) }]} pointerEvents="box-none">
          {/* Buyer Threads Home: For You feed chrome — Friends + Drops entry
              points, a centered "Following | Threads" glass pill switcher
              (real SegmentedControl from the shared design system, extended
              with a translucent `variant="glass"` for use over video — see
              components/ui/SegmentedControl.tsx), a LIVE jump-to button that
              only appears while a live stream is actually mixed into the
              feed, search, activity and cart. */}
          {buyerSearchOpen ? (
            // Solid fill, no BlurView: a live blur here would re-sample the
            // playing video behind it every frame, same class of glitch as
            // the old shop pill's frosted background — see ShopSideTab above.
            <View style={styles.buyerSearchRow}>
              <Feather name="search" size={16} color="rgba(255,255,255,0.75)" style={{ marginLeft: 14 }} />
              <TextInput
                style={styles.buyerSearchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search creators, products…"
                placeholderTextColor="rgba(255,255,255,0.5)"
                autoFocus
                returnKeyType="search"
                onSubmitEditing={() => setBuyerSearchOpen(false)}
              />
              <TouchableOpacity
                style={styles.buyerTopBtnCompact}
                activeOpacity={0.7}
                onPress={() => { setBuyerSearchOpen(false); setSearchQuery(''); }}
                accessibilityRole="button"
                accessibilityLabel="Close search"
              >
                <Feather name="x" size={18} color={ON_DARK} />
              </TouchableOpacity>
            </View>
          ) : (
          <View style={styles.buyerTopRow}>
            <View style={styles.buyerTopCluster}>
              <TouchableOpacity
                style={styles.buyerTopBtnCompact}
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  router.navigate('/(buyer)/friends' as never);
                }}
                accessibilityRole="button"
                accessibilityLabel="Friends"
                hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                testID="buyer-home-friends"
              >
                <BuyerNavIcon name="friends" color={ON_DARK} size={22} strokeWidth={1.9} />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.buyerTopBtnCompact}
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  router.push('/buyer-drops' as never);
                }}
                accessibilityRole="button"
                accessibilityLabel="Drops"
                hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                testID="buyer-home-drops"
              >
                <Feather name="zap" size={20} color={ON_DARK} />
              </TouchableOpacity>
              {activeLiveStreams.length > 0 && (
                <TouchableOpacity
                  style={styles.liveJumpBtn}
                  activeOpacity={0.78}
                  onPress={jumpToNearestLive}
                  accessibilityRole="button"
                  accessibilityLabel={`Jump to live, ${activeLiveStreams.length} streaming now`}
                  hitSlop={{ top: 5, bottom: 5, left: 4, right: 5 }}
                >
                  <View style={styles.liveJumpDot} />
                  <Text style={styles.liveJumpText}>LIVE</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.buyerTabSwitcherWrap} pointerEvents="box-none">
              <SegmentedControl
                variant="underline"
                testID="buyer-home-tabs"
                options={[
                  { id: 'following', label: 'Following' },
                  { id: 'for-you', label: 'Threads' },
                ]}
                selectedId={feedTab}
                onChange={(id) => {
                  setActiveIndex(0);
                  setFeedTab(id as 'following' | 'for-you');
                }}
              />
            </View>

            <View style={styles.buyerTopCluster}>
              <TouchableOpacity
                style={styles.buyerTopBtnCompact}
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  setBuyerSearchOpen(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Search"
                hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                testID="buyer-home-search"
              >
                <Feather name="search" size={20} color={ON_DARK} />
              </TouchableOpacity>
              <ActivityBellButton color={ON_DARK} size={20} style={styles.buyerTopBtnCompact} badgeBorderColor={BG} />
              <Animated.View ref={cartTargetRef} style={[styles.buyerTopBtnCompact, { transform: [{ scale: cartPulse }] }]}>
              <TouchableOpacity
                style={styles.buyerTopBtnCompact}
                activeOpacity={0.7}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/(buyer)/cart' as never);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Open cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}`}
              >
                <Feather name="shopping-cart" size={20} color={ON_DARK} />
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
          )}
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
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  progressHitArea: {
    position: 'absolute', left: 16, right: 16, height: 28, justifyContent: 'center',
  },
  progressTrack: {
    borderRadius: RADII.pill, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.25)',
  },
  progressFill: {
    height: '100%', borderRadius: RADII.pill, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: '#fff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.6, shadowRadius: 4,
  },
  scrubBubble: {
    position: 'absolute', bottom: 22, minWidth: 40, alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.sm,
    backgroundColor: 'rgba(0,0,0,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
  },
  scrubBubbleText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 11, ...TABULAR_NUMS },
  scrubThumb: {
    position: 'absolute', top: '50%', width: 13, height: 13, borderRadius: 7,
    marginTop: -6.5, marginLeft: -6.5,
    borderWidth: 2, borderColor: ON_DARK,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.4, shadowRadius: 3, elevation: 4,
  },
  speedPill: {
    position: 'absolute', top: '42%', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(0,0,0,0.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
  },
  speedPillText: { color: ON_DARK, fontFamily: FONT.bold, fontSize: 13 },
  mediaDot: { width: 5, height: 5, borderRadius: RADII.pill, backgroundColor: `${ON_DARK}80` },
  mediaDotActive: { width: 18, backgroundColor: ON_DARK },
  // Shop side tab: collapsed flush against the left screen edge (26pt of a
  // 28pt-wide tab sticks out), only the two exposed corners rounded so it
  // reads as attached to the edge rather than floating. Fully solid fill,
  // no blur/shimmer — see the ShopSideTab component comment above for why.
  shopSideTab: {
    position: 'absolute', left: 0, top: '57%', height: 76,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderTopRightRadius: 12, borderBottomRightRadius: 12,
    borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  shopSideTabCollapsed: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8,
  },
  // A plain horizontal row (label, then icon) — normal, unrotated layout —
  // rotated as a whole once it's already sized. Centering this on both axes
  // keeps it centered in the tab regardless of its rotated bounding box.
  shopSideTabCollapsedStack: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    transform: [{ rotate: '-90deg' }],
  },
  shopSideTabLabel: {
    color: ON_DARK, fontFamily: FONT.bold, fontSize: 11, letterSpacing: 1.5,
  },
  // A sleek, narrow strip — 44pt tall (roughly the same visual height
  // family as the collapsed tab, not a noticeably taller card), name and
  // price sharing one line so it never needs two rows of text.
  shopSideTabExpanded: {
    position: 'absolute', top: 16, left: 0, right: 0, height: 44,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 6, gap: 8,
  },
  shopSideTabThumb: {
    width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: ON_DARK, overflow: 'hidden', flexShrink: 0,
  },
  shopSideTabName: { flexShrink: 1, color: ON_DARK, fontFamily: FONT.semibold, fontSize: 13 },
  shopSideTabPrice: { flexShrink: 0, color: ON_DARK, fontFamily: FONT.bold, fontSize: 13, ...TABULAR_NUMS },

  rail: {
    position: 'absolute', right: 10, width: 52, bottom: 116, alignItems: 'center', gap: 19,
  },
  railAvatarWrap: { alignItems: 'center', marginBottom: 3 },
  railAvatar: {
    width: 44, height: 44, borderRadius: RADII.pill, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: ON_DARK,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 4,
  },
  railAvatarText: { fontSize: FS.sm, fontFamily: FONT.bold, color: ON_DARK },
  railFollowBadge: {
    position: 'absolute', bottom: -8, width: 20, height: 20, borderRadius: RADII.pill,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#000',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.35, shadowRadius: 3, elevation: 3,
  },
  railBtn: { width: 48, alignItems: 'center', gap: 3 },
  railActionContent: { width: 48, alignItems: 'center', gap: 3 },
  railLikeWrap: { width: 48, alignItems: 'center', justifyContent: 'center' },
  railLikeRing: {
    position: 'absolute', top: 4, width: 34, height: 34, borderRadius: RADII.pill,
    borderWidth: 2, borderColor: '#EF4444',
  },
  railCount: {
    fontSize: 11, lineHeight: 13, fontFamily: FONT.bold, color: ON_DARK, ...TABULAR_NUMS,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },

  // The bottom-left stack's vertical rhythm is one consistent system, set
  // as explicit per-step margins (not a single uniform `gap`, since each
  // step needs its own value): creator name row -> 6pt -> caption -> 8pt ->
  // sound line -> (CAPTION_BOTTOM_GAP, on the container's own `bottom`
  // above) -> progress bar. The shop tag no longer starts this stack (it's
  // the screen-edge ShopSideTab now) — minHeight shrunk by its old
  // 44pt-tall pill + 12pt gap (56pt) accordingly, so there's no leftover
  // reserved space where it used to sit.
  bottomInfo: {
    position: 'absolute', left: 16, right: 84, bottom: 26, minHeight: 56,
    justifyContent: 'flex-end',
  },
  bottomInfoWithRepost: { minHeight: 92 },
  repostIdentity: {
    alignSelf: 'flex-start', maxWidth: '100%', minHeight: 32, marginBottom: 12,
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
    fontSize: 14.5, fontFamily: FONT.medium, color: ON_DARK, marginBottom: 8,
    lineHeight: 20.5, letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  moreText: { fontFamily: FONT.bold, color: ON_DARK },
  creatorRow: { minHeight: 30, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 7 },
  creatorName: {
    fontSize: FS.base + 3, fontFamily: FONT.bold, color: ON_DARK, flexShrink: 1, letterSpacing: 0.1,
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },
  soundRow: {
    height: 24, flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', paddingHorizontal: 9, borderRadius: RADII.pill,
    backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  soundText: { fontSize: FS.xs, fontFamily: FONT.medium, color: `${ON_DARK}D9`, flexShrink: 1 },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 10, paddingBottom: 4 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  buyerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: 2 },
  // Compact 36×36 visual footprint with 5pt hitSlop on every button above =
  // a real 44×44+ touch target while leaving the centered pill enough room
  // to breathe at 375pt width (5 icon buttons + LIVE badge otherwise crowd
  // "Following"/"Threads" onto two lines).
  buyerTopBtnCompact: { width: 33, height: 36, alignItems: 'center', justifyContent: 'center' },
  // Full 44x44 touch target — used by the creator-profile-videos player's
  // simpler back/cart top bar (isCreatorFeed), distinct from the compact
  // buyer Threads Home top row above which needs to fit more controls.
  buyerTopBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  buyerTopCluster: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  buyerTabSwitcherWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  buyerCartBadge: { top: 3, right: 1 },
  liveJumpBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36,
    paddingHorizontal: 8, borderRadius: RADII.pill,
    backgroundColor: 'rgba(0,0,0,0.32)', borderWidth: 1, borderColor: 'rgba(255,59,48,0.55)',
  },
  liveJumpDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' },
  liveJumpText: { fontSize: 10, letterSpacing: 0.6, fontFamily: FONT.bold, color: ON_DARK },
  buyerSearchRow: {
    flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: RADII.pill,
    // Solid fill (bumped from 0.32 now that there's no BlurView underneath
    // adding its own contrast) instead of a blur-over-video background.
    overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.24)',
  },
  buyerSearchInput: {
    flex: 1, height: 44, paddingHorizontal: 10, fontSize: FS.sm, fontFamily: FONT.regular, color: ON_DARK,
  },
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
  creatorTitle: {
    flex: 1, textAlign: 'center', fontSize: FS.base, fontFamily: FONT.semibold, color: ON_DARK,
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2,
  },
  creatorRetry: {
    minHeight: 44, minWidth: 140, paddingHorizontal: SP.lg, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center',
  },
  creatorRetryText: { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
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
    width: '100%', height: 72, alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: '#000000',
  },
  feedFooterText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
});
