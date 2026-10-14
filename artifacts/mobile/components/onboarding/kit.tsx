/**
 * Onboarding kit — the whole visual language of sign-up, in one file.
 *
 * Modelled on SSENSE's and Grailed's iOS onboarding: a "02 / 04" counter
 * top-left, one plain caps headline, at most one sentence under it, square
 * hairline fields, and a single full-width square button pinned to the
 * bottom. System font, theme colors only (black / white / silver on the
 * default Monochrome theme). No icons in circles, no gradients, no glow,
 * no staggered reveals.
 */
import React, { forwardRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { useAppTheme } from '@/contexts/AppThemeContext';

type Theme = ReturnType<typeof useAppTheme>['theme'];

/** 20pt side gutter, 8pt rhythm. */
export const GUTTER = 20;

export const ONB_TYPE = {
  headline: { fontSize: 30, lineHeight: 34, fontWeight: '400', letterSpacing: -0.3 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '600' },
  caps: { fontSize: 13, lineHeight: 16, fontWeight: '500', letterSpacing: 0.8 },
  small: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
} as const;

/** "02 / 04" — SSENSE's step counter. Zero-padded, top-left, never a bar. */
export function StepCounter({ current, total }: { current: number; total: number }) {
  const { theme } = useAppTheme();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <Text
      style={[ONB_TYPE.small, { color: theme.muted, fontVariant: ['tabular-nums'] }]}
      accessibilityLabel={`Step ${current} of ${total}`}
      testID="onboarding-step-counter"
    >
      {pad(current)} / {pad(total)}
    </Text>
  );
}

export function Headline({ children, style }: { children: React.ReactNode; style?: StyleProp<any> }) {
  const { theme } = useAppTheme();
  return (
    <Text accessibilityRole="header" style={[ONB_TYPE.headline, { color: theme.text, textTransform: 'uppercase' }, style]}>
      {children}
    </Text>
  );
}

export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<any> }) {
  const { theme } = useAppTheme();
  return <Text style={[ONB_TYPE.body, { color: theme.muted, marginTop: 10 }, style]}>{children}</Text>;
}

/**
 * The one primary action on a screen: full width, square, inverted
 * (white on the black theme), caps label.
 */
