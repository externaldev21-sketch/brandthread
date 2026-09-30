import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PrimaryButton } from '@/components/BrandthreadUI';
import { useColors } from '@/hooks/useColors';
import { useApi } from '@/lib/api';
import { apiErrorCode, apiErrorMessage } from '@/lib/safety';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  AGE_RESTRICTED_COPY, DOB_PLACEHOLDER, checkDobInput, formatDobInput, type AgeBand,
} from '@/lib/ageGate';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';

/** The single date-of-birth field. Pass the host form's own styles so it matches its siblings. */
export function AgeDobField({
  value, onChange, error, wrapStyle, labelStyle, inputStyle, hintStyle, testID = 'age-dob-input',
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string | null;
  wrapStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  inputStyle?: StyleProp<TextStyle>;
  hintStyle?: StyleProp<TextStyle>;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <View style={wrapStyle}>
      <Text style={[{ color: colors.mutedForeground, fontFamily: FONT.semibold, fontSize: 12, marginBottom: 5 }, labelStyle]}>Date of birth</Text>
      <TextInput
        testID={testID}
        style={[
          {
            borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 12,
            paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, fontFamily: FONT.regular, color: colors.foreground,
            backgroundColor: colors.card,
          },
          inputStyle,
          error ? { borderColor: colors.destructive } : null,
        ]}
        placeholder={DOB_PLACEHOLDER}
        placeholderTextColor={colors.mutedForeground}
        value={value}
        onChangeText={(t) => onChange(formatDobInput(t))}
        keyboardType="number-pad"
        maxLength={10}
        autoComplete="birthdate-full"
        autoCorrect={false}
        accessibilityLabel="Date of birth"
      />
      {error ? <Text testID="age-dob-error" style={[{ color: colors.destructive, fontFamily: FONT.regular, fontSize: 12, marginTop: 4 }, hintStyle]}>{error}</Text> : null}
    </View>
  );
}

/**
 * Inline ask shown in place of a sell / go-live / payout action for an account
 * that has no age band yet. One field, one button; no modal.
 */
export function AgeAskInline({ onResolved }: { onResolved: (band: AgeBand) => void }) {
  const api = useApi();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    const check = checkDobInput(value);
    if (!check.ok) { setError(check.error); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await api.ageGate.submit(check.dob);
      onResolved(res.ageBand);
    } catch (err) {
      const code = apiErrorCode(err);
      if (code === 'AGE_UNDER_13') setError('You must be at least 13 to use Brandthread.');
      else if (code === 'AGE_BAND_LOCKED') onResolved('18_plus');
      else setError(apiErrorMessage(err, 'Could not save. Try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View testID="age-ask-inline">
      <AgeDobField value={value} onChange={(t) => { setValue(t); setError(null); }} error={error} />
      <PrimaryButton label="Continue" onPress={submit} loading={saving} disabled={value.length < 10} style={{ marginTop: SP.md }} />
    </View>
  );
}

/** Shown in place of a seller / go-live / payouts entry point for 13-17 accounts. */
export function AgeRestrictedInline({ testID = 'age-restricted-inline' }: { testID?: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={[styles.inline, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <Feather name="lock" size={16} color={colors.foreground} />
      <Text style={[styles.inlineText, { color: colors.foreground }]}>{AGE_RESTRICTED_COPY}</Text>
    </View>
  );
}

/** Full-screen stand-in for a seller-only screen: the restriction message, or the one-time birthday ask. */
export function AgeRestrictedScreen({ title, status, onResolved }: {
  title: string;
  status: 'unknown' | 'restricted';
  onResolved: (band: AgeBand) => void;
}) {
  const colors = useColors();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={title} onBack={() => goBackOr(router)} />
      <View style={{ padding: SP.lg }}>
        {status === 'restricted' ? <AgeRestrictedInline /> : <AgeAskInline onResolved={onResolved} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm, borderWidth: 1, borderRadius: RADIUS.md, padding: SP.md },
  inlineText: { flex: 1, fontFamily: FONT.medium, fontSize: FS.sm, lineHeight: 20 },
});
