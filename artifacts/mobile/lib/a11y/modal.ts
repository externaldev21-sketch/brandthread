import { Platform } from 'react-native';

/**
 * Props that mark a sheet/dialog container as modal for assistive tech, so a
 * screen reader's focus stays inside it instead of wandering to the screen
 * behind. `accessibilityViewIsModal` is iOS-native only and react-native-web
 * does not translate it (it would leak onto the DOM and log a React warning),
 * so web gets the equivalent `aria-modal` instead. Spread onto the sheet View.
 */
export function a11yModalProps() {
  if (Platform.OS === 'web') return { 'aria-modal': true } as const;
  return { accessibilityViewIsModal: true } as const;
}
