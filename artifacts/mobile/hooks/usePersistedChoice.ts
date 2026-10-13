/**
 * Remembers the last selected tab / filter of a screen across launches
 * (polish #60). Drop-in for `useState` on a string-union choice:
 *
 *   const [filter, setFilter] = usePersistedChoice('buyer-orders.filter', 'all', FILTER_KEYS);
 *
 * - The stored value is only applied when it is still one of `allowed`, so
 *   a renamed or removed tab never strands the screen on a dead key.
 * - If the user picks something before storage answers, their pick wins.
 * - Pass `restore: false` when a route param chose the value explicitly
 *   (a deep link to "Unfulfilled" must open on Unfulfilled); the user's
 *   later picks are still remembered.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { safeGetItem, safeSetItem } from '@/lib/safeAsyncStorage';

const PREFIX = 'bt.lastChoice.';

export function storageKeyForChoice(key: string): string {
  return PREFIX + key;
}

export function pickStoredChoice<T extends string>(
  stored: string | null,
  allowed: readonly T[],
): T | null {
  return stored !== null && (allowed as readonly string[]).includes(stored) ? (stored as T) : null;
}

export function usePersistedChoice<T extends string>(
  key: string,
  initial: T,
  allowed: readonly T[],
  options: { restore?: boolean } = {},
): [T, (next: T) => void] {
  const restore = options.restore ?? true;
  const [value, setValue] = useState<T>(initial);
  const touched = useRef(false);
  const allowedRef = useRef(allowed);
  allowedRef.current = allowed;

  useEffect(() => {
    if (!restore) return;
    let cancelled = false;
    void safeGetItem(storageKeyForChoice(key)).then((stored) => {
      if (cancelled || touched.current) return;
      const picked = pickStoredChoice(stored, allowedRef.current);
      if (picked !== null) setValue(picked);
    });
    return () => {
      cancelled = true;
    };
  }, [key, restore]);

  const set = useCallback(
    (next: T) => {
      touched.current = true;
      setValue(next);
      void safeSetItem(storageKeyForChoice(key), next);
    },
    [key],
  );

  return [value, set];
}
