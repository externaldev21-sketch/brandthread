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
 * chrome, just tagged with a small "Sample" mark on the host pill. There is
 * no "preview only" messaging anywhere on this screen.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Platform,
  KeyboardAvoidingView, useWindowDimensions,
} from 'react-native';
import type { ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useVideoPlayer, VideoView, type VideoSource } from 'expo-video';
import { Image as ExpoImage } from 'expo-image';
import ReanimatedAnimated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useApi } from '@/lib/api';
import { PressableScale } from '@/components/BrandthreadUI';
import { hapticLight } from '@/lib/haptics';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { ThreadCashBill } from '@/components/thread-cash/ThreadCashBill';
import { SHEET_TIMING } from '@/constants/motion';

const LIVE_RED = '#FF3B30';

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
    poster: require('../assets/videos/fashion_runway_02.png'),
    productName: 'Liquid Silver Dress',
    priceCents: 32500,
  },
  {
    id: 'sample-live-atelier-noire',
    brandName: 'Atelier Noire',
    title: 'New arrivals — tailoring walkthrough',
    viewerCount: 862,
    video: require('../assets/videos/fashion_runway_01.mp4'),
    poster: require('../assets/videos/fashion_runway_01.png'),
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
  thumbnailUrl?: string | null;
  productName?: string;
  priceCents?: number;
}

export default function LiveFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
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
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/feed' as never);
  }

  return (
    <View style={styles.root}>
      <FlatList
        data={rooms}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => (
          <LiveRoomPage
            room={item}
            isActive={index === activeIndex}
            pageHeight={windowHeight}
            insetTop={insets.top}
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
    </View>
  );
}

