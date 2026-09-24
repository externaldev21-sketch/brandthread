/**
 * THREAD CASH HOOK POINT — checkout.
 *
 * Self-contained "Use Thread Cash" card, styled to match the existing
 * loyalty-points card in app/(buyer)/cart.tsx. Deliberately isolated from
 * that screen's state so it's a drop-in for whichever checkout surface
 * finalizes there (see the 'Discover' session's shared checkout UI work) —
 * it only needs a current subtotal and two callbacks.
 *
 * Only rendered when the 'threadCashCheckoutDiscount' feature flag is on
 * (default OFF — see docs/payments/thread-cash-checkout-todo.md). The
 * server currently rejects the resulting token outright, so this card has
 * no visible effect until both the flag and the checkout money flow are
 * turned on together.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import type { CheckoutThreadCashRedemption } from '@/services/cartTypes';

export function UseThreadCashCard({
  maxDiscountCents,
  redemption,
  onApply,
  onRemove,
}: {
  /** Order subtotal + shipping minus one cent — the most Thread Cash can cover. */
  maxDiscountCents: number;
  redemption: CheckoutThreadCashRedemption | null;
  onApply: (redemption: CheckoutThreadCashRedemption) => void;
  onRemove: () => void;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [balanceCents, setBalanceCents] = useState(0);
  const [amountInput, setAmountInput] = useState('');
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let active = true;
    void api.threadCash.get()
      .then(status => { if (active) setBalanceCents(Math.max(0, status.balanceCents)); })
      .catch(() => {});
    return () => { active = false; };
  }, [api]);

  const maxUsableCents = Math.max(0, Math.min(balanceCents, maxDiscountCents));
  if (balanceCents <= 0 && !redemption) return null;

  async function handleApply() {
    const dollars = Number(amountInput);
    const amountCents = Math.round(dollars * 100);
    if (!Number.isFinite(amountCents) || amountCents < 1) {
      Alert.alert('Enter an amount', 'Enter how much Thread Cash to use.');
      return;
    }
    if (amountCents > maxUsableCents) {
      Alert.alert('Too much Thread Cash', `You can use up to ${formatCents(maxUsableCents)} on this order.`);
      return;
    }
    setApplying(true);
    try {
      const result = await api.threadCash.redeem({ amountCents });
      onApply({ token: result.token, discountCents: result.discountCents });
      setAmountInput('');
      setBalanceCents(current => Math.max(0, current - amountCents));
    } catch (error: any) {
      Alert.alert('Could not apply Thread Cash', error?.message ?? 'Please try again.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.cardGlass, borderColor: theme.accent }]}>
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: theme.accentDim }]}>
          <Feather name="dollar-sign" size={16} color={theme.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: theme.text }]}>Use Thread Cash</Text>
          <Text style={[styles.sub, { color: theme.muted }]}>
            {formatCents(balanceCents)} available
          </Text>
        </View>
      </View>

      {redemption ? (
        <View style={styles.appliedRow}>
          <Text style={[styles.appliedText, { color: theme.text }]}>
            −{formatCents(redemption.discountCents)} Thread Cash applied
          </Text>
          <TouchableOpacity onPress={onRemove} accessibilityRole="button" accessibilityLabel="Remove Thread Cash">
            <Feather name="x-circle" size={18} color={theme.muted} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.borderSubtle }]}
            placeholder="$0.00"
            placeholderTextColor={theme.subtle}
            keyboardType="decimal-pad"
            value={amountInput}
            onChangeText={setAmountInput}
            accessibilityLabel="Thread Cash amount to use"
          />
          <TouchableOpacity
            style={[styles.applyBtn, { backgroundColor: theme.accent }]}
            onPress={handleApply}
            disabled={applying || maxUsableCents <= 0}
            accessibilityRole="button"
            accessibilityLabel="Apply Thread Cash"
          >
            <Text style={[styles.applyText, { color: theme.onAccent }]}>{applying ? '...' : 'Apply'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md, marginBottom: SP.md },
  heading: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  icon: { width: 30, height: 30, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FS.base, fontFamily: FONT.semibold },
  sub: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
  inputRow: { flexDirection: 'row', gap: SP.sm },
  input: { flex: 1, borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: SP.sm, paddingVertical: SP.xs, fontFamily: FONT.regular, fontSize: FS.base },
  applyBtn: { paddingHorizontal: SP.md, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  appliedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  appliedText: { fontFamily: FONT.medium, fontSize: FS.sm },
});
