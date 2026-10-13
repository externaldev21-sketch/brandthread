/**
 * Gated expo-haptics. metro.config.js resolves every `expo-haptics` import in
 * the app to this file (imports made from this file still get the real
 * package), so Settings → Accessibility → "Disable haptic feedback" silences
 * all ~200 haptic call sites from one place. Enums and everything else are
 * re-exported untouched.
 */
import * as RealHaptics from 'expo-haptics';
import { hydrateHapticsPreference, isHapticsDisabled } from '../lib/hapticsPreference';

export * from 'expo-haptics';

void hydrateHapticsPreference();

export function impactAsync(...args: Parameters<typeof RealHaptics.impactAsync>): Promise<void> {
  if (isHapticsDisabled()) return Promise.resolve();
  return RealHaptics.impactAsync(...args);
}

export function notificationAsync(...args: Parameters<typeof RealHaptics.notificationAsync>): Promise<void> {
  if (isHapticsDisabled()) return Promise.resolve();
  return RealHaptics.notificationAsync(...args);
}

export function selectionAsync(): Promise<void> {
  if (isHapticsDisabled()) return Promise.resolve();
  return RealHaptics.selectionAsync();
}

export function performAndroidHapticsAsync(
  ...args: Parameters<typeof RealHaptics.performAndroidHapticsAsync>
): Promise<void> {
  if (isHapticsDisabled()) return Promise.resolve();
  return RealHaptics.performAndroidHapticsAsync(...args);
}
