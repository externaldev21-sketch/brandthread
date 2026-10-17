/**
 * Row primitives for the Sell-an-item screens, copied from Vinted's form:
 * full-width rows (label left, value + chevron right) in groups separated by
 * a grey band, radio rows with a description line (Parcel size, Condition),
 * and check rows (Colours). Depop's two-button bottom bar sits under the form.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { hapticLight } from '@/lib/haptics';
import { Button } from '@/components/ui/Button';

function useStyles() {
  const { theme } = useAppTheme();
  return React.useMemo(() => makeStyles(theme), [theme]);
}

/** Vinted's grey band between form groups. */
export function SectionGap() {
  const s = useStyles();
  return <View style={s.gap} />;
}

/** Small grey caption under a group ("The buyer always pays for shipping"). */
export function GroupNote({ children }: { children: React.ReactNode }) {
  const s = useStyles();
  return <Text style={s.note}>{children}</Text>;
}

/** Bold section heading inside a group (Depop "Info", "Price", "Shipping"). */
export function GroupTitle({ children }: { children: React.ReactNode }) {
  const s = useStyles();
  return <Text style={s.groupTitle} accessibilityRole="header">{children}</Text>;
}

export function FormRow({
  label, value, placeholder, onPress, error, testID, last,
}: {
  label: string;
  value?: string;
  /** Shown muted when there's no value (e.g. "Optional"). */
  placeholder?: string;
  onPress: () => void;
  /** Depop's red "Needs …" state after a failed Post. */
  error?: boolean;
  testID?: string;
  last?: boolean;
}) {
  const s = useStyles();
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      style={({ pressed }) => [s.row, !last && s.rowDivider, pressed && { backgroundColor: theme.surface }]}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      testID={testID}
    >
      <Text style={[s.rowLabel, error && { color: theme.error }]} numberOfLines={1}>{label}</Text>
      <View style={s.rowRight}>
        {value ? <Text style={s.rowValue} numberOfLines={1}>{value}</Text>
          : placeholder ? <Text style={[s.rowValue, { color: theme.subtle }]} numberOfLines={1}>{placeholder}</Text> : null}
        <Feather name="chevron-right" size={20} color={theme.muted} />
      </View>
    </Pressable>
  );
}

/** Vinted-style label-above field (Title / Describe your item) with a hairline under it. */
export function LabeledField({
  label, error, counter, last, ...input
}: TextInputProps & { label: string; error?: boolean; counter?: string; last?: boolean }) {
  const s = useStyles();
  const { theme } = useAppTheme();
  return (
    <View style={[s.field, !last && s.rowDivider]}>
      <Text style={[s.fieldLabel, error && { color: theme.error }]}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.subtle}
        selectionColor={theme.text}
        {...input}
        style={[s.fieldInput, input.multiline && s.fieldMultiline, input.style]}
      />
      {counter ? <Text style={s.counter}>{counter}</Text> : null}
    </View>
  );
}

/** Vinted's Parcel size / Condition row: title, description, radio on the right. */
export function RadioRow({
  label, description, selected, onPress, testID,
}: { label: string; description?: string; selected: boolean; onPress: () => void; testID?: string }) {
  const s = useStyles();
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      style={({ pressed }) => [s.choiceRow, s.rowDivider, pressed && { backgroundColor: theme.surface }]}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={s.choiceText}>
        <Text style={s.choiceLabel}>{label}</Text>
        {description ? <Text style={s.choiceDescription}>{description}</Text> : null}
      </View>
      <View style={[s.radio, { borderColor: selected ? theme.text : theme.muted }]}>
        {selected ? <View style={[s.radioDot, { backgroundColor: theme.text }]} /> : null}
      </View>
    </Pressable>
  );
}

/** Vinted's Colours / Material row: optional leading swatch, checkbox on the right. */
export function CheckRow({
  label, checked, onPress, leading, disabled, right, testID,
}: {
  label: string; checked: boolean; onPress: () => void;
  leading?: React.ReactNode; disabled?: boolean; right?: React.ReactNode; testID?: string;
}) {
  const s = useStyles();
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={() => { if (disabled) return; hapticLight(); onPress(); }}
      style={({ pressed }) => [s.choiceRow, s.rowDivider, pressed && !disabled && { backgroundColor: theme.surface }]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      testID={testID}
    >
      {leading}
      <Text style={[s.choiceLabel, s.choiceText, disabled && { color: theme.subtle }]}>{label}</Text>
      {right}
      <View style={[s.checkbox, { borderColor: checked ? theme.text : theme.muted, backgroundColor: checked ? theme.text : 'transparent' }]}>
        {checked ? <Feather name="check" size={14} color={theme.background} /> : null}
      </View>
    </Pressable>
  );
}

