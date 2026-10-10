/** Small shared building blocks for the seller email marketing screens. */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP, FILL_ELEVATED, TEXT_TERTIARY } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';

export function Field({
  label, value, onChangeText, max, multiline, ...rest
}: { label: string; value: string; onChangeText: (t: string) => void; max?: number; multiline?: boolean } & Omit<TextInputProps, 'value' | 'onChangeText'>) {
  const c = useColors();
  return (
    <View style={{ marginBottom: SP.md }}>
      <View style={st.labelRow}>
        <Text style={[st.label, { color: c.foreground }]}>{label}</Text>
        {max ? <Text style={[st.counter, { color: c.mutedForeground }]}>{value.length}/{max}</Text> : null}
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        maxLength={max}
        multiline={multiline}
        placeholderTextColor={c.mutedForeground}
        accessibilityLabel={label}
        style={[
          st.input,
          { borderColor: c.border, color: c.foreground, backgroundColor: c.background },
          multiline && { minHeight: 110, textAlignVertical: 'top', paddingTop: 12 },
        ]}
        {...rest}
      />
    </View>
  );
}

export function SolidButton({ label, onPress, disabled, loading, outline }: {
  label: string; onPress: () => void; disabled?: boolean; loading?: boolean; outline?: boolean;
}) {
  const c = useColors();
  return (
    <PressableScale
      onPress={() => { if (!disabled && !loading) onPress(); }}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[
        st.btn,
        outline ? { borderColor: c.foreground, borderWidth: 1 } : { backgroundColor: c.foreground },
        disabled && (outline ? { borderColor: TEXT_TERTIARY } : { backgroundColor: FILL_ELEVATED }),
      ]}
    >
      {loading
        ? <ActivityIndicator color={disabled ? TEXT_TERTIARY : outline ? c.foreground : c.background} />
        : <Text style={[st.btnText, { color: disabled ? TEXT_TERTIARY : outline ? c.foreground : c.background }]}>{label}</Text>}
    </PressableScale>
  );
}

export function Notice({ text }: { text: string }) {
  const c = useColors();
  return (
    <View style={[st.notice, { borderColor: c.border }]}>
      <Text style={[st.noticeText, { color: c.foreground }]}>{text}</Text>
    </View>
  );
}

export function Hairline() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

export function Heading({ children }: { children: string }) {
  const c = useColors();
  return <Text style={[st.heading, { color: c.mutedForeground }]}>{children}</Text>;
}

const st = StyleSheet.create({
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  label: { fontFamily: FONT.semibold, fontSize: FS.sm },
  counter: { fontFamily: FONT.regular, fontSize: FS.xs },
  input: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 14, minHeight: 48, fontFamily: FONT.regular, fontSize: FS.md },
  btn: { minHeight: 50, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnText: { fontFamily: FONT.bold, fontSize: FS.md },
  notice: { borderWidth: 1, borderRadius: RADIUS.md, padding: 14, marginBottom: SP.md },
  noticeText: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 20 },
  heading: { fontFamily: FONT.semibold, fontSize: FS.xs, marginTop: SP.lg, marginBottom: SP.sm },
});
