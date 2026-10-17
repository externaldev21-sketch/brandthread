import { PERF_MARKS } from '@/lib/buildFlags';

export interface NavigationTiming {
  route: string;
  inputToFrameMs: number | null;
  dispatchToFrameMs: number | null;
  commitToFrameMs: number;
  missedJsFrameIntervals: number;
  worstJsFrameMs: number;
}

type TraceState = { index?: number; routes: readonly { key?: string; state?: unknown }[] };
export function focusedNavigationKey(state: unknown): string {
  let node = state as TraceState | undefined;
  let key = '';
  // Only the active branch, not JSON.stringify(whole navigation state).
  for (let depth = 0; node && depth < 20; depth++) {
    const route = node.routes?.[node.index ?? 0];
    if (!route) break;
    key += `${route.key ?? ''}/`;
    node = route.state as TraceState | undefined;
  }
  return key;
}

/** JS scheduling evidence, NOT native compositor/device-frame measurements.
 * Fixed-size records contain route patterns only, never params/account IDs. */
export function createNavigationTrace(now: () => number, limit = 100) {
  const entries: NavigationTiming[] = [];
  let input: number | null = null;
  let dispatch: number | null = null;
  let last: number | null = null;
  let missed = 0;
  let worst = 0;
  let generation = 0;
  return {
    entries,
    input() { input = now(); dispatch = null; last = input; missed = 0; worst = 0; generation++; },
    dispatch() { dispatch = now(); last ??= dispatch; generation++; },
    frame() {
      const at = now();
      if (last !== null) {
        const gap = Math.max(0, at - last);
        worst = Math.max(worst, gap);
        missed += Math.max(0, Math.round(gap / (1000 / 60)) - 1);
      }
      last = at;
    },
    commit(route: string) {
      const at = now(), token = generation;
      // A stale touch (scroll, keyboard, etc.) is not a navigation input.
      const touch = input !== null && at - input <= 2000 ? input : null;
      const requested = dispatch !== null && at - dispatch <= 8000 ? dispatch : null;
      return () => {
        if (token !== generation) return; // Superseded navigation.
        const end = now();
        entries.push({
          route,
          inputToFrameMs: touch === null ? null : Math.max(0, end - touch),
          dispatchToFrameMs: requested === null ? null : Math.max(0, end - requested),
          commitToFrameMs: Math.max(0, end - at),
          missedJsFrameIntervals: missed, worstJsFrameMs: worst,
        });
        if (entries.length > limit) entries.splice(0, entries.length - limit);
        input = dispatch = last = null;
        missed = worst = 0;
      };
    },
    clear() { entries.length = 0; input = dispatch = last = null; missed = worst = 0; generation++; },
  };
}

const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
const trace = createNavigationTrace(clock);
let raf: ReturnType<typeof requestAnimationFrame> | null = null;
let expires = 0;
function sample() {
  trace.frame();
  raf = clock() < expires ? requestAnimationFrame(sample) : null;
}
function startSampling() {
  expires = clock() + 2000;
  if (raf === null) raf = requestAnimationFrame(sample);
}
export function markNavigationInput() {
  if (!PERF_MARKS || typeof requestAnimationFrame === 'undefined') return;
  trace.input();
  startSampling();
}
export function markNavigationDispatch() {
  if (!PERF_MARKS || typeof requestAnimationFrame === 'undefined') return;
  trace.dispatch();
  startSampling();
}
export function markNavigationCommit(route: string): () => void {
  if (!PERF_MARKS || typeof requestAnimationFrame === 'undefined') return () => {};
  const finish = trace.commit(route);
  let cancelled = false;
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(() => {
      if (cancelled) return;
      trace.frame();
      finish();
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    });
  });
  let second: ReturnType<typeof requestAnimationFrame> | null = null;
  return () => {
    cancelled = true;
    cancelAnimationFrame(first);
    if (second !== null) cancelAnimationFrame(second);
  };
}
if (PERF_MARKS) {
  Object.assign(globalThis, {
    __btNavigationTrace: {
      // Release/Hermes test builds can read this without a development overlay.
      engine: (globalThis as { HermesInternal?: unknown }).HermesInternal ? 'Hermes' : 'non-Hermes',
      metric: 'JS-observed input/dispatch → second route-commit frame; not compositor timing',
      entries: trace.entries,
      clear: () => trace.clear(),
    },
  });
}
