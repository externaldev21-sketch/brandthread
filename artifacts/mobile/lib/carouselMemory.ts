/**
 * Remembers which slide of a photo carousel the viewer was on, per post, for
 * the life of the app session — so swiping away from a slideshow and coming
 * back (or reopening it from a profile) lands on the same slide.
 * Feed loop copies (`<id>__loop2`) share their original's memory, and mounted
 * carousels subscribe so a retained feed follows the viewer's latest index.
 */
const MAX_ENTRIES = 300;
const slideByPost = new Map<string, number>();
const subscribers = new Map<string, Set<(index: number) => void>>();

export function carouselKey(postId: string): string {
  return postId.replace(/__loop\d+$/, '');
}

export function rememberedSlide(postId: string, slideCount: number): number {
  const index = slideByPost.get(carouselKey(postId)) ?? 0;
  return Math.max(0, Math.min(Math.max(0, slideCount - 1), index));
}

export function rememberSlide(postId: string, index: number): void {
  const key = carouselKey(postId);
  const next = Math.max(0, Math.floor(index));
  const prev = slideByPost.get(key);
  slideByPost.delete(key);
  slideByPost.set(key, next);
  if (slideByPost.size > MAX_ENTRIES) {
    const oldest = slideByPost.keys().next().value;
    if (oldest !== undefined) slideByPost.delete(oldest);
  }
  if (prev === next) return; // no duplicate emissions
  subscribers.get(key)?.forEach((fn) => fn(next));
}

/** Listen for index changes of the canonical post (loop copies share it). */
export function subscribeSlide(postId: string, fn: (index: number) => void): () => void {
  const key = carouselKey(postId);
  let set = subscribers.get(key);
  if (!set) { set = new Set(); subscribers.set(key, set); }
  set.add(fn);
  return () => {
    const s = subscribers.get(key);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) subscribers.delete(key);
  };
}

/** Test hook. */
export function clearCarouselMemory(): void {
  slideByPost.clear();
  subscribers.clear();
}
