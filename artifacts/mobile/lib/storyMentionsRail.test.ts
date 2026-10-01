import { describe, expect, it } from 'vitest';
import type { StoryMentionItem } from '@/services/socialTypes';
import {
  atHandle, groupMentionRings, handledLabel, isMentionExpired, markMentionSeen, orderMentions,
  reshareEditorHref, ringLabel, startIndexFor, storyMentionViewerHref, unseenRingCount,
} from './storyMentionsRail';
import { advance, nextUser, prevUser, retreat } from './storyViewerNav';

function mention(storyId: string, userId: string, mentionedAt: number, extra: Partial<StoryMentionItem> = {}): StoryMentionItem {
  return {
    storyId,
    tagger: { userId, name: `User ${userId}`, handle: `@${userId}`, initials: 'U', color: '#333', avatarUrl: null, accountType: null },
    thumbnailUrl: `https://img/${storyId}.jpg`,
    slide: 0,
    seen: false,
    handled: false,
    handledAction: null,
    mentionedAt,
    story: { id: storyId, expiresAt: mentionedAt + 24 * 3600e3, media: [] } as unknown as StoryMentionItem['story'],
    ...extra,
  };
}

describe('orderMentions', () => {
  it('sorts newest first and keeps server order on ties', () => {
    const items = [mention('a', 'u1', 10), mention('b', 'u2', 30), mention('c', 'u3', 10), mention('d', 'u4', 20)];
    expect(orderMentions(items).map((i) => i.storyId)).toEqual(['b', 'd', 'a', 'c']);
  });
});

describe('groupMentionRings', () => {
  it('groups by tagger, newest ring first', () => {
    const rings = groupMentionRings([
      mention('s1', 'u1', 10), mention('s2', 'u2', 40), mention('s3', 'u1', 30),
    ]);
    expect(rings.map((r) => r.key)).toEqual(['u2', 'u1']);
    expect(rings[1].storyIds).toEqual(['s3', 's1']);
    expect(rings[1].latestAt).toBe(30);
  });

  it('is unseen while any story is unseen and starts at the newest unseen', () => {
    const [ring] = groupMentionRings([
      mention('new', 'u1', 30, { seen: true }), mention('old', 'u1', 10),
    ]);
    expect(ring.seen).toBe(false);
    expect(ring.startStoryId).toBe('old');
  });

  it('is seen only when every story is seen, starting at the newest', () => {
    const [ring] = groupMentionRings([
      mention('new', 'u1', 30, { seen: true }), mention('old', 'u1', 10, { seen: true }),
    ]);
    expect(ring.seen).toBe(true);
    expect(ring.startStoryId).toBe('new');
  });

  it('returns nothing for no mentions and counts unseen rings', () => {
    expect(groupMentionRings([])).toEqual([]);
    const rings = groupMentionRings([mention('a', 'u1', 2), mention('b', 'u2', 1, { seen: true })]);
    expect(unseenRingCount(rings)).toBe(1);
  });
});

describe('viewer helpers', () => {
  it('finds the start index, defaulting to the first story', () => {
    expect(startIndexFor(['a', 'b', 'c'], 'c')).toBe(2);
    expect(startIndexFor(['a', 'b'], 'zzz')).toBe(0);
    expect(startIndexFor(['a', 'b'], undefined)).toBe(0);
  });

  it('steps slides then stories, and closes after the last (reused nav)', () => {
    const counts = [2, 1];
    expect(advance(0, 0, counts)).toEqual({ storyIdx: 0, slideIdx: 1, shouldClose: false });
    expect(advance(0, 1, counts)).toEqual({ storyIdx: 1, slideIdx: 0, shouldClose: false });
    expect(advance(1, 0, counts).shouldClose).toBe(true);
    expect(retreat(1, 0, counts)).toEqual({ storyIdx: 0, slideIdx: 1, shouldClose: false });
    expect(nextUser(0, 2).storyIdx).toBe(1);
    expect(prevUser(0).storyIdx).toBe(0);
  });

  it('marks a mention seen without touching the array when already seen', () => {
    const items = [mention('a', 'u1', 1), mention('b', 'u2', 2, { seen: true })];
    const next = markMentionSeen(items, 'a');
    expect(next[0].seen).toBe(true);
    expect(markMentionSeen(next, 'a')).toBe(next);
    expect(markMentionSeen(items, 'nope')).toBe(items);
  });

  it('detects expiry', () => {
    const item = mention('a', 'u1', 0);
    expect(isMentionExpired(item, 1000)).toBe(false);
    expect(isMentionExpired(item, 25 * 3600e3)).toBe(true);
  });

  it('formats labels, tags and routes', () => {
    expect(atHandle('@@mina')).toBe('@mina');
    expect(atHandle('mina')).toBe('@mina');
    expect(ringLabel({ handle: '', name: 'Mina Park' })).toBe('Mina');
    expect(handledLabel({ handled: true, handledAction: 'reshared' })).toBe('Shared');
    expect(handledLabel({ handled: true, handledAction: 'dismissed' })).toBe('Dismissed');
    expect(handledLabel({ handled: false, handledAction: null })).toBeNull();
    expect(storyMentionViewerHref('s 1')).toBe('/story-mention-viewer?storyId=s%201');
    expect(reshareEditorHref({ storyId: 's1', imageUrl: 'https://x/y.jpg?a=1', handle: '@mina', slide: 2 }))
      .toBe('/buyer-story-create?reshareStoryId=s1&reshareImage=https%3A%2F%2Fx%2Fy.jpg%3Fa%3D1&reshareHandle=%40mina&reshareSlide=2');
  });
});
