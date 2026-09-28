/**
 * Checkout building blocks — the grouped-card language of the redesigned
 * buyer checkout (GOAT "Order Review" structure, SSENSE section rows).
 *
 * Every section is one `CheckoutCard`: the shared `<Glass/>` material (no
 * live blur — these are stacked list surfaces, see Glass.tsx's perf note) on
 * the theme's card fill, with a small uppercase heading. Monochrome only:
 * selection, focus and success states use the theme's text color; the only
 * other color is the theme's own error tone for validation messages.
 */
import React, { useState } from 'react';
import {
  Platform, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { Glass } from '@/components/ui/Glass';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { COMP, FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';

export const CHECKOUT_CARD_RADIUS = RADII.sheet;

export function CheckoutCard({
  title, trailing, children, style, testID,
}: {
  title?: string;
  /** Right side of the heading row (e.g. a "Change" link) — a sibling, never wrapping the card. */
  trailing?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <Glass
      variant="clear"
      tint="dark"
      noBlur
      radius={CHECKOUT_CARD_RADIUS}
      style={[styles.card, { backgroundColor: theme.card }, style]}
      testID={testID}
    >
      <View style={styles.cardBody}>
        {(title || trailing) ? (
          <View style={styles.headingRow}>
            {title ? (
              <Text style={[styles.heading, { color: theme.muted }]} accessibilityRole="header">{title}</Text>
            ) : <View />}
            {trailing}
          </View>
        ) : null}
        {children}
      </View>
    </Glass>
  );
}

/** A monochrome radio dot. Purely visual — the tappable row owns the press. */
export function RadioDot({ selected }: { selected: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.radio, { borderColor: selected ? theme.text : theme.subtle }]}>
      {selected ? <View style={[styles.radioInner, { backgroundColor: theme.text }]} /> : null}
    </View>
  );
}

/**
 * A labeled, bordered text field with a visible focus state and an inline
 * error line. The label always sits above the box (a static label — never a
 * placeholder-only field), so it stays readable once the field is filled.
 */
export function CheckoutField({
  label, value, onChangeText, error, showError, hint, style, testID, ...inputProps
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** The current validation message, if any. */
  error?: string;
  /** Only show `error` once the buyer has left the field (or tried to continue). */
  showError?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'style'>) {
  const { theme } = useAppTheme();
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const visibleError = error && (showError || blurred) ? error : undefined;
  const borderColor = visibleError ? theme.error : focused ? theme.text : theme.border;

  return (
    <View style={[styles.field, style]}>
      <Text style={[styles.fieldLabel, { color: visibleError ? theme.error : theme.muted }]}>{label}</Text>
      <TextInput
        {...inputProps}
        value={value}
        onChangeText={onChangeText}
        onFocus={(event) => { setFocused(true); inputProps.onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); setBlurred(true); inputProps.onBlur?.(event); }}
        placeholderTextColor={theme.subtle}
        accessibilityLabel={inputProps.accessibilityLabel ?? label}
        accessibilityHint={visibleError ?? hint}
        testID={testID}
        style={[
          styles.input,
          {
            color: theme.text,
            borderColor,
            borderWidth: focused || visibleError ? 1.5 : 1,
            backgroundColor: theme.background,
          },
        ]}
      />
      {visibleError ? (
        <Text style={[styles.fieldError, { color: theme.error }]} accessibilityLiveRegion="polite">{visibleError}</Text>
      ) : hint ? (
        <Text style={[styles.fieldHint, { color: theme.subtle }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  const { theme } = useAppTheme();
  return <View style={[styles.hairline, { backgroundColor: theme.border }, style]} />;
}

const styles = StyleSheet.create({
  card: { marginBottom: SP.sm + 4 },
  cardBody: { padding: SP.md },
  headingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: SP.sm + 4, minHeight: 20,
  },
  heading: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 0.9, textTransform: 'uppercase' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
  field: { marginBottom: SP.sm + 4 },
  fieldLabel: { fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: 6 },
  input: {
    minHeight: COMP.inputH - 4, borderRadius: RADII.input + 2,
    paddingHorizontal: SP.md - 2, paddingVertical: SP.sm + 2,
    fontFamily: FONT.regular, fontSize: FS.base,
    // The field's own border already shows focus; drop the browser outline
    // so web doesn't draw a second ring outside the box.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  fieldError: { fontFamily: FONT.medium, fontSize: FS.meta, marginTop: 6 },
  fieldHint: { fontFamily: FONT.medium, fontSize: FS.meta, marginTop: 6 },
  hairline: { height: StyleSheet.hairlineWidth, marginVertical: SP.sm + 4 },
});
