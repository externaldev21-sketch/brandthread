import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useApi } from '@/lib/api';

/**
 * Internal-only dev menu (app/internal-dev-menu.tsx). Opened by tapping
 * About → App version 7 times in a row. Only development builds and
 * server-confirmed moderators get in; for everyone else the taps do nothing,
 * and signed-out users never trigger a protected call.
 */
export const DEV_MENU_TAPS = 7;
export const DEV_MENU_TAP_WINDOW_MS = 1500;

/** Returns `tap(now)`, true on the Nth tap where each tap is within `windowMs` of the last. */
export function createTapCounter(threshold = DEV_MENU_TAPS, windowMs = DEV_MENU_TAP_WINDOW_MS) {
  let count = 0;
  let last = -Infinity;
  return (now: number): boolean => {
    count = now - last <= windowMs ? count + 1 : 1;
    last = now;
    if (count >= threshold) {
      count = 0;
      last = -Infinity;
      return true;
    }
    return false;
  };
}

export async function canOpenInternalDevMenu(opts: {
  isDev: boolean;
  isSignedIn: boolean;
  checkModerator: () => Promise<{ isModerator: boolean }>;
}): Promise<boolean> {
  if (opts.isDev) return true;
  if (!opts.isSignedIn) return false;
  try {
    return (await opts.checkModerator()).isModerator === true;
  } catch {
    return false;
  }
}

export function useInternalDevMenuGesture(): () => void {
  const router = useRouter();
  const { isSignedIn } = useAuth();
  const api = useApi();
  const counter = useRef(createTapCounter());
  const deps = useRef({ router, isSignedIn: Boolean(isSignedIn), api });
  deps.current = { router, isSignedIn: Boolean(isSignedIn), api };

  return useCallback(() => {
    if (!counter.current(Date.now())) return;
    const { router: r, isSignedIn: signedIn, api: client } = deps.current;
    void canOpenInternalDevMenu({
      isDev: __DEV__,
      isSignedIn: signedIn,
      checkModerator: () => client.moderation.me(),
    }).then((ok) => { if (ok) r.push('/internal-dev-menu' as never); });
  }, []);
}
