import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Returns the inset needed above custom screen headers.
 *
 * Native headers must begin below the status bar or notch. On web this used
 * to hardcode a fixed value because react-native-web's safe-area
 * implementation read 0 without `viewport-fit=cover` on the page's meta
 * viewport tag; that tag is now set (see app/+html.tsx), so `insets.top`
 * reports the browser's real `env(safe-area-inset-top)` on every platform,
 * including a simulated notch in a phone-frame preview.
 */
export function useHeaderTopInset(): number {
  const insets = useSafeAreaInsets();
  return insets.top;
}