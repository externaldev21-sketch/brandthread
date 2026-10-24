/**
 * App-wide "reduce motion" state: the buyer setting (Settings → Accessibility
 * → Reduce motion) OR the OS accessibility setting.
 *
 * - The buyer setting is pushed in by components/AppSettingsEffects.tsx
 *   (mounted once in the root layout), which already tracks it. Keeping it a
 *   plain flag here means the motion primitives (constants/motion.ts) don't
 *   import the settings/storage stack.
 * - The OS setting is watched lazily (first read or subscribe) through
 *   AccessibilityInfo; unsupported platforms fail safe to false.
 *
 * Reanimated animations get the buyer setting separately via
 * <ReducedMotionConfig> in AppSettingsEffects; this store covers RN
 * `Animated` motion (press scale, shared springs, skeleton pulse) and the
 * `useReduceMotion()` hook.
 */
import { AccessibilityInfo } from 'react-native';

let preference = false;
let system = false;
let watching = false;
const listeners = new Set<() => void>();

/** Pure rule: either source on means reduced. */
export function resolveReduceMotion(setting: boolean | null | undefined, os: boolean | null | undefined): boolean {
  return !!setting || !!os;
}

function emit() {
  listeners.forEach((l) => l());
}

function setSystem(next: boolean) {
  if (system === next) return;
  system = next;
  emit();
}

function watchSystem() {
  if (watching) return;
  watching = true;
  try {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => setSystem(!!enabled))
      .catch(() => {});
    AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled: boolean) => setSystem(!!enabled));
  } catch {
    // Platform without the query: stays false.
  }
}

/** Current combined value (buyer setting OR OS). Safe to call anywhere. */
export function isMotionReduced(): boolean {
  watchSystem();
  return resolveReduceMotion(preference, system);
}

/** Called by AppSettingsEffects whenever the buyer setting loads or changes. */
export function setReduceMotionPreference(next: boolean): void {
  if (preference === !!next) return;
  preference = !!next;
  emit();
}

export function subscribeReduceMotion(listener: () => void): () => void {
  watchSystem();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only: reset module state. */
export function __resetReduceMotionForTests(): void {
  preference = false;
  system = false;
  watching = false;
  listeners.clear();
}
