/**
 * KeyboardAccessoryBar — the slim bar iOS shows on top of the keyboard for
 * chat and comment composers: a right-aligned "Done" that dismisses the
 * keyboard and, where the composer's own send button isn't on screen while
 * typing, a "Send".
 *
 * Built on React Native's InputAccessoryView, which only exists on iOS. On
 * Android and web this renders nothing and `keyboardAccessoryID()` returns
 * undefined, so the TextInput is left exactly as it was.
 *
 * Usage: render <KeyboardAccessoryBar nativeID="x" /> anywhere in the screen
 * and pass `inputAccessoryViewID={keyboardAccessoryID('x')}` to the input.
 */
import React from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FILL_ELEVATED, FONT } from '@/lib/theme';

export const KEYBOARD_ACCESSORY_BAR_HEIGHT = 44;

export function keyboardAccessoryEnabled(): boolean {
  return Platform.OS === 'ios';
}

/** The id to hand a TextInput's `inputAccessoryViewID` (undefined off iOS). */
export function keyboardAccessoryID(nativeID: string): string | undefined {
  return keyboardAccessoryEnabled() ? nativeID : undefined;
}

export interface KeyboardAccessoryBarProps {
  nativeID: string;
  /** Defaults to dismissing the keyboard. */
  onDone?: () => void;
  /** Shows a "Send" button left of "Done" when provided. */
  onSend?: () => void;
  sendDisabled?: boolean;
}

export function KeyboardAccessoryBar({ nativeID, onDone, onSend, sendDisabled = false }: KeyboardAccessoryBarProps) {
  const { theme } = useAppTheme();
  if (!keyboardAccessoryEnabled()) return null;
  return (
    <InputAccessoryView nativeID={nativeID} backgroundColor={FILL_ELEVATED}>
      <View
        style={[styles.bar, { backgroundColor: FILL_ELEVATED, borderTopColor: theme.border }]}
        testID={`${nativeID}-accessory`}
      >
        {onSend ? (
          <Pressable
            onPress={onSend}
            disabled={sendDisabled}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: sendDisabled }}
            style={[styles.button, sendDisabled && styles.disabled]}
            testID={`${nativeID}-accessory-send`}
          >
            <Text style={[styles.label, styles.send, { color: theme.text }]}>Send</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onDone ?? Keyboard.dismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Done"
          style={styles.button}
          testID={`${nativeID}-accessory-done`}
        >
          <Text style={[styles.label, { color: theme.text }]}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: KEYBOARD_ACCESSORY_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: { minHeight: KEYBOARD_ACCESSORY_BAR_HEIGHT, paddingHorizontal: 10, justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  label: { fontFamily: FONT.regular, fontSize: 17 },
  send: { fontFamily: FONT.semibold },
});
