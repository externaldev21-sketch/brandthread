/**
 * Single source of truth for "is this a production native build?".
 *
 * Policy (docs/review-readiness/prod-hygiene.md):
 *   - Production NATIVE release (`!__DEV__` on iOS/Android): every dev/test
 *     affordance is OFF and, because each flag below is a literal-foldable
 *     expression of `__DEV__` / `Platform.OS` / an inlined EXPO_PUBLIC_* var,
 *     Metro's minifier drops the guarded branches from the bundle.
 *   - Dev builds and the web preview (`__DEV__`, or a web export built with
 *     EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST=1 for screenshots/e2e): allowed.
 *     The web preview is additionally refused on the real production hosts by
 *     isProductionPreviewHost() in lib/devPreview.ts.
 *
 * The env vars below may ONLY be read in this file. The vitest guard
 * tests/prod-gate-guard.test.ts fails CI if they are referenced elsewhere.
 */
// process.env.EXPO_OS ('ios' | 'android' | 'web') is inlined per-platform by
// babel-preset-expo, so these fold to literals and Metro drops dead branches.
// It is undefined outside Metro (vitest), which counts as not-native.
const EXPO_OS = process.env.EXPO_OS;

export const IS_WEB = EXPO_OS === 'web';

/** True only in a release build running on a device (not dev, not web). */
export const IS_PROD_NATIVE = !__DEV__ && !!EXPO_OS && EXPO_OS !== 'web';

/**
 * Web export used by the screenshot harness / e2e (production-like, __DEV__
 * false). Hard-false in a production native build even if the env var leaked.
 */
export const NAVIGATION_ISOLATION_TEST =
  !IS_PROD_NATIVE && process.env.EXPO_PUBLIC_NAVIGATION_ISOLATION_TEST === '1';

/** Dev build or the test/preview web export: preview bypass, test hooks allowed. */
export const ALLOW_DEV_TOOLS = __DEV__ || NAVIGATION_ISOLATION_TEST;

/** Client-side companion of the server test-subscription override. Dev only. */
export const ENABLE_TEST_SUBSCRIPTION_BYPASS =
  __DEV__ && process.env.EXPO_PUBLIC_ENABLE_TEST_SUBSCRIPTION_BYPASS === 'true';

/** RevenueCat sandbox key: dev builds only, never read in a release build. */
export const REVENUECAT_TEST_API_KEY: string | undefined = __DEV__
  ? process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY
  : undefined;

/**
 * Client-side Growth-plan UI bypass (lock/upsell badges only; the server is the
 * real gate). Dev builds, or an explicit =1 in a non-production-native build.
 */
export const GROWTH_UI_BYPASS =
  __DEV__ || (!IS_PROD_NATIVE && process.env.EXPO_PUBLIC_BT_GROWTH_BYPASS === '1');
