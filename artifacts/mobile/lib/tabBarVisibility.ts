/**
 * App-wide "hide the floating tab bar while this screen is focused" registry.
 *
 * Any screen with a bottom text composer (AI chats, DMs, group chats, comment
 * sheets…) calls `useHideTabBar()`. While at least one focused screen holds a
 * request, both the buyer and seller floating tab bars slide fully off the
 * bottom (the same Reanimated translateY slide they already use for
 * full-screen routes — see lib/tabBarSlide.ts) and slide back when the last
 * request is released. A counter (not a boolean) so overlapping
 * focus/blur during a push transition can't leave the bar stuck either way.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';

let holders = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

/** Imperative acquire; returns the release function. Exported for tests. */
export function acquireTabBarHide(): () => void {
  let released = false;
  holders += 1;
  emit();
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const getSnapshot = () => holders > 0;

/** True while any focused screen has asked the tab bar to hide. */
export function useTabBarHiddenByScreen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Call from a screen with a bottom composer: hides the tab bar while focused. */
export function useHideTabBar(enabled = true): void {
  useFocusEffect(useCallback(() => (enabled ? acquireTabBarHide() : undefined), [enabled]));
}
