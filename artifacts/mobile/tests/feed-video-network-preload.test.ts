import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { preloadVideoBytes, planVideoPreload, preferLowFeedRendition } from '../lib/videoPreload';
import { isFeedMediaWrite } from '../lib/feedVideoPublish';

describe('decoder-free feed preloads', () => {
  it('gives video publication time to encode without extending unrelated requests', () => {
    expect(isFeedMediaWrite('/posts', { mediaType: 'video', mediaPath: '/objects/uploads/clip' })).toBe(true);
    expect(isFeedMediaWrite('/posts/id', { slides: [{ kind: 'video' }] })).toBe(true);
    expect(isFeedMediaWrite('/posts/id', { caption: 'updated' })).toBe(false);
    expect(isFeedMediaWrite('/settings', { mediaType: 'video' })).toBe(false);
  });
  it('prefers low-bandwidth delivery on constrained connections and data saver', () => {
    expect(preferLowFeedRendition({ effectiveType: '3g' })).toBe(true);
    expect(preferLowFeedRendition({ effectiveType: '4g', downlink: 1 })).toBe(true);
    expect(preferLowFeedRendition({ saveData: true })).toBe(true);
    expect(preferLowFeedRendition({ effectiveType: '4g', downlink: 10 })).toBe(false);
    expect(preferLowFeedRendition()).toBe(false);
  });
  it('fetches the first low-bitrate HLS segment through relative master/variant URLs', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n480/index.m3u8\n'))
      .mockResolvedValueOnce(new Response('#EXTM3U\n#EXTINF:2,\nsegment00000.ts\n'))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const signal = new AbortController().signal;
    await preloadVideoBytes('https://media.test/x/master.m3u8', signal, fetcher);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://media.test/x/master.m3u8', 'https://media.test/x/480/index.m3u8',
      'https://media.test/x/480/segment00000.ts',
    ]);
    expect(fetcher.mock.calls.every(call => call[1].signal === signal)).toBe(true);
  });
  it('bounds progressive reads and refuses a server ignoring Range', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('bytes', { status: 206 }));
    await preloadVideoBytes('https://media.test/720.mp4', new AbortController().signal, fetcher);
    expect(fetcher.mock.calls[0][1].headers.Range).toBe('bytes=0-196607');
    await expect(preloadVideoBytes('https://media.test/720.mp4', new AbortController().signal,
      vi.fn().mockResolvedValue(new Response('full file', { status: 200 })))).rejects.toThrow('Preload HTTP 200');
  });
  it('plans the next two videos even across photos, including the mounted neighbour', () => {
    expect(planVideoPreload([
      { kind: 'video', uri: 'https://media.test/current.mp4' }, { kind: 'video', uri: 'https://media.test/next.mp4' },
      { kind: 'other', uri: null }, { kind: 'video', uri: 'https://media.test/next-two.mp4' },
    ], 0, { mountedAhead: 0 })).toEqual(['https://media.test/next.mp4', 'https://media.test/next-two.mp4']);
  });
  it('never allocates preload decoders or hides the decoding surface behind opacity zero', () => {
    const hook = readFileSync(new URL('../hooks/useFeedVideoPreload.ts', import.meta.url), 'utf8');
    const feed = readFileSync(new URL('../app/(tabs)/feed.tsx', import.meta.url), 'utf8');
    expect(hook).not.toContain('createVideoPlayer');
    expect(hook).toContain('preloadVideoBytes');
    expect(feed).toContain('preload={screenFocused && !showNotifs');
    expect(feed).not.toContain('(showPoster || showFallbackCover) && { opacity: 0 }');
    expect(feed).toContain('recordFeedVideoError');
  });
});
