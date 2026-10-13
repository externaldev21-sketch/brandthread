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
 *  `tight`; every outer/edge corner stays `full`. With `tail`, the last
 *  bubble of a group (or a lone bubble) also gets that radius on its
 *  bottom corner on the sender's side — the small "tail" corner. */
export function groupCornerRadii(
  isOwn: boolean,
  isFirstInGroup: boolean,
  isLastInGroup: boolean,
  full: number,
  tight = 6,
  tail?: number,
): {
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
  borderBottomRightRadius: number;
  borderBottomLeftRadius: number;
} {
  const tailCorner = tail !== undefined && isLastInGroup ? tail : null;
  return {
    borderTopLeftRadius: (!isOwn && !isFirstInGroup) ? tight : full,
    borderTopRightRadius: (isOwn && !isFirstInGroup) ? tight : full,
    borderBottomRightRadius: isOwn ? (tailCorner ?? (!isLastInGroup ? tight : full)) : full,
    borderBottomLeftRadius: !isOwn ? (tailCorner ?? (!isLastInGroup ? tight : full)) : full,
  };
}

/** Messages bubble spec (Instagram, reskinned): 18pt corners, a 4pt tail
 *  corner on the last bubble of a group, white sent / #262628 received. */
export const BUBBLE_RADIUS = 18;
export const BUBBLE_TAIL_RADIUS = 4;
export const SENT_BUBBLE = '#FFFFFF';
export const SENT_BUBBLE_TEXT = '#000000';
export const RECEIVED_BUBBLE = '#262628';
export const RECEIVED_BUBBLE_TEXT = '#FFFFFF';
