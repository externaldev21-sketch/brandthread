import { describe, expect, it } from 'vitest';
import { sortRoots } from '../commentSort';

const c = (id: string, at: string, likes = 0, replies = 0, extra: { pinned?: boolean; creatorLiked?: boolean } = {}) => ({
  id, createdAt: at, likesCount: likes, replies: Array.from({ length: replies }), ...extra,
});

describe('sortRoots', () => {
  const rows = [
    c('quiet', '2026-10-01T00:00:00Z', 0, 0, { pinned: true }),
    c('liked', '2026-10-02T00:00:00Z', 2),
    c('talked', '2026-10-03T00:00:00Z', 0, 2),
    c('fav', '2026-10-04T00:00:00Z', 1, 0, { creatorLiked: true }),
    c('new', '2026-10-05T00:00:00Z'),
  ];
  it('matches the server Top order with the pinned comment first', () => {
    expect(sortRoots(rows, 'top').map((r) => r.id)).toEqual(['quiet', 'fav', 'talked', 'liked', 'new']);
  });
  it('Newest is time order with the pinned comment first', () => {
    expect(sortRoots(rows, 'newest').map((r) => r.id)).toEqual(['quiet', 'new', 'fav', 'talked', 'liked']);
  });
});
