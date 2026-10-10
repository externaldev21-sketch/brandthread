/**
 * Two-button confirm that works on native (Alert) and web (window.confirm,
 * since react-native-web's Alert has no buttons). Resolves true for the
 * confirm button.
 */
import { Alert, Platform } from 'react-native';

export function confirmChoice(options: { title: string; message: string; confirm: string; cancel: string }): Promise<boolean> {
  if (Platform.OS === 'web') {
    const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
      ? window.confirm(`${options.title}\n\n${options.message}`)
      : true;
    return Promise.resolve(ok);
  }
  return new Promise((resolve) => {
    Alert.alert(options.title, options.message, [
      { text: options.cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: options.confirm, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
