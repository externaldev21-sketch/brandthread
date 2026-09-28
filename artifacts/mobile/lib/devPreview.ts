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
 *   - true  only when ?bt_preview=seller was explicitly set at some point
 *     this session
 *   - false otherwise, including a fresh session with no bt_preview param at
 *     all (no query param must mean the real signed-in experience, never
 *     fake data)
 *
 * The query param only has to be present on the FIRST page load. Expo
 * Router's tab bar and any `router.push()` to a plain path (no query string)
 * drop it from the URL — normal in-app navigation, not a reload — so a
 * helper that re-read `window.location.search` on every call went inert the
 * moment someone tapped a tab, and every screen past that point tried the
 * real (here, unreachable) API and hung on its loading skeleton forever.
 * `app/_layout.tsx`'s own `PREVIEW_ROLE` already avoids this by reading the
 * query string exactly once at module load and mirroring it into
 * `localStorage['user_role']` for AuthGate; this helper now falls back to
 * that same persisted value once the query param itself is gone, instead of
 * inventing a second storage key.
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

function persistedPreviewRole(): 'buyer' | 'seller' | null {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('user_role') : null;
    return stored === 'buyer' || stored === 'seller' ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Returns true only in the dev-web seller preview context, and only when
 * explicitly requested via ?bt_preview=seller (this navigation or earlier
 * this session).
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

  const v = new URLSearchParams(search).get('bt_preview');
  if (v === 'seller') return true;
  if (v === 'buyer') return false; // an explicit, different role always wins
  // No param on this navigation — fall back to the role the first load set.
  return persistedPreviewRole() === 'seller';
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
  if (v === 'buyer') return true;
  if (v === 'seller') return false;
  return persistedPreviewRole() === 'buyer';
}
