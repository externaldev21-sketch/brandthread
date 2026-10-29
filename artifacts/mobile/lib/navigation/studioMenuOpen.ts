/**
 * Is the seller Studio menu open right now?
 *
 * The menu (components/SellerStudioRadialMenu.tsx) is a full-screen overlay,
 * not a route, so a screen underneath it stays focused. SellerBarGate
 * (app/_layout.tsx) publishes the menu's own open state here (from its
 * onOpenChange), and a screen that plays media (app/(tabs)/watch-threads.tsx)
 * holds playback while it is open — the menu itself is never touched.
 */
import { useSyncExternalStore } from 'react';

let open = false;
const listeners = new Set<() => void>();

export function setStudioMenuOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const listener of [...listeners]) listener();
}

export function isStudioMenuOpen(): boolean {
  return open;
}

export function subscribeStudioMenuOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useStudioMenuOpen(): boolean {
  return useSyncExternalStore(subscribeStudioMenuOpen, isStudioMenuOpen, isStudioMenuOpen);
}
