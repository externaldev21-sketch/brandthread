/**
 * Video preload + on-disk caching for the For You feed.
 *
 * The feed already mounts a real player for the page before and after the
 * active one (`preload` on VideoVisual, see lib/feedPager.ts). This module
 * adds the two things that were missing:
 *
 *  1. `withVideoCaching` turns a remote source into an expo-video source with
 *     `useCaching: true`, so whatever a player downloads lands in expo-video's
 *     LRU disk cache (native only; web ignores it) and a second view, a
 *     replay or a swipe back is served from disk.
 *  2. `VideoPreloadManager` bounds cancellable network handles (never native
 *     decoders) for upcoming videos, looking across photo posts. It releases
 *     handles that leave the window and releases everything when the
 *     user leaves the feed, backgrounds the app, or goes offline-saver.
 *
 * Everything here is pure / injectable so it can be unit tested without the
 * native module. The React glue lives in hooks/useFeedVideoPreload.ts.
 */
import type { VideoSource } from 'expo-video';

/**
 * How many pages ahead of the active one should be warm (mounted + managed).
 * Two upcoming videos, even when separated by photos. Immediate page
 * neighbours already have mounted players; only the remaining candidates
 * need extra warm handles. At most four video decoders are needed in total.
 */
export const PRELOAD_AHEAD = 2;
/** Hard ceiling on extra warm players the manager will ever hold. */
export const MAX_WARM_PLAYERS = 3;
/** Pages ahead that the feed list itself already mounts a player for. */
export const MOUNTED_AHEAD = 1;
/** Disk cache budget for feed videos. expo-video's default is 1 GB. */
export const VIDEO_CACHE_BYTES = 512 * 1024 * 1024;

export function remoteVideoUri(source: VideoSource | null | undefined): string | null {
  const uri = typeof source === 'string' ? source : source && typeof source === 'object' && 'uri' in source ? source.uri : null;
  return typeof uri === 'string' && /^https?:\/\//i.test(uri) ? uri : null;
}

export function isHlsUri(uri: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(uri);
}

/**
 * The uri a feed video should play: the adaptive HLS stream when the server
 * has one (https only) on iOS/Android, otherwise the original MP4. Web keeps
 * the MP4: only Safari plays HLS in a plain <video> element.
 */
export function preferLowFeedRendition(connection?: { saveData?: boolean; effectiveType?: string; downlink?: number }): boolean {
  return !!connection?.saveData || /^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? '')
    || (typeof connection?.downlink === 'number' && connection.downlink > 0 && connection.downlink < 2);
}