/** Plain drill-down row (Depop's category sheet: label + chevron, or a check when picked). */
export function ListChoiceRow({
  label, onPress, chevron, selected, testID,
}: { label: string; onPress: () => void; chevron?: boolean; selected?: boolean; testID?: string }) {
  const s = useStyles();
  const { theme } = useAppTheme();
  return (
    <Pressable
      onPress={() => { hapticLight(); onPress(); }}
      style={({ pressed }) => [s.row, s.rowDivider, pressed && { backgroundColor: theme.surface }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      testID={testID}
    >
      <Text style={s.rowLabel} numberOfLines={1}>{label}</Text>
      {chevron ? <Feather name="chevron-right" size={20} color={theme.muted} />
        : selected ? <Feather name="check" size={20} color={theme.text} /> : null}
    </Pressable>
  );
}

/**
 * Depop's sticky bottom bar: outlined "Save to drafts" beside a filled
 * primary action — or one full-width button (Vinted's "Done").
 */
export function ListingBottomBar({
  primaryLabel, onPrimary, primaryLoading, primaryDisabled, secondaryLabel, onSecondary, primaryTestID, secondaryTestID,
}: {
  primaryLabel: string; onPrimary: () => void; primaryLoading?: boolean; primaryDisabled?: boolean;
  secondaryLabel?: string; onSecondary?: () => void; primaryTestID?: string; secondaryTestID?: string;
}) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, SP.md) }]}>
      {secondaryLabel && onSecondary ? (
        <View style={s.barButton}>
          <Button label={secondaryLabel} onPress={onSecondary} variant="secondary" size="small" fullWidth testID={secondaryTestID} />
        </View>
      ) : null}
      <View style={s.barButton}>
        <Button
          label={primaryLabel} onPress={onPrimary} size="small" fullWidth
          loading={primaryLoading} disabled={primaryDisabled} testID={primaryTestID}
        />
      </View>
    </View>
  );
}

function makeStyles(t: AppThemePreset) {
  return StyleSheet.create({
    gap: { height: 8, backgroundColor: t.borderSubtle },
    note: { fontSize: FS.meta, lineHeight: 16, fontFamily: FONT.regular, color: t.muted, paddingHorizontal: SP.md, paddingTop: SP.sm, paddingBottom: SP.md, backgroundColor: t.borderSubtle },
    groupTitle: { fontSize: FS.md, fontFamily: FONT.bold, color: t.text, paddingHorizontal: SP.md, paddingTop: SP.lg, paddingBottom: SP.sm },
    row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, gap: SP.md, backgroundColor: t.background },
    rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
    rowLabel: { fontSize: FS.base, fontFamily: FONT.regular, color: t.text, flexShrink: 0 },
    rowRight: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: SP.xs },
    rowValue: { flexShrink: 1, fontSize: FS.base, fontFamily: FONT.regular, color: t.muted, textAlign: 'right' },
    field: { paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.sm, backgroundColor: t.background },
    fieldLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: t.muted, marginBottom: 6 },
    fieldInput: { fontSize: FS.base, fontFamily: FONT.regular, color: t.text, paddingVertical: 6, paddingHorizontal: 0 },
    fieldMultiline: { minHeight: 96, textAlignVertical: 'top' },
    counter: { alignSelf: 'flex-end', fontSize: FS.meta, fontFamily: FONT.regular, color: t.subtle },
    choiceRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md, paddingVertical: SP.sm + 2, gap: SP.md, backgroundColor: t.background },
    choiceText: { flex: 1 },
    choiceLabel: { fontSize: FS.base, fontFamily: FONT.regular, color: t.text },
    choiceDescription: { fontSize: FS.sm, lineHeight: 18, fontFamily: FONT.regular, color: t.muted, marginTop: 2 },
    radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
    radioDot: { width: 10, height: 10, borderRadius: 5 },
    checkbox: { width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
    bar: { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.sm + 2, backgroundColor: t.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border },
    barButton: { flex: 1 },
  });
}
