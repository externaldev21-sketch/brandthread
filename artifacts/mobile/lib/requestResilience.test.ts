import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSlowRequestTracker, isTransientFailure, SLOW_REQUEST_MS } from './requestResilience';

describe('isTransientFailure', () => {
  it('retries timeouts and gateway errors', () => {
    for (const status of [408, 502, 503, 504]) expect(isTransientFailure({ status })).toBe(true);
  });

  it('does not retry answers that would repeat', () => {
    for (const status of [400, 401, 403, 404, 410, 429, 500]) expect(isTransientFailure({ status })).toBe(false);
  });

  it('retries a thrown network error', () => {
    expect(isTransientFailure(new TypeError('Network request failed'))).toBe(true);
  });
});

describe('createSlowRequestTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays quiet for reads that finish before 8s', () => {
    const t = createSlowRequestTracker();
    const listener = vi.fn();
    t.subscribe(listener);
    const end = t.start();
    vi.advanceTimersByTime(SLOW_REQUEST_MS - 1);
    end();
    vi.advanceTimersByTime(SLOW_REQUEST_MS);
    expect(t.isSlow()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('turns slow at 8s and clears when the last slow read settles', () => {
    const t = createSlowRequestTracker();
    const listener = vi.fn();
    t.subscribe(listener);
    const a = t.start();
    const b = t.start();
    vi.advanceTimersByTime(SLOW_REQUEST_MS);
    expect(t.isSlow()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    a();
    expect(t.isSlow()).toBe(true);
    b();
    expect(t.isSlow()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores a second end() call', () => {
    const t = createSlowRequestTracker();
    const a = t.start();
    const b = t.start();
    vi.advanceTimersByTime(SLOW_REQUEST_MS);
    a();
    a();
    expect(t.isSlow()).toBe(true);
    b();
    expect(t.isSlow()).toBe(false);
  });
});
