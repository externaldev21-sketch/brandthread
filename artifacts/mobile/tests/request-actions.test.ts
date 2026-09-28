/**
 * Pure-logic coverage for the message-request accept/delete state
 * transitions introduced by the Requests-tab redesign:
 *  - lib/conversationListMutations.ts (accept/remove array transforms —
 *    shared by lib/previewInbox.ts's preview-mode mutators)
 *  - lib/pendingRequestDeletes.ts (the deferred-delete pub/sub that backs
 *    the Requests tab's "Undo" toast)
 *
 * Neither module imports react-native/expo-*, so — unlike lib/previewInbox.ts
 * itself, which requires bundled image assets at module scope and can't be
 * imported under Vitest (see tests/buyer-inbox.test.tsx's own comment on
 * this) — these can be exercised directly without any mocking.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { acceptConversationInList, removeConversationFromList, type ConversationLike } from '@/lib/conversationListMutations';
import {
  schedulePendingConversationDelete, cancelPendingConversationDelete, isPendingConversationDelete,
  subscribePendingConversationDeletes, __resetPendingConversationDeletesForTests,
} from '@/lib/pendingRequestDeletes';

describe('acceptConversationInList', () => {
  const list: ConversationLike[] = [
    { id: 'a', isRequest: false, updatedAt: '2020-01-01T00:00:00.000Z' },
    { id: 'b', isRequest: true, updatedAt: '2020-01-01T00:00:00.000Z' },
    { id: 'c', isRequest: true, updatedAt: '2020-01-01T00:00:00.000Z' },
  ];

  it('flips isRequest off and moves the accepted item to the front', () => {
    const next = acceptConversationInList(list, 'b');
    expect(next.map(c => c.id)).toEqual(['b', 'a', 'c']);
    expect(next[0].isRequest).toBe(false);
  });

  it('bumps updatedAt to now on the accepted item', () => {
    const before = Date.now();
    const next = acceptConversationInList(list, 'c');
    const updated = new Date(next[0].updatedAt!).getTime();
    expect(updated).toBeGreaterThanOrEqual(before);
  });

  it('does not mutate the input array', () => {
    const copy = list.map(c => ({ ...c }));
    acceptConversationInList(list, 'b');
    expect(list).toEqual(copy);
  });

  it('returns the same array reference when the id is not found', () => {
    expect(acceptConversationInList(list, 'missing')).toBe(list);
  });
});

describe('removeConversationFromList', () => {
  const list: ConversationLike[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('drops the matching conversation', () => {
    expect(removeConversationFromList(list, 'b').map(c => c.id)).toEqual(['a', 'c']);
  });

  it('is a no-op (new array, same contents) when the id is not found', () => {
    const next = removeConversationFromList(list, 'missing');
    expect(next).toEqual(list);
    expect(next).not.toBe(list);
  });
});

describe('pendingRequestDeletes (Requests-tab Undo)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetPendingConversationDeletesForTests();
  });
  afterEach(() => {
    __resetPendingConversationDeletesForTests();
    vi.useRealTimers();
  });

  it('is not pending before scheduling', () => {
    expect(isPendingConversationDelete('conv-1')).toBe(false);
  });

  it('marks an id pending as soon as it is scheduled', () => {
    schedulePendingConversationDelete('conv-1', () => {});
    expect(isPendingConversationDelete('conv-1')).toBe(true);
  });

  it('commits the delete once the grace period elapses, and un-marks it pending', () => {
    const onCommit = vi.fn();
    schedulePendingConversationDelete('conv-1', onCommit, 4000);
    expect(onCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3999);
    expect(onCommit).not.toHaveBeenCalled();
    expect(isPendingConversationDelete('conv-1')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(isPendingConversationDelete('conv-1')).toBe(false);
  });

  it('Undo (cancel) before the grace period stops the commit from ever firing', () => {
    const onCommit = vi.fn();
    schedulePendingConversationDelete('conv-1', onCommit, 4000);
    vi.advanceTimersByTime(2000);
    cancelPendingConversationDelete('conv-1');
    expect(isPendingConversationDelete('conv-1')).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancelling an id with nothing pending is a harmless no-op', () => {
    expect(() => cancelPendingConversationDelete('never-scheduled')).not.toThrow();
  });

  it('re-scheduling the same id restarts its grace window instead of stacking timers', () => {
    const onCommit = vi.fn();
    schedulePendingConversationDelete('conv-1', onCommit, 4000);
    vi.advanceTimersByTime(3000);
    schedulePendingConversationDelete('conv-1', onCommit, 4000); // restart the clock
    vi.advanceTimersByTime(3000);
    expect(onCommit).not.toHaveBeenCalled(); // only 3s since the restart
    vi.advanceTimersByTime(1000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers on schedule, cancel and commit, with the current snapshot', () => {
    const seen: string[][] = [];
    const unsub = subscribePendingConversationDeletes((ids) => seen.push([...ids].sort()));
    schedulePendingConversationDelete('conv-1', () => {});
    schedulePendingConversationDelete('conv-2', () => {});
    cancelPendingConversationDelete('conv-1');
    vi.advanceTimersByTime(4000); // commits conv-2
    unsub();
    expect(seen).toEqual([
      [], // initial snapshot on subscribe
      ['conv-1'],
      ['conv-1', 'conv-2'],
      ['conv-2'],
      [],
    ]);
  });

  it('an unsubscribed callback stops receiving updates', () => {
    const cb = vi.fn();
    const unsub = subscribePendingConversationDeletes(cb);
    cb.mockClear();
    unsub();
    schedulePendingConversationDelete('conv-1', () => {});
    expect(cb).not.toHaveBeenCalled();
  });
});
