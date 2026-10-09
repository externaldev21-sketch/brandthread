/**
 * Brandthread Design System — Input (BRANDTHREAD_DESIGN.md + Dev's addendum).
 *
 * A 52pt text field on the one solid near-black fill (`FILL_ELEVATED`,
 * #1C1C1E) with no resting border. The label sits inside the field (the
 * Netflix sign-in pattern): it reads as the placeholder while the field is
 * empty and moves to a small caption above the value once focused or
 * filled — no animation, it is simply there. Focus shows a white hairline,
 * an error shows the error color and the message underneath.
 */
import React from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { COMP, FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { radius } from '@/constants/radii';
import { SPACING } from '@/constants/spacing';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { BODY_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';

export interface InputProps extends Omit<TextInputProps, 'style' | 'placeholder'> {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string | null;
  /** Trailing content inside the field (a show-password toggle, a clear button). */
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Input({ label, value, onChangeText, error, right, style, onFocus, onBlur, multiline, testID, ...rest }: InputProps) {
  const palette = useColors();
  const [focused, setFocused] = React.useState(false);
  const raised = focused || value.length > 0;
  const borderColor = error ? palette.destructive : focused ? palette.foreground : 'transparent';

  return (
    <View style={style}>
      <View style={[styles.field, multiline && styles.multiline, { borderColor }]}>
        <View style={styles.body}>
          {raised && (
            <Text style={[styles.raisedLabel, { color: palette.mutedForeground }]} numberOfLines={1} maxFontSizeMultiplier={BODY_MAX_FONT_MULTIPLIER}>
              {label}
            </Text>
          )}
          <TextInput
            {...rest}
            testID={testID}
            value={value}
            onChangeText={onChangeText}
            multiline={multiline}
            placeholder={raised ? undefined : label}
            placeholderTextColor={palette.mutedForeground}
            accessibilityLabel={rest.accessibilityLabel ?? label}
            onFocus={(event) => { setFocused(true); onFocus?.(event); }}
            onBlur={(event) => { setFocused(false); onBlur?.(event); }}
            maxFontSizeMultiplier={BODY_MAX_FONT_MULTIPLIER}
            style={[styles.input, multiline && styles.multilineInput, { color: palette.foreground }, WEB_INPUT_RESET]}
          />
        </View>
        {right}
      </View>
      {!!error && (
        <Text style={[styles.error, { color: palette.destructive }]} accessibilityLiveRegion="polite">{error}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    minHeight: COMP.inputH,
    paddingHorizontal: SPACING.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: FILL_ELEVATED,
  },
  multiline: { alignItems: 'flex-start', paddingVertical: SPACING.sm, minHeight: 104 },
  body: { flex: 1, minWidth: 0, justifyContent: 'center' },
  raisedLabel: { ...TEXT.caption, fontFamily: FONT.medium },
  input: { ...TEXT.body, paddingVertical: 0 },
  multilineInput: { minHeight: 72, textAlignVertical: 'top' },
  error: { ...TEXT.footnote, marginTop: SPACING.xs },
});