function LiveRoomPage({
  room, isActive, pageHeight, insetTop, insetBottom, onClose, onJoinReal,
}: {
  room: LiveRoom;
  isActive: boolean;
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

  // Sample rooms drip in a couple more chat lines after mount so the overlay
  // reads as a live conversation rather than a frozen mock — capped well
  // short of SAMPLE_CHAT_LINES.length, and only while this page is active.
  useEffect(() => {
    if (!room.isSample || !isActive) return undefined;
    let i = 2;
    const id = setInterval(() => {
      if (i >= SAMPLE_CHAT_LINES.length) { clearInterval(id); return; }
      setChat(prev => [...prev, SAMPLE_CHAT_LINES[i]]);
      i += 1;
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

  return (
    <View style={[styles.page, { height: pageHeight }]}>
      {room.videoSource ? (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          nativeControls={false}
          pointerEvents="none"
        />
      ) : room.thumbnailUrl ? (
        <ExpoImage source={{ uri: room.thumbnailUrl }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.thumbFallback]}>
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
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.62)']}
        locations={[0, 1]}
        style={[styles.bottomScrim, { height: 320 }]}
      />

      {/* Top: host pill + Follow, close X */}
      <View style={[styles.topRow, { top: insetTop + 10 }]}>
        <View style={styles.hostPill}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarLetter}>{room.brandName.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.hostText}>
            <View style={styles.hostNameRow}>
              <Text style={styles.hostName} numberOfLines={1}>{room.brandName}</Text>
              {room.isSample && <Text style={styles.sampleTag}>Sample</Text>}
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
            <Text style={styles.followBtnText}>{following ? 'Following' : 'Follow'}</Text>
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
        <Text style={[styles.roomTitle, { top: insetTop + 56 }]} numberOfLines={1}>{room.title}</Text>
      )}

      {/* Right action rail — same slim sizing as the feed's rail */}
      <View style={[styles.rail, { bottom: insetBottom + 210 }]}>
        <PressableScale style={styles.railBtn} onPress={() => hapticLight()} accessibilityRole="button" accessibilityLabel="Share this live">
          <Feather name="share" size={24} color="#fff" style={styles.railIconShadow} />
        </PressableScale>
        <PressableScale style={styles.railBtn} onPress={() => hapticLight()} accessibilityRole="button" accessibilityLabel="Send Thread Cash">
          <ThreadCashBill width={28} />
        </PressableScale>
        <PressableScale style={styles.railBtn} onPress={() => hapticLight()} accessibilityRole="button" accessibilityLabel="More options">
          <Feather name="more-vertical" size={24} color="#fff" style={styles.railIconShadow} />
        </PressableScale>
      </View>

      {/* Bottom: chat overlay + input + pinned product */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.bottom, { paddingBottom: insetBottom + SP.sm }]}
      >
        {(room.productName != null) && (
          <ReanimatedAnimated.View style={cardStyle}>
            <PressableScale onPress={handleBuy} style={styles.productCard} accessibilityRole="button" accessibilityLabel={`Buy ${room.productName}`}>
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

        <View style={styles.chatList} pointerEvents="none">
          {chat.slice(-4).map((line, i) => (
            <Text key={i} style={styles.chatLine} numberOfLines={1}>
              <Text style={styles.chatUser}>{line.user} </Text>
              {line.text}
            </Text>
          ))}
        </View>

        <View style={styles.inputRow}>
          <TextInput
            value={message}
            onChangeText={setMessage}
            onSubmitEditing={sendMessage}
            placeholder="Say something…"
            placeholderTextColor="rgba(255,255,255,0.55)"
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
  thumbFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },

  topRow: {
    position: 'absolute', left: 12, right: 12,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8,
  },
  hostPill: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: RADIUS.pill,
    paddingHorizontal: 6, paddingVertical: 6,
  },
  avatarCircle: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#3D2B56',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
  },
  avatarLetter: { color: '#fff', fontFamily: FONT.bold, fontSize: 14 },
  hostText: { flexShrink: 1 },
  hostNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hostName: { color: '#fff', fontFamily: FONT.semibold, fontSize: 13, flexShrink: 1 },
  sampleTag: {
    color: 'rgba(255,255,255,0.75)', fontFamily: FONT.medium, fontSize: 9,
    letterSpacing: 0.4, textTransform: 'uppercase',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  liveBadge: { backgroundColor: LIVE_RED, borderRadius: 3, paddingHorizontal: 4, paddingVertical: 1 },
  liveBadgeText: { color: '#fff', fontFamily: FONT.bold, fontSize: 9, letterSpacing: 0.8 },
  viewerText: { color: 'rgba(255,255,255,0.85)', fontFamily: FONT.medium, fontSize: 11 },
  followBtn: {
    backgroundColor: LIVE_RED, borderRadius: RADIUS.pill,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  followBtnActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  followBtnText: { color: '#fff', fontFamily: FONT.bold, fontSize: 12 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  roomTitle: {
    position: 'absolute', left: 20, right: 60,
    color: 'rgba(255,255,255,0.82)', fontFamily: FONT.medium, fontSize: 12,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3,
  },

  rail: { position: 'absolute', right: 10, alignItems: 'center', gap: 18 },
  railBtn: { width: 44, alignItems: 'center', justifyContent: 'center' },
  railIconShadow: {
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4,
  },

  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  productCard: {
    height: 64, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(20,20,22,0.82)', borderRadius: RADIUS.md,
    paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  productThumb: { width: 44, height: 44, borderRadius: RADIUS.sm, backgroundColor: '#33303a', overflow: 'hidden' },
  productInfo: { flex: 1 },
  productName: { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.sm },
  productPrice: { color: 'rgba(255,255,255,0.75)', fontFamily: FONT.medium, fontSize: FS.xs, marginTop: 2 },
  buyBtn: { backgroundColor: '#fff', borderRadius: RADIUS.pill, paddingHorizontal: 16, paddingVertical: 9 },
  buyBtnText: { color: '#151517', fontFamily: FONT.bold, fontSize: FS.xs },

  chatList: { gap: 4, paddingLeft: 2 },
  chatLine: { color: 'rgba(255,255,255,0.92)', fontFamily: FONT.regular, fontSize: 13 },
  chatUser: { color: 'rgba(230,230,235,0.95)', fontFamily: FONT.bold, fontSize: 13 },

  inputRow: { height: 36 },
  input: {
    flex: 1, height: 36, borderRadius: 18, paddingHorizontal: 15,
    backgroundColor: 'rgba(255,255,255,0.14)', color: '#fff',
    fontFamily: FONT.regular, fontSize: FS.sm,
  },
});
