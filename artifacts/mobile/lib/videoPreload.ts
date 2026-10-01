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
 *  2. `VideoPreloadManager` keeps at most `maxWarm` extra, paused, muted
 *     players buffering the pages just beyond the ones that are already
 *     mounted (so current, current+1 and current+2 are all warm). It releases
 *     any player whose page leaves the window and releases everything when the
 *     user leaves the feed, backgrounds the app, goes offline-saver, or signs out.
 *
 * Everything here is pure / injectable so it can be unit tested without the
 * native module. The React glue lives in hooks/useFeedVideoPreload.ts.
 */
import type { VideoSource } from 'expo-video';

/** How many pages ahead of the active one should be warm (mounted + managed). */
export const PRELOAD_AHEAD = 2;
/** Pages ahead that the feed list itself already mounts a player for. */
export const MOUNTED_AHEAD = 1;
/** Disk cache budget for feed videos. expo-video's default is 1 GB. */
export const VIDEO_CACHE_BYTES = 512 * 1024 * 1024;

export function remoteVideoUri(source: VideoSource | null | undefined): string | null {
  const uri = typeof source === 'string' ? source : source && typeof source === 'object' && 'uri' in source ? source.uri : null;
  return typeof uri === 'string' && /^https?:\/\//i.test(uri) ? uri : null;
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
  if (!uri) return source;
  if (typeof source === 'object' && source && 'useCaching' in source && source.useCaching != null) return source;
  const existing = cachedSources.get(uri);
  if (existing) return existing;
  const next: VideoSource = typeof source === 'string' ? { uri, useCaching: true } : { ...(source as object), uri, useCaching: true };
  if (cachedSources.size >= CACHED_SOURCE_LIMIT) cachedSources.clear();
  cachedSources.set(uri, next);
  return next;
}

export type PreloadCandidate = { kind: 'video' | 'other'; uri: string | null };

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
  for (let i = activeIndex + mountedAhead + 1; i <= activeIndex + ahead; i++) {
    const item = items[i];
    if (!item || item.kind !== 'video' || !item.uri || !/^https?:\/\//i.test(item.uri)) continue;
    if (!out.includes(item.uri)) out.push(item.uri);
  }
  return out;
}

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

export type VideoPreloadDeps = {
  createWarmPlayer: (uri: string) => WarmHandle;
  isDataSaver?: () => boolean;
  maxWarm?: number;
};

export class VideoPreloadManager {
  private readonly warm = new Map<string, WarmHandle>();
  private readonly maxWarm: number;

  constructor(private readonly deps: VideoPreloadDeps) {
    this.maxWarm = deps.maxWarm ?? PRELOAD_AHEAD;
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
