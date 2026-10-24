/**
 * Web-only renderer for `showAlert` / `confirmAlert` (lib/actionSheet.ts).
 *
 * react-native-web's `Alert.alert` is a silent no-op, so on web `showAlert`
 * queues its request here instead: a minimal centered card (theme card fill —
 * black on the default Monochrome theme — white text, silver hairline border,
 * Inter) with the same buttons, in the same order, running the same
 * handlers. Native never mounts anything: `showAlert` calls `Alert.alert`
 * directly there. Mounted once near the root in app/_layout.tsx.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { a11yModalProps } from '@/lib/a11y/modal';
import { registerWebAlertPresenter, type AlertButtonSpec, type WebAlertRequest } from '@/lib/actionSheet';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

export function WebAlertHost() {
  if (Platform.OS !== 'web') return null;
  return <WebAlertModal />;
}

function WebAlertModal() {
  const { theme } = useAppTheme();
  // A queue so an error raised from inside a confirm's handler (e.g. "Couldn't
  // delete" after "Delete story?") shows after the first card closes rather
  // than replacing it.
  const [queue, setQueue] = useState<WebAlertRequest[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    registerWebAlertPresenter((request) => setQueue((q) => [...q, request]));
    return () => registerWebAlertPresenter(null);
  }, []);

  const finish = useCallback((button?: AlertButtonSpec) => {
    const dismissed = current;
    setQueue((q) => q.slice(1));
    if (button) {
      setTimeout(() => button.onPress?.(), 0);
    } else if (dismissed?.options?.onDismiss) {
      setTimeout(() => dismissed.options?.onDismiss?.(), 0);
    }
  }, [current]);

  // Backdrop click / Escape: run the cancel button when there is one (what a
  // native dismiss means), close a lone OK, otherwise only when cancelable.
  const dismiss = useCallback(() => {
    if (!current) return;
    const cancel = current.buttons.find((b) => b.style === 'cancel');
    if (cancel) finish(cancel);
    else if (current.buttons.length <= 1 || current.options?.cancelable) finish(undefined);
  }, [current, finish]);

  const stacked = !!current && (current.buttons.length > 2 || current.buttons.some((b) => (b.text ?? '').length > 14));

  return (
    <Modal visible={!!current} transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable style={[styles.backdrop, { backgroundColor: `${theme.shadowColor}99` }]} onPress={dismiss} accessibilityLabel="Dismiss">
        {current ? (
          <Pressable
            {...a11yModalProps()}
            accessibilityRole="alert"
            onPress={() => {}}
            style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}
            testID="web-alert"
          >
            <View style={styles.body}>
              <Text style={[styles.title, { color: theme.text }]}>{current.title}</Text>
              {current.message ? <Text style={[styles.message, { color: theme.muted }]}>{current.message}</Text> : null}
            </View>
            <View style={[styles.buttons, stacked ? styles.buttonsStacked : styles.buttonsRow, { borderTopColor: theme.border }]}>
              {current.buttons.map((button, i) => (
                <Pressable
                  key={`${button.text}-${i}`}
                  onPress={() => finish(button)}
                  accessibilityRole="button"
                  accessibilityLabel={button.text}
                  testID={`web-alert-button-${i}`}
                  style={[
                    styles.button,
                    stacked ? styles.buttonStacked : styles.buttonInRow,
                    i > 0 && (stacked
                      ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border }
                      : { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.border }),
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      { color: button.style === 'destructive' ? theme.error : button.style === 'cancel' ? theme.muted : theme.text },
                      button.style !== 'cancel' && { fontFamily: FONT.semibold },
                    ]}
                    numberOfLines={2}
                  >
                    {button.text}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SP.lg },
  card: {
    width: '100%',
    maxWidth: 320,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  body: { paddingHorizontal: SP.lg, paddingTop: SP.lg, paddingBottom: SP.md, alignItems: 'center', gap: SP.xs },
  title: { fontFamily: FONT.semibold, fontSize: FS.md, textAlign: 'center' },
  message: { fontFamily: FONT.regular, fontSize: FS.sm, textAlign: 'center', lineHeight: 20 },
  buttons: { borderTopWidth: StyleSheet.hairlineWidth },
  buttonsRow: { flexDirection: 'row' },
  buttonsStacked: { flexDirection: 'column' },
  button: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm },
  buttonInRow: { flex: 1 },
  buttonStacked: { alignSelf: 'stretch' },
  buttonText: { fontFamily: FONT.regular, fontSize: FS.md, textAlign: 'center' },
});
