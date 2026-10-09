/**
 * Pure helpers behind lib/perf.ts (no React Native imports, so they are unit
 * testable): clock access, process-start lookup, frame-drop math and the
 * in-memory record the web perf harness reads back.
 */

export interface ColdStartTiming {
  /** Process start (native) / navigation start (web) → first screen interactive. */
  processToInteractiveMs: number | null;
  /** First line of app JS (lib/bootstrap.ts) → first screen interactive. */
  jsToInteractiveMs: number;
  /** The screen that became interactive first, or "shell" for the root fallback. */
  screen: string;
}

export interface ScreenInteractiveTiming {
  screen: string;
  /** Navigation start (or screen mount for the first screen) → interactive. */
  ms: number;
  cold: boolean;
}

export interface FrameSample {
  screen: string;
  frames: number;
  droppedFrames: number;
  worstFrameMs: number;
  durationMs: number;
}

export interface PerfRecord {
  coldStart: ColdStartTiming | null;
  shellInteractiveMs: number | null;
  screens: ScreenInteractiveTiming[];
  frames: FrameSample[];
}

const MAX_ENTRIES = 50;

interface PerformanceLike {
  now?: () => number;
  rnStartupTiming?: { startTime?: number | null } | null;
}

function perfApi(): PerformanceLike | null {
  return typeof performance !== 'undefined' ? (performance as unknown as PerformanceLike) : null;
}

/** Monotonic milliseconds when available (performance.now), wall clock otherwise. */
export function nowMs(): number {
  const p = perfApi();
  if (p && typeof p.now === 'function') return p.now();
  return Date.now();
}

/**
 * Process start on the same clock as nowMs(), when the platform exposes it:
 * - web: performance.now() counts from navigation start, so it is 0.
 * - native: React Native's `performance.rnStartupTiming.startTime`.
 * Null when unknown or implausible (never guessed).
 */
export function processStartMs(isWeb: boolean, current: number = nowMs()): number | null {
  const p = perfApi();
  if (!p || typeof p.now !== 'function') return null;
  if (isWeb) return 0;
  try {
    const start = p.rnStartupTiming?.startTime;
    if (typeof start !== 'number' || !Number.isFinite(start) || start <= 0) return null;
    const elapsed = current - start;
    // A cold start longer than two minutes is a clock mismatch, not a start.
    return elapsed >= 0 && elapsed < 120_000 ? start : null;
  } catch {
    return null;
  }
}

/** Frames that should have been drawn in `deltaMs` but were not, at `vsyncMs` per frame. */
export function droppedFramesFor(deltaMs: number, vsyncMs: number): number {
  if (!(deltaMs > 0) || !(vsyncMs > 0)) return 0;
  return Math.max(0, Math.round(deltaMs / vsyncMs) - 1);
}

/**
 * Summarises requestAnimationFrame timestamps. The display's frame interval
 * is taken as the shortest gap seen (clamped to 120–30 Hz), so 60 Hz and
 * 120 Hz screens are both judged against their own refresh rate.
 */
export function summarizeFrames(screen: string, timestamps: readonly number[]): FrameSample {
  const deltas: number[] = [];
  for (let i = 1; i < timestamps.length; i++) deltas.push(timestamps[i] - timestamps[i - 1]);
  const positive = deltas.filter((d) => d > 0);
  const vsync = positive.length ? Math.min(33.4, Math.max(8.3, Math.min(...positive))) : 1000 / 60;
  let dropped = 0;
  for (const d of positive) dropped += droppedFramesFor(d, vsync);
  return {
    screen,
    frames: timestamps.length,
    droppedFrames: dropped,
    worstFrameMs: positive.length ? Math.round(Math.max(...positive)) : 0,
    durationMs: timestamps.length > 1 ? Math.round(timestamps[timestamps.length - 1] - timestamps[0]) : 0,
  };
}

export function createPerfRecord(): PerfRecord {
  return { coldStart: null, shellInteractiveMs: null, screens: [], frames: [] };
}

export function pushBounded<T>(list: T[], entry: T): void {
  list.push(entry);
  if (list.length > MAX_ENTRIES) list.shift();
}
