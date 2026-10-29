import { menuItemsFromButtons, openPullDownMenu } from '@/lib/contextMenu';

import { hapticSuccessAction, haptics, haptic, hapticLight, hapticPrimaryAction } from '@/lib/haptics';
import { roomAnnouncement } from '@/lib/live/roomAnnouncement';

/**
 * Buyer Live — viewer screen for an active live stream.
 * Joins the Agora channel as audience. Falls back to a demo/placeholder
 * on Expo Go / web where the native SDK is unavailable.
 */
import React, { useEffect, useRef, useState } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';

import { View, Text, StyleSheet, TextInput, ScrollView, Platform, ActivityIndicator, Alert, Share, useWindowDimensions } from 'react-native';

import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';

import * as ExpoLinking from 'expo-linking';
import { buildLiveUrl } from '@/lib/shareLinks';

import { useLocalSearchParams, useRouter } from 'expo-router';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/Icon';

import { loadAgoraModule } from '@/lib/agoraAvailability';

import { useFeatureFlag as useAuctionFlag } from '@/contexts/FeatureFlagContext';
import { useLiveAuction } from '@/lib/live/useLiveAuction';
import { LiveAuctionCard } from '@/components/live/LiveAuctionCard';
import { LiveAuctionBidSheet } from '@/components/live/LiveAuctionBidSheet';
import type { LiveAuction } from '@/lib/live/liveAuction';
import { useApi } from '@/lib/api';

import { track } from '@/lib/analytics';

import { pickDefaultAddress, prefillDelivery } from '@/lib/liveCheckoutPrefill';

import { useUser } from '@clerk/expo';

import { useColors } from '@/hooks/useColors';

import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';

import { useScrollToEndOnContentChange } from '@/hooks/useScrollToEndOnContentChange';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { BG, BORDER, FG, MUTED, SUBTLE, RED, FONT, FS, SP, RADIUS, TEXT_SECONDARY } from '@/lib/theme';

import { LIVE_RED } from '@/components/live/LiveAvatarRing';

import * as WebBrowser from 'expo-web-browser';
import { currentCheckoutReturnUrls, hostedCheckoutVerdict } from '@/lib/checkoutReturn';

import NativeOnlyFeature from '@/components/NativeOnlyFeature';
import { apiErrorMessage, confirmBlock, reportHref } from '@/lib/safety';
import { friendlyError } from '@/lib/friendlyError';
import { showAlert } from '@/lib/actionSheet';

import { PressableScale } from '@/components/BrandthreadUI';

import { IconButton } from '@/components/ui/IconButton';

import { Snackbar } from '@/components/ui/Snackbar';



import Composer from '@/components/ui/Composer';
import { useLiveSocket, type LiveSocketEvent } from '@/lib/live/useLiveSocket';
import {
  LIVE_VIDEO_CONNECT_TIMEOUT_MS,
  canRetryLiveVideo,
  liveVideoPlaceholderText,
  type LiveVideoState,
} from '@/lib/live/liveVideoConnect';

import { useLiveModeration } from '@/lib/live/useLiveModeration';

import { PinnedCommentBar, CohostTiles } from '@/components/live/LiveModerationOverlays';

import { radius } from '@/constants/radii';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { LiveThreadCashSheet } from '@/components/live/LiveThreadCashSheet';
import { fetchLiveBag } from '@/services/liveShoppingService';

import { LiveCohostSplit } from '@/components/live/LiveCohostSplit';

import { LivePurchaseToast, useLivePurchaseToasts } from '@/components/live/LivePurchaseToast';

import type { LiveCohostPerson } from '@/lib/live/moderationTypes';
import { formatMoney } from '@/lib/format';

// ─── Agora SDK (native-only) ──────────────────────────────────────────────────
const AgoraModule = loadAgoraModule();

interface Comment {
  id: string; user_id?: string; display_name: string; message: string; created_at: string;
  /** Server-announced "just bought" / gift rows (first name or handle only). */
  kind?: 'purchase' | 'gift';
}
interface ProductTag { productId: string; productName: string; priceCents: number; highlighted?: boolean; }

export default function BuyerLiveScreen() {
  // `&demo=1` renders the viewer screen in a browser (video placeholders)
  // for the screenshot harness; a real web visit still gets the notice.
  const { demo } = useLocalSearchParams<{ demo?: string }>();
  if (Platform.OS === 'web' && demo !== '1') {
    return (
      <NativeOnlyFeature
        icon="video-off"
        title="Live video is available in the mobile app"
        description="Open Brandthread on iOS or Android to watch live. Product pages and checkout still work on web."
        headerTitle="Live"
        showWebHint={false}
      />
    );
  }
  return <BuyerLiveNativeScreen />;
}

