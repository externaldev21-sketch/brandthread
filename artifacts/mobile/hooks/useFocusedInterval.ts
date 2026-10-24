import { useEffect, useRef } from 'react';
import { useAppActive } from './useAppActive';
import { useRouteIsFocused } from './useRouteIsFocused';

/**
 * Polling only runs while the screen is focused, the app is in the
 * foreground and the caller hasn't disabled it.
 */
export function shouldPoll(state: { focused: boolean; appActive: boolean; enabled: boolean }): boolean {
  return state.enabled && state.focused && state.appActive;
}

/**
 * Coming back to the foreground on a focused screen refreshes once right
 * away, so the user doesn't wait a full interval for stale data to update.
 * Initial focus is not a resume: screens load on focus themselves.
 */
export function shouldRefreshOnResume(
  wasAppActive: boolean,
  state: { focused: boolean; appActive: boolean; enabled: boolean },
): boolean {
  return !wasAppActive && shouldPoll(state);
}

/**
 * `setInterval` that pauses while the route is unfocused or the app is
 * backgrounded. The callback can change between renders without restarting
 * the timer.
 */
export function useFocusedInterval(callback: () => unknown, ms: number, enabled = true): void {
  const focused = useRouteIsFocused();
  const appActive = useAppActive();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const wasAppActive = useRef(appActive);

  useEffect(() => {
    const state = { focused, appActive, enabled };
    const resumed = shouldRefreshOnResume(wasAppActive.current, state);
    wasAppActive.current = appActive;
    if (!shouldPoll(state)) return;
    if (resumed) callbackRef.current();
    const timer = setInterval(() => { callbackRef.current(); }, ms);
    return () => clearInterval(timer);
  }, [focused, appActive, enabled, ms]);
}
