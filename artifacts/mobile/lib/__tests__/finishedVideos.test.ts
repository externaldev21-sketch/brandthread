import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
    },
  };
});

import {
  FINISHED_VIDEOS_TTL_MS, finishedVideoIds, loadFinishedVideos, markVideoFinished,
  pruneFinished, reachedEnd, unseenFirst,
} from '../finishedVideos';

describe('pruneFinished', () => {
  it('drops expired entries and keeps the newest', () => {
    const now = 10_000_000_000;
    const out = pruneFinished({ old: now - FINISHED_VIDEOS_TTL_MS - 1, a: now - 3, b: now - 2, c: now - 1 }, now, 2);
    expect(Object.keys(out).sort()).toEqual(['b', 'c']);
  });
});

describe('unseenFirst', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('ranks finished posts after unseen ones without removing them', () => {
    expect(unseenFirst(items, new Set(['b'])).map((i) => i.id)).toEqual(['a', 'c', 'b']);
  });
  it('keeps every post in rank order when all have been watched', () => {
    expect(unseenFirst(items, new Set(['a', 'b', 'c']))).toEqual(items);
  });
});

describe('reachedEnd', () => {
  it('fires at the last frame or on loop wrap, not mid-video', () => {
    expect(reachedEnd(9.5, 9.8, 10)).toBe(true);
    expect(reachedEnd(9.2, 0.1, 10)).toBe(true);
    expect(reachedEnd(4, 4.25, 10)).toBe(false);
    expect(reachedEnd(1, 0.1, 10)).toBe(false); // a scrub back is not a finish
    expect(reachedEnd(0, 0.5, 0)).toBe(false);
  });
});

describe('markVideoFinished', () => {
  it('persists and exposes ids', async () => {
    await loadFinishedVideos();
    markVideoFinished('post-1');
    await new Promise((r) => setTimeout(r, 0));
    expect(finishedVideoIds().has('post-1')).toBe(true);
  });
});
