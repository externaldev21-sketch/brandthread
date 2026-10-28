/**
 * Pre-mounts a tab navigator's main tabs in the background, so the first tap
 * on each one is a plain "show the retained scene" — the same instant switch
 * a revisit already is (detachInactiveScreens={false} + freezeOnBlur) —
 * instead of paying the route's code load, first render and data load while
 * the user watches.
 *
 * Rendered from a Tabs navigator's `layout` prop (it needs that navigator's
 * own state/navigation, which its screens' hooks can't reach). After the
 * first paint, one tab per idle slot: wait for its route code (a split chunk
 * on web), then dispatch React Navigation's PRELOAD, which renders it hidden
 * and unfocused. No focus events fire for a preloaded scene, so focus-gated
 * work (mark-as-read, badges, polling, video playback) still waits for a real
 * visit; screens fetch their data while preloaded via usePreloadedSceneEffect.
 *
 * Tabs already visited (or focused) are skipped: PRELOAD on a retained scene
 * would only unfreeze it. Navigation history is untouched (TabRouter keeps
 * `history` as is for a PRELOAD), so backBehavior="history" is unaffected.
 */
import { useEffect, useRef } from 'react';
import type { ParamListBase, TabNavigationState } from '@react-navigation/native';
import { runAfterFirstPaint } from '@/lib/deferStartup';
import { prefetchRouteCode } from '@/lib/navigation/routeWarmup';
import { isUserInteracting } from '@/lib/navigation/inputActivity';

type Navigation = {
  dispatch(action: { type: 'PRELOAD'; payload: { name: string }; target?: string }): void;
};

type Props = {
  state: TabNavigationState<ParamListBase>;
  navigation: Navigation;
  /** Route group prefix used for code warmup, e.g. '/(tabs)' or '/(buyer)'. */
  group: string;
  /** Route names to pre-mount, most likely first. */
  routes: readonly string[];
  enabled?: boolean;
};

/** Gap after one scene mounts before the next starts, so a tap that lands
 *  mid-preload never queues behind a chain of back-to-back mounts. */
const BETWEEN_SCENES_MS = 350;

export function needsPreload(state: TabNavigationState<ParamListBase>, name: string): boolean {
  const index = state.routes.findIndex((route) => route.name === name);
  if (index === -1 || index === state.index) return false;
  const key = state.routes[index].key;
  if (state.preloadedRouteKeys.includes(key)) return false;
  return !state.history.some((entry) => 'key' in entry && entry.key === key);
}

/**
 * Tab bar press-in: the finger lands ~100–200ms before onPress, so start
 * loading the tab's route code now if the background queue hasn't reached
 * it yet. Code only — mounting the scene here would block the main thread
 * mid-press (long enough, in a dev build, for the press to read as a hold).
 */
export function warmTabOnPressIn(state: TabNavigationState<ParamListBase>, group: string, name: string): void {
  if (needsPreload(state, name)) void prefetchRouteCode(`${group}/${name}`);
}

function whenIdle(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(task, { timeout: 1500 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(task, 120);
  return () => clearTimeout(id);
}

export function TabScenePreloader({ state, navigation, group, routes, enabled = true }: Props) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const routesKey = routes.join(',');

  useEffect(() => {
    if (!enabled) return;
    const queue = routesKey.split(',').filter(Boolean);
    let cancelled = false;
    let cancelStep = () => {};
    const step = () => {
      if (cancelled) return;
      const name = queue.shift();
      if (!name) return;
      if (!needsPreload(stateRef.current, name)) { step(); return; }
      void prefetchRouteCode(`${group}/${name}`).then(() => {
        if (cancelled) return;
        const mount = () => {
          if (cancelled) return;
          // Never mount mid-press: retry once the user's hands are off.
          if (isUserInteracting()) {
            const retry = setTimeout(() => { cancelStep = whenIdle(mount); }, 300);
            cancelStep = () => clearTimeout(retry);
            return;
          }
          const current = stateRef.current;
          if (needsPreload(current, name)) {
            navigationRef.current.dispatch({ type: 'PRELOAD', payload: { name }, target: current.key });
          }
          const timer = setTimeout(step, BETWEEN_SCENES_MS);
          cancelStep = () => clearTimeout(timer);
        };
        cancelStep = whenIdle(mount);
      });
    };
    const cancelPaint = runAfterFirstPaint(step);
    return () => { cancelled = true; cancelPaint(); cancelStep(); };
  }, [enabled, group, routesKey]);

  return null;
}
