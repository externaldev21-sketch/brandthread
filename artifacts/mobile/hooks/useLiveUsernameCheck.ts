/**
 * Live @handle availability while typing (Instagram edit profile → Username):
 * after a short pause the screen's own availability check runs, so the
 * existing status line under the field updates without leaving the field.
 * The returned ref holds the handle currently in the field so a slower,
 * older response can be ignored by the caller.
 */
import { useEffect, useRef } from 'react';

export const LIVE_USERNAME_DEBOUNCE_MS = 400;
const HANDLE_RE = /^[a-z0-9_]{3,30}$/;

/** Normalised handle to check live, or null when there is nothing to ask. */
export function liveUsernameToCheck(value: string, initial: string): string | null {
  const u = value.trim().toLowerCase();
  if (u === initial.trim().toLowerCase()) return null;
  return HANDLE_RE.test(u) ? u : null;
}

export function useLiveUsernameCheck(
  value: string,
  initial: string,
  check: (handle: string) => unknown,
) {
  const latest = useRef(value.trim().toLowerCase());
  latest.current = value.trim().toLowerCase();
  const checkRef = useRef(check);
  checkRef.current = check;
  useEffect(() => {
    const handle = liveUsernameToCheck(value, initial);
    if (!handle) return;
    const timer = setTimeout(() => { void checkRef.current(handle); }, LIVE_USERNAME_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, initial]);
  return latest;
}
