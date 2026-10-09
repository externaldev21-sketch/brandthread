import * as Updates from 'expo-updates';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { addMonitoringBreadcrumb } from '@/lib/monitoring';
import { loadAppConfig } from '@/lib/appConfig';
import { isFeatureEnabled } from '@/lib/featureFlags';

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
 *
 * Exception: a CRITICAL update (its id is listed in the server's
 * OTA_CRITICAL_UPDATE_IDS, served by GET /api/v1/app/config, or its app config
 * has `extra.critical: true`) is applied at the next safe moment: when the app
 * comes back to the foreground after at least CRITICAL_RELOAD_MIN_BACKGROUND_MS
 * in the background, i.e. the person had already left whatever they were
 * doing. Kill switch: the `critical_ota_reload` release flag.
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

export const CRITICAL_RELOAD_MIN_BACKGROUND_MS = 5 * 60 * 1000;

/** True when the update manifest is marked critical by id (server list) or by its own app config. */
export function isCriticalUpdate(manifest: unknown, criticalIds: readonly string[]): boolean {
  if (!manifest || typeof manifest !== 'object') return false;
  const m = manifest as { id?: unknown; extra?: { critical?: unknown; expoClient?: { extra?: { critical?: unknown } } } };
  if (typeof m.id === 'string' && criticalIds.includes(m.id)) return true;
  return m.extra?.critical === true || m.extra?.expoClient?.extra?.critical === true;
}

/** Reload into a pending critical update only on return from a real stay in the background. */
export function shouldReloadForCritical(
  nextState: AppStateStatus,
  pendingCritical: boolean,
  backgroundedAt: number | null,
  now: number,
): boolean {
  return nextState === 'active'
    && pendingCritical
    && backgroundedAt !== null
    && now - backgroundedAt >= CRITICAL_RELOAD_MIN_BACKGROUND_MS;
}

let started = false;
let pendingCritical = false;
let backgroundedAt: number | null = null;
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
      const config = await loadAppConfig();
      if (isCriticalUpdate(fetched.manifest, config?.criticalUpdateIds ?? [])) {
        pendingCritical = true;
        addMonitoringBreadcrumb('updates', 'Critical update downloaded; applies on next return from background');
      }
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
    const now = Date.now();
    if (nextState === 'background') {
      backgroundedAt = now;
      return;
    }
    if (shouldReloadForCritical(nextState, pendingCritical, backgroundedAt, now) && isFeatureEnabled('critical_ota_reload')) {
      pendingCritical = false;
      addMonitoringBreadcrumb('updates', 'Reloading into critical update');
      Updates.reloadAsync().catch(() => {
        // Could not reload now; it still applies on the next launch.
      });
      return;
    }
    if (nextState === 'active') backgroundedAt = null;
    if (shouldCheckOnForeground(nextState, lastCheckedAt, now, inFlight)) {
      void downloadUpdateQuietly();
    }
  });
}
