/**
 * Cross-platform action sheet — a 1:1 copy of the iOS action sheet
 * (UIAlertController, `.actionSheet` style), reskinned in Brandthread's
 * black/white/silver:
 *
 *  - a floating, inset group (8pt from the screen edges, 14pt corners) with an
 *    optional centred title + message header in small grey type,
 *  - full-width centred action rows (57pt, hairline separators), destructive
 *    rows in the theme's error colour,
 *  - the Cancel action split into its own group below, in semibold.
 *
 * It runs on the shared sheet engine (`useSheetTransition`): fast spring in,
 * swipe or flick down to dismiss, light haptic on open and dismiss, backdrop
 * fading in sync. A tapped action runs once the sheet has finished closing,
 * as on iOS, so an action that opens another sheet never fights this one.
 *
 * Every platform renders this sheet. `Alert.alert` (what most of this app
 * used for menus) is a centred alert on native and a silent no-op on web —
 * see `react-native-web/dist/exports/Alert/index.js` (`static alert() {}`) —
 * so menus built that way were either the wrong shape or dead.
 *
 * `showActionSheet` takes the same `{ text, onPress, style }[]` shape
 * `Alert.alert` takes, so a call site converts by swapping the import.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { a11yModalProps } from '@/lib/a11y/modal';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/BrandthreadUI';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { useSheetTransition } from '@/components/ui/useSheetTransition';
import { sheetSurfaceColor } from '@/lib/sheetSurface';
import { SHEET_BACKDROP_OPACITY } from '@/constants/motion';
import { useIsWebShell, WEB_SHELL_MAX_WIDTH } from '@/components/web/WebAppShell';

export type ActionSheetButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
};

type ActionSheetState = {
  title?: string;
  message?: string;
  buttons: ActionSheetButton[];
};

/**
 * Mounts once near the root (see app/_layout.tsx). Screens call the module-
 * level `showActionSheet` helper below; they don't need this context
 * directly or any local state of their own.
 */
export function ActionSheetHost() {
  const [state, setState] = useState<ActionSheetState | null>(null);
  const [visible, setVisible] = useState(false);
  const pendingAction = useRef<(() => void) | undefined>(undefined);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const isWebShell = useIsWebShell();

  const open = useCallback((title: string | undefined, message: string | undefined, buttons: ActionSheetButton[]) => {
    pendingAction.current = undefined;
    setState({ title, message, buttons: buttons.length ? buttons : [{ text: 'Cancel', style: 'cancel' }] });
    setVisible(true);
  }, []);

  useMemo(() => { registerActionSheetHost(open); }, [open]);

  const onClosed = useCallback(() => {
    setVisible(false);
    setState(null);
    const action = pendingAction.current;
    pendingAction.current = undefined;
    action?.();
  }, []);

  const {
    modalVisible, sheetStyle, backdropStyle, panGesture, onSheetLayout,
  } = useSheetTransition(visible, onClosed);

  const dismiss = (action?: () => void) => {
    pendingAction.current = action;
    setVisible(false);
  };

  const buttons = state?.buttons ?? [];
  const cancel = buttons.find(b => b.style === 'cancel');
  const actions = buttons.filter(b => b !== cancel);
  const surface = sheetSurfaceColor(theme);
  const separator = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border };

  return (
    <Modal
      visible={modalVisible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => dismiss(cancel?.onPress)}
    >
      <GestureHandlerRootView style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable
            style={[StyleSheet.absoluteFill, styles.backdrop]}
            onPress={() => dismiss(cancel?.onPress)}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          />
        </Animated.View>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            {...a11yModalProps()}
            onLayout={onSheetLayout}
            style={[styles.container, isWebShell && styles.containerWebShell, { paddingBottom: insets.bottom + 8 }, sheetStyle]}
            testID="action-sheet"
          >
            {actions.length > 0 || state?.title || state?.message ? (
              <View style={[styles.group, { backgroundColor: surface }]}>
                {state?.title || state?.message ? (
                  <View style={styles.header}>
                    {state?.title ? (
                      <Text style={[styles.title, { color: theme.muted }]} accessibilityRole="header">{state.title}</Text>
                    ) : null}
                    {state?.message ? <Text style={[styles.message, { color: theme.muted }]}>{state.message}</Text> : null}
                  </View>
                ) : null}
                {actions.map((btn, i) => (
                  <PressableScale
                    key={`${btn.text}-${i}`}
                    style={[styles.row, (i > 0 || !!state?.title || !!state?.message) && separator]}
                    activeScale={1}
                    onPress={() => dismiss(btn.onPress)}
                    accessibilityRole="button"
                    accessibilityLabel={btn.text}
                  >
                    <Text
                      style={[styles.rowText, { color: btn.style === 'destructive' ? theme.error : theme.text }]}
                      numberOfLines={1}
                    >
                      {btn.text}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            ) : null}
            {cancel ? (
              <View style={[styles.group, styles.cancelGroup, { backgroundColor: surface }]}>
                <PressableScale
                  style={styles.row}
                  activeScale={1}
                  onPress={() => dismiss(cancel.onPress)}
                  accessibilityRole="button"
                  accessibilityLabel={cancel.text}
                >
                  <Text style={[styles.rowText, styles.cancelText, { color: theme.text }]} numberOfLines={1}>{cancel.text}</Text>
                </PressableScale>
              </View>
            ) : null}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

let hostOpen: ((title: string | undefined, message: string | undefined, buttons: ActionSheetButton[]) => void) | null = null;
function registerActionSheetHost(fn: typeof hostOpen) {
  hostOpen = fn;
}

/**
 * Drop-in replacement for `Alert.alert(title, message, buttons)`. Renders the
 * themed action sheet from `<ActionSheetHost />` (mounted once near the app
 * root, in app/_layout.tsx) on every platform.
 */
export function showActionSheet(title: string | undefined, message: string | undefined, buttons: ActionSheetButton[]): void {
  if (!hostOpen) {
    // Host not mounted yet (e.g. called before first render finishes): use
    // the OS alert on native rather than silently doing nothing.
    if (__DEV__) console.warn('[ActionSheet] shown before <ActionSheetHost /> mounted');
    Alert.alert(title ?? '', message, buttons);
    return;
  }
  hostOpen(title, message, buttons);
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: `rgba(0,0,0,${SHEET_BACKDROP_OPACITY})` },
  container: { paddingHorizontal: 8, width: '100%' },
  containerWebShell: { maxWidth: WEB_SHELL_MAX_WIDTH, alignSelf: 'center' },
  group: { borderRadius: 14, overflow: 'hidden' },
  cancelGroup: { marginTop: 8 },
  header: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, alignItems: 'center', gap: 4 },
  title: { fontFamily: FONT.semibold, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  message: { fontFamily: FONT.regular, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  row: { minHeight: 57, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  rowText: { fontFamily: FONT.regular, fontSize: 20, lineHeight: 25 },
  cancelText: { fontFamily: FONT.semibold },
});
