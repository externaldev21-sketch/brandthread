/**
 * Dev web preview detection helper.
 *
 * Semantics match the existing PREVIEW_ROLE logic in app/_layout.tsx exactly
 * (including its `__DEV__ || EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST` OR — the
 * same env flag scripts/store-screenshots/harness.mjs's `buildPreviewWeb` sets
 * so an exported, production (__DEV__ === false) preview build can still be
 * screenshotted with ?bt_preview=buyer|seller):
 *   - Inert (returns false) in a real production build (neither flag set)
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

const NAVIGATION_ISOLATION_TEST = process.env.EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST === '1';

/**
 * Returns true only in the dev-web seller preview context, and only when
 * explicitly requested via ?bt_preview=seller.
 *
 * @param searchOverride  Optional query string (e.g. '?bt_preview=buyer')
 *   supplied by tests instead of reading window.location.search.
 */
export function isSellerDevPreview(searchOverride?: string): boolean {
  // A real production build (neither dev nor the screenshot-export flag): never activate
  if (!__DEV__ && !NAVIGATION_ISOLATION_TEST) return false;

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
  if (!__DEV__ && !NAVIGATION_ISOLATION_TEST) return false;
  if (Platform.OS !== 'web') return false;

  let search = searchOverride ?? '';
  if (searchOverride === undefined) {
    if (typeof window === 'undefined') return false;
    search = window.location.search;
  }

  const v = new URLSearchParams(search).get('bt_preview');
  return v === 'buyer';
}
