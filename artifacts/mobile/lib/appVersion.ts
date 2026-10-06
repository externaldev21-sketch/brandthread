/**
 * The app's real version for "About" rows and settings footers, read from the
 * build's config (app.json "version", bumped per release) instead of a
 * hard-coded string. Native builds add the store build number when present.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function appVersion(): string {
  const version = Constants.expoConfig?.version ?? '';
  const build = Platform.OS === 'ios'
    ? Constants.expoConfig?.ios?.buildNumber
    : Platform.OS === 'android'
      ? Constants.expoConfig?.android?.versionCode
      : undefined;
  if (!version) return '';
  return build != null && build !== '' ? `${version} (${build})` : version;
}
