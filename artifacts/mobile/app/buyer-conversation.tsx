import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TextInput,
  KeyboardAvoidingView, Alert, Platform, StyleSheet, Dimensions,
  ListRenderItemInfo, Modal, ScrollView, ActivityIndicator, Animated,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { Snackbar } from '@/components/ui/Snackbar';
import { hapticPrimaryAction, hapticSuccessAction, hapticSelection, hapticDestructiveConfirm } from '@/lib/haptics';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  getConversation, createOrGetConversation, getMessages,
  sendMessage, retryMessage, addReaction, deleteMessageForMe,
  markConversationRead, subscribeSocial,
  MY_USER_ID,
} from '@/services/socialService';
import type {
  Conversation, Message, MessageAttachment, ConversationParticipant, ReactionType,
} from '@/services/socialTypes';
import { useApi } from '@/lib/api';
import * as ImagePicker from 'expo-image-picker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from 'expo-audio';
import { useAuth } from '@clerk/expo';
import { apiErrorMessage, confirmBlock, confirmUnblock, reportHref } from '@/lib/safety';
import { BlockedComposer, type DmMessagingState } from '@/components/safety/DmSafety';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { SheetRise } from '@/components/motion/SheetRise';
import ChatWallpaper from '@/components/chat/ChatWallpaper';
import UploadRing from '@/components/chat/UploadRing';
import MediaViewer from '@/components/chat/MediaViewer';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { ThreadCashAttachButton } from '@/components/thread-cash/ChatAttachThreadCash';
import {
  ReactionChipsRow, ReactionGlyph, reactionAuthorId, reactionAuthorName, reactionKind,
} from '@/components/chat/ReactionBar';

// ─── Types ────────────────────────────────────────────────────────────────────

type SellerProduct = {
  id: string;
  name: string;
  images?: string[] | null;
  variants?: Array<{ priceCents?: number | null }>;
  category?: string | null;
};

