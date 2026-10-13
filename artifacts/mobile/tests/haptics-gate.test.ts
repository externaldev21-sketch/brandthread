import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { createRequire } from 'module';

const real = vi.hoisted(() => ({
  impactAsync: vi.fn(() => Promise.resolve()),
  notificationAsync: vi.fn(() => Promise.resolve()),
  selectionAsync: vi.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: vi.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
  AndroidHaptics: { Confirm: 'confirm' },
}));
vi.mock('expo-haptics', () => real);

const stored = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async () => stored.value),
    setItem: vi.fn(async (_k: string, v: string) => { stored.value = v; }),
  },
}));

import * as Gated from '../shims/expo-haptics';
import { setHapticsDisabled } from '../lib/hapticsPreference';
import { DEFAULT_BUYER_SETTINGS } from '../lib/buyerSettings';

describe('gated expo-haptics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHapticsDisabled(false);
  });

  it('defaults to haptics on', () => {
    expect(DEFAULT_BUYER_SETTINGS.disableHaptics).toBe(false);
  });

  it('passes every call through when haptics are on', async () => {
    await Gated.impactAsync(Gated.ImpactFeedbackStyle.Light);
    await Gated.notificationAsync(Gated.NotificationFeedbackType.Success);
    await Gated.selectionAsync();
    await Gated.performAndroidHapticsAsync(Gated.AndroidHaptics.Confirm);
    expect(real.impactAsync).toHaveBeenCalledWith('light');
    expect(real.notificationAsync).toHaveBeenCalledWith('success');
    expect(real.selectionAsync).toHaveBeenCalledTimes(1);
    expect(real.performAndroidHapticsAsync).toHaveBeenCalledWith('confirm');
  });

  it('silences every call when "Disable haptic feedback" is on', async () => {
    setHapticsDisabled(true);
    await expect(Gated.impactAsync(Gated.ImpactFeedbackStyle.Medium)).resolves.toBeUndefined();
    await Gated.notificationAsync(Gated.NotificationFeedbackType.Success);
    await Gated.selectionAsync();
    await Gated.performAndroidHapticsAsync(Gated.AndroidHaptics.Confirm);
    expect(real.impactAsync).not.toHaveBeenCalled();
    expect(real.notificationAsync).not.toHaveBeenCalled();
    expect(real.selectionAsync).not.toHaveBeenCalled();
    expect(real.performAndroidHapticsAsync).not.toHaveBeenCalled();
  });

  it('re-exports the enums untouched', () => {
    expect(Gated.ImpactFeedbackStyle).toBe(real.ImpactFeedbackStyle);
    expect(Gated.NotificationFeedbackType).toBe(real.NotificationFeedbackType);
  });

  it('hydrates the saved preference', async () => {
    stored.value = JSON.stringify({ disableHaptics: true });
    vi.resetModules();
    const pref = await import('../lib/hapticsPreference');
    await pref.hydrateHapticsPreference();
    expect(pref.isHapticsDisabled()).toBe(true);
  });
});

describe('metro routes expo-haptics through the gate', () => {
  const require = createRequire(import.meta.url);
  const shim = path.resolve(__dirname, '../shims/expo-haptics.ts');

  function loadResolver() {
    const configPath = path.resolve(__dirname, '../metro.config.js');
    delete require.cache[configPath];
    return require(configPath).resolver.resolveRequest as (
      ctx: { originModulePath: string; resolveRequest: (...a: unknown[]) => unknown },
      name: string,
      platform: string,
    ) => { filePath: string } | unknown;
  }

  it('sends app imports to the shim and the shim to the real package', () => {
    const resolveRequest = loadResolver();
    const fallthrough = vi.fn(() => ({ filePath: 'real-expo-haptics', type: 'sourceFile' }));
    const appCtx = { originModulePath: path.resolve(__dirname, '../app/help.tsx'), resolveRequest: fallthrough };
    expect(resolveRequest(appCtx, 'expo-haptics', 'ios')).toEqual({ filePath: shim, type: 'sourceFile' });
    expect(fallthrough).not.toHaveBeenCalled();

    const shimCtx = { originModulePath: shim, resolveRequest: fallthrough };
    expect(resolveRequest(shimCtx, 'expo-haptics', 'ios')).toEqual({ filePath: 'real-expo-haptics', type: 'sourceFile' });
  });
});
