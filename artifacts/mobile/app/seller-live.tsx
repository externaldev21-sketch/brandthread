/**
 * Seller Live — the host's own show while it's on air. Same overlay as the
 * buyer's viewer (components/live/LiveOverlays.tsx, Whatnot's show screen
 * https://mobbin.com/flows/ed55f754-472f-46f8-914b-ce7cb7345c7b) so the host
 * sees what buyers see, with the host's controls in the same places:
 *
 *   top-left   you · LIVE and the running time
 *   top-right  viewer count · X to end the show ("End show?" confirm)
 *   right      More (codes, moderation, co-host, mic) · Flip · Shop
 *   bottom     chat (tap a message to pin / remove / mute / ban) ·
 *              "Say something..." · the pinned item with Unpin
 *
 * Shop is Whatnot's shop list: the show's items first with Pin / Pinned,
 * then the rest of your catalog with Add. Ending goes to the post-show
 * summary (app/seller-live-summary.tsx).
 *
 * Broadcasts through react-native-agora in host mode. Without the native
 * SDK (web / Expo Go) the camera still previews via expo-camera, and in the
 * preview (`?bt_preview=seller&demo=1` only) chat / viewers / items come
 * from the local preview provider instead of the API.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useUser } from '@clerk/expo';
import { useMyIdentity } from '@/hooks/useMyIdentity';
import { API_BASE_URL, useApi } from '@/lib/api';
import { showAlert } from '@/lib/actionSheet';
import { friendlyError } from '@/lib/friendlyError';
import { liveProductImageUrl } from '@/lib/liveProductOptions';
import { LiveNotice } from '@/components/live/LiveNotice';
import { FONT, FS, MEDIA } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useLiveSocket, type LiveSocketEvent } from '@/lib/live/useLiveSocket';
import { LiveCodesHostSheet } from '@/components/live/LiveCodesHostSheet';
import { useLiveModeration } from '@/lib/live/useLiveModeration';
import { PinnedCommentBar, CohostTiles } from '@/components/live/LiveModerationOverlays';
import { LiveCommentActionsSheet, type CommentAction, type CommentActionTarget } from '@/components/live/LiveCommentActionsSheet';
import {
  LiveChatInput, LiveChatList, LiveHostRow, LiveProductCard, LiveRail, LiveTopRight,
} from '@/components/live/LiveOverlays';
import { LiveProductsSheet } from '@/components/live/LiveProductsSheet';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { loadAgoraModule } from '@/lib/agoraAvailability';
import { haptic } from '@/lib/haptics';
import { getLiveStreamProvider, isLivePreviewDemo } from '@/lib/live/liveProvider';
import { productsFromTags } from '@/lib/live/apiLiveProvider';
import type { LiveChatMessage, LiveHost, LiveProduct } from '@/lib/live/types';

// ─── Agora SDK (native-only, gracefully skipped on web/Expo Go) ───────────────
const AgoraModule = loadAgoraModule();

interface Comment { id: string; user_id?: string; display_name: string; message: string; created_at: string; }
interface ProductTag { productId: string; productName: string; priceCents: number; imageUri?: string | null; highlighted?: boolean }

export function formatLiveClock(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function toChat(c: Comment, hostId?: string | null): LiveChatMessage {
  return {
    id: String(c.id),
    userId: c.user_id,
    username: c.display_name,
    text: c.message,
    at: new Date(c.created_at).getTime() || Date.now(),
    kind: hostId && c.user_id === hostId ? 'host' : 'chat',
  };
}

export default function SellerLiveScreen() {
  const params = useLocalSearchParams<{
    streamId: string; channelName: string; agoraUid: string;
    agoraAppId: string; token: string; title: string; facing?: string; mic?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const api = useApi();
  const { user } = useUser();
  const { identity } = useMyIdentity();
  const myUsername = identity?.username ?? user?.username ?? null;
  const preview = isLivePreviewDemo();

  const [viewerCount, setViewerCount] = useState(0);
  const [comments, setComments] = useState<LiveChatMessage[]>([]);
  const [duration, setDuration] = useState(0);
  const [productTags, setProductTags] = useState<ProductTag[]>([]);
  const [catalog, setCatalog] = useState<any[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(!preview);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const [showLiveCodes, setShowLiveCodes] = useState(false);
  const [ending, setEnding] = useState(false);
  const [micOn, setMicOn] = useState(params.mic !== 'off');
  const [facing, setFacing] = useState<'front' | 'back'>(params.facing === 'back' ? 'back' : 'front');
  const [notice, setNotice] = useState('');

  // Host-only tips total; stays null (and renders nothing) while the
  // `live_tips` flag is OFF or the call fails.
  const liveTipsEnabled = useFeatureFlag('live_tips');
  const [tipsTotalCents, setTipsTotalCents] = useState<number | null>(null);
  useEffect(() => {
    if (!liveTipsEnabled || !params.streamId || preview) return undefined;
    let cancelled = false;
    const load = () => {
      api.liveTips.total(params.streamId)
        .then(r => { if (!cancelled) setTipsTotalCents(r.enabled ? r.totalCents : null); })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [api, liveTipsEnabled, params.streamId, preview]);

  // Moderation + co-host (pinned comment, co-host tiles, comment actions sheet).
  const mod = useLiveModeration(params.streamId);
  const [actionComment, setActionComment] = useState<CommentActionTarget | null>(null);

  const engineRef = useRef<any>(null);
  const fallbackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastCommentTs = useRef<string>(new Date().toISOString());

  // ─── Camera + mic permission (deep links skip seller-go-live's check) ──────
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const checkPermissions = Platform.OS !== 'web' && !preview;
  const permsKnown = cameraPermission != null && micPermission != null;
  const permsOk = !checkPermissions || (!!cameraPermission?.granted && !!micPermission?.granted);
  const permsBlocked = (cameraPermission != null && !cameraPermission.granted && cameraPermission.canAskAgain === false)
    || (micPermission != null && !micPermission.granted && micPermission.canAskAgain === false);
  const askedPermsRef = useRef(false);
  useEffect(() => {
    if (!checkPermissions || !permsKnown || permsOk || askedPermsRef.current) return;
    askedPermsRef.current = true;
    void (async () => {
      if (!cameraPermission?.granted && cameraPermission?.canAskAgain !== false) await requestCameraPermission();
      if (!micPermission?.granted && micPermission?.canAskAgain !== false) await requestMicPermission();
    })();
  }, [checkPermissions, permsKnown, permsOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Broadcast connection state ─────────────────────────────────────────────
  // 'connecting' until Agora joins; 'reconnecting' on a network blip (Agora
  // retries on its own); 'lost' when it gives up; 'failed' when the engine
  // could not start at all. Buyers can't see the host in 'lost' / 'failed'.
  type BroadcastState = 'connecting' | 'live' | 'reconnecting' | 'lost' | 'failed';
  const [broadcast, setBroadcast] = useState<BroadcastState>('connecting');
  const [agoraAttempt, setAgoraAttempt] = useState(0);

  // ─── Init Agora (host) ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!AgoraModule || !params.agoraAppId || !permsOk) return undefined;
    const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = AgoraModule;
    // Agora's ConnectionStateType: 1 disconnected, 2 connecting, 3 connected, 4 reconnecting, 5 failed.
    const CS = AgoraModule.ConnectionStateType ?? {};
    const RECONNECTING = CS.ConnectionStateReconnecting ?? 4;
    const FAILED = CS.ConnectionStateFailed ?? 5;
    const CONNECTED = CS.ConnectionStateConnected ?? 3;
    const DISCONNECTED = CS.ConnectionStateDisconnected ?? 1;
    setBroadcast('connecting');
    try {
      const engine = createAgoraRtcEngine();
      engine.initialize({ appId: params.agoraAppId });
      engine.setChannelProfile(ChannelProfileType.ChannelProfileLiveBroadcasting);
      engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
      engine.enableVideo();
      // Agora's local preview starts on the rear camera; match whichever
      // camera the camera check was already previewing on.
      if (params.facing === 'front') {
        try { engine.switchCamera(); } catch { /* single camera */ }
      }
      if (params.mic === 'off') {
        try { engine.muteLocalAudioStream(true); } catch { /* older SDK */ }
      }
      engine.startPreview();
      engine.registerEventHandler({
        onError: (err: any) => console.warn('[Agora]', err),
        onJoinChannelSuccess: () => setBroadcast('live'),
        onRejoinChannelSuccess: () => setBroadcast('live'),
        onConnectionLost: () => setBroadcast('reconnecting'),
        onConnectionStateChanged: (_conn: unknown, state: number) => {
          if (state === CONNECTED) setBroadcast('live');
          else if (state === RECONNECTING) setBroadcast('reconnecting');
          else if (state === FAILED) setBroadcast('lost');
          else if (state === DISCONNECTED) setBroadcast(b => (b === 'live' || b === 'reconnecting' ? 'lost' : b));
        },
      });
      engine.joinChannel(
        params.token || null,
        params.channelName,
        parseInt(params.agoraUid, 10),
        { clientRoleType: AgoraModule.ClientRoleType.ClientRoleBroadcaster },
      );
      engineRef.current = engine;
    } catch (e) {
      console.warn('[Agora init]', e);
      setBroadcast('failed');
    }
    return () => {
      try { engineRef.current?.leaveChannel(); engineRef.current?.release(); } catch { /* gone */ }
      engineRef.current = null;
    };
  }, [permsOk, agoraAttempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const retryBroadcast = useCallback(() => {
    setAgoraAttempt(n => n + 1);
  }, []);

  // ─── Running time ──────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // ─── Initial items (what setup lined up) + catalog ─────────────────────────
  useEffect(() => {
    let alive = true;
    if (preview) {
      const provider = getLiveStreamProvider();
      void provider.listLive().then(list => {
        const mine = list.find(s => s.id === params.streamId);
        if (!alive || !mine) return;
        setProductTags(mine.products.map(p => ({ productId: p.productId, productName: p.name, priceCents: p.priceCents, imageUri: p.imageUri })));
      }).catch(() => {});
      const off = provider.subscribe(params.streamId, event => {
        if (event.type === 'viewers') setViewerCount(event.viewerCount);
        if (event.type === 'chat') setComments(prev => [...prev, ...event.messages].slice(-80));
      });
      return () => { alive = false; off(); };
    }
    (api as any).live.get(params.streamId)
      .then((r: any) => {
        if (!alive) return;
        const tags = Array.isArray(r?.stream?.product_tags) ? r.stream.product_tags : [];
        setProductTags(tags);
        setViewerCount(Number(r?.stream?.viewer_count) || 0);
      })
      .catch(() => {});
    void loadCatalog(() => alive);
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The seller's own catalog for "Add to show". Only active listings can be
  // tagged (the server drops the rest), and stored photo paths resolve to the
  // public product photo address.
  async function loadCatalog(isAlive: () => boolean = () => true) {
    if (preview) return;
    setCatalogLoading(true);
    setCatalogFailed(false);
    try {
      const r: any = await (api as any).products?.list?.();
      if (!isAlive()) return;
      const rows: any[] = Array.isArray(r) ? r : r?.products ?? [];
      setCatalog(rows
        .filter(p => !p.status || p.status === 'active')
        .map(p => ({
          ...p,
          imageUrl: p.imageUrl ?? liveProductImageUrl(p.id, Array.isArray(p.images) ? p.images[0] : null, API_BASE_URL),
        })));
    } catch {
      if (isAlive()) setCatalogFailed(true);
    } finally {
      if (isAlive()) setCatalogLoading(false);
    }
  }

  // ─── Realtime: WebSocket room for this stream ───────────────────────────────
  const handleLiveEvent = useCallback((event: LiveSocketEvent) => {
    if (event.type === 'comment') {
      lastCommentTs.current = event.comment.created_at;
      setComments(prev => [...prev, toChat(event.comment as Comment, user?.id)].slice(-80));
    } else if (event.type === 'products') {
      setProductTags(event.productTags as ProductTag[]);
    } else if (event.type === 'viewerCount') {
      setViewerCount(event.count);
    } else if (event.type === 'comment_removed') {
      setComments(prev => prev.filter(c => c.id !== event.commentId));
      mod.handleEvent(event);
    } else {
      mod.handleEvent(event);
    }
  }, [mod.handleEvent, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pollComments = useCallback(async () => {
    try {
      const data = await (api as any).live.comments(params.streamId, lastCommentTs.current) as any;
      const fresh: Comment[] = (data.comments ?? []).reverse();
      if (fresh.length) {
        lastCommentTs.current = fresh[fresh.length - 1].created_at;
        setComments(prev => [...prev, ...fresh.map(c => toChat(c, user?.id))].slice(-80));
      }
    } catch { /* next tick */ }
  }, [api, params.streamId, user?.id]);

  const startFallbackPolling = useCallback((active: boolean) => {
    if (fallbackPollRef.current) { clearInterval(fallbackPollRef.current); fallbackPollRef.current = null; }
    if (!active) return;
    fallbackPollRef.current = setInterval(() => { void pollComments(); }, 15000);
  }, [pollComments]);
  useEffect(() => () => { if (fallbackPollRef.current) clearInterval(fallbackPollRef.current); }, []);

  useLiveSocket({
    streamId: params.streamId,
    enabled: !!params.streamId && !preview,
    asHost: true,
    onEvent: handleLiveEvent,
    onConnected: () => { void pollComments(); mod.refresh(); },
    onFallback: startFallbackPolling,
  });

  // ─── Actions ───────────────────────────────────────────────────────────────
  async function sendComment(message: string) {
    if (preview) {
      setComments(prev => [...prev, { id: `you-${Date.now()}`, userId: user?.id, username: myUsername ?? 'You', text: message, at: Date.now(), kind: 'host' as const }].slice(-80));
      return;
    }
    await (api as any).live.comment(params.streamId, {
      message,
      displayName: myUsername ?? identity?.displayName ?? user?.firstName ?? 'Host',
    });
  }

  async function addProduct(product: any) {
    haptic('select');
    const updated = [...productTags, {
      productId: product.id, productName: product.name, priceCents: product.priceCents ?? 0, imageUri: product.imageUrl ?? undefined,
    }];
    setProductTags(updated);
    if (preview) return;
    try { await (api as any).live.updateProducts(params.streamId, updated); } catch {
      setNotice("Couldn't add that item. Try again.");
    }
  }

  async function setPinned(productId: string | null) {
    haptic('select');
    const prev = productTags;
    setProductTags(tags => tags.map(tag => ({ ...tag, highlighted: productId != null && tag.productId === productId })));
    if (preview) return;
    try {
      await (api as any).live.pin(params.streamId, productId);
    } catch {
      setProductTags(prev);
      setNotice("Couldn't update the pinned item. Buyers still see the last one.");
    }
  }

  async function runCommentAction(action: CommentAction, c: CommentActionTarget) {
    const id = params.streamId;
    try {
      if (action === 'pin') await (api as any).liveMod.pin(id, c.id);
      else if (action === 'unpin') await (api as any).liveMod.pin(id, null);
      else if (action === 'remove') await (api as any).liveMod.removeComment(id, c.id);
      else if (action === 'mute' && c.user_id) await (api as any).liveMod.mute(id, c.user_id);
      else if (action === 'ban' && c.user_id) await (api as any).liveMod.ban(id, c.user_id);
      if (action === 'ban' && c.user_id) setComments(prev => prev.filter(x => x.userId !== c.user_id));
      if (action === 'remove') setComments(prev => prev.filter(x => x.id !== c.id));
    } catch {
      setNotice('That action did not go through. Try again.');
    }
  }

  const flipCamera = useCallback(() => {
    haptic('select');
    try { engineRef.current?.switchCamera?.(); } catch { /* single camera */ }
    setFacing(f => (f === 'front' ? 'back' : 'front'));
  }, []);

  const toggleMic = useCallback(() => {
    setMicOn(on => {
      // Muting when it was on, unmuting when it was off.
      try { engineRef.current?.muteLocalAudioStream?.(on); } catch { /* older SDK */ }
      return !on;
    });
  }, []);

  function openMore() {
    showActionSheet(undefined, undefined, [
      { text: micOn ? 'Mute microphone' : 'Unmute microphone', onPress: toggleMic },
      { text: 'Live codes', onPress: () => setShowLiveCodes(true) },
      { text: 'Moderation', onPress: () => router.push({ pathname: '/live-moderation', params: { streamId: params.streamId } } as any) },
      { text: 'Invite a co-host', onPress: () => router.push({ pathname: '/live-cohost', params: { streamId: params.streamId } } as any) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  function confirmEnd() {
    showActionSheet('End show?', 'Buyers will see that your show has ended.', [
      { text: 'End show', style: 'destructive', onPress: () => { void endShow(); } },
      { text: 'Keep going', style: 'cancel' },
    ]);
  }

  function goToSummary() {
    router.replace({
      pathname: '/seller-live-summary',
      params: { streamId: params.streamId, duration: String(duration), title: params.title ?? '' },
    } as never);
  }

  async function endShow() {
    setEnding(true);
    try {
      if (preview) await getLiveStreamProvider().stop(params.streamId);
      else await (api as any).live.end(params.streamId);
    } catch (e) {
      // The show may still be live for buyers: say so, and let the host
      // retry or leave knowingly.
      setEnding(false);
      showAlert(
        'Couldn’t end your show',
        `${friendlyError(e, 'Something went wrong ending your show.')} Buyers may still see you as live.`,
        [
          { text: 'Keep going', style: 'cancel' },
          { text: 'Leave anyway', style: 'destructive', onPress: goToSummary },
          { text: 'Retry', onPress: () => { void endShow(); } },
        ],
      );
      return;
    }
    goToSummary();
  }

  // ─── Derived ───────────────────────────────────────────────────────────────
  const host: LiveHost = useMemo(() => {
    const name = myUsername ?? user?.firstName ?? 'You';
    return { id: user?.id ?? 'me', name, handle: myUsername ? `@${myUsername}` : '', initials: name.slice(0, 2).toUpperCase(), avatarColor: MEDIA.chip, avatarUri: identity?.avatarUrl ?? user?.imageUrl ?? null, verified: false };
  }, [user?.id, myUsername, user?.firstName, identity?.avatarUrl, user?.imageUrl]);

  const { products: showProducts } = productsFromTags(productTags);
  const withImages: LiveProduct[] = showProducts.map(p => ({ ...p, imageUri: productTags.find(t => t.productId === p.productId)?.imageUri ?? null }));
  const pinnedId = productTags.find(t => t.highlighted)?.productId ?? null;
  const pinned = withImages.find(p => p.productId === pinnedId) ?? null;
  const tagged = new Set(productTags.map(t => t.productId));
  const shopList: LiveProduct[] = [
    ...withImages,
    ...catalog.filter(p => !tagged.has(p.id)).map(p => ({ productId: p.id, name: p.name, priceCents: p.priceCents ?? 0, imageUri: p.imageUrl ?? null })),
  ];

  const LocalCameraView = AgoraModule ? AgoraModule.RtcSurfaceView : null;
  const bottomInset = Math.max(insets.bottom, 10);

  return (
    <View style={styles.root} testID="seller-live-screen">
      {!permsOk ? null : LocalCameraView && params.agoraAppId ? (
        <LocalCameraView canvas={{ uid: 0, renderMode: 1 }} style={StyleSheet.absoluteFill} />
      ) : (
        <CameraView style={StyleSheet.absoluteFill} facing={facing} mute />
      )}

      <LinearGradient pointerEvents="none" colors={[MEDIA.scrim, 'transparent']} style={[styles.topScrim, { height: topInset + 90 }]} />
      <LinearGradient pointerEvents="none" colors={['transparent', MEDIA.chip, MEDIA.scrim]} locations={[0, 0.45, 1]} style={[styles.bottomScrim, { height: bottomInset + 380 }]} />

      <View style={[styles.topRow, { top: topInset + 6 }]} pointerEvents="box-none">
        <View style={styles.hostCol}>
          <LiveHostRow host={host} following={false} />
          <Text style={styles.clock} testID="seller-live-duration">{formatLiveClock(duration)}</Text>
        </View>
        <LiveTopRight viewerCount={viewerCount} onLeave={confirmEnd} leaveIcon="x" leaveLabel="End show" />
      </View>

      {tipsTotalCents != null && tipsTotalCents > 0 && (
        <View style={[styles.tips, { top: topInset + 50 }]} pointerEvents="none" testID="seller-live-tips-total">
          <Text style={styles.tipsText}>{formatCents(tipsTotalCents)} in tips</Text>
        </View>
      )}

      {AgoraModule && params.agoraAppId && permsOk && (broadcast === 'reconnecting' || broadcast === 'lost') && (
        <View style={[styles.connBanner, { top: topInset + 50 + (tipsTotalCents != null && tipsTotalCents > 0 ? 36 : 0) }]} testID="seller-live-connection">
          <Text style={styles.connText}>
            {broadcast === 'reconnecting' ? 'Reconnecting…' : 'Connection lost. Buyers can’t see you.'}
          </Text>
          {broadcast === 'lost' && (
            <Pressable onPress={retryBroadcast} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reconnect broadcast">
              <Text style={styles.connAction}>Reconnect</Text>
            </Pressable>
          )}
        </View>
      )}

      <CohostTiles cohosts={mod.cohosts} RtcSurfaceView={AgoraModule?.RtcSurfaceView ?? null} top={topInset + 86} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.bottom, { paddingBottom: bottomInset + 8 }]} pointerEvents="box-none">
        <View style={styles.chatAndRail} pointerEvents="box-none">
          <View style={styles.chatCol} pointerEvents="box-none">
            <PinnedCommentBar comment={mod.pinned} />
            <View style={styles.chatWrap} pointerEvents="box-none">
              {comments.length === 0 && (
                <Text style={styles.chatEmpty} testID="seller-live-chat-empty">No comments yet. Say hi to get the chat going.</Text>
              )}
              <LiveChatList
                messages={comments}
                onLongPressMessage={m => {
                  if (!m.userId || m.userId === user?.id) return;
                  setActionComment({ id: m.id, user_id: m.userId, display_name: m.username, message: m.text });
                }}
              />
            </View>
            <LiveChatInput onSend={sendComment} disabled={ending} />
          </View>
          <LiveRail productCount={productTags.length} onMore={openMore} onFlip={flipCamera} onOpenShop={() => { haptic('sheet'); setShowShop(true); if (catalogFailed) void loadCatalog(); }} />
        </View>
        {pinned && (
          <LiveProductCard
            product={pinned}
            onPress={() => setShowShop(true)}
            action={{ label: 'Unpin', onPress: () => { void setPinned(null); }, testID: 'seller-live-unpin' }}
          />
        )}
        {notice ? <Text style={styles.notice} onPress={() => setNotice('')}>{notice}</Text> : null}
      </KeyboardAvoidingView>

      {showShop && (
        <LiveProductsSheet
          visible
          products={shopList}
          pinnedProductId={pinnedId}
          onClose={() => setShowShop(false)}
          emptyText={catalogLoading
            ? 'Loading your products…'
            : catalogFailed
              ? 'Couldn’t load your products. Close and try again.'
              : 'No products yet. Add products to your store first.'}
          actionFor={(product, isPinned) => {
            if (!tagged.has(product.productId)) {
              const source = catalog.find(p => p.id === product.productId);
              return { label: 'Add to show', onPress: () => { if (source) void addProduct(source); } };
            }
            return isPinned
              ? { label: 'Pinned', selected: true, onPress: () => { void setPinned(null); } }
              : { label: 'Pin', onPress: () => { void setPinned(product.productId); setShowShop(false); } };
          }}
        />
      )}
      {showLiveCodes && <LiveCodesHostSheet streamId={params.streamId} onClose={() => setShowLiveCodes(false)} />}
      <LiveCommentActionsSheet
        comment={actionComment}
        pinned={!!actionComment && mod.pinned?.id === actionComment.id}
        onClose={() => setActionComment(null)}
        onAction={(action, c) => { setActionComment(null); void runCommentAction(action, c); }}
      />

      {checkPermissions && permsKnown && !permsOk ? (
        <View style={[StyleSheet.absoluteFill, styles.blocker, { paddingBottom: bottomInset + 24 }]} testID="seller-live-permissions">
          <LiveNotice
            tone="dark"
            title="Camera & microphone access needed"
            body="Buyers can’t see or hear you until Brandthread can use your camera and microphone."
          />
          <Pressable
            style={styles.blockerBtn}
            onPress={permsBlocked
              ? () => { void Linking.openSettings(); }
              : async () => { await requestCameraPermission(); await requestMicPermission(); }}
            accessibilityRole="button"
          >
            <Text style={styles.blockerBtnText}>{permsBlocked ? 'Open Settings' : 'Allow camera & microphone'}</Text>
          </Pressable>
          <Pressable onPress={confirmEnd} hitSlop={8} accessibilityRole="button" style={styles.blockerLink}>
            <Text style={styles.blockerLinkText}>End show</Text>
          </Pressable>
        </View>
      ) : broadcast === 'failed' ? (
        <View style={[StyleSheet.absoluteFill, styles.blocker, { paddingBottom: bottomInset + 24 }]} testID="seller-live-broadcast-failed">
          <LiveNotice
            tone="dark"
            title="Your camera couldn’t start"
            body="Buyers can’t see you right now. Try again, or end the show."
          />
          <Pressable style={styles.blockerBtn} onPress={retryBroadcast} accessibilityRole="button">
            <Text style={styles.blockerBtnText}>Try again</Text>
          </Pressable>
          <Pressable onPress={confirmEnd} hitSlop={8} accessibilityRole="button" style={styles.blockerLink}>
            <Text style={styles.blockerLinkText}>End show</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MEDIA.backdrop },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottomScrim: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  topRow: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  hostCol: { flexShrink: 1, gap: 4 },
  clock: { color: MEDIA.fgMuted, fontFamily: FONT.semibold, fontSize: FS.meta, marginLeft: 42, fontVariant: ['tabular-nums'] },
  tips: { position: 'absolute', right: 12, height: 28, paddingHorizontal: 10, borderRadius: 14, backgroundColor: MEDIA.chip, justifyContent: 'center' },
  tipsText: { color: MEDIA.fg, fontFamily: FONT.semibold, fontSize: FS.meta },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, gap: 12 },
  chatAndRail: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  chatCol: { flex: 1, minWidth: 0, gap: 10 },
  chatWrap: { maxHeight: 220, justifyContent: 'flex-end' },
  chatEmpty: { color: MEDIA.fgMuted, fontFamily: FONT.medium, fontSize: FS.meta, paddingBottom: 6 },
  connBanner: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: MEDIA.chip,
  },
  connText: { color: MEDIA.fg, fontFamily: FONT.semibold, fontSize: FS.meta },
  connAction: { color: MEDIA.fg, fontFamily: FONT.bold, fontSize: FS.meta, textDecorationLine: 'underline' },
  blocker: { backgroundColor: MEDIA.backdrop, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  blockerBtn: { marginTop: 20, height: 48, paddingHorizontal: 28, borderRadius: 24, backgroundColor: MEDIA.fg, alignItems: 'center', justifyContent: 'center' },
  blockerBtnText: { color: MEDIA.onFg, fontFamily: FONT.bold, fontSize: FS.md },
  blockerLink: { marginTop: 16, paddingVertical: 8 },
  blockerLinkText: { color: MEDIA.fgMuted, fontFamily: FONT.semibold, fontSize: FS.sm },
  notice: { color: MEDIA.fg, fontFamily: FONT.medium, fontSize: FS.meta, textAlign: 'center' },
});
