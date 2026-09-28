/**
 * Seller Conversation — read a buyer thread and send replies.
 * Reads GET /api/conversations/:id/messages, sends via POST /api/conversations/:id/messages.
 * Sellers can attach a product card or the linked order to a reply.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TextInput, Alert, Platform, StyleSheet, Dimensions, ActivityIndicator, ListRenderItemInfo, Modal, ScrollView } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useUser } from '@clerk/expo';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { PressableScale } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { hapticPrimaryAction, hapticSelection, hapticSuccessAction } from '@/lib/haptics';
import * as ImagePicker from 'expo-image-picker';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { VoiceRecordingBar } from '@/components/chat/VoiceRecordingBar';
import { VoiceMessageBubble } from '@/components/chat/VoiceMessageBubble';
import { formatCents } from '@/lib/money';
import { notifyConversationReadFailure } from '@/lib/conversationReadEvents';
import { confirmUnblock } from '@/lib/safety';
import {
  BlockedComposer, openConversationOptions, openMessageOptions, REMOVED_MESSAGE_TEXT,
  type DmMessagingState,
} from '@/components/safety/DmSafety';
import { SheetRise } from '@/components/motion/SheetRise';
import { useCallSession, useCallLog } from '@/lib/calls/CallSessionContext';
import { CallLogBubble } from '@/components/calls/CallLogBubble';
import { isSellerDevPreview } from '@/lib/devPreview';
import type { CallLogEntry } from '@/lib/calls/types';
import { SystemLine } from '@/components/chat/SystemLine';
import { getConversationTheme } from '@/lib/conversationThemes';
import { LinearGradient } from 'expo-linear-gradient';
import {
  formatDate as sharedFormatDate, formatTime, groupFlags,
  groupCornerRadii, lastOwnMessageId, messagePreviewText,
} from '@/lib/chatGrouping';
import { SwipeToReplyBubble } from '@/components/chat/SwipeToReplyBubble';
import { ReplyBanner } from '@/components/chat/ReplyBanner';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Participant {
  userId: string; name: string; handle: string;
  initials: string; color: string; accountType: string;
  /** Chat details > Nicknames: the current viewer's nickname for them, if set. */
  nickname?: string;
}
interface ConvView {
  id: string; type: string; participants: Participant[];
  contextOrderId?: string; contextOrderNumber?: string; contextOrderStatus?: string;
  contextProductId?: string; contextProductName?: string;
  /** Chat details > Theme / Disappearing messages (conversation-level). */
  themeId?: string; disappearingEnabled?: boolean;
}
interface MsgAttachment {
  type: 'product' | 'order' | 'post' | 'profile' | 'image' | 'video' | 'voice' | 'system';
  uri?: string;
  title?: string;
  subtitle?: string;
  meta?: Record<string, string>;
}
interface Msg {
  id: string; conversationId: string;
  fromId: string; fromName: string; fromInitials: string; fromColor: string;
  text: string; attachment?: MsgAttachment; status: string; ts: number;
  /** ISO timestamp the buyer read this message, when known — drives the
   *  double-check "read" receipt and the "Seen" line below my own last
   *  message. Same field the API returns on app/buyer-conversation.tsx's
   *  Message type; see lib/chatGrouping.ts. */
  readAt?: string;
  /** Swipe-to-reply — same shape as app/buyer-conversation.tsx's Message,
   *  resolved server-side (see api-server's adaptMessage/loadReplyPreviews)
   *  so both sides of a thread render the identical quoted context. */
  replyToId?: string;
  replyPreview?: string;
  replyToAuthorName?: string;
}
interface SellerProduct {
  id: string; name: string; priceCents?: number; status?: string;
  variants?: Array<{ priceCents: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SCREEN_W = Dimensions.get('window').width;
const BUBBLE_MAX = SCREEN_W * 0.75;

// Shared with app/buyer-conversation.tsx via lib/chatGrouping.ts — see that
// module's doc comment for why the two screens' grouping math is
// consolidated even though their JSX/render code isn't.
const formatDate = sharedFormatDate;

function formatPrice(p: SellerProduct): string {
  if (p.priceCents != null) return formatCents(p.priceCents);
  if (p.variants && p.variants.length > 0) return formatCents(p.variants[0].priceCents);
  return '';
}

/** A human, sentence-case label for a raw order status value ("in_transit" → "In transit"). */
function humanOrderStatus(status: string): string {
  const spaced = status.replace(/[_-]+/g, ' ').trim();
  if (!spaced) return status;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function attachmentIcon(type: MsgAttachment['type']): keyof typeof Feather.glyphMap {
  switch (type) {
    case 'product': return 'shopping-bag';
    case 'order':   return 'package';
    case 'post':    return 'image';
    case 'profile': return 'user';
    default:        return 'paperclip';
  }
}

type ListRow =
  | { type: 'date'; date: string }
  | { type: 'message'; msg: Msg; isFirstInGroup: boolean; isLastInGroup: boolean }
  | { type: 'call_log'; entry: CallLogEntry };

/** Merges the (client-only, PR1) call log into the message timeline by
 *  timestamp, alongside the real messages — see CallSessionContext's own doc
 *  comment on why this log isn't backend-persisted yet. Also computes each
 *  message's grouping flags (lib/chatGrouping.ts — shared with
 *  app/buyer-conversation.tsx so the same thread groups identically from
 *  both sides): a call-log entry breaks a group the same way a date
 *  separator does, since it renders as its own standalone row. */
function groupByDate(msgs: Msg[], callLog: CallLogEntry[] = []): ListRow[] {
  type Item =
    | { ts: number; kind: 'message'; msg: Msg }
    | { ts: number; kind: 'call_log'; entry: CallLogEntry };
  const items: Item[] = [
    ...msgs.map((msg) => ({ ts: msg.ts, kind: 'message' as const, msg })),
    ...callLog.map((entry) => ({ ts: entry.startedAt, kind: 'call_log' as const, entry })),
  ].sort((a, b) => a.ts - b.ts);

  const rows: ListRow[] = [];
  let last = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const d = formatDate(item.ts);
    if (d !== last) { rows.push({ type: 'date', date: d }); last = d; }
    if (item.kind === 'call_log') {
      rows.push({ type: 'call_log', entry: item.entry });
      continue;
    }
    const prevItem = items[i - 1];
    const nextItem = items[i + 1];
    const prevMsg = prevItem?.kind === 'message' ? prevItem.msg : undefined;
    const nextMsg = nextItem?.kind === 'message' ? nextItem.msg : undefined;
    const { isFirstInGroup, isLastInGroup } = groupFlags(item.msg, prevMsg, nextMsg);
    rows.push({ type: 'message', msg: item.msg, isFirstInGroup, isLastInGroup });
  }
  return rows;
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function SellerConversationScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const BG = theme.background;
  const CARD = theme.card;
  const BORDER = theme.border;
  const BORDER_ACTIVE = theme.accent;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SUBTLE = theme.subtle;
  const RED = theme.error;
  const ON_DARK = theme.onAccent;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useApi();
  const [messaging, setMessaging] = useState<DmMessagingState>({ blockedByMe: false, unavailable: false });
  const { user } = useUser();
  const myId = user?.id ?? '';
  const { id } = useLocalSearchParams<{ id?: string }>();
  const s = React.useMemo(() => makeStyles(theme), [theme]);

  const flatListRef = useRef<FlatList<ListRow>>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const generationRef = useRef(0);
  const requestGenerationRef = useRef<number | null>(null);

  const [conv, setConv] = useState<ConvView | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading]         = useState(false);
  const [playingVoiceUri, setPlayingVoiceUri] = useState<string | null>(null);
  const [voiceSpeed, setVoiceSpeed]           = useState(1);
  const [showMediaSheet, setShowMediaSheet]   = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const voicePlayer = useAudioPlayer(null);
  const voicePlayerStatus = useAudioPlayerStatus(voicePlayer);
  const voiceRecorder = useVoiceRecorder(uploadMedia, handleVoiceRecorded);

  // Attachment state
  const [pendingAttachment, setPendingAttachment] = useState<MsgAttachment | null>(null);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadMessages = useCallback(async (generation: number) => {
    if (!id) return;
    // Prevent a slow poll from overlapping the next tick in the same focus
    // cycle. This keeps failures attributable to the current request stream.
    if (requestGenerationRef.current === generation) return;
    requestGenerationRef.current = generation;
    try {
      const msgs = await api.conversations.messages(id, 100);
      if (generationRef.current !== generation) return;
      setMessages(msgs as Msg[]);
      consecutiveFailuresRef.current = 0;
    } catch {
      if (generationRef.current !== generation) return;
      consecutiveFailuresRef.current += 1;
      if (consecutiveFailuresRef.current >= 3 && pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    } finally {
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current = null;
      }
    }
  }, [api, id]);

  const loadAll = useCallback(async (generation: number) => {
    if (!id) { setIsLoading(false); return; }
    try {
      const [c] = await Promise.all([
        api.conversations.get(id),
        loadMessages(generation),
      ]);
      if (generationRef.current !== generation) return;
      setConv(c as ConvView);
      const safety = (c as { messaging?: DmMessagingState }).messaging;
      setMessaging({ blockedByMe: !!safety?.blockedByMe, unavailable: !!safety?.unavailable });
    } catch (e) {
      console.error('Failed to load conversation', e);
    } finally {
      if (generationRef.current === generation) setIsLoading(false);
    }
  }, [api, id, loadMessages]);

  useFocusEffect(useCallback(() => {
    const generation = ++generationRef.current;
    consecutiveFailuresRef.current = 0;
    // Mark the thread as read as soon as it opens. This is intentionally
    // independent of loading the conversation/messages so a slow or failed
    // read request cannot leave the seller's inbox badge stale.
    if (id) {
      api.conversations.markRead(id).catch(() => {
        notifyConversationReadFailure(id);
      });
    }
    loadAll(generation);
    pollRef.current = setInterval(() => loadMessages(generation), 15_000);
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [api, id, loadAll, loadMessages]));

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  useEffect(() => {
    if (voicePlayerStatus.didJustFinish) setPlayingVoiceUri(null);
  }, [voicePlayerStatus.didJustFinish]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const other = conv?.participants.find((p) => p.userId !== myId) ?? null;
  // Chat details > Nicknames: once set, the nickname replaces the real name
  // in the header, matching buyer-conversation.tsx.
  const displayName = other?.nickname || other?.name || 'Buyer';
  // Chat details > Theme: a conversation-level property — same background
  // and bubble colors for both participants. Null = the app's existing
  // default monochrome look, completely unchanged.
  const convTheme = getConversationTheme(conv?.themeId);
  const sentBubbleColor = convTheme?.sentBubble ?? PURPLE;
  const sentTextColor = convTheme?.sentText ?? ON_DARK;
  const receivedBubbleColor = convTheme?.receivedBubble ?? CARD;
  const receivedTextColor = convTheme?.receivedText ?? FG;
  const messagingBlocked = messaging.blockedByMe || messaging.unavailable;
  const canSend = (text.trim().length > 0 || pendingAttachment != null) && !isSending && !!id;
  // Seen receipt: id of MY (the seller's) most recent message in this
  // thread — "Seen" only ever renders under that one message. See
  // lib/chatGrouping.ts's doc comment on the real, honest granularity this
  // reflects (conversation-level readAt, not per-bubble).
  const lastOwnMsgId = useMemo(() => lastOwnMessageId(messages, myId), [messages, myId]);

  const { startCall, simulateIncomingCall } = useCallSession();
  const callLog = useCallLog(id ?? '');
  const myName = user?.fullName || user?.username || 'You';
  const myInitials = (myName[0] ?? '?').toUpperCase();

  // Preview/QA only: ?bt_call=incoming|incoming_video rings a simulated
  // incoming call ~500ms after mount, so the incoming-call screen can be
  // screenshotted without a second device. Latches on boot, same pattern as
  // BOOT_PREVIEW/BOOT_EMPTY in lib/live/liveProvider.ts — a no-op outside dev
  // preview mode.
  const bootCallPreviewRef = useRef<string | null>(
    isSellerDevPreview() && typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('bt_call')
      : null,
  );
  useEffect(() => {
    const bootCallPreview = bootCallPreviewRef.current;
    if (!bootCallPreview || !id || !other) return;
    const mode: 'voice' | 'video' = bootCallPreview === 'incoming_video' ? 'video' : 'voice';
    const timer = setTimeout(() => {
      simulateIncomingCall({
        conversationId: id,
        surface: 'seller',
        mode,
        peer: { id: other.userId, name: other.name, initials: other.initials, color: other.color, avatarUri: null },
        me: { id: myId, name: myName, initials: myInitials, color: PURPLE },
      });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, other?.userId]);

  // ── Attach helpers ──────────────────────────────────────────────────────────

  async function openAttachPicker() {
    setShowAttachPicker(true);
  }

  // ── Media upload helper ───────────────────────────────────────────────────────

  async function uploadMedia(base64: string, mimeType: string, extension: string): Promise<string> {
    const result = await api.conversations.uploadMedia({ data: base64, mimeType, extension });
    return result.url;
  }

  // ── 1:1 call ─────────────────────────────────────────────────────────────────

  function handleStartCall(mode: 'voice' | 'video') {
    if (!id) return;
    void startCall({
      conversationId: id,
      surface: 'seller',
      mode,
      peer: {
        id: other?.userId ?? '',
        name: other?.name ?? 'User',
        initials: other?.initials ?? '?',
        color: other?.color ?? PURPLE,
        avatarUri: null,
      },
      me: { id: myId, name: myName, initials: myInitials, color: PURPLE },
    });
  }

  // ── Chat details ───────────────────────────────────────────────────────────────

  function openChatDetails() {
    if (!id || !other) return;
    const qs = new URLSearchParams({
      id, role: 'seller',
      isBlocked: messaging.blockedByMe ? '1' : '0',
      participantUserId: other.userId,
      participantName: other.name,
      participantHandle: other.handle ?? '',
      participantInitials: other.initials ?? '',
      participantColor: other.color ?? PURPLE,
      participantNickname: other.nickname ?? '',
    });
    router.push(('/conversation-details?' + qs.toString()) as never);
  }

  // Theme system line's "Change" — reopens the picker directly.
  function openThemePicker() {
    if (!id || !other) return;
    const qs = new URLSearchParams({
      id, role: 'seller', openTheme: '1',
      participantUserId: other.userId,
      participantName: other.name,
      participantInitials: other.initials ?? '',
      participantColor: other.color ?? PURPLE,
    });
    router.push(('/conversation-details?' + qs.toString()) as never);
  }

  // Disappearing-messages system line's "Change"/"Turn on" — a direct
  // quick-toggle, not a navigation.
  async function handleQuickToggleDisappearing() {
    if (!id || !conv) return;
    const next = !conv.disappearingEnabled;
    hapticSelection();
    try {
      const result = await api.conversations.setDisappearing(id, next);
      setConv((prev) => prev ? { ...prev, disappearingEnabled: next } : prev);
      setMessages((prev) => [...prev, result.message]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch {
      Alert.alert('Couldn’t update disappearing messages', 'Please try again.');
    }
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
      setPendingAttachment({
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
      setPendingAttachment({ type: 'video', uri: url, title: 'Video clip', meta: { duration: String(Math.round((asset.duration ?? 0) / 1000)) } });
    } catch { Alert.alert('Upload failed', 'Could not upload video. Please try again.'); }
    finally { setIsUploading(false); }
  }

  // ── Voice recording ───────────────────────────────────────────────────────────
  // Mirrors buyer-conversation.tsx (see docs/dm-flows.md and Instagram DM's
  // "Sending an audio message" flow) — sends the moment recording finishes,
  // rather than staging into pendingAttachment. The seller composer already
  // used a tap-to-toggle mic (no press-and-hold) before this PR, so it keeps
  // that same tap-to-toggle interaction on every platform for consistency,
  // instead of introducing a native-only hold gesture asymmetry with the
  // buyer screen's identical-looking mic button.
  async function handleVoiceRecorded(result: { uri: string; durationSec: number; waveform: number[] }) {
    if (!id) return;
    hapticSuccessAction();
    const attachment: MsgAttachment = {
      type: 'voice',
      uri: result.uri,
      title: 'Voice message',
      meta: { duration: String(result.durationSec), waveform: JSON.stringify(result.waveform) },
    };
    setIsSending(true);
    try {
      const msg = await api.conversations.send(id, { text: '', attachment });
      setMessages((prev) => [...prev, msg as Msg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch {
      Alert.alert('Voice message not sent', 'Please check your connection and try again.');
    } finally {
      setIsSending(false);
    }
  }

  // ── Voice playback ────────────────────────────────────────────────────────────

  async function handlePlayVoice(uri: string, rate: number) {
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
      voicePlayer.playbackRate = rate;
      voicePlayer.play();
    } catch { setPlayingVoiceUri(null); }
  }

  function handleSeekVoice(uri: string, fraction: number, durationSec: number) {
    if (playingVoiceUri !== uri || !durationSec) return;
    void voicePlayer.seekTo(fraction * durationSec).catch(() => {});
  }

  function handleVoiceSpeedChange(uri: string, rate: number) {
    setVoiceSpeed(rate);
    if (playingVoiceUri === uri) {
      try { voicePlayer.playbackRate = rate; } catch { /* best-effort */ }
    }
  }

  // ── Attachment renderer (media-aware) ─────────────────────────────────────────

  function renderMsgAttachment(att: MsgAttachment, isOwn: boolean) {
    if (att.type === 'image') {
      let uris: string[] = [];
      try { uris = JSON.parse(att.meta?.photoUris ?? '[]'); } catch {}
      if (!uris.length && att.uri) uris = [att.uri];
      if (!uris.length) return null;
      return (
        <View style={s.photoGrid}>
          {uris.slice(0, 4).map((uri, idx) => (
            <View key={idx} style={[s.photoCell, uris.length === 1 && s.photoCellSingle]}>
              <CachedImage source={{ uri }} style={s.photoImg} recyclingKey={uri} />
              {idx === 3 && uris.length > 4 && (
                <View style={s.photoMore}><Text style={s.photoMoreText}>+{uris.length - 4}</Text></View>
              )}
            </View>
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
      const durationSec = Number(att.meta?.duration ?? 0);
      let waveform: number[] = [];
      try { waveform = JSON.parse(att.meta?.waveform ?? '[]'); } catch {}
      const isPlaying = !!att.uri && playingVoiceUri === att.uri;
      const progress = isPlaying && voicePlayerStatus.duration
        ? Math.max(0, Math.min(1, voicePlayerStatus.currentTime / voicePlayerStatus.duration))
        : 0;
      return (
        <VoiceMessageBubble
          theme={theme}
          waveform={waveform}
          durationSec={durationSec}
          isPlaying={isPlaying}
          progress={progress}
          isOwn={isOwn}
          onTogglePlay={() => att.uri && handlePlayVoice(att.uri, voiceSpeed)}
          onSeek={(fraction) => att.uri && handleSeekVoice(att.uri, fraction, durationSec)}
          onSpeedChange={(rate) => att.uri && handleVoiceSpeedChange(att.uri, rate)}
        />
      );
    }
    return (
      <PressableScale
        style={s.attachCard}
        activeOpacity={att.type === 'product' || att.type === 'order' || att.type === 'post' ? 0.7 : 1}
        onPress={() => {
          if (att.type === 'product') {
            const pid = att.meta?.productId;
            if (pid) router.push(('/buyer-product-detail?productId=' + pid) as never);
          } else if (att.type === 'order') {
            const orderId = att.meta?.orderId;
            router.push((orderId ? '/order-detail?id=' + orderId : '/(tabs)/orders') as never);
          } else if (att.type === 'post') {
            const postId = att.meta?.postId;
            if (postId) {
              const qs = [
                'postId=' + encodeURIComponent(postId),
                'postAuthorName=' + encodeURIComponent(att.meta?.authorName ?? 'Seller'),
                'postCaption=' + encodeURIComponent(att.title ?? ''),
                'postType=' + encodeURIComponent(att.meta?.mediaType ?? 'photo'),
                'postMediaColor1=' + encodeURIComponent(PURPLE_DIM),
                'postMediaColor2=' + encodeURIComponent(BG),
              ].join('&');
              router.push(('/buyer-post-viewer?' + qs) as never);
            }
          }
        }}
      >
        <Feather name={attachmentIcon(att.type)} size={ICON.sm} color={PURPLE} />
        <View style={{ flex: 1, marginLeft: SP.sm }}>
          {att.title ? <Text style={s.attachTitle} numberOfLines={1}>{att.title}</Text> : null}
          {att.subtitle ? <Text style={s.attachSubtitle} numberOfLines={1}>{att.subtitle}</Text> : null}
        </View>
        {(att.type === 'product' || att.type === 'order' || att.type === 'post') && (
          <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
        )}
      </PressableScale>
    );
  }

  async function loadProducts() {
    setLoadingProducts(true);
    try {
      const data = await api.products.list() as SellerProduct[];
      const active = Array.isArray(data) ? data.filter((p) => p.status === 'active') : [];
      setProducts(active);
    } catch {
      setProducts([]);
    } finally {
      setLoadingProducts(false);
    }
  }

  function attachLinkedOrder() {
    if (!conv?.contextOrderId) return;
    setPendingAttachment({
      type: 'order',
      title: conv.contextOrderNumber ?? 'Order',
      subtitle: conv.contextProductName ?? conv.contextOrderStatus ?? undefined,
      meta: { orderId: conv.contextOrderId },
    });
    setShowAttachPicker(false);
  }

  function attachProduct(product: SellerProduct) {
    const priceStr = formatPrice(product);
    setPendingAttachment({
      type: 'product',
      title: product.name,
      subtitle: priceStr || undefined,
      meta: { productId: product.id },
    });
    setShowProductPicker(false);
    setShowAttachPicker(false);
  }

  // ── Send ────────────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!id || !canSend) return;
    const t = text.trim();
    const att = pendingAttachment;
    const replyingTo = replyTo;
    setText('');
    setPendingAttachment(null);
    setReplyTo(null);
    setIsSending(true);
    try {
      const msg = await api.conversations.send(id, {
        text: t,
        attachment: att ?? undefined,
        replyToId: replyingTo?.id,
      });
      setMessages((prev) => [...prev, msg as Msg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e: any) {
      const raw = String(e?.message ?? '');
      const friendly = raw.includes('MODERATED')
        ? 'This message was flagged by safety filters and was not sent.'
        : raw.includes('BLOCKED')
          ? "You can't message this buyer."
          : 'Message not sent. Tap to retry.';
      Alert.alert('Not sent', friendly);
      setText(t);
      setPendingAttachment(att);
      setReplyTo(replyingTo);
    } finally {
      setIsSending(false);
    }
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  function renderItem({ item }: ListRenderItemInfo<ListRow>) {
    if (item.type === 'date') {
      return (
        <View style={s.dateWrap}>
          <View style={s.datePill}><Text style={s.dateText}>{item.date}</Text></View>
        </View>
      );
    }
    if (item.type === 'call_log') {
      return (
        <View style={[s.msgOuter, { justifyContent: 'flex-start' }]}>
          <CallLogBubble
            entry={item.entry}
            onCallBack={() => handleStartCall(item.entry.mode)}
          />
        </View>
      );
    }
    const { msg, isFirstInGroup, isLastInGroup } = item;
    const isOwn = msg.fromId === myId;
    if (msg.attachment?.type === 'system') {
      return (
        <SystemLine
          msg={msg}
          isOwn={isOwn}
          theme={theme}
          onOpenThemePicker={openThemePicker}
          onQuickToggleDisappearing={handleQuickToggleDisappearing}
        />
      );
    }
    const removed = (msg as { removedByModeration?: boolean }).removedByModeration === true;
    const isRead = msg.status === 'read' || !!msg.readAt;
    return (
      <View style={[s.msgOuter, { justifyContent: isOwn ? 'flex-end' : 'flex-start', marginTop: isFirstInGroup ? SP.sm : 2 }]}>
        {/* Buyer avatar — only on the last bubble of a consecutive run, same
            IG-style grouping as app/buyer-conversation.tsx (lib/chatGrouping.ts). */}
        {!isOwn && (
          isLastInGroup ? (
            <View style={[s.msgAvatar, { backgroundColor: msg.fromColor || PURPLE }]}>
              <Text style={s.msgAvatarInitials}>{msg.fromInitials || (msg.fromName?.[0] ?? '?')}</Text>
            </View>
          ) : <View style={s.msgAvatarSpacer} />
        )}
        <View style={{ maxWidth: BUBBLE_MAX }}>
          <SwipeToReplyBubble
            testID={`seller-conversation-bubble-swipe-${msg.id}`}
            disabled={removed || messagingBlocked}
            iconColor={MUTED}
            iconBg={CARD}
            onReply={() => { setReplyTo(msg); }}
          >
          <PressableScale
            activeOpacity={0.9}
            disabled={isOwn || removed || !other}
            onLongPress={() => {
              if (!other) return;
              hapticSelection();
              openMessageOptions({
                router,
                messageId: msg.id,
                text: msg.text,
                counterpart: { userId: other.userId, name: other.name },
              });
            }}
            delayLongPress={350}
            style={[
              s.bubble,
              {
                backgroundColor: isOwn ? sentBubbleColor : receivedBubbleColor,
                borderColor: isOwn ? sentBubbleColor : BORDER,
                // Shared corner-grouping math (lib/chatGrouping.ts) — the
                // shared edge between grouped bubbles is tightened, every
                // outer corner stays fully rounded, matching the buyer's
                // own thread view of this same conversation.
                ...groupCornerRadii(isOwn, isFirstInGroup, isLastInGroup, RADIUS.lg, 4),
              },
            ]}
            accessibilityHint={isOwn ? undefined : 'Long press to report this message'}
            // Voice messages render their own play/scrub/speed/transcription
            // buttons inside this bubble — PressableScale defaults to rendering
            // an actual <button> on web, which cannot legally contain other
            // interactive controls. Drop the role only here so it's a plain,
            // still fully long-pressable <div> instead. See buyer-conversation.tsx.
            accessibilityRole={msg.attachment?.type === 'voice' ? 'none' : undefined}
          >
            {/* Quoted reply — same inline-quote-strip treatment as
                app/buyer-conversation.tsx, so a thread reads identically from
                both sides. */}
            {msg.replyToId && !removed ? (
              <View style={[s.replyQuote, { borderLeftColor: isOwn ? ON_DARK : PURPLE }]}>
                <Text style={[s.replyQuoteText, { color: isOwn ? `${ON_DARK}CC` : MUTED }]} numberOfLines={1}>
                  {msg.replyPreview ?? messagePreviewText(messages.find(m => m.id === msg.replyToId) ?? {})}
                </Text>
              </View>
            ) : null}

            {/* Attachment */}
            {msg.attachment && renderMsgAttachment(msg.attachment, isOwn)}
            {/* Text — hide the single-space placeholder */}
            {removed ? (
              <Text style={[s.msgText, { color: isOwn ? sentTextColor : MUTED, fontStyle: 'italic' }]}>{REMOVED_MESSAGE_TEXT}</Text>
            ) : msg.text && msg.text.trim().length > 0 && (
              <Text style={[s.msgText, { color: isOwn ? sentTextColor : receivedTextColor }]}>{msg.text}</Text>
            )}

            {/* Inline bottom-right timestamp + read receipt (last bubble of
                a run) — same automatic, group-boundary timestamp behavior as
                app/buyer-conversation.tsx (see that file's own note on why
                this was chosen over tap-to-reveal). */}
            {isLastInGroup && (
              <View style={s.bubbleMeta}>
                <Text style={[s.bubbleTime, { color: isOwn ? `${ON_DARK}B0` : MUTED }]}>
                  {formatTime(msg.ts)}
                </Text>
                {isOwn && msg.status !== 'failed' && (
                  <View style={s.receiptChecks}>
                    <Feather name="check" size={11} color={isRead ? ON_DARK : `${ON_DARK}B0`} />
                    {isRead && <Feather name="check" size={11} color={ON_DARK} style={{ marginLeft: -7 }} />}
                  </View>
                )}
              </View>
            )}
          </PressableScale>
          </SwipeToReplyBubble>

          {/* Seen receipt — real backend readAt, same as
              app/buyer-conversation.tsx; see lib/chatGrouping.ts. */}
          {isOwn && msg.id === lastOwnMsgId && !!msg.readAt && (
            <Text style={s.seenReceipt}>
              Seen {formatTime(new Date(msg.readAt).getTime())}
            </Text>
          )}
        </View>
      </View>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={s.root}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Chat details > Theme: only rendered when a theme is actually
          applied — an un-themed chat's background is untouched. */}
      {convTheme && (
        <LinearGradient colors={convTheme.gradient} style={StyleSheet.absoluteFill} testID="conversation-theme-background" />
      )}

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm }]}>
        <PressableScale
          onPress={() => { hapticPrimaryAction(); goBackOr(router); }}
          style={s.headerBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={ICON.lg} color={FG} />
        </PressableScale>
        <PressableScale
          style={s.headerCenterRow}
          disabled={!other || !id}
          onPress={() => { hapticPrimaryAction(); openChatDetails(); }}
          testID="seller-conversation-header-name"
          accessibilityRole="button"
          accessibilityLabel={`${displayName} — chat details`}
        >
          {other && (
            <View style={[s.headerAvatar, { backgroundColor: other.color || PURPLE }]}>
              <Text style={s.headerAvatarInitials}>
                {other.initials || (other.name?.[0] ?? '?').toUpperCase()}
              </Text>
            </View>
          )}
          <View style={s.headerCenter}>
            <Text style={s.headerName} numberOfLines={1}>{displayName}</Text>
            {other?.handle ? <Text style={s.headerHandle} numberOfLines={1}>{other.handle}</Text> : null}
          </View>
        </PressableScale>
        {id && (
          <>
            <PressableScale
              style={s.headerCallBtn}
              onPress={() => { hapticPrimaryAction(); handleStartCall('voice'); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Voice call"
            >
              <Feather name="phone" size={ICON.md} color={MUTED} />
            </PressableScale>
            <PressableScale
              style={s.headerCallBtn}
              onPress={() => { hapticPrimaryAction(); handleStartCall('video'); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="Video call"
            >
              <Feather name="video" size={ICON.md} color={MUTED} />
            </PressableScale>
          </>
        )}
        {other ? (
          <PressableScale
            style={s.headerCallBtn}
            onPress={() => { hapticPrimaryAction(); openConversationOptions({
              router,
              social: api.social,
              counterpart: { userId: other.userId, name: other.name },
              messaging,
              onChange: setMessaging,
            }); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Conversation options"
          >
            <Feather name="more-horizontal" size={ICON.md} color={FG} />
          </PressableScale>
        ) : null}
      </View>

      {/* Order context card */}
      {conv?.contextOrderNumber ? (
        <View style={s.orderCard}>
          <Feather name="package" size={ICON.md} color={PURPLE} />
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.orderNumber}>{conv.contextOrderNumber}</Text>
            {conv.contextProductName ? (
              <Text style={s.orderProduct} numberOfLines={1}>{conv.contextProductName}</Text>
            ) : null}
          </View>
          {conv.contextOrderStatus ? (
            <View style={s.orderBadge}><Text style={s.orderBadgeText}>{humanOrderStatus(conv.contextOrderStatus)}</Text></View>
          ) : null}
        </View>
      ) : null}

      {/* Messages */}
      {isLoading ? (
        <View style={s.listContent}>
          <View style={[s.msgOuter, { justifyContent: 'flex-start' }]}>
            <SkeletonBlock width="55%" height={40} radius={RADIUS.lg} />
          </View>
          <View style={[s.msgOuter, { justifyContent: 'flex-end' }]}>
            <SkeletonBlock width="40%" height={32} radius={RADIUS.lg} />
          </View>
          <View style={[s.msgOuter, { justifyContent: 'flex-start' }]}>
            <SkeletonBlock width="65%" height={56} radius={RADIUS.lg} />
          </View>
          <View style={[s.msgOuter, { justifyContent: 'flex-end' }]}>
            <SkeletonBlock width="35%" height={32} radius={RADIUS.lg} />
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={groupByDate(messages, callLog)}
          keyExtractor={(item, i) => (
            item.type === 'date' ? `date-${item.date}-${i}`
              : item.type === 'call_log' ? `call-${item.entry.id}`
              : item.msg.id
          )}
          renderItem={renderItem}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Pending attachment preview */}
      {pendingAttachment && (
        <View style={s.pendingAttachRow}>
          <Feather name={attachmentIcon(pendingAttachment.type)} size={ICON.sm} color={PURPLE} />
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.pendingAttachTitle} numberOfLines={1}>{pendingAttachment.title}</Text>
            {pendingAttachment.subtitle ? (
              <Text style={s.pendingAttachSub} numberOfLines={1}>{pendingAttachment.subtitle}</Text>
            ) : null}
          </View>
          <PressableScale
            onPress={() => setPendingAttachment(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={ICON.sm} color={MUTED} />
          </PressableScale>
        </View>
      )}

      {/* Reply preview — mirrors app/buyer-conversation.tsx's own
          ReplyBanner (Mobbin: Instagram "Replying to a message",
          mobbin.com/flows/c973fada-0946-4bf2-b821-8a2b37958685). */}
      {replyTo && !messagingBlocked && (
        <ReplyBanner
          testID="seller-conversation-reply-banner"
          theme={theme}
          fromName={replyTo.fromName}
          previewText={messagePreviewText(replyTo)}
          onCancel={() => setReplyTo(null)}
        />
      )}

      {/* Input row */}
      {messagingBlocked && other ? (
        <BlockedComposer
          counterpartName={other.name}
          messaging={messaging}
          bottomInset={insets.bottom}
          onUnblock={async () => {
            if (await confirmUnblock({ userId: other.userId, name: other.name }, api.social.unblock)) {
              setMessaging((current) => ({ ...current, blockedByMe: false }));
            }
          }}
        />
      ) : (
      <View style={[s.inputRow, { paddingBottom: Math.max(insets.bottom, SP.sm) + SP.sm }]}>
        {voiceRecorder.phase !== 'idle' ? (
          <VoiceRecordingBar
            theme={theme}
            phase={voiceRecorder.phase}
            elapsedMs={voiceRecorder.elapsedMs}
            waveform={voiceRecorder.waveform}
            dragX={voiceRecorder.dragX}
            dragY={voiceRecorder.dragY}
            // The seller composer's mic was already tap-to-toggle (no
            // press-and-hold) before this PR — keep that consistent
            // interaction on every platform rather than adding a native-only
            // hold gesture here. See docs/dm-flows.md.
            isWeb
            onCancel={voiceRecorder.cancel}
            onLock={voiceRecorder.lock}
            onSend={() => { void voiceRecorder.finish(); }}
          />
        ) : (<>
        {/* Attach button */}
        <PressableScale
          style={s.attachBtn}
          onPress={() => { hapticPrimaryAction(); openAttachPicker(); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Attach"
        >
          <Feather name="paperclip" size={ICON.md} color={pendingAttachment ? PURPLE : MUTED} />
        </PressableScale>

        {/* Media */}
        <PressableScale
          style={s.attachBtn}
          onPress={() => { hapticPrimaryAction(); setShowMediaSheet(true); }}
          disabled={isUploading || isSending}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Photo or video"
        >
          {isUploading
            ? <ActivityIndicator size="small" color={PURPLE} />
            : <Feather name="camera" size={ICON.md} color={MUTED} />
          }
        </PressableScale>

        {/* Voice */}
        <PressableScale
          style={s.attachBtn}
          onPress={() => { void voiceRecorder.startWeb(); }}
          disabled={isUploading || isSending}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="seller-conversation-mic"
          accessibilityRole="button"
          accessibilityLabel="Record voice message"
        >
          <Feather name="mic" size={ICON.md} color={MUTED} />
        </PressableScale>

        <TextInput
          style={s.textInput}
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor={SUBTLE}
          multiline
          returnKeyType="default"
        />
        <PressableScale
          style={[
            s.sendBtn,
            canSend
              ? { backgroundColor: PURPLE, borderColor: PURPLE }
              : { backgroundColor: CARD, borderColor: BORDER },
          ]}
          onPress={() => { hapticPrimaryAction(); handleSend(); }}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          activeOpacity={0.8}
        >
          <Feather name="send" size={ICON.sm} color={canSend ? ON_DARK : MUTED} />
        </PressableScale>
        </>)}
      </View>
      )}

      {/* ── Media picker sheet ─────────────────────────────────────────────── */}
      <Modal
        visible={showMediaSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMediaSheet(false)}
      >
        <PressableScale style={s.modalOverlay} activeOpacity={1} onPress={() => setShowMediaSheet(false)} />
        <SheetRise style={[s.sheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>Add to message</Text>
          <PressableScale style={s.sheetOption} onPress={handlePickPhoto}>
            <View style={s.sheetOptionIcon}><Feather name="image" size={ICON.md} color={PURPLE} /></View>
            <View>
              <Text style={s.sheetOptionLabel}>Photos</Text>
              <Text style={s.sheetOptionDesc}>Up to 15 at once</Text>
            </View>
          </PressableScale>
          <PressableScale style={s.sheetOption} onPress={handlePickVideo}>
            <View style={s.sheetOptionIcon}><Feather name="video" size={ICON.md} color={PURPLE} /></View>
            <View>
              <Text style={s.sheetOptionLabel}>Video clip</Text>
              <Text style={s.sheetOptionDesc}>Under 1 minute</Text>
            </View>
          </PressableScale>
          <View style={{ height: 20 }} />
        </SheetRise>
      </Modal>

      {/* ── Attach picker sheet ─────────────────────────────────────────────── */}
      <Modal
        visible={showAttachPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAttachPicker(false)}
      >
        <PressableScale
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAttachPicker(false)}
        />
        <SheetRise style={[s.sheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={s.sheetHandle} />
          <Text style={s.sheetTitle}>Attach to message</Text>

          <PressableScale
            style={s.sheetOption}
            onPress={async () => {
              setShowAttachPicker(false);
              setShowProductPicker(true);
              await loadProducts();
            }}
          >
            <View style={s.sheetOptionIcon}>
              <Feather name="shopping-bag" size={ICON.md} color={PURPLE} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.sheetOptionLabel}>Attach a product</Text>
              <Text style={s.sheetOptionDesc}>Share a product card from your store</Text>
            </View>
            <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
          </PressableScale>

          {conv?.contextOrderId ? (
            <PressableScale style={s.sheetOption} onPress={attachLinkedOrder}>
              <View style={s.sheetOptionIcon}>
                <Feather name="package" size={ICON.md} color={PURPLE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetOptionLabel}>Attach linked order</Text>
                <Text style={s.sheetOptionDesc}>
                  {conv.contextOrderNumber ?? 'Order'}{conv.contextProductName ? ` · ${conv.contextProductName}` : ''}
                </Text>
              </View>
              <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
            </PressableScale>
          ) : null}

          <PressableScale
            style={[s.sheetOption, { marginTop: SP.sm, borderTopWidth: 1, borderTopColor: BORDER }]}
            onPress={() => setShowAttachPicker(false)}
          >
            <Text style={[s.sheetOptionLabel, { color: MUTED, textAlign: 'center', flex: 1 }]}>Cancel</Text>
          </PressableScale>
        </SheetRise>
      </Modal>

      {/* ── Product picker modal ────────────────────────────────────────────── */}
      <Modal
        visible={showProductPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProductPicker(false)}
      >
        <PressableScale
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowProductPicker(false)}
        />
        <SheetRise style={[s.productSheet, { paddingBottom: insets.bottom + SP.md }]}>
          <View style={s.sheetHandle} />
          <View style={s.productSheetHeader}>
            <Text style={s.sheetTitle}>Choose a product</Text>
            <PressableScale onPress={() => setShowProductPicker(false)}>
              <Feather name="x" size={ICON.md} color={MUTED} />
            </PressableScale>
          </View>

          {loadingProducts ? (
            <View style={s.centerFill}><ActivityIndicator color={PURPLE} /></View>
          ) : products.length === 0 ? (
            <View style={s.emptyState}>
              <Feather name="shopping-bag" size={32} color={MUTED} />
              <Text style={s.emptyText}>No products found</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {products.map((product) => (
                <PressableScale
                  key={product.id}
                  style={s.productRow}
                  onPress={() => attachProduct(product)}
                  activeOpacity={0.7}
                >
                  <View style={s.productIcon}>
                    <Feather name="shopping-bag" size={ICON.md} color={PURPLE} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.productName} numberOfLines={1}>{product.name}</Text>
                    {formatPrice(product) ? (
                      <Text style={s.productPrice}>{formatPrice(product)}</Text>
                    ) : null}
                  </View>
                  <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
                </PressableScale>
              ))}
            </ScrollView>
          )}
        </SheetRise>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  const BG = theme.background;
  const CARD = theme.card;
  const BORDER = theme.border;
  const BORDER_ACTIVE = theme.accent;
  const FG = theme.text;
  const MUTED = theme.muted;
  const SUBTLE = theme.subtle;
  const RED = theme.error;
  const ON_DARK = theme.onAccent;
  const PURPLE = theme.accent;
  const PURPLE_DIM = theme.accentDim;
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: BG,
    paddingHorizontal: SP.md, paddingBottom: SP.sm,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerBack: { marginRight: SP.sm },
  headerAvatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', marginRight: SP.sm,
  },
  headerAvatarInitials: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  headerCenterRow: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  headerCenter: { flex: 1 },
  headerName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  headerHandle: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },

  orderCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: SP.md, marginVertical: SP.sm, padding: SP.sm,
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER,
  },
  orderNumber: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  orderProduct: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  orderBadge: {
    backgroundColor: PURPLE_DIM, borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
  },
  orderBadgeText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: PURPLE },

  listContent: { paddingVertical: SP.sm, paddingBottom: SP.md },
  dateWrap: { alignItems: 'center', marginVertical: SP.md },
  datePill: {
    backgroundColor: CARD, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.sm, paddingVertical: SP.xs,
  },
  dateText: { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },

  msgOuter: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: SP.md, marginBottom: SP.xs,
  },
  msgAvatar: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    marginRight: SP.sm, marginBottom: 2,
  },
  msgAvatarInitials: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  // Reserves the avatar's own width+gap for a bubble that isn't the last in
  // its group, so every bubble in a run still lines up on the same left
  // edge — matches app/buyer-conversation.tsx's msgAvatarSpacer.
  msgAvatarSpacer: { width: 32, marginRight: SP.sm },
  bubble: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SP.md },
  msgText: { fontSize: FS.base, fontFamily: FONT.regular, color: FG, marginTop: 4 },
  // Quoted reply snippet — same shape as app/buyer-conversation.tsx.
  replyQuote: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    marginBottom: 4,
  },
  replyQuoteText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
  },
  bubbleMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    marginTop: 4,
    gap: 3,
  },
  bubbleTime: { fontSize: 10, fontFamily: FONT.regular },
  receiptChecks: { flexDirection: 'row', marginLeft: 2 },
  // Seen receipt (Instagram DM "Seen just now" reference) — small muted
  // text under the sender's own last message.
  seenReceipt: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: MUTED,
    alignSelf: 'flex-end',
    marginTop: 3,
    marginRight: 2,
  },

  attachCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: BG, borderRadius: RADIUS.md,
    padding: SP.sm, marginBottom: 2,
    borderWidth: 1, borderColor: BORDER,
  },
  attachTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  attachSubtitle: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },

  pendingAttachRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: SP.md, marginBottom: SP.xs,
    padding: SP.sm,
    backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER_ACTIVE,
  },
  pendingAttachTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  pendingAttachSub: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 1 },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: SP.md, paddingTop: SP.sm, gap: SP.sm,
    borderTopWidth: 1, borderTopColor: BORDER, backgroundColor: BG,
  },
  // Matches buyer-conversation.tsx's COMPOSER_CONTROL — one consistent size
  // across every circular control in the row (previously 40/40/40/44).
  attachBtn: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 2,
  },
  textInput: {
    flex: 1, backgroundColor: CARD, borderRadius: RADIUS.xl,
    borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: SP.md, paddingVertical: SP.sm,
    fontSize: FS.base, fontFamily: FONT.regular, color: FG, maxHeight: 120,
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, marginBottom: 2,
  },

  // Attach picker sheet
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm, paddingHorizontal: SP.md,
  },
  sheetHandle: {
    width: 36, height: 4, backgroundColor: BORDER,
    borderRadius: 2, alignSelf: 'center', marginBottom: SP.md,
  },
  sheetTitle: {
    fontSize: FS.lg, fontFamily: FONT.semibold, color: FG,
    marginBottom: SP.md,
  },
  sheetOption: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SP.md, gap: SP.sm,
  },
  sheetOptionIcon: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetOptionLabel: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  sheetOptionDesc: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },

  // Product picker sheet
  productSheet: {
    backgroundColor: CARD, borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm, paddingHorizontal: SP.md,
    maxHeight: '70%',
  },
  productSheetHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SP.sm,
  },
  productRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SP.md,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  productIcon: {
    width: 40, height: 40, borderRadius: RADIUS.md,
    backgroundColor: PURPLE_DIM,
    alignItems: 'center', justifyContent: 'center',
    marginRight: SP.sm,
  },
  productName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
  productPrice: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: SP.xxl },
  emptyText: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, marginTop: SP.sm },

  // ── Call + media styles ──────────────────────────────────────────────────────
  headerCallBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginLeft: SP.xs },
  recordingBtn:  { backgroundColor: 'rgba(255,59,48,0.12)', borderRadius: RADIUS.pill },

  // Photo grid
  photoGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 2, borderRadius: RADIUS.md, overflow: 'hidden' },
  photoCell:       { width: '48%', aspectRatio: 1, overflow: 'hidden', borderRadius: RADIUS.sm, position: 'relative' },
  photoCellSingle: { width: '100%', aspectRatio: 4 / 3 },
  photoImg:        { width: '100%', height: '100%' },
  photoMore:       { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  photoMoreText:   { color: '#fff', fontSize: FS.lg, fontFamily: FONT.bold },

  // Video thumb
  videoThumb:       { borderRadius: RADIUS.md, overflow: 'hidden', width: 200, height: 130, position: 'relative' },
  videoThumbImg:    { width: '100%', height: '100%' },
  videoPlayOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  videoDurBadge:    { position: 'absolute', bottom: SP.xs, right: SP.xs, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: RADIUS.sm, paddingHorizontal: SP.xs, paddingVertical: 2 },
  videoDurText:     { color: '#fff', fontSize: FS.xs, fontFamily: FONT.medium },

  // Voice player
  voiceRow:          { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.xs, minWidth: 160 },
  voicePlayBtn:      { width: 28, height: 28, borderRadius: 14, backgroundColor: PURPLE, alignItems: 'center', justifyContent: 'center' },
  voicePlayBtnActive:{ backgroundColor: RED },
  voiceWave:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3 },
  voiceBar:          { width: 3, backgroundColor: PURPLE_DIM, borderRadius: 2 },
  voiceDur:          { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  });
};
