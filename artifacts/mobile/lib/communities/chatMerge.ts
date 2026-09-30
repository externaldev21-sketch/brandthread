/**
 * Pure list logic for the community group chat (components/community-chat/*).
 *
 * Kept free of react-native so it can be unit-tested directly: merging
 * paginated history, realtime events and optimistic (pending) sends into one
 * timeline, grouping consecutive senders, day separators, reaction chips and
 * the "N new messages" pill counter.
 */
import { formatDate, groupFlags } from '@/lib/chatGrouping';
import type { CommunityAttachment, CommunityMessage, CommunityReaction } from './types';

/** An optimistic send that the server hasn't confirmed yet (or that failed). */
export interface PendingMessage {
  clientId: string;
  text: string;
  attachments: CommunityAttachment[];
  replyToId?: string;
  replyPreview?: string;
  replyToAuthorName?: string;
  ts: number;
  status: 'sending' | 'failed';
  error?: string;
}

/** A timeline entry — a server message, or a pending one wearing the same shape. */
export type DisplayMessage = CommunityMessage & { pendingStatus?: 'sending' | 'failed'; clientId?: string };

export type ChatRow =
  | { type: 'day'; key: string; label: string }
  | { type: 'message'; key: string; msg: DisplayMessage; isFirstInGroup: boolean; isLastInGroup: boolean };

/** Sorts after every real message (pending sends always sit at the bottom). */
const PENDING_SEQ = Number.MAX_SAFE_INTEGER;

function bySeq(a: CommunityMessage, b: CommunityMessage): number {
  return a.seq - b.seq || a.ts - b.ts;
}

/**
 * Merge `incoming` into an ascending-by-seq list, de-duplicating by id.
 * `replace` (fetched pages) lets the fetched copy win — it carries the freshest
 * reactions; realtime `message.created` keeps the copy we already have.
 */
export function upsertMessages(items: CommunityMessage[], incoming: CommunityMessage[], replace = true): CommunityMessage[] {
  if (incoming.length === 0) return items;
  const byId = new Map(items.map((m) => [m.id, m]));
  let changed = false;
  for (const m of incoming) {
    const existing = byId.get(m.id);
    if (existing && !replace) continue;
    if (existing === m) continue;
    byId.set(m.id, m);
    changed = true;
  }
  if (!changed) return items;
  return [...byId.values()].sort(bySeq);
}

export function removeMessage(items: CommunityMessage[], messageId: string): CommunityMessage[] {
  return items.some((m) => m.id === messageId) ? items.filter((m) => m.id !== messageId) : items;
}

export function setReactions(items: CommunityMessage[], messageId: string, reactions: CommunityReaction[]): CommunityMessage[] {
  let hit = false;
  const next = items.map((m) => {
    if (m.id !== messageId) return m;
    hit = true;
    return { ...m, reactions };
  });
  return hit ? next : items;
}

/** Highest seq we hold — the `after` cursor for catch-up polling / reconnects. */
export function maxSeq(items: CommunityMessage[]): number {
  return items.length ? items[items.length - 1].seq : 0;
}

/** Index of the pending send a realtime message from me most likely echoes, or -1. */
export function findEchoIndex(pending: PendingMessage[], msg: CommunityMessage, myId: string | null): number {
  if (!myId || msg.fromId !== myId) return -1;
  return pending.findIndex((p) =>
    p.status === 'sending'
    && p.text.trim() === msg.text.trim()
    && p.attachments.length === msg.attachments.length);
}

export interface ChatLists { items: CommunityMessage[]; pending: PendingMessage[] }

/**
 * A `message.created` event. Dedupes by id; if it is the echo of something I'm
 * still sending, the pending bubble is swapped for the real message instead of
 * showing twice. `isNewFromOthers` drives the unread pill / mark-read.
 */
export function applyCreated(
  lists: ChatLists,
  msg: CommunityMessage,
  myId: string | null,
): ChatLists & { isNewFromOthers: boolean } {
  if (lists.items.some((m) => m.id === msg.id)) return { ...lists, isNewFromOthers: false };
  const echo = findEchoIndex(lists.pending, msg, myId);
  const pending = echo >= 0 ? lists.pending.filter((_, i) => i !== echo) : lists.pending;
  return {
    items: upsertMessages(lists.items, [msg], false),
    pending,
    isNewFromOthers: msg.fromId !== myId,
  };
}

/** The POST resolved: drop the pending bubble, keep the real message (idempotent with the echo). */
export function applySent(lists: ChatLists, clientId: string, msg: CommunityMessage): ChatLists {
  return {
    items: upsertMessages(lists.items, [msg], false),
    pending: lists.pending.filter((p) => p.clientId !== clientId),
  };
}

