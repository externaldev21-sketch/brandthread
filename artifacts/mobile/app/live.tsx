/**
 * LIVE — full-screen vertical pager of live shopping streams.
 *
 * Opened from the LIVE button in the Threads header, or from any creator
 * avatar wearing a LIVE ring (feed rail, profiles, Messages rows) with
 * `?streamId=` / `?hostId=` to land on that creator's stream.
 *
 * Reuses the Threads feed's pager primitives rather than a new pager: the
 * same snap-per-page FlatList config (lib/feedPager.ts) and the same
 * `VideoVisual` player (poster-first, plays only the focused active page,
 * neighbours stay mounted so the next stream is already buffered — no black
 * frames between swipes).
 *
 * Data comes from the provider-agnostic `LiveStreamProvider`
 * (lib/live/liveProvider.ts): local preview streams in `?bt_preview=buyer`,
 * the real /api/live backend otherwise.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, FlatList, KeyboardAvoidingView, Platform,
  Pressable, Share, StyleSheet, Text, View, type GestureResponderEvent, type ViewToken,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoLinking from 'expo-linking';
import { CachedImage } from '@/components/CachedImage';
import { ShopProductSheet, type ShopSheetSelection } from '@/components/ShopProductSheet';
import { Snackbar } from '@/components/ui/Snackbar';
import { FONT, FS, RADIUS } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';
import { profileHref } from '@/lib/profileNavigation';
import { verticalPagerListProps, VERTICAL_PAGER_VIEWABILITY } from '@/lib/feedPager';
import { getLiveStreamProvider } from '@/lib/live/liveProvider';
import { useLivePager, LIVE_END_ANIMATION_MS, type LiveRuntime } from '@/lib/live/useLivePager';
import { liveShopSelection } from '@/lib/live/liveShop';
import type { LiveStream } from '@/lib/live/types';
import {
  LiveChatList, LiveCommentBar, LiveHeartLayer, LiveHostPill, LivePinnedProductCard, LiveRail,
  LiveViewerStack, type LiveHeartLayerHandle,
} from '@/components/live/LiveOverlays';
import { LiveProductsSheet } from '@/components/live/LiveProductsSheet';
import { LiveEmptyState } from '@/components/live/LiveEmptyState';
import { VideoVisual } from './(tabs)/feed';

/** Same preference key as the Threads feed, so sound on/off carries over. */
const SOUND_PREF_KEY = 'bt:feed-sound-on:v1';
const ND = Platform.OS !== 'web';

// ─── One stream page ─────────────────────────────────────────────────────────

