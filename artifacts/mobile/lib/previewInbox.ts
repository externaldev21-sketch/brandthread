/**
 * Seeded PREVIEW buyer inbox.
 *
 * Mirrors lib/previewCatalog.ts's pattern exactly: the buyer Messages tab
 * (app/(buyer)/inbox.tsx) and an opened thread (app/buyer-conversation.tsx)
 * have nothing real to show without a live backend and real conversations,
 * so every call renders the generic empty state — which made the PR #75
 * inbox redesign invisible in the dev-web preview. This gives those two
 * screens a small, real-looking set of threads/messages to render instead.
 *
 * Gating: `isPreviewInboxEnabled()` reuses `isPreviewCatalogEnabled()` from
 * previewCatalog.ts (same gate, not a new one) — true only when `__DEV__` is
 * true (stripped to `false`, dead code, in every production build) AND, on
 * web, only for a non-production API base URL. Every call site must:
 *   1. Try the real API first.
 *   2. Only fall back to this seed data when the real call returns nothing
 *      (or fails outright, e.g. no backend reachable in the web preview).
 *   3. Never run for a real signed-in production account.
 */
import { Asset } from 'expo-asset';
import { isPreviewCatalogEnabled } from './previewCatalog';
import {
  BRANDTHREAD_AGENT_SEED, PREVIEW_CONVERSATION_SEEDS, PREVIEW_FOLLOWER_SEEDS,
  SELLER_PREVIEW_CONVERSATION_SEEDS,
  type PreviewConversationSeed, type PreviewMessageSeed,
} from './previewInboxData';
import type {
  Conversation, Message, MessageAttachment, MessageReaction, Notification, ReactionType,
} from '@/services/socialTypes';
import { acceptConversationInList, removeConversationFromList } from './conversationListMutations';

export function isPreviewInboxEnabled(): boolean {
  return isPreviewCatalogEnabled();
}

// Same 10 fashion preview posters previewCatalog.ts uses, reused here as
// stand-in conversation avatars/attachment thumbnails so the whole buyer
// preview reads as one consistent world instead of two unrelated fake sets.
const POSTER_SOURCES = [
  require('../assets/videos/fashion_runway_01.jpg'),
  require('../assets/videos/fashion_runway_02.jpg'),
  require('../assets/videos/fashion_runway_03.jpg'),
  require('../assets/videos/fashion_runway_04.jpg'),
  require('../assets/videos/fashion_runway_05.jpg'),
  require('../assets/videos/fashion_runway_06.jpg'),
  require('../assets/videos/fashion_runway_07.jpg'),
  require('../assets/videos/fashion_runway_08.jpg'),
  require('../assets/videos/fashion_runway_09.jpg'),
  require('../assets/videos/fashion_runway_10.jpg'),
];

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO_SOURCE = require('../assets/images/brandthread-logo.png');

// Item 73 (voice note waveform playback progress): the only bundled audio
// asset in the app (assets/sounds/order_received.wav — registered for real by
// expo-notifications, see its own README.md) reused purely as a real,
// playable audio source for a seeded voice-message bubble. There is no real
// voice recording available in this sandbox to seed instead, and no network
// access to fetch one; requiring it here only reads its bundled file URI, it
// does not touch its separate notification-sound registration. Its actual
// length is ~1.28s — short for a voice note, but real: the seeded duration
// label below (VOICE_NOTE_DURATION_SEC) matches it exactly so the label and
// the live waveform position never drift apart.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const VOICE_NOTE_SOURCE = require('../assets/sounds/order_received.wav');
export const VOICE_NOTE_DURATION_SEC = 1.3;

export function voiceNoteUri(): string {
  return Asset.fromModule(VOICE_NOTE_SOURCE).uri;
}

// Exported so other preview seed modules (e.g. lib/previewStories.ts, the
// Messages stories tray) can reuse the same 10 bundled runway photos as
// avatar/story-slide images instead of re-requiring the assets themselves.
export function posterUri(index: number): string {
  return Asset.fromModule(POSTER_SOURCES[index]).uri;
}

function logoUri(): string {
  return Asset.fromModule(LOGO_SOURCE).uri;
}

