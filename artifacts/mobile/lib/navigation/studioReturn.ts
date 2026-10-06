/**
 * "Menu → tile → back ⇒ menu" (docs/NAVIGATION.md, rule 3 corollary).
 *
 * The Studio radial menu is an overlay drawn above whichever seller tab is
 * active, not a route. When a tile is opened from it the tile's screen is
 * PUSHED over that tab, so Back/Cancel pops straight back to the tab — and
 * the user expects to land where they left: on the open menu. This tiny
 * state machine records "a tile was opened from the menu over <path>" and
 * answers, for every pathname change observed by the always-mounted
 * SellerBarGate, whether the menu should re-open now.
 *
 * It lives at module level (not in the menu component) because the menu is
 * unmounted on full-screen tile routes (add-product, design-canvas, …) and
 * must still re-open when such a route pops.
 *
 * Pure and framework-free so it is unit-testable (studioReturn.test.ts).
 */

interface PendingReturn {
  /** Pathname the menu was open over when the tile was pushed. */
  underlying: string;
  /** True once a pathname other than `underlying` has been observed. */
  left: boolean;
}

/** Seller tab roots as `usePathname()` reports them (group segment dropped). */
const SELLER_TAB_ROOT_PATHS = new Set([
  '/', '/products', '/orders', '/profile',
  '/studio', '/more', '/feed', '/following', '/analytics', '/marketing',
]);

let pending: PendingReturn | null = null;

export function isSellerTabRootPath(pathname: string): boolean {
  return SELLER_TAB_ROOT_PATHS.has(pathname);
}

/**
 * Call synchronously right before the menu pushes a tile route. A tile that
 * is itself a tab (Products, Orders, Analytics…) switches tabs instead of
 * pushing, so there is nothing to pop back from — no return is recorded.
 */
export function markStudioTileOpened(underlyingPathname: string, tileRoute?: string): void {
  if (tileRoute && tileRoute.startsWith('/(tabs)/')) {
    pending = null;
    return;
  }
  pending = { underlying: underlyingPathname, left: false };
}

/**
 * Call synchronously before any navigation that deliberately leaves the
 * tile without "going back" — tapping a tab in the global bar — so the menu
 * does not pop open on top of the tab the user just chose.
 */
export function cancelStudioReturn(): void {
  pending = null;
}

export function hasPendingStudioReturn(): boolean {
  return pending !== null;
}

/**
 * Feed every observed pathname here. Returns true exactly once: when the
 * pathname comes back to the one the menu was open over after having left
 * it. Landing on a different tab root instead clears the pending return.
 */
export function shouldReopenStudioMenu(pathname: string): boolean {
  if (!pending) return false;
  if (!pending.left) {
    if (pathname !== pending.underlying) pending.left = true;
    return false;
  }
  if (pathname === pending.underlying) {
    pending = null;
    return true;
  }
  if (isSellerTabRootPath(pathname)) pending = null;
  return false;
}

/** Test-only reset. */
export function __resetStudioReturnForTests(): void {
  pending = null;
}
