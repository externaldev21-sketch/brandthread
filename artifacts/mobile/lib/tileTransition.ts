/**
 * A tiny cross-screen handoff for the "expand from grid tile" transition:
 * a profile/discover grid cell measures its own on-screen rect right before
 * navigating, stashes it here, and the destination screen (the full-screen
 * post/video viewer) reads it once on mount to animate an overlay image
 * growing from that exact rect into place, instead of a plain screen
 * push/pop cut.
 *
 * Module-level rather than React context/params because it's a one-shot,
 * fire-and-forget handoff: encoding a rect into the route's querystring
 * would work too, but this avoids widening every consuming screen's
 * params type for a purely cosmetic effect that gracefully no-ops when
 * absent (deep link, back navigation, "See all", etc.).
 */
export interface PendingTileTransition {
  postId: string;
  uri: string | null;
  /** Absolute on-screen rect of the tapped tile, from measureInWindow(). */
  rect: { x: number; y: number; width: number; height: number };
  /** When the tile was tapped (ms); a handoff older than PENDING_TTL_MS is ignored. */
  at?: number;
}

/** A handoff no screen picked up within this window is stale (e.g. the tap navigated elsewhere). */
export const PENDING_TTL_MS = 1500;

/** Transition key for a product tile → product page handoff (posts use their bare id). */
export function productTransitionKey(productId: string): string {
  return `product:${productId}`;
}

let pending: PendingTileTransition | null = null;

export function setPendingTileTransition(transition: PendingTileTransition): void {
  pending = { ...transition, at: transition.at ?? Date.now() };
}

/** Reads and clears the pending transition — only the very next screen that asks gets it. */
export function takePendingTileTransition(postId: string, now: number = Date.now()): PendingTileTransition | null {
  if (!pending || pending.postId !== postId) return null;
  const result = pending;
  pending = null;
  if (result.at != null && now - result.at > PENDING_TTL_MS) return null;
  return result;
}

/** Test-only. */
export function __clearPendingTileTransitionForTests(): void {
  pending = null;
}
