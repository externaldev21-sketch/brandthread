/**
 * Pure rule helpers for the <FirstRunTip> system — kept dependency-free
 * (no RN UI imports) so they're directly unit-testable.
 */

/**
 * Screens that are part of the auth / onboarding flow — a first-run tip must
 * never show here regardless of tip content, since there's no "account" yet
 * for a per-account tip to be scoped to (or the account is mid-setup).
 * Matched against the route's pathname (expo-router's usePathname()).
 */
const AUTH_FLOW_PATH_FRAGMENTS = [
  'sign-in',
  'sign-up',
  'onboarding',
  'account-type', // app/account-type.tsx — role selection during onboarding
  'manufacturer-onboard',
];

export function isAuthFlowRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const lower = pathname.toLowerCase();
  // Never treat the settings-only "account-type-settings" screen as part of
  // onboarding even though it shares the "account-type" fragment.
  if (lower.includes('account-type-settings')) return false;
  return AUTH_FLOW_PATH_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/**
 * Dev's own preview/testing override: `?bt_preview=...&tips=1`. Only ever
 * meaningful inside a dev/web preview session (see lib/devPreview.ts) — when
 * present, every tip is treated as unseen so Dev can preview them repeatedly
 * without resetting state. Absent (the default), tips behave normally, and
 * a signed-out preview with no `tips=1` never shows tips at all.
 */
const TIPS_FORCE_STORAGE_KEY = 'bt_preview_tips_force';

/**
 * `&tips=1` only has to be present on the FIRST page load — like
 * `bt_preview`/`demo` in lib/devPreview.ts, in-app client-side navigation
 * (tapping a tab, `router.push()` to a plain path) drops query params
 * without a full reload, so this mirrors the flag into localStorage the
 * first time it's seen and falls back to that once the param itself is
 * gone, instead of silently going inert after the first navigation.
 */
export function isFirstRunTipsPreviewForceShow(searchOverride?: string): boolean {
  const search = searchOverride ?? (typeof window === 'undefined' ? null : window.location.search);
  if (search !== null) {
    const v = new URLSearchParams(search).get('tips');
    if (v === '1') {
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(TIPS_FORCE_STORAGE_KEY, '1'); } catch {}
      return true;
    }
  }
  if (searchOverride !== undefined) return false; // tests: no implicit localStorage fallback
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(TIPS_FORCE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * True when the signed-out/dev web preview (`?bt_preview=buyer|seller`) is
 * active WITHOUT the `&tips=1` override — Dev's rule is that tips never show
 * in the plain preview at all (not even as a "fresh account" demo), only
 * when he's explicitly testing them via `&tips=1`. Takes the preview-role
 * detector as a parameter (rather than importing lib/devPreview directly)
 * so this module stays dependency-free and unit-testable.
 */
export function isPreviewWithoutTipsForce(inPreview: boolean, searchOverride?: string): boolean {
  return inPreview && !isFirstRunTipsPreviewForceShow(searchOverride);
}
