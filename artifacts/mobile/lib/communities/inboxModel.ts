/**
 * Pure helpers for showing joined communities in the Messages inboxes:
 * preview copy, muted/unread presentation, and the recency merge with DMs.
 * Community chats are a separate kind of row — never requests, never counted
 * by DM-only filters.
 */
import type { Community } from './types';

export type CommunityRowTarget = Pick<
  Community,
  'description' | 'lastMessage' | 'lastMessageSenderName' | 'muted' | 'unreadCount'
>;

/** "Mara: new drop tonight" — sender first name prefix, description fallback, then a neutral empty line. */
export function communityPreviewText(c: Pick<Community, 'description' | 'lastMessage' | 'lastMessageSenderName'>): string {
  const text = c.lastMessage?.trim();
  if (text) {
    const first = c.lastMessageSenderName?.trim().split(/\s+/)[0];
    return first ? `${first}: ${text}` : text;
  }
  return c.description?.trim() || 'No messages yet';
}

export interface CommunityRowPresentation {
  /** Unread + not muted → bold name/preview and the loud badge, like a DM. */
  loud: boolean;
  /** Unread but muted → quiet gray number with a bell-off glyph, no bold. */
  quietUnread: boolean;
  /** Muted rows always carry the bell-off glyph, unread or not. */
  showMutedGlyph: boolean;
  /** Count text ("99+" cap). */
  countLabel: string;
}

export function communityRowPresentation(c: Pick<Community, 'muted' | 'unreadCount'>): CommunityRowPresentation {
  const unread = c.unreadCount > 0;
  return {
    loud: unread && !c.muted,
    quietUnread: unread && c.muted,
    showMutedGlyph: c.muted,
    countLabel: c.unreadCount > 99 ? '99+' : String(c.unreadCount),
  };
}

/** Mute/Unmute swipe action copy — the only swipe action community rows offer. */
export function communityMuteActionLabel(c: Pick<Community, 'muted'>): { label: string; icon: 'bell-off' | 'bell' } {
  return c.muted ? { label: 'Unmute', icon: 'bell' } : { label: 'Mute', icon: 'bell-off' };
}

export type InboxMergedRow<D> =
  | { kind: 'dm'; key: string; dm: D }
  | { kind: 'community'; key: string; community: Community };

/**
 * Interleaves communities into an already-ordered DM list by recency.
 * The DM order (pinned first, then the existing server/sort order) is kept
 * exactly; each community is inserted before the first unpinned DM that is
 * older than it. Pinned DMs therefore always stay on top.
 */
export function mergeInboxRows<D>(
  dms: D[],
  communities: Community[],
  opts: { getKey: (d: D) => string; getTs: (d: D) => number | undefined; isPinned: (d: D) => boolean },
): InboxMergedRow<D>[] {
  const tsOf = (c: Community) => c.lastMessageTs ?? (Date.parse(c.createdAt) || 0);
  const sortedCommunities = [...communities].sort(
    (a, b) => tsOf(b) - tsOf(a),
  );
  const out: InboxMergedRow<D>[] = [];
  let ci = 0;
  const pushCommunity = (c: Community) => out.push({ kind: 'community', key: `community-${c.id}`, community: c });
  for (const dm of dms) {
    if (!opts.isPinned(dm)) {
      const dmTs = opts.getTs(dm) ?? 0;
      while (ci < sortedCommunities.length && tsOf(sortedCommunities[ci]) > dmTs) pushCommunity(sortedCommunities[ci++]);
    }
    out.push({ kind: 'dm', key: opts.getKey(dm), dm });
  }
  while (ci < sortedCommunities.length) pushCommunity(sortedCommunities[ci++]);
  return out;
}

/** Search box match for a community row (name + last message). */
export function communityMatchesQuery(c: Pick<Community, 'name' | 'lastMessage'>, queryLower: string): boolean {
  if (!queryLower) return true;
  return [c.name, c.lastMessage].filter(Boolean).join(' ').toLowerCase().includes(queryLower);
}
