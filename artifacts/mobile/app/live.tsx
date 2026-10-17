/**
 * LIVE show viewer — one show full-bleed, swipe up/down to the next live
 * show. Laid out 1:1 with Whatnot's show screen (host + Follow top-left,
 * viewer pill + leave top-right, More/Share/Shop rail, chat, "Say
 * something...", the item being sold with a Buy now pill):
 *   https://mobbin.com/flows/ed55f754-472f-46f8-914b-ce7cb7345c7b
 *   https://mobbin.com/flows/5baa5304-2ba7-477e-b909-a09925c508fd
 * Hearts are TikTok LIVE's tap-to-like
 * (https://mobbin.com/flows/7824af04-b028-4359-8f08-59ca894677ad). The first
 * show a buyer opens asks for the buyer agreement first (Whatnot's
 * "Welcome to your first show!").
 *
 * Opened from a show in the LIVE grid (app/live-feed.tsx), or from any
 * creator avatar wearing a LIVE ring with `?streamId=` / `?hostId=`.
 *
 * Reuses the Threads feed's pager primitives (lib/feedPager.ts). Real shows
 * play the host's Agora video (components/live/LiveRtcVideo.tsx); preview
 * shows (`?bt_preview=…&demo=1` only) play bundled clips with `VideoVisual`.
 * No Agora key on the server → "LIVE isn't available yet", never a fake show.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, FlatList, Platform,
  Pressable, Share, StyleSheet, View, type GestureResponderEvent, type ViewToken,
} from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoLinking from 'expo-linking';
import { CachedImage } from '@/components/CachedImage';
import { ShopProductSheet, type ShopSheetSelection } from '@/components/ShopProductSheet';
import { Snackbar } from '@/components/ui/Snackbar';
import { FONT, FS, MEDIA } from '@/lib/theme';
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
import type { LiveChatMessage, LiveStream } from '@/lib/live/types';
import {
  LiveChatInput, LiveChatList, LiveHeartLayer, LiveHostRow, LiveProductCard, LiveRail, LiveTopRight,
  type LiveHeartLayerHandle,
} from '@/components/live/LiveOverlays';
import { LiveRtcVideo } from '@/components/live/LiveRtcVideo';
import { LiveNotice } from '@/components/live/LiveNotice';
import {
  LiveBuyerAgreementSheet, acceptLiveBuyerAgreement, hasAcceptedLiveBuyerAgreement,
} from '@/components/live/LiveBuyerAgreementSheet';
import { useLiveAvailability } from '@/lib/live/useLiveAvailability';
import { LIVE_NOT_CONFIGURED_BUYER_BODY, LIVE_NOT_CONFIGURED_TITLE } from '@/lib/live/liveAvailability';
import { LiveProductsSheet } from '@/components/live/LiveProductsSheet';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { LiveThreadCashSheet } from '@/components/live/LiveThreadCashSheet';
import { LiveStreamOptionsSheet } from '@/components/live/LiveStreamOptionsSheet';
import { VideoVisual } from './(tabs)/feed';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { a11yHidden } from '@/lib/a11yHidden';
import { radius } from '@/constants/radii';

/** Same preference key as the Threads feed, so sound on/off carries over. */
const SOUND_PREF_KEY = 'bt:feed-sound-on:v1';
const ND = Platform.OS !== 'web';

// ─── One stream page ─────────────────────────────────────────────────────────