export function markPending(pending: PendingMessage[], clientId: string, patch: Partial<Pick<PendingMessage, 'status' | 'error'>>): PendingMessage[] {
  return pending.map((p) => (p.clientId === clientId ? { ...p, ...patch } : p));
}

export function dropPending(pending: PendingMessage[], clientId: string): PendingMessage[] {
  return pending.filter((p) => p.clientId !== clientId);
}

/**
 * Everything the list shows: server messages (minus blocked senders) followed
 * by my pending sends, which wear my id so they render as my own bubbles.
 */
export function toDisplay(
  items: CommunityMessage[],
  pending: PendingMessage[],
  hiddenSenders: ReadonlySet<string>,
  me: { id: string; name?: string },
): DisplayMessage[] {
  const visible: DisplayMessage[] = hiddenSenders.size ? items.filter((m) => !hiddenSenders.has(m.fromId)) : items;
  if (pending.length === 0) return visible;
  const mine: DisplayMessage[] = pending.map((p) => ({
    id: `pending:${p.clientId}`,
    clientId: p.clientId,
    pendingStatus: p.status,
    communityId: '',
    seq: PENDING_SEQ,
    fromId: me.id,
    fromName: me.name ?? 'You',
    fromHandle: '',
    fromInitials: '',
    fromColor: '',
    text: p.text,
    attachments: p.attachments,
    replyToId: p.replyToId,
    replyPreview: p.replyPreview,
    replyToAuthorName: p.replyToAuthorName,
    reactions: [],
    ts: p.ts,
  }));
  return [...visible, ...mine];
}

/**
 * Chronological rows with day separators and group flags. A group never spans
 * a day separator (chatGrouping's sameSenderClose already checks the day).
 */
export function buildRows(messages: DisplayMessage[]): ChatRow[] {
  const rows: ChatRow[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const prev = messages[i - 1];
    if (!prev || formatDate(prev.ts) !== formatDate(msg.ts)) {
      rows.push({ type: 'day', key: `day-${msg.id}`, label: formatDate(msg.ts) });
    }
    const { isFirstInGroup, isLastInGroup } = groupFlags(msg, prev, messages[i + 1]);
    rows.push({ type: 'message', key: msg.id, msg, isFirstInGroup, isLastInGroup });
  }
  return rows;
}

/** FlatList `inverted` wants newest-first; day separators then render above their messages. */
export function toInvertedRows(messages: DisplayMessage[]): ChatRow[] {
  return buildRows(messages).reverse();
}

// ─── Reactions ──────────────────────────────────────────────────────────────

export interface ReactionChip { type: string; count: number; mine: boolean }

/** One chip per reaction type, most-used first (ties keep the fixed reaction order). */
export function reactionChips(reactions: CommunityReaction[], myId: string | null, order: readonly string[]): ReactionChip[] {
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const r of reactions) {
    const c = counts.get(r.reactionType) ?? { count: 0, mine: false };
    c.count += 1;
    if (myId && r.userId === myId) c.mine = true;
    counts.set(r.reactionType, c);
  }
  return [...counts.entries()]
    .map(([type, c]) => ({ type, ...c }))
    .sort((a, b) => b.count - a.count || order.indexOf(a.type) - order.indexOf(b.type));
}

export function myReactionType(reactions: CommunityReaction[], myId: string | null): string | null {
  if (!myId) return null;
  return reactions.find((r) => r.userId === myId)?.reactionType ?? null;
}

/**
 * Optimistic toggle. One reaction per member: tapping a different type swaps
 * it, tapping my current type removes it.
 */
export function toggleMyReaction(
  reactions: CommunityReaction[],
  myId: string,
  type: string,
  now = new Date().toISOString(),
): { reactions: CommunityReaction[]; action: 'react' | 'unreact' } {
  const current = myReactionType(reactions, myId);
  const others = reactions.filter((r) => r.userId !== myId);
  if (current === type) return { reactions: others, action: 'unreact' };
  return { reactions: [...others, { userId: myId, reactionType: type, createdAt: now }], action: 'react' };
}

// ─── Scroll / unread pill ───────────────────────────────────────────────────

/** In an inverted list offset 0 is the newest message. */
export const NEAR_BOTTOM_PX = 120;

export function isNearBottom(offsetY: number, threshold = NEAR_BOTTOM_PX): boolean {
  return offsetY <= threshold;
}

/**
 * Count behind the "N new messages" pill: only messages from others that land
 * while I'm scrolled up count; being at the bottom clears it.
 */
export function nextNewCount(prev: number, event: { nearBottom: boolean; fromOthers: boolean }): number {
  if (event.nearBottom) return 0;
  return event.fromOthers ? prev + 1 : prev;
}

export function newMessagesLabel(count: number): string {
  return count === 1 ? '1 new message' : `${count} new messages`;
}
