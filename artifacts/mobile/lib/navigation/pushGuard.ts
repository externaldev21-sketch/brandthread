/**
 * Double-tap guard for forward navigation (polish #51).
 *
 * A fast double tap on a row, card or button fires its onPress twice, and
 * each call pushes the same screen — the user then has to tap back twice to
 * get out. Rather than wrapping 700 call sites, the guard is installed once
 * on expo-router's singleton `router` (the same object `useRouter()`
 * returns) and drops a `push` / `navigate` to the *same* href that arrives
 * within `windowMs` of the previous one.
 *
 * Deliberately narrow:
 *   - only identical hrefs are dropped, so a push followed by a different
 *     push (e.g. a flow that chains screens) always goes through;
 *   - `back`, `replace`, `dismiss*` and `setParams` are never touched, so
 *     programmatic multi-step back navigation keeps working.
 */
export const PUSH_GUARD_WINDOW_MS = 600;

type Clock = () => number;

/** Stable key for an expo-router Href (string or { pathname, params }). */
export function hrefKey(href: unknown): string {
  if (typeof href === 'string') return href;
  if (href && typeof href === 'object') {
    const { pathname, params } = href as { pathname?: unknown; params?: Record<string, unknown> };
    const sorted = params
      ? Object.keys(params).sort().map((k) => `${k}=${String(params[k])}`).join('&')
      : '';
    return `${String(pathname ?? '')}?${sorted}`;
  }
  return String(href);
}

export function createPushGuard(windowMs = PUSH_GUARD_WINDOW_MS, now: Clock = Date.now) {
  let lastKey: string | null = null;
  let lastAt = -Infinity;
  /** True when this navigation should go through; false when it's a repeat. */
  return function allow(href: unknown): boolean {
    const key = hrefKey(href);
    const t = now();
    if (key === lastKey && t - lastAt < windowMs) return false;
    lastKey = key;
    lastAt = t;
    return true;
  };
}

type NavFn = (href: never, ...rest: never[]) => unknown;
interface GuardableRouter {
  push: NavFn;
  navigate: NavFn;
}

const INSTALLED = Symbol.for('brandthread.pushGuard');

/** Patch `router.push` / `router.navigate` once. Safe to call repeatedly. */
export function installPushGuard(router: GuardableRouter | undefined, allow = createPushGuard()): void {
  if (!router) return;
  const r = router as GuardableRouter & { [INSTALLED]?: true };
  if (r[INSTALLED]) return;
  r[INSTALLED] = true;
  for (const method of ['push', 'navigate'] as const) {
    const original = r[method];
    if (typeof original !== 'function') continue;
    r[method] = ((href: never, ...rest: never[]) => {
      if (!allow(href)) return undefined;
      return original.call(router, href, ...rest);
    }) as NavFn;
  }
}
