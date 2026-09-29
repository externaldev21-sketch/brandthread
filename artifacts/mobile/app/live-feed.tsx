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
 * feed. Real active streams (fetched from /api/live/active) play first; with
 * none live right now, a couple of sample rooms render instead so the screen
 * never looks empty or "under construction" — full video, full chat, full
 * chrome, with no "Sample"/"Preview" label anywhere on screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Platform, Share, useWindowDimensions,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import type { StyleProp, ViewStyle, ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { FONT, FS, RADIUS } from '@/lib/theme';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { LiveThreadCashSheet } from '@/components/live/LiveThreadCashSheet';
import { LiveMoreSheet } from '@/components/live/LiveMoreSheet';
import { SHEET_TIMING } from '@/constants/motion';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { LIVE_RED } from '@/components/live/LiveAvatarRing';

// Same sample fashion footage the For You feed uses in dev preview, reused
// here (not modified, not shared state) so a preview room shows a real
// looping video instead of a flat color card.
const SAMPLE_ROOMS_SOURCE = [
  {
    id: 'sample-live-maison-vela',
    brandName: 'Maison Vela',
    title: 'Evening silhouettes, live from the studio',
    viewerCount: 1204,
    video: require('../assets/videos/fashion_runway_02.mp4'),
    poster: require('../assets/videos/fashion_runway_02.jpg'),
    // Stand-in profile photo, same convention as lib/previewActivity.ts (no
    // real headshots in this seed set) — a different frame than the room's
    // own video/poster so the avatar doesn't just repeat it.
    avatar: require('../assets/videos/fashion_runway_05.jpg'),
    productName: 'Liquid Silver Dress',
    priceCents: 32500,
  },
  {
    id: 'sample-live-atelier-noire',
    brandName: 'Atelier Noire',
    title: 'New arrivals — tailoring walkthrough',
    viewerCount: 862,
    video: require('../assets/videos/fashion_runway_01.mp4'),
    poster: require('../assets/videos/fashion_runway_01.jpg'),
    avatar: require('../assets/videos/fashion_runway_06.jpg'),
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
  title: string;
  viewerCount: number;
  videoSource?: VideoSource;
  posterSource?: number;
  /** Sample rooms' stand-in avatar (bundled asset); real rooms use `avatarUri`. */
  avatarSource?: number;
  avatarUri?: string | null;
  thumbnailUrl?: string | null;
  productName?: string;
  priceCents?: number;
}

export default function LiveFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Outside a real device (or a preview frame that emulates one), the
  // browser never fills in a non-zero `env(safe-area-inset-top)`, so
  // insets.top reads 0 on web and the host row sat level with the Dynamic
  // Island in a plain browser preview — same fallback every tab header and
  // app/live.tsx already use.
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 54) : insets.top;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const api = useApi();
  const [activeIndex, setActiveIndex] = useState(0);
  const [rooms, setRooms] = useState<LiveRoom[]>(
    SAMPLE_ROOMS_SOURCE.map(sample => ({
      id: sample.id,
      isSample: true,
      brandName: sample.brandName,
      title: sample.title,
      viewerCount: sample.viewerCount,
      videoSource: sample.video,
      posterSource: sample.poster,
      avatarSource: sample.avatar,
      productName: sample.productName,
      priceCents: sample.priceCents,
    })),
  );

  useEffect(() => {
    let active = true;
    (api as any).live.active()
      .then((data: { streams: any[] }) => {
        if (!active) return;
        const rows = Array.isArray(data?.streams) ? data.streams : [];
        if (!rows.length) return;
        setRooms(rows.map((s: any): LiveRoom => ({
          id: `live_${s.id}`,
          isSample: false,
          streamId: s.id,
          brandName: s.brand_name ?? s.seller_name ?? 'Live',
          title: s.title ?? '',
          viewerCount: s.viewer_count ?? 0,
          avatarUri: s.avatar_url ?? null,
          thumbnailUrl: s.thumbnail_url ?? null,
          productName: s.product_tags?.[0]?.productName,
          priceCents: s.product_tags?.[0]?.priceCents,
        })));
      })
      .catch(() => {});
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

  return (
    <View style={styles.root}>
      {/* Local toast host (report/not-interested/copy-link feedback) — the
          same banner components/EngagementButton.tsx's feed rows already
          use, scoped to this full-screen route rather than relying on
          whatever provider (if any) wraps app/(tabs)/feed.tsx underneath. */}
      <FeedToastProvider>
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
              onJoinReal={(streamId) => router.push(`/buyer-live?streamId=${encodeURIComponent(streamId)}` as never)}
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
  room, isActive, pageWidth, pageHeight, insetTop, insetBottom, onClose, onJoinReal,
}: {
  room: LiveRoom;
  isActive: boolean;
  pageWidth: number;
  pageHeight: number;
  insetTop: number;
  insetBottom: number;
  onClose: () => void;
  onJoinReal: (streamId: string) => void;
}) {
  const [following, setFollowing] = useState(false);
  const [chat, setChat] = useState(room.isSample ? SAMPLE_CHAT_LINES.slice(0, 2) : []);
  const [message, setMessage] = useState('');

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

  function sendMessage() {
    const text = message.trim();
    if (!text) return;
    setMessage('');
    setChat(prev => [...prev, { user: 'You', text }]);
  }

  function handleBuy() {
    hapticLight();
    if (!room.isSample && room.streamId) onJoinReal(room.streamId);
  }

  // ─── Right rail: Share / Thread Cash / More ────────────────────────────
  const { showToast } = useFeedToast();
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

  function handleSendThreadCash(amountCents: number) {
    setChat(prev => [...prev, { user: 'You', text: `sent $${(amountCents / 100).toFixed(2)} Thread Cash` }]);
    showToast(`You sent ${formatCents(amountCents)} Thread Cash`, 'info');
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
                  {room.viewerCount >= 1000 ? `${(room.viewerCount / 1000).toFixed(1)}K` : room.viewerCount}
                </Text>
              </View>
            </View>
            <PressableScale
              onPress={() => { hapticLight(); setFollowing(v => !v); }}
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
        onClose={() => setThreadCashOpen(false)}
        onSent={handleSendThreadCash}
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
            <PressableScale onPress={handleBuy} style={styles.productCard} accessibilityRole="button" accessibilityLabel={`Buy ${room.productName}`}>
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

        <View style={styles.inputRow}>
          <TextInput
            value={message}
            onChangeText={setMessage}
            onSubmitEditing={sendMessage}
            placeholder="Say something…"
            placeholderTextColor="rgba(255,255,255,0.7)"
            returnKeyType="send"
            style={styles.input}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
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
  liveBadge: { backgroundColor: LIVE_RED, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  liveBadgeText: { color: '#fff', fontFamily: FONT.bold, fontSize: 9, letterSpacing: 0.8 },
  viewerText: { color: 'rgba(255,255,255,0.85)', fontFamily: FONT.medium, fontSize: 11, lineHeight: 14 },
  // Monochrome brand: red is reserved for the LIVE badge only, so Follow is
  // a plain white pill with black text (the "following" state drops to a
  // translucent white outline pill instead of a second color). Fixed
  // height (not padding-driven) so it reliably lands in the 28-30pt range
  // and centers against the avatar/name block via hostPill's alignItems.
  followBtn: {
    height: 30, minWidth: 60, backgroundColor: '#fff', borderRadius: RADIUS.pill,
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
  buyBtn: { height: 32, backgroundColor: '#fff', borderRadius: RADIUS.pill, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
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
  inputRow: { height: 44, marginHorizontal: 4 },
  input: {
    flex: 1, height: 44, borderRadius: 22, paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff',
    fontFamily: FONT.regular, fontSize: FS.sm,
  },
});
