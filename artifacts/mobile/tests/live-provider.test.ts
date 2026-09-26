/**
 * LiveStreamProvider contract + the local PREVIEW implementation that powers
 * `?bt_preview=buyer` (bundled runway clips as "streams", ticking viewers,
 * scripted chat, rotating pinned product, one stream that ends itself).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPreviewLiveProvider, type PreviewLiveMedia } from '../lib/live/previewLiveProvider';
import { PREVIEW_LIVE_STREAMS, PREVIEW_UPCOMING_LIVES, tickViewerCount, seededRandom } from '../lib/live/previewLiveData';
import type { LiveEvent, LiveStreamProvider } from '../lib/live/types';

const media: PreviewLiveMedia = {
  video: (i) => ({ kind: 'video', source: `clip-${i}.mp4`, posterUri: `poster-${i}.png` }),
  product: (i) => ({ productId: `preview-product-${String(i + 1).padStart(2, '0')}`, name: `Product ${i}`, priceCents: 10000 + i }),
};

describe('preview live provider', () => {
  let provider: LiveStreamProvider;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
    provider = createPreviewLiveProvider({ media, seed: 3 });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('implements every LiveStreamProvider method', () => {
    const methods: Array<keyof LiveStreamProvider> = [
      'listLive', 'listUpcoming', 'listSuggestedCreators', 'join', 'leave', 'subscribe',
      'sendChat', 'sendLike', 'setReminder', 'setFollowing', 'start', 'stop',
    ];
    for (const m of methods) expect(typeof provider[m]).toBe('function');
    expect(provider.id).toBe('preview');
  });

  it('seeds 5-6 live streams that loop bundled runway clips with catalog products', async () => {
    const live = await provider.listLive();
    expect(live.length).toBeGreaterThanOrEqual(5);
    expect(live.length).toBeLessThanOrEqual(6);
    for (const s of live) {
      expect(s.video.kind).toBe('video');
      expect(s.host.id).toMatch(/^preview-seller-\d\d$/);
      expect(s.products.length).toBeGreaterThan(0);
      expect(s.pinnedProductId).toBe(s.products[0].productId);
      for (const p of s.products) expect(p.productId).toMatch(/^preview-product-\d\d$/);
    }
  });

  it('orders followed creators first, then by viewer count', async () => {
    const live = await provider.listLive();
    const firstUnfollowed = live.findIndex(s => !s.followedByViewer);
    expect(live.slice(0, firstUnfollowed).every(s => s.followedByViewer)).toBe(true);
    const rest = live.slice(firstUnfollowed);
    expect(rest.map(s => s.viewerCount)).toEqual([...rest.map(s => s.viewerCount)].sort((a, b) => b - a));
  });

  it('re-orders when the viewer follows someone', async () => {
    const before = await provider.listLive();
    const last = before[before.length - 1];
    await provider.setFollowing(last.host.id, true);
    const after = await provider.listLive();
    expect(after.findIndex(s => s.id === last.id)).toBeLessThan(before.length - 1);
    expect(after.find(s => s.id === last.id)!.followedByViewer).toBe(true);
  });

  it('ticks viewer counts, plays scripted chat and rotates the pinned product while subscribed', async () => {
    const [stream] = await provider.listLive();
    const events: LiveEvent[] = [];
    const unsubscribe = provider.subscribe(stream.id, e => events.push(e));
    vi.advanceTimersByTime(25_000);
    expect(events.some(e => e.type === 'viewers')).toBe(true);
    expect(events.some(e => e.type === 'likes')).toBe(true);
    const chat = events.filter(e => e.type === 'chat');
    expect(chat.length).toBeGreaterThan(5);
    expect(events.some(e => e.type === 'pinned')).toBe(true);
    unsubscribe();
    const count = events.length;
    vi.advanceTimersByTime(10_000);
    expect(events.length).toBe(count); // no ticking once unsubscribed
  });

  it('join returns recent chat so the overlay is never empty', async () => {
    const [stream] = await provider.listLive();
    const res = await provider.join(stream.id);
    expect(res.ok).toBe(true);
    expect(res.recentChat.length).toBeGreaterThan(0);
  });

  it('ends the scripted stream: emits "ended" and drops it from listLive', async () => {
    const ending = PREVIEW_LIVE_STREAMS.find(s => s.endsAfterMs != null)!;
    const events: LiveEvent[] = [];
    provider.subscribe(ending.id, e => events.push(e));
    expect((await provider.listLive()).some(s => s.id === ending.id)).toBe(true);
    vi.advanceTimersByTime(ending.endsAfterMs! + 10);
    expect(events.filter(e => e.type === 'ended')).toHaveLength(1);
    expect((await provider.listLive()).some(s => s.id === ending.id)).toBe(false);
    expect((await provider.join(ending.id)).ok).toBe(false);
  });

  it('stop() ends a stream immediately', async () => {
    const [stream] = await provider.listLive();
    const events: LiveEvent[] = [];
    provider.subscribe(stream.id, e => events.push(e));
    await provider.stop(stream.id);
    expect(events.some(e => e.type === 'ended')).toBe(true);
    expect((await provider.listLive()).some(s => s.id === stream.id)).toBe(false);
  });

  it('sendChat echoes the message and the host replies', async () => {
    const [stream] = await provider.listLive();
    const events: LiveEvent[] = [];
    provider.subscribe(stream.id, e => events.push(e));
    const msg = await provider.sendChat(stream.id, '  love this  ');
    expect(msg.text).toBe('love this');
    vi.advanceTimersByTime(2500);
    const hostReplies = events.flatMap(e => e.type === 'chat' ? e.messages : []).filter(m => m.kind === 'host' && m.text.includes('@you'));
    expect(hostReplies.length).toBeGreaterThan(0);
    await expect(provider.sendChat(stream.id, '   ')).rejects.toThrow();
  });

  it('upcoming lives and reminders', async () => {
    const upcoming = await provider.listUpcoming();
    expect(upcoming).toHaveLength(PREVIEW_UPCOMING_LIVES.length);
    expect(upcoming.every(u => u.startsAt > Date.now() && !u.reminderSet)).toBe(true);
    await provider.setReminder(upcoming[0].id, true);
    expect((await provider.listUpcoming())[0].reminderSet).toBe(true);
  });

  it('forceEmpty renders the empty state data (no lives, but upcoming + suggested)', async () => {
    const empty = createPreviewLiveProvider({ media, forceEmpty: true });
    expect(await empty.listLive()).toEqual([]);
    expect((await empty.listUpcoming()).length).toBeGreaterThan(0);
    expect((await empty.listSuggestedCreators()).length).toBeGreaterThan(0);
  });
});

describe('tickViewerCount', () => {
  it('drifts both ways but never collapses below 40% of the seed', () => {
    const rand = seededRandom(1);
    let v = 1000;
    let sawUp = false;
    let sawDown = false;
    for (let i = 0; i < 500; i++) {
      const next = tickViewerCount(v, 1000, rand);
      if (next > v) sawUp = true;
      if (next < v) sawDown = true;
      v = next;
      expect(v).toBeGreaterThanOrEqual(400);
    }
    expect(sawUp && sawDown).toBe(true);
  });
});
