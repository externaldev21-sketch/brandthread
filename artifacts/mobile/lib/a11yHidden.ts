import { Platform } from 'react-native';

type ImportantForAccessibility = 'no-hide-descendants' | 'no' | 'auto' | 'yes';

/**
 * Hides an element (and by default its descendants) from assistive tech,
 * cross-platform. `accessibilityElementsHidden` (iOS) and
 * `importantForAccessibility` (Android) are native-only prop names that
 * React Native Web does not translate — spreading them onto a web host
 * component (View, Pressable, or a react-native-svg element, which renders
 * straight to a DOM node) leaks them onto the DOM and React logs "does not
 * recognize the ... prop on a DOM element". `aria-hidden` is the web-correct
 * equivalent.
 */
export function a11yHidden(hidden: boolean, important: ImportantForAccessibility = 'no-hide-descendants') {
  if (Platform.OS === 'web') return { 'aria-hidden': hidden } as const;
  return {
    accessibilityElementsHidden: hidden,
    importantForAccessibility: hidden ? important : 'auto',
  } as const;
}
