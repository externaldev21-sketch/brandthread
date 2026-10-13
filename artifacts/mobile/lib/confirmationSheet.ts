/**
 * Pure helpers for components/ui/ActionSheet.tsx — confirmations are a
 * bottom action sheet, never a centered alert (Dev, Oct 13).
 */
export type SheetButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

/** True when an Alert.alert call is a confirmation (2+ choices). */
export function isConfirmationAlert(buttons: unknown): buttons is SheetButton[] {
  return Array.isArray(buttons) && buttons.length >= 2;
}

/** ActionSheetIOS options for an Alert-style button list. */
export function toIOSActionSheetOptions(
  title: string | undefined,
  message: string | undefined,
  buttons: readonly SheetButton[],
) {
  const cancelButtonIndex = buttons.findIndex((b) => b.style === 'cancel');
  const destructiveButtonIndex = buttons
    .map((b, i) => (b.style === 'destructive' ? i : -1))
    .filter((i) => i >= 0);
  return {
    options: buttons.map((b) => b.text),
    ...(cancelButtonIndex >= 0 ? { cancelButtonIndex } : {}),
    ...(destructiveButtonIndex.length ? { destructiveButtonIndex } : {}),
    ...(title ? { title } : {}),
    ...(message ? { message } : {}),
    userInterfaceStyle: 'dark' as const,
  };
}

const ERROR_START = /^(couldn[’']?t|can[’']?t|cannot|failed|error|something went wrong|unable|no connection|offline)/i;

/** Toast icon for a message when the caller didn't pick one. */
export function toastIconFor(message: string): 'alert-circle' | 'check' {
  return ERROR_START.test(message.trim()) ? 'alert-circle' : 'check';
}
