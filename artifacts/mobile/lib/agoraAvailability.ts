import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import { isExpoGo } from '@/lib/expoGoRuntime';

let cached: any | null | undefined;

/** Agora is a custom native SDK: probe its native registration before loading JS bindings. */
export function loadAgoraModule(): any | null {
  if (cached !== undefined) return cached;
  if (Platform.OS === 'web' || isExpoGo()) return (cached = null);
  const nativeModule = NativeModules.AgoraRtcNg ?? TurboModuleRegistry.get('AgoraRtcNg');
  if (!nativeModule) return (cached = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('react-native-agora');
  } catch {
    cached = null;
  }
  return cached;
}

export function __resetAgoraModuleForTests(): void {
  cached = undefined;
}