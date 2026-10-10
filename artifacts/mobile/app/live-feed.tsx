/**
 * Live Feed — the full-screen LIVE viewer opened from the header's TV glyph
 * on Threads Home. Its own route (fullScreenModal, fade — see app/_layout.tsx
 * and constants/motion.ts SHEET_TIMING) so it covers the search bar, the
 * Following/Threads tabs and the floating tab bar entirely, the way TikTok's
 * LIVE opens over For You. Closing returns to the feed exactly where the
 * buyer left it (router.back() — the For You pager itself is untouched
 * underneath, so its video resumes/stays paused exactly as it was).
 *
 * Swipe up/down between live rooms, same vertical pager feel as the For You
 * feed. Real active streams (fetched from /api/live/active) play first. The
 * fashion-runway sample rooms are dev-preview-only content, gated on
 * isPreviewDemoMode() same as every other seeded preview dataset in the app
 * (lib/devPreview.ts) — they must never appear for a real signed-in account,
 * and a fresh `?bt_preview=…` preview with no streams and no `&demo=1` shows
 * the real "nobody is live" empty state, not fake viewer counts/chat.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, Platform, Pressable, Share, ActivityIndicator,
  AccessibilityInfo, useWindowDimensions,
} from 'react-native';
import { Asset } from 'expo-asset';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import type { StyleProp, ViewStyle, ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { Image as ExpoImage } from 'expo-image';
import ReanimatedAnimated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useApi } from '@/lib/api';
import { PressableScale } from '@/components/BrandthreadUI';
import { FeedToastProvider, useFeedToast } from '@/components/EngagementButton';
import { hapticLight } from '@/lib/haptics';
import { formatCents } from '@/lib/money';
import { formatCompactCount } from '@/lib/compactFormat';
import { FONT, FS, RADIUS } from '@/lib/theme';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { LiveThreadCashSheet } from '@/components/live/LiveThreadCashSheet';
import { LiveMoreSheet } from '@/components/live/LiveMoreSheet';
import { LiveEmptyState } from '@/components/live/LiveEmptyState';
import { ShopProductSheet, type ShopSheetSelection } from '@/components/ShopProductSheet';
import { SHEET_TIMING } from '@/constants/motion';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { LIVE_RED } from '@/components/live/LiveAvatarRing';
import { isPreviewDemoMode } from '@/lib/devPreview';
import Composer from '@/components/ui/Composer';
import { useUser } from '@clerk/expo';
import { apiErrorMessage } from '@/lib/safety';
import {
  confirmLiveChatLine, latestLiveChatCursor, liveCommentsToLines, mergeLiveChat, type LiveChatLine,
} from '@/lib/live/liveFeedChat';
import { radius } from '@/constants/radii';

// Same sample fashion footage the For You feed uses in dev preview, reused
// here (not modified, not shared state) so a preview room shows a real
// looping video instead of a flat color card. Dev-preview-only: gated on
// isPreviewDemoMode() below, never shown to a real signed-in account or a
// fresh (no `&demo=1`) preview.
const SAMPLE_ROOMS_SOURCE = [
  {
    id: 'sample-live-maison-vela',
    brandName: 'Maison Vela',
    sellerId: 'sample-seller-maison-vela',
    sellerHandle: 'maisonvela',
    title: 'Evening silhouettes, live from the studio',
    viewerCount: 1204,
    video: require('../assets/videos/fashion_runway_02.mp4'),
    poster: require('../assets/videos/fashion_runway_02.jpg'),
    // Stand-in profile photo, same convention as lib/previewActivity.ts (no
    // real headshots in this seed set) — a different frame than the room's
    // own video/poster so the avatar doesn't just repeat it.
    avatar: require('../assets/videos/fashion_runway_05.jpg'),
    productId: 'sample-product-liquid-silver-dress',
    productName: 'Liquid Silver Dress',
    priceCents: 32500,
  },
  {
    id: 'sample-live-atelier-noire',
    brandName: 'Atelier Noire',
    sellerId: 'sample-seller-atelier-noire',
    sellerHandle: 'ateliernoire',
    title: 'New arrivals — tailoring walkthrough',
    viewerCount: 862,
    video: require('../assets/videos/fashion_runway_01.mp4'),
    poster: require('../assets/videos/fashion_runway_01.jpg'),
    avatar: require('../assets/videos/fashion_runway_06.jpg'),
    productId: 'sample-product-sculpted-blazer',
    productName: 'Sculpted Blazer',
    priceCents: 28500,
  },
] as const;

const SAMPLE_CHAT_LINES = [
  { user: 'jules_m', text: 'that fabric drapes so well 😍' },
  { user: 'k.reyes', text: 'is this restocking in size M?' },
  { user: 'annika', text: 'just ordered, so excited' },
  { user: 'priya_t', text: 'the color is even better in motion' },
  { user: 'devon91', text: 'love this collection' },
];

interface LiveRoom {
  id: string;
  isSample: boolean;
  streamId?: string;
  brandName: string;
  sellerId?: string;
  title: string;
  viewerCount: number;
  videoSource?: VideoSource;
  posterSource?: number;
  /** Sample rooms' stand-in avatar (bundled asset); real rooms use `avatarUri`. */
  avatarSource?: number;
  avatarUri?: string | null;
  thumbnailUrl?: string | null;
  productId?: string;
  productName?: string;
  priceCents?: number;
}

