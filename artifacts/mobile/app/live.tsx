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
  AccessibilityInfo, ActivityIndicator, Animated, FlatList, Platform,
  Pressable, Share, StyleSheet, Text, View, type GestureResponderEvent, type ViewToken,
} from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoLinking from 'expo-linking';
import { buildLiveUrl } from '@/lib/shareLinks';
import { CachedImage } from '@/components/CachedImage';
import { ShopProductSheet, type ShopSheetSelection } from '@/components/ShopProductSheet';
import { Snackbar } from '@/components/ui/Snackbar';
import { FONT, FS } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { hapticLight } from '@/lib/haptics';
import { profileHref } from '@/lib/profileNavigation';
import { useApi } from '@/lib/api';
import { confirmBlock, reportHref } from '@/lib/safety';
import { verticalPagerListProps, VERTICAL_PAGER_VIEWABILITY } from '@/lib/feedPager';
import { getLiveStreamProvider } from '@/lib/live/liveProvider';
import { useLivePager, LIVE_END_ANIMATION_MS, type LiveRuntime } from '@/lib/live/useLivePager';
import { liveShopSelection } from '@/lib/live/liveShop';
import { fetchLiveCodes, describeLiveCode, type LiveCode } from '@/lib/live/liveCommerce';
import { clearLiveCheckoutContext, getLiveCheckoutContext, setLiveCheckoutContext } from '@/lib/live/liveCheckoutContext';
import type { LiveStream } from '@/lib/live/types';
import {
  LiveChatList, LiveCommentBar, LiveHeartLayer, LiveHostPill, LivePinnedProductCard, LiveRail,
  type LiveHeartLayerHandle,
} from '@/components/live/LiveOverlays';
import { LiveProductsSheet } from '@/components/live/LiveProductsSheet';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { LiveThreadCashSheet } from '@/components/live/LiveThreadCashSheet';
import { LiveStreamOptionsSheet } from '@/components/live/LiveStreamOptionsSheet';
import { LiveEmptyState } from '@/components/live/LiveEmptyState';
import { VideoVisual } from './(tabs)/feed';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { a11yHidden } from '@/lib/a11yHidden';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { LIVE_VIEWER_GESTURE } from '@/lib/firstRunTips/content';
import { radius } from '@/constants/radii';

/** Same preference key as the Threads feed, so sound on/off carries over. */
const SOUND_PREF_KEY = 'bt:feed-sound-on:v1';
const ND = Platform.OS !== 'web';

// ─── One stream page ─────────────────────────────────────────────────────────