function avatarUriFor(seed: PreviewConversationSeed): string | undefined {
  if (seed.isBrandMark) return logoUri();
  if (typeof seed.posterIndex === 'number') return posterUri(seed.posterIndex);
  return undefined;
}

const ID_PREFIX = 'preview-conversation-';

/** True for any conversation id this module can serve messages/details for. */
export function isPreviewConversationId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(ID_PREFIX);
}

function allSeeds(): PreviewConversationSeed[] {
  return [BRANDTHREAD_AGENT_SEED, ...PREVIEW_CONVERSATION_SEEDS];
}

function seedById(id: string): PreviewConversationSeed | undefined {
  return allSeeds().find(s => s.id === id);
}

function toConversation(seed: PreviewConversationSeed): Conversation {
  const now = Date.now();
  const ts = now - seed.minutesAgo * 60_000;
  return {
    id: seed.id,
    type: 'buyer_to_seller',
    participants: [{
      userId: seed.participantUserId,
      name: seed.participantName,
      handle: seed.participantHandle,
      initials: seed.participantInitials,
      color: seed.participantColor,
      accountType: 'seller',
      avatarUri: avatarUriFor(seed),
    }],
    lastMessage: seed.lastMessage,
    lastMessageTs: ts,
    lastMessageSenderId: seed.lastMessageFromMe ? 'me' : seed.participantUserId,
    lastMessageType: seed.lastMessageType,
    unreadCount: seed.unreadCount,
    isFriendshipActive: true,
    isArchived: false,
    isRequest: seed.isRequest,
    contextOrderNumber: seed.contextOrderNumber,
    contextProductName: seed.contextProductName,
    updatedAt: new Date(ts).toISOString(),
    isPinned: seed.isPinned,
    isOfficial: seed.isOfficial,
  };
}

let cachedConversations: Conversation[] | null = null;

/** The full seeded preview inbox (Brandthread Agent pinned first, then 10
 *  ordinary threads) — sorted pinned-first, otherwise unchanged. Callers
 *  must still gate on `isPreviewInboxEnabled()` and prefer real API data. */
export function getPreviewConversations(): Conversation[] {
  if (!cachedConversations) cachedConversations = allSeeds().map(toConversation);
  return cachedConversations;
}

export function getPreviewConversation(id: string): Conversation | null {
  return getPreviewConversations().find(c => c.id === id) ?? null;
}

/**
 * Accepts a seeded message request in place: flips `isRequest` off, bumps
 * `updatedAt` and moves it to the front of the module-level cache — mimicking
 * what the real backend does for free (accept bumps `updatedAt`, the list
 * endpoint sorts by `updatedAt DESC`) since there is no real backend here to
 * refetch from. Returns the updated conversation, or `null` if `id` isn't a
 * seeded conversation this module knows about.
 */
export function acceptPreviewConversationRequest(id: string): Conversation | null {
  const list = getPreviewConversations();
  if (!list.some(c => c.id === id)) return null;
  cachedConversations = acceptConversationInList(list, id);
  return cachedConversations[0];
}

/**
 * Permanently removes a seeded conversation from the cache — the preview-mode
 * equivalent of the real DELETE /api/conversations/:id hard delete. Used both
 * for "Delete" and "Block" on a seeded message request, since there's no real
 * backend block/delete record to keep in sync with.
 */
export function deletePreviewConversationRequest(id: string): void {
  cachedConversations = removeConversationFromList(getPreviewConversations(), id);
}

/**
 * Chat details > Theme, in preview mode: sets the seeded conversation's
 * themeId in place, the same module-level-cache trick as accept/delete above
 * — there's no real backend to persist to, but the mutation is visible to
 * every screen reading getPreviewConversation() in this session.
 */
export function setPreviewConversationTheme(id: string, themeId: string | null): void {
  const list = getPreviewConversations();
  const idx = list.findIndex(c => c.id === id);
  if (idx < 0) return;
  const next = list.slice();
  next[idx] = { ...next[idx], themeId: themeId ?? undefined };
  cachedConversations = next;
}

