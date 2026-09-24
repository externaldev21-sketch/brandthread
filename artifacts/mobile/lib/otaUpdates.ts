import * as Updates from 'expo-updates';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { addMonitoringBreadcrumb } from '@/lib/monitoring';

/**
 * Over-the-air (EAS Update) behaviour.
 *
 * On every cold start the native layer checks for an update in the background
 * (`updates.checkAutomatically: "ON_LOAD"` with `fallbackToCacheTimeout: 0` in
 * app.json), so launch is never delayed and a downloaded update is applied the
 * next time the app starts.
 *
 * People often leave the app suspended for days without a cold start, so this
 * module also checks when the app returns to the foreground after a while.
 * It only downloads; it never reloads the running app, so nobody loses what
 * they were doing mid-screen.
 */

export const FOREGROUND_CHECK_INTERVAL_MS = 30 * 60 * 1000;

export function shouldCheckOnForeground(
  nextState: AppStateStatus,
  lastCheckedAt: number,
  now: number,
  inFlight: boolean,
): boolean {
  return nextState === 'active' && !inFlight && now - lastCheckedAt >= FOREGROUND_CHECK_INTERVAL_MS;
}

let started = false;
let lastCheckedAt = 0;
let inFlight = false;

async function downloadUpdateQuietly(): Promise<void> {
  inFlight = true;
  lastCheckedAt = Date.now();
  try {
    const result = await Updates.checkForUpdateAsync();
    if (!result.isAvailable) return;
    const fetched = await Updates.fetchUpdateAsync();
    if (fetched.isNew) {
      addMonitoringBreadcrumb('updates', 'Downloaded update; it will apply on next launch');
    }
  } catch (error) {
    // Offline, server unreachable, or no compatible update: try again later.
    addMonitoringBreadcrumb('updates', 'Background update check failed', {
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    inFlight = false;
  }
}

/** Registers the foreground check. No-op on web, in development and in builds without EAS Update. */
export function startBackgroundUpdateChecks(): void {
  if (started || Platform.OS === 'web' || __DEV__ || !Updates.isEnabled) return;
  started = true;
  // The native launch check has just run, so wait a full interval first.
  lastCheckedAt = Date.now();
  AppState.addEventListener('change', (nextState) => {
    if (shouldCheckOnForeground(nextState, lastCheckedAt, Date.now(), inFlight)) {
      void downloadUpdateQuietly();
    }
  });
}
