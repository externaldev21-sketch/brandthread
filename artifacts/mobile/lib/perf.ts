/**
 * App performance marks.
 *
 * 1. Cold start — always recorded, once per process: process start (native,
 *    from React Native's startup timing) or navigation start (web) → the first
 *    screen that reports itself interactive via `useScreenInteractive`, with
 *    the root navigator painting as a fallback ("shell"). Sent to Sentry as a
 *    breadcrumb + `cold_start` context (numbers and a screen label only).
 * 2. Per-screen time-to-interactive — `useScreenInteractive(name, ready)` marks
 *    when a screen's first content is on screen and the interaction queue has
 *    settled. Recorded in perf builds only (PERF_MARKS, lib/buildFlags.ts).
 * 3. Feed frame drops — `FEED_FRAME_SAMPLER_PROPS`, a requestAnimationFrame
 *    delta counter that runs only while the list is scrolling. Perf builds only;
 *    in store builds it is an empty object and adds no props.
 * 4. Route timing (dev): firstRender/data per navigation, logged to the console.
 *
 * Everything is readable from `globalThis.__btPerf` in perf builds and on web,
 * which is how scripts/perf-harness.mjs reads the in-app numbers back.
 */
import { useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import type { QueryClient } from '@tanstack/react-query';
import { IS_WEB, PERF_MARKS } from '@/lib/buildFlags';
import { reportPerformance } from '@/lib/monitoringHooks';
import {
  createPerfRecord,
  nowMs,
  processStartMs,
  pushBounded,
  summarizeFrames,
  type FrameSample,
} from '@/lib/perfCore';

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

const record = createPerfRecord();
let jsStartedAt: number | null = null;
let lastNavigationAt: number | null = null;
/** A screen after this long since process start is no longer "the first screen". */
const COLD_START_WINDOW_MS = 30_000;
const FIRST_SCREEN_GRACE_MS = 2_000;

if (PERF_MARKS || IS_WEB) {
  try {
    (globalThis as { __btPerf?: typeof record }).__btPerf = record;
  } catch {
    // Read-only global object: the harness falls back to performance marks.
  }
}

function report(line: string): void {
  if (!PERF_MARKS) return;
  // A release native build strips console.info/log (babel.config.js keeps only
  // warn/error), so a perf release build reports on the warn channel, which
  // reaches Xcode's device console and `adb logcat`.
  if (__DEV__) console.info(`[perf] ${line}`);
  else console.warn(`[perf] ${line}`);
}

/** Called first thing by lib/bootstrap.ts: the earliest point app JS runs. */
export function markAppJsStart(): void {
  if (jsStartedAt !== null) return;
  jsStartedAt = nowMs();
  mark('bt-js-start');
}

function coldStartBase(): { start: number; fromProcess: boolean } {
  const processStart = processStartMs(IS_WEB);
  if (processStart !== null) return { start: processStart, fromProcess: true };
  return { start: jsStartedAt ?? 0, fromProcess: false };
}

function recordColdStart(screen: string, at: number): void {
  const { start, fromProcess } = coldStartBase();
  const js = jsStartedAt ?? start;
  record.coldStart = {
    processToInteractiveMs: fromProcess ? Math.round(at - start) : null,
    jsToInteractiveMs: Math.round(at - js),
    screen,
  };
  mark('bt-cold-start-interactive', at);
  reportPerformance('cold_start', {
    process_to_interactive_ms: record.coldStart.processToInteractiveMs,
    js_to_interactive_ms: record.coldStart.jsToInteractiveMs,
    screen,
  }, true);
  report(`cold start → ${screen} interactive: ` +
    `${record.coldStart.processToInteractiveMs ?? '?'}ms from process start, ` +
    `${record.coldStart.jsToInteractiveMs}ms from JS start`);
}

/**
 * The root navigator has painted and its first interactions settled. Becomes
 * the cold-start reading only if no screen reports itself interactive.
 */
export function recordShellInteractive(): void {
  if (record.shellInteractiveMs !== null) return;
  const at = nowMs();
  const { start } = coldStartBase();
  record.shellInteractiveMs = Math.round(at - start);
  if (!record.coldStart) recordColdStart('shell', at);
}

/**
 * Whether a screen mounted at `mountedAt` can still be the launch's first
 * screen: no screen has claimed the cold start yet, and it mounted with (or
 * right after) the root navigator — not later by navigating (e.g. after
 * sign-in).
 */
function canBeFirstScreen(mountedAt: number): boolean {
  if (record.screens.length > 0 || (record.coldStart && record.coldStart.screen !== 'shell')) return false;
  const { start } = coldStartBase();
  return record.shellInteractiveMs === null || mountedAt - start <= record.shellInteractiveMs + FIRST_SCREEN_GRACE_MS;
}

function recordScreenInteractive(screen: string, mountedAt: number, at: number): void {
  const { start } = coldStartBase();
  const isFirstScreen = canBeFirstScreen(mountedAt) && at - start < COLD_START_WINDOW_MS;
  if (isFirstScreen) recordColdStart(screen, at);
  if (!PERF_MARKS) return;
  // Measured from the navigation that opened the screen when there is one
  // (the screen may mount a little after it), else from mounting.
  const from = isFirstScreen
    ? start
    : lastNavigationAt !== null && lastNavigationAt <= mountedAt && mountedAt - lastNavigationAt < 5_000
      ? lastNavigationAt
      : mountedAt;
  const ms = Math.round(at - from);
  pushBounded(record.screens, { screen, ms, cold: isFirstScreen });
  mark(`bt-tti:${screen}`, at);
  reportPerformance(`tti ${screen}`, { ms, cold: isFirstScreen });
  report(`${screen} interactive in ${ms}ms${isFirstScreen ? ' (cold start)' : ''}`);
}

/**
 * Marks a main screen interactive once `ready` is true (its first real
 * content or skeleton is rendered) and the interaction queue has settled.
 * Records at most once per mount. In store builds it only runs for the first
 * screen after launch (the cold-start reading) and is otherwise a no-op.
 */
export function useScreenInteractive(screen: string, ready: boolean = true): void {
  const [mountedAt] = useState(nowMs);
  const doneRef = useRef(false);
  useEffect(() => {
    if (!ready || doneRef.current) return;
    // Store builds only take the cold-start reading; later screens skip all work.
    if (!PERF_MARKS && !canBeFirstScreen(mountedAt)) return;
    return afterContentFrameAndInteractions((at) => {
      if (doneRef.current) return;
      doneRef.current = true;
      recordScreenInteractive(screen, mountedAt, at);
    });
  }, [ready, screen, mountedAt]);
}

/**
 * Longest wait for the interaction queue after the content frame. A looping
 * animation that never releases its interaction handle would otherwise hold
 * the reading forever; past this the content frame time is used instead.
 */
const INTERACTIONS_CEILING_MS = 1_000;

/**
 * Calls `task(at)` once the next frame has painted and pending interactions
 * have finished; `at` is when the interactions cleared, or the painted frame
 * when they had not within INTERACTIONS_CEILING_MS. Returns a cancel function.
 */
function afterContentFrameAndInteractions(task: (at: number) => void): () => void {
  let cancelled = false;
  let finished = false;
  let frame: number | null = null;
  let ceiling: ReturnType<typeof setTimeout> | null = null;
  let handle: { cancel?: () => void } | null = null;
  const finish = (at: number) => {
    if (cancelled || finished) return;
    finished = true;
    if (ceiling !== null) clearTimeout(ceiling);
    try {
      handle?.cancel?.();
    } catch {
      // ignore
    }
    task(at);
  };
  const onFrame = () => {
    if (cancelled) return;
    const paintedAt = nowMs();
    ceiling = setTimeout(() => finish(paintedAt), INTERACTIONS_CEILING_MS);
    try {
      handle = InteractionManager?.runAfterInteractions?.(() => finish(nowMs())) ?? null;
    } catch {
      handle = null;
    }
    if (!handle) finish(paintedAt);
  };
  if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(onFrame);
  else setTimeout(onFrame, 16);
  return () => {
    cancelled = true;
    if (ceiling !== null) clearTimeout(ceiling);
    try {
      handle?.cancel?.();
      if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    } catch {
      // ignore
    }
  };
}

const SCROLL_IDLE_MS = 700;

export interface ScrollFrameSamplerProps {
  onScroll?: () => void;
  onScrollBeginDrag?: () => void;
  onMomentumScrollBegin?: () => void;
  onMomentumScrollEnd?: () => void;
  scrollEventThrottle?: number;
}

/**
 * Scroll-view props that sample frame timing while the list is moving: a
 * requestAnimationFrame loop starts on the first scroll event, stops once
 * scrolling has been idle for SCROLL_IDLE_MS, and records frames / dropped
 * frames / worst frame for that scroll.
 */
export function createScrollFrameSampler(screen: string): ScrollFrameSamplerProps {
  let stamps: number[] = [];
  let running = false;
  let lastActivity = 0;
  const finish = () => {
    running = false;
    if (stamps.length < 5) return;
    const sample: FrameSample = summarizeFrames(screen, stamps);
    stamps = [];
    pushBounded(record.frames, sample);
    reportPerformance(`frames ${screen}`, { ...sample });
    report(`${screen} scroll: ${sample.droppedFrames} dropped of ${sample.frames} frames ` +
      `(worst ${sample.worstFrameMs}ms over ${sample.durationMs}ms)`);
  };
  const loop = () => {
    const t = nowMs();
    stamps.push(t);
    if (t - lastActivity > SCROLL_IDLE_MS) {
      finish();
      return;
    }
    requestAnimationFrame(loop);
  };
  const activity = () => {
    lastActivity = nowMs();
    if (running) return;
    running = true;
    stamps = [];
    requestAnimationFrame(loop);
  };
  return {
    onScroll: activity,
    onScrollBeginDrag: activity,
    onMomentumScrollBegin: activity,
    onMomentumScrollEnd: activity,
    scrollEventThrottle: 16,
  };
}

/** Spread onto the feed's list. Empty (no props at all) outside perf builds. */
export const FEED_FRAME_SAMPLER_PROPS: ScrollFrameSamplerProps = PERF_MARKS
  ? createScrollFrameSampler('feed')
  : Object.freeze({});

/** Call whenever the active pathname changes. Marks the start of a
 *  navigation and, in dev, schedules the first-render measurement. */
export function recordNavigationStart(route: string, queryClient?: QueryClient): void {
  if (!PERF_MARKS) return;
  lastNavigationAt = nowMs();
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

function pushEntry(entry: RoutePerfEntry) {
  recent.push(entry);
  if (recent.length > MAX_RECENT) recent.shift();
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

/** Cold start, per-screen interactive and frame samples recorded so far. */
export function getPerfRecord(): Readonly<typeof record> {
  return record;
}

/**
 * Cross-platform `performance.mark`. Web's `performance` (with `.mark`) is
 * what Chrome DevTools' Performance panel and `performance.getEntriesByType
 * ('mark')` read from, which is how first-paint timing is measured/verified
 * for the feed's black-screen fix (see docs in app/(tabs)/feed.tsx around
 * `bt-first-poster-painted`). React Native 0.86 implements the User Timing
 * API too; where `.mark` is missing this is a no-op rather than throwing —
 * same "never breaks the app it measures" spirit as the rest of this file,
 * minus a `__DEV__` gate since this timing is also useful to check against a
 * production build.
 */
export function mark(name: string, startTime?: number): void {
  try {
    if (typeof performance !== 'undefined' && typeof performance.mark === 'function') {
      if (startTime === undefined) performance.mark(name);
      else performance.mark(name, { startTime });
    }
  } catch {
    // Never let a timing mark break the app it's measuring.
  }
}
