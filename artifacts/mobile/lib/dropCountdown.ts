/**
 * Pure countdown-parts computation for the Drops countdown UI, extracted so
 * it can be unit tested without pulling in React Native / Expo modules.
 */

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
  isLive: boolean;
}

/**
 * Computes the countdown breakdown for a target ISO instant relative to now.
 * Returns `isLive: true` (all zeros) once `target` has passed, or when no
 * target is given.
 */
export function computeCountdownParts(target?: string | null, now: number = Date.now()): CountdownParts {
  const difference = target ? new Date(target).getTime() - now : 0;
  if (difference <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, totalSeconds: 0, isLive: true };
  const totalSeconds = Math.floor(difference / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    totalSeconds,
    isLive: false,
  };
}
