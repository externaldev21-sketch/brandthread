/**
 * Safe back navigation for expo-router.
 *
 * `router.back()` throws the (visible, red) "GO_BACK was not handled by any
 * navigator" error whenever there is no history to pop — e.g. when a screen
 * is the first one in the stack, or it was reached via `router.replace()`
 * (which drops history). That happens for real users whenever a screen can
 * be a deep-link entry point or a `replace()` destination, not just in
 * edge-case testing.
 *
 * Use this everywhere a back control calls `router.back()` directly:
 *   onPress={() => goBackOr(router, '/welcome')}
 *
 * It pops the stack when there is history to pop, and otherwise replaces to
 * `fallback` so the user always lands somewhere real instead of seeing an
 * error toast.
 */
import type { Href } from 'expo-router';

export interface BackCapableRouter {
  canGoBack: () => boolean;
  back: () => void;
  replace: (href: Href) => void;
}

export function goBackOr(router: BackCapableRouter, fallback: Href = '/'): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}
