/**
 * Renders the web `Alert.alert` / `Alert.prompt` queue from lib/webAlert.ts as
 * a centered dialog (the iOS alert layout: title, message, then the buttons —
 * side by side when there are two, stacked otherwise).
 *
 * Mounted once by `<ActionSheetHost />` (which app/_layout.tsx already mounts
 * at the root), and renders nothing on native, where the real platform
 * `Alert` is still used.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import {
  dismissWebAlert,
  installWebAlertPolyfill,
  orderButtons,
  primaryButton,
  resolveWebAlert,
  subscribeWebAlerts,
  type WebAlertRequest,
} from '@/lib/webAlert';

// Patch as soon as this module is evaluated (the root layout imports it), so
// alerts raised during the very first render are queued, not dropped.
installWebAlertPolyfill(Alert as any, Platform.OS);

export function WebAlertHost() {
  if (Platform.OS !== 'web') return null;
  return <WebAlertDialog />;
}

function WebAlertDialog() {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [req, setReq] = useState<WebAlertRequest | null>(null);
  const [value, setValue] = useState('');
  const reqRef = useRef<WebAlertRequest | null>(null);
  const valueRef = useRef('');

  useEffect(
    () =>
      subscribeWebAlerts((next) => {
        reqRef.current = next;
        setReq(next);
        const initial = next?.defaultValue ?? '';
        valueRef.current = initial;
        setValue(initial);
      }),
    [],
  );

  useEffect(() => {
    if (!req || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const cur = reqRef.current;
      if (!cur) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissWebAlert(cur.id);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        resolveWebAlert(cur.id, primaryButton(cur), valueRef.current);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [req]);

  if (!req) return null;
  const buttons = orderButtons(req.buttons);
  const row = buttons.length === 2;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => dismissWebAlert(req.id)}>
      <Pressable
        style={[styles.backdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
        onPress={() => dismissWebAlert(req.id)}
        accessibilityLabel="Close dialog"
        testID="web-alert-backdrop"
      >
        <Pressable
          style={[styles.card, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}
          onPress={() => {}}
          accessibilityRole={'alertdialog' as any}
          accessibilityLabel={req.title || req.message}
          testID="web-alert"
        >
          <View style={styles.body}>
            {req.title ? (
              <Text style={[styles.title, { color: theme.text }]}>{req.title}</Text>
            ) : null}
            {req.message ? (
              <Text style={[styles.message, { color: theme.muted }, !req.title && styles.messageOnly]}>
                {req.message}
              </Text>
            ) : null}
            {req.kind === 'prompt' ? (
              <TextInput
                autoFocus
                value={value}
                onChangeText={(t) => {
                  valueRef.current = t;
                  setValue(t);
                }}
                secureTextEntry={req.secure}
                style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
                placeholderTextColor={theme.subtle}
                accessibilityLabel={req.title || 'Value'}
                testID="web-alert-input"
              />
            ) : null}
          </View>
          <View style={[styles.buttons, row && styles.buttonsRow, { borderTopColor: theme.border }]}>
            {buttons.map((btn, i) => (
              <Pressable
                key={`${btn.text ?? 'button'}-${i}`}
                onPress={() => resolveWebAlert(req.id, btn, valueRef.current)}
                style={({ pressed }) => [
                  styles.button,
                  row && styles.buttonInRow,
                  row && i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.border },
                  !row && i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border },
                  pressed && { backgroundColor: theme.surface },
                ]}
                accessibilityRole="button"
                accessibilityLabel={btn.text ?? 'OK'}
                testID={`web-alert-button-${i}`}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.buttonText,
                    { color: btn.style === 'destructive' ? theme.error : theme.text },
                    btn.style === 'cancel' ? { fontFamily: FONT.regular, color: theme.muted } : null,
                  ]}
                >
                  {btn.text ?? 'OK'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SP.lg,
  },
  card: {
    width: '100%',
    maxWidth: 300,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  body: { paddingHorizontal: SP.md, paddingTop: SP.md + 2, paddingBottom: SP.md, alignItems: 'center' },
  title: { fontSize: FS.md, fontFamily: FONT.semibold, textAlign: 'center' },
  message: { fontSize: FS.sm, fontFamily: FONT.regular, textAlign: 'center', marginTop: SP.xs, lineHeight: 18 },
  messageOnly: { marginTop: 0, fontSize: FS.base, lineHeight: 20 },
  input: {
    alignSelf: 'stretch',
    marginTop: SP.md - 4,
    height: 40,
    borderRadius: RADIUS.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SP.sm + 2,
    fontSize: FS.base,
    fontFamily: FONT.regular,
  },
  buttons: { borderTopWidth: StyleSheet.hairlineWidth },
  buttonsRow: { flexDirection: 'row' },
  button: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.sm },
  buttonInRow: { flex: 1, flexBasis: 0 },
  buttonText: { fontSize: FS.md, fontFamily: FONT.semibold },
});
