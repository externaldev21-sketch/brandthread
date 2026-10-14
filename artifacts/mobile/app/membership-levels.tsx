/**
 * Seller: membership levels. Buyers move Member → Insider → Inner Circle with
 * this brand by lifetime spend; the seller sets the two thresholds (defaults
 * $250 / $1,000) and can open scheduled drops to Inner Circle early.
 * Server: routes/brand-membership.ts.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { useColors } from '@/hooks/useColors';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { Header } from '@/components/layout';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { DEFAULT_LEVEL_SETTINGS, parseDollars } from '@/lib/membershipLevels';

const EARLY_ACCESS = [
  { minutes: 0, label: 'Off' },
  { minutes: 15, label: '15 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 24 * 60, label: '24 hours' },
];

export default function MembershipLevelsScreen() {
  const api = useApi();
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [insider, setInsider] = useState(String(DEFAULT_LEVEL_SETTINGS.insiderCents / 100));
  const [inner, setInner] = useState(String(DEFAULT_LEVEL_SETTINGS.innerCircleCents / 100));
  const [early, setEarly] = useState(0);

  useEffect(() => {
    let active = true;
    api.brandMembership.settings()
      .then((s) => {
        if (!active) return;
        setInsider(String(Math.round(s.insiderCents / 100)));
        setInner(String(Math.round(s.innerCircleCents / 100)));
        setEarly(s.innerCircleEarlyAccessMinutes);
      })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insiderCents = parseDollars(insider);
  const innerCents = parseDollars(inner);
  const problem = insiderCents == null || innerCents == null
    ? 'Enter whole dollar amounts.'
    : innerCents <= insiderCents ? 'Inner Circle must be higher than Insider.' : null;

  async function save() {
    if (problem || insiderCents == null || innerCents == null) return;
    setSaving(true);
    try {
      await api.brandMembership.saveSettings({ insiderCents, innerCircleCents: innerCents, innerCircleEarlyAccessMinutes: early });
      goBackOr(router, '/store-settings');
    } catch (e: any) {
      Alert.alert('Couldn’t save', e?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  }

  const field = (label: string, value: string, onChange: (t: string) => void, testID: string) => (
    <View style={[s.row, { borderColor: colors.border }]}>
      <Text style={[s.rowLabel, { color: colors.foreground }]} numberOfLines={1}>{label}</Text>
      <View style={s.amount}>
        <Text style={[s.dollar, { color: colors.mutedForeground }]}>$</Text>
        <TextInput
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          style={[s.input, { color: colors.foreground }, WEB_INPUT_RESET]}
          accessibilityLabel={`${label} spend in dollars`}
          testID={testID}
        />
      </View>
    </View>
  );

  return (
    <View style={[s.root, { backgroundColor: colors.background }]}>
      <Header title="Membership levels" dividerVariant="none" onBack={() => goBackOr(router, '/store-settings')} />
      {loading ? (
        <View style={s.center}><ActivityIndicator color={colors.foreground} /></View>
      ) : (
        <ScrollView contentContainerStyle={[s.body, { paddingBottom: insets.bottom + SP.lg }]} keyboardShouldPersistTaps="handled">
          <Text style={[s.label, { color: colors.mutedForeground }]}>LIFETIME SPEND WITH YOU</Text>
          <View style={[s.group, { borderColor: colors.border }]}>
            <View style={[s.row, { borderColor: colors.border }]}>
              <Text style={[s.rowLabel, { color: colors.foreground }]}>Member</Text>
              <Text style={[s.rowValue, { color: colors.mutedForeground }]}>First order</Text>
            </View>
            {field('Insider', insider, setInsider, 'level-insider')}
            {field('Inner Circle', inner, setInner, 'level-inner-circle')}
          </View>
          {problem ? <Text style={[s.error, { color: colors.foreground }]}>{problem}</Text> : null}

          <Text style={[s.label, { color: colors.mutedForeground }]}>INNER CIRCLE EARLY ACCESS TO DROPS</Text>
          <View style={s.chips}>
            {EARLY_ACCESS.map((o) => {
              const on = o.minutes === early;
              return (
                <TouchableOpacity
                  key={o.minutes}
                  onPress={() => setEarly(o.minutes)}
                  style={[s.chip, { borderColor: on ? colors.foreground : colors.border, backgroundColor: on ? colors.foreground : 'transparent' }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  testID={`early-${o.minutes}`}
                >
                  <Text style={[s.chipText, { color: on ? colors.background : colors.foreground }]}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <PrimaryButton label="Save" onPress={save} loading={saving} disabled={saving || !!problem} />
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: SP.md, gap: SP.md },
  label: { fontFamily: FONT.bold, fontSize: FS.xs, letterSpacing: 1, marginTop: SP.sm },
  group: { borderWidth: 1, borderRadius: RADIUS.md, overflow: 'hidden' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.md, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontFamily: FONT.semibold, fontSize: FS.base, flexShrink: 0 },
  rowValue: { fontFamily: FONT.regular, fontSize: FS.base },
  amount: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  dollar: { fontFamily: FONT.regular, fontSize: FS.base },
  input: { width: 96, textAlign: 'right', fontFamily: FONT.medium, fontSize: FS.base, fontVariant: ['tabular-nums'], paddingVertical: SP.sm },
  error: { fontFamily: FONT.medium, fontSize: FS.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chip: { minHeight: 36, paddingHorizontal: SP.md, borderWidth: 1, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: FONT.semibold, fontSize: FS.sm },
});
