import { describe, expect, it, vi } from 'vitest';
import {
  PRELOAD_AHEAD,
  VideoPreloadManager,
  detectDataSaver,
  isHlsUri,
  pickPlaybackUri,
  planVideoPreload,
  remoteVideoUri,
  shouldRevealVideo,
  withVideoCaching,
  type PreloadCandidate,
} from '@/lib/videoPreload';

const video = (n: number): PreloadCandidate => ({ kind: 'video', uri: `https://cdn.test/v${n}.mp4` });
const photo: PreloadCandidate = { kind: 'other', uri: null };

describe('planVideoPreload', () => {
  const items = [video(0), video(1), video(2), video(3), video(4)];

  it('warms the pages after the ones the list already mounts (current+2)', () => {
    expect(planVideoPreload(items, 0, { ahead: 2 })).toEqual(['https://cdn.test/v2.mp4']);
    expect(planVideoPreload(items, 1, { ahead: 2 })).toEqual(['https://cdn.test/v3.mp4']);
  });

  it('warms current+1 and current+2 when nothing is mounted ahead', () => {
    expect(planVideoPreload(items, 0, { ahead: 2, mountedAhead: 0 })).toEqual(['https://cdn.test/v1.mp4', 'https://cdn.test/v2.mp4']);
  });

  it('never goes past current+2 and handles the end of the list', () => {
    expect(planVideoPreload(items, 4)).toEqual([]);
    expect(planVideoPreload(items, 3, { mountedAhead: 0 })).toEqual(['https://cdn.test/v4.mp4']);
  });

  it('skips photos, local files and duplicates', () => {
    const mixed: PreloadCandidate[] = [video(0), video(1), photo, video(3)];
    expect(planVideoPreload(mixed, 0, { mountedAhead: 0 })).toEqual(['https://cdn.test/v1.mp4']);
    expect(planVideoPreload([video(0), video(1), { kind: 'video', uri: 'file:///x.mp4' }], 0)).toEqual([]);
    expect(planVideoPreload([video(0), video(1), video(1), video(1)], 0, { mountedAhead: 0 })).toEqual(['https://cdn.test/v1.mp4']);
  });

  it('returns nothing for an invalid active index', () => {
    expect(planVideoPreload(items, -1)).toEqual([]);
    expect(planVideoPreload(items, Number.NaN)).toEqual([]);
  });
});

describe('withVideoCaching', () => {
  it('adds useCaching to remote uris on native and keeps the reference stable', () => {
    const a = withVideoCaching('https://cdn.test/a.mp4', true);
    expect(a).toEqual({ uri: 'https://cdn.test/a.mp4', useCaching: true });
    expect(withVideoCaching('https://cdn.test/a.mp4', true)).toBe(a);
  });

  it('keeps headers and other fields of object sources', () => {
    expect(withVideoCaching({ uri: 'https://cdn.test/b.mp4', headers: { a: '1' } }, true)).toEqual({
      uri: 'https://cdn.test/b.mp4', headers: { a: '1' }, useCaching: true,
    });
  });

  it('leaves web, local files, bundled assets and explicit choices alone', () => {
    expect(withVideoCaching('https://cdn.test/a.mp4', false)).toBe('https://cdn.test/a.mp4');
    expect(withVideoCaching('file:///a.mp4', true)).toBe('file:///a.mp4');
    expect(withVideoCaching(12 as never, true)).toBe(12);
    const explicit = { uri: 'https://cdn.test/c.mp4', useCaching: false };
    expect(withVideoCaching(explicit, true)).toBe(explicit);
  });

  it('remoteVideoUri only accepts http(s)', () => {
    expect(remoteVideoUri('https://x/y.mp4')).toBe('https://x/y.mp4');
    expect(remoteVideoUri({ uri: 'http://x/y.mp4' })).toBe('http://x/y.mp4');
    expect(remoteVideoUri('file:///y.mp4')).toBeNull();
    expect(remoteVideoUri(undefined)).toBeNull();
  });
});

