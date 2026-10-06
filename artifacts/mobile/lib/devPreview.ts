/**
 * Dev web preview detection helper.
 *
 * Web role semantics match the existing PREVIEW_ROLE logic in app/_layout.tsx exactly
 * (including its `__DEV__ || EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST` OR — the
 * same env flag scripts/store-screenshots/harness.mjs's `buildPreviewWeb` sets
 * so an exported, production (__DEV__ === false) preview build can still be
 * screenshotted with ?bt_preview=buyer|seller):
 *   - Inert (returns false) in a real production build (neither flag set)
 *   - Native seller preview is an explicit, dev-build-only EXPO_PUBLIC_DEV_PREVIEW=seller opt-in
 *   - Inert when window is unavailable (SSR / test environments without window)
 *   - ?bt_preview=buyer|seller explicitly selects and persists a preview role
 *   - in dev, the saved tab role is used when the URL has no selection; a fresh
 *     dev-web session opens the seller preview
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
import { DEV_SELLER_PREVIEW, NAVIGATION_ISOLATION_TEST } from './buildFlags';
import { resolvePreviewRole, type PreviewRole } from './previewRoleSelection';

// Use a new session key so the former buyer-first default does not keep an
// already-open preview tab on the buyer side after switching to seller-first.
const PREVIEW_ROLE_KEY = 'bt:previewRole:seller-default';

export function getDevWebPreviewRole(searchOverride?: string): PreviewRole | null {
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined' || isProductionPreviewHost()) return null;

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
  if (!__DEV__ || Platform.OS !== 'web' || typeof window === 'undefined' || isProductionPreviewHost()) return;
  try {
    window.sessionStorage.setItem(PREVIEW_ROLE_KEY, role);
  } catch {
    // The URL parameter remains a usable fallback without session storage.
  }
}

/**
 * Hard gate, independent of EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST: the
 * preview bypass must never activate on the app's real production hosts,
 * even if that build-time env var were ever accidentally baked into a
 * production bundle (it's an EXPO_PUBLIC_* var, so nothing prevents a
 * misconfigured build pipeline from setting it for the wrong profile —
 * this is the defense-in-depth layer docs/app-store/release-flow.md and
 * docs/polish/screens/02-onboarding-auth.md warn about, enforced in code
 * instead of relying purely on release-process discipline).
 *
 * `brandthread.app` is the canonical production origin and
 * `brandthread.replit.app` is its Replit-hosted alias — both are the real,
 * public production destinations (see server/serve.js's own
 * CANONICAL_ORIGIN/GENERATED_HOST). Every other web host (the Replit dev
 * workspace's own *.replit.dev preview domain, localhost, a Vercel/preview
 * deploy, this sandbox's screenshot harness) is a dev/preview host and may
 * use the bypass.
 */
const PRODUCTION_HOSTS = new Set(['brandthread.app', 'www.brandthread.app', 'brandthread.replit.app']);

export function isProductionPreviewHost(hostnameOverride?: string): boolean {
  let hostname = hostnameOverride;
  if (hostname === undefined) {
    if (typeof window === 'undefined') return false;
    hostname = window.location.hostname;
  }
  return PRODUCTION_HOSTS.has(hostname.toLowerCase());
}

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
 * precedence, then the saved browser-session role, with seller as the default.
 *
 * @param searchOverride  Optional query string (e.g. '?bt_preview=buyer')
 *   supplied by tests instead of reading window.location.search.
 */
