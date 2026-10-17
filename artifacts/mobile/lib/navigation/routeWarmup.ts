type Role = 'buyer' | 'seller' | null;
type Schedule = (task: () => void) => () => void;
export const LIKELY_ROUTES = {
  buyer: ['/(buyer)/discover', '/(buyer)/inbox'],
  seller: ['/(tabs)/products', '/(tabs)/orders'],
} as const;

/** Load code only: router.prefetch also mounts scenes and can start effects,
 * permission prompts or extra providers before the user visits the tab. */
export function prefetchRouteCode(route: string): void {
  const loaders: Record<string, () => Promise<unknown>> = {
    '/(buyer)/discover': () => import('../../app/(buyer)/discover'),
    '/(buyer)/inbox': () => import('../../app/(buyer)/inbox'),
    '/(tabs)/products': () => import('../../app/(tabs)/products'),
    '/(tabs)/orders': () => import('../../app/(tabs)/orders'),
  };
  const load = loaders[route];
  if (load) void load().catch(() => {
    // Speculative offline misses must not block real navigation, which retries
    // the normal route loader and retains its normal error UI.
  });
}

function idle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(deadline => {
      // Don't force code evaluation into an already busy navigation frame.
      if (deadline.timeRemaining() >= 8) task();
    });
    return () => cancelIdleCallback(id);
  }
  // Background warming only; no tap/navigation ever awaits this timer.
  const id = setTimeout(task, 1500);
  return () => clearTimeout(id);
}

/** Two likely tabs only, one idle slot at a time, cancellable on account/role
 * change. Rare charts, studio, AI and maps are deliberately not warmed. */
export function scheduleRouteWarmup(prefetch: (route: string) => void, role: Role, schedule: Schedule = idle): () => void {
  const routes = role ? [...LIKELY_ROUTES[role]] : [];
  let cancelled = false;
  let cancelPending = () => {};
  const next = () => {
    if (cancelled || routes.length === 0) return;
    cancelPending = schedule(() => {
      if (cancelled) return;
      const route = routes.shift();
      if (route) prefetch(route);
      next();
    });
  };
  next();
  return () => { cancelled = true; cancelPending(); };
}
