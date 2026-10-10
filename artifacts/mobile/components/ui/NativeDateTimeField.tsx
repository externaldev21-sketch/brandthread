/**
 * Brandthread Design System — NativeDateTimeField.
 *
 * One row for every "pick a date / time" in the app: the label on the left,
 * the value on a solid FILL_ELEVATED pill on the right — the iOS compact
 * date button Apple's Calendar and Reminders use.
 *
 *   iOS      @react-native-community/datetimepicker, display "compact" (the
 *            system button that opens the calendar / time popover), or
 *            "inline" / "spinner" when a screen asks for a full calendar.
 *   Android  the same library's system dialog (tap the pill → dialog);
 *            datetime opens the date dialog, then the time dialog.
 *   Web      a native <input type="date|time|datetime-local"> styled as the
 *            pill, rendered through react-native-web's DOM.
 *
 * The native module is required lazily and only after checking it is
 * registered, so a build without it never crashes: the row then renders the
 * caller's `fallback` (the screen's previous input) or a plain text field
 * that accepts YYYY-MM-DD / HH:MM.
 *
 * Values are `Date | null` in local time; lib/dateTimeField.ts converts to
 * and from the strings screens store.
 */
import React from 'react';
import {
  Platform, Pressable, StyleSheet, Text, TextInput, TurboModuleRegistry, UIManager, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';
import { haptics } from '@/lib/haptics';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { BODY_MAX_FONT_MULTIPLIER } from '@/lib/dynamicType';
import { SPACING } from '@/constants/spacing';
import {
  clampDate, dateToHm, dateToYmd, defaultPickerValue, formatFieldValue, fromWebInputValue, mergeDayAndTime,
  toWebInputValue, type DateTimeFieldMode,
} from '@/lib/dateTimeField';

export interface NativeDateTimeFieldProps {
  mode: DateTimeFieldMode;
  value: Date | null;
  onChange: (next: Date) => void;
  label: string;
  minimumDate?: Date;
  maximumDate?: Date;
  /** Shown on the pill while `value` is null. */
  placeholder?: string;
  /** Adds a clear control while a value is set (optional dates). */
  onClear?: () => void;
  /** iOS only: "compact" (default) or a full "inline" calendar / "spinner" wheel under the label. */
  iosDisplay?: 'compact' | 'inline' | 'spinner';
  /** iOS only: the full picker an empty compact field expands to (default: calendar for dates, wheels for times). */
  iosEmptyDisplay?: 'inline' | 'spinner';
  /** Where the picker starts while `value` is null (default: now, inside the bounds). Never committed by itself. */
  defaultValue?: Date;
  minuteInterval?: 1 | 5 | 10 | 15 | 30;
  /** The screen's previous input, rendered when the native picker is not in this build. */
  fallback?: React.ReactNode;
  disabled?: boolean;
  /** Inset hairline under the row, for stacked rows in a plain list. */
  divider?: boolean;
  /** "row" (default): label left, value right. "pill": just the value control, for a screen that already labels it. */
  variant?: 'row' | 'pill';
  /** Validation message under the row (error color). */
  error?: string | null;
  /** Short note under the row while there is no error. */
  helper?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type PickerModule = typeof import('@react-native-community/datetimepicker');
let pickerModule: PickerModule | null | undefined;

/** The native picker, or null when this build/platform doesn't have it. */
function loadPicker(): PickerModule | null {
  if (pickerModule !== undefined) return pickerModule;
  pickerModule = null;
  try {
    if (Platform.OS === 'android') {
      if (!TurboModuleRegistry.get('RNCDatePicker')) return null;
    } else if (Platform.OS === 'ios') {
      const has = (UIManager as { hasViewManagerConfig?: (name: string) => boolean }).hasViewManagerConfig;
      if (typeof has === 'function' && !has('RNDateTimePicker')) return null;
    } else {
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pickerModule = require('@react-native-community/datetimepicker') as PickerModule;
  } catch {
    pickerModule = null;
  }
  return pickerModule;
}

const WEB_INPUT_TYPE: Record<DateTimeFieldMode, string> = { date: 'date', time: 'time', datetime: 'datetime-local' };
const WEB_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function NativeDateTimeField({
  mode, value, onChange, label, minimumDate, maximumDate, placeholder = 'None', onClear,
  iosDisplay = 'compact', iosEmptyDisplay, defaultValue, minuteInterval, fallback, disabled, divider, error, helper, variant = 'row', style, testID,
}: NativeDateTimeFieldProps) {
  const palette = useColors();
  const picker = Platform.OS === 'web' ? null : loadPicker();
  const [expanded, setExpanded] = React.useState(false);
  const startValue = () => value ?? (defaultValue ? clampDate(defaultValue, minimumDate, maximumDate) : defaultPickerValue(mode, minimumDate, maximumDate));

  const pill = (text: string, onPress: (() => void) | undefined, key: string, a11y: string, empty: boolean) => (
    <Pressable
      key={key}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[styles.pill, disabled && styles.disabled]}
      testID={testID ? `${testID}-${key}` : undefined}
    >
      <Text
        style={[styles.pillText, { color: empty ? palette.mutedForeground : palette.foreground }]}
        numberOfLines={1}
        maxFontSizeMultiplier={BODY_MAX_FONT_MULTIPLIER}
      >
        {text}
      </Text>
    </Pressable>
  );

  let control: React.ReactNode;
  let below: React.ReactNode = null;

  if (Platform.OS === 'web') {
    control = (
      <View style={[styles.webPill, disabled && styles.disabled]}>
        {React.createElement('input', {
          type: WEB_INPUT_TYPE[mode],
          value: toWebInputValue(value, mode),
          min: minimumDate ? toWebInputValue(minimumDate, mode) : undefined,
          max: maximumDate ? toWebInputValue(maximumDate, mode) : undefined,
          step: minuteInterval && mode !== 'date' ? minuteInterval * 60 : undefined,
          disabled,
          'aria-label': label,
          'data-testid': testID,
          onChange: (e: { target: { value: string } }) => {
            const next = fromWebInputValue(e.target.value, mode, value);
            if (next) { haptics.selection(); onChange(next); } else if (!e.target.value && onClear) onClear();
          },
          style: {
            appearance: 'none', WebkitAppearance: 'none', border: 'none', outline: 'none', margin: 0,
            background: 'transparent', color: value ? palette.foreground : palette.mutedForeground,
            colorScheme: 'dark', fontFamily: WEB_FONT, fontSize: 17, lineHeight: '22px',
            padding: '6px 11px', minHeight: 34, boxSizing: 'border-box', cursor: disabled ? 'default' : 'pointer',
          },
        })}
      </View>
    );
  } else if (picker && Platform.OS === 'ios') {
    const Picker = picker.default;
    // An empty field can't show the compact button (it needs a value), and
    // tapping must not commit a made-up value — so the pill expands a full
    // picker under the row; the value is set only once the user moves it.
    const display = !value || expanded
      ? (iosDisplay === 'compact' ? (iosEmptyDisplay ?? (mode === 'time' ? 'spinner' : 'inline')) : iosDisplay)
      : iosDisplay;
    if (display === 'compact' && value) {
      control = (
        <Picker
          value={value}
          mode={mode}
          display="compact"
          themeVariant="dark"
          accentColor={palette.foreground}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          minuteInterval={minuteInterval}
          disabled={disabled}
          accessibilityLabel={label}
          testID={testID}
          onChange={(event, next) => { if (event.type === 'set' && next) onChange(next); }}
        />
      );
    } else {
      const text = value ? formatFieldValue(value, mode) : placeholder;
      const collapsible = iosDisplay === 'compact';
      control = pill(text, collapsible ? () => setExpanded((v) => !v) : undefined, 'value', `${label}, ${text}`, !value);
      below = (!collapsible || expanded) ? (
        <Picker
          value={startValue()}
          mode={mode}
          display={display as 'inline' | 'spinner'}
          themeVariant="dark"
          accentColor={palette.foreground}
          textColor={palette.foreground}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          minuteInterval={minuteInterval}
          disabled={disabled}
          accessibilityLabel={label}
          testID={testID ? `${testID}-picker` : undefined}
          onChange={(event, next) => {
            if (event.type !== 'set' || !next) return;
            onChange(next);
            // A day tap on the calendar is a finished choice (Reminders); wheels stay open until the pill is tapped.
            if (display === 'inline' && mode === 'date') setExpanded(false);
          }}
        />
      ) : null;
    }
  } else if (picker && Platform.OS === 'android') {
    const open = (part: 'date' | 'time', then?: (picked: Date) => void) => {
      const base = startValue();
      picker.DateTimePickerAndroid.open({
        value: base,
        mode: part,
        minimumDate: part === 'date' ? minimumDate : undefined,
        maximumDate: part === 'date' ? maximumDate : undefined,
        minuteInterval: part === 'time' ? minuteInterval : undefined,
        onChange: (event, picked) => {
          if (event.type !== 'set' || !picked) return;
          const next = part === 'date' ? mergeDayAndTime(picked, base) : mergeDayAndTime(base, picked);
          if (then) { then(next); return; }
          haptics.selection();
          onChange(next);
        },
      });
    };
    const openTimeAfterDate = (picked: Date) => {
      haptics.selection();
      onChange(picked);
      picker.DateTimePickerAndroid.open({
        value: picked,
        mode: 'time',
        minuteInterval,
        onChange: (event, t) => {
          if (event.type !== 'set' || !t) return;
          haptics.selection();
          onChange(mergeDayAndTime(picked, t));
        },
      });
    };
    const dateText = value ? formatFieldValue(value, 'date') : placeholder;
    const timeText = value ? formatFieldValue(value, 'time') : placeholder;
    control = mode === 'time'
      ? pill(timeText, () => open('time'), 'time', `${label}, ${timeText}`, !value)
      : mode === 'date'
        ? pill(dateText, () => open('date'), 'date', `${label}, ${dateText}`, !value)
        : value
          ? <View style={styles.pair}>
              {pill(dateText, () => open('date'), 'date', `${label} date, ${dateText}`, false)}
              {pill(timeText, () => open('time'), 'time', `${label} time, ${timeText}`, false)}
            </View>
          : pill(placeholder, () => open('date', openTimeAfterDate), 'date', `${label}, ${placeholder}`, true);
  } else {
    if (fallback !== undefined) return <>{fallback}</>;
    control = <FallbackTextField mode={mode} value={value} onChange={onChange} onClear={onClear} label={label} disabled={disabled} testID={testID} />;
  }

  return (
    <View style={style}>
      <View style={variant === 'pill' ? styles.pillRow : styles.row} testID={testID ? `${testID}-row` : undefined}>
        {variant === 'row' && (
          <Text style={[styles.label, { color: palette.foreground }]} numberOfLines={1} maxFontSizeMultiplier={BODY_MAX_FONT_MULTIPLIER}>
            {label}
          </Text>
        )}
        <View style={variant === 'pill' ? styles.pillTrailing : styles.trailing}>
          {control}
          {!!onClear && !!value && !disabled && (
            <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Clear ${label}`} testID={testID ? `${testID}-clear` : undefined}>
              <Icon name="x-circle" size={17} color={palette.mutedForeground} />
            </Pressable>
          )}
        </View>
        {divider && <View pointerEvents="none" style={[styles.divider, { backgroundColor: palette.border }]} />}
      </View>
      {below}
      {!!error && <Text testID={testID ? `${testID}-error` : undefined} style={[styles.note, { color: palette.destructive }]} accessibilityLiveRegion="polite">{error}</Text>}
      {!error && !!helper && <Text style={[styles.note, { color: palette.mutedForeground }]}>{helper}</Text>}
    </View>
  );
}

/** Plain text entry in the pill, for builds without the native module. */
function FallbackTextField({
  mode, value, onChange, onClear, label, disabled, testID,
}: Pick<NativeDateTimeFieldProps, 'mode' | 'value' | 'onChange' | 'onClear' | 'label' | 'disabled' | 'testID'>) {
  const palette = useColors();
  const format = (d: Date | null) => (d ? (mode === 'date' ? dateToYmd(d) : mode === 'time' ? dateToHm(d) : `${dateToYmd(d)} ${dateToHm(d)}`) : '');
  const [text, setText] = React.useState(format(value));
  React.useEffect(() => { setText(format(value)); }, [value?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const next = fromWebInputValue(text, mode, value);
    if (next) onChange(next);
    else if (!text.trim() && onClear) onClear();
    else setText(format(value));
  };
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onBlur={commit}
      onSubmitEditing={commit}
      editable={!disabled}
      placeholder={mode === 'date' ? 'YYYY-MM-DD' : mode === 'time' ? 'HH:MM' : 'YYYY-MM-DD HH:MM'}
      placeholderTextColor={palette.mutedForeground}
      keyboardType="numbers-and-punctuation"
      autoCorrect={false}
      accessibilityLabel={label}
      testID={testID}
      maxFontSizeMultiplier={BODY_MAX_FONT_MULTIPLIER}
      style={[styles.pill, styles.pillText, styles.fallbackInput, { color: palette.foreground }, WEB_INPUT_RESET]}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: 52, paddingVertical: SPACING.xs },
  label: { ...TEXT.body, fontFamily: FONT.regular, flexShrink: 1 },
  trailing: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: SPACING.xs },
  pillRow: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  pillTrailing: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  pair: { flexDirection: 'row', gap: 6 },
  pill: { backgroundColor: FILL_ELEVATED, borderRadius: 8, paddingHorizontal: 11, minHeight: 34, justifyContent: 'center' },
  webPill: { backgroundColor: FILL_ELEVATED, borderRadius: 8, overflow: 'hidden' },
  pillText: { ...TEXT.body, fontFamily: FONT.regular, fontVariant: ['tabular-nums'] },
  fallbackInput: { minWidth: 120, textAlign: 'right', paddingVertical: 6 },
  disabled: { opacity: 0.5 },
  note: { ...TEXT.footnote, marginTop: 2 },
  divider: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
});
