/**
 * Explicit "where did this flow open from" plumbing.
 *
 * Rule (docs/NAVIGATION.md): Back / Cancel / X / Discard / swipe-back always
 * return the user to the exact screen (and tab) they came from. In practice:
 *
 *   1. Pop history when there is any (`router.back()`), which lands on the
 *      exact scene underneath — same tab, same scroll position.
 *   2. Only when there is NO history (cold deep link, or a screen that was
 *      reached with `router.replace`) fall back to a route — and that route
 *      must be the originating screen, passed explicitly as `?from=<origin>`,
 *      never a generic tabs index or the Studio menu.
 *
 * Entry points call `withOrigin(route, 'dashboard')` and PUSH (never replace)
 * so the origin scene stays underneath; exits call `leaveFlow(router,
 * params.from, <last-resort route>)`.
 */
import type { Href } from 'expo-router';
import type { BackCapableRouter } from './goBackOr';

export type FlowOrigin =
  | 'dashboard'
  | 'products'
  | 'orders'
  | 'profile'
  | 'setup'
  | 'studio'
  /** Legacy value still accepted for old links — resolves to the dashboard. */
  | 'seller-setup';

/** Route each origin resolves to when there is no history to pop. */
export const ORIGIN_ROUTES: Record<FlowOrigin, string> = {
  dashboard: '/(tabs)/',
  'seller-setup': '/(tabs)/',
  products: '/(tabs)/products',
  orders: '/(tabs)/orders',
  profile: '/(tabs)/profile',
  setup: '/setup',
  // The Studio menu is an overlay on whichever tab was active, so with no
  // history its best stand-in is the seller root (the menu re-opens itself
  // on a real pop — see lib/navigation/studioReturn.ts).
  studio: '/(tabs)/',
};

const ORIGIN_KEYS = new Set<string>(Object.keys(ORIGIN_ROUTES));

export function withOrigin(route: string, origin: FlowOrigin): string {
  const separator = route.includes('?') ? '&' : '?';
  return `${route}${separator}from=${origin}`;
}

export function readOrigin(from: string | string[] | undefined): FlowOrigin | null {
  const value = Array.isArray(from) ? from[0] : from;
  return typeof value === 'string' && ORIGIN_KEYS.has(value) ? (value as FlowOrigin) : null;
}

export function originRoute(from: string | string[] | undefined): string | null {
  const origin = readOrigin(from);
  return origin ? ORIGIN_ROUTES[origin] : null;
}

/**
 * Leave a flow: pop when possible, otherwise go to the explicit origin, and
 * only as a last resort to `fallback` (the screen's logical parent).
 */
export function leaveFlow(
  router: BackCapableRouter,
  from: string | string[] | undefined,
  fallback: Href,
): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace((originRoute(from) ?? fallback) as Href);
}
