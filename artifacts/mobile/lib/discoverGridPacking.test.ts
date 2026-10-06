import { describe, expect, it } from 'vitest';
import { buildGridRows, type GridRow } from '@/lib/discoverGridPacking';
import type { DiscoverPost } from '@/lib/discoverFeed';

function post(id: string): DiscoverPost {
  return {
    id, authorId: `a-${id}`, authorName: id, authorHandle: `@${id}`, authorInitials: 'A',
    authorColor: '#232323', authorAccountType: 'seller', media: 'photo',
    likesCount: 0, commentsCount: 0, createdAt: new Date().toISOString(),
  };
}
const NO_RAILS = { showRails: false, hasJustDropped: false, hasHighDemand: false, hasPeople: false };
const ids = (rows: GridRow[]) => rows.flatMap((r) =>
  r.type === 'normal' ? r.tiles.map((p) => p.id) : r.type === 'feature' ? [r.big.id, ...r.small.map((p) => p.id)] : []);

describe('buildGridRows — no partial trailing row (QA-0268/0270)', () => {
  for (let n = 2; n <= 40; n++) {
    it(`${n} posts: keeps every post and ends on a full row`, () => {
      const posts = Array.from({ length: n }, (_, i) => post(String(i)));
      const rows = buildGridRows(posts, NO_RAILS);
      expect(ids(rows)).toEqual(posts.map((p) => p.id));
      const last = rows[rows.length - 1];
      if (last.type === 'normal') expect(last.tiles.length).toBe(last.cols === 2 ? 2 : 3);
    });
  }

  it('a lone trailing tile after a feature row re-packs into two 2-column rows', () => {
    const posts = Array.from({ length: 10 }, (_, i) => post(String(i)));
    const rows = buildGridRows(posts, NO_RAILS);
    expect(rows.slice(-2).map((r) => (r.type === 'normal' ? [r.tiles.length, r.cols] : null))).toEqual([[2, 2], [2, 2]]);
  });
});
