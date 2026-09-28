/**
 * Pure array transforms for the two message-request mutations (accept /
 * delete), factored out of lib/previewInbox.ts so they're directly unit
 * testable: this file imports nothing from react-native/expo-*, unlike
 * previewInbox.ts (which requires bundled image assets at module scope and
 * so can't be imported by Vitest — see tests/request-actions.test.ts).
 *
 * Generic over any object with an `id`/`isRequest`/`updatedAt` shape so it
 * can operate on the real `Conversation` type without this module needing to
 * import it.
 */

export interface ConversationLike {
  id: string;
  isRequest?: boolean;
  updatedAt?: string;
}

/**
 * Returns a new array with the conversation matching `id` accepted (isRequest
 * → false, updatedAt bumped to now) and moved to the front — mimicking what
 * the real backend does for free (accept bumps updatedAt; the list endpoint
 * sorts by updatedAt DESC). Returns the original array reference unchanged if
 * `id` isn't found.
 */
export function acceptConversationInList<T extends ConversationLike>(list: T[], id: string): T[] {
  const idx = list.findIndex(c => c.id === id);
  if (idx < 0) return list;
  const accepted: T = { ...list[idx], isRequest: false, updatedAt: new Date().toISOString() };
  const next = list.slice();
  next.splice(idx, 1);
  next.unshift(accepted);
  return next;
}

/** Returns a new array with the conversation matching `id` removed entirely. */
export function removeConversationFromList<T extends ConversationLike>(list: T[], id: string): T[] {
  return list.filter(c => c.id !== id);
}