function LivePage({
  stream, rt, isActive, ending, pageWidth, pageHeight, topInset, bottomInset, muted,
  onClose, onToggleSound, onFollow, onOpenHost, onBuy, onOpenBag, onShare, onLike, onSend, onOpenRtcPlayer,
}: {
  stream: LiveStream;
  rt: LiveRuntime | undefined;
  isActive: boolean;
  ending: boolean;
  pageWidth: number;
  pageHeight: number;
  topInset: number;
  bottomInset: number;
  muted: boolean;
  onClose: () => void;
  onToggleSound: () => void;
  onFollow: () => void;
  onOpenHost: () => void;
  onBuy: (productId: string) => void;
  onOpenBag: () => void;
  onShare: () => void;
  onLike: (x: number, y: number, count?: number) => void;
  onSend: (text: string) => Promise<void>;
  onOpenRtcPlayer: () => void;
}) {
  const exit = useRef(new Animated.Value(0)).current;
  const [liked, setLiked] = useState(false);
  const lastTap = useRef(0);

  useEffect(() => {
    Animated.timing(exit, { toValue: ending ? 1 : 0, duration: LIVE_END_ANIMATION_MS, useNativeDriver: ND }).start();
  }, [ending, exit]);

  const viewerCount = rt?.viewerCount ?? stream.viewerCount;
  const likeCount = rt?.likeCount ?? stream.likeCount;
  const pinnedId = rt?.pinnedProductId ?? stream.pinnedProductId;
  const pinned = stream.products.find(p => p.productId === pinnedId) ?? null;

  // Double-tap anywhere on the video: heart burst at the finger + like.
  const onVideoPress = (e: GestureResponderEvent) => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      const { pageX, pageY } = e.nativeEvent;
      setLiked(true);
      onLike(pageX, pageY, 4);
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  };

  const video = stream.video;
  return (
    <Animated.View
      style={{
        width: pageWidth, height: pageHeight, backgroundColor: '#000', overflow: 'hidden',
        opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] }) }],
      }}
      testID={`live-page-${stream.id}`}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onVideoPress} accessible={false}>
        {video.kind === 'video' ? (
          <VideoVisual
            source={video.source as never}
            isActive={isActive}
            paused={ending}
            muted={muted}
            posterSource={video.posterSource}
            posterUri={video.posterUri ?? undefined}
            immersive
            pageAspect={pageWidth / Math.max(1, pageHeight)}
            pageWidth={pageWidth}
            pageHeight={pageHeight}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.rtcWrap]}>
            {video.posterUri ? <CachedImage source={{ uri: video.posterUri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={18} /> : null}
            {/* Real streams need a native RTC SDK (Agora) to render video —
                hand off to the existing Agora viewer until a vendor-backed
                renderer is plugged into the provider. */}
            <Pressable onPress={onOpenRtcPlayer} style={styles.rtcBtn} accessibilityRole="button" accessibilityLabel="Open live video player">
              <Feather name="play" size={16} color="#000" />
              <Text style={styles.rtcBtnText}>Watch live video</Text>
            </Pressable>
          </View>
        )}
      </Pressable>

      {/* Legibility scrims */}
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} style={[styles.topScrim, { height: topInset + 110 }]} />
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.7)']} locations={[0, 0.4, 1]} style={[styles.bottomScrim, { height: bottomInset + 360 }]} />

      {/* Top-left host pill · top-right viewers + close */}
      <View style={[styles.topRow, { top: topInset + 8 }]} pointerEvents="box-none">
        <LiveHostPill
          host={stream.host}
          viewerCount={viewerCount}
          following={stream.followedByViewer}
          onFollow={onFollow}
          onOpenHost={onOpenHost}
        />
        <View style={styles.topRight}>
          <LiveViewerStack viewers={stream.topViewers} />
          <Pressable onPress={onToggleSound} style={styles.topIcon} accessibilityRole="button" accessibilityLabel={muted ? 'Turn sound on' : 'Mute'} hitSlop={6} testID="live-sound">
            <Feather name={muted ? 'volume-x' : 'volume-2'} size={17} color="#fff" />
          </Pressable>
          <Pressable onPress={onClose} style={styles.topIcon} accessibilityRole="button" accessibilityLabel="Close live and go back to Threads" hitSlop={8} testID="live-close">
            <Feather name="x" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>
      <Text style={[styles.title, { top: topInset + 56 }]} numberOfLines={1}>{stream.title}</Text>

      {/* Right rail */}
      <View style={[styles.railWrap, { bottom: bottomInset + 52 + (pinned ? 74 : 0) + 8 }]} pointerEvents="box-none">
        <LiveRail
          likeCount={likeCount}
          liked={liked}
          productCount={stream.products.length}
          onLike={({ x, y }) => { setLiked(true); onLike(x, y, 3); }}
          onShare={onShare}
          onOpenBag={onOpenBag}
        />
      </View>

      {/* Bottom: chat, pinned product, comment bar */}
      <View style={[styles.bottom, { paddingBottom: bottomInset + 10 }]} pointerEvents="box-none">
        <View style={styles.chatWrap} pointerEvents="none">
          <LiveChatList messages={rt?.chat ?? []} />
        </View>
        {pinned && (
          <LivePinnedProductCard product={pinned} onBuy={() => onBuy(pinned.productId)} onOpenBag={onOpenBag} />
        )}
        <View style={styles.commentRow}>
          <LiveCommentBar onSend={onSend} disabled={ending} />
        </View>
      </View>
    </Animated.View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function LiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ streamId?: string; hostId?: string }>();
  const provider = useMemo(() => getLiveStreamProvider(), []);
  const pager = useLivePager(provider, { streamId: params.streamId ?? null, hostId: params.hostId ?? null });
  const { streams, activeIndex, setActiveIndex } = pager;

  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;
  const listRef = useRef<FlatList<LiveStream>>(null);
  const heartsRef = useRef<LiveHeartLayerHandle>(null);
  const [muted, setMuted] = useState(true);
  const [bagFor, setBagFor] = useState<LiveStream | null>(null);
  const [shopSelection, setShopSelection] = useState<ShopSheetSelection | null>(null);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(SOUND_PREF_KEY).then(v => { if (v === 'on') setMuted(false); }).catch(() => {});
    void AccessibilityInfo.isReduceMotionEnabled?.().then(setReduceMotion).catch(() => setReduceMotion(false));
  }, []);

  useEffect(() => {
    if (pager.endedNotice) { setNotice(pager.endedNotice); pager.clearEndedNotice(); }
  }, [pager]);

  // After a stream is removed, keep the list's scroll offset on the page
  // the pager chose (the next stream) instead of whatever slid under it.
  const prevLen = useRef(streams.length);
  useEffect(() => {
    if (streams.length < prevLen.current && streams.length > 0 && pageHeight > 0) {
      listRef.current?.scrollToOffset({ offset: activeIndex * pageHeight, animated: false });
    }
    prevLen.current = streams.length;
  }, [streams.length, activeIndex, pageHeight]);

  const close = useCallback(() => {
    hapticLight();
    if (router.canGoBack()) router.back();
    else router.replace('/(buyer)' as never);
  }, [router]);

  const toggleSound = useCallback(() => {
    setMuted(m => {
      const next = !m;
      AsyncStorage.setItem(SOUND_PREF_KEY, next ? 'off' : 'on').catch(() => {});
      return next;
    });
  }, []);

  const share = useCallback(async (stream: LiveStream) => {
    const url = ExpoLinking.createURL('/live', { queryParams: { streamId: stream.id } });
    try {
      await Share.share({ message: `${stream.host.name} is live on Brandthread: ${stream.title}\n${url}`, url });
    } catch { /* dismissed */ }
  }, []);

  const buy = useCallback((stream: LiveStream, productId: string) => {
    const sel = liveShopSelection(stream, productId, provider.id === 'preview');
    if (!sel) return;
    setBagFor(null);
    setShopSelection(sel);
  }, [provider.id]);

  const openHost = useCallback((hostId: string, name?: string, handle?: string, initials?: string) => {
    router.push(profileHref({ userId: hostId, accountType: 'seller', name, handle, initials }) as never);
  }, [router]);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setActiveIndex(first.index);
  }).current;
  const viewabilityConfig = useRef(VERTICAL_PAGER_VIEWABILITY).current;

  const bottomInset = Math.max(insets.bottom, 10);
  const topInset = Math.max(insets.top, Platform.OS === 'web' ? 10 : 0);
  const ready = pageWidth > 0 && pageHeight > 0;

  return (
    <View
      style={styles.root}
      testID="live-screen"
      onLayout={({ nativeEvent }) => {
        const w = Math.round(nativeEvent.layout.width);
        const h = Math.round(nativeEvent.layout.height);
        if (w > 0 && h > 0 && (w !== viewport.width || h !== viewport.height)) setViewport({ width: w, height: h });
      }}
    >
      {pager.loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.loadingText}>Finding lives…</Text>
        </View>
      ) : streams.length === 0 ? (
        <>
          <LiveEmptyState
            upcoming={pager.upcoming}
            suggested={pager.suggested}
            error={pager.error}
            topInset={topInset}
            bottomInset={bottomInset}
            onRemind={pager.setReminder}
            onFollow={pager.setFollowing}
            onOpenCreator={id => openHost(id)}
          />
          <Pressable onPress={close} style={[styles.emptyClose, { top: topInset + 8 }]} accessibilityRole="button" accessibilityLabel="Close live and go back to Threads" testID="live-close">
            <Feather name="x" size={22} color="#888" />
          </Pressable>
        </>
      ) : ready ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <FlatList
            ref={listRef}
            key={`live-${pageWidth}x${pageHeight}`}
            data={streams}
            keyExtractor={s => s.id}
            initialScrollIndex={pager.initialIndex > 0 && pager.initialIndex < streams.length ? pager.initialIndex : undefined}
            {...verticalPagerListProps(pageHeight, streams.length)}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            keyboardShouldPersistTaps="handled"
            testID="live-pager"
            renderItem={({ item, index }) => (
              <LivePage
                stream={item}
                rt={pager.runtime[item.id]}
                isActive={index === activeIndex}
                ending={!!pager.ending[item.id]}
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                topInset={topInset}
                bottomInset={bottomInset}
                muted={muted}
                onClose={close}
                onToggleSound={toggleSound}
                onFollow={() => { void pager.setFollowing(item.host.id, !item.followedByViewer); }}
                onOpenHost={() => openHost(item.host.id, item.host.name, item.host.handle, item.host.initials)}
                onBuy={pid => buy(item, pid)}
                onOpenBag={() => setBagFor(item)}
                onShare={() => { void share(item); }}
                onLike={(x, y, count) => { heartsRef.current?.burst(x, y, count); pager.like(item.id); }}
                onSend={async text => {
                  try { await pager.sendChat(text); } catch (e: any) {
                    setNotice(e?.message ? String(e.message) : 'Message not sent');
                    throw e;
                  }
                }}
                onOpenRtcPlayer={() => router.push(`/buyer-live?streamId=${encodeURIComponent(item.id)}` as never)}
              />
            )}
          />
          <LiveHeartLayer ref={heartsRef} />
        </KeyboardAvoidingView>
      ) : null}

      {bagFor && (
        <LiveProductsSheet
          visible
          hostName={bagFor.host.name}
          products={bagFor.products}
          pinnedProductId={pager.runtime[bagFor.id]?.pinnedProductId ?? bagFor.pinnedProductId}
          onBuy={pid => buy(bagFor, pid)}
          onClose={() => setBagFor(null)}
        />
      )}
      {shopSelection && (
        <ShopProductSheet
          selection={shopSelection}
          onClose={() => setShopSelection(null)}
          reduceMotion={reduceMotion}
        />
      )}
      <Snackbar visible={!!notice} message={notice} onDismiss={() => setNotice('')} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: 'rgba(255,255,255,0.7)', fontFamily: FONT.medium, fontSize: FS.sm },
  rtcWrap: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0A0B' },
  rtcBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: RADIUS.pill, paddingHorizontal: 18, height: 42 },
  rtcBtnText: { color: '#000', fontFamily: FONT.bold, fontSize: FS.sm },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  topRow: { position: 'absolute', left: 10, right: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  topIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  title: {
    position: 'absolute', left: 14, right: 90, color: 'rgba(255,255,255,0.9)', fontFamily: FONT.medium, fontSize: 12,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3,
  },
  railWrap: { position: 'absolute', right: 8 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, gap: 10 },
  chatWrap: { marginRight: 64, maxHeight: 210, justifyContent: 'flex-end' },
  commentRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emptyClose: { position: 'absolute', right: 10, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
});
