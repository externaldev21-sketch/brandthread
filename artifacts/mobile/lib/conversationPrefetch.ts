/**
 * Instant thread open for app/buyer-conversation.tsx.
 *
 * The thread and its messages are already cached on device by
 * services/socialService.ts after every load. Pressing an inbox row reads that
 * cache into memory (press-in fires ~100–200ms before the tap), so the
 * conversation screen's very first frame renders the last-known thread
 * instead of an empty one; the screen then refreshes from the network as
 * before. Scoped by account so one account's thread can never paint for
 * another.
 */
import type { Conversation, Message } from '@/services/socialTypes';

export interface WarmThread {
  conversation: Conversation | null;
  messages: Message[];
}

const warm = new Map<string, WarmThread>();
const MAX_WARM = 20;

function key(userId: string, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

export function rememberWarmThread(userId: string, conversationId: string, thread: WarmThread): void {
  const k = key(userId, conversationId);
  warm.delete(k);
  warm.set(k, thread);
  // Bounded: drop the oldest entries.
  while (warm.size > MAX_WARM) {
    const oldest = warm.keys().next().value;
    if (oldest === undefined) break;
    warm.delete(oldest);
  }
}

/** Synchronous — what the screen can paint on its first frame, if anything. */
export function peekWarmThread(userId: string | null | undefined, conversationId: string | null | undefined): WarmThread | undefined {
  if (!userId || !conversationId) return undefined;
  return warm.get(key(userId, conversationId));
}

/** Inbox row press-in: load the cached thread into memory. Never throws. */
export function warmThreadOnPressIn(userId: string | null | undefined, conversationId: string | null | undefined): void {
  if (!userId || !conversationId) return;
  void import('@/services/socialService').then(async ({ getCachedConversation, getCachedMessages, getSocialUserId }) => {
    if (getSocialUserId() !== userId) return;
    const [conversation, messages] = await Promise.all([
      getCachedConversation(conversationId),
      getCachedMessages(conversationId),
    ]);
    if (conversation || messages.length > 0) rememberWarmThread(userId, conversationId, { conversation, messages });
  }).catch(() => {});
}

/** lib/tabDataCache.ts key for app/seller-conversation.tsx's last-loaded thread
 *  (that screen loads through the API client, not socialService's cache). */
export function sellerThreadCacheKey(conversationId: string): string {
  return `seller-thread:${conversationId}`;
}

/** Seller inbox row press-in: load the cached thread from disk into memory. */
export function warmSellerThreadOnPressIn(conversationId: string | null | undefined): void {
  if (!conversationId) return;
  void import('@/lib/tabDataCache')
    .then(({ hydrateTabData }) => hydrateTabData(sellerThreadCacheKey(conversationId)))
    .catch(() => {});
}

/** Test-only. */
export function __resetWarmThreadsForTests(): void {
  warm.clear();
}
