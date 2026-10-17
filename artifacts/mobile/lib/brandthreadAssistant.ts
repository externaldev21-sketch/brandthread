/**
 * Client constants for the pinned Brandthread assistant chat (server side:
 * api-server lib/brandthreadAgent.ts + lib/brandthreadAssistant.ts).
 */

/** Display name for the official assistant thread in every inbox. Older
 *  welcome threads stored "Brandthread Agent" on the participant row, so the
 *  inbox shows this constant instead of the stored name. */
export const BRANDTHREAD_ASSISTANT_NAME = 'Brandthread';

/** The assistant's account id (matches BRANDTHREAD_AGENT_CLERK_ID). */
export const BRANDTHREAD_ASSISTANT_USER_ID = 'brandthread-agent';

/** Inbox order rank: the Brandthread chat always first, then threads the
 *  viewer pinned, then everything else (in its existing order). */
export function inboxPinRank(conv: { isOfficial?: boolean; isPinned?: boolean }): number {
  if (conv.isOfficial) return 2;
  return conv.isPinned ? 1 : 0;
}

/** Stable sort by inboxPinRank — keeps the incoming (most-recent-first)
 *  order within each rank. */
export function sortInboxPinnedFirst<T extends { isOfficial?: boolean; isPinned?: boolean }>(convs: T[]): T[] {
  return [...convs].sort((a, b) => inboxPinRank(b) - inboxPinRank(a));
}
