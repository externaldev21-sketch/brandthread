import { PixelRatio, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Comfortable minimum clearance from a web browser's own chrome (tabs,
 *  bookmarks bar, …), which reports no safe-area inset of its own — see
 *  `useHeaderTopInset`'s doc. */
const WEB_MIN_TOP_INSET = 54;

/**
 * Returns the inset every custom screen header must pad above itself —
 * `ScreenHeader`, `BrandthreadScreen`, `ProfileShell`, `LegalDocument` and
 * every hand-rolled header row all call this one hook, so there's a single
 * place that knows the right number.
 *
 * Native headers must begin below the status bar or notch, which
 * `insets.top` already reports correctly. On web, `insets.top` reports the
 * browser's real `env(safe-area-inset-top)` (the root HTML document sets
 * `viewport-fit=cover`, see app/+html.tsx) — correct for a simulated notch
 * in a phone-frame preview, but 0 on a plain browser window, which has no
 * notch but still has its OWN chrome (tabs, address bar) a header shouldn't
 * sit flush against. `Math.max(insets.top, 54)` floors it there without
 * touching a real, larger simulated inset.
 */
export function useHeaderTopInset(): number {
  const insets = useSafeAreaInsets();
  return roundToDevicePixel(Platform.OS === 'web' ? Math.max(insets.top, WEB_MIN_TOP_INSET) : insets.top);
}

/**
 * Snaps a top inset to a whole device pixel. A fractional inset (some
 * Android densities, scaled web frames) puts the top edge of every header
 * on a half pixel, which antialiases into a faint line at the top of the
 * screen. Test environments that mock react-native without PixelRatio fall
 * back to whole points.
 */
export function roundToDevicePixel(value: number): number {
  try {
    return PixelRatio.roundToNearestPixel(value);
  } catch {
    return Math.round(value);
  }
}