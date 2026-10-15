/**
 * Remembers which slide of a photo carousel the viewer was on, per post, for
 * the life of the app session — so swiping away from a slideshow and coming
 * back (or reopening it from a profile) lands on the same slide.
 * Feed loop copies (`<id>__loop2`) share their original's memory.
 */
const MAX_ENTRIES = 300;
const slideByPost = new Map<string, number>();

export function carouselKey(postId: string): string {
  return postId.replace(/__loop\d+$/, '');
}

export function rememberedSlide(postId: string, slideCount: number): number {
  const index = slideByPost.get(carouselKey(postId)) ?? 0;
  return Math.max(0, Math.min(Math.max(0, slideCount - 1), index));
}

export function rememberSlide(postId: string, index: number): void {
  const key = carouselKey(postId);
  slideByPost.delete(key);
  slideByPost.set(key, Math.max(0, Math.floor(index)));
  if (slideByPost.size > MAX_ENTRIES) {
    const oldest = slideByPost.keys().next().value;
    if (oldest !== undefined) slideByPost.delete(oldest);
  }
}

/** Test hook. */
export function clearCarouselMemory(): void {
  slideByPost.clear();
}
