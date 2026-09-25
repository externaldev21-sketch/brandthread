/**
 * Dev web preview detection helper.
 *
 * Semantics match the existing PREVIEW_ROLE logic in app/_layout.tsx exactly:
 *   - Inert (returns false) in production builds (__DEV__ === false)
 *   - Inert on native (Platform.OS !== 'web')
 *   - Inert when window is unavailable (SSR / test environments without window)
 *   - true  only when ?bt_preview=seller is explicitly set
 *   - false otherwise, including when no bt_preview param is present at all
 *     (no query param must mean the real signed-in experience, never fake data)
 *
 * Pure / testable: accepts an optional override for the search string so unit
 * tests can exercise every branch without touching the global window object.
 *
 * Usage:
 *   import { isSellerDevPreview } from '@/lib/devPreview';
 *   if (isSellerDevPreview()) { ... show preview data ... }
 */

import { Platform } from 'react-native';

/**
 * Returns true only in the dev-web seller preview context, and only when
 * explicitly requested via ?bt_preview=seller.
 *
 * @param searchOverride  Optional query string (e.g. '?bt_preview=buyer')
 *   supplied by tests instead of reading window.location.search.
 */
export function isSellerDevPreview(searchOverride?: string): boolean {
  // Production builds: never activate
  if (!__DEV__) return false;

  // Native (iOS / Android): never activate
  if (Platform.OS !== 'web') return false;

  // Resolve the search string: explicit override > window.location.search > ''
  let search = searchOverride ?? '';
  if (searchOverride === undefined) {
    if (typeof window === 'undefined') return false;
    search = window.location.search;
  }

  // Only an explicit ?bt_preview=seller opts into fake preview data.
  const v = new URLSearchParams(search).get('bt_preview');
  return v === 'seller';
}

/**
 * Convenience: returns true only in the dev-web buyer preview context.
 * Complements isSellerDevPreview for completeness; used in tests.
 */
export function isBuyerDevPreview(searchOverride?: string): boolean {
  if (!__DEV__) return false;
  if (Platform.OS !== 'web') return false;

  let search = searchOverride ?? '';
  if (searchOverride === undefined) {
    if (typeof window === 'undefined') return false;
    search = window.location.search;
  }

  const v = new URLSearchParams(search).get('bt_preview');
  return v === 'buyer';
}
