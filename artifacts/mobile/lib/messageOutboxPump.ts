/**
 * Background delivery for lib/messageOutbox.ts: replays every queued message
 * of the signed-in account when the app returns to the foreground and on a
 * light interval, so a message queued while offline still goes out after the
 * user leaves the thread. Started lazily (idempotent) by the screens that
 * send or list messages; the open thread additionally flushes on reconnect
 * (useIsOffline) and on focus.
 *
 * Only ever flushes the queue of the account socialService is scoped to right
 * now, and the sender itself re-checks that before each send, so a queue can
 * never be delivered under another account's session.
 */
import { AppState } from 'react-native';
import { flushAllOutboxes } from '@/lib/messageOutbox';
import { getSocialUserId, sendQueuedMessage } from '@/services/socialService';

const PUMP_INTERVAL_MS = 20_000;
let started = false;

/** Flush the signed-in account's queued messages now. Never throws. */
export function flushSignedInOutboxes(): void {
  const userId = getSocialUserId();
  if (!userId || userId === 'anon') return;
  void flushAllOutboxes(userId, (entry) => sendQueuedMessage(userId, entry)).catch(() => {});
}

export function ensureMessageOutboxPump(): void {
  if (started) return;
  started = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') flushSignedInOutboxes();
  });
  setInterval(flushSignedInOutboxes, PUMP_INTERVAL_MS);
  flushSignedInOutboxes();
}
