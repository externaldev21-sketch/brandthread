/**
 * A genuine native action sheet (`ActionSheetIOS.showActionSheetWithOptions`)
 * on iOS, falling back to `Alert.alert` on Android/web — there is no existing
 * true action-sheet helper in this codebase (lib/safety.ts's `confirmBlock`
 * just uses `Alert.alert` everywhere). Used for the Requests-tab "Block"
 * confirmation, which the Instagram/TikTok message-request references both
 * present as a bottom action sheet rather than a centered dialog.
 */
import { ActionSheetIOS, Alert, Platform, type AlertButton, type AlertOptions } from 'react-native';

export interface ConfirmActionSheetOptions {
  title: string;
  message?: string;
  /** Label for the destructive confirming action, e.g. "Block". */
  confirmLabel: string;
  cancelLabel?: string;
}

/** Resolves true only if the person picked the destructive confirm option. */
export function confirmDestructiveActionSheet(options: ConfirmActionSheetOptions): Promise<boolean> {
  const cancelLabel = options.cancelLabel ?? 'Cancel';
  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: options.title,
          message: options.message,
          options: [options.confirmLabel, cancelLabel],
          destructiveButtonIndex: 0,
          cancelButtonIndex: 1,
        },
        (buttonIndex) => resolve(buttonIndex === 0),
      );
      return;
    }
    Alert.alert(
      options.title,
      options.message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        { text: options.confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

// ─── showAlert / confirmAlert ────────────────────────────────────────────────
//
// Same arguments as `Alert.alert`. On web, components/ui/WebAlertHost.tsx
// (mounted by <ActionSheetHost />) polyfills `Alert.alert` with a themed
// dialog, so one call works on every platform.

export type AlertButtonSpec = AlertButton;

/** Drop-in replacement for `Alert.alert(title, message, buttons, options)`. */
export function showAlert(title: string, message?: string, buttons?: AlertButtonSpec[], options?: AlertOptions): void {
  Alert.alert(title, message, buttons && buttons.length ? buttons : [{ text: 'OK' }], options);
}

export interface ConfirmAlertOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red on iOS). */
  destructive?: boolean;
}

/** Two-button confirm on every platform. Resolves true only on confirm. */
export function confirmAlert(options: ConfirmAlertOptions): Promise<boolean> {
  return new Promise((resolve) => {
    showAlert(
      options.title,
      options.message,
      [
        { text: options.cancelLabel ?? 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: options.confirmLabel, style: options.destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
