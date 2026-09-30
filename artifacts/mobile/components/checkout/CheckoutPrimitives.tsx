/**
 * Checkout building blocks: a flat page that follows the active app theme
 * (Shop "Review & Pay", reskinned for Brandthread). There are no card
 * containers:
 *  - every section is a small uppercase label with its content sitting
 *    directly on the theme's background;
 *  - sections are split by a 1px hairline;
 *  - inputs are fields with a hairline border only;
 *  - 16px side gutters (the page's padding), 24px between sections.
 * Selection and focus use the theme's text color. Validation text uses the
 * theme's text color with an alert icon, never red (red is reserved for
 * LIVE and end-call).
 */
import React, { useMemo, useState } from 'react';
import {
  FlatList, Modal, Platform, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PressableScale } from '@/components/BrandthreadUI';
import { IconButton } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { COMP, FONT, FS, SP } from '@/lib/theme';

/** The checkout's palette, derived from the active app theme. */
export function useCheckoutColors() {
  const { theme } = useAppTheme();
  return useMemo(() => ({
    bg: theme.background,
    text: theme.text,
    muted: theme.muted,
    subtle: theme.subtle,
    divider: theme.borderSubtle,
    fieldBorder: theme.border,
    fieldFocus: theme.text,
  }), [theme]);
}

export type CheckoutColors = ReturnType<typeof useCheckoutColors>;

export const SECTION_GAP = 24;
export const GUTTER = SP.md;

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    section: { paddingVertical: SECTION_GAP / 2 + 2 },
    sectionDivider: { borderTopWidth: 1, borderTopColor: ck.divider },
    labelRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: SP.sm + 4, minHeight: 18,
    },
    label: { fontFamily: FONT.semibold, fontSize: FS.xs, letterSpacing: 1, textTransform: 'uppercase', color: ck.muted },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
    radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: ck.text },
    option: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4, paddingVertical: SP.sm + 6, minHeight: 52 },
    optionDivider: { borderBottomWidth: 1, borderBottomColor: ck.divider },
    optionCopy: { flex: 1, minWidth: 0 },
    optionTitle: { fontFamily: FONT.medium, fontSize: FS.base, color: ck.text },
    optionLine: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: ck.muted, marginTop: 1 },
    field: { marginBottom: SP.sm + 4 },
    fieldLabel: { fontFamily: FONT.medium, fontSize: FS.sm, marginBottom: 6, color: ck.muted },
    input: {
      minHeight: 48, borderRadius: 12, borderWidth: 1,
      paddingHorizontal: 14, paddingVertical: 12,
      fontFamily: FONT.regular, fontSize: FS.base, color: ck.text, backgroundColor: ck.bg,
      // The field's own border already shows focus; drop the browser outline.
      ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
    },
    picker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm },
    pickerText: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base },
    messageRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
    fieldError: { fontFamily: FONT.medium, fontSize: FS.meta, color: ck.text },
    fieldHint: { fontFamily: FONT.medium, fontSize: FS.meta, marginTop: 6, color: ck.subtle },
    hairline: { height: 1, backgroundColor: ck.divider, marginVertical: SP.sm + 4 },
    textAction: { fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline', color: ck.text },
    sheet: { flex: 1, backgroundColor: ck.bg },
    sheetHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: SP.sm, paddingBottom: SP.sm, borderBottomWidth: 1, borderBottomColor: ck.divider,
    },
    sheetTitle: { fontFamily: FONT.semibold, fontSize: FS.md, color: ck.text },
  });
}

function useCheckoutStyles() {
  const ck = useCheckoutColors();
  const styles = useMemo(() => makeStyles(ck), [ck]);
  return { ck, styles };
}

