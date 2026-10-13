/**
 * Listing photo order. The first photo is the cover (it is also images[0],
 * which the buyer page and every product card show first), so `isCover` and
 * `sortOrder` are always derived from position after any change.
 */

type Ordered = { id: string; isCover?: boolean; sortOrder?: number };

/** Returns a copy with the item at `from` moved to `to` (indices clamped). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  if (target === from) return next;
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item as T);
  return next;
}

/** Cover follows index 0; sortOrder follows position. */
export function withCoverFirst<T extends Ordered>(items: readonly T[]): T[] {
  return items.map((m, i) => ({ ...m, isCover: i === 0, sortOrder: i }));
}

/** Drag result: move then re-derive cover/sortOrder. */
export function reorderPhotos<T extends Ordered>(items: readonly T[], from: number, to: number): T[] {
  return withCoverFirst(moveItem(items, from, to));
}

/** "Set as cover": the chosen photo moves to the front. */
export function movePhotoToFront<T extends Ordered>(items: readonly T[], id: string): T[] {
  const idx = items.findIndex(m => m.id === id);
  return idx === -1 ? withCoverFirst(items) : reorderPhotos(items, idx, 0);
}

/** Drop index for a horizontal drag of `translationX` from `index` (tile pitch `step`). */
export function dropIndexFor(index: number, translationX: number, step: number, count: number): number {
  if (count <= 0 || step <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(index + translationX / step)));
}
