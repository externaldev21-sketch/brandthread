/**
 * Pure LIVE pager logic: ordering, graceful removal of ended streams,
 * deep-link landing, chat buffering, count formatting, the shared "who is
 * live" directory, and the Buy → Shop sheet hand-off.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendChat, formatUpcomingTime, formatViewerCount, initialStreamIndex, LIVE_CHAT_BUFFER,
  nextIndexAfterRemoval, orderLiveStreams,
} from '../lib/live/liveOrdering';
import { createLiveDirectory } from '../lib/live/liveDirectory';
import { liveShopSelection } from '../lib/live/liveShop';
import type { LiveChatMessage, LiveStream } from '../lib/live/types';

function stream(id: string, viewerCount: number, followedByViewer = false, startedAt = 0): LiveStream {
  return {
    id, viewerCount, followedByViewer, startedAt, likeCount: 0, title: id,
    host: { id: `host-${id}`, name: `Host ${id}`, handle: `@${id}`, initials: 'HH', avatarColor: '#111', verified: true },
    products: [
      { productId: `${id}-p1`, name: 'Coat', priceCents: 48000, sizes: ['S', 'M'], compareAtPriceCents: 52000 },
      { productId: `${id}-p2`, name: 'Dress', priceCents: 32500 },
    ],
    pinnedProductId: `${id}-p1`, topViewers: [], video: { kind: 'video', source: 'x.mp4' },
  };
}

describe('orderLiveStreams', () => {
  it('followed first, then viewers desc, then earliest start', () => {
    const out = orderLiveStreams([stream('a', 10), stream('b', 5, true), stream('c', 900), stream('d', 10, false, -5)]);
    expect(out.map(s => s.id)).toEqual(['b', 'c', 'd', 'a']);
  });
});

describe('nextIndexAfterRemoval — ending a stream never crashes the pager', () => {
  it('advances to the next stream when the active one ends', () => {
    expect(nextIndexAfterRemoval(1, 1, 4)).toBe(1); // next stream slides into place
  });
  it('steps back when the last page ends', () => {
    expect(nextIndexAfterRemoval(3, 3, 4)).toBe(2);
  });
  it('keeps the viewer on the same stream when one above them ends', () => {
    expect(nextIndexAfterRemoval(2, 0, 4)).toBe(1);
  });
  it('ignores streams below the viewer', () => {
    expect(nextIndexAfterRemoval(1, 3, 4)).toBe(1);
  });
  it('returns 0 when the list becomes empty', () => {
    expect(nextIndexAfterRemoval(0, 0, 1)).toBe(0);
  });
});

describe('initialStreamIndex', () => {
  const list = [stream('a', 1), stream('b', 1), stream('c', 1)];
  it('lands on a deep-linked stream', () => expect(initialStreamIndex(list, { streamId: 'c' })).toBe(2));
  it('lands on a host (ringed avatar tap)', () => expect(initialStreamIndex(list, { hostId: 'host-b' })).toBe(1));
  it('falls back to the top', () => expect(initialStreamIndex(list, { streamId: 'gone', hostId: 'nobody' })).toBe(0));
});

describe('appendChat', () => {
  const m = (id: string): LiveChatMessage => ({ id, username: 'u', text: id, at: 0 });
  it('dedupes by id and caps the buffer', () => {
    let chat: LiveChatMessage[] = [m('1'), m('2')];
    chat = appendChat(chat, [m('2'), m('3')]);
    expect(chat.map(c => c.id)).toEqual(['1', '2', '3']);
    chat = appendChat(chat, Array.from({ length: 60 }, (_, i) => m(`x${i}`)));
    expect(chat).toHaveLength(LIVE_CHAT_BUFFER);
    expect(chat[chat.length - 1].id).toBe('x59');
  });
});

describe('formatting', () => {
  it('formats viewer counts compactly', () => {
    expect(formatViewerCount(987)).toBe('987');
    expect(formatViewerCount(2430)).toBe('2.4K');
    expect(formatViewerCount(123456)).toBe('123K');
    expect(formatViewerCount(1_150_000)).toBe('1.2M');
    expect(formatViewerCount(-4)).toBe('0');
  });
  it('labels upcoming lives relative to today', () => {
    const now = new Date(2026, 8, 26, 12, 0).getTime();
    expect(formatUpcomingTime(new Date(2026, 8, 26, 19, 0).getTime(), now)).toMatch(/^Today /);
    expect(formatUpcomingTime(new Date(2026, 8, 27, 9, 0).getTime(), now)).toMatch(/^Tomorrow /);
    expect(formatUpcomingTime(new Date(2026, 8, 29, 9, 0).getTime(), now)).not.toMatch(/^(Today|Tomorrow)/);
  });
});

describe('live directory (LIVE rings on avatars)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('loads on first subscriber, notifies on change, and drops ended streams', async () => {
    vi.useFakeTimers();
    let entries = [{ hostId: 'h1', streamId: 's1' }];
    const load = vi.fn(async () => entries);
    const dir = createLiveDirectory(load, 1000);
    expect(dir.streamFor('h1')).toBeNull();
    const listener = vi.fn();
    const unsubscribe = dir.subscribe(listener);
    await vi.waitFor(() => expect(dir.streamFor('h1')).toBe('s1'));
    expect(listener).toHaveBeenCalledTimes(1);

    entries = [{ hostId: 'h1', streamId: 's1' }, { hostId: 'h2', streamId: 's2' }];
    await vi.advanceTimersByTimeAsync(1000);
    expect(dir.streamFor('h2')).toBe('s2');

    const v = dir.version();
    dir.markEnded('s1');
    expect(dir.streamFor('h1')).toBeNull();
    expect(dir.version()).toBe(v + 1);

    unsubscribe();
    const calls = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(load.mock.calls.length).toBe(calls); // stops polling with no subscribers
  });

  it('keeps the last known state when loading fails (signed out / offline)', async () => {
    let fail = false;
    const dir = createLiveDirectory(async () => { if (fail) throw new Error('401'); return [{ hostId: 'h', streamId: 's' }]; });
    await dir.refresh();
    fail = true;
    await dir.refresh();
    expect(dir.streamFor('h')).toBe('s');
  });
});

describe('Buy → existing Shop sheet', () => {
  it('preview: opens the sheet on the tapped product with a local preview product', () => {
    const s = stream('a', 1);
    const sel = liveShopSelection(s, 'a-p2', true)!;
    expect(sel.tags).toEqual([{ productId: 'a-p2', productName: 'Dress', priceCents: 32500 }]);
    expect(sel.activeTagIndex).toBe(0);
    expect(sel.previewProduct?.id).toBe('a-p2');
    expect(sel.previewProduct?.variants.length).toBeGreaterThan(1);
    expect(sel.postSellerId).toBe('host-a');
  });
  it('real: passes every product in the stream with the tapped one active', () => {
    const sel = liveShopSelection(stream('a', 1), 'a-p2', false)!;
    expect(sel.tags.map(t => t.productId)).toEqual(['a-p1', 'a-p2']);
    expect(sel.activeTagIndex).toBe(1);
    expect(sel.previewProduct).toBeUndefined();
  });
  it('returns null for an unknown product', () => {
    expect(liveShopSelection(stream('a', 1), 'nope', true)).toBeNull();
  });
});
