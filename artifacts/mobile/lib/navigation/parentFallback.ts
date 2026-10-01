/**
 * Logical PARENT for every screen that now passes an explicit `goBackOr`
 * fallback, instead of relying on its default (blanket `/`, which re-enters
 * AuthGate and can land on a dashboard/discover root — indistinguishable,
 * from the user's seat, from "back threw me to home").
 *
 * This map is documentation + a single source of truth for tests
 * (parentFallback.test.ts) — it is NOT read at runtime by the screens
 * themselves (each one passes its own `goBackOr(router, '<parent>')`
 * literal directly, since expo-router's `Href` type is a template-literal
 * union that can't be indexed generically through a plain string key
 * without losing type safety). Keep this map in sync with the call sites
 * listed here whenever one changes; parentFallback.test.ts checks the
 * reverse direction (that every route named here still exists as a file).
 *
 * The fallback only ever fires when there is truly no back history (a cold
 * deep link, e.g. opened from a push notification or a bookmark) — normal
 * in-app navigation already has real history and pops it correctly via
 * `router.back()`, which `goBackOr` always prefers.
 */
export const PARENT_FALLBACK: Record<string, string> = {
  '/order-detail': '/(tabs)/orders',
  '/buyer-order-detail': '/(buyer)/orders',
  '/product-store': '/(buyer)/discover',
  '/buyer-product-detail': '/(buyer)/discover',
  '/payouts': '/(tabs)/more',
  '/account-type-settings': '/buyer-settings-menu',
  '/buyer-privacy-settings': '/buyer-settings-menu',
  '/buyer-settings-detail': '/buyer-settings-menu',
  '/notifications-settings': '/(tabs)/more',
  '/seller-activity': '/(tabs)/profile',
  '/general-settings': '/seller-settings',
  '/ai-settings': '/ai-brain',
  '/customer-accounts': '/seller-settings',
  '/customer-events': '/seller-settings',
  '/customer-privacy': '/seller-settings',
  '/customer-orders': '/customers',
};
