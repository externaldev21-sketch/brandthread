/**
 * One-shot "the next push has no transition" override.
 *
 * Expo Router (React Navigation's native-stack underneath) has no per-call
 * way to pass `animation: 'none'` to `router.push()` itself — `animation` is
 * only ever a `Stack.Screen`'s own `options`, static per route. The seller
 * Studio card carousel (components/SellerStudioRadialMenu.tsx) needs exactly
 * one thing this can't natively do: release-to-select must open the landed-
 * on card's screen with NO slide, for every one of its destinations, even
 * though most of those destinations also get a normal animated push from
 * everywhere else in the app (e.g. tapping "Payouts" from the dashboard
 * still wants its usual slide-in).
 *
 * This is that plumbing: call `setNextPushAnimationNone()` synchronously,
 * immediately before `router.push(...)`, then have the destination's own
 * `Stack.Screen` read `consumeAnimationOverride(itsUsualAnimation)` in a
 * FUNCTION `options` (not a static object) so it's re-evaluated on every
 * navigation rather than once at mount. The override is consumed (cleared)
 * the moment it's read, so it only ever affects the very next push — a
 * completely unrelated navigation to the same screen seconds later reads
 * `null` and falls back to that screen's usual animation, unaffected.
 *
 * Deliberately a plain module-level variable, not a shared value or React
 * state: this needs to be read synchronously during React Navigation's own
 * (JS-thread, not UI-thread) route-options resolution, which happens
 * between the `setNextPushAnimationNone()` call and the screen actually
 * mounting — no render is involved on either end.
 */
let pendingOverride: 'none' | null = null;

export function setNextPushAnimationNone(): void {
  pendingOverride = 'none';
}

/** Reads and clears the pending override. `fallback` is the destination's
 *  own normal animation, used whenever no override is pending. */
export function consumeAnimationOverride<T>(fallback: T): T | 'none' {
  if (pendingOverride === 'none') {
    pendingOverride = null;
    return 'none';
  }
  return fallback;
}