export function SquareButton({
  label,
  onPress,
  disabled,
  loading,
  variant = 'primary',
  testID,
  accessibilityLabel,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** primary = filled; outline = hairline box (Google / email rows). */
  variant?: 'primary' | 'outline';
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const filled = variant === 'primary';
  const fg = filled ? theme.background : theme.text;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [
        s.button,
        filled
          ? { backgroundColor: theme.text }
          : { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.muted },
        disabled && { opacity: 0.35 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text style={[ONB_TYPE.caps, { color: fg, textTransform: 'uppercase' }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** Plain text action ("Sign in", "Do it later"): no box, underlined. */
export function TextAction({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID} hitSlop={10} style={s.textAction}>
      <Text style={[ONB_TYPE.body, { color: theme.text, textDecorationLine: 'underline' }]}>{label}</Text>
    </Pressable>
  );
}

export type FieldProps = TextInputProps & {
  label: string;
  /** Shown under the field in the error color. */
  error?: string | null;
  /** Shown under the field in muted text when there is no error. */
  hint?: string | null;
  /** Fixed text inside the box before the value (e.g. "@" or "$"). */
  prefix?: string;
  right?: React.ReactNode;
};

/** Grailed's field: bold label above a square hairline box. */
export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, error, hint, prefix, right, style, ...input },
  ref,
) {
  const { theme } = useAppTheme();
  return (
    <View style={s.field}>
      <Text style={[ONB_TYPE.label, { color: theme.text, marginBottom: 8 }]}>{label}</Text>
      <View style={[s.box, { borderColor: error ? theme.error : theme.muted }]}>
        {prefix ? <Text style={[s.input, { color: theme.muted, paddingRight: 0, flex: 0 }]}>{prefix}</Text> : null}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={theme.subtle}
          selectionColor={theme.text}
          style={[s.input, { color: theme.text }, prefix ? { paddingLeft: 1 } : null, style]}
          {...input}
        />
        {right}
      </View>
      {error ? (
        <Text style={[ONB_TYPE.small, { color: theme.error, marginTop: 6 }]}>{error}</Text>
      ) : hint ? (
        <Text style={[ONB_TYPE.small, { color: theme.muted, marginTop: 6 }]}>{hint}</Text>
      ) : null}
    </View>
  );
});

/** A plain radio row: label left, a ring that fills when chosen, hairline under. */
export function ChoiceRow({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[s.choiceRow, { borderBottomColor: theme.border }]}
    >
      <Text style={[ONB_TYPE.body, { color: theme.text, flex: 1 }]}>{label}</Text>
      <View style={[s.ring, { borderColor: selected ? theme.text : theme.muted }]}>
        {selected ? <View style={[s.ringDot, { backgroundColor: theme.text }]} /> : null}
      </View>
    </Pressable>
  );
}

/** Square chip; selected = inverted. Used for sizes and categories. */
export function SquareChip({
  label,
  selected,
  onPress,
  testID,
  accessibilityLabel,
  style,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        s.chip,
        selected
          ? { backgroundColor: theme.text, borderColor: theme.text }
          : { borderColor: theme.muted },
        style,
      ]}
    >
      <Text style={[ONB_TYPE.body, { color: selected ? theme.background : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

/** Grailed's FOLLOW / FOLLOWING: small square, filled when not yet following. */
export function FollowButton({
  following,
  onPress,
  name,
  testID,
  busy,
}: {
  following: boolean;
  onPress: () => void;
  name: string;
  testID?: string;
  busy?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ selected: following }}
      accessibilityLabel={`${following ? 'Unfollow' : 'Follow'} ${name}`}
      hitSlop={6}
      style={[
        s.follow,
        following
          ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.muted }
          : { backgroundColor: theme.text },
      ]}
    >
      <Text style={[s.followText, { color: following ? theme.text : theme.background }]}>
        {following ? 'FOLLOWING' : 'FOLLOW'}
      </Text>
    </Pressable>
  );
}

/**
 * Screen frame for every onboarding step: counter (or nothing) top-left,
 * scrollable content, and the bottom-pinned action area. The footer stays
 * above the keyboard.
 */
export function StepScreen({
  counter,
  headerRight,
  children,
  footer,
  scroll = true,
  contentStyle,
  testID,
}: {
  counter?: { current: number; total: number } | null;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const topInset = useHeaderTopInset();
  const Container = scroll ? ScrollView : View;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[s.root, { backgroundColor: theme.background }]}
      testID={testID}
    >
      <View style={[s.header, { paddingTop: topInset + 12 }]}>
        <View style={{ flex: 1 }}>{counter ? <StepCounter {...counter} /> : null}</View>
        {headerRight}
      </View>
      <Container
        style={{ flex: 1 }}
        {...(scroll
          ? {
              contentContainerStyle: [s.content, contentStyle],
              keyboardShouldPersistTaps: 'handled' as const,
              showsVerticalScrollIndicator: false,
            }
          : { style: [{ flex: 1 }, s.content, contentStyle] })}
      >
        {children}
      </Container>
      {footer ? (
        <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) + 8, backgroundColor: theme.background }]}>
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

export function useKitTheme(): Theme {
  return useAppTheme().theme;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: GUTTER, paddingBottom: 12, minHeight: 28 },
  content: { flexGrow: 1, paddingHorizontal: GUTTER, paddingTop: 8, paddingBottom: 24 },
  footer: { paddingHorizontal: GUTTER, paddingTop: 12, gap: 12 },
  button: { height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 0, paddingHorizontal: 16, flexDirection: 'row', gap: 10 },
  textAction: { alignSelf: 'center', paddingVertical: 6 },
  field: { marginTop: 24 },
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 0, minHeight: 52 },
  input: { flex: 1, fontSize: 16, paddingHorizontal: 14, paddingVertical: 14 },
  choiceRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  ring: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  ringDot: { width: 10, height: 10, borderRadius: 5 },
  chip: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 0 },
  follow: { height: 30, minWidth: 92, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 0 },
  followText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8 },
});
