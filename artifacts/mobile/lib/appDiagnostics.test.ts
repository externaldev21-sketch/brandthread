import { describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  os: 'ios' as string,
  version: '18.1' as string | number,
  constants: { Model: 'iPhone16,1' } as Record<string, unknown>,
  expoConfig: { version: '1.0.0', ios: { buildNumber: '7' } } as Record<string, any> | null,
  nativeBuildVersion: '42' as string | undefined,
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() { return env.os; },
    get Version() { return env.version; },
    get constants() { return env.constants; },
  },
}));
vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() { return env.expoConfig; },
    get nativeBuildVersion() { return env.nativeBuildVersion; },
    deviceName: 'Jordan’s iPhone',
  },
}));
vi.mock('expo-updates', () => ({ updateId: 'upd_123', channel: 'production' }));

import { collectAppDiagnostics, formatAppVersion } from './appDiagnostics';

describe('collectAppDiagnostics', () => {
  it('reads version, native build, OS, model and OTA update on iOS', () => {
    expect(collectAppDiagnostics()).toMatchObject({
      appVersion: '1.0.0',
      buildNumber: '42',
      platform: 'ios',
      osVersion: '18.1',
      deviceModel: 'iPhone16,1',
      updateId: 'upd_123',
      updateChannel: 'production',
    });
  });

  it('falls back to the config build number when the native one is missing', () => {
    env.nativeBuildVersion = undefined;
    expect(collectAppDiagnostics().buildNumber).toBe('7');
    env.nativeBuildVersion = '42';
  });

  it('leaves OTA details out on web', () => {
    env.os = 'web';
    const d = collectAppDiagnostics();
    expect(d.platform).toBe('web');
    expect(d.updateId).toBeUndefined();
    expect(d.updateChannel).toBeUndefined();
    env.os = 'ios';
  });
});

describe('formatAppVersion', () => {
  it('shows the build in parentheses when known', () => {
    expect(formatAppVersion({ appVersion: '1.2.0', buildNumber: '88' })).toBe('1.2.0 (88)');
    expect(formatAppVersion({ appVersion: '1.2.0' })).toBe('1.2.0');
  });
});
