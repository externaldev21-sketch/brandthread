/**
 * Asks before leaving a form with unsaved edits. Covers every way out of the
 * screen (header back, swipe back, hardware back) through `beforeRemove`, and
 * returns a back handler for `<ScreenHeader onBack>` so the header arrow asks
 * even where `beforeRemove` isn't raised for that pop.
 *
 * Pass `blocked: false` while a save is in flight (or right after it lands) so
 * the save's own navigation isn't stopped.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useNavigation, useRouter } from 'expo-router';
import { confirmAlert } from '@/lib/actionSheet';
import { goBackOr } from '@/lib/navigation/goBackOr';

export const DISCARD_CHANGES_COPY = {
  title: 'Discard changes?',
  message: 'You have unsaved changes. If you leave now, they will be lost.',
  confirmLabel: 'Discard',
  cancelLabel: 'Keep editing',
} as const;

export function confirmDiscardChanges(): Promise<boolean> {
  return confirmAlert({ ...DISCARD_CHANGES_COPY, destructive: true });
}

export function useUnsavedChangesGuard(dirty: boolean): () => void {
  const navigation = useNavigation();
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  // Set once the person chose Discard, so the dispatched action isn't
  // intercepted a second time.
  const leaving = useRef(false);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      if (!dirtyRef.current || leaving.current) return;
      e.preventDefault();
      confirmDiscardChanges().then((discard) => {
        if (!discard) return;
        leaving.current = true;
        navigation.dispatch(e.data.action);
      });
    });
    return unsubscribe;
  }, [navigation]);

  return useCallback(() => {
    if (!dirtyRef.current) { goBackOr(router); return; }
    confirmDiscardChanges().then((discard) => {
      if (!discard) return;
      leaving.current = true;
      goBackOr(router);
    });
  }, [router]);
}