describe('VideoPreloadManager', () => {
  const make = (extra: { isDataSaver?: () => boolean; maxWarm?: number } = {}) => {
    const released: string[] = [];
    const createWarmPlayer = vi.fn((uri: string) => ({ release: () => { released.push(uri); } }));
    return { manager: new VideoPreloadManager({ createWarmPlayer, ...extra }), released, createWarmPlayer };
  };

  it('keeps at most maxWarm players and never recreates a warm one', () => {
    const { manager, createWarmPlayer } = make();
    manager.update(['a', 'b', 'c']);
    expect(manager.warmUris).toEqual(['a', 'b']);
    manager.update(['a', 'b']);
    expect(createWarmPlayer).toHaveBeenCalledTimes(2);
  });

  it('releases players that leave the window as the user scrolls', () => {
    const { manager, released } = make();
    manager.update(['a', 'b']);
    manager.update(['b', 'c']);
    expect(released).toEqual(['a']);
    expect(manager.warmUris.sort()).toEqual(['b', 'c']);
  });

  it('cancel releases everything (background, leaving the feed, sign-out)', () => {
    const { manager, released } = make();
    manager.update(['a', 'b']);
    manager.cancel();
    expect(released.sort()).toEqual(['a', 'b']);
    expect(manager.warmUris).toEqual([]);
  });

  it('does not preload while data saver is on and drops what is warm', () => {
    let saver = false;
    const { manager, released, createWarmPlayer } = make({ isDataSaver: () => saver });
    manager.update(['a']);
    saver = true;
    expect(manager.update(['a', 'b'])).toEqual([]);
    expect(released).toEqual(['a']);
    expect(createWarmPlayer).toHaveBeenCalledTimes(1);
  });

  it('survives a player that fails to create or release', () => {
    const createWarmPlayer = vi.fn((uri: string) => {
      if (uri === 'bad') throw new Error('native');
      return { release: () => { throw new Error('gone'); } };
    });
    const manager = new VideoPreloadManager({ createWarmPlayer });
    expect(() => manager.update(['bad', 'ok'])).not.toThrow();
    expect(manager.warmUris).toEqual(['ok']);
    expect(() => manager.cancel()).not.toThrow();
  });
});

describe('detectDataSaver', () => {
  it('reads the Network Information API when present', () => {
    expect(detectDataSaver({ connection: { saveData: true } })).toBe(true);
    expect(detectDataSaver({ connection: { effectiveType: '2g' } })).toBe(true);
    expect(detectDataSaver({ connection: { saveData: false, effectiveType: '4g' } })).toBe(false);
  });

  it('is false where the platform exposes nothing (React Native)', () => {
    expect(detectDataSaver({})).toBe(false);
    expect(detectDataSaver(undefined)).toBe(false);
  });
});

describe('HLS playback selection', () => {
  it('prefers an https HLS playlist and falls back to the MP4', () => {
    expect(pickPlaybackUri('https://stream.mux.com/abc123def456.m3u8', 'https://x/v.mp4', true)).toBe('https://stream.mux.com/abc123def456.m3u8');
    expect(pickPlaybackUri(undefined, 'https://x/v.mp4', true)).toBe('https://x/v.mp4');
    expect(pickPlaybackUri(null, 'https://x/v.mp4', true)).toBe('https://x/v.mp4');
    expect(pickPlaybackUri('http://stream.mux.com/a.m3u8', 'https://x/v.mp4', true)).toBe('https://x/v.mp4');
    expect(pickPlaybackUri('https://x/not-a-playlist.mp4', 'https://x/v.mp4', true)).toBe('https://x/v.mp4');
  });

  it('keeps the MP4 on web, where Chrome cannot play HLS in <video>', () => {
    expect(pickPlaybackUri('https://stream.mux.com/abc123def456.m3u8', 'https://x/v.mp4', false)).toBe('https://x/v.mp4');
  });

  it('never adds disk caching to HLS sources', () => {
    expect(isHlsUri('https://stream.mux.com/a.m3u8?token=1')).toBe(true);
    expect(withVideoCaching('https://stream.mux.com/a.m3u8', true)).toBe('https://stream.mux.com/a.m3u8');
  });
});

describe('feed preload budget', () => {
  it('keeps at most previous/current/next players by default (no extra warm players)', () => {
    const items = [video(0), video(1), video(2), video(3)];
    expect(PRELOAD_AHEAD).toBe(1);
    expect(planVideoPreload(items, 0)).toEqual([]);
    expect(planVideoPreload(items, 1)).toEqual([]);
  });
});

describe('shouldRevealVideo', () => {
  const base = { hasStarted: true, readyToPlay: true, firstFrameRendered: false, firstFrameTimedOut: false };
  it('keeps the poster until a frame has been painted', () => {
    expect(shouldRevealVideo(base)).toBe(false);
    expect(shouldRevealVideo({ ...base, firstFrameRendered: true })).toBe(true);
  });
  it('needs playback started and ready even if a frame rendered (preloaded next page)', () => {
    expect(shouldRevealVideo({ ...base, hasStarted: false, firstFrameRendered: true })).toBe(false);
    expect(shouldRevealVideo({ ...base, readyToPlay: false, firstFrameRendered: true })).toBe(false);
  });
  it('reveals after the fallback timeout when the platform never reports a first frame', () => {
    expect(shouldRevealVideo({ ...base, firstFrameTimedOut: true })).toBe(true);
  });
});
