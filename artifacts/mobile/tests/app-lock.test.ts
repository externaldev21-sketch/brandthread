import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  store: new Map<string, string>(),
  authenticate: vi.fn(),
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => native.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => { native.store.set(key, value); },
}));
vi.mock('expo-local-authentication', () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  getEnrolledLevelAsync: async () => 3,
  supportedAuthenticationTypesAsync: async () => [2],
  authenticateAsync: native.authenticate,
}));

import {
  APP_LOCK_ENABLED_KEY, APP_LOCK_GRACE_KEY, authenticateForAppLock, biometricLabel, getDeviceSecurity,
  loadAppLockSettings, parseGraceSeconds, saveAppLockSettings, shouldLockOnResume, subscribeAppLock,
} from '../lib/appLock';

describe('app lock decisions', () => {
  it('always locks on a cold start when enabled', () => {
    expect(shouldLockOnResume({ enabled: true, backgroundedAt: null, now: 1_000, graceSeconds: 300 })).toBe(true);
  });

  it('never locks when disabled', () => {
    expect(shouldLockOnResume({ enabled: false, backgroundedAt: null, now: 1_000, graceSeconds: 0 })).toBe(false);
    expect(shouldLockOnResume({ enabled: false, backgroundedAt: 0, now: 10_000_000, graceSeconds: 0 })).toBe(false);
  });

  it('respects the grace period after backgrounding', () => {
    const backgroundedAt = 1_000_000;
    expect(shouldLockOnResume({ enabled: true, backgroundedAt, now: backgroundedAt + 59_000, graceSeconds: 60 })).toBe(false);
    expect(shouldLockOnResume({ enabled: true, backgroundedAt, now: backgroundedAt + 60_000, graceSeconds: 60 })).toBe(true);
    expect(shouldLockOnResume({ enabled: true, backgroundedAt, now: backgroundedAt + 1, graceSeconds: 0 })).toBe(true);
  });

  it('only accepts the offered grace periods', () => {
    expect(parseGraceSeconds('300')).toBe(300);
    expect(parseGraceSeconds('42')).toBe(0);
    expect(parseGraceSeconds(null)).toBe(0);
  });

  it('names the strongest biometric', () => {
    expect(biometricLabel([2], 'ios')).toBe('Face ID');
    expect(biometricLabel([1], 'ios')).toBe('Touch ID');
    expect(biometricLabel([1], 'android')).toBe('Fingerprint');
    expect(biometricLabel([], 'ios')).toBe('Passcode');
  });
});

describe('app lock storage and prompts', () => {
  beforeEach(() => {
    native.store.clear();
    native.authenticate.mockReset();
  });

  it('keeps using the original Biometric Unlock key and notifies the running gate', async () => {
    native.store.set(APP_LOCK_ENABLED_KEY, 'true');
    expect(await loadAppLockSettings()).toEqual({ enabled: true, graceSeconds: 0 });

    const seen: unknown[] = [];
    const unsubscribe = subscribeAppLock((next) => seen.push(next));
    await saveAppLockSettings({ enabled: true, graceSeconds: 60 });
    unsubscribe();
    expect(native.store.get(APP_LOCK_GRACE_KEY)).toBe('60');
    expect(seen).toEqual([{ enabled: true, graceSeconds: 60 }]);
  });

  it('prompts with the device passcode available as a fallback', async () => {
    native.authenticate.mockResolvedValue({ success: true });
    await expect(authenticateForAppLock()).resolves.toEqual({ success: true });
    expect(native.authenticate).toHaveBeenCalledWith(expect.objectContaining({
      disableDeviceFallback: false,
      fallbackLabel: 'Use Passcode',
    }));
  });

  it('reports cancellation separately from failure', async () => {
    native.authenticate.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    expect(await authenticateForAppLock()).toEqual({ success: false, error: 'user_cancel', cancelled: true });
    native.authenticate.mockResolvedValueOnce({ success: false, error: 'authentication_failed' });
    expect(await authenticateForAppLock()).toEqual({ success: false, error: 'authentication_failed', cancelled: false });
  });

  it('detects device security', async () => {
    expect(await getDeviceSecurity()).toEqual({ supported: true, hasBiometrics: true, hasDeviceSecurity: true, label: 'Face ID' });
  });
});

describe('app lock wiring', () => {
  it('mounts the lock gate at the root so it covers every screen', () => {
    const layout = readFileSync(resolve(__dirname, '../app/_layout.tsx'), 'utf8');
    expect(layout).toContain("import AppLockGate from '@/components/security/AppLockGate';");
    expect(layout).toContain('<AppLockGate />');
  });

  it('locks on resume from the background, not on the biometric prompt itself', () => {
    const gate = readFileSync(resolve(__dirname, '../components/security/AppLockGate.tsx'), 'utf8');
    expect(gate).toContain("AppState.addEventListener('change'");
    expect(gate).toContain("status === 'background'");
    expect(gate).toContain('shouldLockOnResume');
    expect(gate).toContain('<Modal');
  });

  it('declares the iOS Face ID usage description', () => {
    const appJson = JSON.parse(readFileSync(resolve(__dirname, '../app.json'), 'utf8'));
    const plugin = appJson.expo.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === 'expo-local-authentication');
    expect(plugin?.[1]?.faceIDPermission).toMatch(/Face ID/);
  });
});
