/**
 * Routes a signed-out guest may open (App Store Review Guideline 5.1.1(v)):
 * browsing the feed, stores, products, drops and profiles must not require an
 * account. Buying, posting, messaging, following and liking are gated inline
 * at the action (see hooks/useSignInGate.ts), not at the route.
 *
 * app/_layout.tsx (AuthGate) consults this before redirecting a signed-out
 * visitor to the sign-in wall. Anything not listed here keeps its existing
 * forced sign-in behaviour (inbox, orders, settings, seller tabs, ...).
 */

/** Screens inside the `(buyer)` tab group that work without an account. */
const GUEST_BUYER_TABS = new Set(['', 'index', 'feed', 'discover', 'discover-feed', 'search', 'cart']);

/** Top-level screens that only read public data. */
const GUEST_TOP_LEVEL = new Set([
  'buyer-product-detail',
  'thread-product-detail', // alias of buyer-product-detail (feed/search/discover tiles)
  'buyer-checkout', // guest checkout exists (api.guest.checkout)
  'thread-checkout', // alias of buyer-checkout (cart + Shop sheet "Buy now")
  'checkout-return', // Stripe hosted Checkout's return page
  'buyer-search',
  'buyer-post-viewer',
  'buyer-post-comments', // read-only for guests; composer prompts sign-in
  'buyer-drops',
  'buyer-drop-detail',
  'seller-profile',
  'profile-videos',
  'profile-products',
  'location',
  'hashtag',
  'muted-words',
  'live-replays',
  'live-replay',
  'drops', // drops/[dropId]
  'store', // store/product/[productId]
  'u', // u/[username] public profile
  'c', // c/[collectionId] public collection
]);

export function isGuestBrowseRoute(segments: readonly string[]): boolean {
  const first = segments[0] ?? '';
  if (first === '(buyer)') return GUEST_BUYER_TABS.has(segments[1] ?? '');
  return GUEST_TOP_LEVEL.has(first);
}

/**
 * Validate a `returnTo` param before navigating to it after sign-in: only
 * in-app absolute paths, never a protocol-relative/external URL or the auth
 * screens themselves (which would loop).
 */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('://') || v.includes('\\')) return null;
  const path = v.split('?')[0].split('#')[0];
  if (['/sign-in', '/forgot-password', '/splash', '/onboarding', '/'].includes(path)) return null;
  return v;
}
