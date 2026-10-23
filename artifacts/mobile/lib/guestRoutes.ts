/**
 * Account-wall policy: all app routes require an account. The buyer browse
 * lookup below only preserves signed-in seller navigation. AuthGate handles
 * signed-out redirects; only auth and legal documents mount without a session.
 */

/** Screens inside the `(buyer)` tab group that work without an account. */
const GUEST_BUYER_TABS = new Set(['', 'index', 'feed', 'discover', 'discover-feed', 'search']);

/** Top-level screens that only read public data. */
const GUEST_TOP_LEVEL = new Set([
  'buyer-product-detail',
  'bundle-detail',
  'thread-product-detail', // alias of buyer-product-detail (feed/search/discover tiles)
  'buyer-category', // public: api.publicDiscovery.categoryProducts
  'buyer-trending', // public: api.publicDiscovery.trendingProducts / trendingBrands
  'checkout-return', // Stripe hosted Checkout's return page
  'checkout-gift-message', // local to checkout; calls no API
  'buyer-search',
  'buyer-post-viewer',
  'buyer-post-comments', // read-only for guests; composer prompts sign-in
  'buyer-drops',
  'buyer-drop-detail',
  'seller-profile',
  'buyer-other-profile',
  'profile-videos',
  'profile-products',
  'location',
  'hashtag',
  'muted-words',
  'live-replays',
  'live-replay',
  'buyer-live',
  'drops', // drops/[dropId]
  'store', // store/product/[productId]
  'u', // u/[username] public profile
  'c', // c/[collectionId] public collection
  // Share-link entry points (BT-303): listed explicitly so a signed-out
  // visitor is never bounced to sign-in by effect ordering before the
  // redirect screen forwards them on.
  'p', // p/[postId] -> buyer-post-viewer
  'tag', // tag/[tag] -> hashtag
  'place', // place/[placeId] -> location
  'invite', // invite/[code] referral link -> onboarding with the code
  'g', // g/[code] -> giveaway
  'giveaway', // public giveaway page; Enter is gated at the action (BT-319)
]);

export function isBuyerBrowseRoute(segments: readonly string[]): boolean {
  const first = segments[0] ?? '';
  if (first === '(buyer)') return GUEST_BUYER_TABS.has(segments[1] ?? '');
  if (first === 'live') return true;
  return GUEST_TOP_LEVEL.has(first);
}

/** Root navigator entries which must mount without an account. Buyer children
 * are checked individually inside their navigator so the tab bar stays usable. */
export function isGuestScreenEntry(routeName: string, buyerTab = false): boolean {
  if (buyerTab) return false;
  return [
    'index', '', 'sign-in', 'forgot-password', 'splash', 'onboarding',
    'privacy', 'terms', 'community-guidelines', 'seller-agreement', 'refund-policy',
  ].includes(routeName);
}

/** Compatibility predicate: browsing is no longer available signed out. */
export function isGuestBrowseRoute(_segments: readonly string[]): boolean {
  return false;
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
