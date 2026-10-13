/**
 * Pure request-resilience helpers (no React, no network) so they are
 * unit-testable.
 *
 * 1. Auto-retry once: a read that fails for a transient reason (the network
 *    dropped, a timeout, a gateway 502/503/504) is retried once, quietly,
 *    before anything is shown to the user. 4xx, 429 and 500 are not retried:
 *    retrying them gives the same answer.
 * 2. Slow connection: a tracker of in-flight reads that flips to "slow" once
 *    any of them has been running for SLOW_REQUEST_MS, and back as soon as
 *    the last slow one settles.
 */

export const AUTO_RETRY_DELAY_MS = 600;
export const SLOW_REQUEST_MS = 8_000;

const TRANSIENT_STATUSES = new Set([408, 502, 503, 504]);

/** True when a failed read is worth one quiet retry. */
export function isTransientFailure(failure: { status?: number } | unknown): boolean {
  if (failure && typeof failure === 'object' && 'status' in failure) {
    const status = (failure as { status?: unknown }).status;
    if (typeof status === 'number') return TRANSIENT_STATUSES.has(status);
  }
  // A thrown fetch (no HTTP status at all) is a network-level failure.
  return true;
}

type Timer = ReturnType<typeof setTimeout>;

export interface SlowRequestTracker {
  /** Call when a read starts; call the returned function when it settles. */
  start(): () => void;
  isSlow(): boolean;
  subscribe(listener: () => void): () => void;
}

export function createSlowRequestTracker(thresholdMs: number = SLOW_REQUEST_MS): SlowRequestTracker {
  const slowIds = new Set<number>();
  const timers = new Map<number, Timer>();
  const listeners = new Set<() => void>();
  let nextId = 1;
  let slow = false;

  const sync = () => {
    const next = slowIds.size > 0;
    if (next === slow) return;
    slow = next;
    listeners.forEach((l) => l());
  };

  return {
    start() {
      const id = nextId++;
      timers.set(id, setTimeout(() => {
        timers.delete(id);
        slowIds.add(id);
        sync();
      }, thresholdMs));
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const timer = timers.get(id);
        if (timer) clearTimeout(timer);
        timers.delete(id);
        slowIds.delete(id);
        sync();
      };
    },
    isSlow: () => slow,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** App-wide tracker fed by lib/api.ts and read by the offline/slow strip. */
export const slowRequests = createSlowRequestTracker();
