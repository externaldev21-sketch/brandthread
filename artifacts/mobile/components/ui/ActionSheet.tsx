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
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetHandle, PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';

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
        <Pressable style={[styles.sheet, { backgroundColor: theme.card, paddingBottom: insets.bottom + SP.md }]} onPress={() => {}}>
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

/**
 * Drop-in replacement for `Alert.alert(title, message, buttons)`.
 *
 * On iOS/Android this just calls the real, platform-native `Alert.alert` —
 * unchanged behavior there. On web, where `Alert.alert` is a silent no-op,
 * it renders the themed sheet from `<ActionSheetHost />` (mounted once near
 * the app root, in app/_layout.tsx) instead.
 */
export function showActionSheet(title: string | undefined, message: string | undefined, buttons: ActionSheetButton[]): void {
  if (Platform.OS !== 'web') {
    Alert.alert(title ?? '', message, buttons);
    return;
  }
  if (!hostOpen) {
    // Host not mounted yet (e.g. called before first render finishes) —
    // fail safe rather than silently doing nothing.
    if (__DEV__) console.warn('[ActionSheet] shown before <ActionSheetHost /> mounted');
    return;
  }
  hostOpen(title, message, buttons);
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