/** Chat details > Disappearing messages, in preview mode: same pattern. */
export function setPreviewConversationDisappearing(id: string, enabled: boolean): void {
  const list = getPreviewConversations();
  const idx = list.findIndex(c => c.id === id);
  if (idx < 0) return;
  const next = list.slice();
  next[idx] = { ...next[idx], disappearingEnabled: enabled };
  cachedConversations = next;
}

/**
 * Inbox swipe-row > Pin (item 62), in preview mode: same module-level-cache
 * trick as setPreviewConversationTheme/setPreviewConversationDisappearing
 * above — there's no real backend to persist to, but the mutation is visible
 * to every screen reading getPreviewConversations() in this session, so
 * "Pin" is fully demoable under `?bt_preview=buyer`. The seeded Brandthread
 * Agent thread is always pinned already (see its seed data) and this never
 * un-pins it, matching the real backend's isAgentThread-always-pinned rule.
 */
export function setPreviewConversationPinned(id: string, pinned: boolean): void {
  const list = getPreviewConversations();
  const idx = list.findIndex(c => c.id === id);
  if (idx < 0) return;
  if (list[idx].isOfficial) return; // agent thread: always pinned, not user-toggleable
  const next = list.slice();
  next[idx] = { ...next[idx], isPinned: pinned };
  cachedConversations = next;
}

let cachedNotifications: Notification[] | null = null;

/** Seeded "new follower" notifications for the redesigned inbox's Follows
 *  tab/rail. */
export function getPreviewNotifications(): Notification[] {
  if (!cachedNotifications) {
    cachedNotifications = PREVIEW_FOLLOWER_SEEDS.map((f): Notification => ({
      id: f.id,
      category: 'social',
      type: 'new_follower',
      title: `${f.actorName} started following you`,
      body: '',
      isRead: f.isRead,
      isMuted: false,
      actorName: f.actorName,
      actorHandle: '',
      actorInitials: f.actorInitials,
      actorColor: f.actorColor,
      targetId: f.actorUserId,
      createdAt: new Date(Date.now() - f.minutesAgo * 60_000).toISOString(),
    }));
  }
  return cachedNotifications;
}

function toAttachment(seed: PreviewMessageSeed['attachment'], conv: PreviewConversationSeed): MessageAttachment | undefined {
  if (!seed) return undefined;
  const attachment: MessageAttachment = { type: seed.type, meta: seed.meta };
  if (seed.title) attachment.title = seed.title;
  if (seed.subtitle) attachment.subtitle = seed.subtitle;
  // Product share cards (item 70): a real bundled poster image, same as the
  // conversation's own avatar — preview mode has no backend to re-fetch live
  // product data from, so a seed's `meta.unavailable: 'true'` (see
  // previewInboxData.ts) drives the "No longer available" state directly,
  // in place of the real API's lib/productAttachmentInfo.ts.
  if (seed.type === 'product' && typeof conv.posterIndex === 'number') {
    attachment.uri = posterUri(conv.posterIndex);
  }
  // Voice notes (item 73): a real, playable bundled audio URI plus a
  // deterministic waveform (VoiceMessageBubble already generates a fallback
  // sine-wave shape itself when `waveform` is empty, but the actual message
  // that ships in production always carries one recorded client-side, so a
  // seeded one here — same math the real recorder's amplitude sampling
  // approximates — keeps preview honest about the shape data flowing
  // through). meta.duration is stamped from the real bundled clip's actual
  // length (VOICE_NOTE_DURATION_SEC) so the label and the live
  // audio-time-driven progress bar never disagree.
  // Photo/video messages (item 74, upload progress ring): reuse the same
  // bundled poster photos as the real thumbnail — for an image message this
  // is genuinely what the attachment shows (photoUris drives the sent
  // bubble's photo grid, see renderAttachment in app/buyer-conversation.tsx
  // and renderMsgAttachment in app/seller-conversation.tsx). For a video
  // message, the sent bubble already renders `uri` as the thumbnail image
  // (not a real extracted video frame — see MediaUploadThumb.tsx's doc
  // comment on that pre-existing gap), so a real bundled jpg poster here is
  // honest and consistent with that existing contract.
  if (seed.type === 'image' && typeof conv.posterIndex === 'number') {
    const uri = posterUri(conv.posterIndex);
    attachment.uri = uri;
    attachment.meta = { ...attachment.meta, photoUris: JSON.stringify([uri]) };
  }
  if (seed.type === 'video' && typeof conv.posterIndex === 'number') {
    attachment.uri = posterUri(conv.posterIndex);
  }
  if (seed.type === 'voice') {
    attachment.uri = voiceNoteUri();
    attachment.meta = {
      ...attachment.meta,
      duration: String(VOICE_NOTE_DURATION_SEC),
      waveform: JSON.stringify(
        Array.from({ length: 24 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 0.7)) * 0.55),
      ),
    };
  }
  return attachment;
}

