import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SP } from '@/lib/theme';

/**
 * Returns the padding every sticky/pinned bottom bar needs above the home
 * indicator (or, on web, a plain floor so it isn't flush against the
 * viewport edge on a device with no home indicator to report).
 *
 * Unlike the top inset (see `useHeaderTopInset`), a plain web browser needs
 * no special-cased floor beyond this same minimum — there's no browser
 * chrome hidden at the bottom of a window the way there's a tab/address bar
 * at the top, so `insets.bottom` (0 there) plus the floor is already right.
 * Mirrors the floor `components/layout/StickyFooter.tsx` already uses.
 */
export function useScreenBottomInset(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, SP.sm);
}
