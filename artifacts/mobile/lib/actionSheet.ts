/**
 * A genuine native action sheet (`ActionSheetIOS.showActionSheetWithOptions`)
 * on iOS, falling back to `Alert.alert` on Android and a themed modal on web
 * (see `showAlert` below) — there is no existing
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
    showAlert(
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

// ─── Cross-platform alert / confirm ──────────────────────────────────────────
//
// `Alert.alert` is a silent no-op on react-native-web (`static alert() {}`),
// so every confirm, error and Alert-built menu was a dead tap in the web
// build. `showAlert` takes the exact `Alert.alert` arguments: on iOS/Android it
// calls `Alert.alert` unchanged; on web it hands the alert to the themed modal
// host (components/ui/WebAlertHost.tsx, mounted once in app/_layout.tsx).

export type AlertButtonSpec = AlertButton;

export interface WebAlertRequest {
  title: string;
  message?: string;
  buttons: AlertButtonSpec[];
  options?: AlertOptions;
}

type WebAlertPresenter = (request: WebAlertRequest) => void;

let webAlertPresenter: WebAlertPresenter | null = null;
/** Alerts raised before the host mounted; flushed when it registers. */
const pendingWebAlerts: WebAlertRequest[] = [];

/** Called by <WebAlertHost /> on mount (and with null on unmount). */
export function registerWebAlertPresenter(presenter: WebAlertPresenter | null): void {
  webAlertPresenter = presenter;
  if (presenter) {
    while (pendingWebAlerts.length) presenter(pendingWebAlerts.shift()!);
  }
}

/** Drop-in replacement for `Alert.alert(title, message, buttons, options)`. */
export function showAlert(title: string, message?: string, buttons?: AlertButtonSpec[], options?: AlertOptions): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, buttons, options);
    return;
  }
  const request: WebAlertRequest = {
    title,
    message,
    buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }],
    options,
  };
  if (webAlertPresenter) webAlertPresenter(request);
  // No themed host registered: dev's lib/webAlert.ts polyfill renders
  // Alert.alert on web (components/ui/WebAlertHost.tsx installs it).
  else Alert.alert(title, message, request.buttons, options);
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
