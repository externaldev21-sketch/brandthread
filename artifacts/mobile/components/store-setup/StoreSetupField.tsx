/**
 * Labelled outlined input with a one-line status under it — a spinner while
 * checking, a green check when the value is good, a message when it is not.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { TYPE_SCALE } from '@/constants/typography';

export type FieldStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

interface Props extends Omit<TextInputProps, 'style'> {
  label: string;
  prefix?: string;
  status: FieldStatus;
}

export function StoreSetupField({ label, prefix, status, ...inputProps }: Props) {
  const { theme } = useAppTheme();
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <View style={[styles.box, { borderColor: focused ? theme.text : theme.border, backgroundColor: theme.background }]}>
        {prefix ? <Text style={[styles.prefix, { color: theme.muted }]}>{prefix}</Text> : null}
        <TextInput
          {...inputProps}
          onFocus={(e) => { setFocused(true); inputProps.onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); inputProps.onBlur?.(e); }}
          placeholderTextColor={theme.muted}
          selectionColor={theme.text}
          accessibilityLabel={label}
          style={[styles.input, { color: theme.text }]}
        />
      </View>
      <View style={styles.statusRow} accessibilityLiveRegion="polite">
        {status.kind === 'checking' ? <ActivityIndicator size="small" color={theme.muted} /> : null}
        {status.kind === 'ok' ? <Feather name="check-circle" size={15} color={theme.success} /> : null}
        {status.kind === 'error' ? <Feather name="x-circle" size={15} color={theme.text} /> : null}
        {status.kind === 'checking' ? <Text style={[styles.status, { color: theme.muted }]}>Checking</Text> : null}
        {status.kind === 'ok' ? <Text style={[styles.status, { color: theme.success }]}>{status.message}</Text> : null}
        {status.kind === 'error' ? <Text style={[styles.status, { color: theme.text }]}>{status.message}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: SP.sm },
  label: { ...TYPE_SCALE.callout, fontFamily: FONT.semibold },
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RADII.input, paddingHorizontal: SP.md, minHeight: 52 },
  prefix: { ...TYPE_SCALE.body, marginRight: 2 },
  input: { flex: 1, ...TYPE_SCALE.body, paddingVertical: 12, outlineStyle: 'none' } as any,
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 20 },
  status: { ...TYPE_SCALE.footnote, flexShrink: 1 },
});
