/**
 * Shared building blocks for the account-security form screens (change
 * password / email / phone). Styling mirrors the existing "Add a password"
 * sheet in login-methods.tsx so the flows read as one family.
 */
import React, { forwardRef, useMemo, useState } from 'react';
import { View, Text, TextInput, StyleSheet, type TextInputProps } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { IconButton } from '@/components/ui/IconButton';
import { Button } from '@/components/ui/Button';
import { useColors } from '@/hooks/useColors';
import { FONT } from '@/lib/theme';
import { TYPE_SCALE } from '@/constants/typography';
import { SPACING } from '@/constants/spacing';
import { RADII } from '@/constants/radii';

/** Scrolling, keyboard-aware form body. The route renders its own ScreenHeader above it. */
export function SecurityBody({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingTop: SPACING.lg, paddingBottom: insets.bottom + 40 }}
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

type FieldProps = Pick<TextInputProps, 'value' | 'placeholder' | 'keyboardType' | 'autoComplete' | 'textContentType' | 'maxLength' | 'onSubmitEditing' | 'returnKeyType' | 'autoFocus' | 'blurOnSubmit'> & {
  label: string;
  onChangeText: (value: string) => void;
  secure?: boolean;
  testID?: string;
};

export const SecurityField = forwardRef<TextInput, FieldProps>(function SecurityField({ label, secure, testID, ...input }, ref) {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <View style={s.inputRow}>
        <TextInput
          ref={ref}
          testID={testID}
          style={s.input}
          placeholderTextColor={colors.subtle}
          secureTextEntry={secure && !visible}
          autoCapitalize="none"
          autoCorrect={false}
          {...input}
        />
        {secure ? (
          <IconButton
            name={visible ? 'eye-off' : 'eye'}
            variant="plain"
            size={18}
            color={colors.mutedForeground}
            onPress={() => setVisible((v) => !v)}
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          />
        ) : null}
      </View>
    </View>
  );
});

export function SecurityIntro({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <Text style={{ ...TYPE_SCALE.footnote, color: colors.mutedForeground, lineHeight: 21, marginBottom: SPACING.md }}>
      {children}
    </Text>
  );
}

/** Inline result shown in place of the form once a change has gone through. */
export function SecuritySuccess({ title, body, onDone }: { title: string; body?: string; onDone: () => void }) {
  const colors = useColors();
  return (
    <View style={{ alignItems: 'center', paddingTop: SPACING.xl, gap: SPACING.sm }}>
      <Feather name="check-circle" size={40} color={colors.success} />
      <Text testID="security-success-title" style={{ ...TYPE_SCALE.title2, color: colors.foreground }}>{title}</Text>
      {body ? <Text style={{ ...TYPE_SCALE.footnote, color: colors.mutedForeground, textAlign: 'center', lineHeight: 18 }}>{body}</Text> : null}
      <Button label="Done" onPress={onDone} fullWidth style={{ marginTop: SPACING.md }} />
    </View>
  );
}

export function SecurityErrorBox({ message, testID }: { message: string; testID?: string }) {
  const colors = useColors();
  const s = useMemo(() => makeStyles(colors), [colors]);
  if (!message) return null;
  return (
    <View style={s.errorBox}>
      <Feather name="alert-circle" size={14} color={colors.destructive} />
      <Text testID={testID} style={s.errorText}>{message}</Text>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  label: {
    fontSize: 11, fontFamily: FONT.semibold, color: colors.mutedForeground,
    marginBottom: 6, marginTop: SPACING.sm,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: RADII.chip,
    borderWidth: 1, borderColor: colors.border,
  },
  input: {
    flex: 1, paddingHorizontal: SPACING.md, paddingVertical: 14,
    ...TYPE_SCALE.footnote, color: colors.foreground,
  },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    backgroundColor: colors.destructive + '26', borderRadius: RADII.chip,
    borderWidth: 1, borderColor: colors.destructive + '4d',
    paddingHorizontal: SPACING.sm, paddingVertical: 10, marginTop: SPACING.md,
  },
  errorText: { flex: 1, fontSize: 11, fontFamily: FONT.regular, color: colors.destructive, lineHeight: 18 },
});