export function isSellerDevPreview(searchOverride?: string): boolean {
  // Explicit temporary native seller preview; independent from browser URL
  // state and impossible to enable in a release bundle.
  if (Platform.OS !== 'web') return DEV_SELLER_PREVIEW;
  // A real production build (neither dev nor the screenshot-export flag): never activate
  if (!__DEV__ && !NAVIGATION_ISOLATION_TEST) return false;

  // Hard gate: never activate on the real production host, even if the
  // NAVIGATION_ISOLATION_TEST env var somehow reached a production build.
  if (isProductionPreviewHost()) return false;
  if (typeof window === 'undefined') return false;
  if (DEV_SELLER_PREVIEW) return true;
  if (__DEV__) return getDevWebPreviewRole(searchOverride) === 'seller';
  const v = new URLSearchParams(searchOverride ?? window.location.search).get('bt_preview');
  if (v === 'seller') return true;
  if (v === 'buyer') return false;
  return persistedPreviewRole() === 'seller';
}

/**
 * Fresh vs. demo preview data mode — orthogonal to which role
 * (isSellerDevPreview / isBuyerDevPreview) is being previewed.
 *
 * Default (`?bt_preview=seller`, no `demo` param): FRESH mode — a brand-new
 * account with zero everything (no orders, no products, no seeded numbers).
 * Dev's explicit call: preview must never look like it already has people on
 * it. Opt-in only: `?bt_preview=seller&demo=1` — a populated demo dataset,
 * for whoever needs to show the app with data in it (e.g. screenshots,
 * design review). Nothing wires the demo dataset up as a default anywhere;
 * a screen that wants to show one still has to check isPreviewDemoMode()
 * itself and fall back to empty when it's false.
 *
 * Demo mode is URL-only and web-only. It is never persisted, and a route
 * without demo=1 is fresh even if an earlier page opted into demo data.
 */
export function clearStoredPreviewDemo(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem('bt_preview_demo');
  } catch {
    // Storage may be unavailable; demo detection never reads it regardless.
  }
}

// Clear the retired persistent flag before any screen reads preview state.
clearStoredPreviewDemo();

function resolveSearch(searchOverride?: string): string | null {
  if (searchOverride !== undefined) return searchOverride;
  if (typeof window === 'undefined') return null;
  return window.location.search;
}

/**
 * True only when a dev/web preview (buyer or seller) explicitly opted into
 * the populated demo dataset via `&demo=1`. Never true by default, and never
 * true outside a preview context (mirrors the __DEV__ / production-host
 * gates isSellerDevPreview/isBuyerDevPreview apply).
 */
export function isPreviewDemoMode(searchOverride?: string): boolean {
  // The native onboarding bypass selects a role, not a populated account.
  if (Platform.OS !== 'web') return false;
  if (!__DEV__ && !NAVIGATION_ISOLATION_TEST) return false;
  if (isProductionPreviewHost()) return false;
  if (!isSellerDevPreview(searchOverride) && !isBuyerDevPreview(searchOverride)) return false;
  const search = resolveSearch(searchOverride);
  if (search === null) return false;
  return new URLSearchParams(search).get('demo') === '1';
}

/**
 * True whenever a dev/web preview (buyer or seller) is active and the demo
 * dataset was NOT explicitly requested — i.e. the default, zero-everything,
 * first-run state. This is the flag seller (and buyer) screens should check
 * before rendering any seeded/sample record.
 */
export function isPreviewFreshMode(searchOverride?: string): boolean {
  const inPreview = isSellerDevPreview(searchOverride) || isBuyerDevPreview(searchOverride);
  return inPreview && !isPreviewDemoMode(searchOverride);
}

/**
 * Convenience: returns true only in the dev-web buyer preview context.
 * Complements isSellerDevPreview for completeness; used in tests.
 */
export function isBuyerDevPreview(searchOverride?: string): boolean {
  if (!__DEV__ && !NAVIGATION_ISOLATION_TEST) return false;
  if (Platform.OS !== 'web') return false;
  if (isProductionPreviewHost()) return false;
  if (typeof window === 'undefined') return false;
  if (__DEV__) return getDevWebPreviewRole(searchOverride) === 'buyer';
  const v = new URLSearchParams(searchOverride ?? window.location.search).get('bt_preview');
  if (v === 'buyer') return true;
  if (v === 'seller') return false;
  return persistedPreviewRole() === 'buyer';
}