type SellerPost = {
  id: string;
  userId: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  caption?: string | null;
  displayName?: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return 'Today';
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

// Consecutive messages from the same sender within this gap are visually
// grouped: tighter spacing, a shared "tail" only on the run's last bubble,
// and only the last bubble in a run carries the inline timestamp/receipt.
const GROUP_GAP_MS = 5 * 60_000;
function sameSenderClose(a: Message, b: Message): boolean {
  return a.fromId === b.fromId && Math.abs(a.ts - b.ts) < GROUP_GAP_MS && formatDate(a.ts) === formatDate(b.ts);
}

type DateRow = { type: 'date'; date: string; key: string };
type UnreadRow = { type: 'unread'; key: string };
type MsgRow = { type: 'message'; msg: Message; isFirstInGroup: boolean; isLastInGroup: boolean };
type ListRow = DateRow | UnreadRow | MsgRow;

function buildListRows(msgs: Message[], unreadDividerId: string | null): ListRow[] {
  const rows: ListRow[] = [];
  let lastDate = '';
  msgs.forEach((msg, i) => {
    const d = formatDate(msg.ts);
    if (msg.id === unreadDividerId) {
      rows.push({ type: 'unread', key: `unread-${msg.id}` });
    }
    if (d !== lastDate) {
      rows.push({ type: 'date', date: d, key: `date-${d}-${i}` });
      lastDate = d;
    }
    const prev = msgs[i - 1];
    const next = msgs[i + 1];
    rows.push({
      type: 'message',
      msg,
      isFirstInGroup: !prev || !sameSenderClose(msg, prev),
      isLastInGroup: !next || !sameSenderClose(msg, next),
    });
  });
  return rows;
}

// ─── Attachment icon ──────────────────────────────────────────────────────────

function attachmentIcon(type: MessageAttachment['type']): keyof typeof Feather.glyphMap {
  switch (type) {
    case 'product': return 'shopping-bag';
    case 'order':   return 'package';
    case 'post':    return 'image';
    case 'profile': return 'user';
    default:        return 'paperclip';
  }
}

// ─── Screen width ─────────────────────────────────────────────────────────────

const SCREEN_W = Dimensions.get('window').width;
const BUBBLE_MAX = SCREEN_W * 0.75;
const DOUBLE_TAP_MS = 300;

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerConversationScreen() {
  const { theme } = useAppTheme();
  const s = makeStyles(theme);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{
    id?: string;
    participantId?: string;
    participantName?: string;
    participantHandle?: string;
    participantInitials?: string;
    participantColor?: string;
    participantAccountType?: string;
    type?: string;
    contextOrderId?: string;
    contextOrderNumber?: string;
    contextOrderStatus?: string;
    contextProductId?: string;
    contextProductName?: string;
    contextProductPriceCents?: string;
    contextProductImage?: string;
    contextSellerName?: string;
  }>();

  const flatListRef = useRef<FlatList<ListRow>>(null);
  const api = useApi();
  const { userId } = useAuth();
  // THREAD CASH HOOK POINT — see components/thread-cash/ChatAttachThreadCash.tsx.
  const threadCashSendEnabled = useFeatureFlag('threadCashSend');
  /** The signed-in Clerk user; legacy local records used the literal 'me'. */
  const myId = userId ?? MY_USER_ID;
  const [messaging, setMessaging] = useState<DmMessagingState>({ blockedByMe: false, unavailable: false });

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);
  const [isRecording, setIsRecording]         = useState(false);
  const [isUploading, setIsUploading]         = useState(false);
  const [playingVoiceUri, setPlayingVoiceUri] = useState<string | null>(null);
  const [showMediaSheet, setShowMediaSheet]   = useState(false);
  const [activeSheetMsg, setActiveSheetMsg]   = useState<Message | null>(null);
  const [viewerUri, setViewerUri]             = useState<string | null>(null);
  const [likeBurst, setLikeBurst] = useState<{ key: number; x: number; y: number } | null>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const voicePlayer = useAudioPlayer(null);
  const voicePlayerStatus = useAudioPlayerStatus(voicePlayer);

  // Unread-on-open divider: computed once from the conversation's unreadCount
  // *before* markConversationRead() clears it server-side, then held fixed for
  // the lifetime of this screen visit (re-focusing doesn't re-show it).
  const [unreadDividerId, setUnreadDividerId] = useState<string | null>(null);
  const hasComputedUnreadRef = useRef(false);
  const hasScrolledToUnreadRef = useRef(false);

  const lastTapRef = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  const micSendMorph = useRef(new Animated.Value(0)).current;

  // Attachment state
  const [selectedAttachment, setSelectedAttachment] = useState<MessageAttachment | null>(null);
  // "Message seller" from a product page stages that product's card in the
  // composer once, so the first message carries the product as context.
  const stagedProductRef = useRef<string | null>(null);
  useEffect(() => {
    const productId = params.contextProductId;
    if (!productId || !params.contextProductName || stagedProductRef.current === productId) return;
    stagedProductRef.current = productId;
    const price = Number(params.contextProductPriceCents);
    setSelectedAttachment({
      type: 'product',
      title: params.contextProductName,
      subtitle: Number.isFinite(price) && price > 0 ? formatCents(price) : 'Product',
      uri: params.contextProductImage || undefined,
      accentColor: theme.accent,
      meta: { productId },
    });
  }, [params.contextProductId, params.contextProductName, params.contextProductPriceCents, params.contextProductImage, theme.accent]);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [attachmentTab, setAttachmentTab] = useState<'product' | 'post'>('product');
  const [sellerProducts, setSellerProducts] = useState<SellerProduct[]>([]);
  const [sellerPosts, setSellerPosts] = useState<SellerPost[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [postsLoading, setPostsLoading] = useState(false);

  // ── Load conversation + messages ────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!userId) {
      setConv(null);
      setMessages([]);
      setIsLoading(false);
      return;
    }
    try {
      let loadedConv: Conversation | null = null;
      let unreadBeforeRead = 0;

      if (params.id) {
        loadedConv = await getConversation(params.id);
        if (loadedConv) {
          unreadBeforeRead = loadedConv.unreadCount ?? 0;
          await markConversationRead(loadedConv.id);
        }
      } else if (params.participantId) {
        loadedConv = await createOrGetConversation({
          type: (params.type as Conversation['type']) ?? 'buyer_to_buyer',
          participant: {
            userId: params.participantId,
            name:   params.participantName   ?? '',
            handle: params.participantHandle ?? '',
            initials: params.participantInitials ?? '',
            color:  params.participantColor   ?? theme.accent,
            accountType: (params.participantAccountType as 'buyer' | 'seller') ?? 'buyer',
          },
          contextOrderId:     params.contextOrderId,
          contextOrderNumber: params.contextOrderNumber,
          contextOrderStatus: params.contextOrderStatus,
          contextProductId:   params.contextProductId,
          contextProductName: params.contextProductName,
          contextSellerName:  params.contextSellerName,
        });
      }

      setConv(loadedConv);
      const safety = (loadedConv as { messaging?: DmMessagingState } | null)?.messaging;
      setMessaging({ blockedByMe: !!safety?.blockedByMe, unavailable: !!safety?.unavailable });
      if (loadedConv) {
        const msgs = await getMessages(loadedConv.id);
        setMessages(msgs);

        if (!hasComputedUnreadRef.current) {
          hasComputedUnreadRef.current = true;
          const incoming = msgs.filter(m => m.fromId !== myId && m.fromId !== MY_USER_ID);
          if (unreadBeforeRead > 0 && incoming.length > 0) {
            const idx = Math.max(0, incoming.length - unreadBeforeRead);
            setUnreadDividerId(incoming[idx].id);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load conversation', e);
    } finally {
      setIsLoading(false);
    }
  }, [params.id, params.participantId, userId]);

  useFocusEffect(useCallback(() => {
    loadData();
  }, [loadData]));

  useEffect(() => {
    const unsub = subscribeSocial(() => {
      if (conv?.id) {
        getMessages(conv.id).then(setMessages);
      }
    });
    return unsub;
  }, [conv?.id]);

  // No websocket/realtime layer exists for this conversation yet, so a
  // reaction or reply added by the other participant only appears once we
  // refetch. Poll at a light cadence while the screen is focused — mirrors
  // the refetch-on-local-change pattern `subscribeSocial` already uses.
  useFocusEffect(useCallback(() => {
    if (!conv?.id) return;
    const interval = setInterval(() => {
      getMessages(conv.id).then(setMessages).catch(() => {});
    }, 12000);
    return () => clearInterval(interval);
  }, [conv?.id]));

  // Scroll to end after messages load — unless there's an unread divider we
  // still need to scroll to first (handled by the effect below).
  useEffect(() => {
    if (messages.length > 0 && (!unreadDividerId || hasScrolledToUnreadRef.current)) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length, unreadDividerId]);

  useEffect(() => {
    if (voicePlayerStatus.didJustFinish) setPlayingVoiceUri(null);
  }, [voicePlayerStatus.didJustFinish]);

  useEffect(() => {
    const showSend = text.trim().length > 0 || selectedAttachment != null;
    Animated.timing(micSendMorph, {
      toValue: showSend ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [text, selectedAttachment, micSendMorph]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  // API conversations include both participants, and SQL does not guarantee their
  // order. Resolve the seller explicitly so attachment pickers never load the
  // buyer's own catalog.
  const participant = conv?.participants.find(
    (p) => p.accountType === 'seller' && p.userId !== myId && p.userId !== MY_USER_ID,
  ) ?? conv?.participants.find((p) => p.accountType === 'seller')
    ?? conv?.participants.find((p) => p.userId !== myId && p.userId !== MY_USER_ID)
    ?? conv?.participants[0]
    ?? null;
  const displayName = participant?.name ?? params.participantName ?? 'Unknown';
  const isDisabled = conv?.isFriendshipActive === false;
  const canSend = (text.trim().length > 0 || selectedAttachment != null) && !isDisabled && !isSending;

  // Presence line under the header name. `isOnline`/`lastSeenAt` are the only
  // presence signals ConversationParticipant carries; the backend does not
  // currently populate them (see socialTypes.ts), so this line is simply
  // omitted rather than fabricating an "online"/"typing…" state from nothing.
  const statusLine = statusLineFor(participant);

  // Show "View store" button for any seller conversation (resolved or pre-created)
  const convType = conv?.type ?? params.type ?? '';
  const isSellerConv = convType === 'buyer_to_seller'
    || convType === 'buyer_to_seller_product'
    || convType === 'buyer_to_seller_order';
  const sellerUserId = participant?.userId ?? params.participantId ?? '';

  // ── Load seller products for attachment picker ───────────────────────────────

  async function loadSellerProducts() {
    if (!sellerUserId) return;
    setProductsLoading(true);
    try {
      const data = await api.products.publicList(sellerUserId);
      setSellerProducts(data ?? []);
    } catch {
      setSellerProducts([]);
    } finally {
      setProductsLoading(false);
    }
  }

  async function loadSellerPosts() {
    if (!sellerUserId) return;
    setPostsLoading(true);
    try {
      const data = await api.posts.publicList(sellerUserId);
      setSellerPosts(data ?? []);
    } catch {
      setSellerPosts([]);
    } finally {
      setPostsLoading(false);
    }
  }

  function openAttachmentPicker() {
    setShowMediaSheet(false);
    if (!isSellerConv || !sellerUserId) {
      Alert.alert('Attachments', 'You can attach products or posts when messaging a seller.');
      return;
    }
    setShowAttachmentPicker(true);
    if (sellerProducts.length === 0) {
      loadSellerProducts();
    }
    if (sellerPosts.length === 0) {
      loadSellerPosts();
    }
  }

  // ── Media upload helper ───────────────────────────────────────────────────────

  async function uploadMedia(base64: string, mimeType: string, extension: string): Promise<string> {
    const result = await api.conversations.uploadMedia({ data: base64, mimeType, extension });
    return result.url;
  }

  // ── 1:1 voice / video call ────────────────────────────────────────────────────

  function handleStartCall(mode: 'voice' | 'video') {
    if (!conv) { Alert.alert('Not ready', 'Wait for the conversation to load.'); return; }
    const p = participant;
    const qs = new URLSearchParams({
      conversationId: conv.id,
      participantName: displayName,
      participantInitials: p?.initials ?? '?',
      participantColor: p?.color ?? theme.accent,
      mode,
    });
    router.push(('/call-screen?' + qs.toString()) as never);
  }

  // ── Other-participant profile ─────────────────────────────────────────────────

  function openParticipantProfile() {
    if (!participant) return;
    const qs = new URLSearchParams({
      userId: participant.userId,
      name: participant.name,
      handle: participant.handle,
      initials: participant.initials,
      color: participant.color,
    });
    router.push(('/buyer-other-profile?' + qs.toString()) as never);
  }

  // ── Photo / video picker ──────────────────────────────────────────────────────

  async function handlePickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access in Settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: 15,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled || !result.assets.length) return;
    setShowMediaSheet(false);
    setIsUploading(true);
    try {
      const urls: string[] = [];
      for (const asset of result.assets) {
        if (!asset.base64) continue;
        urls.push(await uploadMedia(asset.base64, 'image/jpeg', 'jpg'));
      }
      if (!urls.length) return;
      setSelectedAttachment({
        type: 'image', uri: urls[0],
        title: urls.length > 1 ? `${urls.length} photos` : 'Photo',
        meta: { photoUris: JSON.stringify(urls) },
      });
    } catch { Alert.alert('Upload failed', 'Could not upload. Please try again.'); }
    finally { setIsUploading(false); }
  }

  async function handlePickVideo() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo library access in Settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 59,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets.length) return;
    const asset = result.assets[0];
    if ((asset.duration ?? 0) > 60000) { Alert.alert('Video too long', 'Choose a video under 1 minute.'); return; }
    if (!asset.base64) { Alert.alert('Couldn’t read that video', 'Please try a different file.'); return; }
    setShowMediaSheet(false);
    setIsUploading(true);
    try {
      const ext = (asset.uri.split('.').pop() ?? 'mp4').replace(/\?.*/, '');
      const url = await uploadMedia(asset.base64, 'video/mp4', ext);
      setSelectedAttachment({
        type: 'video', uri: url,
        title: 'Video clip',
        meta: { duration: String(Math.round((asset.duration ?? 0) / 1000)) },
      });
    } catch { Alert.alert('Upload failed', 'Could not upload video. Please try again.'); }
    finally { setIsUploading(false); }
  }

  // ── Voice recording (hold-to-record) ──────────────────────────────────────────

  async function startRecording() {
    if (isRecording || isUploading || isSending) return;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('Microphone permission denied');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
    } catch { Alert.alert('Mic unavailable', 'Could not access microphone. Check permissions in Settings.'); }
  }

  async function stopRecording() {
    if (!isRecording) return;
    setIsRecording(false);
    try {
      await recorder.stop();
      const status = recorder.getStatus();
      const uri = recorder.uri ?? status.url;
      if (!uri) return;
      setIsUploading(true);
      const response = await fetch(uri);
      const buf = await response.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const CHUNK = 8192;
      for (let i = 0; i < bytes.byteLength; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength)));
      }
      const url = await uploadMedia(btoa(binary), 'audio/m4a', 'm4a');
      const dur = Math.round(status.durationMillis / 1000);
      setSelectedAttachment({ type: 'voice', uri: url, title: 'Voice message', meta: { duration: String(dur) } });
    } catch { Alert.alert('Recording error', 'Could not save voice message. Please try again.'); }
    finally {
      setIsUploading(false);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    }
  }

  // ── Voice playback ────────────────────────────────────────────────────────────

  async function handlePlayVoice(uri: string) {
    if (playingVoiceUri === uri) {
      voicePlayer.pause();
      await voicePlayer.seekTo(0).catch(() => {});
      setPlayingVoiceUri(null);
      return;
    }
    voicePlayer.pause();
    try {
      setPlayingVoiceUri(uri);
      voicePlayer.replace({ uri });
      voicePlayer.play();
    } catch { setPlayingVoiceUri(null); }
  }

  // ── Reactions ──────────────────────────────────────────────────────────────────

  function myReaction(msg: Message): ReactionType | null {
    const mine = msg.reactions.find(r => reactionAuthorId(r) === myId || reactionAuthorId(r) === MY_USER_ID);
    return mine ? reactionKind(mine) : null;
  }

  async function handleReact(msg: Message, type: ReactionType) {
    if (!conv) return;
    hapticSelection();
    try {
      await addReaction(conv.id, msg.id, type);
      const msgs = await getMessages(conv.id);
      setMessages(msgs);
    } catch {
      // Best-effort — the reaction bar/summary simply won't reflect it.
    }
  }

  function triggerDoubleTapLike(msg: Message, pageX: number, pageY: number) {
    hapticSuccessAction();
    setLikeBurst({ key: Date.now(), x: pageX, y: pageY });
    void handleReact(msg, 'like');
  }

  function handleBubblePress(msg: Message, event: { nativeEvent: { pageX: number; pageY: number } }) {
    const now = Date.now();
    if (lastTapRef.current.id === msg.id && now - lastTapRef.current.at < DOUBLE_TAP_MS) {
      lastTapRef.current = { id: '', at: 0 };
      triggerDoubleTapLike(msg, event.nativeEvent.pageX, event.nativeEvent.pageY);
    } else {
      lastTapRef.current = { id: msg.id, at: now };
    }
  }

  // ── Attachment renderer (handles image / video / voice inline) ────────────────

  function renderAttachment(att: MessageAttachment) {
    if (att.type === 'image') {
      let uris: string[] = [];
      try { uris = JSON.parse(att.meta?.photoUris ?? '[]'); } catch {}
      if (!uris.length && att.uri) uris = [att.uri];
      if (!uris.length) return null;
      return (
        <View style={s.photoGrid}>
          {uris.slice(0, 4).map((uri, idx) => (
            <PressableScale
              key={idx}
              style={[s.photoCell, uris.length === 1 && s.photoCellSingle]}
              activeOpacity={0.9}
              onPress={() => setViewerUri(uri)}
            >
              <CachedImage source={{ uri }} style={s.photoImg} recyclingKey={uri} />
              {idx === 3 && uris.length > 4 && (
                <View style={s.photoMore}><Text style={s.photoMoreText}>+{uris.length - 4}</Text></View>
              )}
            </PressableScale>
          ))}
        </View>
      );
    }
    if (att.type === 'video') {
      return (
        <View style={s.videoThumb}>
          {att.uri ? <CachedImage source={{ uri: att.uri }} style={s.videoThumbImg} recyclingKey={att.uri} /> : null}
          <View style={s.videoPlayOverlay}><Feather name="play-circle" size={36} color="#fff" /></View>
          {att.meta?.duration ? <View style={s.videoDurBadge}><Text style={s.videoDurText}>{att.meta.duration}s</Text></View> : null}
        </View>
      );
    }
    if (att.type === 'voice') {
      return (
        <PressableScale style={s.voiceRow} activeOpacity={0.8}
          onPress={() => att.uri && handlePlayVoice(att.uri)}>
          <View style={[s.voicePlayBtn, playingVoiceUri === att.uri && s.voicePlayBtnActive]}>
            <Feather name={playingVoiceUri === att.uri ? 'square' : 'play'} size={14} color="#fff" />
          </View>
          <View style={s.voiceWave}>
            {[...Array(12)].map((_, i) => (
              <View key={i} style={[s.voiceBar, { height: 4 + Math.abs(Math.sin(i * 0.8)) * 14 }]} />
            ))}
          </View>
          <Text style={s.voiceDur}>{att.meta?.duration ? `${att.meta.duration}s` : '…'}</Text>
        </PressableScale>
      );
    }
    // Default: product / order / post / profile card
    return (
      <PressableScale
        style={s.attachCard}
        activeOpacity={att.type === 'product' || att.type === 'order' || att.type === 'post' ? 0.7 : 1}
        onPress={() => {
          if (att.type === 'product') {
            const pid = att.meta?.productId;
            if (pid) router.push(('/buyer-product-detail?productId=' + pid) as never);
            else if (participant) router.push(('/seller-profile?id=' + participant.userId) as never);
          } else if (att.type === 'order') {
            router.push('/(buyer)/orders' as never);
          } else if (att.type === 'post') {
            const postId = att.meta?.postId;
            if (postId) {
              const postAuthorName = att.meta?.authorName ?? participant?.name ?? 'Seller';
              const qs = [
                'postId=' + encodeURIComponent(postId),
                'postAuthorName=' + encodeURIComponent(postAuthorName),
                'postAuthorInitials=' + encodeURIComponent(participant?.initials ?? '?'),
                'postAuthorColor=' + encodeURIComponent(participant?.color ?? theme.accent),
                'postCaption=' + encodeURIComponent(att.title ?? ''),
                'postMediaColor1=' + encodeURIComponent(theme.accentDim),
                'postMediaColor2=' + encodeURIComponent(theme.background),
                'postType=' + encodeURIComponent(att.meta?.mediaType ?? 'photo'),
              ].join('&');
              router.push(('/buyer-post-viewer?' + qs) as never);
            }
          }
        }}
      >
        <Feather name={attachmentIcon(att.type)} size={ICON.sm} color={theme.accent} />
        <View style={{ flex: 1, marginLeft: SP.sm }}>
          {att.title ? <Text style={s.attachTitle} numberOfLines={1}>{att.title}</Text> : null}
          {att.subtitle ? <Text style={s.attachSubtitle} numberOfLines={1}>{att.subtitle}</Text> : null}
        </View>
        {(att.type === 'product' || att.type === 'order' || att.type === 'post') && (
          <Feather name="chevron-right" size={ICON.xs} color={theme.muted} />
        )}
      </PressableScale>
    );
  }

  function pickProduct(product: SellerProduct) {
    const prices = (product.variants ?? [])
      .map((variant) => variant.priceCents ?? 0)
      .filter((price) => price > 0);
    const lowestPriceCents = prices.length > 0 ? Math.min(...prices) : null;
    const attachment: MessageAttachment = {
      type: 'product',
      title: product.name,
      subtitle: `${lowestPriceCents == null ? 'Product' : formatCents(lowestPriceCents)}${product.category ? ` · ${product.category}` : ''}`,
      accentColor: theme.accent,
      uri: product.images?.[0] ?? undefined,
      meta: { productId: product.id },
    };
    setSelectedAttachment(attachment);
    setShowAttachmentPicker(false);
  }

  function pickPost(post: SellerPost) {
    const attachment: MessageAttachment = {
      type: 'post',
      title: post.caption?.trim() || 'Seller post',
      subtitle: `${displayName} · ${post.mediaType ?? 'post'}`,
      accentColor: theme.accent,
      uri: post.mediaUrl ?? undefined,
      meta: {
        postId: post.id,
        authorName: post.displayName ?? displayName,
        mediaType: post.mediaType ?? 'photo',
      },
    };
    setSelectedAttachment(attachment);
    setShowAttachmentPicker(false);
  }

  // ── Send message ────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!conv || !canSend) return;
    const t = text.trim();
    const att = selectedAttachment;
    const replyingTo = replyTo;
    setText('');
    setSelectedAttachment(null);
    setReplyTo(null);
    setIsSending(true);
    try {
      await sendMessage(conv.id, t, att ?? undefined, replyingTo?.id);
      const msgs = await getMessages(conv.id);
      setMessages(msgs);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      Alert.alert('Message not sent', apiErrorMessage(e, 'Please check your connection and try again.'));
      setText(t);
      setSelectedAttachment(att);
      setReplyTo(replyingTo);
    } finally {
      setIsSending(false);
    }
  }

  // ── Header options ──────────────────────────────────────────────────────────

  function openOptions() {
    if (!participant) return;
    Alert.alert('Options', undefined, [
      {
        text: 'Archive conversation',
        onPress: async () => {
          const { archiveConversation } = await import('@/services/socialService');
          if (conv) await archiveConversation(conv.id);
          router.back();
        },
      },
      messaging.blockedByMe
        ? {
            text: `Unblock ${participant.name}`,
            onPress: async () => {
              if (await confirmUnblock({ userId: participant.userId, name: participant.name }, api.social.unblock)) {
                setMessaging((current) => ({ ...current, blockedByMe: false }));
              }
            },
          }
        : {
            text: `Block ${participant.name}`,
            style: 'destructive' as const,
            onPress: async () => {
              if (await confirmBlock({ userId: participant.userId, name: participant.name }, api.social.block)) {
                setMessaging((current) => ({ ...current, blockedByMe: true }));
              }
            },
          },
      {
        text: `Report ${participant.name}`,
        onPress: () => {
          router.push(reportHref({
            targetType: 'profile',
            targetId: participant.userId,
            label: participant.name,
            ownerId: participant.userId,
            ownerName: participant.name,
          }) as never);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  // ── Message long press → reaction bar + actions sheet ───────────────────────

  function closeMessageSheet() {
    setActiveSheetMsg(null);
  }

  function sheetReply() {
    if (activeSheetMsg) setReplyTo(activeSheetMsg);
    closeMessageSheet();
  }

  function sheetCopy() {
    if (activeSheetMsg) {
      Clipboard.setStringAsync(activeSheetMsg.text);
      hapticPrimaryAction();
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2000);
    }
    closeMessageSheet();
  }

  function sheetDelete() {
    const msg = activeSheetMsg;
    closeMessageSheet();
    hapticDestructiveConfirm();
    if (conv && msg) deleteMessageForMe(conv.id, msg.id).then(() => getMessages(conv.id).then(setMessages));
  }

  function sheetReport() {
    const msg = activeSheetMsg;
    closeMessageSheet();
    if (!msg) return;
    router.push(reportHref({
      targetType: 'message',
      targetId: msg.id,
      label: participant ? `Message from ${participant.name}` : 'Message',
      ownerId: participant?.userId,
      ownerName: participant?.name,
    }) as never);
  }

  // ── Render list item ────────────────────────────────────────────────────────

  function renderItem({ item }: ListRenderItemInfo<ListRow>) {
    if (item.type === 'date') {
      return (
        <View style={s.dateSeparatorWrap}>
          <View style={s.dateSeparator}>
            <Text style={s.dateSeparatorText}>{item.date}</Text>
          </View>
        </View>
      );
    }

    if (item.type === 'unread') {
      return (
        <View style={s.unreadDividerWrap}>
          <View style={s.unreadDividerLine} />
          <Text style={s.unreadDividerText}>Unread Messages</Text>
          <View style={s.unreadDividerLine} />
        </View>
      );
    }

    const { msg, isFirstInGroup, isLastInGroup } = item;
    const isOwn = msg.fromId === myId || msg.fromId === MY_USER_ID;

    // Group reactions by kind for the chip summary under the bubble.
    const grouped = new Map<ReactionType, number>();
    for (const r of msg.reactions) {
      const kind = reactionKind(r);
      if (!kind) continue;
      grouped.set(kind, (grouped.get(kind) ?? 0) + 1);
    }
    const reactionEntries = Array.from(grouped.entries());
    const mine = myReaction(msg);
    const topReactor = msg.reactions[msg.reactions.length - 1];

    const isRead = msg.status === 'read' || !!msg.readAt;

    return (
      <View style={[s.msgOuter, { justifyContent: isOwn ? 'flex-end' : 'flex-start', marginTop: isFirstInGroup ? SP.sm : 0 }]}>
        {/* Other-user avatar — only on the last bubble of a run */}
        {!isOwn && (
          isLastInGroup ? (
            <View style={[s.msgAvatar, { backgroundColor: msg.fromColor }]}>
              <Text style={s.msgAvatarInitials}>{msg.fromInitials}</Text>
            </View>
          ) : <View style={s.msgAvatarSpacer} />
        )}

        <View style={{ maxWidth: BUBBLE_MAX }}>
          {/* Bubble */}
          <PressableScale
            testID={`conversation-bubble-${msg.id}`}
            activeOpacity={0.88}
            onPress={(e) => handleBubblePress(msg, e)}
            onLongPress={() => { hapticSelection(); setActiveSheetMsg(msg); }}
            delayLongPress={280}
            accessibilityRole="button"
            accessibilityLabel={isOwn ? 'Your message' : `Message from ${msg.fromName}`}
            accessibilityHint="Double tap to like, or touch and hold for more actions"
            style={[
              s.bubble,
              {
                backgroundColor: isOwn ? theme.accent : theme.cardElevated,
                borderTopLeftRadius: (!isOwn && !isFirstInGroup) ? RADIUS.xs : RADIUS.xl,
                borderTopRightRadius: (isOwn && !isFirstInGroup) ? RADIUS.xs : RADIUS.xl,
                borderBottomRightRadius: isOwn ? (isLastInGroup ? 6 : RADIUS.xl) : RADIUS.xl,
                borderBottomLeftRadius: !isOwn ? (isLastInGroup ? 6 : RADIUS.xl) : RADIUS.xl,
                alignSelf: isOwn ? 'flex-end' : 'flex-start',
                shadowColor: theme.shadowColor,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: isOwn ? 0.16 : 0.08,
                shadowRadius: 6,
                elevation: 2,
              },
            ]}
          >
            {/* Quoted reply */}
            {msg.replyToId ? (
              <View style={[s.replyQuote, { borderLeftColor: isOwn ? theme.onAccent : theme.accent }]}>
                <Text style={[s.replyQuoteText, { color: isOwn ? `${theme.onAccent}CC` : theme.muted }]} numberOfLines={1}>
                  {msg.replyPreview ?? messages.find(m => m.id === msg.replyToId)?.text ?? 'Message'}
                </Text>
              </View>
            ) : null}

            {/* Attachment */}
            {msg.attachment && renderAttachment(msg.attachment)}

            {/* Text */}
            {msg.text ? (
              <Text style={[s.msgText, { color: isOwn ? theme.onAccent : theme.text }]}>{msg.text}</Text>
            ) : null}

            {/* Inline bottom-right timestamp + read receipt (last bubble of a run) */}
            {isLastInGroup && (
              <View style={s.bubbleMeta}>
                <Text style={[s.bubbleTime, { color: isOwn ? `${theme.onAccent}B0` : theme.muted }]}>
                  {formatTime(msg.ts)}
                </Text>
                {isOwn && msg.status !== 'failed' && (
                  msg.status === 'sending' ? (
                    <Feather name="clock" size={11} color={`${theme.onAccent}B0`} style={s.receiptIcon} />
                  ) : (
                    <View style={s.receiptChecks}>
                      <Feather name="check" size={11} color={isRead ? theme.onAccent : `${theme.onAccent}B0`} />
                      {isRead && <Feather name="check" size={11} color={theme.onAccent} style={{ marginLeft: -7 }} />}
                    </View>
                  )
                )}
              </View>
            )}

            {/* Failed / retry */}
            {isOwn && msg.status === 'failed' && (
              <PressableScale
                onPress={() => conv && retryMessage(conv.id, msg.id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={s.retryRow}
              >
                <Feather name="alert-circle" size={11} color={theme.error} />
                <Text style={[s.retryText, { color: theme.error }]}>Tap to retry</Text>
              </PressableScale>
            )}
          </PressableScale>

          {/* Reaction chip summary */}
          {reactionEntries.length > 0 && (
            <View style={[s.reactionsRow, isOwn ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
              {reactionEntries.map(([kind, count]) => (
                <PressableScale
                  key={kind}
                  style={[
                    s.reactionChip,
                    { backgroundColor: mine === kind ? theme.accentDim : theme.card, borderColor: mine === kind ? theme.accent : theme.border },
                  ]}
                  onPress={() => handleReact(msg, kind)}
                  activeOpacity={0.7}
                  testID={`reaction-chip-${msg.id}-${kind}`}
                >
                  <ReactionGlyph type={kind} size={12} color={mine === kind ? theme.accent : theme.muted} />
                  <Text style={[s.reactionCount, { color: mine === kind ? theme.accent : theme.muted }]}>
                    {count > 1 ? count : reactionAuthorName(topReactor ?? { fromName: '' }).split(' ')[0]}
                  </Text>
                </PressableScale>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  const visibleMessages = messages.filter(m => !m.deletedForMe);
  const listData = buildListRows(visibleMessages, unreadDividerId);

  useEffect(() => {
    if (!unreadDividerId || hasScrolledToUnreadRef.current) return;
    const idx = listData.findIndex(r => r.type === 'unread');
    if (idx < 0) return;
    hasScrolledToUnreadRef.current = true;
    const timer = setTimeout(() => {
      flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.25 });
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadDividerId, listData.length]);

  const myReactionOnSheet = activeSheetMsg ? myReaction(activeSheetMsg) : null;
  const isOwnSheetMsg = activeSheetMsg
    ? (activeSheetMsg.fromId === myId || activeSheetMsg.fromId === MY_USER_ID)
    : false;

  const showSendButton = text.trim().length > 0 || selectedAttachment != null;
  const micOpacity = micSendMorph.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const sendOpacity = micSendMorph.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const micScale = micSendMorph.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });
  const sendScale = micSendMorph.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ChatWallpaper />

      {/* Floating glass header */}
      <View style={[s.headerWrap, { paddingTop: insets.top + SP.sm }]}>
        <View style={s.headerPill}>
          <PressableScale
            onPress={() => { hapticPrimaryAction(); router.back(); }}
            style={s.roundBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="conversation-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Feather name="arrow-left" size={ICON.md} color={theme.text} />
          </PressableScale>

          <PressableScale
            style={s.headerCenter}
            activeOpacity={participant ? 0.7 : 1}
            disabled={!participant}
            onPress={() => { hapticPrimaryAction(); openParticipantProfile(); }}
            accessibilityRole="button"
            accessibilityLabel={`View ${displayName}'s profile`}
          >
            <Text style={s.headerName} numberOfLines={1}>{displayName}</Text>
            {statusLine ? (
              <Text style={[s.headerStatusLine, { color: participant?.isOnline ? theme.success : theme.muted }]} numberOfLines={1}>
                {statusLine}
              </Text>
            ) : null}
          </PressableScale>

          {participant && (
            <PressableScale
              onPress={() => { hapticPrimaryAction(); openParticipantProfile(); }}
              testID="conversation-avatar"
              accessibilityRole="button"
              accessibilityLabel={`View ${displayName}'s profile`}
            >
              <View style={s.headerAvatarWrap}>
                <View style={[s.headerAvatarCircle, { backgroundColor: participant.color }]}>
                  <Text style={s.headerAvatarInitials}>{participant.initials}</Text>
                </View>
                {participant.isOnline && <View style={s.headerAvatarOnlineDot} />}
              </View>
            </PressableScale>
          )}

          {conv && (
            <>
              <PressableScale
                style={s.roundBtn}
                onPress={() => { hapticPrimaryAction(); handleStartCall('voice'); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="conversation-call-voice"
                accessibilityRole="button"
                accessibilityLabel="Voice call"
              >
                <Feather name="phone" size={ICON.sm} color={theme.muted} />
              </PressableScale>
              <PressableScale
                style={s.roundBtn}
                onPress={() => { hapticPrimaryAction(); handleStartCall('video'); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="conversation-call-video"
                accessibilityRole="button"
                accessibilityLabel="Video call"
              >
                <Feather name="video" size={ICON.sm} color={theme.muted} />
              </PressableScale>
            </>
          )}
          <PressableScale
            style={s.roundBtn}
            onPress={() => { hapticPrimaryAction(); openOptions(); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="More options"
          >
            <Feather name="more-horizontal" size={ICON.sm} color={theme.muted} />
          </PressableScale>
        </View>
      </View>

      {/* Order context card */}
      {conv?.type === 'buyer_to_seller_order' && (
        <PressableScale
          style={s.orderCard}
          onPress={() => router.push('/(buyer)/orders' as never)}
          activeOpacity={0.8}
        >
          <Feather name="package" size={ICON.md} color={theme.accent} />
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.orderCardNumber}>{conv.contextOrderNumber ?? 'Order'}</Text>
            {conv.contextProductName ? (
              <Text style={s.orderCardProduct} numberOfLines={1}>{conv.contextProductName}</Text>
            ) : null}
          </View>
          {conv.contextOrderStatus ? (
            <View style={s.orderStatusBadge}>
              <Text style={s.orderStatusText}>{conv.contextOrderStatus}</Text>
            </View>
          ) : null}
        </PressableScale>
      )}

      {/* Product context card — shown for seller product conversations */}
      {conv?.type === 'buyer_to_seller_product' && conv.contextProductName && (
        <PressableScale
          style={s.orderCard}
          onPress={() => {
            // The product card opens the product; without an id, the store.
            if (conv.contextProductId) {
              router.push(('/buyer-product-detail?productId=' + encodeURIComponent(conv.contextProductId)) as never);
            } else if (participant) {
              router.push(('/seller-profile?id=' + encodeURIComponent(participant.userId)) as never);
            }
          }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={conv.contextProductId ? `View ${conv.contextProductName}` : 'View store'}
        >
          <Feather name="shopping-bag" size={ICON.md} color={theme.accent} />
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.orderCardNumber} numberOfLines={1}>{conv.contextProductName}</Text>
            {conv.contextSellerName ? (
              <Text style={s.orderCardProduct} numberOfLines={1}>{conv.contextSellerName}</Text>
            ) : null}
          </View>
          <View style={s.orderStatusBadge}>
            <Text style={s.orderStatusText}>{conv.contextProductId ? 'View product' : 'View store'}</Text>
          </View>
        </PressableScale>
      )}

      {/* Friendship inactive banner */}
      {isDisabled && (
        <View style={s.disabledBanner}>
          <Feather name="info" size={ICON.sm} color={theme.warning} />
          <Text style={s.disabledBannerText}>
            Messaging disabled — friendship was removed.
          </Text>
        </View>
      )}

      {/* Messages list */}
      <FlatList
        ref={flatListRef}
        data={listData}
        keyExtractor={(item, i) =>
          item.type === 'message' ? item.msg.id : `${item.type}-${i}-${'key' in item ? item.key : ''}`
        }
        renderItem={renderItem}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (!unreadDividerId || hasScrolledToUnreadRef.current) {
            flatListRef.current?.scrollToEnd({ animated: false });
          }
        }}
        onScrollToIndexFailed={() => {
          setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 50);
        }}
        // Windowing kept at RN defaults (10/21) — the history stays performant
        // without extra tuning since bubbles are lightweight rows.
      />

      {/* Double-tap heart burst */}
      {likeBurst && (
        <LikeBurst key={likeBurst.key} x={likeBurst.x} y={likeBurst.y} color={theme.accent} onDone={() => setLikeBurst(null)} />
      )}

      {/* Reply preview */}
      {replyTo && (
        <View style={s.replyBar}>
          <Feather name="corner-up-left" size={ICON.sm} color={theme.accent} />
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.replyFromName}>{replyTo.fromName}</Text>
            <Text style={s.replyPreviewText} numberOfLines={1}>{replyTo.text}</Text>
          </View>
          <PressableScale
            onPress={() => setReplyTo(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={s.replyClose}>×</Text>
          </PressableScale>
        </View>
      )}

      {/* Input row */}
      {participant && (messaging.blockedByMe || messaging.unavailable) ? (
        <BlockedComposer
          counterpartName={participant.name}
          messaging={messaging}
          bottomInset={insets.bottom}
          onUnblock={async () => {
            if (await confirmUnblock({ userId: participant.userId, name: participant.name }, api.social.unblock)) {
              setMessaging((current) => ({ ...current, blockedByMe: false }));
            }
          }}
        />
      ) : !isDisabled ? (
        <View>
          {selectedAttachment && (
            <View style={s.selectedAttachment}>
              {isUploading ? (
                <UploadRing size={22} color={theme.accent} trackColor={theme.border} />
              ) : (
                <Feather
                  name={
                    selectedAttachment.type === 'image' ? 'image' :
                    selectedAttachment.type === 'video' ? 'video' :
                    selectedAttachment.type === 'voice' ? 'mic' :
                    selectedAttachment.type === 'post'  ? 'image' : 'shopping-bag'
                  }
                  size={ICON.sm}
                  color={theme.accent}
                />
              )}
              <View style={{ flex: 1, marginLeft: SP.sm }}>
                <Text style={s.selectedAttachmentLabel}>
                  {
                    selectedAttachment.type === 'image' ? 'Photo attached' :
                    selectedAttachment.type === 'video' ? 'Video attached' :
                    selectedAttachment.type === 'voice' ? 'Voice message' :
                    selectedAttachment.type === 'post'  ? 'Post attached'  : 'Product attached'
                  }
                </Text>
                <Text style={s.selectedAttachmentTitle} numberOfLines={1}>
                  {selectedAttachment.title}
                </Text>
              </View>
              <PressableScale
                onPress={() => setSelectedAttachment(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Remove attachment"
              >
                <Feather name="x" size={ICON.sm} color={theme.muted} />
              </PressableScale>
            </View>
          )}
          <View style={[s.inputRow, { paddingBottom: insets.bottom + SP.sm }]}>
            {/* Attach — photos, video, and (for seller chats) products/posts */}
            <PressableScale
              onPress={() => { hapticPrimaryAction(); setShowMediaSheet(true); }}
              style={s.roundInputBtn}
              disabled={isUploading || isSending}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="conversation-attach"
              accessibilityRole="button"
              accessibilityLabel="Attach"
            >
              {isUploading
                ? <UploadRing size={24} color={theme.accent} />
                : <Feather name="plus" size={ICON.md} color={theme.muted} />
              }
            </PressableScale>

            {/* THREAD CASH HOOK POINT: minimal attach entry, OFF by default
                behind the 'threadCashSend' flag. Rendering a sent Thread Cash
                message in the thread above is left for this screen's own
                renderAttachment/message-list logic to wire up. */}
            {threadCashSendEnabled && sellerUserId ? (
              <ThreadCashAttachButton
                recipientId={sellerUserId}
                conversationId={conv?.id ?? ''}
                onSent={() => {}}
              />
            ) : null}

            {/* Text input */}
            <TextInput
              style={s.textInput}
              value={text}
              onChangeText={setText}
              placeholder="Message…"
              placeholderTextColor={theme.muted}
              multiline
              returnKeyType="default"
            />

            {/* Mic ⇄ Send morph */}
            <View style={s.morphContainer}>
              <Animated.View
                pointerEvents={showSendButton ? 'none' : 'auto'}
                style={[StyleSheet.absoluteFill, s.morphFace, { opacity: micOpacity, transform: [{ scale: micScale }] }]}
              >
                <PressableScale
                  onPressIn={startRecording}
                  onPressOut={stopRecording}
                  disabled={isUploading || isSending}
                  style={s.morphFaceInner}
                  testID="conversation-mic"
                  accessibilityRole="button"
                  accessibilityLabel="Record voice message"
                >
                  <Feather name={isRecording ? 'stop-circle' : 'mic'} size={ICON.md} color={isRecording ? theme.error : theme.muted} />
                </PressableScale>
              </Animated.View>
              <Animated.View
                pointerEvents={showSendButton ? 'auto' : 'none'}
                style={[
                  StyleSheet.absoluteFill, s.morphFace,
                  { opacity: sendOpacity, transform: [{ scale: sendScale }], backgroundColor: canSend ? theme.accent : theme.cardElevated },
                ]}
              >
                <PressableScale
                  onPress={() => { hapticPrimaryAction(); handleSend(); }}
                  disabled={!canSend}
                  style={s.morphFaceInner}
                  activeOpacity={0.8}
                  testID="conversation-send"
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                >
                  <Feather name="send" size={ICON.sm} color={canSend ? theme.onAccent : theme.muted} />
                </PressableScale>
              </Animated.View>
            </View>
          </View>
        </View>
      ) : (
        <View style={[s.inputRow, s.disabledInputRow, { paddingBottom: insets.bottom + SP.sm }]}>
          <Text style={s.disabledInputText}>Messaging disabled</Text>
        </View>
      )}

      {/* ── Media picker sheet ─────────────────────────────────────────────── */}
      <Modal
        visible={showMediaSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMediaSheet(false)}
      >
        <PressableScale style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowMediaSheet(false)} />
        <SheetRise style={s.mediaSheet}>
          <View style={s.mediaSheetHandle} />
          <Text style={s.mediaSheetTitle}>Add to message</Text>
          <PressableScale style={s.mediaSheetOption} onPress={handlePickPhoto}>
            <View style={s.mediaSheetIcon}><Feather name="image" size={ICON.md} color={theme.accent} /></View>
            <View>
              <Text style={s.mediaSheetLabel}>Photos</Text>
              <Text style={s.mediaSheetDesc}>Up to 15 at once</Text>
            </View>
          </PressableScale>
          <PressableScale style={s.mediaSheetOption} onPress={handlePickVideo}>
            <View style={s.mediaSheetIcon}><Feather name="video" size={ICON.md} color={theme.accent} /></View>
            <View>
              <Text style={s.mediaSheetLabel}>Video clip</Text>
              <Text style={s.mediaSheetDesc}>Under 1 minute</Text>
            </View>
          </PressableScale>
          {isSellerConv && (
            <PressableScale style={s.mediaSheetOption} onPress={openAttachmentPicker}>
              <View style={s.mediaSheetIcon}><Feather name="shopping-bag" size={ICON.md} color={theme.accent} /></View>
              <View>
                <Text style={s.mediaSheetLabel}>Product or post</Text>
                <Text style={s.mediaSheetDesc}>Share from {displayName}'s store</Text>
              </View>
            </PressableScale>
          )}
          <View style={{ height: 20 }} />
        </SheetRise>
      </Modal>

      <Modal
        visible={showAttachmentPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAttachmentPicker(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.productPicker}>
            <View style={s.pickerHeader}>
              <View>
                <Text style={s.pickerTitle}>Attach to message</Text>
                <Text style={s.pickerSubtitle}>Choose from {displayName}'s store</Text>
              </View>
              <PressableScale
                onPress={() => setShowAttachmentPicker(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={ICON.md} color={theme.muted} />
              </PressableScale>
            </View>
            <View style={s.attachmentTabs}>
              <PressableScale
                style={[s.attachmentTab, attachmentTab === 'product' && s.attachmentTabActive]}
                onPress={() => setAttachmentTab('product')}
              >
                <Feather name="shopping-bag" size={ICON.sm} color={attachmentTab === 'product' ? theme.accent : theme.muted} />
                <Text style={[s.attachmentTabText, attachmentTab === 'product' && s.attachmentTabTextActive]}>
                  Products
                </Text>
              </PressableScale>
              <PressableScale
                style={[s.attachmentTab, attachmentTab === 'post' && s.attachmentTabActive]}
                onPress={() => setAttachmentTab('post')}
              >
                <Feather name="image" size={ICON.sm} color={attachmentTab === 'post' ? theme.accent : theme.muted} />
                <Text style={[s.attachmentTabText, attachmentTab === 'post' && s.attachmentTabTextActive]}>
                  Posts
                </Text>
              </PressableScale>
            </View>
            {attachmentTab === 'product' ? (
              productsLoading ? (
                <View style={s.pickerLoading}>
                  <ActivityIndicator color={theme.accent} />
                  <Text style={s.pickerEmptyText}>Loading products…</Text>
                </View>
              ) : sellerProducts.length === 0 ? (
                <View style={s.pickerLoading}>
                  <Feather name="shopping-bag" size={ICON.lg} color={theme.subtle} />
                  <Text style={s.pickerEmptyText}>No active products available.</Text>
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={s.productList}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {sellerProducts.map((product) => {
                    const prices = (product.variants ?? [])
                      .map((variant) => variant.priceCents ?? 0)
                      .filter((price) => price > 0);
                    const lowestPriceCents = prices.length > 0 ? Math.min(...prices) : null;
                    return (
                      <PressableScale
                        key={product.id}
                        style={s.productOption}
                        onPress={() => pickProduct(product)}
                        activeOpacity={0.75}
                      >
                        {product.images?.[0] ? (
                          <CachedImage source={{ uri: product.images[0] }} style={s.productThumb} recyclingKey={product.id} />
                        ) : (
                          <View style={s.productThumbPlaceholder}>
                            <Feather name="shopping-bag" size={ICON.md} color={theme.accent} />
                          </View>
                        )}
                        <View style={{ flex: 1, marginLeft: SP.sm }}>
                          <Text style={s.productOptionName} numberOfLines={1}>{product.name}</Text>
                          <Text style={s.productOptionMeta} numberOfLines={1}>
                            {lowestPriceCents == null ? 'Product' : formatCents(lowestPriceCents)}
                            {product.category ? ` · ${product.category}` : ''}
                          </Text>
                        </View>
                        <Feather name="plus-circle" size={ICON.md} color={theme.accent} />
                      </PressableScale>
                    );
                  })}
                </ScrollView>
              )
            ) : (
              postsLoading ? (
                <View style={s.pickerLoading}>
                  <ActivityIndicator color={theme.accent} />
                  <Text style={s.pickerEmptyText}>Loading posts…</Text>
                </View>
              ) : sellerPosts.length === 0 ? (
                <View style={s.pickerLoading}>
                  <Feather name="image" size={ICON.lg} color={theme.subtle} />
                  <Text style={s.pickerEmptyText}>No published posts available.</Text>
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={s.productList}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  {sellerPosts.map((post) => (
                    <PressableScale
                      key={post.id}
                      style={s.productOption}
                      onPress={() => pickPost(post)}
                      activeOpacity={0.75}
                    >
                      {post.mediaUrl ? (
                        <CachedImage source={{ uri: post.mediaUrl }} style={s.productThumb} recyclingKey={post.id} />
                      ) : (
                        <View style={s.productThumbPlaceholder}>
                          <Feather name="image" size={ICON.md} color={theme.accent} />
                        </View>
                      )}
                      <View style={{ flex: 1, marginLeft: SP.sm }}>
                        <Text style={s.productOptionName} numberOfLines={2}>
                          {post.caption?.trim() || 'Seller post'}
                        </Text>
                        <Text style={s.productOptionMeta} numberOfLines={1}>
                          {post.mediaType ?? 'post'} · {displayName}
                        </Text>
                      </View>
                      <Feather name="plus-circle" size={ICON.md} color={theme.accent} />
                    </PressableScale>
                  ))}
                </ScrollView>
              )
            )}
          </View>
        </View>
      </Modal>

      {/* Long-press reactions + actions sheet */}
      <Modal
        visible={activeSheetMsg != null}
        transparent
        animationType="fade"
        onRequestClose={closeMessageSheet}
      >
        <PressableScale style={s.modalBackdrop} activeOpacity={1} onPress={closeMessageSheet} />
        <SheetRise style={s.reactionSheet}>
          <View style={s.mediaSheetHandle} />
          <ReactionChipsRow
            selected={myReactionOnSheet}
            testIDPrefix="reaction-bar"
            onSelect={(type) => {
              if (activeSheetMsg) void handleReact(activeSheetMsg, type);
              closeMessageSheet();
            }}
          />
          <View style={s.sheetDivider} />
          <PressableScale style={s.sheetAction} onPress={sheetReply}>
            <Feather name="corner-up-left" size={ICON.sm} color={theme.text} />
            <Text style={s.sheetActionText}>Reply</Text>
          </PressableScale>
          <PressableScale style={s.sheetAction} onPress={sheetCopy}>
            <Feather name="copy" size={ICON.sm} color={theme.text} />
            <Text style={s.sheetActionText}>Copy</Text>
          </PressableScale>
          {isOwnSheetMsg ? (
            <PressableScale style={s.sheetAction} onPress={sheetDelete}>
              <Feather name="trash-2" size={ICON.sm} color={theme.error} />
              <Text style={[s.sheetActionText, { color: theme.error }]}>Delete for me</Text>
            </PressableScale>
          ) : (
            <PressableScale style={s.sheetAction} onPress={sheetReport}>
              <Feather name="flag" size={ICON.sm} color={theme.error} />
              <Text style={[s.sheetActionText, { color: theme.error }]}>Report message</Text>
            </PressableScale>
          )}
          <View style={{ height: 12 }} />
        </SheetRise>
      </Modal>

      <MediaViewer visible={viewerUri != null} uri={viewerUri} onClose={() => setViewerUri(null)} />

      <Snackbar
        visible={copiedToast}
        message="Copied"
        onDismiss={() => setCopiedToast(false)}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Presence line ────────────────────────────────────────────────────────────

function statusLineFor(participant: ConversationParticipant | null): string | null {
  if (!participant) return null;
  if (participant.isOnline) return 'online';
  if (participant.lastSeenAt) {
    const ts = new Date(participant.lastSeenAt).getTime();
    if (!Number.isNaN(ts)) return `last seen ${timeAgo(ts)} ago`;
  }
  return null;
}

// ─── Double-tap heart burst ───────────────────────────────────────────────────

function LikeBurst({ x, y, color, onDone }: { x: number; y: number; color: string; onDone: () => void }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 650, useNativeDriver: true }).start(({ finished }) => {
      if (finished) onDone();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scale = progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.3, 1] });
  const opacity = progress.interpolate({ inputRange: [0, 0.1, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -30] });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={{ position: 'absolute', left: x - 24, top: y - 24, opacity, transform: [{ scale }, { translateY }] }}>
        <Feather name="heart" size={48} color={color} />
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },

  // Floating glass header
  headerWrap: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    zIndex: 5,
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.cardGlass,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: SP.xs,
    paddingVertical: SP.xs,
    gap: 2,
    shadowColor: theme.shadowColor,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 3,
  },
  roundBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: SP.xs,
  },
  headerName: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: theme.text,
    letterSpacing: -0.2,
  },
  headerStatusLine: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: theme.success,
    marginTop: 1,
  },
  headerAvatarWrap: { position: 'relative' },
  headerAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarInitials: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },
  headerAvatarOnlineDot: {
    position: 'absolute',
    bottom: -1,
    right: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: theme.success,
    borderWidth: 2,
    borderColor: theme.background,
  },

  // Order context card
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
    padding: SP.sm,
    backgroundColor: theme.cardGlass,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
  },
  orderCardNumber: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  orderCardProduct: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginTop: 2,
  },
  orderStatusBadge: {
    backgroundColor: theme.accentDim,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: SP.xs,
  },
  orderStatusText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: theme.accent,
  },

  // Disabled banner
  disabledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: `${theme.warning}1F`,
    borderBottomWidth: 1,
    borderBottomColor: `${theme.warning}4D`,
  },
  disabledBannerText: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.warning,
    marginLeft: SP.sm,
  },

  // Messages
  listContent: {
    paddingVertical: SP.sm,
    paddingBottom: SP.md,
  },

  // Date separator
  dateSeparatorWrap: {
    alignItems: 'center',
    marginVertical: SP.lg,
  },
  dateSeparator: {
    backgroundColor: theme.cardElevated,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: SP.md,
    paddingVertical: 6,
  },
  dateSeparatorText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  // Unread divider
  unreadDividerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginVertical: SP.md,
    paddingHorizontal: SP.lg,
  },
  unreadDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: theme.error,
    opacity: 0.4,
  },
  unreadDividerText: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: theme.error,
  },

  // Message row
  msgOuter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SP.md,
    marginBottom: 3,
  },
  msgAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SP.sm,
    marginBottom: 2,
  },
  msgAvatarSpacer: {
    width: 30,
    marginRight: SP.sm,
  },
  msgAvatarInitials: {
    fontSize: 11,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },

  // Bubble
  bubble: {
    borderRadius: RADIUS.xl,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm + 4,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
    gap: 3,
  },
  bubbleTime: {
    fontSize: 10,
    fontFamily: FONT.regular,
  },
  receiptIcon: {
    marginLeft: 2,
  },
  receiptChecks: {
    flexDirection: 'row',
    marginLeft: 2,
  },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  retryText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },

  // Attachment
  attachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
    padding: SP.sm,
    marginBottom: SP.xs,
  },
  attachTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  attachSubtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginTop: 1,
  },
  selectedAttachment: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: theme.card,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  selectedAttachmentLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: theme.accent,
  },
  selectedAttachmentTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.text,
    marginTop: 1,
  },

  // Message text
  msgText: {
    fontSize: FS.base,
    fontFamily: FONT.regular,
    lineHeight: 21,
  },

  // Quoted reply snippet
  replyQuote: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 4,
  },
  replyQuoteText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },

  // Reactions
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.xs,
    marginTop: 4,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: theme.card,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: SP.xs,
    paddingVertical: 2,
  },
  reactionCount: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
  },

  // Reply bar
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    backgroundColor: theme.card,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  replyFromName: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: theme.accent,
  },
  replyPreviewText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginTop: 1,
  },
  replyClose: {
    fontSize: FS.md,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginLeft: SP.sm,
  },

  // Input row
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
  },
  roundInputBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.cardElevated,
    marginBottom: 0,
  },
  textInput: {
    flex: 1,
    backgroundColor: theme.cardElevated,
    borderRadius: RADIUS.xxl,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm + 2,
    fontSize: FS.base,
    fontFamily: FONT.regular,
    color: theme.text,
    maxHeight: 120,
    minHeight: 44,
  },
  morphContainer: {
    width: 44,
    height: 44,
    marginBottom: 0,
  },
  morphFace: {
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  morphFaceInner: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  productPicker: {
    maxHeight: '78%',
    backgroundColor: theme.background,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1,
    borderColor: theme.border,
    paddingBottom: SP.xl,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  pickerTitle: {
    fontSize: FS.lg,
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  pickerSubtitle: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginTop: 2,
  },
  attachmentTabs: {
    flexDirection: 'row',
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    gap: SP.sm,
  },
  attachmentTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    paddingVertical: SP.sm,
    borderRadius: RADIUS.md,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
  },
  attachmentTabActive: {
    backgroundColor: theme.accentDim,
    borderColor: theme.accent,
  },
  attachmentTabText: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: theme.muted,
  },
  attachmentTabTextActive: {
    color: theme.accent,
  },
  pickerLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 150,
    gap: SP.sm,
  },
  pickerEmptyText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.muted,
  },
  productList: {
    padding: SP.md,
    gap: SP.sm,
  },
  productOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SP.sm,
    backgroundColor: theme.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
  },
  productThumb: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.sm,
    backgroundColor: theme.cardElevated,
  },
  productThumbPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.sm,
    backgroundColor: theme.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productOptionName: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  productOptionMeta: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: theme.muted,
    marginTop: 3,
  },

  // Reaction / actions sheet
  reactionSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: theme.card, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg,
    paddingHorizontal: SP.md, paddingTop: SP.sm,
  },
  sheetDivider: {
    height: 1,
    backgroundColor: theme.border,
    marginVertical: SP.sm,
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: SP.sm,
  },
  sheetActionText: {
    fontSize: FS.base,
    fontFamily: FONT.medium,
    color: theme.text,
  },

  // Media sheet
  mediaSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: theme.card, borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg,
    paddingHorizontal: SP.md, paddingTop: SP.sm,
  },
  mediaSheetHandle: { width: 36, height: 4, backgroundColor: theme.border, borderRadius: 2, alignSelf: 'center', marginBottom: SP.md },
  mediaSheetTitle:  { fontSize: FS.lg, fontFamily: FONT.semibold, color: theme.text, marginBottom: SP.md },
  mediaSheetOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.md, gap: SP.sm },
  mediaSheetIcon:   { width: 40, height: 40, borderRadius: RADIUS.md, backgroundColor: theme.accentDim, alignItems: 'center', justifyContent: 'center' },
  mediaSheetLabel:  { fontSize: FS.base, fontFamily: FONT.semibold, color: theme.text },
  mediaSheetDesc:   { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, marginTop: 2 },

  // Photo grid
  photoGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: RADIUS.md, overflow: 'hidden' },
  photoCell:      { width: '48%', aspectRatio: 1, overflow: 'hidden', borderRadius: RADIUS.sm, position: 'relative' },
  photoCellSingle:{ width: '100%', aspectRatio: 4 / 3 },
  photoImg:       { width: '100%', height: '100%' },
  photoMore:      { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  photoMoreText:  { color: '#fff', fontSize: FS.lg, fontFamily: FONT.bold },

  // Video thumb
  videoThumb:       { borderRadius: RADIUS.md, overflow: 'hidden', width: 200, height: 130, position: 'relative' },
  videoThumbImg:    { width: '100%', height: '100%' },
  videoPlayOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  videoDurBadge:    { position: 'absolute', bottom: SP.xs, right: SP.xs, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.sm, paddingHorizontal: SP.xs, paddingVertical: 2 },
  videoDurText:     { color: '#fff', fontSize: FS.xs, fontFamily: FONT.medium },

  // Voice player
  voiceRow:         { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs, minWidth: 160 },
  voicePlayBtn:     { width: 28, height: 28, borderRadius: 14, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  voicePlayBtnActive: { backgroundColor: theme.error },
  voiceWave:        { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  voiceBar:         { width: 3, backgroundColor: theme.accentDim, borderRadius: 2 },
  voiceDur:         { fontSize: FS.xs, fontFamily: FONT.medium, color: theme.muted },

  // Disabled input
  disabledInputRow: {
    justifyContent: 'center',
  },
  disabledInputText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: theme.subtle,
    textAlign: 'center',
  },
  });
};
