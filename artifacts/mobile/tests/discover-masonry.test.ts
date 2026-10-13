import { describe, expect, it } from 'vitest';
import {
  MAX_ASPECT, MIN_ASPECT, buildMasonrySections, parseAspectRatio, splitMasonryColumns, tileAspectRatio,
} from '@/lib/discoverMasonry';
import { buildGridRows } from '@/lib/discoverGridPacking';
import type { DiscoverPost } from '@/lib/discoverFeed';

function post(id: string, extra: Partial<DiscoverPost> = {}): DiscoverPost {
  return {
    id, authorId: `a-${id}`, authorName: `A ${id}`, authorHandle: `@a${id}`, authorInitials: 'A',
    authorColor: '#2A2A2E', authorAccountType: 'seller', media: 'photo', likesCount: 0, commentsCount: 0,
    createdAt: '2026-01-01T00:00:00Z', ...extra,
  };
}

describe('parseAspectRatio', () => {
  it('reads the API text ratios and plain numbers', () => {
    expect(parseAspectRatio('9:16')).toBeCloseTo(9 / 16);
    expect(parseAspectRatio('4:5')).toBeCloseTo(0.8);
    expect(parseAspectRatio('1:1')).toBe(1);
    expect(parseAspectRatio(0.75)).toBe(0.75);
  });
  it('rejects junk', () => {
    expect(parseAspectRatio('wide')).toBeNull();
    expect(parseAspectRatio('0:4')).toBeNull();
    expect(parseAspectRatio(-1)).toBeNull();
    expect(parseAspectRatio(undefined)).toBeNull();
  });
});

describe('tileAspectRatio', () => {
  it('uses the real ratio when known, clamped', () => {
    expect(tileAspectRatio(post('x', { aspectRatio: 0.8, imageUri: 'a.jpg' }))).toBeCloseTo(0.8);
    expect(tileAspectRatio(post('x', { aspectRatio: 0.2, imageUri: 'a.jpg' }))).toBe(MIN_ASPECT);
    expect(tileAspectRatio(post('x', { aspectRatio: 3, imageUri: 'a.jpg' }))).toBe(MAX_ASPECT);
  });
  it('keeps text-only tiles square', () => {
    expect(tileAspectRatio(post('x', { aspectRatio: 0.5 }))).toBe(1);
  });
  it('falls back to a deterministic, varied ratio', () => {
    const ids = Array.from({ length: 24 }, (_, i) => `post_${i}`);
    const first = ids.map((id) => tileAspectRatio(post(id, { imageUri: 'a.jpg' })));
    const second = ids.map((id) => tileAspectRatio(post(id, { imageUri: 'a.jpg' })));
    expect(second).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(2);
    for (const a of first) {
      expect(a).toBeGreaterThanOrEqual(MIN_ASPECT);
      expect(a).toBeLessThanOrEqual(MAX_ASPECT);
    }
  });
});

describe('splitMasonryColumns', () => {
  it('puts each item in the shorter column, ties left', () => {
    const cols = splitMasonryColumns([300, 100, 100, 100, 50], (h) => h, 10);
    // 300→L; 100→R(100); 100→R(210); 100→R(320); 50→L (300 < 320).
    expect(cols.left).toEqual([300, 50]);
    expect(cols.right).toEqual([100, 100, 100]);
    expect(cols.leftHeight).toBe(300 + 10 + 50);
    expect(cols.rightHeight).toBe(100 + 10 + 100 + 10 + 100);
  });
  it('keeps feed order inside each column and loses nothing', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ i, h: 100 + ((i * 37) % 120) }));
    const cols = splitMasonryColumns(items, (x) => x.h, 8);
    expect(cols.left.length + cols.right.length).toBe(30);
    const isSorted = (list: typeof items) => list.every((x, k) => k === 0 || list[k - 1].i < x.i);
    expect(isSorted(cols.left)).toBe(true);
    expect(isSorted(cols.right)).toBe(true);
  });
  it('stays balanced to within one tile', () => {
    const items = Array.from({ length: 40 }, (_, i) => 120 + ((i * 53) % 200));
    const cols = splitMasonryColumns(items, (h) => h, 8);
    expect(Math.abs(cols.leftHeight - cols.rightHeight)).toBeLessThanOrEqual(Math.max(...items) + 8);
  });
  it('handles empty input', () => {
    expect(splitMasonryColumns([], () => 1)).toEqual({ left: [], right: [], leftHeight: 0, rightHeight: 0 });
  });
});

describe('buildMasonrySections', () => {
  const posts = Array.from({ length: 30 }, (_, i) => post(String(i)));
  it('merges post rows into masonry blocks around rails, keeping every post once', () => {
    const rows = buildGridRows(posts, { showRails: true, hasJustDropped: true, hasHighDemand: true, hasPeople: true });
    const sections = buildMasonrySections(rows, { trendingNow: false });
    const flat = sections.flatMap((s) => (s.type === 'masonry' ? s.posts.map((p) => p.id) : []));
    expect(flat).toEqual(posts.map((p) => p.id));
    expect(sections.some((s) => s.type === 'rail' && s.kind === 'justDropped')).toBe(true);
    // Never two masonry blocks back to back.
    sections.forEach((s, i) => {
      if (i > 0 && s.type === 'masonry') expect(sections[i - 1].type).not.toBe('masonry');
    });
    expect(new Set(sections.map((s) => s.key)).size).toBe(sections.length);
  });
  it('leads with Trending now only when there is trending data', () => {
    const rows = buildGridRows(posts.slice(0, 6), { showRails: false, hasJustDropped: false, hasHighDemand: false, hasPeople: false });
    expect(buildMasonrySections(rows, { trendingNow: true })[0].type).toBe('trendingNow');
    expect(buildMasonrySections(rows, { trendingNow: false }).some((s) => s.type === 'trendingNow')).toBe(false);
  });
});
