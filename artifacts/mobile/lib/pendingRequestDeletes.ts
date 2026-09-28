/**
 * Deferred-delete pub/sub for message requests.
 *
 * DELETE /api/conversations/:id (see artifacts/api-server/src/routes/
 * conversations.ts) is a TRUE HARD DELETE with no undelete endpoint, but the
 * Requests list needs an "Undo" toast (see useUndoToast in BrandthreadUI.tsx)
 * that actually works for a few seconds after tapping Delete. The trick: the
 * UI removes the row immediately (optimistic), but the real delete call is
 * *deferred* behind a short timer. "Undo" just cancels that timer before it
 * fires. If nothing cancels it, the timer fires and the caller-supplied
 * `onCommit` performs the real (irreversible) delete.
 *
 * This module owns only the scheduling + the "is this id pending delete"
 * set — callers own everything else. Any list of conversations (a cached
 * array, a fresh refetch, preview seed data, …) should filter out ids where
 * `isPendingConversationDelete()` is true so navigating away and back never
 * resurrects a row that's about to be deleted for good.
 */

// Exported so callers that show their own "Undo" toast (inbox.tsx,
// buyer-conversation.tsx) can size that toast's own visible window to match
// exactly — the toast's `durationMs` outliving this grace period would let
// someone tap "Undo" after the real delete already committed, silently
// doing nothing (see the message-requests verification pass, item 75).
export const DELETE_GRACE_MS = 4000;

type Timer = ReturnType<typeof setTimeout>;

const pendingTimers = new Map<string, Timer>();
const subscribers = new Set<(pendingIds: ReadonlySet<string>) => void>();

function notify(): void {
  const snapshot = new Set(pendingTimers.keys());
  for (const cb of subscribers) cb(snapshot);
}

/** Starts (or restarts) the undo window for `id`. `onCommit` runs once, only
 *  if the delete is never cancelled — it should perform the real, permanent
 *  delete (the real API call, or the preview-mode equivalent). */
export function schedulePendingConversationDelete(
  id: string,
  onCommit: () => void | Promise<void>,
  graceMs: number = DELETE_GRACE_MS,
): void {
  const existing = pendingTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(id);
    notify();
    void onCommit();
  }, graceMs);
  pendingTimers.set(id, timer);
  notify();
}

/** Cancels a pending delete for `id` (e.g. the person tapped "Undo"). A no-op
 *  if nothing is pending for that id. */
export function cancelPendingConversationDelete(id: string): void {
  const existing = pendingTimers.get(id);
  if (!existing) return;
  clearTimeout(existing);
  pendingTimers.delete(id);
  notify();
}

/** True while `id`'s delete is still within its undo window. */
export function isPendingConversationDelete(id: string | null | undefined): boolean {
  return !!id && pendingTimers.has(id);
}

/** Subscribes to changes in the pending-delete set. Fires immediately with
 *  the current snapshot, then again on every schedule/cancel/commit. Returns
 *  an unsubscribe function. */
export function subscribePendingConversationDeletes(
  cb: (pendingIds: ReadonlySet<string>) => void,
): () => void {
  subscribers.add(cb);
  cb(new Set(pendingTimers.keys()));
  return () => { subscribers.delete(cb); };
}

/** Test/dev-only escape hatch: clears all pending timers without committing
 *  them. Never called from app code. */
export function __resetPendingConversationDeletesForTests(): void {
  for (const timer of pendingTimers.values()) clearTimeout(timer);
  pendingTimers.clear();
  notify();
}
