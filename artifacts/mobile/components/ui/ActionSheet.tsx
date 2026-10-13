/**
 * Cross-platform action sheet.
 *
 * `Alert.alert(title, message, buttons)` is how most of this app shows an
 * options menu, but react-native-web's `Alert.alert` is a complete no-op —
 * see `react-native-web/dist/exports/Alert/index.js` (`static alert() {}`).
 * Every "More actions" menu built that way silently does nothing on web: no
 * error, no console warning, just no UI at all (docs/qa/full-crawl-report.md
 * #9/#10 — "More product/order actions" menus).
 *
 * `showActionSheet` gives call sites the same `{ text, onPress, style }[]`
 * shape `Alert.alert` takes, so a call site converts by swapping the import,
 * and renders a real themed bottom sheet on every platform (including web).
 *
 * Confirmations are always a bottom action sheet, never a centered alert
 * (Dev, Oct 13). `installConfirmationSheets()` (called once from
 * app/_layout.tsx) routes every `Alert.alert` that has 2+ buttons through
 * `presentActionSheet`: the native iOS action sheet (ActionSheetIOS) on iOS,
 * this themed bottom sheet on Android and web. One-button notices are left
 * to the platform.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { a11yModalProps } from '@/lib/a11y/modal';
import { ActionSheetIOS, Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetHandle, PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { ELEVATION, FONT, FS, SP, RADIUS } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';
import { isConfirmationAlert, toIOSActionSheetOptions } from '@/lib/confirmationSheet';

export { isConfirmationAlert, toIOSActionSheetOptions };

export type ActionSheetButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type ActionSheetState = {
  title?: string;
  message?: string;
  buttons: ActionSheetButton[];
} | null;

/**
 * Mounts once near the root (see app/_layout.tsx). Screens call the module-
 * level `showActionSheet` helper below; they don't need this context
 * directly or any local state of their own.
 */
export function ActionSheetHost() {
  const [state, setState] = useState<ActionSheetState>(null);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();

  const open = useCallback((title: string | undefined, message: string | undefined, buttons: ActionSheetButton[]) => {
    setState({ title, message, buttons: buttons.length ? buttons : [{ text: 'Cancel', style: 'cancel' }] });
  }, []);

  useMemo(() => { registerActionSheetHost(open); }, [open]);

  const close = () => setState(null);

  return (
    <Modal visible={!!state} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close menu">
        <Pressable {...a11yModalProps()} style={[styles.sheet, { backgroundColor: ELEVATION.sheet, paddingBottom: insets.bottom + SP.md }]} onPress={() => {}}>
          <SheetHandle />
          {(state?.title || state?.message) && (
            <View style={styles.header}>
              {state?.title ? <Text style={[styles.title, { color: theme.text }]}>{state.title}</Text> : null}
              {state?.message ? <Text style={[styles.message, { color: theme.muted }]}>{state.message}</Text> : null}
            </View>
          )}
          {state?.buttons.map((btn, i) => (
            <PressableScale
              key={`${btn.text}-${i}`}
              style={styles.row}
              onPress={() => {
                hapticLight();
                close();
                // Let the sheet's own close animation start before the
                // action runs (matches native action-sheet feel).
                setTimeout(() => btn.onPress?.(), 0);
              }}
              accessibilityRole="button"
              accessibilityLabel={btn.text}
            >
              <Text
                style={[
                  styles.rowText,
                  { color: btn.style === 'destructive' ? theme.error : btn.style === 'cancel' ? theme.muted : theme.text },
                  btn.style === 'cancel' && { fontFamily: FONT.semibold },
                ]}
              >
                {btn.text}
              </Text>
            </PressableScale>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

let hostOpen: ((title: string | undefined, message: string | undefined, buttons: ActionSheetButton[]) => void) | null = null;
function registerActionSheetHost(fn: typeof hostOpen) {
  hostOpen = fn;
}

/** Bottom action sheet on every platform: native on iOS, themed sheet elsewhere. */
export function presentActionSheet(title: string | undefined, message: string | undefined, buttons: ActionSheetButton[]): void {
  const list = buttons.length ? buttons : [{ text: 'Cancel', style: 'cancel' as const }];
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      toIOSActionSheetOptions(title, message, list),
      (index) => list[index]?.onPress?.(),
    );
    return;
  }
  if (!hostOpen) {
    // Host not mounted yet — fall back to the platform alert rather than
    // silently dropping the confirmation.
    if (__DEV__) console.warn('[ActionSheet] shown before <ActionSheetHost /> mounted');
    originalAlert?.(title ?? '', message, list);
    return;
  }
  hostOpen(title, message, list);
}

/**
 * Drop-in replacement for `Alert.alert(title, message, buttons)` — always a
 * bottom action sheet (see presentActionSheet).
 */
export function showActionSheet(title: string | undefined, message: string | undefined, buttons: ActionSheetButton[]): void {
  presentActionSheet(title, message, buttons);
}

type AlertFn = typeof Alert.alert;
let originalAlert: AlertFn | null = null;

/**
 * Route every confirmation `Alert.alert` (2+ buttons) to a bottom action
 * sheet. Idempotent; call once at startup.
 */
export function installConfirmationSheets(): void {
  if (originalAlert) return;
  originalAlert = Alert.alert.bind(Alert);
  const patched: AlertFn = (title, message, buttons, options) => {
    if (isConfirmationAlert(buttons)) {
      presentActionSheet(title || undefined, message || undefined, buttons as ActionSheetButton[]);
      return;
    }
    originalAlert!(title, message, buttons, options);
  };
  Alert.alert = patched;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm,
    paddingHorizontal: SP.lg,
  },
  header: { paddingVertical: SP.sm, alignItems: 'center' },
  title: { fontSize: FS.md, fontFamily: FONT.bold, textAlign: 'center' },
  message: { fontSize: FS.sm, marginTop: 2, textAlign: 'center' },
  row: { paddingVertical: SP.md, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(128,128,128,0.2)' },
  rowText: { fontSize: FS.md, fontFamily: FONT.regular },
});
