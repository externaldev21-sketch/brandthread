/**
 * Item 109: "Use Thread Cash", an on/off row (talabat "Pay with talabat
 * credit"). State lives in hooks/useCheckoutThreadCash.ts; this only draws
 * it. Thread Cash orders pay on Stripe-hosted Checkout (the in-app flow
 * doesn't take Thread Cash yet), which the Payment section says.
 *
 * States: loading, load failed (+ Try again), no balance (+ How it works),
 * too small, off, busy, on, followed (amount changed to fit), error.
 */
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { HapticSwitch } from '@/components/BrandthreadUI';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { STRIPE_MIN_CARD_CHARGE_CENTS } from '@/lib/threadCashCheckout';
import type { CheckoutThreadCash } from '@/hooks/useCheckoutThreadCash';
import { CheckoutSection, TextAction, useCheckoutColors, type CheckoutColors } from './CheckoutPrimitives';

export function ThreadCashSection({ state }: { state: CheckoutThreadCash }) {
  const router = useRouter();
  const ck = useCheckoutColors();
  const styles = useMemo(() => makeStyles(ck), [ck]);
  const on = state.appliedCents > 0;
  const minCard = formatCents(STRIPE_MIN_CARD_CHARGE_CENTS);

  let status: string;
  if (state.loadFailed) status = 'We couldn’t load your Thread Cash balance.';
  else if (!state.ready) status = 'Checking your balance…';
  else if (on) status = `−${formatCents(state.appliedCents)} applied · ${formatCents(state.balanceCents)} left`;
  else if (state.unavailable === 'no_balance') status = `${formatCents(0)} balance. You earn it for time in the app each day.`;
  else if (state.unavailable === 'order_too_small') status = `This order is too small: at least ${minCard} has to go on your card.`;
  else if (state.targetCents < state.availableCents) status = `Use ${formatCents(state.targetCents)} of your ${formatCents(state.availableCents)}`;
  else status = `${formatCents(state.availableCents)} available`;

  const switchDisabled = !state.ready || state.busy || (!on && (state.unavailable !== null || state.targetCents < 1));

  return (
    <CheckoutSection title="Thread Cash" testID="checkout-thread-cash">
      <View style={styles.row}>
        <View style={styles.icon}><ThreadCashBillIcon size={20} /></View>
        <View style={styles.copy}>
          <Text style={styles.title}>Use Thread Cash</Text>
          <Text style={styles.status} testID="checkout-thread-cash-status">{status}</Text>
        </View>
        {state.busy || (!state.ready && !state.loadFailed) ? (
          <ActivityIndicator color={ck.text} style={styles.spinner} testID="checkout-thread-cash-busy" />
        ) : (
          <HapticSwitch
            value={on}
            onValueChange={state.setOn}
            disabled={switchDisabled}
            trackColor={{ false: ck.fieldBorder, true: ck.text }}
            thumbColor={on ? ck.bg : ck.text}
            accessibilityLabel="Use Thread Cash"
            accessibilityHint={on ? 'Returns it to your balance' : `Takes ${formatCents(state.targetCents)} off what your card is charged`}
            testID="checkout-thread-cash-switch"
          />
        )}
      </View>

      {state.notice && !state.error ? (
        <View style={styles.noteRow} testID="checkout-thread-cash-notice">
          <Feather name="refresh-cw" size={13} color={ck.muted} style={styles.noteIcon} />
          <Text style={[styles.note, { color: ck.muted }]}>{state.notice}</Text>
        </View>
      ) : null}
      {state.error ? (
        <View style={styles.noteRow} accessibilityRole="alert" testID="checkout-thread-cash-error">
          <Feather name="alert-circle" size={13} color={ck.text} style={styles.noteIcon} />
          <Text style={styles.note}>{state.error}</Text>
        </View>
      ) : null}
      {state.loadFailed ? (
        <View style={styles.linkRow}>
          <TextAction label="Try again" onPress={state.reload} testID="checkout-thread-cash-retry" />
        </View>
      ) : state.ready && state.unavailable === 'no_balance' && !on ? (
        <View style={styles.linkRow}>
          <TextAction label="How it works" onPress={() => router.push('/thread-cash' as never)} testID="checkout-thread-cash-learn" />
        </View>
      ) : null}
    </CheckoutSection>
  );
}

function makeStyles(ck: CheckoutColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4 },
    icon: {
      width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: ck.fieldBorder,
      alignItems: 'center', justifyContent: 'center',
    },
    copy: { flex: 1, minWidth: 0 },
    title: { fontFamily: FONT.medium, fontSize: FS.base, color: ck.text },
    status: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 2, color: ck.muted },
    spinner: { width: 51, height: 31 },
    noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.xs + 2, marginTop: SP.sm + 2 },
    noteIcon: { marginTop: 3 },
    note: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, color: ck.text },
    linkRow: { flexDirection: 'row', marginTop: SP.sm + 2, paddingLeft: 36 + SP.sm + 4 },
  });
}
