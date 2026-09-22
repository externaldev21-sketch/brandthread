import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { currentLogBytes, metroBundleStatus, startupFailure } from './expo-go-startup-core.mjs';

const layout = readFileSync(new URL('../app/_layout.tsx', import.meta.url), 'utf8');
const deviceFlow = readFileSync(new URL('./expo-go-startup.device.mjs', import.meta.url), 'utf8');
const coreFlow = readFileSync(new URL('./expo-go-startup-core.mjs', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const betaGuide = readFileSync(new URL('../docs/mobile-beta-validation.md', import.meta.url), 'utf8');

describe('Expo Go startup smoke contract', () => {
  it('keeps an accessibility marker behind the fully mounted root route tree', () => {
    expect(layout).toContain('testID="expo-go-startup-ready"');
    expect(layout).toContain('accessibilityLabel="Brandthread startup ready"');
  });

  it('cold launches both Expo Go platforms and retains failure diagnostics', () => {
    expect(deviceFlow).toContain("execFileSync('adb', [...adbArgs(), 'logcat', '-c']");
    expect(deviceFlow).toContain("'logcat', '--pid', pid");
    expect(deviceFlow).toContain("script: 'mobile: terminateApp'");
    expect(deviceFlow).toContain("script: 'mobile: activateApp'");
    expect(deviceFlow).toContain("script: 'mobile: deepLink'");
    expect(deviceFlow).toContain('assertScreenshotIsNotBlank');
    expect(coreFlow).toContain('Unable to resolve module');
    expect(deviceFlow).toContain("'page-source.xml'");
    expect(deviceFlow).toContain("'device.log'");
    expect(deviceFlow).toContain("'metro.log'");
    expect(packageJson.scripts['test:expo-go-startup:ios:ci']).toContain('EXPO_GO_STARTUP_PLATFORM=ios');
    expect(packageJson.scripts['test:expo-go-startup:android:ci']).toContain('EXPO_GO_STARTUP_PLATFORM=android');
  });

  it('ignores stale retained errors and requires a clean current platform bundle', () => {
    const stale = Buffer.from('Unable to resolve module stale-screen\\n');
    const current = Buffer.from('Android Bundled 812ms expo-router/entry.js (2400 modules)\\n');
    const logs = currentLogBytes(Buffer.concat([stale, current]), stale.length);

    expect(startupFailure(logs)).toBeUndefined();
    expect(metroBundleStatus(logs, 'android')).toEqual({ ready: true, failure: null });
    expect(metroBundleStatus(logs, 'ios').ready).toBe(false);
  });

  it('rejects missing-module errors from the current Metro launch window', () => {
    const logs = [
      'Android Bundled 300ms expo-router/entry.js (2400 modules)',
      'Unable to resolve module react-native-broken-native-module from app/_layout.tsx',
    ].join('\\n');
    const status = metroBundleStatus(logs, 'android');

    expect(status.ready).toBe(false);
    expect(status.failure).toBeInstanceOf(RegExp);
  });

  it('makes both platform launches part of the documented release verification', () => {
    expect(packageJson.scripts['verify:release:expo-go']).toContain('test:expo-go-startup:ios:ci');
    expect(packageJson.scripts['verify:release:expo-go']).toContain('test:expo-go-startup:android:ci');
    expect(betaGuide).toContain('pnpm run verify:release:expo-go');
    expect(betaGuide).toContain('after any dependency or navigation change');
  });
});