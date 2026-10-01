/**
 * Seller Conversation — read a buyer thread and send replies.
 * Reads GET /api/conversations/:id/messages, sends via POST /api/conversations/:id/messages.
 * Sellers can attach a product card or the linked order to a reply.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { View, Text, FlatList, TextInput, Alert, Platform, StyleSheet, Dimensions, ActivityIndicator, ListRenderItemInfo, Modal, ScrollView, Linking } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useUser } from '@clerk/expo';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { PressableScale, StatusBadge, useUndoToast } from '@/components/BrandthreadUI';
import { Glass } from '@/components/ui/Glass';
import { dbStatusToOrderStatus, orderStatusBadgeLabel, orderStatusBadgeVariant, carrierTrackingUrl } from '@/lib/orderStatusAdapter';
import { CachedImage } from '@/components/CachedImage';
import { SkeletonBlock } from '@/components/ui/Skeleton';
import { hapticPrimaryAction, hapticSelection, hapticSuccessAction, hapticDestructiveConfirm } from '@/lib/haptics';
import * as ImagePicker from 'expo-image-picker';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  acceptSellerConversationRequest, scheduleDeleteSellerConversationRequest,
  undoDeleteSellerConversationRequest, blockSellerConversationRequestUser,
} from '@/lib/sellerRequestActions';
import { DELETE_GRACE_MS } from '@/lib/pendingRequestDeletes';
import { confirmDestructiveActionSheet } from '@/lib/actionSheet';
import {
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { VoiceRecordingBar } from '@/components/chat/VoiceRecordingBar';
import Composer from '@/components/ui/Composer';
import { useHideTabBar } from '@/lib/tabBarVisibility';
import { VoiceMessageBubble, TRANSCRIPTION_STUB } from '@/components/chat/VoiceMessageBubble';
import * as Clipboard from 'expo-clipboard';
import { formatCents } from '@/lib/money';
import { notifyConversationReadFailure } from '@/lib/conversationReadEvents';
import { confirmUnblock, apiErrorMessage, apiErrorCode, BLOCK_EXPLAINER } from '@/lib/safety';
import {
  BlockedComposer, openConversationOptions, openMessageOptions, REMOVED_MESSAGE_TEXT,
  type DmMessagingState,
} from '@/components/safety/DmSafety';
import { SheetRise } from '@/components/motion/SheetRise';
import { useCallSession, useCallLog } from '@/lib/calls/CallSessionContext';
import { CallLogBubble } from '@/components/calls/CallLogBubble';
import { isSellerDevPreview } from '@/lib/devPreview';
import {
  isSellerPreviewConversationId,
  getSellerPreviewConversation, getSellerPreviewMessages, getSellerPreviewBuyerOrders,
  isPreviewInboxEnabled, posterUri, previewAutoReplyText, previewAutoReplyDelayMs,
} from '@/lib/previewInbox';
import UploadRing from '@/components/chat/UploadRing';
import MediaUploadThumb from '@/components/chat/MediaUploadThumb';
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
import { ChatAttachmentCard } from '@/components/chat/ChatAttachmentCard';
import { ReactionOverlay, type ReactionOverlayAnchor, type ReactionOverlayMenuItem } from '@/components/chat/ReactionOverlay';
import { ReactionGlyph } from '@/components/chat/ReactionBar';
import { applyOptimisticReaction, myReactionIn, groupReactionCounts } from '@/lib/reactionMutations';
import type { MessageReaction, ReactionType } from '@/services/socialTypes';
import { useFeatureFlag } from '@/contexts/FeatureFlagContext';
import { ThreadCashAttachButton, ThreadCashMessageCard, ThreadCashBillMark } from '@/components/thread-cash/ChatAttachThreadCash';
import { useCelebrateThreadCash } from '@/components/thread-cash/CelebrationHost';
import { Snackbar } from '@/components/ui/Snackbar';
import type { ThreadCashTransferStatus } from '@/lib/threadCashTypes';

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
  /** Real-time "X is typing…" — the buyer's own typing signal, polled via
   *  GET /api/conversations/:id (see PATCH .../typing). Undefined for a
   *  seeded preview thread (no real backend to poll). */
  otherTyping?: boolean;
  /** New every-role-pair DM/message-request routing — true while this
   *  thread is a pending request (see app/(buyer)/inbox.tsx's identical
   *  field and artifacts/api-server/src/routes/conversations.ts). */
  isRequest?: boolean;
  /** Who started the request — same value for both participants (it's a
   *  conversation-level column); the CURRENT viewer is the sender iff this
   *  equals their own id (effectiveMyId). */
  requestedBy?: string;
}
interface MsgAttachment {
  type: 'product' | 'order' | 'post' | 'profile' | 'image' | 'video' | 'voice' | 'system' | 'thread_cash';
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
  /** Item 68 (chat reactions glass) — the API already returns this for
   *  every message regardless of caller role (see loadReactionsByMessage in
   *  artifacts/api-server/src/routes/conversations.ts); previously just
   *  unread here. Same MessageReaction shape app/buyer-conversation.tsx
   *  renders, so both sides of a thread share one reaction data model. */
  reactions?: MessageReaction[];
}
interface SellerProduct {
  id: string; name: string; priceCents?: number; status?: string;
  variants?: Array<{ priceCents: number }>;
}
/** Item 144 (buyer context panel) — one row of this buyer's order history
 *  with the current seller. Shape mirrors GET /api/orders' existing row
 *  (see api-server's routes/orders.ts), filtered server-side by `buyerId` so
 *  it can only ever be THIS seller's own orders for THIS buyer — never a
 *  different seller's history with them. */
interface BuyerOrderRow {
  id: string; orderNumber: string; status: string; totalCents: number;
  itemCount?: number; createdAt: string;
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
  const headerTopInset = useHeaderTopInset();
  const router = useRouter();
  const api = useApi();
  const [messaging, setMessaging] = useState<DmMessagingState>({ blockedByMe: false, unavailable: false });
  const { user } = useUser();
  const myId = user?.id ?? '';
  // bt_force_upload: item 74 verification aid only — see the effect below.
  const { id, bt_force_upload } = useLocalSearchParams<{ id?: string; bt_force_upload?: string }>();
  const s = React.useMemo(() => makeStyles(theme), [theme]);
  // The dev-web ?bt_preview=seller bypass never signs in through Clerk (see
  // lib/devPreview.ts), so `myId` is '' in that mode — getSellerPreviewMessages
  // (lib/previewInbox.ts) marks the SELLER's own seeded messages with
  // fromId 'me', so "own message" bubbles must compare against 'me' here
  // instead of an empty myId. Never taken for a real signed-in account.
  const effectiveMyId = myId || (isSellerPreviewConversationId(id ?? '') ? 'me' : myId);

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
  const [transcriptionToast, setTranscriptionToast] = useState(false);
  const [showMediaSheet, setShowMediaSheet]   = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  // Request mode (Accept/Delete/Block panel) — see isRequestMode below.
  const [requestActionLoading, setRequestActionLoading] = useState(false);
  const textInputRef = useRef<TextInput>(null);
  const { showUndo } = useUndoToast();
  // Item 68 (chat reactions glass) — long-pressed message + its measured
  // on-screen position, feeding the shared ReactionOverlay (see
  // app/buyer-conversation.tsx's identical pattern).
  const [activeSheetMsg, setActiveSheetMsg] = useState<Msg | null>(null);
  const [reactionAnchor, setReactionAnchor] = useState<ReactionOverlayAnchor | null>(null);
  const bubbleAnchorRefs = useRef<Record<string, View | null>>({});
  const voicePlayer = useAudioPlayer(null);
  const voicePlayerStatus = useAudioPlayerStatus(voicePlayer);
  const voiceRecorder = useVoiceRecorder(uploadMedia, handleVoiceRecorded);
  // <Composer/> hides the tab bar itself; keep it hidden while the recording
  // bar temporarily replaces the composer.
  useHideTabBar(voiceRecorder.phase !== 'idle');

