import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View, Text, FlatList, TextInput, Alert, Platform, StyleSheet, Dimensions,
  ListRenderItemInfo, Modal, ScrollView, ActivityIndicator, Animated, Keyboard, Linking,
} from 'react-native';
import { KeyboardAvoidingView, KeyboardGestureArea } from 'react-native-keyboard-controller';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale, StatusBadge, useUndoToast } from '@/components/BrandthreadUI';
import { dbStatusToOrderStatus, orderStatusBadgeLabel, orderStatusBadgeVariant, carrierTrackingUrl } from '@/lib/orderStatusAdapter';
import { CachedImage } from '@/components/CachedImage';
import BrandthreadLogo from '@/components/branding/BrandthreadLogo';
import { Chip } from '@/components/ui/Chip';
import { Snackbar } from '@/components/ui/Snackbar';
import { hapticPrimaryAction, hapticSuccessAction, hapticSelection, hapticDestructiveConfirm, hapticToggle } from '@/lib/haptics';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import {
  getConversation, createOrGetConversation, getMessages,
  sendMessage, retryMessage, addReaction, deleteMessageForMe,
  markConversationRead, subscribeSocial,
  setConversationTheme, setConversationDisappearing,
  MY_USER_ID, MY_NAME, MY_INITIALS, MY_COLOR,
} from '@/services/socialService';
import { pickAvatarColor } from '@/lib/avatarColors';
import { useCallSession, useCallLog } from '@/lib/calls/CallSessionContext';
import { CallLogBubble } from '@/components/calls/CallLogBubble';
import type { CallLogEntry } from '@/lib/calls/types';
import type {
  Conversation, Message, MessageAttachment, ConversationParticipant, ReactionType,
} from '@/services/socialTypes';
import { useApi } from '@/lib/api';
import * as ImagePicker from 'expo-image-picker';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { VoiceRecordingBar } from '@/components/chat/VoiceRecordingBar';
import { VoiceMessageBubble, TRANSCRIPTION_STUB } from '@/components/chat/VoiceMessageBubble';
import { showActionSheet } from '@/components/ui/ActionSheet';
import { useAuth } from '@clerk/expo';
import { apiErrorMessage, confirmBlock, confirmUnblock, reportHref } from '@/lib/safety';
import { BlockedComposer, type DmMessagingState } from '@/components/safety/DmSafety';
import {
  acceptConversationRequest, scheduleDeleteConversationRequest, undoDeleteConversationRequest,
  blockConversationRequestUser,
} from '@/lib/requestActions';
import { DELETE_GRACE_MS } from '@/lib/pendingRequestDeletes';
import { confirmDestructiveActionSheet } from '@/lib/actionSheet';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCelebrateThreadCash } from '@/components/thread-cash/CelebrationHost';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { formatCents } from '@/lib/money';
import { SheetRise } from '@/components/motion/SheetRise';
import UploadRing from '@/components/chat/UploadRing';
import MediaUploadThumb from '@/components/chat/MediaUploadThumb';
import MediaViewer from '@/components/chat/MediaViewer';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { ThreadCashAttachButton, ThreadCashMessageCard, ThreadCashBillMark } from '@/components/thread-cash/ChatAttachThreadCash';
import type { ThreadCashTransferStatus } from '@/lib/threadCashTypes';
import { ReactionGlyph, reactionAuthorName } from '@/components/chat/ReactionBar';
import { ReactionOverlay, type ReactionOverlayAnchor, type ReactionOverlayMenuItem } from '@/components/chat/ReactionOverlay';
import { applyOptimisticReaction, myReactionIn, groupReactionCounts } from '@/lib/reactionMutations';
import { SystemLine } from '@/components/chat/SystemLine';
import { SwipeToReplyBubble } from '@/components/chat/SwipeToReplyBubble';
import { ReplyBanner } from '@/components/chat/ReplyBanner';
import { ChatAttachmentCard } from '@/components/chat/ChatAttachmentCard';
import { getConversationTheme } from '@/lib/conversationThemes';
import { LinearGradient } from 'expo-linear-gradient';
import {
  isPreviewConversationId, getPreviewConversation, getPreviewMessages,
  setPreviewConversationDisappearing, appendPreviewMessage, reactToPreviewMessage,
  isPreviewInboxEnabled, posterUri, previewAutoReplyText, previewAutoReplyDelayMs,
} from '@/lib/previewInbox';
import {
  parseQuickReplies, cannedAgentReply, hasWelcomePlayed, markWelcomePlayed,
  type AgentQuickReply,
} from '@/lib/agentChat';
import { EMOJI_FONT_STACK } from '@/lib/appleEmoji';
import {
  formatDate as sharedFormatDate, formatTime as sharedFormatTime,
  sameSenderClose, groupCornerRadii, lastOwnMessageId, messagePreviewText,
} from '@/lib/chatGrouping';

/** Well-known clerkId of the official Brandthread Agent account — matches
 *  the preview seed (lib/previewInboxData.ts) and the api-server system
 *  account (lib/brandthreadAgent.ts). */
const BRANDTHREAD_AGENT_USER_ID = 'brandthread-agent';

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

// formatDate / formatTime / GROUP_GAP_MS / sameSenderClose now live in
// lib/chatGrouping.ts, shared with app/seller-conversation.tsx, so both
// sides of the same thread group identically — see that module's doc
// comment for why the two screens' JSX itself isn't fully consolidated.
const formatDate = sharedFormatDate;
const formatTime = sharedFormatTime;

type DateRow = { type: 'date'; date: string; ts: number; key: string };
type UnreadRow = { type: 'unread'; key: string };
type MsgRow = { type: 'message'; msg: Message; isFirstInGroup: boolean; isLastInGroup: boolean };
type CallLogRow = { type: 'call_log'; entry: CallLogEntry; key: string };
type ListRow = DateRow | UnreadRow | MsgRow | CallLogRow;

/** Interleaves the (client-only, PR1) call log into the already-built message
 *  rows by timestamp, inserting a date separator when a call falls on a day
 *  not otherwise represented — see CallSessionContext's own doc comment on
 *  why this log isn't backend-persisted yet. */
function mergeCallLogRows(rows: ListRow[], callLog: CallLogEntry[]): ListRow[] {
  if (callLog.length === 0) return rows;
  const merged = [...rows];
  const rowTs = (r: ListRow): number => (
    r.type === 'message' ? r.msg.ts : r.type === 'call_log' ? r.entry.startedAt : r.type === 'date' ? r.ts : -Infinity
  );
  for (const entry of [...callLog].sort((a, b) => a.startedAt - b.startedAt)) {
    let insertAt = merged.length;
    for (let i = 0; i < merged.length; i++) {
      if (rowTs(merged[i]) > entry.startedAt) { insertAt = i; break; }
    }
    const d = formatDate(entry.startedAt);
    const precedingDate = [...merged.slice(0, insertAt)].reverse().find((r): r is DateRow => r.type === 'date');
    const toInsert: ListRow[] = [];
    if (!precedingDate || precedingDate.date !== d) {
      toInsert.push({ type: 'date', date: d, ts: entry.startedAt, key: `date-call-${entry.id}` });
    }
    toInsert.push({ type: 'call_log', entry, key: `call-${entry.id}` });
    merged.splice(insertAt, 0, ...toInsert);
  }
  return merged;
}