function LivePage({
  stream, rt, isActive, ending, pageWidth, pageHeight, topInset, bottomInset, muted,
  onClose, onFollow, onOpenHost, onBuy, onOpenShop, onShare, onMore, onLike, onSend, onHostLeft, onMessageOptions,
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
  onFollow: () => void;
  onOpenHost: () => void;
  onBuy: (productId: string) => void;
  onOpenShop: () => void;
  onShare: () => void;
  /** Sound, Thread Cash, report / block — Whatnot's "More" sheet. */
  onMore: () => void;
  onLike: (x: number, y: number, count?: number) => void;
  onSend: (text: string) => Promise<void>;
  onHostLeft: () => void;
  onMessageOptions: (message: LiveChatMessage) => void;
}) {
  const exit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(exit, { toValue: ending ? 1 : 0, duration: LIVE_END_ANIMATION_MS, useNativeDriver: ND }).start();
  }, [ending, exit]);

  // Poster/video fade in together as soon as this page mounts, so the media
  // never hard-cuts in from a blank frame.
  const mediaFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(mediaFade, { toValue: 1, duration: 280, useNativeDriver: ND }).start();
  }, [mediaFade]);

  const viewerCount = rt?.viewerCount ?? stream.viewerCount;
  const pinnedId = rt?.pinnedProductId ?? stream.pinnedProductId;
  const pinned = stream.products.find(p => p.productId === pinnedId) ?? null;

  // TikTok LIVE: every tap on the video sends hearts up from the finger.
  const onVideoPress = (e: GestureResponderEvent) => {
    const { pageX, pageY } = e.nativeEvent;
    onLike(pageX, pageY, 3);
  };

  const video = stream.video;
  return (
    <Animated.View
      style={{
        width: pageWidth, height: pageHeight, backgroundColor: MEDIA.backdrop, overflow: 'hidden',
        opacity: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
        transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] }) }],
      }}
      testID={`live-page-${stream.id}`}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: mediaFade }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onVideoPress} accessible={false}>
        {video.kind === 'video' ? (
          <>
          {/* Poster underlay: VideoVisual drops its own poster a beat before
              the first frame paints; this keeps that frame covered. */}
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
          <LiveRtcVideo rtc={rt?.rtc} active={isActive && !ending} posterUri={video.posterUri} onHostLeft={onHostLeft} />
        )}
      </Pressable>
      </Animated.View>

      {/* Legibility scrims */}
      <LinearGradient pointerEvents="none" colors={[MEDIA.scrim, 'transparent']} style={[styles.topScrim, { height: topInset + 90 }]} />
      <LinearGradient pointerEvents="none" colors={['transparent', MEDIA.chip, MEDIA.scrim]} locations={[0, 0.45, 1]} style={[styles.bottomScrim, { height: bottomInset + 380 }]} />

      <View style={[styles.topRow, { top: topInset + 6 }]} pointerEvents="box-none">
        <LiveHostRow host={stream.host} following={stream.followedByViewer} onFollow={onFollow} onOpenHost={onOpenHost} />
        <LiveTopRight viewerCount={viewerCount} onLeave={onClose} />
      </View>

      <View style={[styles.bottom, { paddingBottom: bottomInset + 8 }]} pointerEvents="box-none">
        <View style={styles.chatAndRail} pointerEvents="box-none">
          <View style={styles.chatCol} pointerEvents="box-none">
            <View style={styles.chatWrap} pointerEvents="box-none">
              <LiveChatList messages={rt?.chat ?? []} onLongPressMessage={onMessageOptions} />
            </View>
            <LiveChatInput onSend={onSend} disabled={ending} />
          </View>
          <LiveRail productCount={stream.products.length} onMore={onMore} onShare={onShare} onOpenShop={onOpenShop} />
        </View>
        {pinned && (
          <LiveProductCard
            product={pinned}
            onPress={onOpenShop}
            action={{ label: 'Buy now', onPress: () => onBuy(pinned.productId) }}
          />
        )}
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
  const [messageFor, setMessageFor] = useState<{ stream: LiveStream; message: LiveChatMessage } | null>(null);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [notice, setNotice] = useState('');
  const [liveCodes, setLiveCodes] = useState<LiveCode[]>([]);
  const availability = useLiveAvailability();
  // First show only (Whatnot): the buyer agreement before anything else.
  const [agreement, setAgreement] = useState<'checking' | 'needed' | 'accepted'>('checking');
  useEffect(() => {
    let alive = true;
    void hasAcceptedLiveBuyerAgreement().then(ok => { if (alive) setAgreement(ok ? 'accepted' : 'needed'); });
    return () => { alive = false; };
  }, []);
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
    const url = ExpoLinking.createURL('/live', { queryParams: { streamId: stream.id } });
    try {
      await Share.share({ message: `${stream.host.name} is live on Brandthread: ${stream.title}\n${url}`, url });
    } catch { /* dismissed */ }
  }, []);

  const gift = useCallback((stream: LiveStream) => {
    hapticLight();
    setGiftFor(stream);
  }, []);

  // Report/block — the shared reportHref()/confirmBlock() flow, in a real
  // Modal-based sheet: react-native-web's Alert.alert is a no-op (see
  // LiveStreamOptionsSheet's doc comment).
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
  // Outside a real device the browser never fills in a non-zero
  // `env(safe-area-inset-top)`, so insets.top reads 0 on web — same
  // fallback TabPageHeader uses for every tab page.
  const topInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const ready = pageWidth > 0 && pageHeight > 0;
  const options = optionsFor;

  const closeButton = (
    <Pressable onPress={close} style={[styles.emptyClose, { top: topInset + 6 }]} accessibilityRole="button" accessibilityLabel="Leave LIVE" testID="live-close">
      <Feather name="chevron-down" size={20} color={MEDIA.fg} />
    </Pressable>
  );

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
      {availability === 'unavailable' ? (
        <>
          <View style={styles.center} testID="live-unavailable">
            <LiveNotice tone="dark" title={LIVE_NOT_CONFIGURED_TITLE} body={LIVE_NOT_CONFIGURED_BUYER_BODY} />
          </View>
          {closeButton}
        </>
      ) : pager.loading || availability === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={MEDIA.fgMuted} />
        </View>
      ) : streams.length === 0 ? (
        <>
          <View style={styles.center} testID="live-empty">
            <LiveNotice
              tone="dark"
              title={pager.error ? "Couldn't load live shows" : params.streamId ? 'This show has ended' : "No one's live right now"}
              body={pager.error ? 'Check your connection and try again.' : 'Shows from brands you follow appear on the LIVE tab the moment they start.'}
              actionLabel="Back"
              onAction={close}
            />
          </View>
          {closeButton}
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
                isActive={index === activeIndex && agreement === 'accepted'}
                ending={!!pager.ending[item.id]}
                pageWidth={pageWidth}
                pageHeight={pageHeight}
                topInset={topInset}
                bottomInset={bottomInset}
                muted={muted}
                onClose={close}
                onFollow={() => { void pager.setFollowing(item.host.id, !item.followedByViewer); }}
                onOpenHost={() => openHost(item.host.id, item.host.name, item.host.handle, item.host.initials)}
                onBuy={pid => buy(item, pid)}
                onOpenShop={() => setBagFor(item)}
                onShare={() => { void share(item); }}
                onMore={() => openStreamOptions(item)}
                onLike={(x, y, count) => { heartsRef.current?.burst(x, y, count); pager.like(item.id); }}
                onSend={async text => {
                  try { await pager.sendChat(text); } catch (e: any) {
                    setNotice(e?.message ? String(e.message) : 'Message not sent');
                    throw e;
                  }
                }}
                onHostLeft={() => pager.removeStream(item.id, item.host.name)}
                onMessageOptions={m => { if (m.userId) setMessageFor({ stream: item, message: m }); }}
              />
            )}
          />
        </KeyboardAvoidingView>
      ) : null}

      {/* Sibling of the pager, so a heart burst is never clipped by a page. */}
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
      {options && (
        <LiveStreamOptionsSheet
          visible
          hostName={options.host.name}
          onClose={() => setOptionsFor(null)}
          // Preview clips have sound; a real show's audio plays with its video.
          sound={options.video.kind === 'video' ? { muted, onToggle: toggleSound } : undefined}
          onGift={liveTipsEnabled ? () => gift(options) : undefined}
          onReport={() => reportStream(options)}
          onBlock={() => { void blockStreamHost(options); }}
        />
      )}
      {messageFor && (
        <LiveStreamOptionsSheet
          visible
          hostName={messageFor.message.username}
          reportLabel="Report message"
          onClose={() => setMessageFor(null)}
          onReport={() => router.push(reportHref({
            targetType: 'live_comment',
            targetId: messageFor.message.id,
            label: `${messageFor.message.username}: “${messageFor.message.text.slice(0, 80)}”`,
            ownerId: messageFor.message.userId,
            ownerName: messageFor.message.username,
          }) as never)}
          onBlock={() => {
            const { userId, username } = messageFor.message;
            if (userId) void confirmBlock({ userId, name: username }, api.social.block);
          }}
        />
      )}
      <LiveBuyerAgreementSheet
        visible={agreement === 'needed' && streams.length > 0 && availability !== 'unavailable'}
        onAgree={() => { setAgreement('accepted'); void acceptLiveBuyerAgreement(); }}
        onGoBack={close}
      />
      <Snackbar visible={!!notice} message={notice} onDismiss={() => setNotice('')} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MEDIA.backdrop },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  topRow: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, gap: 12 },
  chatAndRail: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  chatCol: { flex: 1, minWidth: 0, gap: 10 },
  chatWrap: { maxHeight: 220, justifyContent: 'flex-end' },
  emptyClose: {
    position: 'absolute', right: 12, width: 32, height: 32, borderRadius: 16,
    backgroundColor: MEDIA.chip, alignItems: 'center', justifyContent: 'center',
  },
});
