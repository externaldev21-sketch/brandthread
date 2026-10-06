import Constants from 'expo-constants';
import { DEV_SELLER_PREVIEW } from '@/lib/buildFlags';

/** Development-only, non-identifying runtime version diagnostics. */
export function logNativeRuntimeDiagnostics(): void {
  if (!__DEV__) return;
  console.info('[runtime] native compatibility', {
    executionEnvironment: Constants.executionEnvironment ?? null,
    sdkVersion: Constants.expoConfig?.sdkVersion ?? null,
    expoVersion: Constants.expoVersion ?? null,
    previewFlagEnabled: DEV_SELLER_PREVIEW,
    previewFlagSelection: DEV_SELLER_PREVIEW ? 'seller' : 'off',
    // Literal metadata requires are Metro-safe and never initialize either
    // native library. Metro cannot resolve require(variable).
    reanimatedVersion: require('react-native-reanimated/package.json').version,
    workletsVersion: require('react-native-worklets/package.json').version,
  });
}