/**
 * Messages inbox filter (header filter button). Pure, client-side predicates
 * over the conversations the inbox already loaded — no extra requests.
 *
 * Archived chats only ever appear under the "Archived" filter; every other
 * filter is a narrowing of the main inbox (non-archived, non-request). The
 * Requests pill keeps owning message requests, so no filter shows them.
 */
import type { Conversation } from '@/services/socialTypes';

export type InboxFilter =
  | 'all'
  | 'unread'
  | 'friends'
  | 'shops'
  | 'groups'
  | 'pinned'
  | 'muted'
  | 'archived';

export const INBOX_FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All messages' },
  { key: 'unread', label: 'Unread' },
  { key: 'friends', label: 'Friends' },
  { key: 'shops', label: 'Shops' },
  { key: 'groups', label: 'Groups' },
  { key: 'pinned', label: 'Pinned' },
  { key: 'muted', label: 'Muted' },
  { key: 'archived', label: 'Archived' },
];

export function inboxFilterLabel(filter: InboxFilter): string {
  return INBOX_FILTERS.find(f => f.key === filter)?.label ?? 'All messages';
}

type FilterableConversation = Pick<
  Conversation,
  'type' | 'participants' | 'unreadCount' | 'isArchived' | 'isRequest' | 'isPinned' | 'mutedUntil'
>;

/** True while a chat mute is in effect (a past mutedUntil means unmuted). */
export function isConversationMuted(conv: Pick<Conversation, 'mutedUntil'>, now = Date.now()): boolean {
  if (!conv.mutedUntil) return false;
  const until = Date.parse(conv.mutedUntil);
  return Number.isFinite(until) && until > now;
}

function isGroupConversation(conv: FilterableConversation): boolean {
  // 'group' is a server-side conversation type not yet in ConversationType.
  return (conv.type as string) === 'group' || conv.participants.length > 2;
}

function isShopConversation(conv: FilterableConversation): boolean {
  return conv.type === 'buyer_to_seller'
    || conv.type === 'buyer_to_seller_product'
    || conv.type === 'buyer_to_seller_order';
}

/** Does this DM row belong in the inbox list under `filter`? */
export function conversationMatchesInboxFilter(
  conv: FilterableConversation,
  filter: InboxFilter,
  now = Date.now(),
): boolean {
  if (conv.isRequest) return false;
  if (filter === 'archived') return conv.isArchived === true;
  if (conv.isArchived) return false;
  switch (filter) {
    case 'all': return true;
    case 'unread': return conv.unreadCount > 0;
    case 'friends': return conv.type === 'buyer_to_buyer' && !isGroupConversation(conv);
    case 'shops': return isShopConversation(conv) && !isGroupConversation(conv);
    case 'groups': return isGroupConversation(conv);
    case 'pinned': return conv.isPinned === true;
    case 'muted': return isConversationMuted(conv, now);
    default: return true;
  }
}

/** Joined community group chats aren't archivable/pinnable DMs; they show
 *  under All, Groups, and Unread/Muted when their own state matches. */
export function communityMatchesInboxFilter(
  c: { unreadCount: number; muted: boolean },
  filter: InboxFilter,
): boolean {
  switch (filter) {
    case 'all':
    case 'groups': return true;
    case 'unread': return c.unreadCount > 0;
    case 'muted': return c.muted;
    default: return false;
  }
}
