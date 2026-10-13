/**
 * Videos the viewer has already watched to the end (polish #147: "don't
 * re-serve finished videos"). Kept on device: the ranked For You on the
 * server already skips recently viewed posts, but the feed's other sources
 * (cached pages, the public list, the never-ending loop) don't, so the feed
 * filters these out of fresh pages and puts them last when it loops.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FINISHED_VIDEOS_KEY = 'bt:feed-finished-videos:v1';
/** Long enough to cover a few days of scrolling, small enough to stay cheap. */
export const FINISHED_VIDEOS_MAX = 400;
export const FINISHED_VIDEOS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type FinishedMap = Record<string, number>;

/** Drops expired entries and keeps the newest `max`. Pure. */
export function pruneFinished(map: FinishedMap, now: number, max = FINISHED_VIDEOS_MAX, ttl = FINISHED_VIDEOS_TTL_MS): FinishedMap {
  return Object.fromEntries(
    Object.entries(map)
      .filter(([, at]) => typeof at === 'number' && now - at < ttl)
      .sort((a, b) => b[1] - a[1])
      .slice(0, max),
  );
}

/**
 * Removes finished posts from a freshly fetched page. If every post on the
 * page was finished, the page is returned as is so the feed never goes
 * blank. Pure.
 */
export function withoutFinished<T extends { id: string }>(items: T[], finished: ReadonlySet<string>): T[] {
  if (finished.size === 0) return items;
  const fresh = items.filter((item) => !finished.has(item.id));
  return fresh.length > 0 ? fresh : items;
}

/** True once playback has reached the end, or wrapped around from it. */
export function reachedEnd(prevTime: number, currentTime: number, duration: number): boolean {
  if (!(duration > 1)) return false;
  if (currentTime >= duration - 0.35) return true;
  return prevTime >= duration * 0.8 && currentTime < duration * 0.2;
}

let memory: FinishedMap | null = null;
let loading: Promise<FinishedMap> | null = null;

export function loadFinishedVideos(): Promise<FinishedMap> {
  if (memory) return Promise.resolve(memory);
  if (!loading) {
    loading = AsyncStorage.getItem(FINISHED_VIDEOS_KEY)
      .then((raw) => {
        const parsed = raw ? (JSON.parse(raw) as FinishedMap) : {};
        memory = pruneFinished(parsed && typeof parsed === 'object' ? parsed : {}, Date.now());
        return memory;
      })
      .catch(() => (memory = {}));
  }
  return loading;
}

/** Synchronous snapshot for filtering; empty until the first load resolves. */
export function finishedVideoIds(): Set<string> {
  return new Set(Object.keys(memory ?? {}));
}

export function markVideoFinished(id: string): void {
  void loadFinishedVideos().then((map) => {
    if (map[id]) return;
    memory = pruneFinished({ ...map, [id]: Date.now() }, Date.now());
    void AsyncStorage.setItem(FINISHED_VIDEOS_KEY, JSON.stringify(memory)).catch(() => {});
  });
}
