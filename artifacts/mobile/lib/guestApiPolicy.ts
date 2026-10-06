/**
 * Signed-out API guard. A guest (no Clerk token) must not call account-scoped
 * or paid endpoints; the server would 401 them anyway (requireAuth), so the
 * client short-circuits instead of sending the request. Public browse
 * endpoints (/api/public/*, /api/guest/*, /api/config/features, ...) are never
 * blocked. Consulted from lib/api.ts doRequest only when no token exists.
 */

/** Path prefixes (after `/api[/vN]`) that need a signed-in account. */
const SIGNED_IN_ONLY_PREFIXES = [
  // Paid / AI generation
  'ai', 'ai-consent', 'logo', 'mockup', 'photography', 'bg-removal', 'lifestyle', 'techpack',
  'design-studio', 'store/ai', 'brandthread-agent', 'meta-ads', 'ad-campaigns', 'boosts',
  // Account-scoped buyer data
  'conversations', 'notifications', 'notification-prefs', 'push',
  'buyer/notifications', 'buyer/payment-methods', 'buyer/saved', 'buyer/collections',
  'buyer/recently-viewed', 'buyer/cart', 'buyer/checkout/payment-intent',
  'feed/for-you', 'feed/events', 'loyalty', 'thread-cash',
];

function normalize(path: string): string {
  const noQuery = path.split('?')[0].split('#')[0];
  return noQuery.replace(/^\/api(\/v\d+)?\/?/, '').replace(/\/+$/, '');
}

export function isSignedInOnlyPath(path: string): boolean {
  const p = normalize(path);
  return SIGNED_IN_ONLY_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}
