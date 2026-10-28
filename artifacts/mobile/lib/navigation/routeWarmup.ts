type Role = 'buyer' | 'seller' | null;
type Schedule = (task: () => void) => () => void;

/**
 * Routes whose code is loaded in the background after the first paint, in
 * order: the role's own tab screens first (most likely next tap), then the
 * top stack screens reachable from them. On web every route is its own
 * split chunk (app.json `asyncRoutes.web`), and an unloaded chunk means the
 * first visit suspends — a blank scene (or Expo's "Bundling…" toast in dev)
 * for as long as the chunk takes to fetch and evaluate. Once a chunk is in
 * the module registry, expo-router resolves the route synchronously and the
 * first visit renders on the tap frame (expo/src/async-require).
 */
export const LIKELY_ROUTES = {
  buyer: [
    '/(buyer)/discover', '/(buyer)/inbox', '/(buyer)/activity', '/(buyer)/profile', '/(buyer)/index',
    '/(buyer)/cart', '/(buyer)/orders', '/(buyer)/friends', '/(buyer)/edit-profile',
    '/buyer-product-detail', '/buyer-post-viewer', '/seller-profile', '/buyer-conversation',
    '/buyer-search', '/buyer-other-profile', '/buyer-order-detail', '/buyer-post-comments',
    '/buyer-checkout',
  ],
  seller: [
    '/(tabs)/products', '/(tabs)/orders', '/(tabs)/profile', '/(tabs)/index', '/(tabs)/analytics',
    '/(tabs)/more', '/(tabs)/studio', '/(tabs)/marketing',
    '/order-detail', '/product-detail', '/add-product', '/seller-settings', '/edit-profile',
    '/analytics-sales', '/customers', '/subscription', '/create-post', '/activity-center',
  ],
} as const;

type LikelyRoute = (typeof LIKELY_ROUTES)[keyof typeof LIKELY_ROUTES][number];

// Static import() calls so Metro knows each target; each resolves to the same
// module (and web chunk) expo-router's route loader requests.
const loaders: Record<LikelyRoute, () => Promise<unknown>> = {
  '/(buyer)/discover': () => import('../../app/(buyer)/discover'),
  '/(buyer)/inbox': () => import('../../app/(buyer)/inbox'),
  '/(buyer)/activity': () => import('../../app/(buyer)/activity'),
  '/(buyer)/profile': () => import('../../app/(buyer)/profile'),
  '/(buyer)/index': () => import('../../app/(buyer)/index'),
  '/(buyer)/cart': () => import('../../app/(buyer)/cart'),
  '/(buyer)/orders': () => import('../../app/(buyer)/orders'),
  '/(buyer)/friends': () => import('../../app/(buyer)/friends'),
  '/(buyer)/edit-profile': () => import('../../app/(buyer)/edit-profile'),
  '/buyer-product-detail': () => import('../../app/buyer-product-detail'),
  '/buyer-post-viewer': () => import('../../app/buyer-post-viewer'),
  '/seller-profile': () => import('../../app/seller-profile'),
  '/buyer-conversation': () => import('../../app/buyer-conversation'),
  '/buyer-search': () => import('../../app/buyer-search'),
  '/buyer-other-profile': () => import('../../app/buyer-other-profile'),
  '/buyer-order-detail': () => import('../../app/buyer-order-detail'),
  '/buyer-post-comments': () => import('../../app/buyer-post-comments'),
  '/buyer-checkout': () => import('../../app/buyer-checkout'),
  '/(tabs)/products': () => import('../../app/(tabs)/products'),
  '/(tabs)/orders': () => import('../../app/(tabs)/orders'),
  '/(tabs)/profile': () => import('../../app/(tabs)/profile'),
  '/(tabs)/index': () => import('../../app/(tabs)/index'),
  '/(tabs)/analytics': () => import('../../app/(tabs)/analytics'),
  '/(tabs)/more': () => import('../../app/(tabs)/more'),
  '/(tabs)/studio': () => import('../../app/(tabs)/studio'),
  '/(tabs)/marketing': () => import('../../app/(tabs)/marketing'),
  '/order-detail': () => import('../../app/order-detail'),
  '/product-detail': () => import('../../app/product-detail'),
  '/add-product': () => import('../../app/add-product'),
  '/seller-settings': () => import('../../app/seller-settings'),
  '/edit-profile': () => import('../../app/edit-profile'),
  '/analytics-sales': () => import('../../app/analytics-sales'),
  '/customers': () => import('../../app/customers'),
  '/subscription': () => import('../../app/subscription'),
  '/create-post': () => import('../../app/create-post'),
  '/activity-center': () => import('../../app/activity-center'),
};

/** Load code only: router.prefetch also mounts scenes and can start effects,
 * permission prompts or extra providers before the user visits the tab
 * (tab scenes are pre-mounted separately, see components/navigation/TabScenePreloader). */
export function prefetchRouteCode(route: string): Promise<void> {
  const load = loaders[route as LikelyRoute];
  if (!load) return Promise.resolve();
  return load().then(() => undefined, () => {
    // Speculative offline misses must not block real navigation, which retries
    // the normal route loader and retains its normal error UI.
  });
}

function idle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    let id = 0;
    const run = (deadline: IdleDeadline) => {
      // Don't force code evaluation into an already busy navigation frame —
      // wait for a roomier idle period instead (dropping the task here
      // stalled the whole queue for the rest of the session).
      if (deadline.timeRemaining() >= 8 || deadline.didTimeout) task();
      else id = requestIdleCallback(run, { timeout: 2000 });
    };
    id = requestIdleCallback(run, { timeout: 2000 });
    return () => cancelIdleCallback(id);
  }
  // Background warming only; no tap/navigation ever awaits this timer.
  const id = setTimeout(task, 250);
  return () => clearTimeout(id);
}

/** The role's tabs, then its top stack screens: one route per idle slot,
 * each started only after the previous chunk finished loading so the
 * warmup never floods the network or the dev bundler. Cancellable on
 * account/role change. Rare charts, AI and maps are deliberately not warmed. */
export function scheduleRouteWarmup(
  prefetch: (route: string) => unknown,
  role: Role,
  schedule: Schedule = idle,
): () => void {
  const routes: string[] = role ? [...LIKELY_ROUTES[role]] : [];
  let cancelled = false;
  let cancelPending = () => {};
  const next = () => {
    if (cancelled || routes.length === 0) return;
    cancelPending = schedule(() => {
      if (cancelled) return;
      const route = routes.shift();
      const pending = route ? prefetch(route) : undefined;
      if (pending instanceof Promise) void pending.then(next, next);
      else next();
    });
  };
  next();
  return () => { cancelled = true; cancelPending(); };
}
