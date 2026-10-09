/**
 * Renders every `Alert.alert` in the app as an in-app sheet or toast
 * (see lib/appAlert.ts for which one, and why call sites don't change).
 *
 * Mounted once in app/_layout.tsx. Layering:
 *  - iOS: `FullWindowOverlay` (its own window), so a confirmation raised from
 *    inside an open `<Modal>` sheet still shows on top, and it never fights a
 *    modal that is dismissing in the same tick.
 *  - Android / web: a transparent `<Modal>` for the sheet (stacks above other
 *    dialogs, hardware back = dismiss); the toast is a plain overlay that
 *    never blocks touches.
 *
 * Layout reference: Shop "Delete address" sheet (Mobbin) — title and message
 * left-aligned, two equal-width buttons side by side; 3+ choices stack as an
 * options list with Cancel at the bottom.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Keyboard, Modal, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { Button } from '@/components/ui/Button';
import { PressableScale } from '@/components/BrandthreadUI';
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

/** Solid sheet surface: #1C1C1E on the default Monochrome theme, the theme's own card colour otherwise. */
export function alertSurface(theme: AppThemePreset): string {
  return theme.id === 'monochrome' ? '#1C1C1E' : theme.card;
}

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
          style={[toastStyles.pill, { backgroundColor: alertSurface(theme) }]}
          testID="app-alert-toast"
        >
          <Text style={[toastStyles.text, { color: theme.text }]} numberOfLines={3} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
            {req.text}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );

  return Platform.OS === 'ios' ? <FullWindowOverlay>{body}</FullWindowOverlay> : body;
}

const toastStyles = StyleSheet.create({
  wrap: { position: 'absolute', left: SPACING.lg, right: SPACING.lg, alignItems: 'center' },
  pill: {
    maxWidth: 480,
    minHeight: 44,
    borderRadius: RADII.card,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    justifyContent: 'center',
  },
  text: { fontSize: 15, lineHeight: 20, fontFamily: FONT.medium, textAlign: 'center' },
});

// ─── Sheet ──────────────────────────────────────────────────────────────────

function buttonVariant(b: AppAlertButton, index: number, all: AppAlertButton[]): 'primary' | 'secondary' | 'destructive' {
  if (b.style === 'destructive') return 'destructive';
  if (b.style === 'cancel') return 'secondary';
  // One primary per sheet: the last non-cancel, non-destructive choice.
  const hasDestructive = all.some((x) => x.style === 'destructive');
  const lastDefault = [...all].reverse().find((x) => x.style === 'default');
  return !hasDestructive && b === lastDefault ? 'primary' : 'secondary';
}

function AlertSheet({ req }: { req: Extract<AppAlertRequest, { kind: 'sheet' }> }) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const anim = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const native = Platform.OS !== 'web';

  useEffect(() => {
    Keyboard.dismiss();
    const label = [req.title, req.message].filter(Boolean).join('. ');
    if (label) AccessibilityInfo.announceForAccessibility?.(label);
    Animated.timing(anim, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: native }).start();
  }, [anim, native, req.message, req.title]);

  const close = (after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(anim, { toValue: 0, duration: 160, easing: Easing.in(Easing.cubic), useNativeDriver: native }).start(() => {
      resolveAppAlert(req.id);
      // Run the action after the sheet is gone, like the system alert does —
      // so an action that opens another alert, a modal or a route isn't
      // racing this sheet's exit.
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
  const cancel = req.layout === 'list' ? req.buttons.find((b) => b.style === 'cancel') : undefined;
  const options = req.layout === 'list' ? req.buttons.filter((b) => b !== cancel) : [];
  // Reduce Motion: the sheet fades in place instead of sliding up.
  const reduceMotion = useReduceMotion();
  const translateY = useMemo(
    () => anim.interpolate({ inputRange: [0, 1], outputRange: [reduceMotion ? 0 : 320, 0] }),
    [anim, reduceMotion],
  );

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
      <Animated.View pointerEvents="box-none" style={[sheetStyles.dock, { transform: [{ translateY }] }]}>
        <View
          style={[sheetStyles.sheet, { backgroundColor: surface, paddingBottom: Math.max(insets.bottom, SPACING.lg) + SPACING.sm }]}
          testID="app-alert-sheet"
        >
          {req.title ? (
            <Text accessibilityRole="header" style={[sheetStyles.title, { color: theme.text }]} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
              {req.title}
            </Text>
          ) : null}
          {req.message ? (
            <Text style={[sheetStyles.message, { color: theme.muted }, !req.title && { marginTop: 0 }]} maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}>
              {req.message}
            </Text>
          ) : null}

          {req.layout === 'pair' ? (
            <View style={sheetStyles.pair}>
              {req.buttons.map((b, i) => (
                <View key={`${b.text}-${i}`} style={sheetStyles.pairItem}>
                  <Button
                    label={b.text}
                    variant={buttonVariant(b, i, req.buttons)}
                    fullWidth
                    onPress={() => press(b)}
                    testID={`app-alert-button-${i}`}
                  />
                </View>
              ))}
            </View>
          ) : (
            <View style={sheetStyles.list}>
              {options.map((b, i) => (
                <PressableScale
                  key={`${b.text}-${i}`}
                  onPress={() => press(b)}
                  accessibilityRole="button"
                  accessibilityLabel={b.text}
                  style={sheetStyles.row}
                  testID={`app-alert-option-${i}`}
                >
                  <Text
                    style={[sheetStyles.rowText, { color: b.style === 'destructive' ? RED : theme.text }]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={DENSE_MAX_FONT_MULTIPLIER}
                  >
                    {b.text}
                  </Text>
                </PressableScale>
              ))}
              {cancel ? (
                <View style={sheetStyles.listCancel}>
                  <Button label={cancel.text} variant="secondary" fullWidth onPress={() => press(cancel)} testID="app-alert-cancel" />
                </View>
              ) : null}
            </View>
          )}
        </View>
      </Animated.View>
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
  dock: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    borderTopLeftRadius: RADII.sheet,
    borderTopRightRadius: RADII.sheet,
    paddingTop: SPACING.xl,
    paddingHorizontal: SPACING.lg,
  },
  title: { fontSize: 20, lineHeight: 25, fontFamily: FONT.bold },
  message: { fontSize: 15, lineHeight: 21, fontFamily: FONT.regular, marginTop: SPACING.sm },
  pair: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.xl },
  pairItem: { flex: 1 },
  list: { marginTop: SPACING.md },
  row: { minHeight: 52, justifyContent: 'center' },
  rowText: { fontSize: 17, lineHeight: 22, fontFamily: FONT.medium },
  listCancel: { marginTop: SPACING.md },
});
