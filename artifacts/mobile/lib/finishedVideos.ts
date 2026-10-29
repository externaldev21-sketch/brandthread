/**
 * Videos the viewer has already watched to the end. Kept on device and used
 * to ORDER the Threads feed, never to filter it: unseen posts first, then
 * the ones already watched, each group in its ranked order. With a small
 * catalogue (~12 posts) hiding finished videos made the feed empty out
 * ("my videos are disappearing"), so finished posts always stay in the feed
 * and the feed never runs dry, TikTok-style. The server's For You ranking
 * does the same (api-server lib/ranking/forYou.ts `rankUnseenFirst`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const FINISHED_VIDEOS_KEY = 'bt:feed-finished-videos:v1';
/** Long enough to cover a few days of scrolling, small enough to stay cheap. */
export const FINISHED_VIDEOS_MAX = 400;
/** How long a finished video counts as "seen" for ordering. It is never hidden. */
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

/** Feed ids of a looped repeat carry a `__loopN` suffix; seen-tracking uses the real post id. */
export function basePostId(id: string): string {
  return id.replace(/__loop\d+$/, '');
}

/**
 * Unseen posts first, then finished ones, each group keeping its incoming
 * (ranked) order. Every post is kept — nothing is ever dropped. Pure.
 */
export function unseenFirst<T extends { id: string }>(items: T[], finished: ReadonlySet<string>): T[] {
  if (finished.size === 0) return items;
  const unseen: T[] = [];
  const seen: T[] = [];
  for (const item of items) (finished.has(basePostId(item.id)) ? seen : unseen).push(item);
  return seen.length === 0 ? items : [...unseen, ...seen];
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

/** Synchronous snapshot for ordering; empty until the first load resolves. */
export function finishedVideoIds(): Set<string> {
  return new Set(Object.keys(memory ?? {}));
}

export function markVideoFinished(id: string): void {
  const postId = basePostId(id);
  void loadFinishedVideos().then((loaded) => {
    // Marks made while the first load was pending all resolve with the same
    // loaded map; build on the latest one so none of them is lost.
    const map = memory ?? loaded;
    if (map[postId]) return;
    memory = pruneFinished({ ...map, [postId]: Date.now() }, Date.now());
    void AsyncStorage.setItem(FINISHED_VIDEOS_KEY, JSON.stringify(memory)).catch(() => {});
  });
}
