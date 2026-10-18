import { describe, expect, it } from 'vitest';
import { inboxPinRank, sortInboxPinnedFirst } from '@/lib/brandthreadAssistant';

type Row = { id: string; isOfficial?: boolean; isPinned?: boolean };

describe('sortInboxPinnedFirst — the Brandthread chat is always at the very top', () => {
  it('puts the official chat above user-pinned and recent threads', () => {
    const rows: Row[] = [
      { id: 'recent-1' },
      { id: 'pinned-1', isPinned: true },
      { id: 'brandthread', isOfficial: true, isPinned: true },
      { id: 'recent-2' },
      { id: 'pinned-2', isPinned: true },
    ];
    expect(sortInboxPinnedFirst(rows).map((r) => r.id)).toEqual([
      'brandthread', 'pinned-1', 'pinned-2', 'recent-1', 'recent-2',
    ]);
  });

  it('keeps the incoming most-recent-first order within each group', () => {
    const rows: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c', isOfficial: true }, { id: 'd' }];
    expect(sortInboxPinnedFirst(rows).map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('shows the official chat alone when the inbox is otherwise empty', () => {
    expect(sortInboxPinnedFirst([{ id: 'brandthread', isOfficial: true }]).map((r) => r.id)).toEqual(['brandthread']);
  });

  it('does not mutate the input', () => {
    const rows: Row[] = [{ id: 'x' }, { id: 'y', isOfficial: true }];
    sortInboxPinnedFirst(rows);
    expect(rows.map((r) => r.id)).toEqual(['x', 'y']);
  });

  it('ranks official > pinned > other', () => {
    expect(inboxPinRank({ isOfficial: true })).toBeGreaterThan(inboxPinRank({ isPinned: true }));
    expect(inboxPinRank({ isPinned: true })).toBeGreaterThan(inboxPinRank({}));
  });
});
