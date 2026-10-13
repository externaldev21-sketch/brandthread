import { hapticSuccess, hapticLight, haptics } from '@/lib/haptics';

/**
 * Seller Thread Cash cash-out sheet — moves earned Thread Cash (Live gifts,
 * message payments) into the seller's real Stripe payout balance.
 *
 * Copies Cash App's "Cash out" sheet on the shared `<Sheet>`: the amount as
 * one big centred figure you type into, the available balance under it with
 * a "Use all" shortcut, then a short receipt (you'll receive / fee / where
 * it goes) and one pinned "Cash out $X" button.
 *
 * The rate/fee are read live from the server (GET /thread-cash/quote) —
 * never hardcoded here — so if Dev changes
 * artifacts/api-server/src/lib/threadCash/cashOut.ts's rate/fee constants,
 * this sheet reflects it immediately with no app update.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View, Platform } from 'react-native';

import { KeyboardAvoidingView } from '@/components/KeyboardProviderCompat';

import { Icon } from '@/components/ui/Icon';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { randomUUID } from 'expo-crypto';

import { Sheet } from '@/components/ui/BottomSheet';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { useApi } from '@/lib/api';

import { formatCents } from '@/lib/money';

import { FONT, FS, SP } from '@/lib/theme';

import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';

import { radius } from '@/constants/radii';

export function CashOutSheet({
  visible, balanceCents, promoCents = 0, onClose, onCashedOut,
}: {
  visible: boolean;
  /** Withdrawable Thread Cash (paid funds received) — the most that can be cashed out. */
  balanceCents: number;
  /** Promo credit the seller also holds: shown, never withdrawable. */
  promoCents?: number;
  onClose: () => void;
  /** Fires once the cash-out actually succeeds; the caller refreshes the balance and shows a toast. */
  onCashedOut: (result: { threadCashCents: number; payoutCents: number; feeCents: number }) => void;
}) {
  const { theme } = useAppTheme();
  const api = useApi();
  const [amountText, setAmountText] = useState('');
  const [quote, setQuote] = useState<{ payoutCents: number; feeCents: number } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = Math.round((parseFloat(amountText.replace(/[^0-9.]/g, '')) || 0) * 100);
  // One key per cash-out attempt: a retry after a lost response must reuse
  // it (the server replays the first transfer instead of paying twice); a
  // new amount or a fresh open of the sheet is a new attempt.
  const attemptKey = useRef<string | null>(null);
  useEffect(() => { attemptKey.current = null; }, [visible, amountCents]);
  const canSubmit = amountCents > 0 && amountCents <= balanceCents && !confirming;

  useEffect(() => {
    if (!visible) return;
    setAmountText(balanceCents > 0 ? (balanceCents / 100).toFixed(2) : '');
    setQuote(null);
    setError(null);
    setConfirming(false);
  }, [visible, balanceCents]);

  useEffect(() => {
    if (!visible || amountCents <= 0 || amountCents > balanceCents) { setQuote(null); return; }
    let cancelled = false;
    setQuoting(true);
    const timer = setTimeout(() => {
      api.threadCash.cashOutQuote(amountCents)
        .then((q) => { if (!cancelled) setQuote({ payoutCents: q.payoutCents, feeCents: q.feeCents }); })
        .catch(() => { if (!cancelled) setQuote({ payoutCents: amountCents, feeCents: 0 }); })
        .finally(() => { if (!cancelled) setQuoting(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [visible, amountCents, balanceCents, api]);

  async function handleConfirm() {
    if (!canSubmit) return;
    setConfirming(true);
    setError(null);
    try {
      attemptKey.current ??= randomUUID();
      const result = await api.threadCash.cashOut({ threadCashCents: amountCents, idempotencyKey: attemptKey.current });
      attemptKey.current = null;
      
      onCashedOut(result);
    } catch (err: any) {
      setError(err?.message ?? 'Could not cash out right now. Try again.');
      setConfirming(false);
    }
  }

  const over = amountCents > balanceCents;
  const receive = quoting ? '···' : quote ? formatCents(quote.payoutCents) : amountCents > 0 ? formatCents(amountCents) : '$0.00';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Cash out"
      testID="cash-out-sheet"
      primaryAction={{
        label: amountCents > 0 ? `Cash out ${formatCents(amountCents)}` : 'Enter an amount',
        onPress: () => { void handleConfirm(); },
        disabled: !canSubmit,
        loading: confirming,
        accessibilityLabel: amountCents > 0 ? `Cash out ${formatCents(amountCents)}` : 'Cash out',
      }}
    >
      <View style={styles.hero}>
        <View style={styles.amountRow}>
          <Text style={[styles.dollarSign, { color: over ? theme.error : theme.text }]}>$</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder="0"
            placeholderTextColor={theme.muted}
            keyboardType="decimal-pad"
            style={[styles.amountInput, { color: over ? theme.error : theme.text }]}
            testID="cash-out-amount-input"
            accessibilityLabel="Amount to cash out"
          />
        </View>
        <View style={styles.balanceRow}>
          <ThreadCashBillIcon size={14} />
          <Text style={[styles.balanceText, { color: theme.muted }]} testID="cash-out-balance">
            {formatCents(balanceCents)} available
          </Text>
          <Pressable
            onPress={() => {  setAmountText((balanceCents / 100).toFixed(2)); }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Cash out all"
          >
            <Text style={[styles.useAll, { color: theme.text }]}>Use all</Text>
          </Pressable>
        </View>
        {over && (
          <Text style={[styles.errorText, { color: theme.error }]}>That's more than your Thread Cash balance.</Text>
        )}
      </View>

      <View style={[styles.receipt, { backgroundColor: `${theme.text}0F` }]}>
        <View style={styles.receiptRow}>
          <Text style={[styles.receiptLabel, { color: theme.muted }]}>You'll receive</Text>
          <Text style={[styles.receiptValue, { color: theme.text }]} testID="cash-out-quote">{receive}</Text>
        </View>
        {quote != null && quote.feeCents > 0 && (
          <>
            <View style={[styles.receiptDivider, { backgroundColor: theme.border }]} />
            <View style={styles.receiptRow}>
              <Text style={[styles.receiptLabel, { color: theme.muted }]}>Fee</Text>
              <Text style={[styles.receiptValue, { color: theme.text }]}>{formatCents(quote.feeCents)}</Text>
            </View>
          </>
        )}
        <View style={[styles.receiptDivider, { backgroundColor: theme.border }]} />
        <View style={styles.receiptRow}>
          <Text style={[styles.receiptLabel, { color: theme.muted }]}>To</Text>
          <Text style={[styles.receiptValue, { color: theme.text }]}>Payout balance</Text>
        </View>
      </View>

      {error && <Text style={[styles.errorText, { color: theme.error }]}>{error}</Text>}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: SP.md, paddingBottom: SP.lg },
  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  dollarSign: { fontFamily: FONT.bold, fontSize: 40, lineHeight: 52, marginRight: 2 },
  amountInput: { fontFamily: FONT.bold, fontSize: 56, lineHeight: 64, minWidth: 60, textAlign: 'center', padding: 0, fontVariant: ['tabular-nums'] },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: SP.sm },
  balanceText: { fontFamily: FONT.medium, fontSize: FS.sm },
  useAll: { fontFamily: FONT.semibold, fontSize: FS.sm, marginLeft: SP.xs },
  receipt: { borderRadius: radius.md, paddingHorizontal: SP.md },
  receiptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  receiptDivider: { height: StyleSheet.hairlineWidth },
  receiptLabel: { fontFamily: FONT.medium, fontSize: FS.sm },
  receiptValue: { fontFamily: FONT.semibold, fontSize: FS.sm, fontVariant: ['tabular-nums'] },
  errorText: { fontFamily: FONT.medium, fontSize: FS.xs, marginTop: SP.sm, textAlign: 'center' },
});
