/**
 * App Lock — requires Face ID / Touch ID / fingerprint (with the device
 * passcode as fallback) when Brandthread opens and when it returns from the
 * background after the chosen grace period.
 *
 * Settings live in SecureStore on the device. The decision helpers are pure so
 * they can be unit-tested without native modules.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';

/** Existing key from the original Biometric Unlock switch — kept for continuity. */
export const APP_LOCK_ENABLED_KEY = 'bt:biometric:enabled';
export const APP_LOCK_GRACE_KEY = 'bt:biometric:grace-seconds';

export const GRACE_OPTIONS = [
  { seconds: 0, label: 'Immediately' },
  { seconds: 60, label: 'After 1 minute' },
  { seconds: 300, label: 'After 5 minutes' },
  { seconds: 900, label: 'After 15 minutes' },
] as const;

export type GraceSeconds = typeof GRACE_OPTIONS[number]['seconds'];
export const DEFAULT_GRACE_SECONDS: GraceSeconds = 0;

export interface AppLockSettings {
  enabled: boolean;
  graceSeconds: GraceSeconds;
}

export function parseGraceSeconds(raw: string | null | undefined): GraceSeconds {
  const value = Number(raw);
  const match = GRACE_OPTIONS.find((option) => option.seconds === value);
  return match ? match.seconds : DEFAULT_GRACE_SECONDS;
}

/**
 * Should the app lock when it becomes active again?
 * Locks when the feature is on and the app spent at least the grace period in
 * the background. A missing background timestamp (cold start) always locks.
 */
export function shouldLockOnResume(params: {
  enabled: boolean;
  backgroundedAt: number | null;
  now: number;
  graceSeconds: number;
}): boolean {
  if (!params.enabled) return false;
  if (params.backgroundedAt === null) return true;
  return params.now - params.backgroundedAt >= params.graceSeconds * 1000;
}

/** Friendly name for the strongest biometric the device offers. */
export function biometricLabel(types: LocalAuthentication.AuthenticationType[], platform = Platform.OS): string {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
    return platform === 'ios' ? 'Face ID' : 'Face Unlock';
  }
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
    return platform === 'ios' ? 'Touch ID' : 'Fingerprint';
  }
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'Iris';
  return 'Passcode';
}

export interface DeviceSecurity {
  /** True when the platform supports app lock at all (not web). */
  supported: boolean;
  /** Biometrics are enrolled; otherwise the device passcode is used. */
  hasBiometrics: boolean;
  /** A passcode/PIN or biometric is configured, so the OS can authenticate. */
  hasDeviceSecurity: boolean;
  label: string;
}

export async function getDeviceSecurity(): Promise<DeviceSecurity> {
  if (Platform.OS === 'web') {
    return { supported: false, hasBiometrics: false, hasDeviceSecurity: false, label: 'Biometrics' };
  }
  try {
    const [hasHardware, enrolled, level, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const hasBiometrics = hasHardware && enrolled;
    return {
      supported: true,
      hasBiometrics,
      hasDeviceSecurity: level !== LocalAuthentication.SecurityLevel.NONE,
      label: hasBiometrics ? biometricLabel(types) : 'Passcode',
    };
  } catch {
    return { supported: true, hasBiometrics: false, hasDeviceSecurity: false, label: 'Passcode' };
  }
}

export async function loadAppLockSettings(): Promise<AppLockSettings> {
  if (Platform.OS === 'web') return { enabled: false, graceSeconds: DEFAULT_GRACE_SECONDS };
  try {
    const [enabled, grace] = await Promise.all([
      SecureStore.getItemAsync(APP_LOCK_ENABLED_KEY),
      SecureStore.getItemAsync(APP_LOCK_GRACE_KEY),
    ]);
    return { enabled: enabled === 'true', graceSeconds: parseGraceSeconds(grace) };
  } catch {
    return { enabled: false, graceSeconds: DEFAULT_GRACE_SECONDS };
  }
}

type Listener = (settings: AppLockSettings) => void;
const listeners = new Set<Listener>();

/** Notified when settings change so the running lock gate picks them up. */
export function subscribeAppLock(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function saveAppLockSettings(next: AppLockSettings): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(APP_LOCK_ENABLED_KEY, next.enabled ? 'true' : 'false'),
    SecureStore.setItemAsync(APP_LOCK_GRACE_KEY, String(next.graceSeconds)),
  ]);
  listeners.forEach((listener) => listener(next));
}

export type UnlockResult = { success: true } | { success: false; error: string; cancelled: boolean };

/**
 * Ask the OS to authenticate. Biometrics are tried first and the device
 * passcode is always offered as the fallback (and used directly on devices
 * without enrolled biometrics).
 */
export async function authenticateForAppLock(options: { reason?: string } = {}): Promise<UnlockResult> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: options.reason ?? 'Unlock Brandthread',
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });
    if (result.success) return { success: true };
    const cancelled = result.error === 'user_cancel' || result.error === 'system_cancel' || result.error === 'app_cancel';
    return { success: false, error: result.error, cancelled };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'unknown', cancelled: false };
  }
}
