/**
 * useStickyState — `useState` whose value outlives the component.
 *
 * Tab screens are kept mounted (detachInactiveScreens={false} +
 * freezeOnBlur), but a screen still mounts fresh on its first visit after a
 * cold start / JS reload, after an account switch, and whenever a parent
 * re-keys it. Plain `useState([])` + `loading = true` turns every one of
 * those into a skeleton flash followed by content popping in — the "it
 * looks like it's loading for the first time" jump.
 *
 * Values here write through to `lib/tabDataCache.ts` (memory, scoped to the
 * signed-in account), so the next mount paints the last-known value on its
 * very first frame, and `hasCache` tells the caller it can skip the skeleton
 * entirely. `persist: true` also writes to AsyncStorage so a cold start can
 * paint it too, once `hydratePersistedTabData()` has run (app/_layout.tsx).
 */
import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getCachedTabData, setCachedTabData, setMemoryTabData } from '@/lib/tabDataCache';

export function useStickyState<T>(
  key: string,
  initial: T | (() => T),
  { persist = false }: { persist?: boolean } = {},
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const hasCacheRef = useRef<boolean | null>(null);
  const [value, setValue] = useState<T>(() => {
    const cached = getCachedTabData<T>(key);
    hasCacheRef.current = cached !== undefined;
    if (cached !== undefined) return cached;
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });

  const keyRef = useRef(key);
  keyRef.current = key;
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const setSticky = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      if (persistRef.current) setCachedTabData(keyRef.current, resolved);
      else setMemoryTabData(keyRef.current, resolved);
      return resolved;
    });
  }, []);

  return [value, setSticky, hasCacheRef.current === true];
}