/** The reactions a seeded message starts with, from its `reactionSeed` —
 *  same `MessageReaction` shape the real backend returns (see
 *  components/chat/ReactionBar.tsx's reactionAuthorId/reactionKind, which
 *  read both this local shape and the server's interchangeably). */
function seedReactions(seed: PreviewConversationSeed, m: PreviewMessageSeed): MessageReaction[] {
  if (!m.reactionSeed?.length) return [];
  return m.reactionSeed.map((r) => ({
    emoji: r.type as ReactionType,
    reactionType: r.type as ReactionType,
    fromId: r.from === 'me' ? 'me' : seed.participantUserId,
    fromName: r.from === 'me' ? 'You' : seed.participantName,
    createdAt: new Date(Date.now() - m.minutesAgo * 60_000 + 30_000).toISOString(),
  }));
}

// Item 68 (chat reactions glass), preview mode: reactions the viewer adds/
// removes themselves during this session, keyed by message id — same
// module-level-cache trick as setPreviewConversationTheme/Pinned above.
// Overrides the static `reactionSeed` entirely once the viewer has reacted
// (their tap replaces the whole "my reaction" slot, same as the real
// one-reaction-per-user rule server-side), so it's seeded from the base list
// the first time a given message is touched.
const previewReactionOverrides = new Map<string, MessageReaction[]>();

/** Chat > long-press reaction overlay, in preview mode: toggles `myId`'s
 *  reaction on a seeded message (re-tapping the same kind removes it,
 *  tapping a different kind replaces it) — mirrors the real PUT/DELETE
 *  .../reactions endpoint's one-reaction-per-user rule. No-ops for an id
 *  this module doesn't know about. */
export function reactToPreviewMessage(
  conversationId: string, messageId: string, type: ReactionType, myId: string, myName: string,
): void {
  const seed = seedById(conversationId);
  const msgSeed = seed?.messages?.find((m) => m.id === messageId);
  if (!seed || !msgSeed) return;
  const current = previewReactionOverrides.get(messageId) ?? seedReactions(seed, msgSeed);
  const isMine = (r: MessageReaction) => r.fromId === myId || r.fromId === 'me';
  const isToggleOff = current.some((r) => isMine(r) && (r.reactionType ?? r.emoji) === type);
  const others = current.filter((r) => !isMine(r));
  const next: MessageReaction[] = isToggleOff
    ? others
    : [...others, { emoji: type, reactionType: type, fromId: myId, fromName: myName, createdAt: new Date().toISOString() }];
  previewReactionOverrides.set(messageId, next);
}

/** Seeded messages for one seeded conversation id, in the exact `Message`
 *  shape `app/buyer-conversation.tsx` already renders (bubbles, reactions,
 *  attachments). Returns `[]` for an id this module doesn't know about. */
// Messages appended after the seed data at runtime (e.g. a "You changed the
// theme..." system line posted from chat details) — a conversation-scoped,
// module-level list, same lifetime/sharing model as cachedConversations
// above. Cleared on reload, same as every other preview mutation.
const previewExtraMessages = new Map<string, Message[]>();

/** Chat details > Theme / Disappearing messages, in preview mode: appends a
 *  system-line message after the seeded thread, visible to every screen
 *  reading getPreviewMessages() for this conversation in this session. */
