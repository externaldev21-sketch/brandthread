/**
 * Shared web-only style fragment that kills the browser's default focus-ring
 * rectangle on a <TextInput> (react-native-web renders it as a real
 * <input>/<textarea>, which browsers outline with a thick default ring —
 * often amber/orange — on focus unless that's explicitly suppressed).
 *
 * app/+html.tsx already carries a global `input:focus { outline: none }`
 * safety net for every text field on the page, so this constant is
 * belt-and-suspenders at the component level: it means a given TextInput's
 * own inline style also never renders the ring, even if the global
 * stylesheet is ever missing (a different html shell, a style tag stripped
 * by a proxy/CDN, etc.), and it gives every "search bar"-style TextInput one
 * single place to opt in rather than each screen inventing its own
 * `outlineStyle`/`outlineWidth` pair (which is exactly how this kept
 * regressing one field at a time).
 *
 * Usage: spread/append onto a TextInput's own `style` array —
 *   style={[existingStyle, WEB_INPUT_RESET]}
 * It resolves to `{}` on native, so it's always safe to include.
 */
import { Platform, TextStyle } from 'react-native';

// react-native-web accepts these as plain CSS-mapped style keys, but they
// aren't part of React Native's own TextStyle type (they're web-only), so
// this — like every prior one-off `outlineStyle: 'none' as any` it
// replaces — needs the cast.
export const WEB_INPUT_RESET: TextStyle =
  Platform.OS === 'web'
    ? ({
        outlineStyle: 'none',
        outlineWidth: 0,
        outlineColor: 'transparent',
        boxShadow: 'none',
      } as unknown as TextStyle)
    : {};
