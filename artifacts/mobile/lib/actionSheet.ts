/**
 * A genuine native action sheet (`ActionSheetIOS.showActionSheetWithOptions`)
 * on iOS, falling back to `Alert.alert` on Android/web — there is no existing
 * true action-sheet helper in this codebase (lib/safety.ts's `confirmBlock`
 * just uses `Alert.alert` everywhere). Used for the Requests-tab "Block"
 * confirmation, which the Instagram/TikTok message-request references both
 * present as a bottom action sheet rather than a centered dialog.
 */
import { ActionSheetIOS, Alert, Platform } from 'react-native';

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
