import { useCallback, useRef } from 'react';

/**
 * A function identity that never changes but always calls the latest `fn`.
 *
 * For handlers passed into list rows / memoized children from a screen that
 * re-renders often (e.g. on every keystroke in its composer): a fresh inline
 * handler each render would defeat the row memoization and re-render every
 * visible row per keystroke. Only call the result from event handlers or
 * effects, not during render.
 */
export function useStableCallback<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}
