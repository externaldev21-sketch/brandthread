import { describe, expect, it } from 'vitest';
import { confirmLiveChatLine, latestLiveChatCursor, liveCommentsToLines, mergeLiveChat } from '../liveFeedChat';

const row = (id: string, message: string, created_at: string, display_name = 'Jules') => ({ id, message, created_at, display_name });

describe('liveCommentsToLines', () => {
  it('maps API rows (newest first) to chat lines oldest first', () => {
    expect(liveCommentsToLines([row('2', 'second', 't2'), row('1', 'first', 't1', '')])).toEqual([
      { id: '1', user: 'Viewer', text: 'first', createdAt: 't1' },
      { id: '2', user: 'Jules', text: 'second', createdAt: 't2' },
    ]);
  });

  it('ignores malformed payloads', () => {
    expect(liveCommentsToLines(undefined)).toEqual([]);
    expect(liveCommentsToLines([null, { id: 3 }])).toEqual([]);
  });
});

describe('mergeLiveChat', () => {
  it('skips lines already shown and caps the list', () => {
    const prev = [{ id: '1', user: 'a', text: 'x' }];
    const next = mergeLiveChat(prev, [{ id: '1', user: 'a', text: 'x' }, { id: '2', user: 'b', text: 'y' }], 2);
    expect(next.map((l) => l.id)).toEqual(['1', '2']);
    expect(mergeLiveChat(next, [{ id: '3', user: 'c', text: 'z' }], 2).map((l) => l.id)).toEqual(['2', '3']);
  });

  it('returns the same array when nothing is new', () => {
    const prev = [{ id: '1', user: 'a', text: 'x' }];
    expect(mergeLiveChat(prev, [{ id: '1', user: 'a', text: 'x' }])).toBe(prev);
  });
});

describe('confirmLiveChatLine', () => {
  it('swaps the optimistic line for the server row', () => {
    const prev = [{ id: 'local_1', user: 'You', text: 'hi' }];
    expect(confirmLiveChatLine(prev, 'local_1', { id: '9', user: 'Ava', text: 'hi', createdAt: 't9' }))
      .toEqual([{ id: '9', user: 'Ava', text: 'hi', createdAt: 't9' }]);
  });

  it('drops the optimistic line when a poll already delivered the server row', () => {
    const prev = [{ id: 'local_1', user: 'You', text: 'hi' }, { id: '9', user: 'Ava', text: 'hi' }];
    expect(confirmLiveChatLine(prev, 'local_1', { id: '9', user: 'Ava', text: 'hi' })).toEqual([{ id: '9', user: 'Ava', text: 'hi' }]);
  });
});

describe('latestLiveChatCursor', () => {
  it('uses the newest server timestamp, ignoring optimistic lines', () => {
    expect(latestLiveChatCursor([
      { id: '1', user: 'a', text: 'x', createdAt: 't1' },
      { id: 'local_2', user: 'You', text: 'y', createdAt: 't2' },
    ])).toBe('t1');
    expect(latestLiveChatCursor([])).toBeUndefined();
  });
});
