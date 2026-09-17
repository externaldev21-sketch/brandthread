/**
 * Dev web preview detection helper.
 *
 * Semantics match the existing PREVIEW_ROLE logic in app/_layout.tsx exactly:
 *   - Inert (returns false) in production builds (__DEV__ === false)
 *   - Inert on native (Platform.OS !== 'web')
 *   - Inert when window is unavailable (SSR / test environments without window)
 *   - false when ?bt_preview=buyer (buyer review mode)
 *   - true  for the default dev web seller preview (no param, or ?bt_preview=seller)
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
 * Returns true only in the dev-web seller preview context.
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

  // ?bt_preview=buyer → this is a buyer review session, not a seller preview
  const v = new URLSearchParams(search).get('bt_preview');
  if (v === 'buyer') return false;

  // Default (no param) or ?bt_preview=seller → seller preview
  return true;
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