/**
 * "Buy" on a sample room opens the same real ShopProductSheet → cart →
 * checkout flow the Threads feed and app/live.tsx use — never a no-op.
 * Sample rooms have no real backend product to fetch, so (same pattern as
 * lib/live/liveShop.ts's previewLiveBuyerProduct) this builds the sheet's
 * `previewProduct` locally from the room's own data; the sheet still runs
 * its real addToCart()/checkout path against it.
 */
function previewLiveFeedProduct(room: LiveRoom): ShopSheetSelection | null {
  if (!room.productId || !room.productName || room.priceCents == null || !room.sellerId) return null;
  const posterUri = room.posterSource != null ? Asset.fromModule(room.posterSource).uri : undefined;
  const optionId = `${room.productId}-size`;
  const sizes = ['XS', 'S', 'M', 'L'].map(label => ({ id: `${optionId}-${label.toLowerCase()}`, label }));
  return {
    postId: `live-feed-${room.id}`,
    postSellerId: room.sellerId,
    activeTagIndex: 0,
    tags: [{ productId: room.productId, productName: room.productName, priceCents: room.priceCents }],
    previewProduct: {
      id: room.productId,
      sellerId: room.sellerId,
      sellerName: room.brandName,
      sellerHandle: room.brandName.toLowerCase().replace(/[^a-z0-9]/g, ''),
      name: room.productName,
      description: `Selling live now on ${room.brandName}'s stream — ${room.title}.`,
      priceCents: room.priceCents,
      imageUris: posterUri ? [posterUri] : [],
      category: 'High Fashion',
      isPreOrder: false,
      cancellationPolicy: 'Preview item — no real order will be placed.',
      refundPolicy: 'Returns accepted within 14 days of delivery for unworn items with tags attached.',
      options: [{ id: optionId, name: 'Size', values: sizes }],
      variants: sizes.map((size, index) => ({
        id: `${room.productId}-variant-${size.label.toLowerCase()}`,
        title: size.label,
        optionValues: [{ optionId, valueId: size.id }],
        priceCents: room.priceCents!,
        inventoryQuantity: 2 + index * 2,
        isAvailable: true,
        imageUri: posterUri,
      })),
      isActive: true,
      tags: ['live', 'preview'],
    },
  };
}

