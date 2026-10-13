import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/**
 * App/device details shown in About and attached to "Report a problem".
 * Every field is best-effort: on web, in Expo Go, or before EAS stamps a
 * build number, missing values are simply left out. Never includes anything
 * that identifies the person.
 */
export type AppDiagnostics = {
  appVersion?: string;
  buildNumber?: string;
  platform: string;
  osVersion?: string;
  deviceModel?: string;
  updateId?: string;
  updateChannel?: string;
  locale?: string;
};

function str(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function safe<T>(read: () => T): T | undefined {
  try { return read(); } catch { return undefined; }
}

export function collectAppDiagnostics(): AppDiagnostics {
  const config = Constants.expoConfig;
  const platformConstants = (Platform as unknown as { constants?: Record<string, unknown> }).constants ?? {};
  const isNative = Platform.OS === 'ios' || Platform.OS === 'android';
  return {
    appVersion: str(config?.version),
    buildNumber: str(
      // Native build number stamped by EAS (appVersionSource: remote).
      safe(() => (Constants as unknown as { nativeBuildVersion?: string }).nativeBuildVersion)
        ?? (Platform.OS === 'ios' ? config?.ios?.buildNumber : config?.android?.versionCode),
    ),
    platform: Platform.OS,
    osVersion: str(Platform.Version),
    deviceModel: str(platformConstants.Model ?? safe(() => Constants.deviceName)),
    updateId: isNative ? str(safe(() => Updates.updateId)) : undefined,
    updateChannel: isNative ? str(safe(() => Updates.channel)) : undefined,
    locale: str(safe(() => Intl.DateTimeFormat().resolvedOptions().locale)),
  };
}

/** "1.0.0 (42)" — or just "1.0.0" when no build number is available. */
export function formatAppVersion(d: Pick<AppDiagnostics, 'appVersion' | 'buildNumber'>): string {
  const version = d.appVersion ?? '1.0.0';
  return d.buildNumber ? `${version} (${d.buildNumber})` : version;
}
