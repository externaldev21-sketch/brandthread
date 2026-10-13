/**
 * Which full-screen first-run coaches are on screen right now (the feed's
 * "Watching Threads" gesture coach, the shared full-screen guide tip).
 *
 * Other first-run UI (the cookie-consent card) waits while any coach is up,
 * so two first-run surfaces never stack. Coaches register themselves while
 * visible with `useRegisterCoach`; readers subscribe with `useAnyCoachVisible`.
 */
import { useEffect, useSyncExternalStore } from 'react';

const visible = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setCoachVisible(id: string, isVisible: boolean): void {
  const had = visible.has(id);
  if (isVisible === had) return;
  if (isVisible) visible.add(id);
  else visible.delete(id);
  emit();
}

export function isAnyCoachVisible(): boolean {
  return visible.size > 0;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAnyCoachVisible(): boolean {
  return useSyncExternalStore(subscribe, isAnyCoachVisible, isAnyCoachVisible);
}

/** Marks coach `id` as on screen while `isVisible` is true (and on unmount, off). */
export function useRegisterCoach(id: string, isVisible: boolean): void {
  useEffect(() => {
    setCoachVisible(id, isVisible);
    return () => setCoachVisible(id, false);
  }, [id, isVisible]);
}

/** Test helper. */
export function resetCoachPresence(): void {
  visible.clear();
  emit();
}