export function appendPreviewMessage(conversationId: string, message: Message): void {
  const list = previewExtraMessages.get(conversationId) ?? [];
  previewExtraMessages.set(conversationId, [...list, message]);
}

export function getPreviewMessages(conversationId: string): Message[] {
  const seed = seedById(conversationId);
  const base: Message[] = !seed?.messages ? [] : seed.messages.map((m): Message => {
    const isMe = m.fromOfficialOrParticipant === 'me';
    const ts = Date.now() - m.minutesAgo * 60_000;
    return {
      id: m.id,
      conversationId,
      fromId: isMe ? 'me' : seed.participantUserId,
      fromName: isMe ? 'You' : seed.participantName,
      fromInitials: isMe ? 'Y' : seed.participantInitials,
      fromColor: isMe ? '#F7F7FA' : seed.participantColor,
      text: m.text,
      attachment: toAttachment(m.attachment, seed),
      reactions: previewReactionOverrides.get(m.id) ?? seedReactions(seed, m),
      status: 'read',
      // Real conversations get `readAt` from the backend once the other
      // participant marks the thread read (see
      // artifacts/api-server/src/routes/conversations.ts). This seeded
      // preview thread has no backend, so it approximates the same
      // real-world shape — my own message read shortly after I sent it —
      // purely so the "Seen" receipt (app/buyer-conversation.tsx) has
      // something honest to render in preview mode.
      readAt: isMe ? new Date(ts + 45_000).toISOString() : undefined,
      ts,
      deletedForMe: false,
    };
  });
  return [...base, ...(previewExtraMessages.get(conversationId) ?? [])];
}

// ─── Seller preview inbox (item 71) ────────────────────────────────────────
//
// app/seller-inbox.tsx and app/seller-conversation.tsx have no seeded data
// of their own today — under ?bt_preview=seller (no real Clerk sign-in, no
// reachable backend, same as the buyer preview above) they call the real
// API, get nothing back, and render an empty/error state instead of a demo.
// This gives them the one seeded thread from
// SELLER_PREVIEW_CONVERSATION_SEEDS to fall back to, same gating contract as
// the buyer functions above: try the real API first, only fall back here
// when it returns nothing or fails, never for a real signed-in account.
const SELLER_ID_PREFIX = 'preview-seller-conversation-';

export function isSellerPreviewConversationId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(SELLER_ID_PREFIX);
}

function sellerSeedById(id: string): PreviewConversationSeed | undefined {
  return SELLER_PREVIEW_CONVERSATION_SEEDS.find(s => s.id === id);
}

function toSellerConversation(seed: PreviewConversationSeed): Conversation {
  const now = Date.now();
  const ts = now - seed.minutesAgo * 60_000;
  return {
    id: seed.id,
    type: 'buyer_to_seller',
    participants: [{
      userId: seed.participantUserId,
      name: seed.participantName,
      handle: seed.participantHandle,
      initials: seed.participantInitials,
      color: seed.participantColor,
      accountType: 'buyer',
      avatarUri: avatarUriFor(seed),
    }],
    lastMessage: seed.lastMessage,
    lastMessageTs: ts,
    lastMessageSenderId: seed.lastMessageFromMe ? 'me' : seed.participantUserId,
    lastMessageType: seed.lastMessageType,
    unreadCount: seed.unreadCount,
    isFriendshipActive: true,
    isArchived: false,
    isRequest: seed.isRequest,
    contextOrderNumber: seed.contextOrderNumber,
    contextProductName: seed.contextProductName,
    updatedAt: new Date(ts).toISOString(),
  };
}

export function getSellerPreviewConversations(): Conversation[] {
  return SELLER_PREVIEW_CONVERSATION_SEEDS.map(toSellerConversation);
}

export function getSellerPreviewConversation(id: string): Conversation | null {
  const seed = sellerSeedById(id);
  return seed ? toSellerConversation(seed) : null;
}