function LivePage({
  stream, rt, isActive, ending, pageWidth, pageHeight, topInset, bottomInset, muted,
  onClose, onToggleSound, onFollow, onOpenHost, onBuy, onOpenBag, onShare, onGift, onMore, onLike, onSend, onOpenRtcPlayer,
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
  /** Undefined while the `live_tips` flag is OFF: the gift button is then not rendered. */
  onGift?: () => void;
  /** Report this live stream / block its host. */
  onMore: () => void;
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

  // Poster/video fade in together as soon as this page mounts, instead of
  // popping straight from the page's own background color — the poster (or
  // the host's own color, see the page's backgroundColor below) is visible
  // immediately and the media just gets more opaque on top of it, never a
  // hard cut from a blank frame.
  const mediaFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(mediaFade, { toValue: 1, duration: 280, useNativeDriver: ND }).start();
  }, [mediaFade]);

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
        width: pageWidth, height: pageHeight, backgroundColor: stream.host.avatarColor, overflow: 'hidden',
        opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] }) }],
      }}
      testID={`live-page-${stream.id}`}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: mediaFade }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onVideoPress} accessible={false}>
        {video.kind === 'video' ? (
          <>
          {/* Poster underlay: VideoVisual drops its own poster on the
              `play` event, a beat before the first frame paints — without
              this the page's own background flashed for a frame as each
              stream became active. Never conditionally unmounted on
              `hasStarted` here — it stays put the whole time so the media
              fade above never crossfades against a blank layer. */}
          {(video.posterSource || video.posterUri) ? (
            <CachedImage
              source={video.posterSource ?? { uri: video.posterUri! }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              {...a11yHidden(true, 'no')}
            />
          ) : null}
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
          </>
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
      </Animated.View>

      {/* Legibility scrims */}
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0)']} style={[styles.topScrim, { height: topInset + 110 }]} />
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.7)']} locations={[0, 0.4, 1]} style={[styles.bottomScrim, { height: bottomInset + 360 }]} />

      {/* One creator identity + follow action on the left, close on the right. Sits at
          topInset + 6, below the safe area (Dynamic Island on device, and
          TabPageHeader's 67pt web fallback when insets.top reads 0 in a
          plain browser preview) — never level with the notch. Mute lives in
          the right rail now, not crammed into this row. */}
      <View style={[styles.topRow, { top: topInset + 6 }]} pointerEvents="box-none">
        <LiveHostPill
          host={stream.host}
          viewerCount={viewerCount}
          following={stream.followedByViewer}
          onFollow={onFollow}
          onOpenHost={onOpenHost}
        />
        <Pressable onPress={onClose} style={styles.topIcon} accessibilityRole="button" accessibilityLabel="Close live and go back to Threads" hitSlop={8} testID="live-close">
          <Feather name="x" size={22} color="#fff" />
        </Pressable>
      </View>
      <Text style={[styles.title, { top: topInset + 68 }]} numberOfLines={1}>{stream.title}</Text>

      {/* Right rail */}
      <View style={[styles.railWrap, { bottom: bottomInset + 52 + (pinned ? 74 : 0) + 8 }]} pointerEvents="box-none">
        <LiveRail
          likeCount={likeCount}
          liked={liked}
          productCount={stream.products.length}
          muted={muted}
          onLike={({ x, y }) => { setLiked(true); onLike(x, y, 3); }}
          onShare={onShare}
          onOpenBag={onOpenBag}
          onToggleSound={onToggleSound}
        />
      </View>

      {/* Bottom: chat, pinned product, comment bar */}
      <View style={[styles.bottom, { paddingBottom: bottomInset + 8 }]} pointerEvents="box-none">
        <View style={styles.chatWrap} pointerEvents="none">
          {/* Fades only the top edge of the chat list into the scrim behind
              it — no hard cutoff, no half-cut line on the topmost message. */}
          <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} style={styles.chatTopFade} />
          <LiveChatList messages={rt?.chat ?? []} />
        </View>
        {pinned && (
          <LivePinnedProductCard product={pinned} onBuy={() => onBuy(pinned.productId)} onOpenBag={onOpenBag} />
        )}
        <LiveCommentBar onSend={onSend} disabled={ending} onGift={onGift} onShare={onShare} onMore={onMore} />
      </View>
    </Animated.View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function LiveScreen() {
  const router = useRouter();
  const api = useApi();
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
  const [giftFor, setGiftFor] = useState<LiveStream | null>(null);
  // Server-side `live_tips` flag via the existing feature-flags context; a failed
  // flag call keeps the OFF default, so the gift button just stays hidden.
  const liveTipsEnabled = useFeatureFlag('live_tips');
  const [optionsFor, setOptionsFor] = useState<LiveStream | null>(null);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [notice, setNotice] = useState('');
  const [liveCodes, setLiveCodes] = useState<LiveCode[]>([]);
  const [appliedCode, setAppliedCode] = useState<string | null>(null);

  // Live-only codes for the stream whose bag is open (real streams only —
  // the preview provider has no backend).
  const bagStreamId = bagFor?.id ?? null;
  useEffect(() => {
    setLiveCodes([]);
    if (!bagStreamId || provider.id === 'preview') return undefined;
    let alive = true;
    setAppliedCode(getLiveCheckoutContext()?.streamId === bagStreamId ? getLiveCheckoutContext()?.code ?? null : null);
    fetchLiveCodes(bagStreamId).then(codes => { if (alive) setLiveCodes(codes); }).catch(() => {});
    return () => { alive = false; };
  }, [bagStreamId, provider]);

  // Leaving the live ends "shopping from this live" for discount purposes.
  useEffect(() => () => clearLiveCheckoutContext(), []);

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
    goBackOr(router, '/(buyer)');
  }, [router]);

  const toggleSound = useCallback(() => {
    setMuted(m => {
      const next = !m;
      AsyncStorage.setItem(SOUND_PREF_KEY, next ? 'off' : 'on').catch(() => {});
      return next;
    });
  }, []);

  const share = useCallback(async (stream: LiveStream) => {
    // https link (BT-320): unfurls in Messages/WhatsApp/IG and opens for
    // people without the app; brandthread:// and exp:// do neither.
    const url = buildLiveUrl(stream.id) ?? ExpoLinking.createURL('/live', { queryParams: { streamId: stream.id } });
    try {
      await Share.share({ message: `${stream.host.name} is live on Brandthread: ${stream.title}\n${url}`, url });
    } catch { /* dismissed */ }
  }, []);

  const gift = useCallback((stream: LiveStream) => {
    hapticLight();
    setGiftFor(stream);
  }, []);

  // Report/block — same reportHref()/confirmBlock() flow the real-time RTC
  // viewer (app/buyer-live.tsx) already uses, so a report lands in the same
  // moderation queue either way. Not Alert.alert though: react-native-web's
  // Alert.alert is a no-op (see LiveStreamOptionsSheet's doc comment), which
  // is exactly why buyer-live.tsx's equivalent menu silently does nothing in
  // the web preview — a real Modal-based sheet instead.
  const openStreamOptions = useCallback((stream: LiveStream) => {
    hapticLight();
    setOptionsFor(stream);
  }, []);

  const reportStream = useCallback((stream: LiveStream) => {
    router.push(reportHref({
      targetType: 'live',
      targetId: stream.id,
      label: stream.title,
      ownerId: stream.host.id,
      ownerName: stream.host.name,
    }) as never);
  }, [router]);

  const blockStreamHost = useCallback(async (stream: LiveStream) => {
    if (await confirmBlock({ userId: stream.host.id, name: stream.host.name }, api.social.block)) {
      pager.removeStream(stream.id, stream.host.name);
    }
  }, [api, pager]);

  const handleGiftSent = useCallback(async (stream: LiveStream, amountCents: number) => {
    setGiftFor(null);
    try {
      await pager.sendChat(`sent ${formatCents(amountCents)} Thread Cash`);
    } catch {
      // The transfer already went through — a failed chat post isn't worth
      // surfacing as an error on top of a successful gift.
    }
  }, [pager]);

  const handleGiftFailed = useCallback((message: string) => {
    setNotice(message);
  }, []);

  const buy = useCallback((stream: LiveStream, productId: string) => {
    const sel = liveShopSelection(stream, productId, provider.id === 'preview');
    if (!sel) return;
    if (provider.id !== 'preview') setLiveCheckoutContext({ streamId: stream.id, sellerId: stream.host.id });
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
  // Outside a real device (or a preview frame that emulates one), the browser
  // never fills in a non-zero `env(safe-area-inset-top)`, so insets.top reads
  // 0 on web and the host row sat level with the Dynamic Island in a plain
  // 390x844 preview — same fallback TabPageHeader uses for every tab page.
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
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
                onGift={liveTipsEnabled ? () => gift(item) : undefined}
                onMore={() => openStreamOptions(item)}
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
        </KeyboardAvoidingView>
      ) : null}

      {/* Sibling of the pager, not nested inside KeyboardAvoidingView or any
          per-page `overflow: hidden` container, so a heart burst is never
          clipped by the keyboard-shrunk view or a page's own bounds. */}
      {ready && <LiveHeartLayer ref={heartsRef} />}

      {bagFor && (
        <LiveProductsSheet
          visible
          hostName={bagFor.host.name}
          products={bagFor.products}
          pinnedProductId={pager.runtime[bagFor.id]?.pinnedProductId ?? bagFor.pinnedProductId}
          onBuy={pid => buy(bagFor, pid)}
          onClose={() => setBagFor(null)}
          codes={liveCodes}
          appliedCode={appliedCode}
          onApplyCode={code => {
            setLiveCheckoutContext({ streamId: bagFor.id, sellerId: bagFor.host.id, code });
            setAppliedCode(code);
            const c = liveCodes.find(x => x.code === code);
            setNotice(c ? `${code} applied: ${describeLiveCode(c)} at checkout` : `${code} applied at checkout`);
          }}
        />
      )}
      {shopSelection && (
        <ShopProductSheet
          selection={shopSelection}
          onClose={() => setShopSelection(null)}
          reduceMotion={reduceMotion}
        />
      )}
      {liveTipsEnabled && giftFor && (
        <LiveThreadCashSheet
          visible
          brandName={giftFor.host.name}
          recipientId={giftFor.host.id}
          streamId={giftFor.id}
          onClose={() => setGiftFor(null)}
          onSent={amountCents => { void handleGiftSent(giftFor, amountCents); }}
          onSendFailed={handleGiftFailed}
        />
      )}
      {optionsFor && (
        <LiveStreamOptionsSheet
          visible
          hostName={optionsFor.host.name}
          onClose={() => setOptionsFor(null)}
          onReport={() => reportStream(optionsFor)}
          onBlock={() => { void blockStreamHost(optionsFor); }}
        />
      )}
      <Snackbar visible={!!notice} message={notice} onDismiss={() => setNotice('')} />
      <FirstRunTip
        id="live-viewer"
        variant="gesture"
        contentReady
        gesture={LIVE_VIEWER_GESTURE}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: 'rgba(255,255,255,0.7)', fontFamily: FONT.medium, fontSize: FS.sm },
  rtcWrap: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0A0B' },
  rtcBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: radius.md, paddingHorizontal: 18, height: 42 },
  rtcBtnText: { color: '#000', fontFamily: FONT.bold, fontSize: FS.sm },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  topRow: { position: 'absolute', left: 12, right: 12, height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  topIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: {
    position: 'absolute', left: 14, right: 14, color: 'rgba(255,255,255,0.9)', fontFamily: FONT.medium, fontSize: 13,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3,
  },
  railWrap: { position: 'absolute', right: 8 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, gap: 8 },
  // LiveChatList itself caps to ~70% width (see LiveOverlays styles.chatList)
  // so it never runs under the right rail; this wrap just bounds its height
  // and anchors the top-fade gradient to the same box.
  chatWrap: { maxHeight: 210, justifyContent: 'flex-end' },
  chatTopFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 28 },
  emptyClose: { position: 'absolute', right: 8, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
