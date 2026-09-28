/**
 * Promo code — inline apply (SSENSE "Promo" row, expanded in place).
 *
 * States: empty input + Apply; applying (button spinner); error (the
 * server's reason, under the field, field border in the error tone);
 * applied (check icon, code, what it takes off, Remove). The saving itself
 * shows up exactly once — as the "Discount" line in the price breakdown.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { Button } from '@/components/ui';
import { useAppTheme } from '@/contexts/AppThemeContext';
import type { CheckoutDiscount } from '@/services/cartTypes';
import { FONT, FS, SP } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { CheckoutCard, CheckoutField } from './CheckoutPrimitives';

export function PromoCodeCard({
  discounts, onApply, onRemove, unavailableReason,
}: {
  discounts: CheckoutDiscount[];
  /** Validates against the server and persists a valid code; resolves to the result. */
  onApply: (code: string) => Promise<CheckoutDiscount>;
  onRemove: (code: string) => void;
  /** Shown instead of the field when codes can't apply to this order. */
  unavailableReason?: string;
}) {
  const { theme } = useAppTheme();
  const [code, setCode] = useState('');
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const applied = discounts.filter(discount => discount.isValid);

  async function apply() {
    const trimmed = code.trim();
    if (!trimmed || applying) return;
    setApplying(true);
    setError(null);
    try {
      const result = await onApply(trimmed);
      if (result.isValid) setCode('');
      else setError(result.errorMessage || 'That code isn’t valid for this order.');
    } catch {
      setError('We couldn’t check that code. Check your connection and try again.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <CheckoutCard title="Promo code" testID="checkout-promo">
      {applied.map(discount => (
        <View key={discount.code} style={[styles.applied, { borderColor: theme.text }]} testID="checkout-promo-applied">
          <Feather name="check-circle" size={18} color={theme.text} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.appliedCode, { color: theme.text }]}>{discount.code} applied</Text>
            {discount.description ? (
              <Text style={[styles.appliedDesc, { color: theme.muted }]} numberOfLines={2}>{discount.description}</Text>
            ) : null}
          </View>
          <PressableScale
            onPress={() => onRemove(discount.code)}
            accessibilityRole="button"
            accessibilityLabel={`Remove promo code ${discount.code}`}
            rippleEnabled={false}
            noMinHeight
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={[styles.remove, { color: theme.text }]}>Remove</Text>
          </PressableScale>
        </View>
      ))}

      {unavailableReason ? (
        <Text style={[styles.unavailable, { color: theme.muted }]}>{unavailableReason}</Text>
      ) : applied.length === 0 ? (
        <View style={styles.row}>
          <CheckoutField
            label="Code"
            value={code}
            onChangeText={next => { setCode(next.toUpperCase()); if (error) setError(null); }}
            error={error ?? undefined}
            showError
            placeholder="Enter promo code"
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => void apply()}
            style={{ flex: 1, marginBottom: 0 }}
            accessibilityLabel="Promo code"
            testID="checkout-promo-input"
          />
          <Button
            label="Apply"
            variant="secondary"
            size="small"
            loading={applying}
            disabled={!code.trim()}
            onPress={() => void apply()}
            style={styles.apply}
            accessibilityLabel="Apply promo code"
            testID="checkout-promo-apply"
          />
        </View>
      ) : null}
    </CheckoutCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  // Aligns with the input box (below the field's label line).
  apply: { marginTop: 25, minWidth: 84 },
  applied: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4,
    borderWidth: 1, borderStyle: 'dashed', borderRadius: RADII.card, padding: SP.sm + 6,
  },
  appliedCode: { fontFamily: FONT.semibold, fontSize: FS.base },
  appliedDesc: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2 },
  remove: { fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
  unavailable: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
});
