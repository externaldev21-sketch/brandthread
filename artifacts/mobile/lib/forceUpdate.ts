/**
 * Decides whether the blocking "Update Brandthread" screen should show.
 * Pure (no React Native imports) so every branch is unit-tested.
 *
 * It only ever blocks when ALL of these hold:
 *   - a release build on iOS or Android (never web, never __DEV__);
 *   - the server config loaded (an endpoint failure never blocks);
 *   - the server names a minimum version for this platform;
 *   - this build's version parses and is strictly older than it;
 *   - there is a store URL to send the person to (no dead-end screen);
 *   - the `force_update_gate` release flag is on (remote kill switch).
 */
import type { AppConfig } from '@/lib/appConfig';
import { isVersionBelow } from '@/lib/semver';

export const ANDROID_PACKAGE_FALLBACK = 'com.brandthread.mobile';

export type ForceUpdateInput = {
  platform: string;
  isDev: boolean;
  gateEnabled: boolean;
  currentVersion: string | null | undefined;
  config: AppConfig | null;
  /** Build-time App Store numeric id (EXPO_PUBLIC_IOS_APP_STORE_ID), when known. */
  iosAppStoreId?: string | null;
  androidPackage?: string | null;
};

/** The store listing to open, or null when none is known for the platform. */
export function resolveStoreUrl(input: Pick<ForceUpdateInput, 'platform' | 'config' | 'iosAppStoreId' | 'androidPackage'>): string | null {
  if (input.platform === 'ios') {
    const fromServer = input.config?.storeUrls.ios;
    if (fromServer) return fromServer;
    const id = input.iosAppStoreId?.trim();
    return id && /^\d{5,15}$/.test(id) ? `https://apps.apple.com/app/id${id}` : null;
  }
  if (input.platform === 'android') {
    const fromServer = input.config?.storeUrls.android;
    if (fromServer) return fromServer;
    const pkg = (input.androidPackage ?? ANDROID_PACKAGE_FALLBACK).trim();
    return /^[A-Za-z][\w]*(\.[A-Za-z][\w]*)+$/.test(pkg)
      ? `https://play.google.com/store/apps/details?id=${pkg}`
      : null;
  }
  return null;
}

/** The store URL when an update is required, otherwise null. */
export function requiredUpdateUrl(input: ForceUpdateInput): string | null {
  if (input.isDev || !input.gateEnabled || !input.config) return null;
  if (input.platform !== 'ios' && input.platform !== 'android') return null;
  const minimum = input.config.minSupportedVersion[input.platform];
  if (!minimum || !isVersionBelow(input.currentVersion, minimum)) return null;
  return resolveStoreUrl(input);
}
