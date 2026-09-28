/**
 * Shared, pure chat-bubble grouping/timestamp/seen-receipt logic for
 * app/buyer-conversation.tsx and app/seller-conversation.tsx.
 *
 * Both screens render the SAME underlying conversation/message data (just
 * from the other participant's point of view), so the grouping decision —
 * "is this bubble visually joined to its neighbor?" — must be identical on
 * both sides or the same thread reads differently depending on who's
 * looking at it. Consolidating the two screens' entire bubble-rendering
 * JSX into one shared component is a much larger refactor (buyer's screen
 * alone is 3000+ lines, with buyer-only concepts like Thread Cash/quick
 * replies/agent cards woven through it) — out of scope for a single polish
 * item. This module is the bounded, safe piece to share: the pure
 * date/grouping/seen math, with no rendering or navigation.
 */

// Consecutive messages from the same sender within this gap are visually
// grouped: tighter corner radius on the shared edge, reduced vertical
// spacing, and only the last bubble in the run carries the timestamp/
// receipt — mirrors Instagram DM's grouped-bubble behavior.
export const GROUP_GAP_MS = 5 * 60_000;

export interface GroupableMessage {
  fromId: string;
  ts: number;
  attachment?: { type?: string | null } | null;
}

/** A day-boundary label ("Today" / "Yesterday" / "Mon, Jan 5"), used both for
 *  the date-separator rows and to decide whether two messages fall on the
 *  same calendar day for grouping purposes. */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return 'Today';
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

// agent_card / thread_cash / quick_replies (buyer-only) and any other
// non-bubble attachment render as standalone rows with their own layout,
// never through the avatar-bearing bubble path — so a message next to one
// of them must never be treated as "still grouped" (that would silently
// eat the avatar off the preceding bubble, since the special row that
// follows it never draws one either).
const GROUP_BREAKING_ATTACHMENT_TYPES = new Set(['agent_card', 'thread_cash', 'quick_replies', 'system']);

export function breaksGroup(msg: GroupableMessage): boolean {
  const t = msg.attachment?.type;
  return !!t && GROUP_BREAKING_ATTACHMENT_TYPES.has(t);
}

/** Two messages belong in the same visual group: same sender, within
 *  GROUP_GAP_MS of each other, and on the same calendar day (so a group
 *  never silently spans a date separator). */
export function sameSenderClose(a: GroupableMessage, b: GroupableMessage): boolean {
  if (breaksGroup(a) || breaksGroup(b)) return false;
  return a.fromId === b.fromId
    && Math.abs(a.ts - b.ts) < GROUP_GAP_MS
    && formatDate(a.ts) === formatDate(b.ts);
}

/** Given a message and its immediate neighbors in the full timeline (or
 *  undefined at either end), returns whether it starts and/or ends its
 *  visual group. */
export function groupFlags(
  msg: GroupableMessage,
  prev: GroupableMessage | undefined,
  next: GroupableMessage | undefined,
): { isFirstInGroup: boolean; isLastInGroup: boolean } {
  return {
    isFirstInGroup: !prev || !sameSenderClose(msg, prev),
    isLastInGroup: !next || !sameSenderClose(msg, next),
  };
}

/** The rounded-corner radii for one bubble, IG-style: the corner touching
 *  an adjacent bubble in the same group (on the avatar-column side for a
 *  received bubble, the opposite side for a sent one) is tightened to
 *  `tight`; every outer/edge corner stays `full`. */
export function groupCornerRadii(
  isOwn: boolean,
  isFirstInGroup: boolean,
  isLastInGroup: boolean,
  full: number,
  tight = 6,
): {
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
  borderBottomRightRadius: number;
  borderBottomLeftRadius: number;
} {
  return {
    borderTopLeftRadius: (!isOwn && !isFirstInGroup) ? tight : full,
    borderTopRightRadius: (isOwn && !isFirstInGroup) ? tight : full,
    borderBottomRightRadius: (isOwn && !isLastInGroup) ? tight : full,
    borderBottomLeftRadius: (!isOwn && !isLastInGroup) ? tight : full,
  };
}

export interface PreviewableMessage {
  text?: string | null;
  attachment?: { title?: string | null; type?: string | null } | null;
}

/** A short, human preview of a message's content — used both for the
 *  swipe-to-reply "Replying to …" banner (ReplyBanner) and the in-bubble
 *  quoted-reply strip. Falls back through the attachment's own title (e.g.
 *  "Photo", "Voice message") for an attachment-only original with no text,
 *  so a reply to a photo/voice/product card never renders a blank quote. */
export function messagePreviewText(msg: PreviewableMessage): string {
  const text = msg.text?.trim();
  if (text) return text;
  const title = msg.attachment?.title?.trim();
  if (title) return title;
  switch (msg.attachment?.type) {
    case 'image': return 'Photo';
    case 'video': return 'Video';
    case 'voice': return 'Voice message';
    case 'product': return 'Product';
    case 'order': return 'Order';
    case 'post': return 'Post';
    default: return 'Message';
  }
}

export interface SeenableMessage {
  id: string;
  fromId: string;
  ts: number;
  readAt?: string | null;
}

/** Real, honest granularity: the backend marks every one of the OTHER
 *  participant's unread messages `readAt` at once, the moment I open the
 *  conversation and it calls `PATCH /conversations/:id/read` (see
 *  artifacts/api-server/src/routes/conversations.ts). There's no
 *  per-message "they scrolled past this exact bubble" signal — so "Seen"
 *  means "read up through this point", shown only under the sender's own
 *  most recent message once it (and everything before it) has been read.
 *  This mirrors Instagram's own "Seen" receipt, which is also
 *  conversation-level, not scroll-position-level. */
export function lastOwnMessageId(messages: SeenableMessage[], myId: string): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].fromId === myId) return messages[i].id;
  }
  return null;
}

/** Whether this particular bubble should show the "Seen" receipt: it must
 *  be my own most recent message in the thread, AND the other participant
 *  must have read it (readAt set). */
export function isSeenReceipt(msg: SeenableMessage, myId: string, lastOwnId: string | null): boolean {
  return msg.fromId === myId && msg.id === lastOwnId && !!msg.readAt;
}
