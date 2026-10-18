import { Alert, Platform } from 'react-native';

/** A one-button alert that also shows on web, where RN's Alert.alert is a no-op. */
export function notify(title: string, message: string) {
  if (Platform.OS === 'web') {
    (globalThis as { alert?: (m: string) => void }).alert?.(`${title}\n\n${message}`);
    return;
  }
  Alert.alert(title, message);
}