  // Attachment state
  const [pendingAttachment, setPendingAttachment] = useState<MsgAttachment | null>(null);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  // Item 74 (photo/video upload progress ring) — see the identical comment
  // in app/buyer-conversation.tsx.
  const mediaUploadTokenRef = useRef(0);
  // Real-time "X is typing…" — same pattern as app/buyer-conversation.tsx's
  // identical refs.
  const isTypingSentRef = useRef(false);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Item 144 — buyer context panel (Mobbin: Binance's chat-attached
  // account-context drawer, mobbin.com/screens/4b0152e6-df33-4d73-aa39-
  // 2b1a6cc4c8cd, and eBay's inline buyer/item card in seller chat,
  // mobbin.com/screens/1ffce781-c643-4728-895c-a322433564c0 — no exact
  // "seller inbox buyer CRM" pattern exists on Mobbin, so this is an honest
  // adaptation of those two, same as items 70/71 for the order/product
  // cards). `null` = not loaded yet, `[]` = loaded and genuinely empty.
  const [showBuyerContext, setShowBuyerContext] = useState(false);
  const [buyerOrders, setBuyerOrders] = useState<BuyerOrderRow[] | null>(null);
  const [loadingBuyerOrders, setLoadingBuyerOrders] = useState(false);
  const [buyerOrdersError, setBuyerOrdersError] = useState(false);

  // Item 74 verification aid — NOT a real feature. See the identical comment
  // on this same effect in app/buyer-conversation.tsx: the real upload is too
  // transient (and this sandbox has no reachable backend) to reliably
  // screenshot mid-flight, so ?bt_preview=seller&bt_force_upload=1
  // force-stages a real bundled photo as "uploading". Inert unless
  // isPreviewInboxEnabled() is also true.
  useEffect(() => {
    if (bt_force_upload !== '1' || !isPreviewInboxEnabled()) return;
    setPendingAttachment({
      type: 'image', uri: posterUri(4),
      title: 'Photo',
      meta: { photoUris: JSON.stringify([posterUri(4)]), uploading: 'true' },
    } as MsgAttachment);
    setIsUploading(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bt_force_upload]);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadMessages = useCallback(async (generation: number) => {
    if (!id) return;
    // Dev/preview only: a seeded thread from lib/previewInbox.ts has no
    // real backend record — skip the network call entirely rather than
    // relying on its error path, same as app/buyer-conversation.tsx's
    // identical isPreviewConversationId guard.
    if (isSellerPreviewConversationId(id)) {
      setMessages(getSellerPreviewMessages(id) as Msg[]);
      return;
    }
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
    if (isSellerPreviewConversationId(id)) {
      setConv(getSellerPreviewConversation(id) as unknown as ConvView);
      setMessaging({ blockedByMe: false, unavailable: false });
      await loadMessages(generation);
      if (generationRef.current === generation) setIsLoading(false);
      return;
    }
    try {
      const [c] = await Promise.all([
        api.conversations.get(id),
        loadMessages(generation),
      ]);
      if (generationRef.current !== generation) return;
      const convView = c as ConvView;
      setConv(convView);
      const safety = (c as { messaging?: DmMessagingState }).messaging;
      setMessaging({ blockedByMe: !!safety?.blockedByMe, unavailable: !!safety?.unavailable });
      // Mark the thread as read once we know it isn't a pending request —
      // per the Instagram-style request flow (same rule
      // app/buyer-conversation.tsx already follows), the sender of a
      // pending request must not see a read receipt until the RECIPIENT
      // actually accepts it. A seller who is the recipient here still gets
      // this the moment the thread loads, same as before; only the
      // isRequest case is now deferred to handleAcceptRequest below.
      if (!convView.isRequest) {
        api.conversations.markRead(id).catch(() => {
          notifyConversationReadFailure(id);
        });
      }
    } catch (e) {
      console.error('Failed to load conversation', e);
    } finally {
      if (generationRef.current === generation) setIsLoading(false);
    }
  }, [api, id, loadMessages]);

  useFocusEffect(useCallback(() => {
    const generation = ++generationRef.current;
    consecutiveFailuresRef.current = 0;
    loadAll(generation);
    pollRef.current = setInterval(() => loadMessages(generation), 15_000);
    return () => {
      if (pollRef.current !== null) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [api, id, loadAll, loadMessages]));

  // "X is typing…" needs a tighter cadence than the 15s message poll above
  // to read as live — same 3s cadence app/buyer-conversation.tsx's identical
  // poll uses. Merges just otherTyping into conv rather than replacing it
  // wholesale, so it never clobbers an in-flight local update elsewhere on
  // this screen. Skipped for a seeded preview thread (no real backend/
  // counterpart to poll).
  useFocusEffect(useCallback(() => {
    if (!id || isSellerPreviewConversationId(id)) return;
    const interval = setInterval(() => {
      api.conversations.get(id).then((fresh: { otherTyping?: boolean }) => {
        setConv((prev) => (prev ? { ...prev, otherTyping: fresh?.otherTyping } : prev));
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(interval);
  }, [api, id]));

  useEffect(() => () => {
    if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
  }, []);

  /** Real-time "X is typing…": tells the server I'm composing (once per
   *  burst of keystrokes) and schedules clearing it after a short pause —
   *  see app/buyer-conversation.tsx's identical helper. No-ops for a seeded
   *  preview thread (no real backend/counterpart). */
  function sendTypingSignal(hasText: boolean) {
    if (!id || isSellerPreviewConversationId(id)) return;
    if (typingClearTimerRef.current) { clearTimeout(typingClearTimerRef.current); typingClearTimerRef.current = null; }
    if (hasText) {
      if (!isTypingSentRef.current) {
        isTypingSentRef.current = true;
        api.conversations.setTyping(id, true).catch(() => {});
      }
      typingClearTimerRef.current = setTimeout(() => {
        isTypingSentRef.current = false;
        api.conversations.setTyping(id, false).catch(() => {});
      }, 3000);
    } else if (isTypingSentRef.current) {
      isTypingSentRef.current = false;
      api.conversations.setTyping(id, false).catch(() => {});
    }
  }

  function handleChangeText(next: string) {
    setText(next);
    sendTypingSignal(next.trim().length > 0);
  }

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
  // Item 72 (Thread Cash send in chat): the entry point always renders once
  // the feature flag is on, disabled with an explanation rather than
  // hidden — same affordance-check-only pattern as
  // app/buyer-conversation.tsx, including a mirrored mutual-follow check;
  // the server independently re-validates mutual follow at send AND claim.
  const threadCashSendEnabled = useFeatureFlag('threadCashSend');
  const [threadCashOverrides, setThreadCashOverrides] = useState<Record<string, ThreadCashTransferStatus>>({});
  const [threadCashMutual, setThreadCashMutual] = useState<boolean | null>(null);
  const [threadCashNotice, setThreadCashNotice] = useState<string | null>(null);
  const celebrateThreadCash = useCelebrateThreadCash();
  const threadCashDisabledReason = 'You can send Thread Cash to people who follow you back';

  useEffect(() => {
    let cancelled = false;
    if (!threadCashSendEnabled || !other?.userId) {
      setThreadCashMutual(null);
      return;
    }
    // Preview conversations have no real backend to check against — the
    // whole flow must be clickable end-to-end there, so treat them as an
    // already-confirmed mutual follow, same as the buyer screen.
    if (isSellerPreviewConversationId(id ?? '')) {
      setThreadCashMutual(true);
      return;
    }
    api.social.status(other.userId)
      .then((status) => { if (!cancelled) setThreadCashMutual(status.isMutual); })
      .catch(() => { if (!cancelled) setThreadCashMutual(false); });
    return () => { cancelled = true; };
  }, [threadCashSendEnabled, other?.userId, id, api]);
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
  // New every-role-pair DM/message-request routing: `conv.isRequest` and
  // `requestedBy` are the same for every viewer (conversation-level, not
  // per-viewer) — the current seller is the one who SENT it iff
  // `requestedBy` equals their own id, same test
  // app/buyer-conversation.tsx's isRequestMode should also make (see this
  // screen's isRequestMode/isRequestSender comment below for why only the
  // recipient sees the Accept/Delete/Block panel).
  const isRequestMode = conv?.isRequest === true;
  const isRequestSender = isRequestMode && conv?.requestedBy === effectiveMyId;
  // The server only blocks the RECIPIENT of a pending request from replying
  // (POST /api/conversations/:id/messages → 403 REQUEST_NOT_ACCEPTED) — the
  // sender can keep messaging freely while it's pending, so composer send
  // is only disabled for the recipient side of isRequestMode.
  const canSend = (text.trim().length > 0 || pendingAttachment != null) && !isSending && !!id
    && !(isRequestMode && !isRequestSender);
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

  // Item 144 — buyer context panel: this buyer's real order history with
  // THIS seller (server-scoped, see api-server's buyerId filter above).
  // Loaded on demand when the sheet first opens, then cached for the rest
  // of this screen's life — same lazy-load-once pattern as loadProducts.
  async function loadBuyerOrders() {
    if (!other?.userId) { setBuyerOrders([]); return; }
    // Preview/QA conversations have no real backend to call — use that
    // seed's own seeded order history (lib/previewInboxData.ts's
    // `buyerOrders`, [] when a seed sets none), same "seed or honest empty"
    // contract loadMessages' identical preview guard above already uses for
    // messages, rather than a real network call.
    if (isSellerPreviewConversationId(id ?? '')) { setBuyerOrders(getSellerPreviewBuyerOrders(id ?? '')); return; }
    setLoadingBuyerOrders(true);
    setBuyerOrdersError(false);
    try {
      const rows = await api.orders.listForBuyer(other.userId);
      setBuyerOrders(rows as BuyerOrderRow[]);
    } catch {
      setBuyerOrdersError(true);
    } finally {
      setLoadingBuyerOrders(false);
    }
  }

  function openBuyerContext() {
    if (!other) return;
    hapticPrimaryAction();
    setShowBuyerContext(true);
    if (buyerOrders === null && !loadingBuyerOrders) void loadBuyerOrders();
  }

  // ── Request mode: accept / delete / block ───────────────────────────────
  // Only reachable by the RECIPIENT of a pending request (isRequestMode &&
  // !isRequestSender) — see app/buyer-conversation.tsx's identical trio,
  // through lib/sellerRequestActions.ts's preview-aware wrappers instead of
  // lib/requestActions.ts's buyer ones.

  async function handleAcceptRequest() {
    if (!id || !conv || requestActionLoading) return;
    hapticPrimaryAction();
    setRequestActionLoading(true);
    const previousConv = conv;
    try {
      await acceptSellerConversationRequest(id, api);
      hapticSuccessAction();
      setConv({ ...previousConv, isRequest: false });
      // Composer takes the bottom panel's place the instant isRequestMode
      // flips false — hand it the keyboard right away, matching
      // app/buyer-conversation.tsx's identical accept flow.
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
    if (!id) return;
    hapticDestructiveConfirm();
    const conversationId = id;
    const name = displayName;
    scheduleDeleteSellerConversationRequest(conversationId, api);
    showUndo({
      message: `Deleted request from ${name}`,
      undo: () => undoDeleteSellerConversationRequest(conversationId),
      // Match the toast's own visible window to the real undo grace period
      // — see the same fix (and its doc comment) in
      // app/(buyer)/inbox.tsx's deleteRequestConversation.
      durationMs: DELETE_GRACE_MS,
    });
    goBackOr(router);
  }

  async function handleBlockRequest() {
    if (!id || !other) return;
    const confirmed = await confirmDestructiveActionSheet({
      title: `Block ${other.name}?`,
      message: BLOCK_EXPLAINER,
      confirmLabel: 'Block',
    });
    if (!confirmed) return;
    hapticDestructiveConfirm();
    try {
      await blockSellerConversationRequestUser(id, other);
      goBackOr(router);
    } catch (e) {
      Alert.alert('Couldn’t block', apiErrorMessage(e, 'Please check your connection and try again.'));
    }
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
    const token = ++mediaUploadTokenRef.current;
    // Stage the REAL picked photo(s) immediately via their local URIs, same
    // as app/buyer-conversation.tsx — meta.uploading drives MediaUploadThumb's
    // ring overlay until the real upload resolves below.
    const localUris = result.assets.map((a) => a.uri);
    setPendingAttachment({
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
      if (mediaUploadTokenRef.current !== token) return;
      if (!urls.length) { setPendingAttachment(null); return; }
      setPendingAttachment({
        type: 'image', uri: urls[0],
        title: urls.length > 1 ? `${urls.length} photos` : 'Photo',
        meta: { photoUris: JSON.stringify(urls) },
      });
    } catch {
      if (mediaUploadTokenRef.current === token) {
        setPendingAttachment(null);
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
    setPendingAttachment({ type: 'video', title: 'Video clip', meta: { duration: durationLabel, uploading: 'true' } });
    setIsUploading(true);
    try {
      const ext = (asset.uri.split('.').pop() ?? 'mp4').replace(/\?.*/, '');
      const url = await uploadMedia(asset.base64, 'video/mp4', ext);
      if (mediaUploadTokenRef.current !== token) return;
      setPendingAttachment({ type: 'video', uri: url, title: 'Video clip', meta: { duration: durationLabel } });
    } catch {
      if (mediaUploadTokenRef.current === token) {
        setPendingAttachment(null);
        Alert.alert('Upload failed', 'Could not upload video. Please try again.');
      }
    }
    finally { if (mediaUploadTokenRef.current === token) setIsUploading(false); }
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
          onViewTranscription={() => {
            setTranscriptionToast(true);
            setTimeout(() => setTranscriptionToast(false), 2600);
          }}
        />
      );
    }
    // 'product', 'order' and 'thread_cash' are handled standalone in
    // renderItem() before this function is ever called for them — see its
    // product/order branch (matches app/buyer-conversation.tsx's identical
    // standalone treatment, so a card looks identical from both sides of
    // the DM).
    return (
      <PressableScale
        style={s.attachCard}
        activeOpacity={att.type === 'post' ? 0.7 : 1}
        onPress={() => {
          if (att.type === 'post') {
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
        {att.type === 'post' && (
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
    sendTypingSignal(false);

    // Preview conversations have no real backend to post to — this branch
    // was previously missing here (unlike every other send path on this
    // screen, e.g. the Thread Cash onSent handler above), so sending a
    // message under ?bt_preview=seller hit the real API with a fake
    // conversation id and failed. Appends locally instead, same pattern as
    // app/buyer-conversation.tsx's identical branch, and has the simulated
    // buyer send back exactly one short auto-reply so the thread feels live.
    if (isSellerPreviewConversationId(id)) {
      const localMsg: Msg = {
        id: `local-${Date.now()}`,
        conversationId: id,
        fromId: effectiveMyId,
        fromName: 'You',
        fromInitials: 'Y',
        fromColor: PURPLE,
        text: t,
        attachment: att ?? undefined,
        replyToId: replyingTo?.id,
        replyPreview: replyingTo?.text,
        replyToAuthorName: replyingTo?.fromName,
        reactions: [],
        status: 'sent',
        ts: Date.now(),
      };
      setMessages((prev) => [...prev, localMsg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      setTimeout(() => {
        const reply: Msg = {
          id: `local-reply-${Date.now()}`,
          conversationId: id,
          fromId: other?.userId ?? 'preview-buyer',
          fromName: other?.name ?? 'Buyer',
          fromInitials: other?.initials ?? 'B',
          fromColor: other?.color ?? PURPLE,
          text: previewAutoReplyText(),
          reactions: [],
          status: 'sent',
          ts: Date.now(),
        };
        setMessages((prev) => [...prev, reply]);
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
      }, previewAutoReplyDelayMs());
      return;
    }

    setIsSending(true);
    try {
      const msg = await api.conversations.send(id, {
        text: t,
        attachment: att ?? undefined,
        replyToId: replyingTo?.id,
      });
      setMessages((prev) => [...prev, msg as Msg]);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      // REQUEST_NOT_ACCEPTED (403): the buyer's request was actually still
      // pending server-side even though this screen's own `conv.isRequest`
      // said otherwise — e.g. accepted from another device mid-race, or a
      // stale load right after the request landed. Same structured-error
      // presentation every other guard on this screen uses (BLOCKED,
      // BLOCKED_BY_ME, SELLER_ON_VACATION, …): the server's own message is
      // already a short, honest sentence, so it's surfaced as-is via
      // apiErrorMessage rather than a raw/ugly fallback — and the local
      // isRequest flag is corrected so the composer swaps to the real
      // Accept/Delete/Block panel instead of staying live to 403 again on
      // retry.
      if (apiErrorCode(e) === 'REQUEST_NOT_ACCEPTED') {
        setConv((prev) => (prev ? { ...prev, isRequest: true } : prev));
      }
      Alert.alert('Not sent', apiErrorMessage(e, 'Message not sent. Tap to retry.'));
      setText(t);
      setPendingAttachment(att);
      setReplyTo(replyingTo);
    } finally {
      setIsSending(false);
    }
  }

  // ── Reactions (item 68: chat reactions glass) ───────────────────────────────
  // Same data model/endpoint app/buyer-conversation.tsx uses (the reaction
  // rows/route are conversation-scoped, not buyer- or seller-specific — see
  // loadReactionsByMessage in artifacts/api-server/src/routes/conversations.ts)
  // — a seller reacting here shows up on the buyer's own thread view and
  // vice versa, with no separate implementation.

  function closeMessageSheet() {
    setActiveSheetMsg(null);
    setReactionAnchor(null);
  }

  function openReactionOverlay(msg: Msg) {
    hapticSelection();
    const node = bubbleAnchorRefs.current[msg.id];
    if (!node) { setActiveSheetMsg(msg); return; }
    node.measureInWindow((x, y, width, height) => {
      setReactionAnchor({ x, y, width, height });
      setActiveSheetMsg(msg);
    });
  }

  /** Optimistic add/remove with rollback — same reducer + call shape as
   *  app/buyer-conversation.tsx's handleReact, just against api.conversations
   *  directly (this screen doesn't go through services/socialService). */
  async function handleReact(msg: Msg, type: ReactionType) {
    if (!id) return;
    hapticSelection();
    const prevMessages = messages;
    const { next, isToggleOff } = applyOptimisticReaction(msg.reactions ?? [], myId, user?.fullName || user?.username || 'You', type);
    setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, reactions: next } : m)));
    try {
      if (isToggleOff) await api.conversations.removeReaction(id, msg.id);
      else await api.conversations.addReaction(id, msg.id, type);
    } catch {
      setMessages(prevMessages);
    }
  }

  function sheetCopy() {
    if (activeSheetMsg?.text) {
      Clipboard.setStringAsync(activeSheetMsg.text);
      hapticSuccessAction();
    }
    closeMessageSheet();
  }

  function sheetReport() {
    const msg = activeSheetMsg;
    closeMessageSheet();
    if (!msg || !other) return;
    openMessageOptions({ router, messageId: msg.id, text: msg.text, counterpart: { userId: other.userId, name: other.name } });
  }

  function sheetAttachmentLabel(msg: Msg): string {
    switch (msg.attachment?.type) {
      case 'image': return 'Photo';
      case 'video': return 'Video';
      case 'voice': return 'Voice message';
      case 'product': return msg.attachment.title ?? 'Product';
      case 'order': return msg.attachment.title ?? 'Order';
      case 'post': return msg.attachment.title ?? 'Post';
      case 'thread_cash': return 'Thread Cash';
      default: return '';
    }
  }

  const myReactionOnSheet = activeSheetMsg ? myReactionIn(activeSheetMsg.reactions ?? [], myId) : null;
  const isOwnSheetMsg = activeSheetMsg ? activeSheetMsg.fromId === effectiveMyId : false;

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
    const isOwn = msg.fromId === effectiveMyId;
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
    // A Thread Cash send is its own standalone row — not chat text, so it
    // never gets the colored bubble treatment, and it owns its own
    // Accept/Cancel controls, so it must never end up nested inside the
    // PressableScale bubble below (no nested pressables). Same early-return
    // pattern as app/buyer-conversation.tsx's identical case.
    if (msg.attachment?.type === 'thread_cash') {
      const transferId = msg.attachment.meta?.transferId ?? '';
      const senderId = msg.attachment.meta?.senderId ?? '';
      const amountCents = Number(msg.attachment.meta?.amountCents ?? 0);
      const status = threadCashOverrides[transferId] ?? ((msg.attachment.meta?.status as ThreadCashTransferStatus) ?? 'pending');
      return (
        <View style={[s.msgOuter, { justifyContent: isOwn ? 'flex-end' : 'flex-start', marginTop: isFirstInGroup ? SP.sm : 2 }]}>
          {!isOwn && (
            isLastInGroup ? (
              <View style={[s.msgAvatar, { backgroundColor: msg.fromColor || PURPLE }]}>
                <Text style={s.msgAvatarInitials}>{msg.fromInitials || (msg.fromName?.[0] ?? '?')}</Text>
              </View>
            ) : <View style={s.msgAvatarSpacer} />
          )}
          <View style={{ maxWidth: BUBBLE_MAX }}>
            <ThreadCashMessageCard
              amountCents={amountCents}
              note={msg.attachment.meta?.note || null}
              status={status}
              isRecipient={senderId !== effectiveMyId}
              isSender={senderId === effectiveMyId}
              onClaim={async () => {
                try {
                  if (isSellerPreviewConversationId(id ?? '')) {
                    setThreadCashOverrides((prev) => ({ ...prev, [transferId]: 'claimed' }));
                  } else {
                    await api.threadCash.claim({ transferId });
                    setThreadCashOverrides((prev) => ({ ...prev, [transferId]: 'claimed' }));
                  }
                  celebrateThreadCash({ amount: amountCents, from: msg.fromName || displayName });
                } catch (e: any) {
                  Alert.alert('Could not claim', e?.message ?? 'Please try again.');
                  throw e;
                }
              }}
              onCancel={senderId === effectiveMyId ? async () => {
                try {
                  if (isSellerPreviewConversationId(id ?? '')) {
                    setThreadCashOverrides((prev) => ({ ...prev, [transferId]: 'cancelled' }));
                  } else {
                    await api.threadCash.cancel({ transferId });
                    setThreadCashOverrides((prev) => ({ ...prev, [transferId]: 'cancelled' }));
                  }
                } catch (e: any) {
                  Alert.alert('Could not cancel', e?.message ?? 'Please try again.');
                  throw e;
                }
              } : undefined}
            />
          </View>
        </View>
      );
    }

    // Standalone product/order card (Dev's chat-card-redesign feedback) —
    // NEVER rendered inside the text-message bubble, same standalone
    // treatment as app/buyer-conversation.tsx so the card looks identical
    // from both sides of the DM. See components/chat/ChatAttachmentCard.tsx.
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
        <View style={[s.msgOuter, { justifyContent: isOwn ? 'flex-end' : 'flex-start', marginTop: isFirstInGroup ? SP.sm : 2 }]}>
          {!isOwn && (
            isLastInGroup ? (
              <View style={[s.msgAvatar, { backgroundColor: msg.fromColor || PURPLE }]}>
                <Text style={s.msgAvatarInitials}>{msg.fromInitials || (msg.fromName?.[0] ?? '?')}</Text>
              </View>
            ) : <View style={s.msgAvatarSpacer} />
          )}
          <ChatAttachmentCard
            theme={theme}
            isMe={isOwn}
            imageUri={isProduct ? att.uri : undefined}
            icon={isProduct ? 'shopping-bag' : 'package'}
            iconColor={PURPLE}
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
              } else {
                router.push((orderId ? '/order-detail?id=' + orderId : '/(tabs)/orders') as never);
              }
            }}
          />
        </View>
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
        <View style={{ maxWidth: BUBBLE_MAX }} collapsable={false} ref={(r) => { bubbleAnchorRefs.current[msg.id] = r; }}>
          <SwipeToReplyBubble
            testID={`seller-conversation-bubble-swipe-${msg.id}`}
            disabled={removed || messagingBlocked}
            iconColor={MUTED}
            iconBg={CARD}
            onReply={() => { setReplyTo(msg); }}
          >
          <PressableScale
            activeOpacity={0.9}
            disabled={removed}
            // Long-press always opens the reactions overlay (own or
            // incoming message); Report stays incoming-only inside that
            // overlay's own menu (see sheetReport below) — same one gesture
            // now covers both, instead of a second competing long-press.
            onLongPress={() => openReactionOverlay(msg)}
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
            accessibilityHint="Touch and hold to react or see more options"
            // Voice attachments render their own interactive control inside
            // this bubble — PressableScale defaults to rendering an actual
            // <button> on web, which cannot legally contain other
            // interactive controls. Drop the role so it's a plain, still
            // fully long-pressable <div> instead. Product/order cards no
            // longer render inside this bubble at all — see renderItem's
            // standalone product/order branch. See buyer-conversation.tsx.
            accessibilityRole={
              msg.attachment?.type === 'voice'
                ? 'none' : undefined
            }
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
            {/* Text — hide the single-space placeholder. Item 74 found and
                fixed a real bug here: `msg.text && msg.text.trim().length >
                0 && (...)` renders the literal empty string as a stray text
                node (a direct child of this bubble's View) whenever
                msg.text is exactly '' — the short-circuit stops at the
                falsy '' itself rather than reaching a boolean, which is
                exactly what every attachment-only message (voice, image,
                video, product, etc.) sends as its text. A ternary, like
                app/buyer-conversation.tsx already uses for this same spot,
                always resolves to either the Text element or null. */}
            {removed ? (
              <Text style={[s.msgText, { color: isOwn ? sentTextColor : MUTED, fontStyle: 'italic' }]}>{REMOVED_MESSAGE_TEXT}</Text>
            ) : (msg.text?.trim().length ?? 0) > 0 ? (
              <Text style={[s.msgText, { color: isOwn ? sentTextColor : receivedTextColor }]}>{msg.text}</Text>
            ) : null}

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

          {/* Reaction pill row — same summary treatment as
              app/buyer-conversation.tsx (emoji + count, mine highlighted). */}
          {(() => {
            const reactionEntries = groupReactionCounts(msg.reactions ?? []);
            const mine = myReactionIn(msg.reactions ?? [], myId);
            if (reactionEntries.length === 0) return null;
            return (
              <View style={[s.reactionsRow, isOwn ? { alignSelf: 'flex-end' } : { alignSelf: 'flex-start' }]}>
                {reactionEntries.map(([kind, count]) => (
                  <PressableScale rippleEnabled={false}
                    key={kind}
                    style={[
                      s.reactionChip,
                      { backgroundColor: mine === kind ? PURPLE_DIM : CARD, borderColor: mine === kind ? PURPLE : BORDER },
                    ]}
                    onPress={() => handleReact(msg, kind)}
                    activeOpacity={0.7}
                    testID={`reaction-chip-${msg.id}-${kind}`}
                  >
                    <ReactionGlyph type={kind} size={12} />
                    <Text style={[s.reactionCount, { color: mine === kind ? PURPLE : MUTED }]}>{count}</Text>
                  </PressableScale>
                ))}
              </View>
            );
          })()}

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

  const pendingAttachmentChip = pendingAttachment && (() => {
        const uploadingMedia = pendingAttachment.meta?.uploading === 'true';
        const isMedia = pendingAttachment.type === 'image' || pendingAttachment.type === 'video';
        return (
        <View style={s.pendingAttachRow} testID="seller-conversation-selected-attachment">
          {isMedia ? (
            <MediaUploadThumb
              type={pendingAttachment.type as 'image' | 'video'}
              uri={pendingAttachment.type === 'image' ? pendingAttachment.uri : undefined}
              uploading={uploadingMedia}
              size={40}
              ringColor={PURPLE}
              iconColor={MUTED}
              trackColor={BORDER}
            />
          ) : isUploading ? (
            <UploadRing size={22} color={PURPLE} trackColor={BORDER} />
          ) : (
            <Feather name={attachmentIcon(pendingAttachment.type)} size={ICON.sm} color={PURPLE} />
          )}
          <View style={{ flex: 1, marginLeft: SP.sm }}>
            <Text style={s.pendingAttachTitle} numberOfLines={1}>
              {uploadingMedia ? 'Uploading…' : pendingAttachment.title}
            </Text>
            {pendingAttachment.subtitle ? (
              <Text style={s.pendingAttachSub} numberOfLines={1}>{pendingAttachment.subtitle}</Text>
            ) : null}
          </View>
          <PressableScale
            onPress={() => { mediaUploadTokenRef.current++; setPendingAttachment(null); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={uploadingMedia ? 'Cancel upload' : 'Remove attachment'}
            testID="seller-conversation-selected-attachment-remove"
          >
            <Feather name="x" size={ICON.sm} color={MUTED} />
          </PressableScale>
        </View>
        );
      })();

  const replyBanner = replyTo && !messagingBlocked && !(isRequestMode && !isRequestSender) && (
        <ReplyBanner
          testID="seller-conversation-reply-banner"
          theme={theme}
          fromName={replyTo.fromName}
          previewText={messagePreviewText(replyTo)}
          onCancel={() => setReplyTo(null)}
        />
      );

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
      <View style={[s.header, { paddingTop: headerTopInset + SP.sm, paddingRight: SP.md + insets.right }]}>
        <View style={s.headerLeftGroup}>
          <PressableScale
            onPress={() => { hapticPrimaryAction(); goBackOr(router); }}
            style={s.headerBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Feather name="arrow-left" size={ICON.lg} color={FG} />
          </PressableScale>
          {/* PressableScale forwards `style` only to its inner Animated.View,
              never to the outer Pressable node that actually participates in
              headerLeftGroup's row layout (same root cause as the Messages-
              button width bug fixed earlier this round) — so the flex/
              minWidth constraints that let the name truncate have to live on
              a plain wrapping View instead of on the PressableScale itself. */}
          <View style={s.headerCenterWrap}>
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
                <Text style={s.headerName} numberOfLines={1} ellipsizeMode="tail">{displayName}</Text>
                {/* Real-time "X is typing…" (conv.otherTyping) takes priority
                    over the static handle line when present — same field/poll
                    app/buyer-conversation.tsx's statusLine reads, just no
                    existing subtitle slot there to reuse before now. */}
                {conv?.otherTyping
                  ? <Text style={s.headerHandle} numberOfLines={1}>typing…</Text>
                  : (other?.handle ? <Text style={s.headerHandle} numberOfLines={1}>{other.handle}</Text> : null)}
              </View>
            </PressableScale>
          </View>
        </View>

        {/* Icon group hard-right-aligned to the header edge, per Mobbin
            (mobbin.com/screens/db4e29c8-e47e-47ce-8f01-b7a98376c6e7) — not
            centered/adjacent to the name. s.header's justifyContent:
            'space-between' pushes this group to the far right. */}
        <View style={s.headerIconGroup}>
          {id && (
            <>
              <PressableScale
                style={s.headerCallBtn}
                onPress={() => { hapticPrimaryAction(); handleStartCall('voice'); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Voice call"
              >
                <Feather name="phone" size={ICON.lg} color={MUTED} />
              </PressableScale>
              <PressableScale
                style={s.headerCallBtn}
                onPress={() => { hapticPrimaryAction(); handleStartCall('video'); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Video call"
              >
                <Feather name="video" size={ICON.lg} color={MUTED} />
              </PressableScale>
            </>
          )}
          {other ? (
            <PressableScale
              style={s.headerCallBtn}
              onPress={openBuyerContext}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="seller-conversation-buyer-context-btn"
              accessibilityRole="button"
              accessibilityLabel={`${displayName} — orders and cart`}
            >
              <Feather name="clipboard" size={ICON.lg} color={MUTED} />
            </PressableScale>
          ) : null}
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
              <Feather name="more-horizontal" size={ICON.lg} color={FG} />
            </PressableScale>
          ) : null}
        </View>
      </View>

      {/* Request-mode profile header — RECIPIENT view only (a seller who
          sent the request keeps the ordinary composer plus the "Sent as a
          request" indicator below; only whoever is reviewing an incoming
          request gets this bigger lead-in). Mirrors
          app/buyer-conversation.tsx's identical requestProfileHeader. */}
      {isRequestMode && !isRequestSender && other && (
        <View style={s.requestProfileHeader} testID="seller-conversation-request-profile-header">
          <View style={[s.requestProfileAvatar, { backgroundColor: other.color || PURPLE }]}>
            <Text style={s.requestProfileAvatarInitials}>
              {other.initials || (other.name?.[0] ?? '?').toUpperCase()}
            </Text>
          </View>
          <Text style={s.requestProfileName} numberOfLines={1}>{other.name}</Text>
          {!!other.handle && (
            <Text style={s.requestProfileHandle} numberOfLines={1}>{other.handle}</Text>
          )}
          <PressableScale
            style={s.requestProfilePill}
            onPress={() => {
              hapticPrimaryAction();
              const qs = new URLSearchParams({
                userId: other.userId, name: other.name,
                handle: other.handle ?? '', initials: other.initials ?? '',
                color: other.color ?? PURPLE,
              });
              router.push(('/buyer-other-profile?' + qs.toString()) as never);
            }}
            accessibilityRole="button"
            accessibilityLabel={`View ${other.name}'s profile`}
            testID="seller-conversation-request-view-profile"
          >
            <Text style={s.requestProfilePillText}>View profile</Text>
          </PressableScale>
        </View>
      )}

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



      {/* "Sent as a request" — the SENDER's own view of a pending request
          thread (Dev's rule 3): the seller keeps the ordinary composer (the
          server only blocks the recipient from replying), but sees this
          short indicator instead of the Accept/Delete/Block panel below,
          which only the recipient gets. */}
      {isRequestSender && !messagingBlocked && (
        <View style={s.sentRequestBanner} testID="seller-conversation-sent-request-banner">
          <Feather name="clock" size={ICON.sm} color={MUTED} />
          <Text style={s.sentRequestBannerText}>
            Sent as a message request — {displayName} hasn't accepted it yet
          </Text>
        </View>
      )}

      {/* Input row — request mode replaces the composer entirely with the
          accept/block/delete bottom panel for the RECIPIENT only (see
          SellerRequestActionPanel below); the sender keeps the ordinary
          composer plus the "Sent as a request" banner above. */}
      {isRequestMode && !isRequestSender && other ? (
        <SellerRequestActionPanel
          name={other.name}
          bottomInset={insets.bottom}
          loading={requestActionLoading}
          onAccept={handleAcceptRequest}
          onDelete={handleDeleteRequest}
          onBlock={handleBlockRequest}
        />
      ) : messagingBlocked && other ? (
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
      voiceRecorder.phase !== 'idle' ? (
        <View style={[s.voiceBarWrap, { paddingBottom: Math.max(insets.bottom, SP.sm) + SP.sm }]}>
          {pendingAttachmentChip}
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
        </View>
      ) : (
        <Composer
          testID="seller-conversation"
          value={text}
          onChangeText={handleChangeText}
          onSend={() => { hapticPrimaryAction(); handleSend(); }}
          canSend={canSend}
          placeholder="Message…"
          inputRef={textInputRef}
          topSlot={<>{replyBanner}{pendingAttachmentChip}</>}
          leftAccessory={
            <PressableScale
              style={s.cameraCircleBtn}
              onPress={() => { hapticPrimaryAction(); setShowMediaSheet(true); }}
              disabled={isUploading || isSending}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="seller-conversation-attach"
              accessibilityRole="button"
              accessibilityLabel="Photo or video"
            >
              {isUploading
                ? <ActivityIndicator size="small" color="#000000" />
                : <Feather name="camera" size={18} color="#000000" />
              }
            </PressableScale>
          }
          rightAccessory={<>
            {/* Products / posts / files picker */}
            <PressableScale
              style={s.accBtn}
              onPress={() => { hapticPrimaryAction(); openAttachPicker(); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="seller-conversation-attach-picker"
              accessibilityRole="button"
              accessibilityLabel="Attach"
            >
              <Feather name="paperclip" size={20} color={pendingAttachment ? PURPLE : MUTED} />
            </PressableScale>

            {/* Voice — tap-to-toggle on every platform (see docs/dm-flows.md) */}
            <PressableScale
              style={s.accBtn}
              onPress={() => { void voiceRecorder.startWeb(); }}
              disabled={isUploading || isSending}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              testID="seller-conversation-mic"
              accessibilityRole="button"
              accessibilityLabel="Record voice message"
            >
              <Feather name="mic" size={20} color={MUTED} />
            </PressableScale>

            {/* Item 72 — same Thread Cash entry point as
                app/buyer-conversation.tsx; disabled with an explanation
                rather than hidden until mutual follow is confirmed. */}
        {threadCashSendEnabled && other?.userId ? (
          <ThreadCashAttachButton
            recipientId={other.userId}
            recipientName={other.name}
            recipientHandle={other.handle}
            conversationId={id ?? ''}
            disabled={threadCashMutual !== true}
            disabledReason={threadCashDisabledReason}
            renderTrigger={(open) => (
              <PressableScale
                style={s.accBtn}
                onPress={() => {
                  // Still checking mutual-follow status — silent no-op,
                  // never a "checking…" string (see the disabled state's
                  // own comment above).
                  if (threadCashMutual === null) return;
                  if (threadCashMutual === false) {
                    setThreadCashNotice(threadCashDisabledReason);
                    return;
                  }
                  open();
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                testID="seller-conversation-thread-cash"
                accessibilityRole="button"
                accessibilityLabel={threadCashMutual !== true ? `Thread Cash — ${threadCashDisabledReason}` : 'Send Thread Cash'}
                accessibilityState={{ disabled: threadCashMutual !== true }}
              >
                <ThreadCashBillMark size={20} color={FG} accent={PURPLE} disabled={threadCashMutual !== true} />
              </PressableScale>
            )}
            onSent={async ({ transferId, amountCents, note }) => {
              if (!id) return;
              const attachment: MsgAttachment = {
                type: 'thread_cash',
                title: 'Thread Cash',
                meta: {
                  transferId,
                  senderId: myId || 'me',
                  amountCents: String(amountCents),
                  status: 'pending',
                  ...(note ? { note } : {}),
                },
              };
              // Preview conversations have no real backend to post to —
              // append a local mock message, same as the media/voice
              // handlers above.
              if (isSellerPreviewConversationId(id)) {
                setMessages((prev) => [...prev, {
                  id: `local-thread-cash-${transferId}`,
                  conversationId: id,
                  fromId: effectiveMyId,
                  fromName: 'You',
                  fromInitials: 'Y',
                  fromColor: PURPLE,
                  text: '',
                  attachment,
                  reactions: [],
                  status: 'sent',
                  ts: Date.now(),
                }]);
                setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
                return;
              }
              try {
                const msg = await api.conversations.send(id, { text: '', attachment });
                setMessages((prev) => [...prev, msg as Msg]);
                setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
              } catch (e: any) {
                Alert.alert('Sent, but the chat message failed', e?.message ?? 'The Thread Cash send went through — refresh to see it in chat.');
              }
            }}
          />
        ) : null}
          </>}
        />
      )
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
            <PressableScale accessibilityLabel="Close" onPress={() => setShowProductPicker(false)}>
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

      {/* ── Buyer context panel (item 144) ──────────────────────────────────
          Mobbin: Binance's chat-attached context drawer surfacing account
          data from a conversation header (mobbin.com/screens/4b0152e6-df33-
          4d73-aa39-2b1a6cc4c8cd) and eBay's inline buyer/item card in seller
          chat (mobbin.com/screens/1ffce781-c643-4728-895c-a322433564c0) — no
          exact "seller inbox buyer CRM/context panel" exists on Mobbin, so
          this combines those two: a drawer off the header, surfacing this
          buyer's REAL order history with this seller (server-scoped, see
          api-server's GET /api/orders buyerId filter). Cart is honestly
          omitted below — see the note in that empty section. */}
      <Modal
        visible={showBuyerContext}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBuyerContext(false)}
      >
        <PressableScale
          style={s.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowBuyerContext(false)}
        />
        <SheetRise style={[s.buyerContextSheetWrap, { paddingBottom: insets.bottom + SP.md }]}>
          <Glass variant="regular" tint="dark" radius={RADIUS.xl} style={StyleSheet.absoluteFill} />
          <View style={s.sheetHandle} />
          <View style={s.buyerContextHeader}>
            {other && (
              <View style={[s.headerAvatar, { backgroundColor: other.color || PURPLE, marginRight: SP.sm }]}>
                <Text style={s.headerAvatarInitials}>
                  {other.initials || (other.name?.[0] ?? '?').toUpperCase()}
                </Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={s.sheetTitle}>{displayName}</Text>
              <Text style={s.buyerContextSubtitle}>Orders with you</Text>
            </View>
            <PressableScale onPress={() => setShowBuyerContext(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Close">
              <Feather name="x" size={ICON.md} color={MUTED} />
            </PressableScale>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 420 }}>
            {loadingBuyerOrders ? (
              <View style={{ paddingVertical: SP.lg }}>
                <SkeletonBlock width="100%" height={56} radius={RADIUS.md} />
                <View style={{ height: SP.sm }} />
                <SkeletonBlock width="100%" height={56} radius={RADIUS.md} />
              </View>
            ) : buyerOrdersError ? (
              <View style={s.emptyState}>
                <Feather name="alert-circle" size={28} color={MUTED} />
                <Text style={s.emptyText}>Couldn't load {displayName}'s orders</Text>
                <PressableScale style={s.buyerContextRetry} onPress={() => void loadBuyerOrders()} accessibilityRole="button" accessibilityLabel="Retry">
                  <Text style={s.buyerContextRetryText}>Retry</Text>
                </PressableScale>
              </View>
            ) : (buyerOrders?.length ?? 0) === 0 ? (
              <View style={s.emptyState}>
                <Feather name="package" size={28} color={MUTED} />
                <Text style={s.emptyText}>No other orders from {displayName} yet</Text>
              </View>
            ) : (
              buyerOrders!.map((row) => {
                const uiStatus = dbStatusToOrderStatus(row.status);
                const dateLabel = new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return (
                  <PressableScale
                    key={row.id}
                    style={s.buyerContextOrderRow}
                    activeOpacity={0.7}
                    testID={`buyer-context-order-${row.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.orderNumber}, ${orderStatusBadgeLabel(uiStatus)}, ${formatCents(row.totalCents)}`}
                    onPress={() => {
                      hapticSelection();
                      setShowBuyerContext(false);
                      router.push(('/order-detail?id=' + row.id) as never);
                    }}
                  >
                    <View style={s.orderMsgCardIconCircle}>
                      <Feather name="package" size={ICON.md} color={PURPLE} />
                    </View>
                    <View style={{ flex: 1, marginLeft: SP.sm }}>
                      <Text style={s.attachTitle} numberOfLines={1}>{row.orderNumber}</Text>
                      <View style={s.orderMsgCardBadgeRow}>
                        <StatusBadge label={orderStatusBadgeLabel(uiStatus)} variant={orderStatusBadgeVariant(uiStatus)} small />
                        <Text style={s.buyerContextOrderMeta}>
                          {'  ·  '}{dateLabel}{row.itemCount ? ` · ${row.itemCount} item${row.itemCount === 1 ? '' : 's'}` : ''}
                        </Text>
                      </View>
                    </View>
                    <Text style={s.buyerContextOrderTotal}>{formatCents(row.totalCents)}</Text>
                    <Feather name="chevron-right" size={ICON.xs} color={MUTED} style={{ marginLeft: SP.xs }} />
                  </PressableScale>
                );
              })
            )}

            {/* Cart — honestly omitted. Brandthread's cart (lib/db's
                cart_items table, see api-server's cart-db.ts) is
                self-scoped storage keyed only by the shopper's own userId —
                every route that reads it filters `WHERE userId = <the
                authenticated caller>`, with no seller-facing endpoint or
                concept of "whose cart is this seller's product in" at all.
                There's nothing real to show here, so rather than fabricate
                a cart panel to check a box, this says so plainly instead —
                same honesty this pass has used elsewhere tonight (items
                70/71) when a Mobbin precedent didn't map onto real,
                queryable Brandthread data. */}
            <View style={s.buyerContextCartNote}>
              <Feather name="shopping-cart" size={16} color={SUBTLE} />
              <Text style={s.buyerContextCartNoteText}>
                Cart contents are private to the buyer — Brandthread doesn't give sellers visibility into what's in someone's cart before checkout.
              </Text>
            </View>
          </ScrollView>
        </SheetRise>
      </Modal>

      {/* Long-press reactions — Glass overlay, same component/behavior as
          app/buyer-conversation.tsx (Mobbin: Instagram DM "Tap and hold to
          super react" — mobbin.com/screens/5d13fdd9-75ad-43d6-9089-
          7b236e362b73). */}
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
            { key: 'copy', label: 'Copy', icon: 'copy', onPress: sheetCopy },
            !isOwnSheetMsg && other
              ? { key: 'report', label: 'Report message', icon: 'flag', destructive: true, onPress: sheetReport }
              : null,
          ].filter(Boolean) as ReactionOverlayMenuItem[]
        ) : []}
        onClose={closeMessageSheet}
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
          if (!other?.userId) return;
          try {
            await api.social.follow(other.userId);
            hapticSuccessAction();
          } catch {
            // Best-effort — the composer button stays disabled until the
            // next mutual-follow check confirms it either way.
          }
        }}
        onDismiss={() => setThreadCashNotice(null)}
      />
    </KeyboardAvoidingView>
  );
}

// ─── Request-mode bottom panel ─────────────────────────────────────────────────
// Seller-side mirror of app/buyer-conversation.tsx's RequestActionPanel —
// same three-way row (Block / Delete / Accept, Accept the sole filled/
// primary action), only reachable by the RECIPIENT of a pending request.
function SellerRequestActionPanel({
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
      testID="seller-conversation-request-panel"
    >
      <Text style={[rs.title, { color: theme.text }]}>{name} wants to send you a message</Text>
      <Text style={[rs.subline, { color: theme.muted }]}>
        Accepting lets them see when you’ve read their messages and message you freely.
      </Text>
      <View style={rs.actionsRow}>
        <PressableScale
          style={rs.actionBtn}
          onPress={onBlock}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Block ${name}`}
          testID="seller-conversation-request-block"
        >
          <Text style={[rs.actionText, { color: theme.error }]}>Block</Text>
        </PressableScale>
        <PressableScale
          style={rs.actionBtn}
          onPress={onDelete}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Delete request from ${name}`}
          testID="seller-conversation-request-delete"
        >
          <Text style={[rs.actionText, { color: theme.text }]}>Delete</Text>
        </PressableScale>
        <PressableScale
          style={[rs.actionBtn, { backgroundColor: theme.accent }]}
          onPress={onAccept}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Accept message request from ${name}`}
          testID="seller-conversation-request-accept"
        >
          {loading ? (
            <ActivityIndicator color={theme.onAccent} size="small" />
          ) : (
            <Text style={[rs.actionText, { color: theme.onAccent }]}>Accept</Text>
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
  actionText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});

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
    // Left group (back + avatar + name) stays left; the icon group is
    // pushed to the far right edge — not centered/adjacent to the name.
    justifyContent: 'space-between',
    backgroundColor: BG,
    // Right edge padding is set inline (needs insets.right) — see the
    // header's own JSX. Mobbin: Instagram DM header
    // (mobbin.com/screens/db4e29c8-e47e-47ce-8f01-b7a98376c6e7) — the icon
    // group is hard-right-aligned to the edge, evenly spaced, 16pt inset
    // from the screen edge.
    paddingLeft: SP.md, paddingBottom: SP.sm,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  // flex: 1 + minWidth: 0 all the way down this chain (leftGroup ->
  // centerRow -> center -> name) is what actually lets the name truncate
  // instead of overlapping the call/video/context icons for a long name —
  // flexShrink alone isn't enough on React Native Web, where a flex item's
  // default min-width is its own content width ("auto"), not 0, so it never
  // shrinks below that no matter how little room justifyContent: 'space-
  // between' leaves it (confirmed live: "Torres" overlapping the phone
  // glyph with 3 action icons + the overflow menu in the icon group).
  headerLeftGroup: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  headerIconGroup: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  headerBack: { marginRight: SP.sm },
  headerAvatar: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', marginRight: SP.sm,
  },
  headerAvatarInitials: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  // The actual flex/minWidth constraint has to live here, on a plain View —
  // see the JSX's own comment on why it can't live on the PressableScale
  // (headerCenterRow) that wraps the avatar+name row.
  headerCenterWrap: { flex: 1, minWidth: 0 },
  headerCenterRow: { flexDirection: 'row', alignItems: 'center' },
  headerCenter: { flex: 1, minWidth: 0 },
  headerName: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, flexShrink: 1, minWidth: 0 },
  headerHandle: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 1 },

  // Request-mode profile header (avatar / name / @handle / "View profile") —
  // same shape as app/buyer-conversation.tsx's identical styles, RECIPIENT
  // view only (see the JSX's own comment).
  requestProfileHeader: { alignItems: 'center', paddingVertical: SP.lg, paddingHorizontal: SP.lg, gap: 4 },
  requestProfileAvatar: {
    width: 88, height: 88, borderRadius: 44,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: SP.sm,
  },
  requestProfileAvatarInitials: { fontSize: FS.xl, fontFamily: FONT.bold, color: '#FFFFFF' },
  requestProfileName: { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  requestProfileHandle: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, marginBottom: SP.sm },
  requestProfilePill: {
    height: 34, paddingHorizontal: SP.md, borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  requestProfilePillText: { fontSize: FS.xs, fontFamily: FONT.semibold, color: FG },

  // "Sent as a request" indicator — the SENDER's own view of a pending
  // request thread (see the JSX's own comment).
  sentRequestBanner: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs,
    marginHorizontal: SP.md, marginBottom: SP.xs, paddingVertical: SP.sm, paddingHorizontal: SP.md,
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
  },
  sentRequestBannerText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, lineHeight: 16 },

  orderCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: SP.md, marginVertical: SP.sm, padding: SP.sm,
    backgroundColor: CARD, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER,
  },
  orderNumber: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  orderProduct: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 2 },
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
  // Reaction pill row (item 68) — same treatment as buyer-conversation.tsx.
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, borderWidth: 1,
  },
  reactionCount: { fontSize: 11, fontFamily: FONT.semibold },
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
  attachSubtitle: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 1 },

  // Product/order chat cards (item 70/71) moved to the standalone
  // ChatAttachmentCard component (components/chat/ChatAttachmentCard.tsx) —
  // no bubble, no border, own the tap target. See renderItem's product/
  // order branch.

  pendingAttachRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: SP.md, marginBottom: SP.xs,
    padding: SP.sm,
    backgroundColor: PURPLE_DIM, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER_ACTIVE,
  },
  pendingAttachTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  pendingAttachSub: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 1 },

  // Attach trigger left of the pill — solid white circle, black glyph.
  cameraCircleBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth, borderColor: BORDER,
  },
  // Inside-the-pill controls (attach picker, mic, Thread Cash coin).
  accBtn: {
    width: 32, height: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  voiceBarWrap: {
    paddingHorizontal: SP.md, paddingTop: SP.sm, backgroundColor: BG,
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
  sheetOptionDesc: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 2 },

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
  productPrice: { fontSize: FS.meta, fontFamily: FONT.medium, color: MUTED, marginTop: 2 },
  emptyState: { alignItems: 'center', paddingVertical: SP.xxl },
  emptyText: { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, marginTop: SP.sm, textAlign: 'center', paddingHorizontal: SP.lg },

  // Buyer context panel (item 144)
  buyerContextSheetWrap: {
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm, paddingHorizontal: SP.md,
    overflow: 'hidden',
  },
  buyerContextHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: SP.sm },
  buyerContextSubtitle: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: -SP.sm + 2 },
  buyerContextOrderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: SP.sm, marginBottom: SP.xs,
    borderRadius: RADIUS.md,
  },
  // Compact icon circle + badge row for a buyer-context list row (smaller
  // than components/chat/ChatAttachmentCard.tsx's 56×56 — that one fills a
  // full-width chat card, this is one row in a scrollable list).
  orderMsgCardIconCircle: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: CARD,
  },
  orderMsgCardBadgeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  buyerContextOrderMeta: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  buyerContextOrderTotal: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG, marginLeft: SP.xs },
  buyerContextRetry: {
    marginTop: SP.sm, paddingVertical: SP.xs, paddingHorizontal: SP.md,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: BORDER,
  },
  buyerContextRetryText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE },
  buyerContextCartNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm,
    marginTop: SP.md, marginBottom: SP.lg,
    paddingTop: SP.md, borderTopWidth: 1, borderTopColor: BORDER,
  },
  buyerContextCartNoteText: { flex: 1, fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, lineHeight: 17 },

  // ── Call + media styles ──────────────────────────────────────────────────────
  headerCallBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
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