function BuyerLiveNativeScreen() {
  const colors = useColors();
  const { theme } = useAppTheme();
  const PURPLE = colors.primary;
  const s = makeStyles(theme);
  // Live window height so the purchase sheet cap tracks iPad rotation / split view.
  const { height: H } = useWindowDimensions();
  const params = useLocalSearchParams<{ streamId: string; payAuction?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerTopInset = useHeaderTopInset();
  const api = useApi();
  const { user } = useUser();

  const [stream, setStream]               = useState<any>(null);
  const [loading, setLoading]             = useState(true);
  const [ended, setEnded]                 = useState(false);
  // Couldn't load / join this live (anything but 403) — shown instead of
  // the live UI, which would otherwise render with no stream behind it.
  const [loadError, setLoadError]         = useState<string | null>(null);
  // From the server's `ended` broadcast; null until we know.
  const [replayStatus, setReplayStatus]   = useState<'ready' | 'pending' | 'unavailable' | null>(null);
  const [comments, setComments]           = useState<Comment[]>([]);
  const [commentText, setCommentText]     = useState('');
  const [productTags, setProductTags]     = useState<ProductTag[]>([]);
  const [viewerCount, setViewerCount]     = useState(0);
  const [broadcastUid, setBroadcastUid]   = useState<number | null>(null);
  const [agoraReady, setAgoraReady]       = useState(false);
  const [videoState, setVideoState]       = useState<LiveVideoState>(AgoraModule ? 'connecting' : 'unsupported');
  const [retryingVideo, setRetryingVideo] = useState(false);
  const videoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [purchaseTag, setPurchaseTag]     = useState<ProductTag | null>(null);
  const [purchaseProduct, setPurchaseProduct] = useState<any>(null);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState('');
  const [checkoutBusy, setCheckoutBusy]   = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [orderSnackbar, setOrderSnackbar] = useState('');
  const [buyerEmail, setBuyerEmail]       = useState(user?.primaryEmailAddress?.emailAddress ?? '');
  const [buyerName, setBuyerName]         = useState(user?.fullName ?? '');
  const [buyerPhone, setBuyerPhone]       = useState('');
  const [street, setStreet]               = useState('');
  const [city, setCity]                   = useState('');
  const [region, setRegion]               = useState('');
  const [postalCode, setPostalCode]       = useState('');
  const deliveryRefs = useRef<Record<string, TextInput | null>>({});
  const focusDelivery = (key: string) => () => deliveryRefs.current[key]?.focus();
  // Fill delivery from the saved default address once the buy sheet opens (BT-416).
  const prefilledRef = useRef<string | null>(null);
  useEffect(() => {
    const ownerId = user?.id;
    if (!purchaseTag || !ownerId || prefilledRef.current === ownerId) return;
    let cancelled = false;
    api.buyer.addresses.list().then((list) => {
      if (cancelled) return;
      prefilledRef.current = ownerId;
      const next = prefillDelivery({ name: '', phone: '', street: '', city: '', region: '', postalCode: '' }, pickDefaultAddress(list));
      // Read the latest field values, not the values captured before the
      // network request. A slow response must not replace the buyer's edits.
      setBuyerName(current => current.trim() ? current : next.name);
      setBuyerPhone(current => current.trim() ? current : next.phone);
      setStreet(current => current.trim() ? current : next.street);
      setCity(current => current.trim() ? current : next.city);
      setRegion(current => current.trim() ? current : next.region);
      setPostalCode(current => current.trim() ? current : next.postalCode);
    }).catch(() => { /* typing still works */ });
    return () => { cancelled = true; };
  }, [api, purchaseTag, user?.id]);
  const lastHighlightedRef = useRef<string | null>(null);
  // Moderation + co-host: pinned comment above chat, co-host tiles, removal.
  const mod = useLiveModeration(params.streamId);
  // Co-hosts on stage (routes/live-cohost.ts): the screen splits host / co-hosts.
  const [cohosts, setCohosts]             = useState<LiveCohostPerson[]>([]);
  // With co-hosts there are several publishers on the channel: only the
  // host's uid is the main video, and only the host going offline matters.
  const hostUidRef = useRef<number | null>(null);
  // Social proof: "<first name> bought <product>" from this live.
  const purchaseToasts = useLivePurchaseToasts();
  const liveTipsEnabled = useFeatureFlag('live_tips');
  const [giftOpen, setGiftOpen] = useState(false);
  // Products an on-stage co-host added to this live (bought from their store).
  const [cohostTags, setCohostTags] = useState<ProductTag[]>([]);
  const refreshBag = React.useCallback(() => {
    if (!params.streamId) return;
    fetchLiveBag(params.streamId)
      .then(bag => setCohostTags(bag.filter(b => !b.fromHost).map(b => ({ productId: b.productId, productName: b.productName, priceCents: b.priceCents }))))
      .catch(() => {});
  }, [params.streamId]);

  const engineRef       = useRef<any>(null);
  const scrollRef       = useRef<ScrollView>(null);
  // New comments scroll the list once they've laid out (no fixed delay).
  const commentsScroll  = useScrollToEndOnContentChange(scrollRef);
  // Slow-polling fallback loop — only runs when the WebSocket genuinely
  // can't connect (see useLiveSocket's onFallback below). Not used while
  // the socket is up.
  const fallbackPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastTs          = useRef<string>(new Date().toISOString());
  const joinedRef        = useRef(false);

  useEffect(() => {
    if (!orderSnackbar) return;
    const t = setTimeout(() => setOrderSnackbar(''), 2500);
    return () => clearTimeout(t);
  }, [orderSnackbar]);

  // ─── Load stream + join ──────────────────────────────────────────────────────
  useEffect(() => {
    init();
    return () => {
      handleLeave(false);
      if (fallbackPollRef.current) clearInterval(fallbackPollRef.current);
      clearVideoTimeout();
    };
  }, []);

  // ─── Realtime: WebSocket room for this stream, replacing the old 3s poll ──────
  const handleLiveEvent = React.useCallback((event: LiveSocketEvent) => {
    auctionEventRef.current(event as any);
    if (event.type === 'comment') {
      lastTs.current = event.comment.created_at;
      setComments(prev => [...prev, event.comment].slice(-80));
      commentsScroll.requestScrollToEnd();
    } else if (event.type === 'products') {
      setProductTags(event.productTags);
      const highlighted = event.productTags.find(tag => tag.highlighted);
      if (highlighted && highlighted.productId !== lastHighlightedRef.current) {
        lastHighlightedRef.current = highlighted.productId;
        void openPurchase(highlighted);
      }
    } else if (event.type === 'comment_removed') {
      setComments(prev => prev.filter(c => c.id !== event.commentId));
      mod.handleEvent(event);
    } else if (event.type === 'comment_pinned' || event.type === 'cohosts') {
      mod.handleEvent(event);
      if (event.type === 'cohosts') setCohosts(Array.isArray(event.cohosts) ? event.cohosts : []);
    } else if (event.type === 'removed' || (event.type === 'user_banned' && event.userId === user?.id)) {
      // The host banned this viewer: off the stream, no rejoin.
      Alert.alert('Removed from the live', 'The host removed you from this live.');
      handleLeave(true);
    } else if (event.type === 'viewerCount') {
      setViewerCount(event.count);
    } else if (event.type === 'ended') {
      setReplayStatus(event.replayStatus ?? null);
      setEnded(true);
    } else if (event.type === 'purchase' || event.type === 'gift') {
      if (event.type === 'purchase' && 'buyerFirstName' in event.purchase) purchaseToasts.push(event.purchase);
      const a = roomAnnouncement(event.type === 'purchase' ? event.purchase : event.gift);
      setComments(prev => prev.some(c => c.id === a.id) ? prev : [...prev, {
        id: a.id, display_name: a.name, message: a.text, created_at: a.at, kind: event.type,
      }].slice(-80));
      commentsScroll.requestScrollToEnd();
    } else if (event.type === 'bag') {
      refreshBag();
    }
  }, [user?.id, mod.handleEvent, refreshBag, commentsScroll.requestScrollToEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  const startFallbackPolling = React.useCallback((active: boolean) => {
    if (fallbackPollRef.current) { clearInterval(fallbackPollRef.current); fallbackPollRef.current = null; }
    if (!active) return;
    // HTTP fallback: refresh via the same one-shot backfill the socket
    // normally makes unnecessary, and keep this viewer's presence row alive
    // with the HTTP heartbeat route (the WebSocket heartbeat covers this
    // when the socket is up — see ws/liveHub.ts).
    fallbackPollRef.current = setInterval(() => {
      void poll();
      if (joinedRef.current) void (api as any).live.heartbeat(params.streamId).catch(() => {});
    }, 15000);
  }, []);

  useLiveSocket({
    streamId: params.streamId,
    enabled: !loading && !ended && !!params.streamId,
    onEvent: handleLiveEvent,
    onConnected: () => {
      void poll();
      mod.refresh();
      refreshBag();
      (api as any).liveCohost.list(params.streamId).then((r: any) => setCohosts(r?.cohosts ?? [])).catch(() => {});
    },
    onFallback: startFallbackPolling,
  });

  async function init() {
    // A link without a stream id can't be loaded — the not-available state.
    if (!params.streamId) { setLoading(false); return; }
    setLoadError(null);
    setLoading(true);
    try {
      // Get stream details
      const streamData = await (api as any).live.get(params.streamId) as any;
      const s = streamData.stream;
      // Keep the ended stream's details: the ended state links its replays.
      if (s) setStream(s);
      if (!s || s.status !== 'live') { setEnded(true); setLoading(false); return; }
      setStream(s);
      hostUidRef.current = typeof s.agora_uid === 'number' ? s.agora_uid : null;
      setViewerCount(s.viewer_count ?? 0);
      setProductTags(Array.isArray(s.product_tags) ? s.product_tags : []);

      // Join — get Agora token. From here on this viewer is "present": the
      // WebSocket connection below (enabled once loading clears) heartbeats
      // presence while it's up; the HTTP /heartbeat route is the fallback.
      const joinData = await (api as any).live.join(params.streamId) as any;
      joinedRef.current = true;

      connectVideo(joinData);
    } catch (e: any) {
      if (e?.status === 403) {
        showAlert('Couldn’t join the live', apiErrorMessage(e, 'Try again.'));
        goBackOr(router);
      } else {
        setLoadError(friendlyError(e, 'We couldn’t load this live. Try again.'));
      }
    } finally {
      setLoading(false);
    }
    // Realtime updates now come from useLiveSocket above (connects once
    // `loading` clears) — it does its own one-shot backfill via poll() on
    // connect, and falls back to polling only if the socket can't connect.
  }

  function clearVideoTimeout() {
    if (videoTimeoutRef.current) { clearTimeout(videoTimeoutRef.current); videoTimeoutRef.current = null; }
  }

  function failVideo(reason: unknown) {
    console.warn('[Agora viewer]', reason);
    clearVideoTimeout();
    setVideoState(prev => (prev === 'connected' ? prev : 'failed'));
  }

  function releaseEngine() {
    try { engineRef.current?.leaveChannel(); engineRef.current?.release(); } catch {}
    engineRef.current = null;
  }

  // Starts (or restarts) the Agora viewer. Bounded by a timeout so a stream
  // whose video never arrives shows an error with Retry instead of sitting on
  // "Connecting…" forever.
  function connectVideo(joinData: any) {
    if (!AgoraModule) { setVideoState('unsupported'); return; }
    clearVideoTimeout();
    setVideoState('connecting');
    if (!joinData?.agoraAppId || !joinData?.channelName) {
      failVideo('join response had no Agora app id / channel');
      return;
    }
    videoTimeoutRef.current = setTimeout(() => {
      videoTimeoutRef.current = null;
      setVideoState(prev => (prev === 'connecting' ? 'failed' : prev));
    }, LIVE_VIDEO_CONNECT_TIMEOUT_MS);
    const { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } = AgoraModule;
    try {
      const engine = createAgoraRtcEngine();
      engine.initialize({ appId: joinData.agoraAppId });
      engine.setChannelProfile(ChannelProfileType.ChannelProfileLiveBroadcasting);
      engine.setClientRole(ClientRoleType.ClientRoleAudience);
      engine.enableVideo();
      engine.registerEventHandler({
        // react-native-agora v6 passes (connection, remoteUid); accept either shape.
        // With co-hosts there can be several publishers: only the host's uid is the
        // main video, and only the host going offline ends the stream.
        onUserJoined: (a: any, b?: number) => {
          const uid: number = typeof a === 'number' ? a : (b as number);
          if (hostUidRef.current == null || uid === hostUidRef.current) {
            clearVideoTimeout();
            setBroadcastUid(uid);
            setAgoraReady(true);
            setVideoState('connected');
          }
        },
        onUserOffline: (a: any, b?: number) => {
          const uid: number = typeof a === 'number' ? a : (b as number);
          if (hostUidRef.current != null && uid !== hostUidRef.current) return;
          void (api as any).live.get(params.streamId)
            .then((data: any) => { if (data?.stream?.status !== 'live') setEnded(true); })
            .catch(() => {});
        },
        onJoinChannelSuccess: () => {},
        onError: (err: any) => failVideo(err),
      });
      engine.joinChannel(
        joinData.token || null,
        joinData.channelName,
        joinData.agoraUid,
        { clientRoleType: AgoraModule.ClientRoleType.ClientRoleAudience },
      );
      engineRef.current = engine;
    } catch (e) {
      failVideo(e);
    }
  }

  async function retryVideo() {
    if (retryingVideo) return;
    hapticLight();
    setRetryingVideo(true);
    releaseEngine();
    setBroadcastUid(null);
    setAgoraReady(false);
    setVideoState('connecting');
    try {
      // A fresh join gets a fresh token (the old one may be why it failed).
      const joinData = await (api as any).live.join(params.streamId) as any;
      joinedRef.current = true;
      connectVideo(joinData);
    } catch (e: any) {
      failVideo(e);
      Alert.alert('Couldn’t join the live', apiErrorMessage(e, 'Try again.'));
    } finally {
      setRetryingVideo(false);
    }
  }

  async function poll() {
    try {
      const [commData, streamData] = await Promise.all([
        (api as any).live.comments(params.streamId, lastTs.current) as Promise<any>,
        (api as any).live.get(params.streamId) as Promise<any>,
      ]);
      const fresh: Comment[] = (commData.comments ?? []).reverse();
      if (fresh.length) {
        lastTs.current = fresh[fresh.length - 1].created_at;
        setComments(prev => [...prev, ...fresh].slice(-80));
        commentsScroll.requestScrollToEnd();
      }
      if (streamData.stream?.status !== 'live') setEnded(true);
      setViewerCount(streamData.stream?.viewer_count ?? 0);
      const nextTags: ProductTag[] = streamData.stream?.product_tags ?? [];
      setProductTags(nextTags);
      const highlighted = nextTags.find(tag => tag.highlighted);
      if (highlighted && highlighted.productId !== lastHighlightedRef.current) {
        lastHighlightedRef.current = highlighted.productId;
        void openPurchase(highlighted);
      }
    } catch {}
  }

  async function handleLeave(navigate = true) {
    if (fallbackPollRef.current) { clearInterval(fallbackPollRef.current); fallbackPollRef.current = null; }
    try { await (api as any).live.leave(params.streamId); } catch {}
    try { engineRef.current?.leaveChannel(); engineRef.current?.release(); } catch {}
    if (navigate) goBackOr(router);
  }

  async function sendComment() {
    const msg = commentText.trim();
    if (!msg) return;
    setCommentText('');
    // Optimistic update
    const optimistic: Comment = {
      id: Date.now().toString(),
      display_name: user?.firstName ?? user?.username ?? 'You',
      message: msg,
      created_at: new Date().toISOString(),
    };
    setComments(prev => [...prev, optimistic].slice(-80));
    commentsScroll.requestScrollToEnd();
    try {
      await (api as any).live.comment(params.streamId, {
        message: msg,
        displayName: user?.firstName ?? user?.username ?? 'Viewer',
      });
    } catch (error) {
      // Live chat can't wait for review, so filtered messages are withdrawn
      // with the reason and the draft restored for editing.
      setComments(prev => prev.filter(c => c.id !== optimistic.id));
      setCommentText(msg);
      Alert.alert('Message not sent', apiErrorMessage(error, 'Check your connection and try again.'));
    }
  }

  async function shareStream() {
    const sellerName: string = stream?.brand_name ?? stream?.seller_name ?? 'this seller';
    const title = stream?.title ?? `${sellerName} live`;
    // https link (BT-320): unfurls and opens for people without the app.
    const streamUrl = buildLiveUrl(params.streamId) ?? ExpoLinking.createURL('/buyer-live', {
      queryParams: { streamId: params.streamId },
    });
    try {
      await Share.share({
        message: `Watch ${sellerName} live on Brandthread: ${title}\n${streamUrl}`,
        url: streamUrl,
      });
    } catch {
      // User dismissed the native share sheet — nothing to do.
    }
  }

  function openStreamOptions(event?: unknown) {
    const sellerId: string | undefined = stream?.seller_id;
    const sellerName: string = stream?.brand_name ?? stream?.seller_name ?? 'this seller';
    openPullDownMenu(event, menuItemsFromButtons([
      {
        text: 'Report live stream',
        style: 'destructive' as const,
        onPress: () => router.push(reportHref({
          targetType: 'live',
          targetId: params.streamId,
          label: stream?.title ?? `${sellerName} live`,
          ownerId: sellerId,
          ownerName: sellerName,
        }) as never),
      },
      ...(sellerId ? [{
        text: `Block ${sellerName}`,
        style: 'destructive' as const,
        onPress: async () => {
          if (await confirmBlock({ userId: sellerId, name: sellerName }, api.social.block)) handleLeave(true);
        },
      }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]).map((item, i) => ({ ...item, icon: i === 0 ? 'flag' as const : 'slash' as const })), { title: sellerName });
  }

  function openChatMessageOptions(comment: Comment) {
    if (!comment.user_id || comment.user_id === user?.id) return;
    const authorId = comment.user_id;
    Alert.alert(comment.display_name, comment.message, [
      {
        text: 'Report message',
        onPress: () => router.push(reportHref({
          targetType: 'live_comment',
          targetId: comment.id,
          label: `${comment.display_name}: “${comment.message.slice(0, 80)}”`,
          ownerId: authorId,
          ownerName: comment.display_name,
        }) as never),
      },
      {
        text: `Block ${comment.display_name}`,
        style: 'destructive',
        onPress: async () => {
          if (await confirmBlock({ userId: authorId, name: comment.display_name }, api.social.block)) {
            setComments(prev => prev.filter(c => c.user_id !== authorId));
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ─── Live auction (live_auctions flag): Whatnot-style card above the composer ──
  const liveAuctionsEnabled = useAuctionFlag('live_auctions');
  const auctionState = useLiveAuction(params.streamId, { enabled: liveAuctionsEnabled && !loading && !ended, viewerId: user?.id });
  const auctionEventRef = useRef(auctionState.handleEvent);
  auctionEventRef.current = auctionState.handleEvent;
  const [customBidOpen, setCustomBidOpen] = useState(false);
  const [bidBusy, setBidBusy] = useState(false);
  // The win being paid for: checkout sends its id and the server charges the winning price.
  const [payingAuction, setPayingAuction] = useState<LiveAuction | null>(null);
  const placeBid = async (amountCents: number) => {
    hapticPrimaryAction();
    setBidBusy(true);
    const message = await auctionState.bid(amountCents);
    setBidBusy(false);
    if (message) setOrderSnackbar(message);
  };
  const payAuction = (a: LiveAuction) => {
    void openPurchase({ productId: a.productId, productName: a.productName, priceCents: a.currentBidCents ?? a.startingBidCents }, a);
  };
  // Opened from the LIVE pager's "Pay" (app/live.tsx): go straight to paying.
  const payParamHandled = useRef(false);
  useEffect(() => {
    const a = auctionState.auction;
    if (payParamHandled.current || !params.payAuction || !a || a.id !== params.payAuction || !a.payable) return;
    payParamHandled.current = true;
    payAuction(a);
  }, [auctionState.auction, params.payAuction]); // eslint-disable-line react-hooks/exhaustive-deps
  const auctionPaying = !!payingAuction && purchaseTag?.productId === payingAuction.productId;

  /** Closes the buy sheet; the auction being paid (if any) ends with it. */
  function closePurchase() {
    setPurchaseTag(null);
    setPayingAuction(null);
  }

  /** `auction` only when paying a won auction; every other open is a plain buy. */
  async function openPurchase(tag: ProductTag, auction: LiveAuction | null = null) {
    setPayingAuction(auction);
    setPurchaseTag(tag);
    setPurchaseProduct(null);
    setSelectedVariantId('');
    setCheckoutError('');
    setPurchaseLoading(true);
    try {
      const product = await api.publicProducts.get(tag.productId);
      if (product?.sellerVacationMode) {
        setCheckoutError(product.sellerVacationMessage ?? 'This seller is currently away and is not accepting purchases.');
      }
      setPurchaseProduct(product);
      const firstAvailable = (product?.variants ?? []).find((variant: any) => (variant.stock ?? 0) > 0);
      setSelectedVariantId(firstAvailable?.id ?? '');
    } catch (error: any) {
      setCheckoutError('Couldn’t load this piece.');
    } finally {
      setPurchaseLoading(false);
    }
  }

  async function checkoutInStream() {
    if (!purchaseProduct || !selectedVariantId) {
      setCheckoutError('Choose an available option first.');
      return;
    }
    if (!buyerEmail.trim() || !buyerName.trim() || !/^[0-9+(). -]{7,32}$/.test(buyerPhone.trim()) || !street.trim() || !city.trim() || !region.trim() || !postalCode.trim()) {
      setCheckoutError('Add your name, email, phone number, and shipping address to continue.');
      return;
    }
    setCheckoutBusy(true);
    setCheckoutError('');
    try {
      const result = await api.buyer.checkout.createSession(
        [{ variantId: selectedVariantId, productId: purchaseProduct.id, quantity: 1, ...(auctionPaying ? { auctionId: payingAuction!.id } : {}) }] as any,
        {
          contactEmail: buyerEmail.trim(),
          contactPhone: buyerPhone.trim(),
          shippingAddress: {
            recipientName: buyerName.trim(),
            street: street.trim(),
            city: city.trim(),
            state: region.trim(),
            postalCode: postalCode.trim(),
            country: 'US',
            phone: buyerPhone.trim(),
          },
          clientIdempotencyKey: `live_${params.streamId}_${purchaseProduct.id}_${Date.now()}`,
          // Attributes the order to this live (validated server-side).
          liveStreamId: params.streamId,
        },
      );
      const browser = await WebBrowser.openAuthSessionAsync(result.url, currentCheckoutReturnUrls().redirectUrl);
      const returnedUrl = browser.type === 'success' ? browser.url : null;
      // Closing the page is not proof of a cancel: ask Stripe first.
      const attempts = browser.type === 'success' && !/[?&]cancelled=1/.test(returnedUrl ?? '') ? 6 : 2;
      let verification: any = null;
      let verifyFailed = false;
      try {
        for (let attempt = 0; attempt < attempts; attempt++) {
          verification = await api.buyer.checkout.verifySession(result.sessionId);
          if (verification?.paymentStatus === 'paid' || verification?.orderNumber) break;
          if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch {
        // The checkout page has already been shown: the charge may exist, so
        // this is never "couldn't start checkout" (same rule as BuyNowFlow).
        verifyFailed = true;
      }
      const verdict = hostedCheckoutVerdict({
        browserType: browser.type,
        returnedUrl,
        paymentStatus: verification?.paymentStatus,
        orderId: verification?.orderId,
        declineReason: verification?.declineReason,
      });
      if (verdict === 'cancelled' && !verifyFailed) {
        setCheckoutError('Payment was cancelled. The live stream is still playing.');
        return;
      }
      if (verification?.paymentStatus !== 'paid') {
        if (verification?.declineReason) haptic('error');
        setCheckoutError(verification?.declineReason ?? 'Payment is still pending. Please check your orders shortly.');
        return;
      }
      track('checkout_completed', { flow: 'live', item_count: 1 });
      haptic('purchaseSuccess');
      setOrderSnackbar(verification.orderNumber
        ? `Order ${verification.orderNumber} confirmed`
        : 'Order confirmed');
      closePurchase();
    } catch (error: any) {
      setCheckoutError('Couldn’t start checkout. Try again.');
    } finally {
      setCheckoutBusy(false);
    }
  }

  const RemoteVideoView = AgoraModule ? AgoraModule.RtcSurfaceView : null;

  if (loading) {
    return (
      <View style={[s.root, s.center]}>
        <ActivityIndicator color={LIVE_RED} size="large" />
        <Text style={[s.loadingText, { color: MUTED }]}>Joining stream…</Text>
      </View>
    );
  }

  if (!params.streamId) {
    return (
      <View style={[s.root, s.center]} testID="buyer-live-unavailable">
        <Icon name="video-off" size={32} color={MUTED} />
        <Text style={[s.endedTitle, { color: FG, marginTop: 12 }]}>Live not available</Text>
        <Text style={[s.endedSub, { color: MUTED }]}>This link is incomplete. Open the live again from the seller’s profile or your notifications.</Text>
        <PressableScale onPress={() => goBackOr(router)} style={[s.backBtn, { backgroundColor: theme.accent }]} accessibilityRole="button">
          <Text style={[s.backBtnText, { color: theme.onAccent }]}>Back</Text>
        </PressableScale>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[s.root, s.center]} testID="buyer-live-error">
        <Icon name="wifi-off" size={32} color={MUTED} />
        <Text style={[s.endedTitle, { color: FG, marginTop: 12 }]}>Couldn’t load this live</Text>
        <Text style={[s.endedSub, { color: MUTED }]}>{loadError}</Text>
        <PressableScale onPress={() => { void init(); }} style={[s.backBtn, { backgroundColor: theme.accent }]} accessibilityRole="button" testID="buyer-live-retry">
          <Text style={[s.backBtnText, { color: theme.onAccent }]}>Try again</Text>
        </PressableScale>
        <PressableScale onPress={() => goBackOr(router)} style={{ marginTop: 12, padding: 8 }} accessibilityRole="button">
          <Text style={[s.endedSub, { color: MUTED }]}>Back</Text>
        </PressableScale>
      </View>
    );
  }

  if (ended) {
    const endedSellerId: string | undefined = stream?.seller_id;
    return (
      <View style={[s.root, s.center]}>
        <View style={[s.endedIcon, { backgroundColor: `${LIVE_RED}20` }]}>
          <Icon name="video-off" size={32} color={LIVE_RED} />
        </View>
        <Text style={[s.endedTitle, { color: FG }]}>Stream ended</Text>
        {replayStatus !== 'unavailable' && (
          <Text style={[s.endedSub, { color: MUTED }]}>
            {replayStatus === 'ready'
              ? 'The replay is saved on the seller’s profile.'
              : 'The replay will be saved on the seller’s profile shortly.'}
          </Text>
        )}
        {replayStatus !== 'unavailable' && endedSellerId ? (
          <PressableScale
            onPress={() => router.replace(`/live-replays?sellerId=${encodeURIComponent(endedSellerId)}` as never)}
            style={{ marginTop: 12, padding: 8 }}
            accessibilityRole="button"
            testID="buyer-live-replays"
          >
            <Text style={[s.endedSub, { color: FG }]}>See replays</Text>
          </PressableScale>
        ) : null}
        <PressableScale onPress={() => goBackOr(router)} style={[s.backBtn, { backgroundColor: LIVE_RED }]}>
          <Text style={s.backBtnText}>Back to feed</Text>
        </PressableScale>
      </View>
    );
  }

  return (
    <View style={s.root}>
      {/* Video — Agora remote view or placeholder (inside the split stage below while co-hosts are on) */}
      {cohosts.length > 0 ? null : RemoteVideoView && broadcastUid != null ? (
        <RemoteVideoView
          canvas={{ uid: broadcastUid, renderMode: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, s.videoPlaceholder]}>
          <Icon name="video" size={40} color={MUTED} />
          {videoState === 'connecting' ? <ActivityIndicator color={MUTED} /> : null}
          <Text style={s.videoPlaceholderText}>
            {liveVideoPlaceholderText(videoState)}
          </Text>
          {canRetryLiveVideo(videoState) ? (
            <PressableScale
              onPress={retryVideo}
              disabled={retryingVideo}
              style={[s.backBtn, { backgroundColor: LIVE_RED, marginTop: 4 }]}
              accessibilityRole="button"
              accessibilityLabel="Retry live video"
            >
              <Text style={s.backBtnText}>{retryingVideo ? 'Retrying…' : 'Retry'}</Text>
            </PressableScale>
          ) : null}
        </View>
      )}

      {/* Co-hosts on stage: host on top, co-hosts below. */}
      <LiveCohostSplit
        hostUid={broadcastUid ?? hostUidRef.current}
        hostName={stream?.brand_name ?? stream?.seller_name ?? 'Host'}
        hostAvatarUrl={stream?.avatar_url ?? null}
        cohosts={cohosts}
        RtcSurfaceView={RemoteVideoView}
      />

      {/* Dark overlay */}
      <View style={[StyleSheet.absoluteFill, s.overlay]} pointerEvents="none" />

      {/* Top bar */}
      <View style={[s.topBar, { paddingTop: headerTopInset + 8 }]}>
        <View style={s.topLeft}>
          <View style={[s.livePill, { backgroundColor: LIVE_RED }]}>
            <View style={s.liveDot} />
            <Text style={s.livePillText}>LIVE</Text>
          </View>
          <Text style={s.sellerName} numberOfLines={1}>
            {stream?.brand_name ?? stream?.seller_name ?? 'Live'}
          </Text>
        </View>
        <View style={s.topRight}>
          <View style={[s.viewerBadge, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
            <Icon name="eye" size={13} color="#fff" />
            <Text style={s.viewerText}>{viewerCount.toLocaleString()}</Text>
          </View>
          {liveTipsEnabled && stream?.seller_id ? (
            <IconButton
              name="gift"
              onPress={() => { hapticLight(); setGiftOpen(true); }}
              variant="plain"
              color="#fff"
              accessibilityLabel="Send Thread Cash to the host"
              testID="buyer-live-gift"
            />
          ) : null}
          <IconButton
            name="share"
            onPress={shareStream}
            variant="plain"
            color="#fff"
            accessibilityLabel="Share this live stream"
          />
          <IconButton
            name="more-horizontal"
            onPress={openStreamOptions}
            variant="plain"
            color="#fff"
            accessibilityLabel="Live stream options"
          />
          <IconButton
            name="x"
            onPress={() => handleLeave(true)}
            variant="plain"
            color="#fff"
            accessibilityLabel="Leave live stream"
          />
        </View>
      </View>

      {/* Stream title */}
      <View style={[s.titleRow, { paddingTop: headerTopInset + 48 }]}>
        <Text style={s.streamTitle} numberOfLines={2}>{stream?.title}</Text>
      </View>

      {/* Purchases from this live */}
      <LivePurchaseToast purchase={purchaseToasts.current} top={headerTopInset + 96} />

      {/* Product tags strip */}
      {productTags.length + cohostTags.length > 0 && (
        <View style={[s.productStrip, { bottom: 155 + insets.bottom }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.productStripInner}>
            {[...productTags, ...cohostTags.filter(c => !productTags.some(t => t.productId === c.productId))].map(tag => (
              <PressableScale
                key={tag.productId}
                onPress={() => { haptic('sheet'); openPurchase(tag); }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Shop ${tag.productName}, ${formatMoney(tag.priceCents)}`}
                style={[s.productChip, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
              >
                <Icon name="shopping-bag" size={12} color={LIVE_RED} />
                <Text style={s.productChipName} numberOfLines={1}>{tag.productName}</Text>
                <Text style={s.productChipPrice}>{formatMoney(tag.priceCents)}</Text>
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Comments + input */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.bottom}
      >
        <PinnedCommentBar comment={mod.pinned} />
        <ScrollView
          ref={scrollRef}
          style={s.commentScroll}
          onContentSizeChange={commentsScroll.onContentSizeChange}
          onScrollBeginDrag={commentsScroll.cancelScrollToEnd}
          contentContainerStyle={s.commentContent}
          showsVerticalScrollIndicator={false}
          pointerEvents="box-none"
        >
          {comments.map(c => (
            <PressableScale
              key={c.id}
              style={s.commentRow}
              activeOpacity={0.85}
              onLongPress={() => openChatMessageOptions(c)}
              delayLongPress={350}
              accessibilityHint="Long press to report or block"
            >
              {c.kind ? <Icon name={c.kind === 'gift' ? 'gift' : 'shopping-bag'} size={12} color={FG} style={s.commentIcon} /> : null}
              <Text style={s.commentName}>{c.display_name} </Text>
              <Text style={s.commentMsg}>{c.message}</Text>
            </PressableScale>
          ))}
        </ScrollView>
        <Composer
          overMedia
          value={commentText}
          onChangeText={setCommentText}
          onSend={() => { sendComment(); }}
          placeholder="Add a comment…"
          accessibilityLabel="Add a comment"
          hideTabBar={false}
          testID="buyer-live-composer"
        />
        {liveAuctionsEnabled && auctionState.auction ? (
          <View style={{ marginHorizontal: 12, marginBottom: insets.bottom + 8 }}>
            <LiveAuctionCard
              auction={auctionState.auction}
              receivedAt={auctionState.receivedAt}
              busy={bidBusy}
              onBid={amount => { void placeBid(amount); }}
              onCustom={() => setCustomBidOpen(true)}
              onPay={() => payAuction(auctionState.auction!)}
            />
          </View>
        ) : null}
      </KeyboardAvoidingView>
      {liveAuctionsEnabled && auctionState.auction ? (
        <LiveAuctionBidSheet
          auction={auctionState.auction}
          receivedAt={auctionState.receivedAt}
          visible={customBidOpen}
          onClose={() => setCustomBidOpen(false)}
          onSubmit={auctionState.bid}
        />
      ) : null}

      {purchaseTag && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[s.purchaseSheet, { maxHeight: H * 0.78, paddingBottom: insets.bottom + SP.sm }]}
        >
          <View style={s.purchaseHandle} />
          <View style={s.purchaseHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.purchaseEyebrow}>Buy without leaving</Text>
              <Text style={s.purchaseTitle} numberOfLines={1}>{purchaseTag.productName}</Text>
            </View>
            <PressableScale
              onPress={() => { haptic('sheet'); closePurchase(); }}
              style={s.purchaseClose}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Close purchase sheet"
            >
              <Icon name="x" size={20} color={FG} />
            </PressableScale>
          </View>
          {purchaseLoading ? (
            <ActivityIndicator color={PURPLE} style={{ marginVertical: SP.lg }} />
          ) : (
            <ScrollView
              style={s.purchaseScroll}
              contentContainerStyle={s.purchaseContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={s.purchasePrice}>
                {formatMoney(auctionPaying ? purchaseTag.priceCents : (
                  (purchaseProduct?.variants ?? []).find((variant: any) => variant.id === selectedVariantId)?.priceCents
                    ?? purchaseTag.priceCents),
                )}
              </Text>
              <Text style={s.fieldLabel}>Option</Text>
              <View style={s.variantRow}>
                {(purchaseProduct?.variants ?? []).map((variant: any) => {
                  const available = (variant.stock ?? 0) > 0;
                  const label = [variant.size, variant.color].filter(Boolean).join(' / ') || 'Default';
                  return (
                    <PressableScale
                      key={variant.id}
                      disabled={!available}
                      onPress={() => { haptic('select'); setSelectedVariantId(variant.id); }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: selectedVariantId === variant.id, disabled: !available }}
                      style={[
                        s.variantChip,
                        selectedVariantId === variant.id && { borderColor: PURPLE },
                        !available && s.variantDisabled,
                      ]}
                    >
                      <Text style={s.variantText}>{label}</Text>
                    </PressableScale>
                  );
                })}
              </View>
              <Text style={s.fieldLabel}>Delivery</Text>
              <TextInput ref={(r) => { deliveryRefs.current.buyerEmail = r; }} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={focusDelivery('buyerName')} autoComplete="email" textContentType="emailAddress" value={buyerEmail} onChangeText={setBuyerEmail} placeholder="Email" placeholderTextColor={SUBTLE} keyboardType="email-address" autoCapitalize="none" style={s.purchaseInput} />
              <TextInput ref={(r) => { deliveryRefs.current.buyerName = r; }} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={focusDelivery('buyerPhone')} autoComplete="name" textContentType="name" autoCapitalize="words" value={buyerName} onChangeText={setBuyerName} placeholder="Full name" placeholderTextColor={SUBTLE} style={s.purchaseInput} />
              <TextInput ref={(r) => { deliveryRefs.current.buyerPhone = r; }} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={focusDelivery('street')} autoComplete="tel" textContentType="telephoneNumber" value={buyerPhone} onChangeText={setBuyerPhone} placeholder="Phone number" placeholderTextColor={SUBTLE} keyboardType="phone-pad" style={s.purchaseInput} />
              <TextInput ref={(r) => { deliveryRefs.current.street = r; }} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={focusDelivery('city')} autoComplete="street-address" textContentType="fullStreetAddress" value={street} onChangeText={setStreet} placeholder="Street address" placeholderTextColor={SUBTLE} style={s.purchaseInput} />
              <View style={s.addressRow}>
                <TextInput ref={(r) => { deliveryRefs.current.city = r; }} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={focusDelivery('region')} autoComplete="postal-address-locality" textContentType="addressCity" value={city} onChangeText={setCity} placeholder="City" placeholderTextColor={SUBTLE} style={[s.purchaseInput, { flex: 1 }]} />
                <TextInput ref={(r) => { deliveryRefs.current.region = r; }} returnKeyType="next" blurOnSubmit={false} onSubmitEditing={focusDelivery('postalCode')} autoComplete="postal-address-region" textContentType="addressState" value={region} onChangeText={setRegion} placeholder="State" placeholderTextColor={SUBTLE} autoCapitalize="characters" style={[s.purchaseInput, s.regionInput]} />
                <TextInput ref={(r) => { deliveryRefs.current.postalCode = r; }} returnKeyType="done" autoComplete="postal-code" textContentType="postalCode" value={postalCode} onChangeText={setPostalCode} placeholder="ZIP" placeholderTextColor={SUBTLE} keyboardType="numbers-and-punctuation" style={[s.purchaseInput, s.postalInput]} />
              </View>
              {checkoutError ? <Text style={s.checkoutError}>{checkoutError}</Text> : null}
              <PressableScale
                onPress={() => { checkoutInStream(); }}
                disabled={checkoutBusy || !!purchaseProduct?.sellerVacationMode}
                accessibilityRole="button"
                style={[s.buyNowButton, { backgroundColor: PURPLE }, (checkoutBusy || purchaseProduct?.sellerVacationMode) && s.buyNowDisabled]}
              >
                {checkoutBusy ? <ActivityIndicator color={BG} /> : (
                  <Text style={s.buyNowText}>
                    {purchaseProduct?.sellerVacationMode ? 'Seller is away' : 'Buy now'}
                  </Text>
                )}
              </PressableScale>
              <Text style={s.purchaseFootnote}>Secure payment opens over the live stream. Return here when finished.</Text>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      )}

      {liveTipsEnabled && giftOpen && stream?.seller_id ? (
        <LiveThreadCashSheet
          visible
          brandName={stream?.brand_name ?? stream?.seller_name ?? 'the host'}
          recipientId={stream.seller_id}
          streamId={params.streamId}
          onClose={() => setGiftOpen(false)}
          // The server announces the gift to the room (a `gift` event).
          onSent={() => setGiftOpen(false)}
          onSendFailed={message => { setGiftOpen(false); setOrderSnackbar(message); }}
        />
      ) : null}

      <Snackbar
        visible={!!orderSnackbar}
        message={orderSnackbar}
        onDismiss={() => setOrderSnackbar('')}
      />
    </View>
  );
}

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const PURPLE = theme.accent;
  return StyleSheet.create({
  root:             { flex: 1, backgroundColor: 'transparent' },
  center:           { alignItems: 'center', justifyContent: 'center', gap: 12 },
  overlay:          { backgroundColor: 'rgba(0,0,0,0.2)' },
  videoPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a', gap: 12 },
  videoPlaceholderText: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', paddingHorizontal: 40 },
  loadingText:      { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 8 },
  topBar:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  topLeft:          { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  topRight:         { flexDirection: 'row', alignItems: 'center', gap: 10 },
  livePill:         { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 4 },
  liveDot:          { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  livePillText:     { color: '#fff', fontFamily: FONT.bold, fontSize: 11 },
  sellerName:       { color: '#fff', fontFamily: FONT.semibold, fontSize: 13, flex: 1 },
  viewerBadge:      { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 4 },
  viewerText:       { color: '#fff', fontFamily: FONT.semibold, fontSize: 12 },
  leaveBtn:         { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  titleRow:         { position: 'absolute', top: 0, left: 14, right: 60, zIndex: 9 },
  streamTitle:      { color: TEXT_SECONDARY, fontFamily: FONT.medium, fontSize: 13 },
  productStrip:     { position: 'absolute', bottom: 155, left: 0, right: 0, zIndex: 8 },
  productStripInner:{ paddingHorizontal: 12, gap: 8 },
  productChip:      { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 7 },
  productChipName:  { color: '#fff', fontFamily: FONT.semibold, fontSize: 12, maxWidth: 90 },
  productChipPrice: { color: TEXT_SECONDARY, fontFamily: FONT.regular, fontSize: 11 },
  bottom:           { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 },
  commentScroll:    { maxHeight: 185, marginHorizontal: 12 },
  commentContent:   { gap: 3, paddingBottom: 6 },
  commentRow:       { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingVertical: 3 },
  commentName:      { color: '#fff', fontFamily: FONT.bold, fontSize: 12 },
  commentMsg:       { color: FG, fontFamily: FONT.regular, fontSize: 12 },
  commentIcon:      { marginRight: 5, marginTop: 1 },
  purchaseSheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 30,
    backgroundColor: BG, borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingTop: SP.xs,
  },
  purchaseHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: 'center', marginBottom: SP.md },
  purchaseHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  purchaseEyebrow: { color: LIVE_RED, fontFamily: FONT.bold, fontSize: FS.xs, marginBottom: 4 },
  purchaseTitle: { color: FG, fontFamily: FONT.bold, fontSize: FS.lg },
  purchaseClose: { width: 38, height: 38, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: BORDER },
  purchaseScroll: { marginTop: SP.sm },
  purchaseContent: { paddingBottom: SP.md, gap: SP.sm },
  purchasePrice: { fontVariant: ['tabular-nums'],  color: FG, fontFamily: FONT.bold, fontSize: FS.xl },
  fieldLabel: { color: MUTED, fontFamily: FONT.semibold, fontSize: FS.xs, marginTop: SP.xs },
  variantRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs },
  variantChip: { borderWidth: 1, borderColor: BORDER, borderRadius: radius.sm, paddingHorizontal: SP.sm, paddingVertical: SP.xs },
  variantDisabled: { opacity: 0.35 },
  variantText: { color: FG, fontFamily: FONT.medium, fontSize: FS.xs },
  purchaseInput: { minHeight: 44, borderWidth: 1, borderColor: BORDER, borderRadius: RADIUS.md, paddingHorizontal: SP.sm, color: FG, fontFamily: FONT.regular, fontSize: FS.sm },
  addressRow: { flexDirection: 'row', gap: SP.xs },
  regionInput: { width: 72 },
  postalInput: { width: 88 },
  checkoutError: { color: RED, fontFamily: FONT.medium, fontSize: FS.xs, lineHeight: 17 },
  buyNowButton: { minHeight: 48, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', marginTop: SP.xs },
  buyNowDisabled: { opacity: 0.45 },
  buyNowText: { color: BG, fontFamily: FONT.bold, fontSize: FS.sm },
  purchaseFootnote: { color: MUTED, fontFamily: FONT.regular, fontSize: FS.xs, textAlign: 'center', lineHeight: 15 },
  // Ended
  endedIcon:        { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  endedTitle:       { fontSize: FS.lg, fontFamily: FONT.bold },
  endedSub:         { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },
  backBtn:          { marginTop: 24, borderRadius: radius.md, paddingHorizontal: 28, paddingVertical: 12 },
  backBtnText:      { color: '#fff', fontFamily: FONT.semibold, fontSize: FS.sm },
  });
};
