/**
 * Item 109: "Use Thread Cash" on the checkout screen, an on/off row in the
 * style of talabat's "Pay with talabat credit". State lives in
 * hooks/useCheckoutThreadCash.ts; this only draws it.
 *
 * States, each with its own line:
 *   loading      "Checking your balance…", switch disabled
 *   load failed  "Couldn't load your balance" + Try again
 *   no balance   "$0.00 balance" + How it works (opens Thread Cash)
 *   too small    why the order can't take any, switch disabled
 *   off          "$25.00 available" or "Use $20.00 of your $25.00"
 *   busy         spinner in place of the switch, Place order waits
 *   on           "−$20.00 applied · $5.00 left"
 *   followed     a note when the amount changed to fit a new total
 *   error        the server's reason, next to an alert icon
 * The money shows once more, as the "Thread Cash" line in the price
 * breakdown, above "Charged to card". Monochrome only.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PressableScale, HapticSwitch } from '@/components/BrandthreadUI';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { FONT, FS, SP } from '@/lib/theme';
import { STRIPE_MIN_CARD_CHARGE_CENTS } from '@/lib/threadCashCheckout';
import type { CheckoutThreadCash } from '@/hooks/useCheckoutThreadCash';
import { CheckoutCard } from './CheckoutPrimitives';

function TextLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      rippleEnabled={false}
      noMinHeight
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      testID={testID}
    >
      <Text style={[styles.link, { color: theme.text }]}>{label}</Text>
    </PressableScale>
  );
}

export function ThreadCashCard({ state }: { state: CheckoutThreadCash }) {
  const { theme } = useAppTheme();
  const router = useRouter();
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
    <CheckoutCard title="Thread Cash" testID="checkout-thread-cash">
      <View style={styles.row}>
        <View style={[styles.icon, { borderColor: theme.border }]}>
          <ThreadCashBillIcon size={20} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: theme.text }]}>Use Thread Cash</Text>
          <Text style={[styles.status, { color: theme.muted }]} testID="checkout-thread-cash-status">{status}</Text>
        </View>
        {state.busy || (!state.ready && !state.loadFailed) ? (
          <ActivityIndicator color={theme.text} style={styles.spinner} testID="checkout-thread-cash-busy" />
        ) : (
          <HapticSwitch
            value={on}
            onValueChange={state.setOn}
            disabled={switchDisabled}
            trackColor={{ false: theme.border, true: theme.text }}
            thumbColor={on ? theme.background : theme.text}
            accessibilityLabel="Use Thread Cash"
            accessibilityHint={on ? 'Returns it to your balance' : `Takes ${formatCents(state.targetCents)} off what your card is charged`}
            testID="checkout-thread-cash-switch"
          />
        )}
      </View>

      {state.notice && !state.error ? (
        <View style={styles.noteRow} testID="checkout-thread-cash-notice">
          <Feather name="refresh-cw" size={13} color={theme.muted} style={styles.noteIcon} />
          <Text style={[styles.note, { color: theme.muted }]}>{state.notice}</Text>
        </View>
      ) : null}
      {state.error ? (
        <View style={styles.noteRow} accessibilityRole="alert" testID="checkout-thread-cash-error">
          <Feather name="alert-circle" size={13} color={theme.text} style={styles.noteIcon} />
          <Text style={[styles.note, { color: theme.text }]}>{state.error}</Text>
        </View>
      ) : null}
      {state.loadFailed ? (
        <View style={styles.linkRow}>
          <TextLink label="Try again" onPress={state.reload} testID="checkout-thread-cash-retry" />
        </View>
      ) : state.ready && state.unavailable === 'no_balance' && !on ? (
        <View style={styles.linkRow}>
          <TextLink label="How it works" onPress={() => router.push('/thread-cash' as never)} testID="checkout-thread-cash-learn" />
        </View>
      ) : null}
    </CheckoutCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm + 4 },
  icon: {
    width: 36, height: 36, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: FONT.semibold, fontSize: FS.base },
  status: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19, marginTop: 2 },
  spinner: { width: 51, height: 31 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.xs + 2, marginTop: SP.sm + 2 },
  noteIcon: { marginTop: 3 },
  note: { flex: 1, fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
  linkRow: { flexDirection: 'row', marginTop: SP.sm + 2, paddingLeft: 36 + SP.sm + 4 },
  link: { fontFamily: FONT.semibold, fontSize: FS.sm, textDecorationLine: 'underline' },
});
