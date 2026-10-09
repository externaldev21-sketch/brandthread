/**
 * Seller-setup origin plumbing. The generic origin helpers now live in
 * lib/navigation/flowOrigin.ts (`withOrigin` / `leaveFlow`); this module keeps
 * the setup-specific names the checklist destinations use.
 */
import { leaveFlow, readOrigin, withOrigin, type FlowOrigin } from '@/lib/navigation/flowOrigin';
import type { BackCapableRouter } from '@/lib/navigation/goBackOr';

/** Legacy origin value; still accepted on inbound links. */
export const SELLER_SETUP_ORIGIN = 'seller-setup';
/**
 * Seller root — used ONLY as the last-resort fallback when a setup
 * destination has no history to pop AND no explicit origin (cold deep link).
 * Never navigate here from a Back/Cancel/X while history exists.
 */
export const SELLER_HOME_ROUTE = '/(tabs)/';

/** Origins that mean "this screen was opened as a seller-setup task". */
const SETUP_ORIGINS: ReadonlySet<FlowOrigin> = new Set<FlowOrigin>(['seller-setup', 'dashboard', 'setup']);

/** @deprecated prefer `withOrigin(route, 'dashboard' | 'setup')` so the exit lands on the real origin. */
export function withSellerSetupOrigin(route: string): string {
  return withOrigin(route, SELLER_SETUP_ORIGIN);
}

/** True when the screen was opened as a setup task (from the dashboard, the
 *  setup checklist, or an old `seller-setup` link). Affects completion copy
 *  ("Done" vs "Continue editing"), never the exit route — see leaveSetupFlow. */
export function isSellerSetupOrigin(value: string | string[] | undefined): boolean {
  const origin = readOrigin(value);
  return origin !== null && SETUP_ORIGINS.has(origin);
}

/**
 * Exit for every setup destination: pop to the exact screen underneath
 * (dashboard, setup checklist, products tab…); with no history, go to the
 * explicit `from` origin; only with neither, to `fallback`.
 */
export function leaveSetupFlow(
  router: BackCapableRouter,
  from: string | string[] | undefined,
  fallback: string = SELLER_HOME_ROUTE,
): void {
  leaveFlow(router, from, fallback as never);
}
