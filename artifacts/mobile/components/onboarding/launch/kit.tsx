/**
 * Launch onboarding kit — the shared pieces every first-run screen is built
 * from. Each piece copies a specific reference app on Mobbin; only the colors
 * (theme: black / white / silver) and the font (system) change.
 *
 *  - Header: back chevron + thin rounded progress bar   — Depop "Choose your username"
 *  - Title / Sub: big bold left-aligned question + one line — Depop / TikTok
 *  - Field: outlined box, small label inside, inline error — Depop
 *  - PillButton: full-width pill, grey when disabled       — Depop / Cash App
 *  - OutlineOption: hairline row, icon left, label centred — TikTok "Sign up for TikTok"
 *  - Chip: pill, filled with a check when picked           — Depop "Show these brands in search"
 *  - ListRow / RadioRow: hairline rows                     — Depop "Interest" / Etsy
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
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';
import { useAppTheme } from '@/contexts/AppThemeContext';

type Theme = ReturnType<typeof useAppTheme>['theme'];

export const GUTTER = 16;
const HIT = { top: 10, bottom: 10, left: 10, right: 10 };

/** Neutral grey for disabled / secondary fills, derived from the theme. */
function fillFor(theme: Theme) {
  return theme.text === '#FFFFFF' || theme.text.toLowerCase() === '#ffffff' ? '#1C1C1E' : '#EFEFEF';
}

// ─── Screen frame ────────────────────────────────────────────────────────────

/**
 * Header + scrollable body + footer pinned above the keyboard. Every step uses
 * it so layouts stay keyboard-safe at any phone size.
 */
export function OnbScreen({
  header,
  footer,
  children,
  scroll = true,
  testID,
}: {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View testID={testID} style={[s.root, { backgroundColor: theme.background, paddingTop: insets.top }]}>
      {header}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
        {scroll ? (
          <ScrollView
            style={s.flex}
            contentContainerStyle={s.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[s.flex, s.body]}>{children}</View>
        )}
        {footer ? (
          <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>{footer}</View>
        ) : null}
      </KeyboardAvoidingView>
    </View>
  );
}

/** Depop: back chevron, centred progress bar, empty right slot (or a title). */
export function OnbHeader({
  onBack,
  onClose,
  progress,
  title,
}: {
  onBack?: () => void;
  onClose?: () => void;
  /** 0..1; omitted on screens before the account exists. */
  progress?: number;
  title?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={s.header}>
      <View style={s.headerSide}>
        {onBack ? (
          <Pressable testID="onboarding-back" onPress={onBack} hitSlop={HIT} accessibilityRole="button" accessibilityLabel="Back">
            <Feather name="chevron-left" size={28} color={theme.text} />
          </Pressable>
        ) : onClose ? (
          <Pressable testID="onboarding-close" onPress={onClose} hitSlop={HIT} accessibilityRole="button" accessibilityLabel="Close">
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
        ) : null}
      </View>
      <View style={s.headerCenter}>
        {typeof progress === 'number' ? (
          <View
            testID="onboarding-progress"
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
            style={[s.track, { backgroundColor: fillFor(theme) }]}
          >
            <View style={[s.fill, { backgroundColor: theme.text, width: `${Math.max(4, Math.min(100, progress * 100))}%` }]} />
          </View>
        ) : title ? (
          <Text style={[s.headerTitle, { color: theme.text }]} numberOfLines={1}>{title}</Text>
        ) : null}
      </View>
      <View style={s.headerSide} />
    </View>
  );
}

// ─── Type ────────────────────────────────────────────────────────────────────

export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<any> }) {
  const { theme } = useAppTheme();
  return <Text accessibilityRole="header" style={[s.title, { color: theme.text }, style]}>{children}</Text>;
}

export function Sub({ children, style }: { children: React.ReactNode; style?: StyleProp<any> }) {
  const { theme } = useAppTheme();
  return <Text style={[s.sub, { color: theme.muted }, style]}>{children}</Text>;
}

/** Depop: "⚠ Username must be at least 3 characters." under the field. */
export function FieldError({ message, testID }: { message?: string; testID?: string }) {
  const { theme } = useAppTheme();
  if (!message) return null;
  return (
    <View style={s.errorRow} accessibilityLiveRegion="polite">
      <Feather name="alert-triangle" size={13} color={theme.error} />
      <Text testID={testID} style={[s.errorText, { color: theme.error }]}>{message}</Text>
    </View>
  );
}

export function FieldHint({ message, ok }: { message?: string; ok?: boolean }) {
  const { theme } = useAppTheme();
  if (!message) return null;
  return (
    <View style={s.errorRow} accessibilityLiveRegion="polite">
      {ok ? <Feather name="check" size={13} color={theme.text} /> : null}
      <Text style={[s.errorText, { color: ok ? theme.text : theme.muted }]}>{message}</Text>
    </View>
  );
}

// ─── Field ───────────────────────────────────────────────────────────────────

type FieldProps = TextInputProps & {
  label: string;
  error?: boolean;
  right?: React.ReactNode;
  /** 'box' = Depop outlined field; 'underline' = TikTok's single rule. */
  variant?: 'box' | 'underline';
};

/** Depop's outlined field: small label inside the box above the value. */
export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, error, right, style, variant = 'box', ...props }, ref) {
  const { theme } = useAppTheme();
  return (
    <View style={[variant === 'box' ? s.field : s.fieldUnderline, { borderColor: error ? theme.error : theme.muted }]}>
      <View style={s.flex}>
        <Text style={[s.fieldLabel, { color: theme.muted }]}>{label}</Text>
        <TextInput
          ref={ref}
          placeholderTextColor={theme.subtle}
          selectionColor={theme.text}
          style={[s.fieldInput, { color: theme.text }, style]}
          {...props}
        />
      </View>
      {right}
    </View>
  );
});

