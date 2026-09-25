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

function logIfDone(entry: RoutePerfEntry) {
  if (entry.firstRenderMs === null) return;
  // eslint-disable-next-line no-console
  console.log(
    `[perf] ${entry.route} firstRender=${entry.firstRenderMs}ms` +
      (entry.dataMs !== null ? ` data=${entry.dataMs}ms` : ' data=(no query cache activity)'),
  );
}

/** Recent route timings, newest last — used by the in-app perf overlay and
 *  by the Playwright harness (scripts/perf-harness.mjs) when it reads
 *  console output. */
export function getRecentRoutePerf(): readonly RoutePerfEntry[] {
  return recent;
}
