/**
 * metro.config.js resolves every `import … from 'expo-haptics'` in the app to
 * this file (except lib/haptics.ts, which drives the real module). The three
 * play functions go through lib/haptics.ts `play()`, so raw calls respect the
 * Settings › Sounds & haptics switch and the one-haptic-per-action rule too.
 * Everything else (enums, Android haptics) is the real module.
 */
import type { ImpactFeedbackStyle, NotificationFeedbackType } from 'expo-haptics';
import { kindForImpactStyle, kindForNotificationType, play } from '@/lib/haptics';

export * from 'expo-haptics';

export function impactAsync(style?: ImpactFeedbackStyle): Promise<void> {
  return play(kindForImpactStyle(style));
}

export function notificationAsync(type?: NotificationFeedbackType): Promise<void> {
  return play(kindForNotificationType(type));
}

export function selectionAsync(): Promise<void> {
  return play('selection');
}