// ─── Buttons ─────────────────────────────────────────────────────────────────

/**
 * The one primary action: full-width pill. `primary` is filled with the text
 * color (white on black); `secondary` is the grey fill Cash App / TikTok use
 * for Skip.
 */
export function PillButton({
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
  variant?: 'primary' | 'secondary';
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { theme } = useAppTheme();
  const inactive = disabled || loading;
  const primary = variant === 'primary';
  const bg = primary && !disabled ? theme.text : fillFor(theme);
  const fg = primary && !disabled ? theme.background : disabled ? theme.subtle : theme.text;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={({ pressed }) => [s.pill, { backgroundColor: bg }, pressed && !inactive && { opacity: 0.85 }, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[s.pillText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

/** TikTok's sign-up options: hairline box, icon pinned left, label centred. */
export function OutlineOption({
  label,
  icon,
  onPress,
  loading,
  disabled,
  testID,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      style={({ pressed }) => [s.option, { borderColor: theme.border }, pressed && { backgroundColor: fillFor(theme) }, disabled && { opacity: 0.5 }]}
    >
      <View style={s.optionIcon}>{icon}</View>
      {loading ? <ActivityIndicator color={theme.text} /> : <Text style={[s.optionText, { color: theme.text }]}>{label}</Text>}
    </Pressable>
  );
}

export function TextLink({ label, onPress, testID, muted }: { label: string; onPress: () => void; testID?: string; muted?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={HIT} accessibilityRole="button" style={s.textLink}>
      <Text style={[s.textLinkText, { color: muted ? theme.muted : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

// ─── Choice pieces ───────────────────────────────────────────────────────────

/** Depop brand chip: outlined pill; picked = filled with a leading check. */
export function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        s.chip,
        selected ? { backgroundColor: theme.text, borderColor: theme.text } : { borderColor: theme.muted },
        pressed && { opacity: 0.8 },
      ]}
    >
      {selected ? <Feather name="check" size={14} color={theme.background} /> : null}
      <Text style={[s.chipText, { color: selected ? theme.background : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

/** Depop "Interest" list row: label, hairline under it, tap to choose. */
export function ListRow({ label, selected, onPress, testID }: { label: string; selected?: boolean; onPress: () => void; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [s.listRow, { borderBottomColor: theme.border }, pressed && { opacity: 0.7 }]}
    >
      <Text style={[s.listRowText, { color: theme.text }]}>{label}</Text>
      {selected ? <Feather name="check" size={20} color={theme.text} /> : null}
    </Pressable>
  );
}

/** Etsy / TikTok radio row: title, optional line under it, radio on the right. */
export function RadioRow({
  label,
  sub,
  selected,
  onPress,
  testID,
}: {
  label: string;
  sub?: string;
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
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      style={({ pressed }) => [s.radioRow, { borderBottomColor: theme.border }, pressed && { opacity: 0.7 }]}
    >
      <View style={s.flex}>
        <Text style={[s.radioLabel, { color: theme.text }]}>{label}</Text>
        {sub ? <Text style={[s.radioSub, { color: theme.muted }]}>{sub}</Text> : null}
      </View>
      <View style={[s.radio, { borderColor: selected ? theme.text : theme.muted }]}>
        {selected ? <View style={[s.radioDot, { backgroundColor: theme.text }]} /> : null}
      </View>
    </Pressable>
  );
}

/** Small bold section heading (Depop "Popular brands", "Shoes"). */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  const { theme } = useAppTheme();
  return <Text style={[s.section, { color: theme.text }]}>{children}</Text>;
}

const s = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  body: { flexGrow: 1, paddingHorizontal: GUTTER, paddingBottom: 24 },
  footer: { paddingHorizontal: GUTTER, paddingTop: 12, gap: 12 },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  headerSide: { width: 44, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  headerTitle: { fontSize: 17, fontWeight: '600' },
  track: { width: '100%', maxWidth: 240, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  title: { fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.4, marginTop: 16 },
  sub: { fontSize: 15, lineHeight: 21, marginTop: 8 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  errorText: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  field: {
    marginTop: 24, minHeight: 58, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  fieldUnderline: {
    marginTop: 24, minHeight: 52, borderBottomWidth: 1, paddingVertical: 6,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  fieldLabel: { fontSize: 12, lineHeight: 16 },
  fieldInput: { fontSize: 17, lineHeight: 22, paddingVertical: Platform.OS === 'web' ? 2 : 0, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as object : null) },
  pill: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  pillText: { fontSize: 16, fontWeight: '600' },
  option: {
    height: 48, borderWidth: 1, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 44,
  },
  optionIcon: { position: 'absolute', left: 14, width: 22, alignItems: 'center' },
  optionText: { fontSize: 15, fontWeight: '600' },
  textLink: { alignSelf: 'center', paddingVertical: 8 },
  textLinkText: { fontSize: 15, fontWeight: '600' },
  chip: {
    minHeight: 40, borderWidth: 1, borderRadius: 20, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  chipText: { fontSize: 15 },
  listRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  listRowText: { flex: 1, fontSize: 17 },
  radioRow: {
    minHeight: 64, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  radioLabel: { fontSize: 17, fontWeight: '600' },
  radioSub: { fontSize: 14, lineHeight: 19, marginTop: 2 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
  section: { fontSize: 20, fontWeight: '700', marginTop: 28, marginBottom: 12 },
});