function buildListRows(msgs: Message[], unreadDividerId: string | null): ListRow[] {
  const rows: ListRow[] = [];
  let lastDate = '';
  msgs.forEach((msg, i) => {
    const d = formatDate(msg.ts);
    if (msg.id === unreadDividerId) {
      rows.push({ type: 'unread', key: `unread-${msg.id}` });
    }
    if (d !== lastDate) {
      rows.push({ type: 'date', date: d, ts: msg.ts, key: `date-${d}-${i}` });
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
// Links the message list's KeyboardGestureArea to the composer's TextInput
// (react-native-keyboard-controller, iOS) so a drag on the list can swipe
// the keyboard down interactively.
const CHAT_INPUT_NATIVE_ID = 'buyer-conversation-composer-input';

// ─── Bubble column (Instagram/Threads DM layout) ───────────────────────────────
// A 28pt avatar + 8pt gap sits to the left of every incoming bubble, but only
// next to the LAST bubble of a consecutive group (see msgAvatarSpacer below).
// Every incoming bubble, card and quick-reply row shares this same left edge —
// msgOuter's own SP.md horizontal padding plus this avatar+gap offset.
const AVATAR_SIZE = 28;
const AVATAR_GAP = SP.sm;
const BUBBLE_COLUMN_LEFT = SP.md + AVATAR_SIZE + AVATAR_GAP;

// ─── Composer sizing ────────────────────────────────────────────────────────────
// One consistent size for every circular control in the composer row (the
// "+" attach button, the in-pill Thread Cash coin, and the mic⇄send morph) —
// the previous 44/36/44 mix is exactly what read as mismatched.
const COMPOSER_CONTROL = 36;
// Mic / gallery / Thread Cash bill inside the pill are all this size, evenly
// spaced — per the Instagram/Threads composer reference.
const COMPOSER_ICON = 22;
// The pill grows with the TextInput up to ~5 lines, then scrolls internally.
const COMPOSER_LINE_HEIGHT = 20;
const COMPOSER_MAX_LINES = 5;
const COMPOSER_TEXT_V_PADDING = SP.sm; // matches s.textInput's own vertical padding below
const COMPOSER_MAX_INPUT_HEIGHT = COMPOSER_LINE_HEIGHT * COMPOSER_MAX_LINES + COMPOSER_TEXT_V_PADDING * 2;

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
    // Item 74 verification aid ONLY — see the effect below that reads it.
    bt_force_upload?: string;
  }>();

  const flatListRef = useRef<FlatList<ListRow>>(null);
  // Per-message-id scroll refs for the quick-reply chip rows.
  const quickReplyScrollRefs = useRef<Record<string, ScrollView | null>>({});
  const api = useApi();
  const { userId } = useAuth();
  const { startCall } = useCallSession();
  const threadCashSendEnabled = useFeatureFlag('threadCashSend');
  // A sent/claimed/cancelled Thread Cash bubble's status is set once, in the
  // message's own attachment meta, at send time — it never gets rewritten
  // server-side. Claim/cancel outcomes are reflected here for the rest of
  // this screen's session; a fresh message fetch elsewhere will show the
  // original status again until the server exposes a live lookup.
  const [threadCashOverrides, setThreadCashOverrides] = useState<Record<string, ThreadCashTransferStatus>>({});
  const celebrateThreadCash = useCelebrateThreadCash();
  // Whether the other participant and I are mutual follows, purely to drive
  // the Thread Cash entry point's enabled/disabled affordance in the
  // composer — null while unknown/loading. The server independently
  // re-validates mutual follow at send AND claim, so this client read can
  // never itself be the security boundary; it only decides whether the coin
  // shows as tappable or as a disabled affordance with an explanation.
  const [threadCashMutual, setThreadCashMutual] = useState<boolean | null>(null);
  /** The signed-in Clerk user; legacy local records used the literal 'me'. */
  const myId = userId ?? MY_USER_ID;
  const [messaging, setMessaging] = useState<DmMessagingState>({ blockedByMe: false, unavailable: false });

  const [conv, setConv] = useState<Conversation | null>(null);
  const callLog = useCallLog(conv?.id ?? params.id ?? '');
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const { showUndo } = useUndoToast();
  const textInputRef = useRef<TextInput>(null);
  // Request-mode UI state (see the bottom RequestActionPanel below):
  // in-flight Accept, so the Accept/Block/Delete row can't double-fire.
  const [requestActionLoading, setRequestActionLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [copiedToast, setCopiedToast] = useState(false);
  const [transcriptionToast, setTranscriptionToast] = useState(false);
  const [threadCashNotice, setThreadCashNotice] = useState<string | null>(null);
  const [isUploading, setIsUploading]         = useState(false);
  const [playingVoiceUri, setPlayingVoiceUri] = useState<string | null>(null);
  const [voiceSpeed, setVoiceSpeed]           = useState(1);
  const [showMediaSheet, setShowMediaSheet]   = useState(false);
  const [activeSheetMsg, setActiveSheetMsg]   = useState<Message | null>(null);
  // The long-pressed bubble's on-screen position, measured right before the
  // Glass reaction overlay opens (components/chat/ReactionOverlay.tsx) — one
  // ref per message id so a recycled FlatList row always measures the right
  // node. Cleared alongside activeSheetMsg.
  const bubbleAnchorRefs = useRef<Record<string, View | null>>({});
  const [reactionAnchor, setReactionAnchor] = useState<ReactionOverlayAnchor | null>(null);
  const [viewerUri, setViewerUri]             = useState<string | null>(null);
  const [likeBurst, setLikeBurst] = useState<{ key: number; x: number; y: number } | null>(null);
  const voicePlayer = useAudioPlayer(null);
  const voicePlayerStatus = useAudioPlayerStatus(voicePlayer);
  const voiceRecorder = useVoiceRecorder(uploadMedia, handleVoiceRecorded);

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
  // Item 74 (photo/video upload progress ring): invalidates an in-flight
  // pick/upload when a newer pick starts or the user removes the staged
  // attachment while it's still uploading, so a stale upload can't clobber
  // whatever the composer is showing by the time it resolves. uploadMedia()
  // has no real cancel/abort — this only makes the UI stop listening to it.
  const mediaUploadTokenRef = useRef(0);
  // Real-time "X is typing…": true once we've told the server we're
  // composing (PATCH /api/conversations/:id/typing), so handleChangeText
  // doesn't re-send it on every keystroke, and a timer that clears it after
  // a pause, since the server-side window (8s) is a safety net, not the UX.
  const isTypingSentRef = useRef(false);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Item 74 verification aid — NOT a real feature. The upload-in-progress
  // ring is inherently transient (uploadMedia() resolves/rejects as soon as
  // the request completes), and this sandbox has no reachable backend for a
  // real upload to actually hang on, so there's no reliable window to
  // screenshot it mid-flight. Visiting the conversation with both
  // ?bt_preview=buyer and &bt_force_upload=1 force-stages a real bundled
  // photo as "uploading" so the ring state can be screenshotted
  // deterministically. Inert unless isPreviewInboxEnabled() is also true
  // (same __DEV__-plus-non-prod-base-URL gate every other preview seed in
  // this file uses), so it can never fire for a real signed-in user.
  useEffect(() => {
    if (params.bt_force_upload !== '1' || !isPreviewInboxEnabled()) return;
    setSelectedAttachment({
      type: 'image', uri: posterUri(2),
      title: 'Photo',
      meta: { photoUris: JSON.stringify([posterUri(2)]), uploading: 'true' },
    });
    setIsUploading(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.bt_force_upload]);

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
    // The dev-web ?bt_preview=buyer bypass never signs in through Clerk (see
    // lib/devPreview.ts / the buyer inbox's own identical guard), so
    // `userId` is null here in that mode — check for a seeded preview
    // conversation id BEFORE the real-account `userId` guard below, or the
    // whole preview thread (and its Thread Cash flow) is unreachable no
    // matter what. Real accounts always have a userId and never hit this
    // branch either way.
    if (!userId && !(params.id && isPreviewConversationId(params.id))) {
      setConv(null);
      setMessages([]);
      setIsLoading(false);
      return;
    }
    try {
      let loadedConv: Conversation | null = null;
      let unreadBeforeRead = 0;

      // Dev/preview only: a seeded thread from lib/previewInbox.ts has no
      // real backend record, so skip the real API entirely for it rather
      // than relying on its 404 error path — never taken for a real
      // conversation id.
      if (params.id && isPreviewConversationId(params.id)) {
        loadedConv = getPreviewConversation(params.id);
        setConv(loadedConv);
        setMessaging({ blockedByMe: false, unavailable: false });
        setIsLoading(false);
        if (loadedConv) {
          const seeded = getPreviewMessages(loadedConv.id);
          const alreadyPlayed = await hasWelcomePlayed(loadedConv.id);
          if (alreadyPlayed || !loadedConv.isOfficial) {
            // Ordinary preview threads, or a Brandthread Agent thread whose
            // welcome has already played once — show everything at once.
            setMessages(seeded);
          } else {
            // First time opening the Brandthread Agent preview thread: type
            // the seeded welcome messages in one at a time, with a natural
            // typing pause between them, then remember it played.
            setMessages([]);
            for (let i = 0; i < seeded.length; i++) {
              setAgentTyping(true);
              await new Promise((resolve) => setTimeout(resolve, 700 + Math.random() * 500));
              setAgentTyping(false);
              setMessages((prev) => [...prev, seeded[i]]);
              setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            await markWelcomePlayed(loadedConv.id);
          }
        }
        return;
      }

      if (params.id) {
        loadedConv = await getConversation(params.id);
        if (loadedConv) {
          unreadBeforeRead = loadedConv.unreadCount ?? 0;
          // Per the Instagram-style request flow: opening a pending request
          // must NOT tell the sender it's been read — that only happens once
          // the recipient actually accepts (see handleAcceptRequest below).
          if (!loadedConv.isRequest) {
            await markConversationRead(loadedConv.id);
          }
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
      if (conv?.id && !isPreviewConversationId(conv.id)) {
        getMessages(conv.id).then(setMessages);
      }
    });
    return unsub;
  }, [conv?.id]);

  // No websocket/realtime layer exists for this conversation yet, so a
  // reaction or reply added by the other participant only appears once we
  // refetch. Poll at a light cadence while the screen is focused — mirrors
  // the refetch-on-local-change pattern `subscribeSocial` already uses.
  // Skipped for a seeded preview thread (no real backend to poll).
  useFocusEffect(useCallback(() => {
    if (!conv?.id || isPreviewConversationId(conv.id)) return;
    const interval = setInterval(() => {
      getMessages(conv.id).then(setMessages).catch(() => {});
    }, 12000);
    return () => clearInterval(interval);
  }, [conv?.id]));

  // The "X is typing…" signal (conv.otherTyping) needs a noticeably tighter
  // cadence than the 12s message poll above to read as live — same 3s
  // cadence lib/live/apiLiveProvider.ts already uses for live-chat polling.
  // Merges just otherTyping into the existing conv object rather than
  // replacing it wholesale, so it never clobbers an in-flight local update
  // (e.g. the optimistic theme/disappearing toggles elsewhere in this file).
  // Skipped for the agent thread (its own agentTyping is client-driven, see
  // sendToAgent) and for a seeded preview thread (no real backend to poll).
  useFocusEffect(useCallback(() => {
    if (!conv?.id || isPreviewConversationId(conv.id) || conv.isOfficial) return;
    const interval = setInterval(() => {
      getConversation(conv.id).then((fresh) => {
        if (!fresh) return;
        setConv((prev) => (prev && prev.id === fresh.id ? { ...prev, otherTyping: fresh.otherTyping } : prev));
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [conv?.id, conv?.isOfficial]));

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

  // Clears the pending "typing…" timeout on unmount/navigation-away — leaving
  // the chat mid-type shouldn't leave a dangling timer.
  useEffect(() => () => {
    if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
  }, []);

  // Keep the last message pinned above the composer as the keyboard opens —
  // the KeyboardAvoidingView above resizes this screen frame-by-frame with
  // the keyboard, but doesn't itself know to keep the list scrolled to the
  // bottom through that resize. No-ops on web (Keyboard events don't fire
  // there, which is fine — react-native-keyboard-controller no-ops too).
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardWillShow', () => {
      flatListRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const showSend = text.trim().length > 0 || selectedAttachment != null;
    Animated.timing(micSendMorph, {
      toValue: showSend ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [text, selectedAttachment, micSendMorph]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  // Seen receipt: id of MY most recent message in the thread (accounting for
  // both the real Clerk userId and the legacy 'me' literal — see myId
  // above). Computed once per messages change, not per row, since
  // lastOwnMessageId scans the whole list. "Seen" only ever renders under
  // this one message — see isSeenReceipt's own doc comment in
  // lib/chatGrouping.ts for why the granularity stops there.
  const lastOwnMsgId = useMemo(
    () => lastOwnMessageId(messages.map(m => ({ ...m, fromId: (m.fromId === MY_USER_ID ? myId : m.fromId) })), myId),
    [messages, myId],
  );

  // API conversations include both participants, and SQL does not guarantee their
  // order. Resolve the seller explicitly so attachment pickers never load the
  // buyer's own catalog.
  const participant = conv?.participants.find(
    (p) => p.accountType === 'seller' && p.userId !== myId && p.userId !== MY_USER_ID,
  ) ?? conv?.participants.find((p) => p.accountType === 'seller')
    ?? conv?.participants.find((p) => p.userId !== myId && p.userId !== MY_USER_ID)
    ?? conv?.participants[0]
    ?? null;
  // Chat details > Nicknames: once set, the nickname replaces the real name
  // everywhere this screen shows the counterpart — header, request-mode
  // profile header, media-sheet copy, etc.
  const displayName = participant?.nickname || participant?.name || params.participantName || 'Unknown';
  // Chat details > Theme: a conversation-level property — same background
  // and bubble colors for both participants. Null = Brandthread's existing
  // default monochrome look, completely unchanged.
  const convTheme = getConversationTheme(conv?.themeId);
  const sentBubbleColor = convTheme?.sentBubble ?? theme.accent;
  const sentTextColor = convTheme?.sentText ?? theme.onAccent;
  const receivedBubbleColor = convTheme?.receivedBubble ?? theme.cardElevated;
  const receivedTextColor = convTheme?.receivedText ?? theme.text;
  const isDisabled = conv?.isFriendshipActive === false;
  // Request mode (Instagram-style): the composer is hidden and replaced with
  // the accept/block/delete bottom panel below until the recipient accepts.
  const isRequestMode = conv?.isRequest === true;
  const canSend = (text.trim().length > 0 || selectedAttachment != null) && !isDisabled && !isSending && !isRequestMode;

  // Presence line under the header name. `isOnline`/`lastSeenAt` are the only
  // presence signals ConversationParticipant carries; the backend does not
  // currently populate them (see socialTypes.ts), so that part is simply
  // omitted. "typing…" IS real for an ordinary conversation now — see
  // conv.otherTyping (PATCH/GET /api/conversations/:id/typing) — populated
  // the same way agentTyping is for the agent thread, just from the OTHER
  // human participant's own typing signal instead of a client-local flag.
  const isAgentConv = !!conv?.isOfficial || participant?.userId === BRANDTHREAD_AGENT_USER_ID;
  const statusLine = isAgentConv
    ? (agentTyping ? 'typing…' : 'AI assistant')
    : (conv?.otherTyping ? 'typing…' : (participant?.isOnline ? 'Active now' : statusLineFor(participant)));
  // react-native-web doesn't fill in a real top safe-area inset (no notch/
  // dynamic-island polyfill), so insets.top reads 0 on web and the header
  // clipped under the dynamic island in a device-frame screenshot — same
  // fix already applied to app/(buyer)/discover.tsx and inbox.tsx.
  const headerTopPad = Platform.OS === 'web' ? 67 : insets.top;
  // Same reasoning at the bottom: react-native-web never fills in a real
  // bottom safe-area inset (no home-indicator polyfill), so insets.bottom
  // reads 0 on web and the composer sat flush against the viewport edge —
  // a flat floor, same pattern as headerTopPad above.
  const composerBottomPad = Platform.OS === 'web' ? 16 : insets.bottom + SP.sm;

  // Show "View store" button for any seller conversation (resolved or pre-created)
  const convType = conv?.type ?? params.type ?? '';
  const isSellerConv = convType === 'buyer_to_seller'
    || convType === 'buyer_to_seller_product'
    || convType === 'buyer_to_seller_order';
  const sellerUserId = participant?.userId ?? params.participantId ?? '';

  // The Thread Cash entry point always renders (once the feature flag is
  // on) — it never fully disappears for a non-mutual-follow counterpart —
  // but stays disabled with an explanation until we can confirm mutual
  // follow. This is an affordance check only; see the state's own comment.
  useEffect(() => {
    let cancelled = false;
    if (!threadCashSendEnabled || !sellerUserId) {
      setThreadCashMutual(null);
      return;
    }
    // Preview conversations have no real backend to check against — the
    // whole Thread Cash flow must be clickable end-to-end there, so treat
    // them as an already-confirmed mutual follow.
    if (isPreviewConversationId(conv?.id ?? '')) {
      setThreadCashMutual(true);
      return;
    }
    api.social.status(sellerUserId)
      .then((status) => { if (!cancelled) setThreadCashMutual(status.isMutual); })
      .catch(() => { if (!cancelled) setThreadCashMutual(false); });
    return () => { cancelled = true; };
  }, [threadCashSendEnabled, sellerUserId, conv?.id, api]);
  // UI-only: this must never surface a "checking…" string. While the check
  // is still pending (threadCashMutual === null) a tap is a silent no-op —
  // only a confirmed non-mutual-follow result shows an explainer.
  const threadCashDisabledReason = `You can send Thread Cash to people who follow you back`;

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
    void startCall({
      conversationId: conv.id,
      surface: 'buyer',
      mode,
      peer: {
        id: p?.userId ?? '',
        name: displayName,
        initials: p?.initials ?? '?',
        color: p?.color ?? theme.accent,
        avatarUri: p?.avatarUri ?? null,
      },
      me: { id: myId, name: MY_NAME, initials: MY_INITIALS, color: theme.accent },
    });
  }

  // ── Other-participant profile ─────────────────────────────────────────────────

  // Still referenced elsewhere (e.g. avatar taps) as a direct link straight
  // to their profile, distinct from openChatDetails() below (chat details,
  // reached via the header tap once a conversation is no longer a pending
  // request). #220 moved the request-mode "View profile" pill itself to a
  // direct router.push to /seller-profile — see the pill's onPress below.
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

  // ── Chat details ───────────────────────────────────────────────────────────────

  function openChatDetails() {
    if (!conv || !participant) return;
    const qs = new URLSearchParams({
      id: conv.id, role: 'buyer',
      isBlocked: messaging.blockedByMe ? '1' : '0',
      participantUserId: participant.userId,
      participantName: participant.name,
      participantHandle: participant.handle ?? '',
      participantInitials: participant.initials ?? '',
      participantColor: participant.color ?? pickAvatarColor(participant.userId ?? participant.name),
      participantAvatarUri: participant.avatarUri ?? '',
      participantNickname: participant.nickname ?? '',
    });
    router.push(('/conversation-details?' + qs.toString()) as never);
  }

  // Theme system line's "Change" — reopens the picker directly (Instagram's
  // own behavior), rather than just returning to chat details.
  function openThemePicker() {
    if (!conv || !participant) return;
    const qs = new URLSearchParams({
      id: conv.id, role: 'buyer', openTheme: '1',
      participantUserId: participant.userId,
      participantName: participant.name,
      participantInitials: participant.initials ?? '',
      participantColor: participant.color ?? pickAvatarColor(participant.userId ?? participant.name),
      participantAvatarUri: participant.avatarUri ?? '',
    });
    router.push(('/conversation-details?' + qs.toString()) as never);
  }

  // Disappearing-messages system line's "Change"/"Turn on" — a direct
  // quick-toggle (per the task's own brief), not a navigation.
  async function handleQuickToggleDisappearing() {
    if (!conv) return;
    const next = !conv.disappearingEnabled;
    hapticToggle();
    try {
      if (isPreviewConversationId(conv.id)) {
        const localMsg: Message = {
          id: `local-disappearing-${Date.now()}`, conversationId: conv.id,
          fromId: myId, fromName: 'You', fromInitials: 'Y', fromColor: theme.accent,
          text: '', attachment: { type: 'system', title: next ? 'disappearing_on' : 'disappearing_off', meta: { actorId: myId } },
          reactions: [], status: 'sent', ts: Date.now(), deletedForMe: false,
        };
        setPreviewConversationDisappearing(conv.id, next);
        appendPreviewMessage(conv.id, localMsg);
        setConv({ ...conv, disappearingEnabled: next });
        setMessages((prev) => [...prev, localMsg]);
      } else {
        const { message } = await setConversationDisappearing(conv.id, next);
        setConv({ ...conv, disappearingEnabled: next });
        setMessages((prev) => [...prev, message]);
      }
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      Alert.alert('Couldn’t update disappearing messages', apiErrorMessage(e, 'Please try again.'));
    }
  }

  // ── Request mode: accept / delete / block ───────────────────────────────────
  // Real work happens through lib/requestActions.ts, which is preview-aware —
  // this is the single fix for the app owner's "Accept does nothing" report:
  // the old inbox.tsx `acceptRequest` called the real API unconditionally, so
  // every one of the 3 seeded preview requests (fake `preview-conversation-*`
  // ids) 404'd against the real backend and silently failed.

  async function handleAcceptRequest() {
    if (!conv || requestActionLoading) return;
    hapticPrimaryAction();
    setRequestActionLoading(true);
    const previousConv = conv;
    try {
      await acceptConversationRequest(conv.id, api);
      hapticSuccessAction();
      setConv({ ...previousConv, isRequest: false });
      // Composer takes the bottom panel's place the instant isRequestMode
      // flips false (see the render below) — hand it the keyboard right
      // away, matching "keyboard ready" in the spec.
      setTimeout(() => textInputRef.current?.focus(), 50);
    } catch (e) {
      // Roll back: the panel stays up and Accept is tappable again.
      setConv(previousConv);
      Alert.alert('Couldn’t accept request', apiErrorMessage(e, 'Please check your connection and try again.'));
    } finally {
      setRequestActionLoading(false);
    }
  }

  function handleDeleteRequest() {
    if (!conv) return;
    hapticDestructiveConfirm();
    const conversationId = conv.id;
    const name = displayName;
    scheduleDeleteConversationRequest(conversationId, api);
    showUndo({
      message: `Deleted request from ${name}`,
      undo: () => undoDeleteConversationRequest(conversationId),
      // Match the toast's own visible window to the real undo grace period —
      // see the same fix (and its doc comment) in inbox.tsx's
      // deleteRequestConversation.
      durationMs: DELETE_GRACE_MS,
    });
    goBackOr(router);
  }

  async function handleBlockRequest() {
    if (!conv || !participant) return;
    const confirmed = await confirmDestructiveActionSheet({
      title: `Block ${participant.name}?`,
      message: 'They won’t be able to find your profile, see your posts, comments or stories, or message you. You won’t see theirs either. They aren’t notified.',
      confirmLabel: 'Block',
    });
    if (!confirmed) return;
    hapticDestructiveConfirm();
    try {
      await blockConversationRequestUser(conv.id, participant);
      goBackOr(router);
    } catch (e) {
      Alert.alert('Couldn’t block', apiErrorMessage(e, 'Please check your connection and try again.'));
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
    const token = ++mediaUploadTokenRef.current;
    // Stage the REAL picked photo(s) immediately, using their local URIs —
    // so the composer shows an actual thumbnail (not a placeholder icon)
    // while the upload is in flight. meta.uploading drives MediaUploadThumb's
    // ring overlay; it's cleared once the real upload resolves below.
    const localUris = result.assets.map((a) => a.uri);
    setSelectedAttachment({
      type: 'image', uri: localUris[0],
      title: localUris.length > 1 ? `${localUris.length} photos` : 'Photo',
      meta: { photoUris: JSON.stringify(localUris), uploading: 'true' },
    });
    setIsUploading(true);
    try {
      const urls: string[] = [];
      for (const asset of result.assets) {
        if (!asset.base64) continue;
        urls.push(await uploadMedia(asset.base64, 'image/jpeg', 'jpg'));
      }
      if (mediaUploadTokenRef.current !== token) return; // superseded/cancelled
      if (!urls.length) { setSelectedAttachment(null); return; }
      setSelectedAttachment({
        type: 'image', uri: urls[0],
        title: urls.length > 1 ? `${urls.length} photos` : 'Photo',
        meta: { photoUris: JSON.stringify(urls) },
      });
    } catch {
      if (mediaUploadTokenRef.current === token) {
        setSelectedAttachment(null);
        Alert.alert('Upload failed', 'Could not upload. Please try again.');
      }
    }
    finally { if (mediaUploadTokenRef.current === token) setIsUploading(false); }
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
    const token = ++mediaUploadTokenRef.current;
    const durationLabel = String(Math.round((asset.duration ?? 0) / 1000));
    setSelectedAttachment({
      type: 'video', title: 'Video clip',
      meta: { duration: durationLabel, uploading: 'true' },
    });
    setIsUploading(true);
    try {
      const ext = (asset.uri.split('.').pop() ?? 'mp4').replace(/\?.*/, '');
      const url = await uploadMedia(asset.base64, 'video/mp4', ext);
      if (mediaUploadTokenRef.current !== token) return; // superseded/cancelled
      setSelectedAttachment({
        type: 'video', uri: url,
        title: 'Video clip',
        meta: { duration: durationLabel },
      });
    } catch {
      if (mediaUploadTokenRef.current === token) {
        setSelectedAttachment(null);
        Alert.alert('Upload failed', 'Could not upload video. Please try again.');
      }
    }
    finally { if (mediaUploadTokenRef.current === token) setIsUploading(false); }
  }

  // ── Voice recording ────────────────────────────────────────────────────────────
  // Instagram DM "Sending an audio message" (mobbin.com/flows/125d5a4c-31d5-
  // 4b05-8f08-2de2c6860c23): recording sends the voice note directly the
  // instant it's released/tapped-send — it doesn't stage into the composer
  // like a photo/video attachment does. See docs/dm-flows.md.
  async function handleVoiceRecorded(result: { uri: string; durationSec: number; waveform: number[] }) {
    if (!conv) return;
    hapticSuccessAction();
    const attachment: MessageAttachment = {
      type: 'voice',
      uri: result.uri,
      title: 'Voice message',
      meta: { duration: String(result.durationSec), waveform: JSON.stringify(result.waveform) },
    };
    // Preview conversations have no real backend to post to — append a
    // local mock message directly, the same way Thread Cash / the agent
    // reply flow above does.
    if (isPreviewConversationId(conv.id)) {
      setMessages((prev) => [...prev, {
        id: `local-voice-${Date.now()}`,
        conversationId: conv.id,
        fromId: myId,
        fromName: 'You',
        fromInitials: 'Y',
        fromColor: theme.accent,
        text: '',
        attachment,
        reactions: [],
        status: 'sent',
        ts: Date.now(),
        deletedForMe: false,
      }]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      return;
    }
    setIsSending(true);
    try {
      await sendMessage(conv.id, '', attachment);
      const msgs = await getMessages(conv.id);
      setMessages(msgs);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      Alert.alert('Voice message not sent', apiErrorMessage(e, 'Please check your connection and try again.'));
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

  // ── Reactions ──────────────────────────────────────────────────────────────────

  function myReaction(msg: Message): ReactionType | null {
    return myReactionIn(msg.reactions, myId) ?? myReactionIn(msg.reactions, MY_USER_ID);
  }

  // Optimistic add/remove: the tapped emoji shows immediately (and the row's
  // own selection state updates), then the real network call runs in the
  // background — rolled back to the pre-tap message list if it fails, so a
  // reaction never silently "sticks" client-side when the server rejected it.
  async function handleReact(msg: Message, type: ReactionType) {
    // Defense in depth alongside the request-mode guards on the long-press
    // overlay and double-tap-to-like above: reacting is engagement gated
    // behind Accept, so this single choke-point for every reaction mutation
    // (long-press menu, double-tap-like, and the existing-chip re-tap below)
    // refuses to fire while the request is still pending.
    if (!conv || isRequestMode) return;
    hapticSelection();
    const prevMessages = messages;
    const { next } = applyOptimisticReaction(msg.reactions, myId, MY_NAME, type);
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, reactions: next } : m)));
    try {
      if (isPreviewConversationId(conv.id)) {
        reactToPreviewMessage(conv.id, msg.id, type, myId, MY_NAME);
        return;
      }
      await addReaction(conv.id, msg.id, type);
    } catch {
      setMessages(prevMessages);
    }
  }

  function triggerDoubleTapLike(msg: Message, pageX: number, pageY: number) {
    hapticSuccessAction();
    setLikeBurst({ key: Date.now(), x: pageX, y: pageY });
    void handleReact(msg, 'like');
  }

  function handleBubblePress(msg: Message, event: { nativeEvent: { pageX: number; pageY: number } }) {
    // Same request-mode gate as the long-press reaction overlay just below —
    // double-tap-to-like also routes into handleReact(), which fires a real
    // reaction API call for a non-preview conversation id.
    if (isRequestMode) return;
    const now = Date.now();
    if (lastTapRef.current.id === msg.id && now - lastTapRef.current.at < DOUBLE_TAP_MS) {
      lastTapRef.current = { id: '', at: 0 };
      triggerDoubleTapLike(msg, event.nativeEvent.pageX, event.nativeEvent.pageY);
    } else {
      lastTapRef.current = { id: msg.id, at: now };
    }
  }

  // ── Attachment renderer (handles image / video / voice inline) ────────────────

  function renderAttachment(att: MessageAttachment, isOwn: boolean) {
    if (att.type === 'image') {
      let uris: string[] = [];
      try { uris = JSON.parse(att.meta?.photoUris ?? '[]'); } catch {}
      if (!uris.length && att.uri) uris = [att.uri];
      if (!uris.length) return null;
      return (
        <View style={s.photoGrid}>
          {uris.slice(0, 4).map((uri, idx) => (
            <PressableScale rippleEnabled={false}
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
          onViewTranscription={() => {
            setTranscriptionToast(true);
            setTimeout(() => setTranscriptionToast(false), 2600);
          }}
        />
      );
    }
    // 'thread_cash', 'quick_replies', 'agent_card', 'product' and 'order'
    // are all handled in renderItem() before this function is ever called
    // for them — they're standalone rows, not content that belongs inside a
    // chat bubble (see the "Standalone product/order card" comment on
    // renderItem's own product/order branch for why).
    // Default: post / profile card
    return (
      <PressableScale rippleEnabled={false}
        style={s.attachCard}
        activeOpacity={att.type === 'post' ? 0.7 : 1}
        onPress={() => {
          if (att.type === 'post') {
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
        {att.type === 'post' && (
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

  /** Sends one freeform (or quick-reply) message to the Brandthread Agent.
   *  Real conversations hit the real AI endpoint; a seeded preview
   *  conversation (no backend to call) uses a canned reply matching the same
   *  tone/content instead — see lib/agentChat.ts. */
  async function sendToAgent(messageText: string) {
    if (!conv) return;
    const optimistic: Message = {
      id: `local-${Date.now()}`,
      conversationId: conv.id,
      fromId: MY_USER_ID,
      fromName: 'You',
      fromInitials: 'Y',
      fromColor: MY_COLOR,
      text: messageText,
      reactions: [],
      status: 'sent',
      ts: Date.now(),
      deletedForMe: false,
    };
    setMessages((prev) => [...prev, optimistic]);
    setAgentTyping(true);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);

    if (isPreviewConversationId(conv.id)) {
      // No backend reachable in preview — canned reply, paced like a real
      // reply so the typing indicator reads naturally.
      const { text: replyText, cardKind } = cannedAgentReply(messageText);
      await new Promise((resolve) => setTimeout(resolve, 900 + Math.random() * 700));
      setAgentTyping(false);
      setMessages((prev) => [...prev, {
        id: `local-agent-${Date.now()}`,
        conversationId: conv.id,
        fromId: participant?.userId ?? BRANDTHREAD_AGENT_USER_ID,
        fromName: displayName,
        fromInitials: participant?.initials ?? 'BT',
        fromColor: participant?.color ?? '#0A0A0B',
        text: replyText,
        attachment: cardKind
          ? { type: 'agent_card', title: cardKind === 'thread_cash' ? 'How Thread Cash works' : 'Go to Discover', meta: { cardKind, deepLink: cardKind === 'thread_cash' ? '/thread-cash' : '/(buyer)/discover' } }
          : undefined,
        reactions: [],
        status: 'read',
        ts: Date.now(),
        deletedForMe: false,
      }]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      return;
    }

    try {
      // Best-effort short timeout so a genuinely unreachable API (e.g. dev
      // web preview with no backend) still falls back gracefully instead of
      // hanging the typing indicator.
      const result = await Promise.race([
        api.brandthreadAgent.sendMessage({ conversationId: conv.id, text: messageText }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
      ]);
      const msgs = await getMessages(conv.id);
      setMessages(msgs);
      void result;
    } catch {
      const { text: replyText } = cannedAgentReply(messageText);
      setMessages((prev) => [...prev.filter((m) => m.id !== optimistic.id), optimistic, {
        id: `local-agent-fallback-${Date.now()}`,
        conversationId: conv.id,
        fromId: participant?.userId ?? BRANDTHREAD_AGENT_USER_ID,
        fromName: displayName,
        fromInitials: participant?.initials ?? 'BT',
        fromColor: participant?.color ?? '#0A0A0B',
        text: replyText,
        reactions: [],
        status: 'read',
        ts: Date.now(),
        deletedForMe: false,
      }]);
    } finally {
      setAgentTyping(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }

  function sendQuickReply(reply: AgentQuickReply) {
    hapticSelection();
    void sendToAgent(reply.value);
  }

  /** Real-time "X is typing…": tells the server I'm composing (once per burst
   *  of keystrokes, not per keystroke) and schedules clearing it after a
   *  short pause — same idea as any chat app's typing indicator, just
   *  polled instead of pushed (see PATCH /api/conversations/:id/typing).
   *  No-ops for a seeded preview thread (no real backend/counterpart) and
   *  the agent thread (its "typing…" is the AI's own, client-driven —
   *  see sendToAgent/setAgentTyping). */
  function sendTypingSignal(hasText: boolean) {
    if (!conv?.id || isPreviewConversationId(conv.id) || conv.isOfficial) return;
    if (typingClearTimerRef.current) { clearTimeout(typingClearTimerRef.current); typingClearTimerRef.current = null; }
    if (hasText) {
      if (!isTypingSentRef.current) {
        isTypingSentRef.current = true;
        api.conversations.setTyping(conv.id, true).catch(() => {});
      }
      typingClearTimerRef.current = setTimeout(() => {
        isTypingSentRef.current = false;
        if (conv?.id) api.conversations.setTyping(conv.id, false).catch(() => {});
      }, 3000);
    } else if (isTypingSentRef.current) {
      isTypingSentRef.current = false;
      api.conversations.setTyping(conv.id, false).catch(() => {});
    }
  }

  function handleChangeText(next: string) {
    setText(next);
    sendTypingSignal(next.trim().length > 0);
  }

  async function handleSend() {
    if (!conv || !canSend) return;
    const t = text.trim();
    const att = selectedAttachment;
    const replyingTo = replyTo;
    setText('');
    setSelectedAttachment(null);
    setReplyTo(null);
    sendTypingSignal(false);

    if (isAgentConv && !att && !replyingTo) {
      await sendToAgent(t);
      return;
    }

    // Preview conversations have no real backend to post to (see the other
    // isPreviewConversationId(conv.id) branches throughout this file, e.g.
    // handleVoiceRecorded/handleQuickToggleDisappearing) — this covers the
    // remaining case those didn't: a plain text/attachment send that also
    // carries a reply (or an attachment, so it skipped the agent branch
    // above). Appends locally, with the same replyToId/replyPreview shape
    // the real API returns, so swipe-to-reply is fully demoable in preview.
    if (isPreviewConversationId(conv.id)) {
      const localMsg: Message = {
        id: `local-${Date.now()}`,
        conversationId: conv.id,
        fromId: myId,
        fromName: 'You',
        fromInitials: MY_INITIALS,
        fromColor: theme.accent,
        text: t,
        attachment: att ?? undefined,
        replyToId: replyingTo?.id,
        replyPreview: replyingTo?.text,
        replyToAuthorName: replyingTo?.fromName,
        reactions: [],
        status: 'sent',
        ts: Date.now(),
        deletedForMe: false,
      };
      appendPreviewMessage(conv.id, localMsg);
      setMessages((prev) => [...prev, localMsg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      // Preview-only: the other (simulated) side sends back exactly one
      // short reply so the thread reads as live during a demo — see
      // previewAutoReplyText's own doc comment in lib/previewInbox.ts.
      const convIdAtSend = conv.id;
      setTimeout(() => {
        const reply: Message = {
          id: `local-reply-${Date.now()}`,
          conversationId: convIdAtSend,
          fromId: participant?.userId ?? conv.participants[0]?.userId ?? 'preview-participant',
          fromName: displayName,
          fromInitials: participant?.initials ?? 'B',
          fromColor: participant?.color ?? theme.cardElevated,
          text: previewAutoReplyText(),
          reactions: [],
          status: 'sent',
          ts: Date.now(),
          deletedForMe: false,
        };
        appendPreviewMessage(convIdAtSend, reply);
        setMessages((prev) => [...prev, reply]);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      }, previewAutoReplyDelayMs());
      return;
    }

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
    // Alert.alert() with a button array is a silent no-op on web (see
    // components/ui/ActionSheet.tsx's header comment) — this left the
    // header "..." menu completely dead in the web preview. showActionSheet
    // takes the identical { text, onPress, style }[] shape and renders a
    // real themed bottom sheet on every platform.
    showActionSheet('Options', undefined, [
      {
        text: 'Archive conversation',
        onPress: async () => {
          // A seeded preview conversation has no real backend record to
          // archive against (archiveConversation() re-fetches the real
          // conversation list first, which would 401 with no signed-in
          // user) — just navigate back.
          if (conv && !isPreviewConversationId(conv.id)) {
            try {
              const { archiveConversation } = await import('@/services/socialService');
              await archiveConversation(conv.id);
            } catch {
              // Best-effort — the conversation simply stays un-archived.
            }
          }
          goBackOr(router);
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

  /** A short label for the elevated bubble clone when a long-pressed message
   *  has no plain text (an image/voice/product card etc.) — the overlay only
   *  needs to read recognizably as "the same bubble", not fully re-render
   *  every attachment type. */
  function sheetAttachmentLabel(msg: Message): string {
    switch (msg.attachment?.type) {
      case 'image': return 'Photo';
      case 'video': return 'Video';
      case 'voice': return 'Voice message';
      case 'product': return msg.attachment.title ?? 'Product';
      case 'order': return msg.attachment.title ?? 'Order';
      case 'post': return msg.attachment.title ?? 'Post';
      default: return '';
    }
  }

  function closeMessageSheet() {
    setActiveSheetMsg(null);
    setReactionAnchor(null);
  }

  /** Measures the long-pressed bubble's window position, then opens the
   *  Glass reaction overlay anchored to it. */
  function openReactionOverlay(msg: Message) {
    hapticSelection();
    const node = bubbleAnchorRefs.current[msg.id];
    if (!node) { setActiveSheetMsg(msg); return; }
    node.measureInWindow((x, y, width, height) => {
      setReactionAnchor({ x, y, width, height });
      setActiveSheetMsg(msg);
    });
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
    if (!conv || !msg) return;
    // A seeded preview conversation has no real backend record to delete
    // against — just drop it from local state instead of 401-ing.
    if (isPreviewConversationId(conv.id)) {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, deletedForMe: true } : m)));
      return;
    }
    deleteMessageForMe(conv.id, msg.id)
      .then(() => getMessages(conv.id).then(setMessages))
      .catch(() => {});
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
      // Plain small gray centered text, like Instagram/Threads — no pill.
      return (
        <View style={s.dateSeparatorWrap}>
          <Text style={s.dateSeparatorText}>{item.date} {formatTime(item.ts)}</Text>
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

    if (item.type === 'call_log') {
      return (
        <View style={[s.msgOuter, { justifyContent: 'flex-start', marginTop: 12 }]}>
          <CallLogBubble entry={item.entry} onCallBack={() => handleStartCall(item.entry.mode)} />
        </View>
      );
    }

    const { msg, isFirstInGroup, isLastInGroup } = item;
    const isOwn = msg.fromId === myId || msg.fromId === MY_USER_ID;

    // Chat details > Theme / Disappearing messages: a centered system line,
    // not a bubble — "You changed the theme to [Name]. Change" / "You turned
    // on/off disappearing messages. Change"/"Turn on".
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

    // Group reactions by kind for the chip summary under the bubble.
    const reactionEntries = groupReactionCounts(msg.reactions);
    const mine = myReaction(msg);
    const topReactor = msg.reactions[msg.reactions.length - 1];

    const isRead = msg.status === 'read' || !!msg.readAt;

    // Quick replies and a Thread Cash send are their own standalone rows —
    // not chat text, so they never get the colored/padded bubble treatment
    // (a gray "bubble around" a button row or a payment card just reads as
    // ugly, cramped chrome). Handled before the normal bubble render below.
    if (msg.attachment?.type === 'quick_replies') {
      const options = parseQuickReplies(msg.attachment.meta?.optionsJson);
      return (
        <View style={[s.quickReplyOuterRow, { marginTop: isFirstInGroup ? 12 : 2 }]}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // Starts flush with the bubble column (contentInset-style left
            // padding) instead of being clipped or right-anchored — nothing
            // is cut off at rest, and it scrolls right if it overflows.
            contentContainerStyle={s.quickReplyScrollContent}
            ref={(ref) => { quickReplyScrollRefs.current[msg.id] = ref; }}
          >
            {options.map((opt) => (
              <View key={opt.label} style={s.quickReplyChipWrap}>
                <Chip label={opt.label} selected={false} onPress={() => sendQuickReply(opt)} testID={`quick-reply-${opt.label}`} bounce={false} variant="quickReply" />
              </View>
            ))}
          </ScrollView>
        </View>
      );
    }

    // An agent info/deep-link card (e.g. "How Thread Cash works") is the
    // same "full-width card, coin-in-circle icon, bold title, subtitle,
    // chevron" treatment, standalone — not squeezed into the bubble along
    // with whatever text follows it in the same message.
    if (msg.attachment?.type === 'agent_card') {
      const att = msg.attachment;
      const deepLink = att.meta?.deepLink;
      const cardKind = att.meta?.cardKind;
      return (
        <View style={{ marginTop: isFirstInGroup ? 12 : 2, paddingLeft: BUBBLE_COLUMN_LEFT, paddingRight: SP.md }}>
          <PressableScale rippleEnabled={false}
            bounce={false}
            style={[s.agentCardOuter, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}
            activeOpacity={deepLink ? 0.7 : 1}
            onPress={() => { if (deepLink) router.push(deepLink as never); }}
          >
            <View style={[s.agentCardIconCircle, { backgroundColor: theme.accentDim }]}>
              {cardKind === 'thread_cash' ? (
                <ThreadCashBillIcon size={18} />
              ) : (
                <Feather
                  name={cardKind === 'product' ? 'shopping-bag' : cardKind === 'profile' ? 'user' : 'compass'}
                  size={18}
                  color={theme.accent}
                />
              )}
            </View>
            <View style={{ flex: 1, marginLeft: SP.sm }}>
              {att.title ? <Text style={s.attachTitle} numberOfLines={1}>{att.title}</Text> : null}
              {att.subtitle ? <Text style={s.attachSubtitle} numberOfLines={2}>{att.subtitle}</Text> : null}
            </View>
            {deepLink && <Feather name="chevron-right" size={ICON.xs} color={theme.muted} />}
          </PressableScale>
          {msg.text ? (
            <View style={{ flexDirection: 'row', justifyContent: isOwn ? 'flex-end' : 'flex-start', marginTop: 4 }}>
              <View style={{ maxWidth: BUBBLE_MAX }}>
                <View style={[s.bubble, { backgroundColor: isOwn ? sentBubbleColor : receivedBubbleColor, alignSelf: isOwn ? 'flex-end' : 'flex-start' }]}>
                  <Text style={[s.msgText, { color: isOwn ? sentTextColor : receivedTextColor }]}>{msg.text}</Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      );
    }

    if (msg.attachment?.type === 'thread_cash') {
      const transferId = msg.attachment.meta?.transferId ?? '';
      const senderId = msg.attachment.meta?.senderId ?? '';
      const amountCents = Number(msg.attachment.meta?.amountCents ?? 0);
      const status = threadCashOverrides[transferId] ?? ((msg.attachment.meta?.status as ThreadCashTransferStatus) ?? 'pending');
      return (
        <View style={{ marginTop: isFirstInGroup ? 12 : 2, paddingLeft: BUBBLE_COLUMN_LEFT, paddingRight: SP.md }}>
          <ThreadCashMessageCard
            amountCents={amountCents}
            note={msg.attachment.meta?.note || null}
            status={status}
            isRecipient={senderId !== myId}
            isSender={senderId === myId}
            onClaim={async () => {
              try {
                await api.threadCash.claim({ transferId });
                setThreadCashOverrides((prev) => ({ ...prev, [transferId]: 'claimed' }));
                celebrateThreadCash({ amount: amountCents, from: displayName });
              } catch (e: any) {
                Alert.alert('Could not claim', e?.message ?? 'Please try again.');
                throw e;
              }
            }}
            onCancel={senderId === myId ? async () => {
              try {
                await api.threadCash.cancel({ transferId });
                setThreadCashOverrides((prev) => ({ ...prev, [transferId]: 'cancelled' }));
              } catch (e: any) {
                Alert.alert('Could not cancel', e?.message ?? 'Please try again.');
                throw e;
              }
            } : undefined}
          />
          {/* A free-text note sent alongside the transfer renders as its own
              ordinary chat bubble underneath the card, never merged into it. */}
          {msg.text ? (
            <View style={{ flexDirection: 'row', justifyContent: isOwn ? 'flex-end' : 'flex-start', marginTop: 4 }}>
              <View style={{ maxWidth: BUBBLE_MAX }}>
                <View style={[s.bubble, { backgroundColor: isOwn ? sentBubbleColor : receivedBubbleColor, alignSelf: isOwn ? 'flex-end' : 'flex-start' }]}>
                  <Text style={[s.msgText, { color: isOwn ? sentTextColor : receivedTextColor }]}>{msg.text}</Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      );
    }

    // Standalone product/order card (Dev's chat-card-redesign feedback) —
    // NEVER rendered inside the text-message bubble. Bubbles are only for
    // actual text, so this uses the exact same msgOuter row + avatar +
    // left/right alignment a text bubble uses just below, but swaps the
    // bubble for the free-floating ChatAttachmentCard (no border, no bubble
    // wrapper, one tap target for the whole card). See
    // components/chat/ChatAttachmentCard.tsx.
    if (msg.attachment?.type === 'product' || msg.attachment?.type === 'order') {
      const att = msg.attachment;
      const isProduct = att.type === 'product';
      const unavailable = isProduct && att.meta?.unavailable === 'true';
      const orderId = att.meta?.orderId;
      const rawStatus = att.meta?.status;
      const uiStatus = !isProduct && rawStatus ? dbStatusToOrderStatus(rawStatus) : null;
      const trackingNumber = att.meta?.trackingNumber;
      const trackingUrl = !isProduct && trackingNumber ? carrierTrackingUrl(att.meta?.carrier, trackingNumber) : null;
      const footerLabel = isProduct ? 'View' : (trackingUrl ? 'Track' : 'View');
      const footerIcon = !isProduct && trackingUrl ? 'external-link' : 'chevron-right';
      const accessibilityLabel = isProduct
        ? `${att.title ?? 'Product'}, ${unavailable ? 'no longer available' : att.subtitle ?? ''}, View`
        : `${att.title ?? 'Order'}${uiStatus ? `, ${orderStatusBadgeLabel(uiStatus)}` : ''}, ${footerLabel}`;
      return (
        <View style={[s.msgOuter, { justifyContent: isOwn ? 'flex-end' : 'flex-start', marginTop: isFirstInGroup ? 12 : 2 }]}>
          {!isOwn && (
            isLastInGroup ? (
              isAgentConv ? (
                <View style={[s.msgAvatar, s.msgAvatarOfficial, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <BrandthreadLogo size={16} />
                </View>
              ) : (
                <View style={[s.msgAvatar, { backgroundColor: msg.fromColor }]}>
                  <Text style={s.msgAvatarInitials}>{msg.fromInitials}</Text>
                </View>
              )
            ) : <View style={s.msgAvatarSpacer} />
          )}
          <ChatAttachmentCard
            theme={theme}
            isMe={isOwn}
            imageUri={isProduct ? att.uri : undefined}
            icon={isProduct ? 'shopping-bag' : 'package'}
            iconColor={theme.accent}
            title={att.title || (isProduct ? 'Product' : 'Order')}
            priceLabel={isProduct ? att.subtitle : undefined}
            statusBadge={!isProduct && uiStatus ? (
              <StatusBadge label={orderStatusBadgeLabel(uiStatus)} variant={orderStatusBadgeVariant(uiStatus)} small />
            ) : (!isProduct && !uiStatus && att.subtitle ? (
              <Text style={[s.attachSubtitle, { marginTop: 0 }]} numberOfLines={1}>{att.subtitle}</Text>
            ) : undefined)}
            unavailable={unavailable}
            footerLabel={footerLabel}
            footerIcon={footerIcon}
            testID={isProduct ? 'product-card-attachment' : 'order-card-attachment'}
            accessibilityLabel={accessibilityLabel}
            onPress={() => {
              if (isProduct) {
                const pid = att.meta?.productId;
                if (pid) router.push(('/buyer-product-detail?productId=' + pid) as never);
              } else if (trackingUrl) {
                Linking.openURL(trackingUrl).catch(() => {});
              } else if (orderId) {
                router.push(('/buyer-order-detail?id=' + orderId) as never);
              } else {
                router.push('/(buyer)/orders' as never);
              }
            }}
          />
        </View>
      );
    }

    return (
      <View style={[s.msgOuter, { justifyContent: isOwn ? 'flex-end' : 'flex-start', marginTop: isFirstInGroup ? 12 : 2 }]}>
        {/* Other-user avatar — only on the last bubble of a run, vertically
            aligned with it (s.msgOuter is alignItems: 'flex-end'). */}
        {!isOwn && (
          isLastInGroup ? (
            isAgentConv ? (
              <View style={[s.msgAvatar, s.msgAvatarOfficial, { backgroundColor: theme.background, borderColor: theme.border }]}>
                <BrandthreadLogo size={16} />
              </View>
            ) : (
              <View style={[s.msgAvatar, { backgroundColor: msg.fromColor }]}>
                <Text style={s.msgAvatarInitials}>{msg.fromInitials}</Text>
              </View>
            )
          ) : <View style={s.msgAvatarSpacer} />
        )}

        <View
          style={{ maxWidth: BUBBLE_MAX }}
          collapsable={false}
          ref={(r) => { bubbleAnchorRefs.current[msg.id] = r; }}
        >
          {/* Bubble — wrapped in a short swipe-right-to-reply gesture (see
              SwipeToReplyBubble's own doc comment for the tap/long-press
              disambiguation, borrowed from components/inbox/InboxSwipeRow.tsx). */}
          <SwipeToReplyBubble
            testID={`conversation-bubble-swipe-${msg.id}`}
            disabled={isDisabled || isRequestMode || messaging.blockedByMe || messaging.unavailable}
            iconColor={theme.muted}
            iconBg={theme.cardElevated}
            onReply={() => { setReplyTo(msg); }}
          >
          <PressableScale rippleEnabled={false}
            bounce={false}
            testID={`conversation-bubble-${msg.id}`}
            activeOpacity={0.88}
            onPress={(e) => handleBubblePress(msg, e)}
            // Reacting is a form of engagement Instagram gates behind
            // Accept, same as swipe-to-reply just above (SwipeToReplyBubble's
            // own `disabled={isRequestMode}`) and the hidden composer below —
            // without this, long-pressing a not-yet-accepted request's
            // message would still fire a real POST /reactions call (see
            // handleReact's `await addReaction(conv.id, ...)` for a non-
            // preview conversation id), silently exposing an action the
            // request-mode UI otherwise fully hides.
            onLongPress={isRequestMode ? undefined : () => openReactionOverlay(msg)}
            delayLongPress={280}
            // Voice and (multi-photo) image attachments each render their
            // own interactive control inside this bubble
            // (VoiceMessageBubble's play/scrub/speed buttons; each photo
            // cell below is its own PressableScale, opening the full-screen
            // MediaViewer — item 74 found this same class of bug already
            // present for image attachments and fixed it here). Product and
            // order cards no longer render inside this bubble at all — see
            // renderItem's standalone product/order branch above.
            // On web, accessibilityRole="button" makes react-native-web
            // render an actual <button>, and a <button> cannot legally
            // contain other interactive controls (the HTML nested-button
            // rule) — so those controls silently break the DOM tree even
            // though there's only ever one logical tap target per row. Drop
            // the role for both attachment kinds so the bubble renders as a
            // plain, still fully tappable/long-pressable <div> instead.
            accessibilityRole={
              msg.attachment?.type === 'voice'
              || msg.attachment?.type === 'image'
                ? 'none' : 'button'
            }
            accessibilityLabel={isOwn ? 'Your message' : `Message from ${msg.fromName}`}
            accessibilityHint="Double tap to like, or touch and hold for more actions"
            style={[
              s.bubble,
              {
                backgroundColor: isOwn ? sentBubbleColor : receivedBubbleColor,
                // IG-style grouping: the corner touching an adjacent bubble
                // in the same group (same side as the avatar column) is
                // reduced to 6pt; every outer corner stays the full 18pt.
                // Shared with app/seller-conversation.tsx via chatGrouping.ts
                // so a grouped run looks identical from both sides of the
                // same thread.
                ...groupCornerRadii(isOwn, isFirstInGroup, isLastInGroup, RADIUS.lg),
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
                  {msg.replyPreview ?? messagePreviewText(messages.find(m => m.id === msg.replyToId) ?? {})}
                </Text>
              </View>
            ) : null}

            {/* Attachment */}
            {msg.attachment && renderAttachment(msg.attachment, isOwn)}

            {/* Text */}
            {msg.text ? (
              <Text style={[s.msgText, { color: isOwn ? sentTextColor : receivedTextColor }]}>{msg.text}</Text>
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
              <PressableScale rippleEnabled={false}
                onPress={() => { if (conv) void retryMessage(conv.id, msg.id).catch(() => {}); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={s.retryRow}
              >
                <Feather name="alert-circle" size={11} color={theme.error} />
                <Text style={[s.retryText, { color: theme.error }]}>Tap to retry</Text>
              </PressableScale>
            )}
          </PressableScale>
          </SwipeToReplyBubble>

          {/* Reaction chip summary */}
          {reactionEntries.length > 0 && (
            <View style={[s.reactionsRow, isOwn ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
              {reactionEntries.map(([kind, count]) => (
                <PressableScale rippleEnabled={false}
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

          {/* Seen receipt (Mobbin: Instagram DM "Seen just now" —
              mobbin.com/screens/674b1826-5513-4f83-ad23-89b4454e2129). Real
              conversation-level readAt from the backend, not a fake
              indicator — see lib/chatGrouping.ts's isSeenReceipt for the
              exact granularity this reflects. Shows once, under my own
              most recent message, once they've read up through it. */}
          {isOwn && msg.id === lastOwnMsgId && !!msg.readAt && (
            <Text style={s.seenReceipt}>
              Seen {formatTime(new Date(msg.readAt!).getTime())}
            </Text>
          )}
        </View>
      </View>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  const visibleMessages = messages.filter(m => !m.deletedForMe);
  const listData = mergeCallLogRows(buildListRows(visibleMessages, unreadDividerId), callLog);

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

  // Deterministic composer height from typed newlines — react-native-web's
  // multiline <textarea> doesn't reliably auto-size via onContentSizeChange
  // (its first measurement fires against the unconstrained intrinsic
  // <textarea> size before any height is applied, ballooning the box). This
  // keeps the composer at exactly one line (40pt pill) at rest and grows it
  // up to COMPOSER_MAX_LINES as the user presses Enter.
  const composerLines = Math.min(Math.max(text.split('\n').length, 1), COMPOSER_MAX_LINES);
  const composerInputHeight = composerLines * COMPOSER_LINE_HEIGHT + COMPOSER_TEXT_V_PADDING * 2;
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
      {/* Chat details > Theme: the conversation's background, behind
          everything else, only when a theme is actually applied — an
          un-themed chat's background is untouched (s.root's own theme.background). */}
      {convTheme && (
        <LinearGradient
          colors={convTheme.gradient}
          style={StyleSheet.absoluteFill}
          testID="conversation-theme-background"
        />
      )}

      {/* Plain flat header — no card, no pill, no background decoration.
          Sits directly on the theme background with a hairline border
          underneath instead of a floating "glass" card. */}
      <View style={[s.headerWrap, { paddingTop: headerTopPad + SP.xs, paddingRight: SP.md + insets.right }]}>
        <PressableScale rippleEnabled={false}
          onPress={() => { hapticPrimaryAction(); goBackOr(router); }}
          style={s.roundBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="conversation-back"
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={ICON.md} color={theme.text} />
        </PressableScale>

        <PressableScale rippleEnabled={false}
          style={s.headerCenter}
          activeOpacity={participant ? 0.7 : 1}
          disabled={!participant}
          onPress={() => { hapticPrimaryAction(); openChatDetails(); }}
          testID="conversation-header-name"
          accessibilityRole="button"
          accessibilityLabel={`${displayName} — chat details`}
        >
          {participant && (
            <View style={s.headerAvatarWrap} testID="conversation-avatar">
              {isAgentConv ? (
                <View style={[s.headerAvatarCircle, s.headerAvatarOfficial, { backgroundColor: theme.background, borderColor: theme.border }]}>
                  <BrandthreadLogo size={18} />
                </View>
              ) : (
                <View style={[s.headerAvatarCircle, { backgroundColor: participant.color }]}>
                  <Text style={s.headerAvatarInitials}>{participant.initials}</Text>
                </View>
              )}
              {participant.isOnline && <View style={s.headerAvatarOnlineDot} />}
            </View>
          )}
          <View style={s.headerTextCol}>
            <View style={s.headerNameRow}>
              <Text style={s.headerName} numberOfLines={1}>{displayName}</Text>
              {isAgentConv && (
                <View style={s.headerAiBadgeRow} testID="conversation-official-badge">
                  <Feather name="check-circle" size={14} color={theme.accent} style={{ marginLeft: 4 }} />
                  <View style={[s.headerAiTag, { backgroundColor: theme.accentDim }]}>
                    <Text style={[s.headerAiTagText, { color: theme.accent }]}>AI</Text>
                  </View>
                </View>
              )}
            </View>
            {statusLine ? (
              <Text style={[s.headerStatusLine, { color: participant?.isOnline ? theme.success : theme.muted }]} numberOfLines={1}>
                {statusLine}
              </Text>
            ) : null}
          </View>
        </PressableScale>

        {/* An AI account can't take a call — no voice/video icons for it,
            just the info icon below. */}
        {conv && !isAgentConv && (
          <PressableScale rippleEnabled={false}
            style={s.roundBtn}
            onPress={() => { hapticPrimaryAction(); handleStartCall('voice'); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="conversation-call-voice"
            accessibilityRole="button"
            accessibilityLabel="Voice call"
          >
            <Feather name="phone" size={ICON.sm} color={theme.muted} />
          </PressableScale>
        )}
        {conv && !isAgentConv && (
          <PressableScale rippleEnabled={false}
            style={s.roundBtn}
            onPress={() => { hapticPrimaryAction(); handleStartCall('video'); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            testID="conversation-call-video"
            accessibilityRole="button"
            accessibilityLabel="Video call"
          >
            <Feather name="video" size={ICON.sm} color={theme.muted} />
          </PressableScale>
        )}
        <PressableScale rippleEnabled={false}
          style={s.roundBtn}
          onPress={() => { hapticPrimaryAction(); openOptions(); }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="conversation-options"
          accessibilityRole="button"
          accessibilityLabel={isAgentConv ? 'About Brandthread Agent' : 'More options'}
        >
          <Feather name={isAgentConv ? 'info' : 'more-horizontal'} size={ICON.sm} color={theme.muted} />
        </PressableScale>
      </View>

      {/* Request-mode profile header — Instagram's message-request chat
          leads with a bigger avatar, name, @handle and a "View profile"
          pill before any messages, since this is often the first real
          context the recipient has on who's messaging them. */}
      {isRequestMode && participant && (
        <View style={s.requestProfileHeader} testID="conversation-request-profile-header">
          <View style={[s.requestProfileAvatar, { backgroundColor: participant.color }]}>
            {participant.avatarUri ? (
              <CachedImage source={{ uri: participant.avatarUri }} style={s.requestProfileAvatarImage} />
            ) : (
              <Text style={s.requestProfileAvatarInitials}>{participant.initials}</Text>
            )}
          </View>
          <Text style={s.requestProfileName} numberOfLines={1}>{participant.name}</Text>
          {!!participant.handle && (
            <Text style={s.requestProfileHandle} numberOfLines={1}>{participant.handle}</Text>
          )}
          <PressableScale
            rippleEnabled={false}
            style={s.requestProfilePill}
            onPress={() => {
              hapticPrimaryAction();
              if (participant) router.push(('/seller-profile?id=' + encodeURIComponent(participant.userId)) as never);
            }}
            accessibilityRole="button"
            accessibilityLabel={`View ${participant.name}'s profile`}
            testID="conversation-request-view-profile"
          >
            <Text style={s.requestProfilePillText}>View profile</Text>
          </PressableScale>
        </View>
      )}

      {/* Order context card */}
      {conv?.type === 'buyer_to_seller_order' && (
        <PressableScale rippleEnabled={false}
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
        <PressableScale rippleEnabled={false}
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

      {/* Messages list — wrapped in KeyboardGestureArea so an interactive
          drag on the list can swipe the keyboard down (iMessage-style),
          same gesture area the composer's TextInput links to via
          nativeID below. */}
      <KeyboardGestureArea style={{ flex: 1 }} textInputNativeID={CHAT_INPUT_NATIVE_ID}>
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
        keyboardDismissMode="interactive"
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
      </KeyboardGestureArea>

      {/* Double-tap heart burst */}
      {likeBurst && (
        <LikeBurst key={likeBurst.key} x={likeBurst.x} y={likeBurst.y} color={theme.accent} onDone={() => setLikeBurst(null)} />
      )}

      {/* Reply preview — Mobbin: Instagram "Replying to a message"
          (mobbin.com/flows/c973fada-0946-4bf2-b821-8a2b37958685). Fades/
          slides in (ReplyBanner), never bounces — this is UI chrome, not
          the swipe gesture that (usually) triggers it. */}
      {replyTo && !isRequestMode && !messaging.blockedByMe && !messaging.unavailable && (
        <ReplyBanner
          testID="conversation-reply-banner"
          theme={theme}
          fromName={replyTo.fromName}
          previewText={messagePreviewText(replyTo)}
          onCancel={() => setReplyTo(null)}
        />
      )}

      {/* Input row — request mode replaces the composer entirely with the
          accept/block/delete bottom panel (see RequestActionPanel below). */}
      {isRequestMode && participant ? (
        <RequestActionPanel
          name={participant.name}
          bottomInset={insets.bottom}
          loading={requestActionLoading}
          onAccept={handleAcceptRequest}
          onDelete={handleDeleteRequest}
          onBlock={handleBlockRequest}
        />
      ) : participant && (messaging.blockedByMe || messaging.unavailable) ? (
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
          {selectedAttachment && (() => {
            const uploadingMedia = selectedAttachment.meta?.uploading === 'true';
            const isMedia = selectedAttachment.type === 'image' || selectedAttachment.type === 'video';
            return (
            <View style={s.selectedAttachment} testID="conversation-selected-attachment">
              {isMedia ? (
                <MediaUploadThumb
                  type={selectedAttachment.type as 'image' | 'video'}
                  uri={selectedAttachment.type === 'image' ? selectedAttachment.uri : undefined}
                  uploading={uploadingMedia}
                  size={40}
                  ringColor={theme.accent}
                  iconColor={theme.muted}
                  trackColor={theme.border}
                />
              ) : isUploading ? (
                <UploadRing size={22} color={theme.accent} trackColor={theme.border} />
              ) : (
                <Feather
                  name={
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
                    uploadingMedia ? 'Uploading…' :
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
              <PressableScale rippleEnabled={false}
                onPress={() => { mediaUploadTokenRef.current++; setSelectedAttachment(null); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={uploadingMedia ? 'Cancel upload' : 'Remove attachment'}
                testID="conversation-selected-attachment-remove"
              >
                <Feather name="x" size={ICON.sm} color={theme.muted} />
              </PressableScale>
            </View>
            );
          })()}
          <View style={[s.inputRow, { paddingBottom: composerBottomPad }]}>
            {voiceRecorder.phase !== 'idle' ? (
              <VoiceRecordingBar
                theme={theme}
                phase={voiceRecorder.phase}
                elapsedMs={voiceRecorder.elapsedMs}
                waveform={voiceRecorder.waveform}
                dragX={voiceRecorder.dragX}
                dragY={voiceRecorder.dragY}
                isWeb={voiceRecorder.isWeb}
                onCancel={voiceRecorder.cancel}
                onLock={voiceRecorder.lock}
                onSend={() => { void voiceRecorder.finish(); }}
              />
            ) : (<>
            {/* Attach — photos, video, Thread Cash (Apple-Cash-style), and
                (for seller chats) products/posts. Clean, unbordered "+" glyph
                (Mobbin: Instagram's composer keeps this control borderless —
                mobbin.com/screens/db4e29c8-e47e-47ce-8f01-b7a98376c6e7) —
                previously a hairline-bordered circle, which read as an "ugly
                bordered plus" against the pill. */}
            <PressableScale rippleEnabled={false}
              bounce={false}
              onPress={() => { hapticPrimaryAction(); setShowMediaSheet(true); }}
              style={s.roundInputBtn}
              disabled={isUploading || isSending}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="conversation-attach"
              accessibilityRole="button"
              accessibilityLabel="Attach"
            >
              {isUploading
                ? <UploadRing size={ICON.md} color={theme.accent} />
                : <Feather name="plus" size={ICON.md} color={theme.text} />
              }
            </PressableScale>

            {/* One pill: text input, the Thread Cash coin (left of the
                mic/send control), and the mic⇄send morph — all inside the
                same rounded bounds instead of floating as separate siblings. */}
            <View style={s.pill}>
              <TextInput
                ref={textInputRef}
                nativeID={CHAT_INPUT_NATIVE_ID}
                style={[s.textInput, { height: composerInputHeight }]}
                value={text}
                onChangeText={handleChangeText}
                placeholder="Message…"
                placeholderTextColor={theme.muted}
                multiline
                returnKeyType="default"
                autoCapitalize="sentences"
              />

              {/* Mic ⇄ Send morph, inside the pill's own bounds */}
              <View style={s.morphContainer}>
                <Animated.View
                  pointerEvents={showSendButton ? 'none' : 'auto'}
                  style={[StyleSheet.absoluteFill, s.morphFace, { opacity: micOpacity, transform: [{ scale: micScale }] }]}
                >
                  {/* Native: press-and-hold starts recording, then slide-to-
                      cancel/lock via the same gesture (see useVoiceRecorder).
                      Web has no press-hold-and-drag parity, so a tap toggles
                      recording instead — see docs/dm-flows.md. */}
                  {voiceRecorder.isWeb ? (
                    <PressableScale rippleEnabled={false}
                      bounce={false}
                      onPress={() => { void voiceRecorder.startWeb(); }}
                      disabled={isUploading || isSending}
                      style={s.morphFaceInner}
                      testID="conversation-mic"
                      accessibilityRole="button"
                      accessibilityLabel="Record voice message"
                    >
                      <Feather name="mic" size={COMPOSER_ICON} color={theme.muted} />
                    </PressableScale>
                  ) : (
                    <View
                      {...voiceRecorder.panHandlers}
                      style={s.morphFaceInner}
                      testID="conversation-mic"
                      accessibilityRole="button"
                      accessibilityLabel="Record voice message"
                    >
                      <Feather name="mic" size={COMPOSER_ICON} color={theme.muted} />
                    </View>
                  )}
                </Animated.View>
                <Animated.View
                  pointerEvents={showSendButton ? 'auto' : 'none'}
                  style={[
                    StyleSheet.absoluteFill, s.morphFace,
                    { opacity: sendOpacity, transform: [{ scale: sendScale }], backgroundColor: canSend ? theme.accent : theme.cardElevated },
                  ]}
                >
                  <PressableScale rippleEnabled={false}
                    bounce={false}
                    onPress={() => { hapticPrimaryAction(); handleSend(); }}
                    disabled={!canSend}
                    style={s.morphFaceInner}
                    activeOpacity={0.8}
                    testID="conversation-send"
                    accessibilityRole="button"
                    accessibilityLabel="Send message"
                  >
                    <Feather name="send" size={COMPOSER_ICON} color={canSend ? theme.onAccent : theme.muted} />
                  </PressableScale>
                </Animated.View>
              </View>

              {/* Gallery quick-attach — evenly spaced with mic and the
                  Thread Cash bill, per the Instagram/Threads composer. */}
              <PressableScale rippleEnabled={false}
                bounce={false}
                onPress={handlePickPhoto}
                style={s.composerIconBtn}
                disabled={isUploading || isSending}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="conversation-gallery"
                accessibilityRole="button"
                accessibilityLabel="Photo library"
              >
                <Feather name="image" size={COMPOSER_ICON} color={theme.muted} />
              </PressableScale>

              {/* Minimal Thread Cash entry — works for any conversation
                  participant (buyer-to-buyer friends included). Always
                  rendered once the feature flag is on: disabled with an
                  explanation rather than hidden when not yet confirmed as a
                  mutual follow. The transfer is already final by the time
                  onSent fires, so the bubble is posted immediately rather
                  than staged in the composer. The server independently
                  re-validates mutual follow at send AND claim — this is an
                  affordance check only, never the security boundary. */}
              {threadCashSendEnabled && sellerUserId ? (
                <ThreadCashAttachButton
                  recipientId={sellerUserId}
                  recipientName={participant?.name}
                  recipientHandle={participant?.handle}
                  conversationId={conv?.id ?? ''}
                  disabled={threadCashMutual !== true}
                  disabledReason={threadCashDisabledReason}
                  renderTrigger={(open) => (
                    <PressableScale rippleEnabled={false}
                      bounce={false}
                      onPress={() => {
                        // Still checking mutual-follow status — silent no-op.
                        // Never surface a "checking…" string to the user.
                        if (threadCashMutual === null) return;
                        // Confirmed not mutual — the one clean explainer,
                        // with a Follow action, via the app's own Snackbar
                        // (Alert.alert() is a documented no-op on RN Web).
                        if (threadCashMutual === false) {
                          setThreadCashNotice(threadCashDisabledReason);
                          return;
                        }
                        open();
                      }}
                      style={s.threadCashCoinBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      testID="conversation-thread-cash"
                      accessibilityRole="button"
                      accessibilityLabel={threadCashMutual !== true ? `Thread Cash — ${threadCashDisabledReason}` : 'Send Thread Cash'}
                      accessibilityState={{ disabled: threadCashMutual !== true }}
                    >
                      <ThreadCashBillMark size={COMPOSER_ICON} color={theme.text} accent={theme.accent} disabled={threadCashMutual !== true} />
                    </PressableScale>
                  )}
                  onSent={async ({ transferId, amountCents, note }) => {
                    if (!conv) return;
                    const attachment: MessageAttachment = {
                      type: 'thread_cash',
                      title: 'Thread Cash',
                      accentColor: theme.accent,
                      meta: {
                        transferId,
                        senderId: myId,
                        amountCents: String(amountCents),
                        status: 'pending',
                        ...(note ? { note } : {}),
                      },
                    };
                    // Preview conversations have no real backend to post
                    // to — append a local mock message directly, the same
                    // way the seeded agent-reply flow above does.
                    if (isPreviewConversationId(conv.id)) {
                      setMessages((prev) => [...prev, {
                        id: `local-thread-cash-${transferId}`,
                        conversationId: conv.id,
                        fromId: myId,
                        fromName: 'You',
                        fromInitials: 'Y',
                        fromColor: theme.accent,
                        text: '',
                        attachment,
                        reactions: [],
                        status: 'sent',
                        ts: Date.now(),
                        deletedForMe: false,
                      }]);
                      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
                      return;
                    }
                    try {
                      await sendMessage(conv.id, '', attachment);
                      const msgs = await getMessages(conv.id);
                      setMessages(msgs);
                      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
                    } catch (e) {
                      Alert.alert('Sent, but the chat message failed', apiErrorMessage(e, 'The Thread Cash send went through — refresh to see it in chat.'));
                    }
                  }}
                />
              ) : null}
            </View>
            </>)}
          </View>
        </View>
      ) : (
        <View style={[s.inputRow, s.disabledInputRow, { paddingBottom: composerBottomPad }]}>
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
        <PressableScale rippleEnabled={false} style={s.modalBackdrop} activeOpacity={1} onPress={() => setShowMediaSheet(false)} />
        <SheetRise style={s.mediaSheet}>
          <View style={s.mediaSheetHandle} />
          <Text style={s.mediaSheetTitle}>Add to message</Text>
          <PressableScale rippleEnabled={false} style={s.mediaSheetOption} onPress={handlePickPhoto}>
            <View style={s.mediaSheetIcon}><Feather name="image" size={ICON.md} color={theme.accent} /></View>
            <View>
              <Text style={s.mediaSheetLabel}>Photos</Text>
              <Text style={s.mediaSheetDesc}>Up to 15 at once</Text>
            </View>
          </PressableScale>
          <PressableScale rippleEnabled={false} style={s.mediaSheetOption} onPress={handlePickVideo}>
            <View style={s.mediaSheetIcon}><Feather name="video" size={ICON.md} color={theme.accent} /></View>
            <View>
              <Text style={s.mediaSheetLabel}>Video clip</Text>
              <Text style={s.mediaSheetDesc}>Under 1 minute</Text>
            </View>
          </PressableScale>
          {isSellerConv && (
            <PressableScale rippleEnabled={false} style={s.mediaSheetOption} onPress={openAttachmentPicker}>
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
              <PressableScale rippleEnabled={false}
                onPress={() => setShowAttachmentPicker(false)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Feather name="x" size={ICON.md} color={theme.muted} />
              </PressableScale>
            </View>
            <View style={s.attachmentTabs}>
              <PressableScale rippleEnabled={false}
                style={[s.attachmentTab, attachmentTab === 'product' && s.attachmentTabActive]}
                onPress={() => setAttachmentTab('product')}
              >
                <Feather name="shopping-bag" size={ICON.sm} color={attachmentTab === 'product' ? theme.accent : theme.muted} />
                <Text style={[s.attachmentTabText, attachmentTab === 'product' && s.attachmentTabTextActive]}>
                  Products
                </Text>
              </PressableScale>
              <PressableScale rippleEnabled={false}
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
                      <PressableScale rippleEnabled={false}
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
                    <PressableScale rippleEnabled={false}
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

      {/* Long-press reactions — Glass overlay. Mobbin: Instagram DM "Tap and
          hold to super react" (mobbin.com/screens/5d13fdd9-75ad-43d6-9089-
          7b236e362b73) — dims/blurs the thread, floats 6 emoji above the
          elevated bubble with a hint label, and shows this same context
          menu below the bubble at the same time. */}
      <ReactionOverlay
        visible={activeSheetMsg != null}
        anchor={reactionAnchor}
        isOwn={isOwnSheetMsg}
        bubbleStyle={activeSheetMsg ? [
          s.bubble,
          { backgroundColor: isOwnSheetMsg ? sentBubbleColor : receivedBubbleColor, borderRadius: RADIUS.lg },
        ] : undefined}
        bubbleContent={activeSheetMsg ? (
          <Text style={[s.msgText, { color: isOwnSheetMsg ? sentTextColor : receivedTextColor }]}>
            {activeSheetMsg.text || sheetAttachmentLabel(activeSheetMsg)}
          </Text>
        ) : null}
        selected={myReactionOnSheet}
        onSelectReaction={(type) => {
          if (activeSheetMsg) void handleReact(activeSheetMsg, type);
          closeMessageSheet();
        }}
        menuItems={activeSheetMsg ? (
          [
            { key: 'reply', label: 'Reply', icon: 'corner-up-left', onPress: sheetReply },
            { key: 'copy', label: 'Copy', icon: 'copy', onPress: sheetCopy },
            isOwnSheetMsg
              ? { key: 'delete', label: 'Delete for me', icon: 'trash-2', destructive: true, onPress: sheetDelete }
              : { key: 'report', label: 'Report message', icon: 'flag', destructive: true, onPress: sheetReport },
          ] as ReactionOverlayMenuItem[]
        ) : []}
        onClose={closeMessageSheet}
      />

      <MediaViewer visible={viewerUri != null} uri={viewerUri} onClose={() => setViewerUri(null)} />

      <Snackbar
        visible={copiedToast}
        message="Copied"
        onDismiss={() => setCopiedToast(false)}
      />

      <Snackbar
        visible={transcriptionToast}
        message={TRANSCRIPTION_STUB}
        onDismiss={() => setTranscriptionToast(false)}
      />

      <Snackbar
        visible={threadCashNotice != null}
        message={threadCashNotice ?? ''}
        actionLabel="Follow"
        onAction={async () => {
          setThreadCashNotice(null);
          if (!sellerUserId) return;
          try {
            await api.social.follow(sellerUserId);
            hapticSuccessAction();
            setThreadCashMutual(null);
            const status = await api.social.status(sellerUserId);
            setThreadCashMutual(status.isMutual);
          } catch {
            // Following can still fail (rate limit, blocked, etc.) — the
            // coin's own disabled state already reflects reality either way.
          }
        }}
        onDismiss={() => setThreadCashNotice(null)}
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

// ─── Request-mode bottom panel ─────────────────────────────────────────────────
// Replaces the composer while `conv.isRequest` is true (see isRequestMode in
// the screen above). Instagram reference: mobbin.com/screens/db4e29c8-e47e-
// 47ce-8f01-b7a98376c6e7 (Instagram chat) — a sheet-style panel that sits
// above the home indicator with the explainer copy and a three-way row
// (Block / Delete / Accept), Accept as the sole filled/primary action.
function RequestActionPanel({
  name, bottomInset, loading, onAccept, onDelete, onBlock,
}: {
  name: string;
  bottomInset: number;
  loading: boolean;
  onAccept: () => void;
  onDelete: () => void;
  onBlock: () => void;
}) {
  const { theme } = useAppTheme();
  const rs = requestPanelStyles;
  return (
    <View
      style={[rs.wrap, { borderTopColor: theme.border, backgroundColor: theme.surface, paddingBottom: Math.max(bottomInset, SP.md) }]}
      testID="conversation-request-panel"
    >
      <Text style={[rs.title, { color: theme.text }]}>{name} wants to send you a message</Text>
      <Text style={[rs.subline, { color: theme.muted }]}>
        Accepting lets them see when you’ve read their messages and message you freely.
      </Text>
      <View style={rs.actionsRow}>
        <PressableScale
          rippleEnabled={false}
          style={rs.actionBtn}
          onPress={onBlock}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Block ${name}`}
          testID="conversation-request-block"
        >
          <Text style={[rs.actionText, { color: theme.error }]}>Block</Text>
        </PressableScale>
        <PressableScale
          rippleEnabled={false}
          style={rs.actionBtn}
          onPress={onDelete}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Delete request from ${name}`}
          testID="conversation-request-delete"
        >
          <Text style={[rs.actionText, { color: theme.text }]}>Delete</Text>
        </PressableScale>
        <PressableScale
          rippleEnabled={false}
          style={[rs.actionBtn, rs.acceptBtn, { backgroundColor: theme.text }]}
          onPress={onAccept}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Accept message request from ${name}`}
          testID="conversation-request-accept"
        >
          {loading ? (
            <ActivityIndicator color={theme.background} size="small" />
          ) : (
            <Text style={[rs.actionText, rs.acceptText, { color: theme.background }]}>Accept</Text>
          )}
        </PressableScale>
      </View>
    </View>
  );
}

const requestPanelStyles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    gap: SP.xs,
  },
  title: { fontFamily: FONT.semibold, fontSize: FS.sm, textAlign: 'center' },
  subline: { fontFamily: FONT.regular, fontSize: FS.xs, lineHeight: 16, textAlign: 'center', marginBottom: SP.sm },
  actionsRow: { flexDirection: 'row', gap: SP.sm },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {},
  actionText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  acceptText: {},
});

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (theme: ReturnType<typeof useAppTheme>['theme']) => {
  return StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.background },

  // Floating glass header
  headerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.background,
    // Left stays tight to the back arrow; the right-side icon cluster's own
    // padding is set inline below (it needs insets.right, which isn't known
    // to this static stylesheet). Mobbin: Instagram DM header
    // (mobbin.com/screens/db4e29c8-e47e-47ce-8f01-b7a98376c6e7) — the call/
    // video/overflow icons sit inset from the screen edge, evenly spaced,
    // never flush against it.
    paddingLeft: SP.xs,
    paddingBottom: SP.sm,
    gap: SP.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
    zIndex: 5,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.xs,
    gap: SP.sm,
  },
  headerTextCol: {
    alignItems: 'center',
  },
  headerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerName: {
    fontSize: 16,
    fontFamily: FONT.semibold,
    color: theme.text,
    letterSpacing: -0.2,
  },
  headerAiBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerAiTag: {
    borderRadius: RADIUS.xs,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 4,
  },
  headerAiTagText: {
    fontSize: 10,
    fontFamily: FONT.bold,
  },
  headerStatusLine: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: theme.success,
    marginTop: 1,
  },
  headerAvatarWrap: { position: 'relative' },
  headerAvatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarOfficial: { borderWidth: 1 },
  headerAvatarInitials: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },
  // Request-mode profile header (avatar / name / @handle / "View profile")
  requestProfileHeader: {
    alignItems: 'center',
    paddingVertical: SP.lg,
    paddingHorizontal: SP.lg,
    gap: 4,
  },
  requestProfileAvatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginBottom: SP.sm,
  },
  requestProfileAvatarImage: { width: 88, height: 88 },
  requestProfileAvatarInitials: { fontSize: FS.xl, fontFamily: FONT.bold, color: '#FFFFFF' },
  requestProfileName: { fontSize: FS.lg, fontFamily: FONT.bold, color: theme.text },
  requestProfileHandle: { fontSize: FS.sm, fontFamily: FONT.regular, color: theme.muted, marginBottom: SP.sm },
  requestProfilePill: {
    height: 34,
    paddingHorizontal: SP.md,
    borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestProfilePillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.text },
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
    fontSize: FS.meta,
    fontFamily: FONT.medium,
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

  // Date separator — plain small gray centered text, no pill (IG-style).
  dateSeparatorWrap: {
    alignItems: 'center',
    marginVertical: SP.lg,
  },
  dateSeparatorText: {
    fontSize: 12,
    fontFamily: FONT.medium,
    color: theme.muted,
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
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: AVATAR_GAP,
    marginBottom: 2,
  },
  msgAvatarOfficial: { borderWidth: 1 },
  msgAvatarSpacer: {
    width: AVATAR_SIZE,
    marginRight: AVATAR_GAP,
  },
  msgAvatarInitials: {
    fontSize: 11,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
  },

  // Bubble — 12x8pt padding, 18pt corner radius (Mobbin iMessage/Luma refs).
  bubble: {
    borderRadius: RADIUS.lg,
    paddingHorizontal: 12,
    paddingVertical: SP.sm,
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
    width: 240,
    backgroundColor: theme.card,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: theme.border,
    padding: SP.sm,
    marginBottom: SP.xs,
  },
  // Product/order chat cards (item 70/71) moved to the standalone
  // ChatAttachmentCard component (components/chat/ChatAttachmentCard.tsx) —
  // no bubble, no border, own the tap target. See renderItem's product/
  // order branch.
  // A standalone agent info/deep-link card — full width, coin/icon-in-a-
  // circle, bold title, subtitle, chevron. Same row shape as the Thread Cash
  // payment card below.
  agentCardOuter: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth,
    padding: SP.sm, width: '100%', maxWidth: BUBBLE_MAX, alignSelf: 'flex-start',
  },
  agentCardIconCircle: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  // Quick replies: standalone chips below the last bubble, on the same
  // left edge as every incoming bubble/card — never inside a bubble.
  quickReplyOuterRow: {
    paddingLeft: BUBBLE_COLUMN_LEFT,
  },
  quickReplyScrollContent: {
    flexDirection: 'row',
    paddingRight: SP.md,
  },
  quickReplyChipWrap: {
    marginRight: SP.xs,
  },
  attachTitle: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: theme.text,
  },
  attachSubtitle: {
    fontSize: FS.meta,
    fontFamily: FONT.medium,
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

  // Message text — 15pt per spec; emoji font stack biases toward Apple's own
  // emoji glyphs on web instead of the OS-default Noto/Segoe blobs.
  msgText: {
    fontSize: 15,
    fontFamily: FONT.regular,
    lineHeight: 21,
    ...(Platform.OS === 'web' ? { fontFamily: `${FONT.regular}, ${EMOJI_FONT_STACK}` } : null),
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
  // Seen receipt (Instagram DM "Seen just now" reference) — small muted
  // text under the sender's own last message, right-aligned to match its
  // own bubble alignment.
  seenReceipt: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: theme.muted,
    alignSelf: 'flex-end',
    marginTop: 3,
    marginRight: 2,
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
  // A light, borderless "+" — no filled grey blob. Sized a touch larger than
  // the glyph controls inside the pill (COMPOSER_CONTROL+4) so it optically
  // centers against the pill's own ~44pt height (see `pill` below); keeps a
  // generous hitSlop at the call site for a full 44pt tap target.
  roundInputBtn: {
    width: COMPOSER_CONTROL + 4,
    height: COMPOSER_CONTROL + 4,
    borderRadius: (COMPOSER_CONTROL + 4) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  // The single composer pill — holds the TextInput, the Thread Cash coin,
  // and the mic⇄send morph, all inside one rounded surface. ~44pt tall at
  // rest for a single line (Dev feedback: the bar read as too tall/thick
  // before) and only grows as composerInputHeight grows with typed lines.
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: theme.cardElevated,
    borderRadius: RADIUS.xxl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    paddingLeft: SP.sm,
    paddingRight: SP.xs,
    gap: SP.sm,
    minHeight: COMPOSER_CONTROL + SP.sm,
  },
  textInput: {
    flex: 1,
    paddingVertical: COMPOSER_TEXT_V_PADDING,
    paddingRight: SP.xs,
    fontSize: FS.base,
    lineHeight: COMPOSER_LINE_HEIGHT,
    fontFamily: FONT.regular,
    color: theme.text,
    textAlignVertical: 'center',
    maxHeight: COMPOSER_MAX_INPUT_HEIGHT,
    // A bare <textarea> on web ships its own default padding/line-height —
    // the explicit `height` set inline on the element (from
    // composerContentHeight) is what actually keeps it at rest/growing
    // correctly; this minHeight is just a native-platform floor.
    minHeight: COMPOSER_CONTROL,
    // Matches the icons' own marginBottom below so the placeholder/typed
    // text sits on the exact same baseline as the mic/send/gallery glyphs —
    // without this the text box (flush to the pill's bottom edge) sat ~4pt
    // lower than the icons, reading as "placeholder sits low/off-center".
    marginBottom: SP.xs,
    ...(Platform.OS === 'web' ? { paddingTop: COMPOSER_TEXT_V_PADDING, paddingBottom: COMPOSER_TEXT_V_PADDING } : null),
  },
  // Sits inside the pill, after mic/send and gallery.
  threadCashCoinBtn: {
    width: COMPOSER_CONTROL,
    height: COMPOSER_CONTROL,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.xs,
  },
  // Gallery quick-attach — same touch target as the other pill controls.
  composerIconBtn: {
    width: COMPOSER_CONTROL,
    height: COMPOSER_CONTROL,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SP.xs,
  },
  morphContainer: {
    width: COMPOSER_CONTROL,
    height: COMPOSER_CONTROL,
    marginBottom: SP.xs,
  },
  morphFace: {
    borderRadius: COMPOSER_CONTROL / 2,
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
  mediaSheetDesc:   { fontSize: FS.meta, fontFamily: FONT.medium, color: theme.muted, marginTop: 2 },

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
