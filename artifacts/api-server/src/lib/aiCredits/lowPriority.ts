import { getSpendCaps } from "./catalogue";

/**
 * Small FIFO concurrency limiter for Pro jobs past the hidden fair-use line.
 * Jobs wait their turn, so they are slower under load but always complete: a
 * waiter that outlasts `waitMs` runs anyway instead of failing.
 */
export function createLowPriorityQueue() {
  let running = 0;
  const waiters: Array<() => void> = [];

  function release() {
    running -= 1;
    const next = waiters.shift();
    if (next) { running += 1; next(); }
  }

  /**
   * Resolves with a release function once a slot is free. If `aborted()` turns
   * true while waiting (client gone) it resolves null and holds nothing.
   */
  function acquire(opts: { max: number; waitMs: number; onAbort?: (cb: () => void) => void }): Promise<(() => void) | null> {
    if (running < opts.max) {
      running += 1;
      return Promise.resolve(once(release));
    }
    return new Promise((resolve) => {
      let settled = false;
      const start = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(once(release));
      };
      const timer = setTimeout(() => {
        if (settled) return;
        const i = waiters.indexOf(start);
        if (i >= 0) waiters.splice(i, 1);
        // Waited long enough: run now rather than fail the job.
        running += 1;
        settled = true;
        resolve(once(release));
      }, opts.waitMs);
      timer.unref?.();
      waiters.push(start);
      opts.onAbort?.(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const i = waiters.indexOf(start);
        if (i >= 0) waiters.splice(i, 1);
        resolve(null);
      });
    });
  }

  return { acquire, stats: () => ({ running, waiting: waiters.length }) };
}

function once(fn: () => void): () => void {
  let done = false;
  return () => { if (!done) { done = true; fn(); } };
}

export const lowPriorityQueue = createLowPriorityQueue();

export function acquireLowPrioritySlot(onAbort?: (cb: () => void) => void) {
  const caps = getSpendCaps();
  return lowPriorityQueue.acquire({ max: caps.lowPriorityConcurrency, waitMs: caps.lowPriorityWaitMs, onAbort });
}
