/**
 * Whether motion should be reduced: the buyer's Settings → Accessibility →
 * "Reduce motion" switch OR the OS-level Reduce Motion setting. Re-renders
 * when either changes. Defaults to false (normal animation) until the OS
 * check resolves, and fails safe to false where the OS query isn't supported
 * (e.g. web). See lib/reduceMotion.ts.
 */
import { useSyncExternalStore } from 'react';
import { isMotionReduced, subscribeReduceMotion } from '@/lib/reduceMotion';

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribeReduceMotion, isMotionReduced, isMotionReduced);
}
