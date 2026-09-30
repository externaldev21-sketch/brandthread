import { describe, expect, it } from 'vitest';
import {
  applyCreated, applySent, buildRows, isNearBottom, markPending, maxSeq, newMessagesLabel, nextNewCount,
  reactionChips, removeMessage, setReactions, toDisplay, toInvertedRows, toggleMyReaction, upsertMessages,
  type ChatLists, type PendingMessage,
} from '../chatMerge';
import type { CommunityMessage } from '../types';

const ME = 'me';
const T0 = new Date(2026, 5, 10, 12, 0, 0).getTime();

function msg(seq: number, over: Partial<CommunityMessage> = {}): CommunityMessage {
  return {
    id: `m${seq}`, communityId: 'c1', seq, fromId: 'u1', fromName: 'Ada', fromHandle: 'ada', fromInitials: 'A', fromColor: '#333',
    text: `text ${seq}`, attachments: [], reactions: [], ts: T0 + seq * 1000, ...over,
  };
}

function pend(clientId: string, text: string, over: Partial<PendingMessage> = {}): PendingMessage {
  return { clientId, text, attachments: [], ts: T0, status: 'sending', ...over };
}

describe('upsertMessages', () => {
  it('sorts by seq and dedupes by id', () => {
    const out = upsertMessages([msg(1), msg(3)], [msg(2), msg(3)]);
    expect(out.map((m) => m.seq)).toEqual([1, 2, 3]);
  });

  it('prepends an older page in order', () => {
    const out = upsertMessages([msg(51), msg(52)], [msg(49), msg(50)]);
    expect(out.map((m) => m.seq)).toEqual([49, 50, 51, 52]);
  });

  it('lets a fetched copy replace, but a realtime copy never overwrites', () => {
    const existing = msg(1, { reactions: [{ userId: 'x', reactionType: 'like', createdAt: '' }] });
    const fresh = msg(1, { reactions: [] });
    expect(upsertMessages([existing], [fresh], true)[0].reactions).toHaveLength(0);
    expect(upsertMessages([existing], [fresh], false)[0].reactions).toHaveLength(1);
  });

  it('returns the same array when nothing changed', () => {
    const items = [msg(1)];
    expect(upsertMessages(items, [])).toBe(items);
    expect(upsertMessages(items, [msg(1)], false)).toBe(items);
  });
});

describe('remove / reactions / cursor', () => {
  it('removes by id and keeps identity when absent', () => {
    const items = [msg(1), msg(2)];
    expect(removeMessage(items, 'm1').map((m) => m.id)).toEqual(['m2']);
    expect(removeMessage(items, 'nope')).toBe(items);
  });

  it('setReactions swaps only the target message', () => {
    const r = [{ userId: 'x', reactionType: 'fire', createdAt: '' }];
    const out = setReactions([msg(1), msg(2)], 'm2', r);
    expect(out[0].reactions).toEqual([]);
    expect(out[1].reactions).toEqual(r);
  });

  it('maxSeq is 0 for an empty list', () => {
    expect(maxSeq([])).toBe(0);
    expect(maxSeq([msg(4), msg(9)])).toBe(9);
  });
});

