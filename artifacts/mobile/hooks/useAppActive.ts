import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * True while the app is in the foreground. Video and story timers use it so
 * nothing keeps playing (or counting) behind the lock screen or app switcher.
 */
export function isForegroundState(state: AppStateStatus | null | undefined): boolean {
  return state == null || state === 'active';
}

export function useAppActive(): boolean {
  const [active, setActive] = useState(() => isForegroundState(AppState.currentState));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setActive(isForegroundState(next)));
    return () => sub.remove();
  }, []);
  return active;
}