export function getSellerPreviewMessages(conversationId: string): Message[] {
  const seed = sellerSeedById(conversationId);
  if (!seed?.messages) return [];
  return seed.messages.map((m): Message => {
    const isMe = m.fromOfficialOrParticipant === 'me'; // 'me' = the seller here
    const ts = Date.now() - m.minutesAgo * 60_000;
    return {
      id: m.id,
      conversationId,
      fromId: isMe ? 'me' : seed.participantUserId,
      fromName: isMe ? 'You' : seed.participantName,
      fromInitials: isMe ? 'Y' : seed.participantInitials,
      fromColor: isMe ? '#F7F7FA' : seed.participantColor,
      text: m.text,
      attachment: toAttachment(m.attachment, seed),
      reactions: [],
      status: 'read',
      readAt: isMe ? new Date(ts + 45_000).toISOString() : undefined,
      ts,
      deletedForMe: false,
    };
  });
}

// ─── Transient "typing…" simulation (preview-only, demonstrates the real
// `agentTyping` field) ──────────────────────────────────────────────────────
//
// The real backend has exactly one "someone is typing" signal today:
// `Conversation.agentTyping` (services/socialTypes.ts), set only for the
// Brandthread Agent's thread and polled via GET /api/conversations (see
// api-server's conversations.ts `agentTypingUntil` handling — there is no
// websocket/presence layer, and no equivalent for ordinary human-to-human
// buyer<->seller or buyer<->buyer conversations). This preview-only helper
// flips the *same* seeded thread's typing state on a timer purely so the
// inbox's "typing…" row treatment has something to demo without a live
// backend — it is gated to `BRANDTHREAD_AGENT_SEED` (see its `simulateTyping`
// flag) and never an ordinary seller/buyer thread, so it never suggests a
// presence signal that doesn't really exist in production.

const TYPING_CONVERSATION_ID = allSeeds().find(s => s.simulateTyping)?.id ?? null;
const TYPING_INTERVAL_MS = 4000;

/** Subscribes to the simulated typing flag; calls `cb(conversationId | null)`
 *  on each flip. Returns an unsubscribe function. No-op when the preview
 *  inbox is disabled or no seed opts into simulated typing. */
export function subscribePreviewTyping(cb: (typingConversationId: string | null) => void): () => void {
  if (!isPreviewInboxEnabled() || !TYPING_CONVERSATION_ID) return () => {};
  let on = false;
  const interval = setInterval(() => {
    on = !on;
    cb(on ? TYPING_CONVERSATION_ID : null);
  }, TYPING_INTERVAL_MS);
  return () => clearInterval(interval);
}

// ─── Auto-reply (preview-only, keeps a demo thread feeling live) ──────────
//
// A seeded preview conversation has no real counterpart to write back — the
// person previewing the app is the only participant actually there. Without
// this, sending a message in `?bt_preview=buyer`/`?bt_preview=seller` is a
// one-way shout into an empty thread. This makes the OTHER (simulated) side
// send back exactly one short, generic reply a beat after each message the
// preview user sends — never fake commerce claims, never a loop of replies
// replying to replies (only a user-originated send schedules one). Purely
// cosmetic for the demo: it never touches real data, and both call sites
// (app/buyer-conversation.tsx, app/seller-conversation.tsx) gate it behind
// their existing isPreviewConversationId/isSellerPreviewConversationId check.
const PREVIEW_AUTO_REPLY_TEXTS = [
  'Got it, thanks!',
  'Sounds good — thanks for letting me know.',
  'Okay, noted. Thank you!',
  'Thanks for the message — got it.',
  'Appreciate you reaching out, thanks!',
];

/** One short, generic acknowledgement — randomized so a demo with several
 *  sends doesn't repeat the exact same line back to back. */
export function previewAutoReplyText(): string {
  return PREVIEW_AUTO_REPLY_TEXTS[Math.floor(Math.random() * PREVIEW_AUTO_REPLY_TEXTS.length)];
}

/** How long to wait before the simulated reply lands — long enough to read
 *  as a real person typing back, short enough that a demo doesn't stall. */
export const PREVIEW_AUTO_REPLY_DELAY_MS = 1100;
export function previewAutoReplyDelayMs(): number {
  return PREVIEW_AUTO_REPLY_DELAY_MS + Math.random() * 900;
}
