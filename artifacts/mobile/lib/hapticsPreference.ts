/**
 * Persists the Settings › Sounds & haptics switch on this device and feeds it
 * to lib/haptics.ts. Haptics stay on until the stored value says otherwise, so
 * the first launch never waits on storage.
 */
import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isHapticsEnabled, setHapticsEnabled, subscribeHapticsEnabled } from '@/lib/haptics';

export const HAPTICS_ENABLED_KEY = 'bt:haptics:enabled';

/** Compatibility with the older inverse preference; there is only one gate. */
export const isHapticsDisabled = () => !isHapticsEnabled();
export const setHapticsDisabled = (disabled: boolean) => setHapticsEnabled(!disabled);

let hydration: Promise<void> | null = null;

/** Reads the stored switch once per launch. Safe to call repeatedly. */
export function hydrateHapticsPreference(): Promise<void> {
  if (!hydration) {
    hydration = AsyncStorage.getItem(HAPTICS_ENABLED_KEY)
      .then((raw) => { if (raw === 'false') setHapticsEnabled(false); })
      .catch(() => {});
  }
  return hydration;
}

export async function saveHapticsEnabled(next: boolean): Promise<void> {
  setHapticsEnabled(next);
  try {
    await AsyncStorage.setItem(HAPTICS_ENABLED_KEY, next ? 'true' : 'false');
  } catch {
    // The switch still applies for this session.
  }
}

export function useHapticsEnabled(): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(isHapticsEnabled);
  useEffect(() => {
    void hydrateHapticsPreference().then(() => setValue(isHapticsEnabled()));
    return subscribeHapticsEnabled(setValue);
  }, []);
  return [value, (next) => { void saveHapticsEnabled(next); }];
}
