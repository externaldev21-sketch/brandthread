/**
 * Renders every `Alert.alert` in the app in-app (see lib/appAlert.ts for
 * which pattern a call gets, and why call sites don't change).
 *
 * Reference app: Instagram iOS, copied 1:1 and reskinned black/white/silver:
 *  - dialog  "Log out of your account?" — centred card, bold centred title,
 *            centred message, stacked full-width text buttons separated by
 *            hairlines, destructive red first, Cancel last.
 *            https://mobbin.com/screens/f3f4faa3-961a-4634-9a2f-5ba985ccf800
 *  - menu    profile ⋯ options — floating rounded card of centred rows
 *            (destructive red), separate Cancel card below.
 *            https://mobbin.com/screens/94c3def2-b295-4f2c-94f1-63fb92ba88e9
 *  - toast   bottom snackbar above the tab bar — bold title line, message
 *            line under it, left-aligned.
 *            https://mobbin.com/screens/b98be851-b218-4caf-8d12-1b5e7b7609c7
 *
 * Mounted once in app/_layout.tsx. Layering:
 *  - iOS: `FullWindowOverlay` (its own window), so a confirmation raised from
 *    inside an open `<Modal>` sheet still shows on top, and it never fights a
 *    modal that is dismissing in the same tick.
 *  - Android / web: a transparent `<Modal>` for dialog/menu (stacks above
 *    other dialogs, hardware back = dismiss); the toast is a plain overlay
 *    that never blocks touches.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Keyboard, Modal, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, RED } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';
import { DENSE_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import { hapticLight } from '@/lib/haptics';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import {
  installAppAlert, resolveAppAlert, subscribeAppAlerts,
  type AppAlertButton, type AppAlertRequest,
} from '@/lib/appAlert';

installAppAlert();

/** Solid surface: #1C1C1E on the default Monochrome theme, the theme's own card colour otherwise. */
export function alertSurface(theme: AppThemePreset): string {
  return theme.id === 'monochrome' ? '#1C1C1E' : theme.card;
}

const SEPARATOR = 'rgba(192,192,192,0.18)';
const DIALOG_WIDTH = 290;
const TOAST_MS = 2600;
const TOAST_MS_PER_CHAR = 25;
/** Clears both tab bars (buyer pill and seller bar) so a toast never sits under them. */
const TOAST_BOTTOM_CLEARANCE = 96;

export function AppAlertHost() {
  const [queue, setQueue] = useState<AppAlertRequest[]>([]);
  useEffect(() => subscribeAppAlerts(setQueue), []);

  const sheet = queue.find((r) => r.kind === 'sheet');
  const toast = queue.find((r) => r.kind === 'toast');

  return (
    <>
      {toast && toast.kind === 'toast' ? <AlertToast key={toast.id} req={toast} /> : null}
      {sheet && sheet.kind === 'sheet' ? <AlertSheet key={sheet.id} req={sheet} /> : null}
    </>
  );
}

// ─── Toast ──────────────────────────────────────────────────────────────────

function AlertToast({ req }: { req: Extract<AppAlertRequest, { kind: 'toast' }> }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const native = Platform.OS !== 'web';

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility?.(req.text);
    Animated.timing(anim, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
    const ms = TOAST_MS + req.text.length * TOAST_MS_PER_CHAR;
    const timer = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 160, useNativeDriver: native }).start(() => resolveAppAlert(req.id));
    }, ms);
    return () => clearTimeout(timer);
  }, [anim, native, req.id, req.text]);

  // Title + message: Instagram's two-line snackbar. One of them alone: a single line.
  const two = !!req.title && !!req.message;
  const body = (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        pointerEvents="box-none"
        style={[
          toastStyles.wrap,
          { bottom: insets.bottom + TOAST_BOTTOM_CLEARANCE, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] },
        ]}
      >
        <Pressable
          onPress={() => resolveAppAlert(req.id)}
          accessibilityRole="alert"
          accessibilityLabel={req.text}
          accessibilityHint="Dismisses this message"
          style={[toastStyles.bar, { backgroundColor: alertSurface(theme) }]}
          testID="app-alert-toast"
        >
          {two ? (
            <>
              <Text style={[toastStyles.title, { color: theme.text }]} numberOfLines={1} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
                {req.title}
              </Text>
              <Text style={[toastStyles.message, { color: theme.muted }]} numberOfLines={3} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
                {req.message}
              </Text>
            </>
          ) : (
            <Text style={[toastStyles.single, { color: theme.text }]} numberOfLines={3} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
              {req.text}
            </Text>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );

  return Platform.OS === 'ios' ? <FullWindowOverlay>{body}</FullWindowOverlay> : body;
}

const toastStyles = StyleSheet.create({
  wrap: { position: 'absolute', left: SPACING.sm, right: SPACING.sm, alignItems: 'center' },
  bar: {
    width: '100%',
    maxWidth: 560,
    minHeight: 48,
    borderRadius: RADII.card,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    justifyContent: 'center',
  },
  title: { fontSize: 15, lineHeight: 20, fontFamily: FONT.semibold },
  message: { fontSize: 14, lineHeight: 19, fontFamily: FONT.regular, marginTop: 2 },
  single: { fontSize: 15, lineHeight: 20, fontFamily: FONT.medium },
});

// ─── Dialog / menu ──────────────────────────────────────────────────────────