export function pickPlaybackUri(hlsUrl: string | null | undefined, mp4Uri: string, native: boolean): string {
  // Native AVPlayer/ExoPlayer adapts between 480/720 from the HLS master.
  if (native && typeof hlsUrl === 'string' && /^https:\/\//i.test(hlsUrl) && isHlsUri(hlsUrl)) return hlsUrl;
  const connection = (globalThis as { navigator?: { connection?: { saveData?: boolean; effectiveType?: string; downlink?: number } } }).navigator?.connection;
  if (!native && preferLowFeedRendition(connection) &&
    /\/uploads\/feed-stream\/[a-f0-9]{64}\/720\.mp4(?:$|[?#])/.test(mp4Uri)) {
    return mp4Uri.replace('/720.mp4', '/480.mp4');
  }
  return mp4Uri;
}

/**
 * Whether the feed video should replace its poster. Only after playback
 * started, the player is ready, and a frame has really been painted.
 * The old timeout field is accepted for compatibility, but never reveals
 * an unpainted video.
 */
export function shouldRevealVideo(state: {
  hasStarted: boolean;
  readyToPlay: boolean;
  firstFrameRendered: boolean;
  firstFrameTimedOut: boolean;
}): boolean {
  return state.hasStarted && state.readyToPlay && state.firstFrameRendered;
}

const cachedSources = new Map<string, VideoSource>();
const CACHED_SOURCE_LIMIT = 200;

/**
 * Same source with `useCaching: true`. Returns the identical reference for the
 * same uri (expo-video keys its player on the serialized source, so a new
 * object per render would be harmless, but a stable one avoids churn).
 * Non-remote sources and non-native platforms are returned unchanged.
 */
export function withVideoCaching(source: VideoSource, native: boolean): VideoSource {
  if (!native) return source;
  const uri = remoteVideoUri(source);
  // expo-video's disk cache only covers progressive files, not HLS playlists.
  if (!uri || isHlsUri(uri)) return source;
  if (typeof source === 'object' && source && 'useCaching' in source && source.useCaching != null) return source;
  const existing = cachedSources.get(uri);
  if (existing) return existing;
  const next: VideoSource = typeof source === 'string' ? { uri, useCaching: true } : { ...(source as object), uri, useCaching: true };
  if (cachedSources.size >= CACHED_SOURCE_LIMIT) cachedSources.clear();
  cachedSources.set(uri, next);
  return next;
}

export type PreloadCandidate = { kind: 'video' | 'other'; uri: string | null; posterUri?: string | null };

/**
 * The remote video uris to hold warm beyond the pages the list already mounts:
 * pages activeIndex+mountedAhead+1 .. activeIndex+ahead. Non-video pages and
 * duplicate uris are skipped. Never includes the active page itself.
 */
export function planVideoPreload(
  items: readonly PreloadCandidate[],
  activeIndex: number,
  { ahead = PRELOAD_AHEAD, mountedAhead = MOUNTED_AHEAD }: { ahead?: number; mountedAhead?: number } = {},
): string[] {
  if (!Number.isInteger(activeIndex) || activeIndex < 0) return [];
  const out: string[] = [];
  if (activeIndex >= items.length) return [];
  let found = 0;
  for (let i = activeIndex + 1; i < items.length && found < ahead; i++) {
    const item = items[i];
    if (!item || item.kind !== 'video' || !item.uri || !/^https?:\/\//i.test(item.uri)) continue;
    found++;
    if (i <= activeIndex + mountedAhead) continue;
    if (!out.includes(item.uri)) out.push(item.uri);
  }
  // Photos between videos must not prevent warming the previous video.
  for (let i = activeIndex - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== 'video' || !item.uri || !/^https?:\/\//i.test(item.uri)) continue;
    if (i < activeIndex - mountedAhead && !out.includes(item.uri)) out.push(item.uri);
    break;
  }
  return out;
}

/** Low startup latency, with a short forward buffer instead of waiting for a
 * large buffer before iOS starts. Used by both mounted and warm players. */
export const FEED_VIDEO_BUFFER_OPTIONS = {
  preferredForwardBufferDuration: 3,
  waitsToMinimizeStalling: false,
  minBufferForPlayback: 0.1,
};

/**
 * Best-effort "user asked the OS to save data". Only the web Network
 * Information API exposes this; React Native has no public equivalent without
 * a native module, so on iOS/Android this returns false (see
 * docs/performance/launch-and-media.md).
 */
export function detectDataSaver(nav: unknown = typeof navigator !== 'undefined' ? navigator : undefined): boolean {
  const connection = (nav as { connection?: { saveData?: boolean; effectiveType?: string } } | undefined)?.connection;
  if (!connection) return false;
  return connection.saveData === true || connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g';
}

export type WarmHandle = { release: () => void };

/** Fetch bytes, NOT a VideoPlayer/decoder. HLS warms the first low-bitrate
 * segment; MP4 warms a bounded prefix. This warms transport/CDN caches, not
 * a claim that JS fetch populates AVPlayer's private media cache. */
export async function preloadVideoBytes(uri: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<void> {
  const get = async (url: string, range = false) => {
    const response = await fetcher(url, { signal, ...(range ? { headers: { Range: 'bytes=0-196607' } } : {}) });
    if (!response.ok || (range && response.status !== 206)) {
      await response.body?.cancel();
      throw new Error(`Preload HTTP ${response.status}`);
    }
    return response;
  };
  if (!isHlsUri(uri)) { await (await get(uri, true)).arrayBuffer(); return; }
  let playlist = uri;
  for (let depth = 0; depth < 3; depth++) {
    const text = await (await get(playlist)).text();
    if (text.length > 256 * 1024) throw new Error('Oversized HLS playlist');
    const child = text.split(/\r?\n/).map(s => s.trim()).find(s => s && !s.startsWith('#'));
    if (!child) return;
    const url = new URL(child, playlist).toString();
    if (!/^https?:\/\//i.test(url)) throw new Error('Invalid HLS child URL');
    if (!isHlsUri(url)) { await (await get(url)).arrayBuffer(); return; }
    playlist = url;
  }
}

export type VideoPreloadDeps = {
  createWarmPlayer: (uri: string) => WarmHandle;
  isDataSaver?: () => boolean;
  maxWarm?: number;
};

export class VideoPreloadManager {
  private readonly warm = new Map<string, WarmHandle>();
  private readonly maxWarm: number;

  constructor(private readonly deps: VideoPreloadDeps) {
    this.maxWarm = deps.maxWarm ?? MAX_WARM_PLAYERS;
  }

  get warmUris(): string[] {
    return [...this.warm.keys()];
  }

  /** Reconcile warm players with the wanted uris. Returns the warm set. */
  update(wanted: readonly string[]): string[] {
    if (this.deps.isDataSaver?.()) {
      this.cancel();
      return [];
    }
    const target = wanted.slice(0, this.maxWarm);
    for (const uri of [...this.warm.keys()]) {
      if (!target.includes(uri)) this.releaseOne(uri);
    }
    for (const uri of target) {
      if (this.warm.has(uri)) continue;
      try {
        this.warm.set(uri, this.deps.createWarmPlayer(uri));
      } catch {
        // A failed warm-up is invisible: the real player loads it on demand.
      }
    }
    return this.warmUris;
  }

  /** Release every warm player (scroll away, background, sign-out, unmount). */
  cancel(): void {
    for (const uri of [...this.warm.keys()]) this.releaseOne(uri);
  }

  private releaseOne(uri: string): void {
    const handle = this.warm.get(uri);
    this.warm.delete(uri);
    try {
      handle?.release();
    } catch {
      // Already released by the native side.
    }
  }
}
