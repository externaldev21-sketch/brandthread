/**
 * "Use Thread Cash" checkout row — an on/off toggle, not a manual amount
 * entry: turning it on applies the buyer's full available balance (capped
 * at the order and any admin-configured per-order cap, and always leaving
 * at least Stripe's minimum card charge — the server is authoritative on
 * all of this and will reject anything the client gets wrong). Matches the
 * owner's spec: "Use Brandthread credits −$10.00", toggle, shown before
 * paying, card always charged for the remainder.
 *
 * Self-contained: styled to match the existing loyalty-points card in
 * app/(buyer)/cart.tsx, isolated from that screen's own state — it only
 * needs a current order total and two callbacks. Only rendered when the
 * 'threadCashCheckoutDiscount' feature flag is on.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import type { CheckoutThreadCashRedemption } from '@/services/cartTypes';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { ThreadCashBillIcon } from './ThreadCashBill';

export function UseThreadCashCard({
  maxDiscountCents,
  redemption,
  onApply,
  onRemove,
  /**
   * When the 'threadCashCheckoutDiscount' flag is off, the row still renders
   * (so buyers understand the feature exists) but the switch is disabled and
   * an explanation replaces the balance line. Checkout discount logic itself
   * stays behind the flag — this only affects presentation.
   */
  disabledReason,
  /**
   * Checkout's flat, box-free page (hairline dividers only) vs. cart.tsx's
   * existing bordered-card style, which this component still matches by
   * default so cart isn't affected by checkout's redesign.
   */
  flat,
}: {
  /** Order subtotal + shipping minus one cent — the most Thread Cash can cover. */
  maxDiscountCents: number;
  redemption: CheckoutThreadCashRedemption | null;
  onApply: (redemption: CheckoutThreadCashRedemption) => void;
  flat?: boolean;
  onRemove: () => void;
  disabledReason?: string;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [balanceCents, setBalanceCents] = useState(0);
  const [maxRedemptionPerOrderCents, setMaxRedemptionPerOrderCents] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let active = true;
    void api.threadCash.get()
      .then(status => {
        if (!active) return;
        setBalanceCents(Math.max(0, status.balanceCents));
        setMaxRedemptionPerOrderCents(status.config.maxRedemptionPerOrderCents ?? null);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [api]);

  const proposedCents = Math.max(0, Math.min(
    balanceCents,
    maxDiscountCents,
    maxRedemptionPerOrderCents ?? Infinity,
  ));
  const isDisabled = !!disabledReason;
  if (!isDisabled && balanceCents <= 0 && !redemption) return null;

  async function handleToggle(next: boolean) {
    if (isDisabled) return;
    if (!next) {
      onRemove();
      return;
    }
    if (proposedCents < 1) {
      Alert.alert('No Thread Cash to apply', 'You have no Thread Cash available for this order.');
      return;
    }
    setApplying(true);
    try {
      const result = await api.threadCash.redeem({ amountCents: proposedCents, idempotencyKey: randomUUID() });
      onApply({ token: result.token, discountCents: result.discountCents });
      setBalanceCents(current => Math.max(0, current - proposedCents));
    } catch (error: any) {
      Alert.alert('Could not apply Thread Cash', error?.message ?? 'Please try again.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <View style={[
      flat ? styles.rowFlat : styles.card,
      flat
        ? { borderBottomColor: theme.border }
        : { backgroundColor: theme.cardGlass, borderColor: isDisabled ? theme.border : theme.accent },
      isDisabled && { opacity: 0.6 },
    ]}>
      <View style={[styles.icon, { backgroundColor: theme.accentDim }]}>
        <ThreadCashBillIcon size={20} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: theme.text }]}>Thread Cash</Text>
        <Text style={[styles.sub, { color: theme.muted }]}>
          {isDisabled
            ? disabledReason
            : redemption
              ? `−${formatCents(redemption.discountCents)} applied`
              : `${formatCents(balanceCents)} available`}
        </Text>
      </View>
      {applying ? (
        <ActivityIndicator color={theme.accent} />
      ) : (
        <HapticSwitch
          value={!!redemption}
          onValueChange={handleToggle}
          disabled={isDisabled || (proposedCents < 1 && !redemption)}
          trackColor={{ false: theme.borderSubtle, true: theme.accent }}
          thumbColor={theme.onAccent}
          accessibilityLabel="Use Thread Cash"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderRadius: RADIUS.lg, borderWidth: 1, padding: SP.md, marginBottom: SP.md },
  rowFlat: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: SP.md },
  icon: { width: 30, height: 30, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FS.base, fontFamily: FONT.semibold },
  sub: { fontSize: FS.xs, fontFamily: FONT.regular, marginTop: 2 },
});