function AlertSheet({ req }: { req: Extract<AppAlertRequest, { kind: 'sheet' }> }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const anim = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const native = Platform.OS !== 'web';

  useEffect(() => {
    Keyboard.dismiss();
    const label = [req.title, req.message].filter(Boolean).join('. ');
    if (label) AccessibilityInfo.announceForAccessibility?.(label);
    Animated.timing(anim, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [anim, native, req.message, req.title]);

  const close = (after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(anim, { toValue: 0, duration: 150, easing: Easing.in(Easing.cubic), useNativeDriver: native }).start(() => {
      resolveAppAlert(req.id);
      // Run the action after the overlay is gone, like the system alert does —
      // so an action that opens another alert, a modal or a route isn't
      // racing this one's exit.
      after?.();
    });
  };

  const press = (b: AppAlertButton) => {
    hapticLight();
    close(() => b.onPress?.());
  };
  const dismiss = () => {
    if (!req.onDismiss) return;
    close(req.onDismiss);
  };

  const surface = alertSurface(theme);
  const isMenu = req.layout === 'menu';
  // Dialog: Instagram's scale-in (iOS alert). Menu: slides up. Reduce Motion: fade only.
  const transform = useMemo(() => {
    if (reduceMotion) return [];
    return isMenu
      ? [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [360, 0] }) }]
      : [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1.08, 1] }) }];
  }, [anim, isMenu, reduceMotion]);

  const labelColor = (b: AppAlertButton) => (b.style === 'destructive' ? RED : theme.text);
  // Instagram: in a dialog the action is bold and Cancel regular; menu rows are all regular weight.
  const labelFont = (b: AppAlertButton) => (isMenu || b.style === 'cancel' ? FONT.regular : FONT.semibold);

  const header = (req.title || req.message) ? (
    <View style={isMenu ? sheetStyles.menuHeader : sheetStyles.dialogHeader}>
      {req.title ? (
        <Text accessibilityRole="header" style={[isMenu ? sheetStyles.menuTitle : sheetStyles.dialogTitle, { color: theme.text }]} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
          {req.title}
        </Text>
      ) : null}
      {req.message ? (
        <Text style={[sheetStyles.message, { color: theme.muted }, !req.title && { marginTop: 0 }]} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
          {req.message}
        </Text>
      ) : null}
    </View>
  ) : null;

  const row = (b: AppAlertButton, i: number, testID: string, divider: boolean) => (
    <Pressable
      key={`${b.text}-${i}`}
      onPress={() => press(b)}
      accessibilityRole="button"
      accessibilityLabel={b.text}
      style={({ pressed }) => [sheetStyles.row, divider && sheetStyles.rowDivider, pressed && sheetStyles.rowPressed]}
      testID={testID}
    >
      <Text
        style={[sheetStyles.rowText, { color: labelColor(b), fontFamily: labelFont(b) }]}
        numberOfLines={1}
        maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}
      >
        {b.text}
      </Text>
    </Pressable>
  );

  const cancel = isMenu ? req.buttons.find((b) => b.style === 'cancel') : undefined;
  const menuRows = isMenu ? req.buttons.filter((b) => b !== cancel) : [];

  const body = (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, sheetStyles.backdrop, { opacity: anim }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={dismiss}
          accessible={!!req.onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
      </Animated.View>

      {isMenu ? (
        <Animated.View
          pointerEvents="box-none"
          style={[sheetStyles.menuDock, { paddingBottom: Math.max(insets.bottom, SPACING.sm) + SPACING.xs, opacity: anim, transform }]}
        >
          <View style={sheetStyles.menuColumn} testID="app-alert-sheet">
            <View style={[sheetStyles.card, { backgroundColor: surface }]}>
              {header}
              {menuRows.map((b, i) => row(b, i, `app-alert-option-${i}`, i > 0 || !!header))}
            </View>
            {cancel ? (
              <View style={[sheetStyles.card, sheetStyles.cancelCard, { backgroundColor: surface }]}>
                {row(cancel, 0, 'app-alert-cancel', false)}
              </View>
            ) : null}
          </View>
        </Animated.View>
      ) : (
        <View pointerEvents="box-none" style={sheetStyles.dialogCenter}>
          <Animated.View style={[sheetStyles.card, sheetStyles.dialog, { backgroundColor: surface, opacity: anim, transform }]} testID="app-alert-sheet">
            {header}
            {req.buttons.map((b, i) => row(b, i, `app-alert-button-${i}`, i > 0 || !!header))}
          </Animated.View>
        </View>
      )}
    </View>
  );

  if (Platform.OS === 'ios') return <FullWindowOverlay>{body}</FullWindowOverlay>;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={dismiss}>
      {body}
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },
  card: { borderRadius: RADII.sheet, overflow: 'hidden' },
  // Dialog
  dialogCenter: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl },
  dialog: { width: '100%', maxWidth: DIALOG_WIDTH },
  dialogHeader: { paddingHorizontal: SPACING.md, paddingTop: SPACING.lg, paddingBottom: SPACING.md, alignItems: 'center' },
  dialogTitle: { fontSize: 17, lineHeight: 22, fontFamily: FONT.semibold, textAlign: 'center' },
  // Menu
  menuDock: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingHorizontal: SPACING.sm },
  menuColumn: { width: '100%', maxWidth: 560 },
  menuHeader: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, alignItems: 'center' },
  menuTitle: { fontSize: 13, lineHeight: 18, fontFamily: FONT.semibold, textAlign: 'center' },
  cancelCard: { marginTop: SPACING.xs },
  // Shared
  message: { fontSize: 13, lineHeight: 18, fontFamily: FONT.regular, textAlign: 'center', marginTop: SPACING.xxs },
  row: { minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACING.md },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: SEPARATOR },
  rowPressed: { backgroundColor: 'rgba(192,192,192,0.10)' },
  rowText: { fontSize: 16, lineHeight: 21 },
});
