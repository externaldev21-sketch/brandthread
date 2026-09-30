/**
 * Story mentions — pure, platform-free logic shared by the Activity rail, the
 * "See all" list and the tap-through viewer: newest-first ordering, grouping
 * stories into one ring per tagger, the viewer's start position, and the
 * "seen" bookkeeping. Slide/story stepping itself reuses lib/storyViewerNav.
 */
import type { StoryMentionItem } from '@/services/socialTypes';

/** One ring on the rail: every live mention story from the same tagger. */
export interface MentionRing {
  /** Tagger user id — the ring's stable key. */
  key: string;
  tagger: StoryMentionItem['tagger'];
  /** This tagger's stories, newest first. */
  storyIds: string[];
  /** True once every one of this tagger's stories has been viewed. */
  seen: boolean;
  /** Newest mention time (ms), used to order the rail. */
  latestAt: number;
  /** Where tapping the ring starts: the newest unseen story, else the newest. */
  startStoryId: string;
  thumbnailUrl: string | null;
}

/** Newest mention first. Ties keep the server's order. */
export function orderMentions<T extends Pick<StoryMentionItem, 'mentionedAt'>>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (b.item.mentionedAt - a.item.mentionedAt) || (a.index - b.index))
    .map(({ item }) => item);
}

/**
 * One ring per tagger, newest first. A tagger's ring is white (unseen) while
 * any of their stories is unseen, and starts at their newest unseen story.
 */
export function groupMentionRings(items: readonly StoryMentionItem[]): MentionRing[] {
  const rings = new Map<string, MentionRing>();
  for (const item of orderMentions(items)) {
    const key = item.tagger.userId;
    const ring = rings.get(key);
    if (!ring) {
      rings.set(key, {
        key,
        tagger: item.tagger,
        storyIds: [item.storyId],
        seen: item.seen,
        latestAt: item.mentionedAt,
        startStoryId: item.storyId,
        thumbnailUrl: item.thumbnailUrl,
      });
      continue;
    }
    ring.storyIds.push(item.storyId);
    // Items arrive newest first, so the first unseen one met is the newest.
    if (ring.seen && !item.seen) {
      ring.seen = false;
      ring.startStoryId = item.storyId;
    }
  }
  return [...rings.values()];
}

/** Index in the newest-first `storyIds` queue to open at (0 when unknown). */
export function startIndexFor(storyIds: readonly string[], startId: string | undefined | null): number {
  if (!startId) return 0;
  const index = storyIds.indexOf(startId);
  return index >= 0 ? index : 0;
}

/** Number of tagger rings with something unseen. */
export function unseenRingCount(rings: readonly MentionRing[]): number {
  return rings.filter((ring) => !ring.seen).length;
}

/** Items with `storyId` marked seen (same array when nothing changes). */
export function markMentionSeen(items: StoryMentionItem[], storyId: string): StoryMentionItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.storyId !== storyId || item.seen) return item;
    changed = true;
    return { ...item, seen: true };
  });
  return changed ? next : items;
}

/** A story past its 24h life can't be played (or replied to). */
export function isMentionExpired(item: Pick<StoryMentionItem, 'story'>, now: number = Date.now()): boolean {
  return item.story.expiresAt <= now;
}

/** "@handle" with exactly one leading @ (server handles arrive both ways). */
export function atHandle(handle: string): string {
  const bare = handle.replace(/^@+/, '');
  return bare ? `@${bare}` : '';
}

/** Short ring label: the handle, else the first name. */
export function ringLabel(tagger: Pick<StoryMentionItem['tagger'], 'handle' | 'name'>): string {
  return atHandle(tagger.handle) || tagger.name.split(' ')[0] || tagger.name;
}

/** The secondary tag on a handled row in the See all list, if any. */
export function handledLabel(item: Pick<StoryMentionItem, 'handled' | 'handledAction'>): 'Shared' | 'Dismissed' | null {
  if (!item.handled) return null;
  return item.handledAction === 'reshared' ? 'Shared' : 'Dismissed';
}

/** Where the viewer opens for a story id. */
export function storyMentionViewerHref(storyId: string): string {
  return `/story-mention-viewer?storyId=${encodeURIComponent(storyId)}`;
}

/** Route into the editor to reshare a mention story ("Add to your story"). */
export function reshareEditorHref(args: { storyId: string; imageUrl?: string | null; handle: string; slide: number }): string {
  return `/buyer-story-create?reshareStoryId=${args.storyId}&reshareImage=${encodeURIComponent(args.imageUrl ?? '')}`
    + `&reshareHandle=${encodeURIComponent(args.handle)}&reshareSlide=${args.slide}`;
}
