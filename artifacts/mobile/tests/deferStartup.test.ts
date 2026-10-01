import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queue: Array<() => void> = [];
const cancelled: boolean[] = [];

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  InteractionManager: {
    runAfterInteractions: (task: () => void) => {
      const index = queue.push(task) - 1;
      return { cancel: () => { cancelled[index] = true; } };
    },
  },
}));

import { DEFER_CEILING_MS, runAfterFirstPaint } from '@/lib/deferStartup';
import { LONG_LIST_TUNING, keyByIdOrIndex } from '@/lib/listTuning';

beforeEach(() => {
  vi.useFakeTimers();
  queue.length = 0;
  cancelled.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('runAfterFirstPaint', () => {
  it('does not run the task synchronously', () => {
    const task = vi.fn();
    runAfterFirstPaint(task);
    expect(task).not.toHaveBeenCalled();
  });

  it('runs once when interactions settle, and not again from the ceiling timer', () => {
    const task = vi.fn();
    runAfterFirstPaint(task);
    queue[0]();
    expect(task).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DEFER_CEILING_MS + 1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('still runs at the ceiling when the interaction queue stays busy', () => {
    const task = vi.fn();
    runAfterFirstPaint(task);
    vi.advanceTimersByTime(DEFER_CEILING_MS);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('can be cancelled before it runs', () => {
    const task = vi.fn();
    const cancel = runAfterFirstPaint(task);
    cancel();
    queue[0]();
    vi.advanceTimersByTime(DEFER_CEILING_MS + 1);
    expect(task).not.toHaveBeenCalled();
    expect(cancelled[0]).toBe(true);
  });

  it('swallows errors from the deferred task', () => {
    runAfterFirstPaint(() => { throw new Error('boom'); });
    expect(() => queue[0]()).not.toThrow();
  });
});

describe('list tuning', () => {
  it('renders about one screen first and keeps a bounded window', () => {
    expect(LONG_LIST_TUNING.initialNumToRender).toBeLessThanOrEqual(12);
    expect(LONG_LIST_TUNING.windowSize).toBeLessThan(21);
    expect(LONG_LIST_TUNING.maxToRenderPerBatch).toBeGreaterThan(0);
  });

  it('only clips subviews on Android', () => {
    expect(LONG_LIST_TUNING.removeClippedSubviews).toBe(true);
  });

  it('keys rows by id, falling back to the index', () => {
    expect(keyByIdOrIndex({ id: 'a' }, 3)).toBe('a');
    expect(keyByIdOrIndex({ id: 0 }, 3)).toBe('0');
    expect(keyByIdOrIndex({}, 3)).toBe('row-3');
    expect(keyByIdOrIndex(null, 4)).toBe('row-4');
  });
});
