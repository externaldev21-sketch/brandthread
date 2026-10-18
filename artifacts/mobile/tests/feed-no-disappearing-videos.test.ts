/**
 * Watched videos are deprioritized, never hidden ("why are my videos
 * disappearing on my Threads page?"): with ~12 posts in the app, hiding
 * everything a buyer finished emptied the feed. Unseen posts come first,
 * then seen ones, each in ranked order, and the feed keeps serving seen
 * posts once the unseen ones run out.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}));

import { basePostId, pruneFinished, unseenFirst, FINISHED_VIDEOS_TTL_MS } from '@/lib/finishedVideos';

const feed = readFileSync(resolve(__dirname, '../app/(tabs)/feed.tsx'), 'utf8');
const twelve = Array.from({ length: 12 }, (_, i) => ({ id: `post-${i + 1}` })); // ranked order

describe('unseenFirst', () => {
  it('a buyer who watched all 10 videos still sees all 12 posts — unseen first, then seen, in rank order', () => {
    const watched = new Set(twelve.slice(0, 10).map((p) => p.id));
    const ordered = unseenFirst(twelve, watched);
    expect(ordered).toHaveLength(12);
    expect(ordered.map((p) => p.id)).toEqual([
      'post-11', 'post-12',
      'post-1', 'post-2', 'post-3', 'post-4', 'post-5', 'post-6', 'post-7', 'post-8', 'post-9', 'post-10',
    ]);
  });

  it('keeps serving seen posts when nothing unseen is left (the feed never ends empty)', () => {
    const ordered = unseenFirst(twelve, new Set(twelve.map((p) => p.id)));
    expect(ordered.map((p) => p.id)).toEqual(twelve.map((p) => p.id));
  });

  it('treats a looped repeat (`__loopN`) as the same post', () => {
    expect(basePostId('post-3__loop2')).toBe('post-3');
    const ordered = unseenFirst([{ id: 'post-3__loop2' }, { id: 'post-4__loop2' }], new Set(['post-3']));
    expect(ordered.map((p) => p.id)).toEqual(['post-4__loop2', 'post-3__loop2']);
  });

  it('the 7-day window only ages out "seen" for ordering', () => {
    const now = Date.now();
    const kept = pruneFinished({ fresh: now - 1000, old: now - FINISHED_VIDEOS_TTL_MS - 1 }, now);
    expect(Object.keys(kept)).toEqual(['fresh']);
  });
});

describe('the feed orders by seen, it never filters by it', () => {
  it('uses unseenFirst on fresh pages, load-more pages and loop repeats', () => {
    expect(feed.match(/unseenFirst\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(feed).not.toMatch(/withoutFinished/);
  });

  it('records finished videos (end of playback) for ordering', () => {
    expect(feed).toContain('reachedEnd(lastTimeRef.current, currentTime, duration)');
    expect(feed).toContain('markVideoFinished(item.id)');
  });
});
