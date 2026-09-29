/**
 * PROMO CODE: inline apply. States: empty field + Apply; applying (button
 * spinner); error (the server's reason under the field); applied (check,
 * code, Remove). The saving itself shows once, as the Discount line in the
 * order summary.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Button } from '@/components/ui';
import type { CheckoutDiscount } from '@/services/cartTypes';
import { FONT, FS, SP } from '@/lib/theme';
import { CK, CheckoutField, CheckoutSection, TextAction } from './CheckoutPrimitives';

export function PromoCodeSection({
  discounts, onApply, onRemove, unavailableReason,
}: {
  discounts: CheckoutDiscount[];
  /** Validates against the server and persists a valid code; resolves to the result. */
  onApply: (code: string) => Promise<CheckoutDiscount>;
  onRemove: (code: string) => void;
  /** Shown instead of the field when codes can't apply to this order. */
  unavailableReason?: string;
}) {
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
    <CheckoutSection title="Promo code" testID="checkout-promo">
      {applied.map(discount => (
        <View key={discount.code} style={styles.applied} testID="checkout-promo-applied">
          <Feather name="check-circle" size={18} color={CK.text} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.appliedCode}>{discount.code} applied</Text>
            {discount.description ? <Text style={styles.appliedDesc} numberOfLines={2}>{discount.description}</Text> : null}
          </View>
          <TextAction label="Remove" accessibilityLabel={`Remove promo code ${discount.code}`} onPress={() => onRemove(discount.code)} />
        </View>
      ))}

      {unavailableReason ? (
        <Text style={styles.unavailable}>{unavailableReason}</Text>
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
    </CheckoutSection>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm },
  // Aligns with the input box (below the field's label line).
  apply: { marginTop: 25, minWidth: 84 },
  applied: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4, paddingVertical: SP.xs },
  appliedCode: { fontFamily: FONT.semibold, fontSize: FS.base, color: CK.text },
  appliedDesc: { fontFamily: FONT.regular, fontSize: FS.sm, marginTop: 2, color: CK.muted },
  unavailable: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: CK.muted },
});
