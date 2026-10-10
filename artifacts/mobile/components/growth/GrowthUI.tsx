import React from 'react';
import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { PressableScale } from '@/components/BrandthreadUI';

export function Field({ label, error, style, ...rest }: TextInputProps & { label: string; error?: string | null }) {
  const colors = useColors();
  return (
    <View style={{ marginBottom: SP.md }}>
      <Text style={[st.label, { color: colors.mutedForeground }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.subtle}
        accessibilityLabel={label}
        {...rest}
        style={[st.input, { backgroundColor: colors.secondary, borderColor: error ? colors.destructive : colors.border, color: colors.foreground }, style]}
      />
      {!!error && <Text style={[st.error, { color: colors.destructive }]}>{error}</Text>}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[st.chip, { backgroundColor: active ? colors.primary : 'transparent', borderColor: active ? colors.primary : colors.border }]}
    >
      <Text style={[st.chipText, { color: active ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
    </PressableScale>
  );
}

export function CopyRow({ value, label = 'Copy link' }: { value: string; label?: string }) {
  const colors = useColors();
  const [done, setDone] = React.useState(false);
  return (
    <View style={[st.copyRow, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
      <Text style={[st.copyText, { color: colors.foreground }]} numberOfLines={1} selectable>{value}</Text>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={async () => {
          await Clipboard.setStringAsync(value);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        }}
        style={st.copyBtn}
      >
        <Feather name={done ? 'check' : 'copy'} size={18} color={colors.foreground} />
      </PressableScale>
    </View>
  );
}

/** Whole-dollar money for tiles so large totals never need truncating. */
export function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/** Equal-width metric tiles in a grid (2 per row when `cols` is 2). Text wraps, never truncates. */
export function MetricTiles({ items, cols }: { items: { key: string; label: string; value: string }[]; cols: 2 | 3 }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm }}>
      {items.map((it) => (
        <View
          key={it.key}
          style={[st.tile, { backgroundColor: colors.card, borderColor: colors.border, width: cols === 2 ? '48.5%' : '31.5%' }]}
        >
          <Text style={[st.tileLabel, { color: colors.mutedForeground }]}>{it.label}</Text>
          <Text style={[st.tileValue, { color: colors.foreground }]}>{it.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function MetricRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const colors = useColors();
  return (
    <View style={[st.metric, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
      <Text style={[st.metricLabel, { color: colors.foreground }]} numberOfLines={1}>{label}</Text>
      <Text style={[st.metricValue, { color: colors.mutedForeground }]}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  label: { fontSize: FS.sm, fontFamily: FONT.semibold, marginBottom: 6 },
  input: { fontSize: FS.base, fontFamily: FONT.regular, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: SP.md, paddingVertical: 10, minHeight: 46 },
  error: { fontSize: FS.meta, fontFamily: FONT.medium, marginTop: 4 },
  chip: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center' },
  chipText: { fontSize: FS.sm, fontFamily: FONT.semibold },
  copyRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.sm, paddingLeft: SP.md },
  copyText: { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium },
  copyBtn: { width: 48, height: 46, alignItems: 'center', justifyContent: 'center' },
  tile: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 12, minHeight: 72, justifyContent: 'center' },
  tileLabel: { fontSize: FS.meta, fontFamily: FONT.medium },
  tileValue: { fontSize: FS.lg, fontFamily: FONT.bold, marginTop: 2 },
  metric: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, gap: SP.md },
  metricLabel: { fontSize: FS.base, fontFamily: FONT.medium, flex: 1 },
  metricValue: { fontSize: FS.base, fontFamily: FONT.semibold },
});
