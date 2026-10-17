import { describe, expect, it } from 'vitest';
import { insertReplies, replyCursorsFrom } from './replyPages';

type R = { id: string; parentId: string | null; isReply: boolean };
const root = (id: string): R => ({ id, parentId: null, isReply: false });
const reply = (id: string, parentId: string): R => ({ id, parentId, isReply: true });

describe('replyCursorsFrom', () => {
  it('keeps only roots the server flagged as having more replies', () => {
    const roots = [
      { id: 'a', hasMoreReplies: true, repliesNextCursor: '2026-01-01T00:00:00.000Z' },
      { id: 'b', hasMoreReplies: false, repliesNextCursor: null },
      { id: 'c' },
    ] as any;
    expect(replyCursorsFrom(roots)).toEqual({ a: '2026-01-01T00:00:00.000Z' });
  });
});

describe('insertReplies', () => {
  it('appends a page after the root’s existing replies, before the next root', () => {
    const rows = [root('a'), reply('a1', 'a'), root('b'), reply('b1', 'b')];
    const next = insertReplies(rows, 'a', [reply('a2', 'a'), reply('a3', 'a')]);
    expect(next.map((r) => r.id)).toEqual(['a', 'a1', 'a2', 'a3', 'b', 'b1']);
  });

  it('skips replies that are already loaded', () => {
    const rows = [root('a'), reply('a1', 'a')];
    expect(insertReplies(rows, 'a', [reply('a1', 'a')])).toBe(rows);
  });

  it('is a no-op for an unknown root', () => {
    const rows = [root('a')];
    expect(insertReplies(rows, 'zzz', [reply('z1', 'zzz')])).toBe(rows);
  });
});
