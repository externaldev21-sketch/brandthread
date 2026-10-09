/**
 * "A Thread Cash balance just changed" — one in-process signal so every
 * mounted balance (wallet screen, seller Payouts card, dashboard earnings row,
 * Studio tile) refetches at once instead of waiting for a remount.
 *
 * Fired on the sending side after any Thread Cash write this device makes
 * (lib/api.ts), and on the receiving side when a Thread Cash push lands while
 * the app is open (app/_layout.tsx). Listeners only refetch from the server;
 * nothing here carries amounts.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeThreadCashChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitThreadCashChanged(): void {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* one screen's reload must not break another's */ }
  }
}

/** Whether a push payload is about this account's Thread Cash. */
export function isThreadCashNotification(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  const type = typeof data.type === 'string' ? data.type : '';
  return data.targetType === 'thread_cash_transfer' || type.startsWith('thread_cash') || type === 'threadcash';
}

/** Resolves to the same value, firing the change signal once the write succeeded. */
export function afterThreadCashWrite<T>(request: Promise<T>): Promise<T> {
  return request.then((result) => { emitThreadCashChanged(); return result; });
}