describe('applyCreated / applySent (optimistic merge)', () => {
  it('ignores a duplicate realtime message', () => {
    const lists: ChatLists = { items: [msg(1)], pending: [] };
    const r = applyCreated(lists, msg(1), ME);
    expect(r.items).toBe(lists.items);
    expect(r.isNewFromOthers).toBe(false);
  });

  it('flags messages from others as new', () => {
    const r = applyCreated({ items: [msg(1)], pending: [] }, msg(2), ME);
    expect(r.isNewFromOthers).toBe(true);
    expect(r.items.map((m) => m.seq)).toEqual([1, 2]);
  });

  it('swaps my pending bubble for its realtime echo (no double bubble)', () => {
    const echo = msg(2, { fromId: ME, text: 'hello' });
    const r = applyCreated({ items: [msg(1)], pending: [pend('c1', 'hello')] }, echo, ME);
    expect(r.pending).toHaveLength(0);
    expect(r.items.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(r.isNewFromOthers).toBe(false);
  });

  it('does not treat another sender with the same text as my echo', () => {
    const r = applyCreated({ items: [], pending: [pend('c1', 'hello')] }, msg(2, { text: 'hello' }), ME);
    expect(r.pending).toHaveLength(1);
    expect(r.isNewFromOthers).toBe(true);
  });

  it('only echo-matches pending that is still sending (a failed one stays retryable)', () => {
    const r = applyCreated({ items: [], pending: [pend('c1', 'hi', { status: 'failed' })] }, msg(2, { fromId: ME, text: 'hi' }), ME);
    expect(r.pending).toHaveLength(1);
  });

  it('applySent after the echo already landed leaves exactly one copy', () => {
    const echo = msg(2, { fromId: ME, text: 'hello' });
    const afterEcho = applyCreated({ items: [], pending: [pend('c1', 'hello')] }, echo, ME);
    const done = applySent({ items: afterEcho.items, pending: afterEcho.pending }, 'c1', echo);
    expect(done.items).toHaveLength(1);
    expect(done.pending).toHaveLength(0);
  });

  it('applySent before the echo: the later echo is deduped by id', () => {
    const real = msg(2, { fromId: ME, text: 'hello' });
    const sent = applySent({ items: [], pending: [pend('c1', 'hello')] }, 'c1', real);
    const echoed = applyCreated(sent, real, ME);
    expect(echoed.items).toHaveLength(1);
    expect(echoed.isNewFromOthers).toBe(false);
  });

  it('markPending flips status without touching other pending', () => {
    const out = markPending([pend('a', 'x'), pend('b', 'y')], 'b', { status: 'failed', error: 'nope' });
    expect(out[0].status).toBe('sending');
    expect(out[1]).toMatchObject({ status: 'failed', error: 'nope' });
  });
});

describe('toDisplay', () => {
  it('hides blocked senders and appends my pending at the bottom as mine', () => {
    const items = [msg(1, { fromId: 'bad' }), msg(2)];
    const out = toDisplay(items, [pend('c1', 'yo')], new Set(['bad']), { id: ME });
    expect(out.map((m) => m.id)).toEqual(['m2', 'pending:c1']);
    expect(out[1]).toMatchObject({ fromId: ME, pendingStatus: 'sending', clientId: 'c1' });
  });

  it('returns the same array when there is nothing to hide or append', () => {
    const items = [msg(1)];
    expect(toDisplay(items, [], new Set(), { id: ME })).toBe(items);
  });
});

describe('buildRows (grouping + day separators)', () => {
  it('groups consecutive messages from one sender and breaks on a different sender', () => {
    const rows = buildRows([msg(1), msg(2), msg(3, { fromId: 'u2' })]).filter((r) => r.type === 'message');
    const flags = rows.map((r) => r.type === 'message' && [r.isFirstInGroup, r.isLastInGroup]);
    expect(flags).toEqual([[true, false], [false, true], [true, true]]);
  });

  it('starts a new group after a long gap', () => {
    const rows = buildRows([msg(1), msg(2, { ts: T0 + 10 * 60_000 })]).filter((r) => r.type === 'message');
    expect(rows.map((r) => r.type === 'message' && r.isFirstInGroup)).toEqual([true, true]);
  });

  it('inserts one day separator per day and never groups across it', () => {
    const late = new Date(2026, 5, 10, 23, 59, 0).getTime();
    const next = new Date(2026, 5, 11, 0, 1, 0).getTime();
    const rows = buildRows([msg(1, { ts: late }), msg(2, { ts: next })]);
    expect(rows.map((r) => r.type)).toEqual(['day', 'message', 'day', 'message']);
    const last = rows[3];
    expect(last.type === 'message' && last.isFirstInGroup).toBe(true);
  });

  it('inverts to newest-first with each day label after (above) its messages', () => {
    const rows = toInvertedRows([msg(1), msg(2)]);
    expect(rows.map((r) => r.type)).toEqual(['message', 'message', 'day']);
    expect(rows[0].type === 'message' && rows[0].msg.id).toBe('m2');
  });
});

describe('reactions', () => {
  const order = ['like', 'love', 'haha', 'wow', 'sad', 'fire'];
  const r = (userId: string, reactionType: string) => ({ userId, reactionType, createdAt: '' });

  it('builds count chips, most used first, flagging mine', () => {
    const chips = reactionChips([r('a', 'fire'), r('b', 'like'), r('c', 'fire'), ], 'b', order);
    expect(chips).toEqual([
      { type: 'fire', count: 2, mine: false },
      { type: 'like', count: 1, mine: true },
    ]);
  });

  it('breaks count ties by the fixed reaction order', () => {
    const chips = reactionChips([r('a', 'fire'), r('b', 'love')], null, order);
    expect(chips.map((c) => c.type)).toEqual(['love', 'fire']);
  });

  it('toggle: add, swap, remove (one reaction per member)', () => {
    const added = toggleMyReaction([], ME, 'like');
    expect(added.action).toBe('react');
    expect(added.reactions.map((x) => x.reactionType)).toEqual(['like']);

    const swapped = toggleMyReaction(added.reactions, ME, 'fire');
    expect(swapped.action).toBe('react');
    expect(swapped.reactions.map((x) => x.reactionType)).toEqual(['fire']);

    const removed = toggleMyReaction(swapped.reactions, ME, 'fire');
    expect(removed.action).toBe('unreact');
    expect(removed.reactions).toEqual([]);
  });

  it('toggle keeps other members reactions', () => {
    const out = toggleMyReaction([r('other', 'like')], ME, 'like');
    expect(out.reactions).toHaveLength(2);
  });
});

describe('unread pill', () => {
  it('counts only others messages while scrolled up, resets at the bottom', () => {
    let n = 0;
    n = nextNewCount(n, { nearBottom: false, fromOthers: true });
    n = nextNewCount(n, { nearBottom: false, fromOthers: false });
    n = nextNewCount(n, { nearBottom: false, fromOthers: true });
    expect(n).toBe(2);
    expect(nextNewCount(n, { nearBottom: true, fromOthers: true })).toBe(0);
  });

  it('near-bottom threshold and label', () => {
    expect(isNearBottom(0)).toBe(true);
    expect(isNearBottom(500)).toBe(false);
    expect(newMessagesLabel(1)).toBe('1 new message');
    expect(newMessagesLabel(4)).toBe('4 new messages');
  });
});
