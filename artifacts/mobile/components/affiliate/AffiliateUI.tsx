import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FILL_ELEVATED, FONT, FS, SP, RADIUS, TEXT_DISABLED } from '@/lib/theme';

/** Two-tab switch (Overview / Payouts): text tabs with an underline on the active one. */
export function SegmentTabs<T extends string>({ tabs, value, onChange }: {
  tabs: Array<{ key: T; label: string }>; value: T; onChange: (k: T) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <View style={[st.tabs, { borderBottomColor: theme.border }]} accessibilityRole="tablist">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <TouchableOpacity
            key={t.key}
            onPress={() => onChange(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[st.tab, active && { borderBottomColor: theme.text }]}
          >
            <Text style={[st.tabText, { color: active ? theme.text : theme.muted }]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** One "label ........ value" line, like the Key stats list on an earnings screen. */
export function KeyStatRow({ label, value, note, last }: { label: string; value: string; note?: string; last?: boolean }) {
  const { theme } = useAppTheme();
  return (
    <View style={[st.statRow, !last && { borderBottomColor: theme.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={{ flex: 1 }}>
        <Text style={[st.statLabel, { color: theme.text }]}>{label}</Text>
        {note ? <Text style={[st.statNote, { color: theme.muted }]}>{note}</Text> : null}
      </View>
      <Text style={[st.statValue, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

export function Pill({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'strong' | 'warn' }) {
  const { theme } = useAppTheme();
  const bg = tone === 'strong' ? theme.text : tone === 'warn' ? theme.surface : theme.surface;
  const fg = tone === 'strong' ? theme.background : theme.text;
  return (
    <View style={[st.pill, { backgroundColor: bg, borderColor: theme.border, borderWidth: tone === 'strong' ? 0 : 1 }]}>
      <Text style={[st.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** Solid black/white action button; `outline` for the quieter companion action. */
export function ActionButton({ label, onPress, outline, disabled, loading, flex }: {
  label: string; onPress: () => void; outline?: boolean; disabled?: boolean; loading?: boolean; flex?: boolean;
}) {
  const { theme } = useAppTheme();
  const inactive = disabled || loading;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        st.btn,
        flex && { flex: 1 },
        outline ? { borderColor: theme.border, borderWidth: 1, backgroundColor: 'transparent' } : { backgroundColor: inactive ? FILL_ELEVATED : theme.text },
      ]}
    >
      {/* Inactive: solid gray fill + gray label, never a faded button. */}
      <Text style={[st.btnText, { color: inactive ? TEXT_DISABLED : outline ? theme.text : theme.background }]}>{loading ? 'Working…' : label}</Text>
    </TouchableOpacity>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  const { theme } = useAppTheme();
  return <View style={[st.card, { backgroundColor: theme.card, borderColor: theme.border }, style]}>{children}</View>;
}

export function SectionTitle({ children }: { children: string }) {
  const { theme } = useAppTheme();
  return <Text style={[st.sectionTitle, { color: theme.text }]}>{children}</Text>;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function pct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, '')}%`;
}

const st = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: SP.md },
  tab: { paddingVertical: SP.sm + 2, marginRight: SP.lg, borderBottomWidth: 2, borderBottomColor: 'transparent', minHeight: 44, justifyContent: 'center' },
  tabText: { fontFamily: FONT.semibold, fontSize: FS.base },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.md },
  statLabel: { fontFamily: FONT.semibold, fontSize: FS.base },
  statNote: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  statValue: { fontFamily: FONT.bold, fontSize: FS.base },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: RADIUS.pill, alignSelf: 'flex-start' },
  pillText: { fontFamily: FONT.semibold, fontSize: FS.xs },
  btn: { minHeight: 48, borderRadius: RADIUS.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.md },
  btnText: { fontFamily: FONT.bold, fontSize: FS.base },
  card: { borderWidth: 1, borderRadius: RADIUS.lg, padding: SP.md, marginBottom: SP.md },
  sectionTitle: { fontFamily: FONT.bold, fontSize: FS.xl, marginTop: SP.md, marginBottom: SP.sm, letterSpacing: -0.3 },
});
