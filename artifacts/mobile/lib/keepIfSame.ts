/**
 * Stale-while-revalidate helper for screens that refetch on focus: keep the
 * value already on screen when a background refresh returns the same data,
 * so React (and every list row under it) doesn't re-render for a no-op
 * refresh. Use inside a functional state update:
 *
 *   setRows((prev) => keepIfSame(prev, next));
 *
 * Structural comparison by JSON — meant for the plain API payloads these
 * screens hold (tens to low hundreds of rows), not for large blobs.
 */
export function keepIfSame<T>(prev: T, next: T): T {
  if (prev === next) return prev;
  try {
    return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
  } catch {
    return next;
  }
}
