/**
 * Desktop web shell — the pure layout rules (no React Native imports beyond
 * Platform), so tests can exercise every branch.
 *
 * At a desktop-width browser window (>= DESKTOP_SHELL_BREAKPOINT) the app
 * stops rendering as a single phone-shaped column and instead fills the
 * screen the way Shopify admin does: a persistent, collapsible left sidebar
 * holds every destination the phone reaches through the bottom tab bar, the
 * Studio radial menu and the More screen, and screens render in a content
 * area beside it. Below the breakpoint nothing here applies — phones and the
 * 700–1023px tablet column (components/web/WebAppShell.tsx) are unchanged.
 *
 * Screens keep their own components; the shell only decides how much room
 * they get (`contentMaxWidthFor`). Screens with a bespoke desktop treatment
 * (multi-column dashboard, product grids, the two-column product page) get a
 * wide column; everything else renders centered at a comfortable reading
 * width.
 */

// Self-contained on purpose (no lib/theme import): hooks used all over the
// app import this module, and several test suites mock lib/theme with only
// the tokens they need.

/** At or above this window width, web renders the desktop shell (lib/theme BREAKPOINT.desktopWeb). */
export const DESKTOP_SHELL_BREAKPOINT = 1024;

export const SIDEBAR_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 72;
export const TOP_BAR_HEIGHT = 60;
/** Space kept between the content column and the sidebar / window edge. */
export const CONTENT_GUTTER = 24;

/** Default column for screens without a bespoke desktop layout (lib/theme CONTENT_MAX_WIDTH). */
export const DEFAULT_CONTENT_MAX_WIDTH = 720;
/** Seller management screens that flow into multi-column grids and tables. */
export const WIDE_CONTENT_MAX_WIDTH = 1280;
/** Buyer browsing grids and the two-column product page. */
export const BROWSE_CONTENT_MAX_WIDTH = 1160;
/** Buyer feed: one centered post column, like Instagram on the web. */
export const FEED_CONTENT_MAX_WIDTH = 600;

export type DesktopShellSide = 'seller' | 'buyer';

/**
 * Routes that never show the sidebar: no signed-in shell yet (boot, auth,
 * onboarding, public legal pages), and immersive full-screen flows (camera,
 * live, canvas editor, storefront preview) that own the whole window on the
 * phone too. They render in the classic centered column instead.
 */
export const DESKTOP_SHELL_HIDDEN_SEGMENTS = new Set([
  '', 'index', 'splash', 'sign-in', 'forgot-password', 'onboarding', 'access-code', 'thread-explainer',
  'privacy', 'terms', 'community-guidelines', 'seller-agreement', 'refund-policy',
  'navigation-isolation-probe',
  'create-post', 'design-canvas', 'store-preview', 'store-generating', 'store-live',
  'seller-go-live', 'seller-live', 'seller-live-summary', 'live-moderation', 'live-cohost', 'live-cohost-invite',
  'live', 'live-feed', 'live-replay', 'buyer-live',
  'buyer-story-create', 'buyer-story-viewer', 'story-mention-viewer',
  'call-screen',
]);

/** Which sidebar (if any) the current route gets. */
export function desktopShellSide({
  segments,
  isSeller,
  isBuyer,
}: {
  segments: readonly string[];
  /** An active seller session (or the seller design preview). */
  isSeller: boolean;
  /** A buyer session (or the buyer design preview). */
  isBuyer: boolean;
}): DesktopShellSide | null {
  const first = segments[0] ?? '';
  if (DESKTOP_SHELL_HIDDEN_SEGMENTS.has(first)) return null;
  if (isSeller) return 'seller';
  // Guests can browse the buyer tabs (GuestRouteBoundary) and open shared
  // buyer pages (a product link) too.
  if (isBuyer || first === '(buyer)' || first.startsWith('buyer-')) return 'buyer';
  return null;
}

/** The route's own key: the tab inside a tab group, else the root route. */
export function routeKey(segments: readonly string[]): string {
  const first = segments[0] ?? '';
  if (first === '(tabs)' || first === '(buyer)') return segments[1] ?? 'index';
  return first;
}

const SELLER_WIDE_ROUTES = new Set([
  'index', 'products', 'orders', 'analytics', 'customers',
]);
const BUYER_BROWSE_ROUTES = new Set(['discover', 'buyer-product-detail']);
const BUYER_FEED_ROUTES = new Set(['index', 'feed']);

/** Max width of the content column for the current route. */
export function contentMaxWidthFor(side: DesktopShellSide, segments: readonly string[]): number {
  const first = segments[0] ?? '';
  const key = routeKey(segments);
  if (side === 'seller') {
    if (first === '(tabs)' || first === 'customers') {
      if (SELLER_WIDE_ROUTES.has(key)) return WIDE_CONTENT_MAX_WIDTH;
    }
    return DEFAULT_CONTENT_MAX_WIDTH;
  }
  if (first === '(buyer)' && BUYER_FEED_ROUTES.has(key)) return FEED_CONTENT_MAX_WIDTH;
  if (BUYER_BROWSE_ROUTES.has(key)) return BROWSE_CONTENT_MAX_WIDTH;
  return DEFAULT_CONTENT_MAX_WIDTH;
}

/** Width of the content column: its max width, or what's left beside the sidebar. */
export function contentWidthFor({
  windowWidth,
  sidebarWidth,
  maxWidth,
}: {
  windowWidth: number;
  sidebarWidth: number;
  maxWidth: number;
}): number {
  return Math.max(0, Math.min(maxWidth, windowWidth - sidebarWidth - CONTENT_GUTTER * 2));
}
