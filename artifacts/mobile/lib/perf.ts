/**
 * Dev-only route performance harness.
 *
 * Wired once at the navigation root (see RootLayoutNav in app/_layout.tsx),
 * so every route gets timed automatically — no per-screen instrumentation
 * needed. Two numbers are logged per navigation:
 *
 *  - firstRenderMs: time from the pathname changing to the next JS frame
 *    committing (a proxy for "the new screen painted something", including
 *    a skeleton).
 *  - dataMs: time from the pathname changing to the first query cache
 *    success that lands afterward (a proxy for "real data is on screen").
 *    Screens that don't use the query cache won't report a dataMs — that's
 *    itself a signal that they're a migration candidate.
 *
 * Everything here is a no-op in production builds.
 */
import type { QueryClient } from '@tanstack/react-query';

export interface RoutePerfEntry {
  route: string;
  firstRenderMs: number | null;
  dataMs: number | null;
  startedAt: number;
}

const recent: RoutePerfEntry[] = [];
const MAX_RECENT = 50;
const perfListeners = new Set<() => void>();

/**
 * Per-screen budgets (speed polish #25), keyed by expo-router pathname (the
 * buyer and seller home tabs are both '/'). `firstRenderMs` is the tap-to-
 * first-frame budget; `dataMs` is the time-to-interactive budget (real data
 * on screen). Any navigation over budget logs a `[perf] over budget` warning
 * in dev and shows in the perf overlay, so a regression is visible the day it
 * lands instead of after users feel it.
 */
export interface PerfBudget { firstRenderMs: number; dataMs: number }
export const DEFAULT_PERF_BUDGET: PerfBudget = { firstRenderMs: 150, dataMs: 1000 };
export const TAB_PERF_BUDGETS: Readonly<Record<string, PerfBudget>> = {
  '/': { firstRenderMs: 100, dataMs: 1000 },
  '/feed': { firstRenderMs: 100, dataMs: 1000 },
  '/discover': { firstRenderMs: 100, dataMs: 1200 },
  '/inbox': { firstRenderMs: 100, dataMs: 800 },
  '/profile': { firstRenderMs: 100, dataMs: 800 },
  '/products': { firstRenderMs: 100, dataMs: 800 },
  '/orders': { firstRenderMs: 100, dataMs: 800 },
};

export function budgetFor(route: string): PerfBudget {
  return TAB_PERF_BUDGETS[route] ?? DEFAULT_PERF_BUDGET;
}

/** Which measured numbers went over this route's budget (empty = within budget). */
export function overBudget(entry: Pick<RoutePerfEntry, 'route' | 'firstRenderMs' | 'dataMs'>): Array<'firstRender' | 'data'> {
  const budget = budgetFor(entry.route);
  const over: Array<'firstRender' | 'data'> = [];
  if (entry.firstRenderMs !== null && entry.firstRenderMs > budget.firstRenderMs) over.push('firstRender');
  if (entry.dataMs !== null && entry.dataMs > budget.dataMs) over.push('data');
  return over;
}

/** Dev perf overlay subscribes here to repaint when a new timing lands. */
export function subscribeRoutePerf(listener: () => void): () => void {
  perfListeners.add(listener);
  return () => { perfListeners.delete(listener); };
}

let unsubscribeQueryCache: (() => void) | null = null;
let pendingRoute: { route: string; startedAt: number; dataLogged: boolean } | null = null;

function pushEntry(entry: RoutePerfEntry) {
  recent.push(entry);
  if (recent.length > MAX_RECENT) recent.shift();
}

/** Call whenever the active pathname changes. Marks the start of a
 *  navigation and schedules the first-render measurement. */
export function recordNavigationStart(route: string, queryClient?: QueryClient): void {
  if (!__DEV__) return;
  const startedAt = Date.now();
  const entry: RoutePerfEntry = { route, firstRenderMs: null, dataMs: null, startedAt };
  pushEntry(entry);
  pendingRoute = { route, startedAt, dataLogged: false };

  // requestAnimationFrame fires after the next commit, which approximates
  // "the new screen has painted something" (even if it's just a skeleton).
  requestAnimationFrame(() => {
    entry.firstRenderMs = Date.now() - startedAt;
    logIfDone(entry);
  });

  if (queryClient && !unsubscribeQueryCache) {
    unsubscribeQueryCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      if (!pendingRoute || pendingRoute.dataLogged) return;
      const matching = recent.find((e) => e.route === pendingRoute!.route && e.startedAt === pendingRoute!.startedAt);
      if (!matching || matching.dataMs !== null) return;
      matching.dataMs = Date.now() - pendingRoute.startedAt;
      pendingRoute.dataLogged = true;
      logIfDone(matching);
    });
  }
}

/** Immutable copy of the newest entry, replaced on every update, so React
 *  (and the React Compiler's memoization) sees a new value each time. */
let latestSnapshot: RoutePerfEntry | null = null;

/** Newest route timing as an immutable snapshot (for useSyncExternalStore). */
export function getLatestRoutePerf(): RoutePerfEntry | null {
  return latestSnapshot;
}

function logIfDone(entry: RoutePerfEntry) {
  if (recent[recent.length - 1] === entry) {
    latestSnapshot = { ...entry };
    perfListeners.forEach((l) => l());
  }
  if (entry.firstRenderMs === null) return;
  // eslint-disable-next-line no-console
  console.log(
    `[perf] ${entry.route} firstRender=${entry.firstRenderMs}ms` +
      (entry.dataMs !== null ? ` data=${entry.dataMs}ms` : ' data=(no query cache activity)'),
  );
  const over = overBudget(entry);
  if (over.length > 0) {
    const budget = budgetFor(entry.route);
    console.warn(
      `[perf] over budget on ${entry.route}: ` +
        over.map((k) => (k === 'firstRender'
          ? `firstRender ${entry.firstRenderMs}ms > ${budget.firstRenderMs}ms`
          : `data ${entry.dataMs}ms > ${budget.dataMs}ms`)).join(', '),
    );
  }
}

/** Recent route timings, newest last — used by the in-app perf overlay and
 *  by the Playwright harness (scripts/perf-harness.mjs) when it reads
 *  console output. */
export function getRecentRoutePerf(): readonly RoutePerfEntry[] {
  return recent;
}

/**
 * Cross-platform `performance.mark`. Web's `performance` (with `.mark`) is
 * what Chrome DevTools' Performance panel and `performance.getEntriesByType
 * ('mark')` read from, which is how first-paint timing is measured/verified
 * for the feed's black-screen fix (see docs in app/(tabs)/feed.tsx around
 * `bt-first-poster-painted`). React Native's own `global.performance` on
 * native doesn't reliably implement `.mark` (no User Timing API), so this is
 * a no-op there rather than throwing — same "dev/web tooling only, never
 * breaks native" spirit as the rest of this file, minus the `__DEV__` gate
 * since this timing is also useful to check against a production build.
 */
export function mark(name: string): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      performance.mark(name);
    }
  } catch {
    // Never let a timing mark break the app it's measuring.
  }
}
