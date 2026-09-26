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
  type PreviewConversationSeed, type PreviewMessageSeed,
} from './previewInboxData';
import type { Conversation, Message, MessageAttachment, Notification } from '@/services/socialTypes';

export function isPreviewInboxEnabled(): boolean {
  return isPreviewCatalogEnabled();
}

// Same 10 fashion preview posters previewCatalog.ts uses, reused here as
// stand-in conversation avatars/attachment thumbnails so the whole buyer
// preview reads as one consistent world instead of two unrelated fake sets.
const POSTER_SOURCES = [
  require('../assets/videos/fashion_runway_01.png'),
  require('../assets/videos/fashion_runway_02.png'),
  require('../assets/videos/fashion_runway_03.png'),
  require('../assets/videos/fashion_runway_04.png'),
  require('../assets/videos/fashion_runway_05.png'),
  require('../assets/videos/fashion_runway_06.png'),
  require('../assets/videos/fashion_runway_07.png'),
  require('../assets/videos/fashion_runway_08.png'),
  require('../assets/videos/fashion_runway_09.png'),
  require('../assets/videos/fashion_runway_10.png'),
];

// eslint-disable-next-line @typescript-eslint/no-var-requires
const LOGO_SOURCE = require('../assets/images/brandthread-logo.png');

function posterUri(index: number): string {
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

function toAttachment(seed: PreviewMessageSeed['attachment']): MessageAttachment | undefined {
  if (!seed) return undefined;
  const attachment: MessageAttachment = { type: seed.type, meta: seed.meta };
  if (seed.title) attachment.title = seed.title;
  if (seed.subtitle) attachment.subtitle = seed.subtitle;
  return attachment;
}

/** Seeded messages for one seeded conversation id, in the exact `Message`
 *  shape `app/buyer-conversation.tsx` already renders (bubbles, reactions,
 *  attachments). Returns `[]` for an id this module doesn't know about. */
export function getPreviewMessages(conversationId: string): Message[] {
  const seed = seedById(conversationId);
  if (!seed?.messages) return [];
  return seed.messages.map((m): Message => {
    const isMe = m.fromOfficialOrParticipant === 'me';
    return {
      id: m.id,
      conversationId,
      fromId: isMe ? 'me' : seed.participantUserId,
      fromName: isMe ? 'You' : seed.participantName,
      fromInitials: isMe ? 'Y' : seed.participantInitials,
      fromColor: isMe ? '#8B5CF6' : seed.participantColor,
      text: m.text,
      attachment: toAttachment(m.attachment),
      reactions: [],
      status: 'read',
      ts: Date.now() - m.minutesAgo * 60_000,
      deletedForMe: false,
    };
  });
}

// ─── Transient "typing…" simulation (preview-only, not a real feature) ────────
//
// socialTypes.ts has no real typing/presence signal (see the
// ConversationParticipant.isOnline comment) — PR #75 explicitly left this
// out rather than fabricate one. This is a purely local, seeded-preview-only
// visual: it flips a flag for one seeded conversation on a timer so the
// redesigned inbox has something to demo for a "typing…" row treatment. It
// never touches real conversations and does nothing outside the preview.

const TYPING_CONVERSATION_ID = PREVIEW_CONVERSATION_SEEDS.find(s => s.simulateTyping)?.id ?? null;
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
