/**
 * useFocusEffect, but the work runs only once the newly focused screen has
 * painted (two animation frames after focus) — and never for a screen that
 * lost focus again before that.
 *
 * For a tab screen's refresh-on-focus fetches: the tab switch itself paints
 * first from what's already on screen (stale-while-revalidate), and a rapid
 * burst of tab taps that only *passes through* a tab doesn't kick off its
 * network requests and the state updates they bring. (InteractionManager,
 * the old tool for this, is a deprecated no-op stub in this React Native
 * version, so it no longer waits for anything.)
 *
 * `effect` must be memoized (useCallback), exactly as with useFocusEffect.
 */
import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';

export function useFocusEffectAfterPaint(effect: () => void | (() => void)): void {
  useFocusEffect(useCallback(() => {
    let cleanup: void | (() => void);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        second = 0;
        cleanup = effect();
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
      if (typeof cleanup === 'function') cleanup();
    };
  }, [effect]));
}