export default function LiveFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const api = useApi();
  const [activeIndex, setActiveIndex] = useState(0);
  const showDemoRooms = isPreviewDemoMode();
  const [rooms, setRooms] = useState<LiveRoom[]>(
    showDemoRooms
      ? SAMPLE_ROOMS_SOURCE.map(sample => ({
        id: sample.id,
        isSample: true,
        brandName: sample.brandName,
        sellerId: sample.sellerId,
        title: sample.title,
        viewerCount: sample.viewerCount,
        videoSource: sample.video,
        posterSource: sample.poster,
        avatarSource: sample.avatar,
        productId: sample.productId,
        productName: sample.productName,
        priceCents: sample.priceCents,
      }))
      : [],
  );
  // Only meaningful while there's a real fetch to wait on — the demo cast
  // above renders immediately, and a fresh preview with no `&demo=1` has
  // nothing to fetch (see below), so the empty state shows right away
  // instead of behind a placeholder spinner.
  const [loadingReal, setLoadingReal] = useState(!showDemoRooms);

  useEffect(() => {
    let active = true;
    (api as any).live.active()
      .then((data: { streams: any[] }) => {
        if (!active) return;
        const rows = Array.isArray(data?.streams) ? data.streams : [];
        if (rows.length) {
          setRooms(rows.map((s: any): LiveRoom => ({
            id: `live_${s.id}`,
            isSample: false,
            streamId: s.id,
            brandName: s.brand_name ?? s.seller_name ?? 'Live',
            sellerId: s.seller_id,
            title: s.title ?? '',
            viewerCount: s.viewer_count ?? 0,
            avatarUri: s.avatar_url ?? null,
            thumbnailUrl: s.thumbnail_url ?? null,
            productId: s.product_tags?.[0]?.productId,
            productName: s.product_tags?.[0]?.productName,
            priceCents: s.product_tags?.[0]?.priceCents,
          })));
        }
      })
      .catch(() => {})
      .finally(() => { if (active) setLoadingReal(false); });
    return () => { active = false; };
  }, [api]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setActiveIndex(viewableItems[0].index);
    }
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  function close() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    goBackOr(router, '/(tabs)/feed');
  }

  // "Buy" opens the same shared Shop sheet → cart → checkout flow as the
  // Threads feed and app/live.tsx — the room's own video keeps playing
  // behind it, nothing pauses.
  const [shopSelection, setShopSelection] = useState<ShopSheetSelection | null>(null);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled?.().then(setReduceMotion).catch(() => setReduceMotion(false));
  }, []);

  function buy(room: LiveRoom) {
    hapticLight();
    if (!room.productId) return;
    if (room.isSample) {
      setShopSelection(previewLiveFeedProduct(room));
      return;
    }
    setShopSelection({
      postId: `live-feed-${room.id}`,
      postSellerId: room.sellerId,
      activeTagIndex: 0,
      tags: [{ productId: room.productId, productName: room.productName ?? '', priceCents: room.priceCents ?? 0 }],
    });
  }

  return (
    <View style={styles.root}>
      {/* Local toast host (report/not-interested/copy-link feedback) — the
          same banner components/EngagementButton.tsx's feed rows already
          use, scoped to this full-screen route rather than relying on
          whatever provider (if any) wraps app/(tabs)/feed.tsx underneath. */}
      <FeedToastProvider>
        {loadingReal ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : rooms.length === 0 ? (
          <>
            <LiveEmptyState
              upcoming={[]}
              suggested={[]}
              topInset={topInset}
              bottomInset={insets.bottom}
              onRemind={() => {}}
              onFollow={() => {}}
              onOpenCreator={() => {}}
            />
            <Pressable onPress={close} style={[styles.emptyClose, { top: topInset + 8 }]} accessibilityRole="button" accessibilityLabel="Close live and go back to Threads">
              <Feather name="x" size={22} color="#888" />
            </Pressable>
          </>
        ) : (
          <FlatList
            data={rooms}
            keyExtractor={item => item.id}
            renderItem={({ item, index }) => (
              <LiveRoomPage
                room={item}
                isActive={index === activeIndex}
                pageWidth={windowWidth}
                pageHeight={windowHeight}
                insetTop={topInset}
                insetBottom={insets.bottom}
                onClose={close}
                onBuy={() => buy(item)}
              />
            )}
            pagingEnabled
            disableIntervalMomentum
            showsVerticalScrollIndicator={false}
            decelerationRate="fast"
            bounces={false}
            alwaysBounceVertical={false}
            overScrollMode="never"
            getItemLayout={(_, index) => ({ length: windowHeight, offset: windowHeight * index, index })}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
          />
        )}
        {shopSelection && (
          <ShopProductSheet
            selection={shopSelection}
            onClose={() => setShopSelection(null)}
            reduceMotion={reduceMotion}
          />
        )}
      </FeedToastProvider>
    </View>
  );
}

/**
 * Lazily requires expo-blur (same pattern as IconButton.tsx's GlassBlur) so
 * screens that never render the pinned product card don't pull the native
 * blur module into their bundle. Skipped on Android at the call site, where
 * the flat productCardTint below stands in.
 */
function ProductCardBlur({ style }: { style?: StyleProp<ViewStyle> }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BlurView } = require('expo-blur') as { BlurView: typeof import('expo-blur').BlurView };
    return <BlurView intensity={35} tint="dark" style={style} />;
  } catch {
    return null;
  }
}

