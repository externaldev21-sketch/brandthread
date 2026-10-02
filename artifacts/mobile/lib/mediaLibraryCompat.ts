import { Platform } from 'react-native';
import { isExpoGo } from '@/lib/expoGoRuntime';

type MediaLibraryShape = typeof import('expo-media-library/legacy');
type ExpoModulesCore = { requireOptionalNativeModule: (name: string) => unknown | null };
let cached: MediaLibraryShape | null | undefined;

function hasOptionalNativeModule(name: string): boolean {
  try {
    // expo-modules-core is Expo's bundled bridge; resolving it lazily keeps it
    // out of module initialization while still probing before media-library.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const core = require('expo-modules-core') as ExpoModulesCore;
    return !!core.requireOptionalNativeModule(name);
  } catch {
    return false;
  }
}

/**
 * Loads the legacy media-library API only after confirming its native module
 * exists. The package's newer entrypoint eagerly imports ExpoMediaLibraryNext,
 * which is not present in every Expo Go runtime.
 */
export function getMediaLibrary(): MediaLibraryShape | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web') {
    cached = null;
    return cached;
  }
  try {
    // Probe both generations without evaluating the package entrypoint. The
    // current consumers use the legacy paged API, so only that native
    // registration permits loading the /legacy JS entry.
    const nextApiAvailable = hasOptionalNativeModule('ExpoMediaLibraryNext');
    const legacyApiAvailable = hasOptionalNativeModule('ExpoMediaLibrary');
    if (!nextApiAvailable && !legacyApiAvailable) {
      cached = null;
      return cached;
    }
    if (!legacyApiAvailable) {
      cached = null;
      return cached;
    }
    // Do not statically import the package root or the new API here.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('expo-media-library/legacy') as MediaLibraryShape;
  } catch {
    cached = null;
  }
  return cached;
}

export function mediaLibraryUnavailableMessage(): string {
  return isExpoGo()
    ? 'Saving to Photos is unavailable in Expo Go. Open this feature in a development or production app build.'
    : 'Photo library access is unavailable in this app build.';
}

export function __resetMediaLibraryCompatForTests(): void {
  cached = undefined;
}