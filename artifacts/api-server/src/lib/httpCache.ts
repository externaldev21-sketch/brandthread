/**
 * HTTP caching helpers for public, non-viewer-specific GET endpoints.
 *
 * Only apply this to responses that are the same for every caller (no auth
 * state, no per-viewer block/mute filtering, no personalization). A short
 * max-age keeps clients/CDNs from re-fetching on every request while still
 * picking up changes quickly; stale-while-revalidate lets a shared cache
 * serve a slightly-stale copy while it refreshes in the background instead
 * of a client blocking on a fresh DB hit.
 */
import type { Response } from "express";

/**
 * Marks a response as publicly cacheable for a short, bounded window.
 * Defaults: 30s fresh, 2min stale-while-revalidate — enough to absorb bursty
 * repeat traffic (pull-to-refresh, pagination re-fetches) without serving
 * meaningfully outdated product/listing data.
 */
export function setPublicCacheHeaders(
  res: Response,
  { maxAgeSeconds = 30, staleWhileRevalidateSeconds = 120 }: {
    maxAgeSeconds?: number;
    staleWhileRevalidateSeconds?: number;
  } = {},
): void {
  res.setHeader(
    "Cache-Control",
    `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${staleWhileRevalidateSeconds}`,
  );
}

/**
 * Block-aware public reads: a signed-in viewer response omits content from
 * people they have blocked (or who blocked them), so it must never enter a
 * shared cache. Signed-out viewers keep the normal short public cache.
 */
export function setViewerScopedCacheHeaders(res: Response, viewerId: string | null | undefined): void {
  if (viewerId) res.setHeader("Cache-Control", "private, no-store");
  else setPublicCacheHeaders(res);
}
