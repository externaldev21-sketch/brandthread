/**
 * "Check for an incoming call now" — raised when a dm_call push is tapped
 * (lib/notificationNavigation.ts) and consumed by CallSessionContext, which
 * fetches GET /api/call/dm/incoming and shows the ringing screen. Pure (no
 * React / RN imports) so the notification handler stays unit-testable.
 */
const listeners = new Set<() => void>();

export function signalIncomingCall(): void {
  listeners.forEach((l) => l());
}

export function onIncomingCallSignal(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
