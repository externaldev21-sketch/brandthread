import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Returns the inset needed above custom screen headers.
 *
 * Native headers must begin below the status bar or notch. Expo web does not
 * report a native safe-area inset, so keep room for the preview status area.
 */
export function useHeaderTopInset(): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'web' ? 67 : insets.top;
}