function LiveRoomPage({
  room, isActive, pageWidth, pageHeight, insetTop, insetBottom, onClose, onBuy,
}: {
  room: LiveRoom;
  isActive: boolean;
  pageWidth: number;
  pageHeight: number;
  insetTop: number;
  insetBottom: number;
  onClose: () => void;
  onBuy: () => void;
}) {
  const api = useApi();
  const { user } = useUser();
  const { showToast } = useFeedToast();
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [chat, setChat] = useState<LiveChatLine[]>(room.isSample ? SAMPLE_CHAT_LINES.slice(0, 2) : []);
  const [message, setMessage] = useState('');
  const chatRef = useRef<LiveChatLine[]>(chat);
  chatRef.current = chat;

  // Real rooms: the Follow pill starts from the viewer's actual follow state
  // (GET /api/social/status) instead of always reading "Follow". Sample
  // rooms (`&demo=1` only) have no real host account to follow.
  useEffect(() => {
    if (room.isSample || !room.sellerId) return undefined;
    let cancelled = false;
    api.social.status(room.sellerId)
      .then(res => { if (!cancelled) setFollowing(!!res?.isFollowing); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [api, room.isSample, room.sellerId]);

  async function toggleFollow() {
    hapticLight();
    if (room.isSample) { setFollowing(v => !v); return; }
    if (!room.sellerId || followBusy) return;
    const was = following;
    setFollowing(!was);
    setFollowBusy(true);
    try {
      if (was) await api.social.unfollow(room.sellerId);
      else await api.social.follow(room.sellerId);
    } catch (error) {
      setFollowing(was);
      showToast(apiErrorMessage(error, was ? 'Could not unfollow. Try again.' : 'Could not follow. Try again.'), 'error');
    } finally {
      setFollowBusy(false);
    }
  }

  // Real rooms: live chat comes from the server — everyone else's messages
  // as well as your own — polled while this room is the active page.
  useEffect(() => {
    if (room.isSample || !room.streamId || !isActive) return undefined;
    const streamId = room.streamId;
    let cancelled = false;
    const load = () => {
      api.live.comments(streamId, latestLiveChatCursor(chatRef.current))
        .then(res => {
          if (cancelled) return;
          setChat(prev => mergeLiveChat(prev, liveCommentsToLines(res?.comments)));
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, room.isSample, room.streamId, isActive]);

  // The pinned product card fades/rises in on the shared no-bounce sheet
  // timeline (withTiming only, same curve every sheet in the app uses) —
  // never a spring, so it never overshoots into a bounce.
  const cardIn = useSharedValue(0);
  useEffect(() => {
    cardIn.value = withTiming(isActive ? 1 : 0, { duration: SHEET_TIMING.openMs, easing: SHEET_TIMING.easing });
  }, [isActive, cardIn]);
  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardIn.value,
    transform: [{ translateY: (1 - cardIn.value) * 12 }],
  }));

  const player = useVideoPlayer(room.videoSource ?? null, p => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (!player) return;
    if (isActive) player.play(); else player.pause();
  }, [isActive, player]);

  // The poster (already fetched as part of the room's data, and already
  // rendered elsewhere in this file for the pinned product card) wasn't
  // being rendered under the video at all — every room opened to a hard
  // black frame until the video finished loading over the dev server. Fade
  // the video in once it reports a real playable frame so the poster is
  // never left showing under the loaded video, and never re-shown once the
  // fade has completed (readyToPlay can fire more than once).
  const videoOpacity = useSharedValue(0);
  const [videoReady, setVideoReady] = useState(false);
  useEffect(() => {
    if (!player) return undefined;
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay') {
        setVideoReady(true);
        videoOpacity.value = withTiming(1, { duration: 220 });
      }
    });
    return () => sub.remove();
  }, [player, videoOpacity]);
  const videoStyle = useAnimatedStyle(() => ({ opacity: videoOpacity.value }));

  // Sample rooms drip in a couple more chat lines after mount so the overlay
  // reads as a live conversation rather than a frozen mock — capped well
  // short of SAMPLE_CHAT_LINES.length, and only while this page is active.
  useEffect(() => {
    if (!room.isSample || !isActive) return undefined;
    let i = 2;
    const id = setInterval(() => {
      // Capture the line before incrementing — the previous version read
      // SAMPLE_CHAT_LINES[i] lazily inside the setChat updater, by which
      // point i had already been bumped past the array's end, pushing
      // `undefined` into chat and crashing the render below on
      // `line.user`.
      const next = SAMPLE_CHAT_LINES[i];
      i += 1;
      if (!next) { clearInterval(id); return; }
      setChat(prev => [...prev, next]);
    }, 2600);
    return () => clearInterval(id);
  }, [room.isSample, isActive]);

  async function sendMessage() {
    const text = message.trim();
    if (!text) return;
    setMessage('');
    if (room.isSample) {
      setChat(prev => [...prev, { user: 'You', text }]);
      return;
    }
    if (!room.streamId) return;
    // Optimistic line, swapped for the server's row on success; on failure
    // (moderation, network) it's withdrawn and the draft restored.
    const localId = `local_${Date.now()}`;
    setChat(prev => [...prev, { id: localId, user: 'You', text }]);
    try {
      const res = await api.live.comment(room.streamId, {
        message: text,
        displayName: user?.firstName ?? user?.username ?? undefined,
      });
      const [confirmed] = liveCommentsToLines(res?.comment ? [res.comment] : []);
      setChat(prev => (confirmed ? confirmLiveChatLine(prev, localId, confirmed) : prev));
    } catch (error) {
      setChat(prev => prev.filter(l => l.id !== localId));
      setMessage(text);
      showToast(apiErrorMessage(error, 'Message not sent. Try again.'), 'error');
    }
  }

  // ─── Right rail: Share / Thread Cash / More ────────────────────────────
  const [threadCashOpen, setThreadCashOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [dataSaver, setDataSaver] = useState(false);
  const roomLink = `https://brandthread.app/live/${room.streamId ?? room.id}`;

  async function handleShare() {
    hapticLight();
    const message_ = `${room.brandName} is live on Brandthread — ${room.title}`;
    if (Platform.OS === 'web') {
      const nav = (globalThis as any).navigator;
      if (nav?.share) {
        try { await nav.share({ title: room.brandName, text: message_, url: roomLink }); } catch { /* user cancelled */ }
        return;
      }
      try {
        await Clipboard.setStringAsync(roomLink);
        showToast('Link copied to clipboard', 'info');
      } catch {
        showToast('Could not copy link', 'error');
      }
      return;
    }
    try {
      await Share.share({ message: `${message_} ${roomLink}`, url: roomLink });
    } catch {
      showToast('Could not share this live', 'error');
    }
  }

  // Only called once the gift really went through (LiveThreadCashSheet
  // awaits api.threadCash.liveGift for real rooms) — never on a failure.
  function handleSendThreadCash(amountCents: number) {
    setChat(prev => [...prev, { user: 'You', text: `sent $${(amountCents / 100).toFixed(2)} Thread Cash` }]);
    showToast(`You sent ${formatCents(amountCents)} Thread Cash`, 'info');
  }

  function handleThreadCashFailed(messageText: string) {
    showToast(messageText, 'error');
  }

  async function handleCopyLink() {
    try {
      await Clipboard.setStringAsync(roomLink);
      showToast('Link copied to clipboard', 'info');
    } catch {
      showToast('Could not copy link', 'error');
    }
  }

  function handleReport() {
    showToast('Thanks for the report. Our team will review this live.', 'info');
  }

  function handleNotInterested() {
    showToast('We’ll show you fewer lives like this.', 'info');
  }

  // Data Saver has a real, observable effect — freezing playback on the
  // poster frame — rather than being a toggle that does nothing (house
  // rule: no dead buttons). It only pauses; the active/inactive effect
  // above remains the source of truth for whether this page *should* be
  // playing at all, so leaving the room's page still resumes normally.
  useEffect(() => {
    if (!player || !isActive) return;
    if (dataSaver) player.pause(); else player.play();
  }, [dataSaver, player, isActive]);

  return (
    <View style={[styles.page, { height: pageHeight }]}>
      {room.videoSource ? (
        <>
          {room.posterSource && !videoReady && (
            <ExpoImage
              source={room.posterSource}
              style={[styles.video, { width: pageWidth, height: pageHeight }]}
              contentFit="cover"
            />
          )}
          {/* Explicit numeric width/height, not just absoluteFill: on web the
              style lands on a <video> element, which ignores inset-only
              sizing and renders at its own intrinsic size instead — left
              uncentered and cropped off-subject (see the same fix/comment on
              VideoVisual in app/(tabs)/feed.tsx, where this was first
              found). */}
          <ReanimatedAnimated.View style={[styles.video, { width: pageWidth, height: pageHeight }, videoStyle]}>
            <VideoView
              player={player}
              style={{ width: pageWidth, height: pageHeight }}
              contentFit="cover"
              nativeControls={false}
              pointerEvents="none"
            />
          </ReanimatedAnimated.View>
        </>
      ) : room.thumbnailUrl ? (
        <ExpoImage source={{ uri: room.thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.thumbFallback]}>
          <Feather name="video" size={36} color="rgba(255,255,255,0.4)" />
        </View>
      )}

      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']}
        locations={[0, 1]}
        style={[styles.topScrim, { height: insetTop + 120 }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
        locations={[0, 1]}
        style={[styles.bottomScrim, { height: 320 }]}
      />

      {/* Top: host pill + Follow, close X. A single column flow — the
          capsule's own height is driven entirely by its content (never a
          fixed height), and the subtitle below it is a normal flow sibling
          with its own 6pt top margin, so it can never straddle the
          capsule's bottom edge no matter how tall the capsule renders.
          `insetTop + 8` keeps this at least 8pt clear of the Dynamic Island
          (native: insets.top + 8; web: the 54pt fallback + 8 = 62). */}
      <View style={[styles.topArea, { top: insetTop + 8 }]}>
        <View style={styles.topRow}>
          <View style={styles.hostPill}>
            <View style={styles.avatarCircle}>
              {(room.avatarSource || room.avatarUri) ? (
                <ExpoImage
                  source={room.avatarSource ?? { uri: room.avatarUri! }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                />
              ) : (
                <Text style={styles.avatarLetter}>{room.brandName.slice(0, 1).toUpperCase()}</Text>
              )}
            </View>
            <View style={styles.hostText}>
              <View style={styles.hostNameRow}>
                <Text style={styles.hostName} numberOfLines={1}>{room.brandName}</Text>
              </View>
              <View style={styles.liveRow}>
                <View style={styles.liveBadge}>
                  <Text style={styles.liveBadgeText}>LIVE</Text>
                </View>
                <Feather name="eye" size={11} color="rgba(255,255,255,0.85)" />
                <Text style={styles.viewerText}>
                  {formatCompactCount(room.viewerCount)}
                </Text>
              </View>
            </View>
            <PressableScale
              onPress={() => { void toggleFollow(); }}
              style={[styles.followBtn, following && styles.followBtnActive]}
              accessibilityRole="button"
              accessibilityLabel={following ? `Following ${room.brandName}` : `Follow ${room.brandName}`}
            >
              <Text style={[styles.followBtnText, following && styles.followBtnTextActive]}>{following ? 'Following' : 'Follow'}</Text>
            </PressableScale>
          </View>
          <PressableScale
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close live"
          >
            <Feather name="x" size={22} color="#fff" />
          </PressableScale>
        </View>
        {room.title.length > 0 && (
          <Text style={styles.roomTitle} numberOfLines={1}>{room.title}</Text>
        )}
      </View>

      {/* Right action rail — same slim sizing/gap/shadow/right-inset as the
          feed's own rail (components/buyer-feed/RightActionRail.tsx), and
          anchored to the top of the bottom chrome instead of floating at a
          fixed mid-screen offset. */}
      <View style={[styles.rail, { bottom: insetBottom + 56 + (room.productName != null ? 72 : 0) }]}>
        <PressableScale style={styles.railBtn} onPress={handleShare} accessibilityRole="button" accessibilityLabel="Share this live">
          <Feather name="share" size={26} color="#fff" style={styles.railIconShadow} />
        </PressableScale>
        <PressableScale style={styles.railBtn} onPress={() => { hapticLight(); setThreadCashOpen(true); }} accessibilityRole="button" accessibilityLabel="Send Thread Cash">
          {/* ThreadCashBillIcon, not the full <ThreadCashBill/> — below its
              ~32pt threshold the full bill's art just turns to mush, which is
              why the gift icon effectively vanished from the rail before. */}
          <ThreadCashBillIcon size={26} />
        </PressableScale>
        <PressableScale style={styles.railBtn} onPress={() => { hapticLight(); setMoreOpen(true); }} accessibilityRole="button" accessibilityLabel="More options">
          <Feather name="more-vertical" size={26} color="#fff" style={styles.railIconShadow} />
        </PressableScale>
      </View>

      {captionsOn && chat.filter(Boolean).length > 0 && (
        <View pointerEvents="none" style={[styles.captionStrip, { bottom: insetBottom + 128 + (room.productName != null ? 72 : 0) }]}>
          {(() => {
            const last = chat.filter(Boolean)[chat.filter(Boolean).length - 1];
            return (
              <Text style={styles.captionText} numberOfLines={2}>
                <Text style={styles.captionUser}>{last.user}: </Text>
                {last.text}
              </Text>
            );
          })()}
        </View>
      )}

      <LiveThreadCashSheet
        visible={threadCashOpen}
        brandName={room.brandName}
        recipientId={room.isSample ? undefined : room.sellerId}
        streamId={room.isSample ? undefined : room.streamId}
        previewOnly={room.isSample}
        onClose={() => setThreadCashOpen(false)}
        onSent={handleSendThreadCash}
        onSendFailed={handleThreadCashFailed}
      />
      <LiveMoreSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        onReport={handleReport}
        onNotInterested={handleNotInterested}
        onCopyLink={handleCopyLink}
        captionsOn={captionsOn}
        onToggleCaptions={() => setCaptionsOn(v => !v)}
        dataSaverOn={dataSaver}
        onToggleDataSaver={() => setDataSaver(v => !v)}
      />

      {/* Bottom: chat overlay + input + pinned product. box-none: this
          wrapper's own box is transparent and grows tall as the chat drips
          in more lines, and it's later in paint order than the rail above —
          without box-none its empty space silently swallows taps meant for
          the rail once chat grows past a couple of lines (found live-testing
          the rail buttons below; chatWrap already opts out the same way). */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        pointerEvents="box-none"
        style={[styles.bottom, { paddingBottom: insetBottom + 12 }]}
      >
        {(room.productName != null) && (
          // The rail-clearance margin lives on this wrapper, not on
          // PressableScale's own `style` prop: PressableScale only applies
          // `style` to its inner visual box, so a margin passed there
          // narrows what's drawn but leaves the outer Pressable's actual
          // tap target full-width — silently stealing taps from the rail
          // buttons it visually stopped short of. Putting it on the
          // wrapper narrows the real tap target too.
          <ReanimatedAnimated.View style={[styles.productCardWrap, cardStyle]}>
            <PressableScale onPress={onBuy} style={styles.productCard} accessibilityRole="button" accessibilityLabel={`Buy ${room.productName}`}>
              {Platform.OS !== 'android' && <ProductCardBlur style={StyleSheet.absoluteFill} />}
              <View style={[StyleSheet.absoluteFill, styles.productCardTint]} pointerEvents="none" />
              {room.posterSource ? (
                <ExpoImage source={room.posterSource} style={styles.productThumb} contentFit="cover" />
              ) : (
                <View style={styles.productThumb} />
              )}
              <View style={styles.productInfo}>
                <Text style={styles.productName} numberOfLines={1}>{room.productName}</Text>
                <Text style={styles.productPrice}>{formatCents(room.priceCents ?? 0)}</Text>
              </View>
              <View style={styles.buyBtn}>
                <Text style={styles.buyBtnText}>Buy</Text>
              </View>
            </PressableScale>
          </ReanimatedAnimated.View>
        )}

        <View style={styles.chatWrap} pointerEvents="none">
          {/* Soft fade at the top edge only, so the oldest visible message
              never ends in a hard cutoff line. */}
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} style={styles.chatTopFade} />
          <View style={styles.chatList}>
            {chat.filter(Boolean).slice(-4).map((line, i) => (
              <Text key={i} style={styles.chatLine} numberOfLines={2}>
                <Text style={styles.chatUser}>{line.user} </Text>
                {line.text}
              </Text>
            ))}
          </View>
        </View>

        <Composer
          overMedia
          value={message}
          onChangeText={setMessage}
          onSend={sendMessage}
          placeholder="Say something…"
          hideTabBar={false}
          testID="live-feed-composer"
        />
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyClose: { position: 'absolute', right: 8, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  page: { width: '100%', backgroundColor: '#000' },
  video: { position: 'absolute', top: 0, left: 0 },
  thumbFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },

  // Wraps topRow + roomTitle so the subtitle is a normal flow sibling below
  // the capsule instead of a second absolutely-positioned element guessing
  // the capsule's height.
  topArea: { position: 'absolute', left: 12, right: 12 },
  topRow: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
  },
  hostPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: RADIUS.pill,
    // 8pt of capsule padding all round — the capsule's height is driven by
    // its tallest child (the Follow button), never a fixed height.
    padding: 8,
  },
  avatarCircle: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#3D2B56', overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
  },
  avatarLetter: { color: '#fff', fontFamily: FONT.bold, fontSize: 14 },
  hostText: { flexShrink: 1 },
  hostNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hostName: { color: '#fff', fontFamily: FONT.semibold, fontSize: 13, flexShrink: 1 },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, height: 14 },
  liveBadge: { backgroundColor: LIVE_RED, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2 },
  liveBadgeText: { color: '#fff', fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 0.8 },
  viewerText: { color: 'rgba(255,255,255,0.85)', fontFamily: FONT.medium, fontSize: 11, lineHeight: 14 },
  // Monochrome brand: red is reserved for the LIVE badge only, so Follow is
  // a plain white pill with black text (the "following" state drops to a
  // translucent white outline pill instead of a second color). Fixed
  // height (not padding-driven) so it reliably lands in the 28-30pt range
  // and centers against the avatar/name block via hostPill's alignItems.
  followBtn: {
    height: 30, minWidth: 60, backgroundColor: '#fff', borderRadius: radius.sm,
    paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
  },
  followBtnActive: { backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  followBtnText: { color: '#000', fontFamily: FONT.semibold, fontSize: 13 },
  followBtnTextActive: { color: '#fff' },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  // Normal flow now (a topArea sibling below topRow), not absolutely
  // positioned against a guessed capsule height — 6pt clear of the capsule,
  // never straddling its edge, whatever the capsule's actual height is.
  roomTitle: {
    marginTop: 6,
    color: 'rgba(255,255,255,0.82)', fontFamily: FONT.medium, fontSize: 12,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },

  rail: { position: 'absolute', right: 10, width: 38, alignItems: 'center', gap: 14 },
  railBtn: { width: 38, alignItems: 'center', justifyContent: 'center' },
  railIconShadow: {
    textShadowColor: 'rgba(0,0,0,0.45)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 4,
  },

  // Captions toggle (More sheet): the newest chat line, larger and centered,
  // over the video — same rail-clearance margin as the pinned product card.
  captionStrip: {
    position: 'absolute', left: 12, right: 56, alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.sm, paddingHorizontal: 10, paddingVertical: 6,
  },
  captionText: {
    color: '#fff', fontFamily: FONT.medium, fontSize: 14, textAlign: 'center', lineHeight: 18,
  },
  captionUser: { fontFamily: FONT.bold },

  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  // The rail sits at right:10, width:38 (occupying the rightmost 48pt of
  // the screen) — this keeps the card's right edge a clear 12pt further
  // in, so it never runs under the rail regardless of viewport width. See
  // the comment at this wrapper's call site for why it's here and not on
  // productCard's own style.
  productCardWrap: { marginRight: 48 },
  productCard: {
    height: 64, flexDirection: 'row', alignItems: 'center', gap: 10,
    // Solid fallback color: the blur (ProductCardBlur) and the translucent
    // productCardTint layer above it are what actually reads as "subtle
    // dark blur" on iOS/web; on Android (no blur) this alone stands in.
    backgroundColor: '#17171A', borderRadius: RADIUS.md, overflow: 'hidden',
    paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  productCardTint: { backgroundColor: 'rgba(20,20,22,0.45)' },
  productThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#33303a', overflow: 'hidden' },
  productInfo: { flex: 1 },
  productName: { color: '#fff', fontFamily: FONT.semibold, fontSize: 15 },
  productPrice: { color: 'rgba(255,255,255,0.75)', fontFamily: FONT.medium, fontSize: 13, marginTop: 2 },
  buyBtn: { height: 32, backgroundColor: '#fff', borderRadius: radius.sm, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  buyBtnText: { color: '#151517', fontFamily: FONT.bold, fontSize: FS.xs },

  chatWrap: { maxWidth: '70%' },
  chatTopFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 20 },
  chatList: { gap: 4, paddingLeft: 2 },
  chatLine: {
    color: 'rgba(255,255,255,0.92)', fontFamily: FONT.regular, fontSize: 13,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },
  chatUser: {
    color: 'rgba(230,230,235,0.95)', fontFamily: FONT.semibold, fontSize: 13,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },

  // 16pt insets (the shared `bottom` container already gives 12pt; +4pt here).
});
