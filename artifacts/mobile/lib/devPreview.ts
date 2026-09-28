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
 *   - ?bt_preview=buyer|seller explicitly selects and persists a preview role
 *   - in dev, the saved tab role is used when the URL has no selection; a fresh
 *     dev-web session temporarily defaults to buyer preview
 *
 * Expo Router drops the query on in-app navigation. Dev builds retain the
 * tab-scoped choice; exported screenshot builds use the role that _layout
 * saved for AuthGate so preview screens do not hang after navigation.
 *
 * Pure / testable: accepts an optional override for the search string so unit
 * tests can exercise every branch without touching the global window object.
 *
 * Usage:
 *   import { isSellerDevPreview } from '@/lib/devPreview';
 *   if (isSellerDevPreview()) { ... show preview data ... }
 */

import { Platform } from 'react-native';
import { resolvePreviewRole, type PreviewRole } from './previewRoleSelection';

// Separate temporary key so an earlier saved seller preference cannot override
// the buyer-first testing entry. Restore the old key with the old default.
const PREVIEW_ROLE_KEY = 'bt:previewRole:buyer-test';

export function getDevWebPreviewRole(searchOverride?: string): PreviewRole | null {
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return null;

  const search = searchOverride ?? window.location.search;
  if (searchOverride !== undefined) return resolvePreviewRole(search, null);

  let savedRole: string | null = null;
  try {
    savedRole = window.sessionStorage.getItem(PREVIEW_ROLE_KEY);
  } catch {
    // Private browsing can disable storage; explicit preview URLs still work.
  }
  const role = resolvePreviewRole(search, savedRole);
  if (new URLSearchParams(search).has('bt_preview')) {
    setDevWebPreviewRole(role);
  }
  return role;
}

export function setDevWebPreviewRole(role: PreviewRole): void {
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PREVIEW_ROLE_KEY, role);
  } catch {
    // The URL parameter remains a usable fallback without session storage.
  }
}

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
 * Returns true in the dev-web seller preview context. The URL selection takes
 * precedence, then the saved browser-session role, with buyer as the temporary default.
 *
 * @param searchOverride  Optional query string (e.g. '?bt_preview=buyer')
 *   supplied by tests instead of reading window.location.search.
 */
export function isSellerDevPreview(searchOverride?: string): boolean {
  // A real production build (neither dev nor the screenshot-export flag): never activate
  if (!__DEV__ && !NAVIGATION_ISOLATION_TEST) return false;

  // Native (iOS / Android): never activate
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  if (__DEV__) return getDevWebPreviewRole(searchOverride) === 'seller';
  const v = new URLSearchParams(searchOverride ?? window.location.search).get('bt_preview');
  if (v === 'seller') return true;
  if (v === 'buyer') return false;
  return persistedPreviewRole() === 'seller';
}

/**
 * Convenience: returns true only in the dev-web buyer preview context.
 * Complements isSellerDevPreview for completeness; used in tests.
 */
export function isBuyerDevPreview(searchOverride?: string): boolean {
  if (!__DEV__ && !NAVIGATION_ISOLATION_TEST) return false;
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;
  if (__DEV__) return getDevWebPreviewRole(searchOverride) === 'buyer';
  const v = new URLSearchParams(searchOverride ?? window.location.search).get('bt_preview');
  if (v === 'buyer') return true;
  if (v === 'seller') return false;
  return persistedPreviewRole() === 'buyer';
}
