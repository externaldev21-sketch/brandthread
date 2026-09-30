/**
 * A 6-box one-time-code entry, backed by a single real TextInput.
 *
 * One continuous TextInput (rather than 6 separately-focused boxes) gets
 * auto-advance and paste support for free — typing or pasting a full code
 * fills every box at once, cross-platform (web + native), with none of the
 * per-box focus-juggling and paste-event handling six separate inputs would
 * need. `textContentType`/`autoComplete` opt into SMS/email autofill
 * suggestions on iOS/Android/web.
 */
import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { SPACING } from '@/constants/spacing';

export interface OtpCodeInputProps {
  length?: number;
  value: string;
  onChangeText: (code: string) => void;
  /** Fires exactly once per full code entered (fires again if the code is cleared and re-filled). */
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
  error?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function OtpCodeInput({
  length = 6, value, onChangeText, onComplete, autoFocus, error, disabled, testID,
}: OtpCodeInputProps) {
  const { theme } = useAppTheme();
  const inputRef = useRef<TextInput>(null);
  const firedCompleteRef = useRef(false);

  function handleChangeText(next: string) {
    const digits = next.replace(/[^0-9]/g, '').slice(0, length);
    onChangeText(digits);
    if (digits.length === length) {
      if (!firedCompleteRef.current) {
        firedCompleteRef.current = true;
        onComplete?.(digits);
      }
    } else {
      firedCompleteRef.current = false;
    }
  }

  const boxes = Array.from({ length }, (_, i) => value[i] ?? '');
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      style={styles.row}
      accessibilityRole="none"
      testID={testID}
    >
      {boxes.map((digit, i) => (
        <View
          key={i}
          style={[
            styles.box,
            { borderColor: error ? theme.error : (i === activeIndex && !disabled) ? theme.accent : theme.border, backgroundColor: theme.cardGlass },
          ]}
        >
          <Text style={[styles.digit, { color: theme.text }]}>{digit}</Text>
        </View>
      ))}
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChangeText}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={length}
        autoFocus={autoFocus}
        editable={!disabled}
        style={styles.hiddenInput}
        accessibilityLabel="Verification code"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: SPACING.xs + 2, justifyContent: 'center' },
  box: {
    width: 44, height: 52, borderRadius: RADII.input, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  digit: { fontSize: 22, fontFamily: FONT.semibold },
  // Captures all real input (typing, paste, SMS/email autofill); visually
  // invisible but positioned over the row so taps/focus land correctly.
  hiddenInput: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    opacity: 0, fontSize: 22,
  },
});
