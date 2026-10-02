import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isExpoGoRuntime } from '../lib/expoGoRuntime';

vi.mock('expo-constants', () => ({
  default: { executionEnvironment: 'storeClient', appOwnership: 'expo' },
}));

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Expo Go native-module boundaries', () => {
  it('recognizes StoreClient and Expo app ownership independently of __DEV__', () => {
    expect(isExpoGoRuntime('storeClient', null)).toBe(true);
    expect(isExpoGoRuntime(null, 'expo')).toBe(true);
    expect(isExpoGoRuntime('standalone', null)).toBe(false);
  });

  it('keeps Sentry and RevenueCat native packages lazy and Expo Go gated', () => {
    const monitoring = source('lib/monitoring.ts');
    const revenueCat = source('lib/revenueCat.native.tsx');
    expect(monitoring).not.toMatch(/import \* as Sentry from '@sentry\/react-native'/);
    expect(monitoring.indexOf('if (isExpoGo()) return null')).toBeLessThan(
      monitoring.indexOf("require('@sentry/react-native')"),
    );
    expect(revenueCat).not.toMatch(/import Purchases[, ]/);
    expect(revenueCat.indexOf('if (isExpoGo()) return null')).toBeLessThan(
      revenueCat.indexOf("require('react-native-purchases')"),
    );
  });

  it('preflights media library native registration before lazy legacy loading', () => {
    const adapter = source('lib/mediaLibraryCompat.ts');
    expect(adapter).not.toContain("from 'expo-media-library");
    expect(adapter).toContain("hasOptionalNativeModule('ExpoMediaLibraryNext')");
    expect(adapter.indexOf("hasOptionalNativeModule('ExpoMediaLibrary')")).toBeLessThan(
      adapter.indexOf("require('expo-media-library/legacy')"),
    );
    expect(source('lib/mediaLibraryAdapter.native.ts')).not.toContain("from 'expo-media-library'");
  });

  it('checks Expo Go and native Agora registration before loading the SDK', () => {
    const agora = source('lib/agoraAvailability.ts');
    expect(agora.indexOf('Platform.OS === \'web\' || isExpoGo()')).toBeLessThan(
      agora.indexOf("require('react-native-agora')"),
    );
    expect(agora.indexOf('if (!nativeModule)')).toBeLessThan(
      agora.indexOf("require('react-native-agora')"),
    );
  });

  it('preflights keyboard-controller native registration and keeps Skia behind the Expo Go gate', () => {
    const keyboard = source('components/KeyboardProviderCompat.tsx');
    const skia = source('lib/skiaAvailability.ts');
    expect(keyboard).not.toContain("from 'react-native-keyboard-controller'");
    expect(keyboard.indexOf("TurboModuleRegistry.get('KeyboardController')")).toBeLessThan(
      keyboard.indexOf("require('react-native-keyboard-controller')"),
    );
    expect(skia.indexOf('if (isExpoGo())')).toBeLessThan(
      skia.indexOf("require('@shopify/react-native-skia')"),
    );
  });
});