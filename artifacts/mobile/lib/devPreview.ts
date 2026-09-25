/**
 * Dev web preview detection helper.
 *
 * Semantics match the existing PREVIEW_ROLE logic in app/_layout.tsx exactly:
 *   - Inert (returns false) in production builds (__DEV__ === false)
 *   - Inert on native (Platform.OS !== 'web')
 *   - Inert when window is unavailable (SSR / test environments without window)
 *   - ?bt_preview=buyer|seller explicitly selects and persists a preview role
 *   - the saved role is used when the URL has no selection; a fresh dev-web
 *     session defaults to seller preview
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

const PREVIEW_ROLE_KEY = 'bt:previewRole';

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

/**
 * Returns true in the dev-web seller preview context. The URL selection takes
 * precedence, then the saved browser-session role, with seller as the default.
 *
 * @param searchOverride  Optional query string (e.g. '?bt_preview=buyer')
 *   supplied by tests instead of reading window.location.search.
 */
export function isSellerDevPreview(searchOverride?: string): boolean {
  // Production builds: never activate
  if (!__DEV__) return false;

  // Native (iOS / Android): never activate
  if (Platform.OS !== 'web') return false;
  return getDevWebPreviewRole(searchOverride) === 'seller';
}

/**
 * Convenience: returns true only in the dev-web buyer preview context.
 * Complements isSellerDevPreview for completeness; used in tests.
 */
export function isBuyerDevPreview(searchOverride?: string): boolean {
  if (!__DEV__) return false;
  if (Platform.OS !== 'web') return false;
  return getDevWebPreviewRole(searchOverride) === 'buyer';
}