export function CheckoutSection({
  title, trailing, children, first, style, testID,
}: {
  title?: string;
  /** Right side of the label row (e.g. a "Change" link): a sibling, never wrapping the section. */
  trailing?: React.ReactNode;
  children: React.ReactNode;
  /** The first section has no divider above it. */
  first?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { styles } = useCheckoutStyles();
  return (
    <View style={[styles.section, first ? null : styles.sectionDivider, style]} testID={testID}>
      {(title || trailing) ? (
        <View style={styles.labelRow}>
          {title ? <Text style={styles.label} accessibilityRole="header">{title}</Text> : <View />}
          {trailing}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A radio dot that follows the theme's text color when selected. */
export function RadioDot({ selected }: { selected: boolean }) {
  const { ck, styles } = useCheckoutStyles();
  return (
    <View style={[styles.radio, { borderColor: selected ? ck.text : ck.subtle }]}>
      {selected ? <View style={styles.radioInner} /> : null}
    </View>
  );
}

/** One selectable row (saved address, saved card, "Use a new …"): no box, a hairline under it. */
export function OptionRow({
  selected, onPress, title, lines, leading, accessibilityLabel, last, testID,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  lines?: string[];
  leading?: React.ReactNode;
  accessibilityLabel?: string;
  last?: boolean;
  testID?: string;
}) {
  const { styles } = useCheckoutStyles();
  return (
    <PressableScale
      onPress={onPress}
      style={[styles.option, last ? null : styles.optionDivider]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? [title, ...(lines ?? [])].join(', ')}
      rippleEnabled={false}
      testID={testID}
    >
      <RadioDot selected={selected} />
      {leading}
      <View style={styles.optionCopy}>
        <Text style={styles.optionTitle} numberOfLines={1}>{title}</Text>
        {lines?.filter(Boolean).map(line => (
          <Text key={line} style={styles.optionLine} numberOfLines={1}>{line}</Text>
        ))}
      </View>
    </PressableScale>
  );
}

function FieldMessage({ error, hint }: { error?: string; hint?: string }) {
  const { ck, styles } = useCheckoutStyles();
  if (error) {
    return (
      <View style={styles.messageRow} accessibilityLiveRegion="polite">
        <Feather name="alert-circle" size={12} color={ck.text} />
        <Text style={styles.fieldError}>{error}</Text>
      </View>
    );
  }
  return hint ? <Text style={styles.fieldHint}>{hint}</Text> : null;
}

/**
 * A labeled field with a hairline border. The label sits above the
 * box (never placeholder-only), so it stays readable once filled.
 */
export function CheckoutField({
  label, value, onChangeText, error, showError, hint, style, testID, ...inputProps
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  /** Only show `error` once the buyer left the field (or tried to pay). */
  showError?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'style'>) {
  const { ck, styles } = useCheckoutStyles();
  const [focused, setFocused] = useState(false);
  const [blurred, setBlurred] = useState(false);
  const visibleError = error && (showError || blurred) ? error : undefined;
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...inputProps}
        value={value}
        onChangeText={onChangeText}
        onFocus={(event) => { setFocused(true); inputProps.onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); setBlurred(true); inputProps.onBlur?.(event); }}
        placeholderTextColor={ck.subtle}
        selectionColor={ck.text}
        accessibilityLabel={inputProps.accessibilityLabel ?? label}
        accessibilityHint={visibleError ?? hint}
        testID={testID}
        style={[styles.input, { borderColor: focused || visibleError ? ck.fieldFocus : ck.fieldBorder }]}
      />
      <FieldMessage error={visibleError} hint={hint} />
    </View>
  );
}

export type PickerOption = { value: string; label: string };

/**
 * A field that opens a list to pick from (state, country). Looks like
 * CheckoutField; the list is a full-height sheet with the same flat rows.
 */
export function PickerField({
  label, value, options, onChange, error, showError, placeholder, style, testID,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  error?: string;
  showError?: boolean;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { ck, styles } = useCheckoutStyles();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const selected = options.find(option => option.value === value);
  const visibleError = error && showError ? error : undefined;
  return (
    <View style={[styles.field, style]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <PressableScale
        onPress={() => setOpen(true)}
        style={[styles.input, styles.picker, { borderColor: visibleError ? ck.fieldFocus : ck.fieldBorder }]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? 'not chosen'}`}
        accessibilityHint={`Opens a list of ${label.toLowerCase()} options`}
        rippleEnabled={false}
        testID={testID}
      >
        <Text style={[styles.pickerText, { color: selected ? ck.text : ck.subtle }]} numberOfLines={1}>
          {selected?.label ?? placeholder ?? 'Select'}
        </Text>
        <Feather name="chevron-down" size={16} color={ck.muted} />
      </PressableScale>
      <FieldMessage error={visibleError} />
      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[styles.sheet, { paddingTop: Platform.OS === 'web' ? Math.max(insets.top, 54) : SP.sm }]}>
          <View style={styles.sheetHeader}>
            <IconButton name="x" variant="plain" onPress={() => setOpen(false)} accessibilityLabel={`Close ${label} list`} />
            <Text style={styles.sheetTitle}>{label}</Text>
            <View style={{ width: COMP.minTouchTarget }} />
          </View>
          <FlatList
            data={options}
            keyExtractor={option => option.value}
            initialNumToRender={20}
            bounces={false}
            overScrollMode="never"
            contentContainerStyle={{ paddingHorizontal: GUTTER, paddingBottom: Math.max(insets.bottom, SP.sm) + SP.lg }}
            renderItem={({ item, index }) => (
              <OptionRow
                selected={item.value === value}
                title={item.label}
                onPress={() => { onChange(item.value); setOpen(false); }}
                last={index === options.length - 1}
                testID={`${testID ?? 'picker'}-${item.value}`}
              />
            )}
          />
        </View>
      </Modal>
    </View>
  );
}

export function Hairline({ style }: { style?: StyleProp<ViewStyle> }) {
  const { styles } = useCheckoutStyles();
  return <View style={[styles.hairline, style]} />;
}

/** A plain underlined text action (e.g. "Change", "Remove"). */
export function TextAction({ label, onPress, accessibilityLabel, testID }: { label: string; onPress: () => void; accessibilityLabel?: string; testID?: string }) {
  const { styles } = useCheckoutStyles();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      rippleEnabled={false}
      noMinHeight
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      testID={testID}
    >
      <Text style={styles.textAction}>{label}</Text>
    </PressableScale>
  );
}
