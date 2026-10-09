import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

/**
 * Upper bound on how long iOS/web wait for a Modal's `onDismiss` before
 * running the queued work anyway. `onDismiss` is the real signal; this only
 * guards against it never arriving (e.g. the Modal unmounted mid-dismiss), so
 * queued work can't be silently dropped.
 */
export const MODAL_DISMISS_GUARD_MS = 1000;

/**
 * Runs work once a React Native `<Modal>` has actually finished closing,
 * instead of guessing with `setTimeout(fn, N)`.
 *
 * - iOS: a native Modal is a presented view controller. Pushing a modal-style
 *   route (fullScreenModal / modal) or presenting another Modal while it is
 *   still dismissing is dropped or glitches, so work waits for `onDismiss`,
 *   which fires once the dismiss animation completes.
 * - Web: react-native-web's Modal also fires `onDismiss` after its exit
 *   animation, so the same path applies.
 * - Android: Modal has no `onDismiss`, and nothing needs to wait — the work
 *   runs right after the commit that hides the Modal.
 *
 * Usage:
 *   const { runAfterDismiss, onDismiss } = useAfterModalDismiss(open);
 *   <Modal visible={open} onDismiss={onDismiss} ...>
 *   onPress={() => { runAfterDismiss(() => router.push(route)); setOpen(false); }}
 *
 * Queue the work before hiding the Modal (same handler). Only the most
 * recently queued callback runs; pending work is dropped on unmount. If the
 * Modal is already hidden, the work runs immediately.
 */
export function useAfterModalDismiss(visible: boolean): {
  runAfterDismiss: (fn: () => void) => void;
  onDismiss: () => void;
} {
  const pendingRef = useRef<(() => void) | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const flush = useCallback(() => {
    const fn = pendingRef.current;
    pendingRef.current = null;
    fn?.();
  }, []);

  useEffect(() => {
    if (visible || !pendingRef.current) return undefined;
    if (Platform.OS === 'android') {
      flush();
      return undefined;
    }
    const guard = setTimeout(flush, MODAL_DISMISS_GUARD_MS);
    return () => clearTimeout(guard);
  }, [visible, flush]);

  useEffect(() => () => { pendingRef.current = null; }, []);

  const runAfterDismiss = useCallback((fn: () => void) => {
    // Already closed: there is no dismissal to wait for.
    if (!visibleRef.current) { fn(); return; }
    pendingRef.current = fn;
  }, []);

  return { runAfterDismiss, onDismiss: flush };
}
