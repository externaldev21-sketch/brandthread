import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { BrandthreadCard, PrimaryButton } from '@/components/BrandthreadUI';
import { CARRIER_OPTIONS, validateTrackingNumber, type CarrierKey } from '@/lib/trackingNumber';

/**
 * Seller order detail "Mark as shipped": carrier picker + tracking number,
 * checked against the carrier's format before POST /api/orders/:id/ship
 * (which ships the order and sends the buyer the shipped notification and
 * email). A server rejection is shown under the field it names.
 */
export function MarkShippedForm({ onSubmit }: {
  onSubmit: (carrier: string, trackingNumber: string) => Promise<{ field?: 'carrier' | 'trackingNumber'; error: string } | null>;
}) {
  const { theme } = useAppTheme();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [carrierKey, setCarrierKey] = useState<CarrierKey | null>(null);
  const [otherCarrier, setOtherCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [error, setError] = useState<{ field?: 'carrier' | 'trackingNumber'; error: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const carrier = carrierKey === 'other'
    ? otherCarrier
    : CARRIER_OPTIONS.find(option => option.key === carrierKey)?.label ?? '';

  async function submit() {
    const check = validateTrackingNumber(carrier, trackingNumber);
    if (!check.ok) { setError(check); return; }
    setError(null);
    setSaving(true);
    try {
      setError(await onSubmit(check.carrier, check.trackingNumber));
    } finally {
      setSaving(false);
    }
  }

  return (
    <BrandthreadCard style={s.form}>
      <Text style={s.title}>Mark as shipped</Text>
      <Text style={s.label}>Carrier</Text>
      <View style={s.chips} accessibilityRole="radiogroup">
        {CARRIER_OPTIONS.map(option => {
          const selected = carrierKey === option.key;
          return (
            <TouchableOpacity
              key={option.key}
              style={[s.chip, selected && s.chipSelected]}
              onPress={() => { setCarrierKey(option.key); if (error?.field === 'carrier') setError(null); }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              testID={`carrier-${option.key}`}
            >
              <Text style={[s.chipText, selected && s.chipTextSelected]}>{option.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {carrierKey === 'other' ? (
        <TextInput
          style={[s.input, error?.field === 'carrier' && s.inputError]}
          value={otherCarrier}
          onChangeText={v => { setOtherCarrier(v); if (error?.field === 'carrier') setError(null); }}
          placeholder="Carrier name"
          placeholderTextColor={theme.subtle}
          accessibilityLabel="Carrier name"
          testID="carrier-other-name"
        />
      ) : null}
      {error?.field === 'carrier' ? <Text style={s.error}>{error.error}</Text> : null}

      <Text style={s.label}>Tracking number</Text>
      <TextInput
        style={[s.input, error?.field === 'trackingNumber' && s.inputError]}
        value={trackingNumber}
        onChangeText={v => { setTrackingNumber(v); if (error?.field === 'trackingNumber') setError(null); }}
        placeholder="Tracking number"
        placeholderTextColor={theme.subtle}
        autoCapitalize="characters"
        autoCorrect={false}
        accessibilityLabel="Tracking number"
        testID="tracking-number-input"
      />
      {error && error.field !== 'carrier' ? <Text style={s.error}>{error.error}</Text> : null}

      <Text style={s.hint}>The buyer is notified with the tracking details as soon as you save.</Text>
      <PrimaryButton label="Save and mark shipped" onPress={submit} loading={saving} disabled={saving} small testID="mark-shipped-submit" />
    </BrandthreadCard>
  );
}

const makeStyles = (theme: AppThemePreset) => StyleSheet.create({
  form: { gap: SP.sm, borderColor: theme.accentLight },
  title: { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.text },
  label: { fontSize: FS.xs, fontFamily: FONT.semibold, color: theme.muted, marginTop: SP.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: SP.md, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface },
  chipSelected: { borderColor: theme.accent, backgroundColor: theme.accentDim },
  chipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted },
  chipTextSelected: { color: theme.text },
  input: { backgroundColor: theme.surface, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: theme.border, color: theme.text, fontFamily: FONT.regular, fontSize: FS.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  inputError: { borderColor: theme.error },
  error: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.error, lineHeight: 14 },
  hint: { fontSize: FS.xs, fontFamily: FONT.regular, color: theme.muted, lineHeight: 14 },
});
