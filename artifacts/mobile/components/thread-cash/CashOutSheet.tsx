/**
 * Seller Thread Cash cash-out sheet — moves earned Thread Cash (Live gifts,
 * message payments) into the seller's real Stripe payout balance. Same
 * Modal + SheetRise + useAppTheme() structure as LiveThreadCashSheet.tsx
 * (the buyer-side "send" sheet this mirrors), but for a seller converting
 * their own balance to money rather than gifting it to someone else.
 *
 * The rate/fee are read live from the server (GET /thread-cash/quote) —
 * never hardcoded here — so if Dev changes
 * artifacts/api-server/src/lib/threadCash/cashOut.ts's rate/fee constants,
 * this sheet reflects it immediately with no app update.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { randomUUID } from 'expo-crypto';
import { SheetRise } from '@/components/motion/SheetRise';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { hapticLight, hapticSuccess } from '@/lib/haptics';

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
  const insets = useSafeAreaInsets();
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
    hapticLight();
    try {
      attemptKey.current ??= randomUUID();
      const result = await api.threadCash.cashOut({ threadCashCents: amountCents, idempotencyKey: attemptKey.current });
      attemptKey.current = null;
      hapticSuccess();
      onCashedOut(result);
    } catch (err: any) {
      setError(err?.message ?? 'Could not cash out right now. Try again.');
      setConfirming(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close cash out" />
      <SheetRise style={[styles.sheet, { backgroundColor: theme.background, paddingBottom: insets.bottom + SP.md }]} testID="cash-out-sheet">
        <View style={[styles.handle, { backgroundColor: theme.border }]} />
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: theme.text }]}>Cash out</Text>
            <Text style={[styles.sub, { color: theme.muted }]}>Move Thread Cash to your payout balance</Text>
          </View>
          <Pressable onPress={onClose} style={[styles.close, { backgroundColor: theme.cardElevated }]} accessibilityRole="button" accessibilityLabel="Close" hitSlop={6}>
            <Feather name="x" size={18} color={theme.text} />
          </Pressable>
        </View>

        <View style={[styles.balancePill, { backgroundColor: theme.cardElevated, borderColor: theme.border }]}>
          <ThreadCashBillIcon size={16} />
          <Text style={[styles.balanceText, { color: theme.text }]} testID="cash-out-balance">
            {formatCents(balanceCents)} withdrawable
          </Text>
        </View>
        {promoCents > 0 && (
          <Text style={[styles.promoNote, { color: theme.muted }]} testID="cash-out-promo-note">
            {formatCents(promoCents)} promo credit · spendable in Brandthread, not withdrawable
          </Text>
        )}

        <View style={[styles.inputRow, { borderColor: theme.border, backgroundColor: theme.cardElevated }]}>
          <Text style={[styles.dollarSign, { color: theme.text }]}>$</Text>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder="0.00"
            placeholderTextColor={theme.muted}
            keyboardType="decimal-pad"
            style={[styles.input, { color: theme.text }]}
            testID="cash-out-amount-input"
            accessibilityLabel="Amount to cash out"
          />
          <Pressable
            onPress={() => { hapticLight(); setAmountText((balanceCents / 100).toFixed(2)); }}
            style={[styles.allChip, { borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Cash out all"
          >
            <Text style={[styles.allChipText, { color: theme.accentLight }]}>All</Text>
          </Pressable>
        </View>
        {amountCents > balanceCents && (
          <Text style={[styles.errorText, { color: theme.error }]}>That's more than you can withdraw.</Text>
        )}

        <View style={[styles.quoteRow, { borderColor: theme.border }]}>
          <Text style={[styles.quoteLabel, { color: theme.muted }]}>You'll receive</Text>
          <Text style={[styles.quoteValue, { color: theme.text }]} testID="cash-out-quote">
            {quoting ? '···' : quote ? formatCents(quote.payoutCents) : amountCents > 0 ? formatCents(amountCents) : '$0.00'}
          </Text>
        </View>
        {quote != null && quote.feeCents > 0 && (
          <Text style={[styles.feeText, { color: theme.muted }]}>Includes a {formatCents(quote.feeCents)} fee</Text>
        )}

        {error && <Text style={[styles.errorText, { color: theme.error }]}>{error}</Text>}

        <Pressable
          onPress={handleConfirm}
          disabled={!canSubmit}
          style={[styles.confirmBtn, { backgroundColor: theme.accent }, !canSubmit && styles.confirmBtnDisabled]}
          accessibilityRole="button"
          accessibilityLabel={amountCents > 0 ? `Cash out ${formatCents(amountCents)}` : 'Cash out'}
        >
          <Text style={[styles.confirmBtnText, { color: theme.onAccent }]}>
            {confirming ? 'Cashing out…' : amountCents > 0 ? `Cash out ${formatCents(amountCents)}` : 'Enter an amount'}
          </Text>
        </Pressable>
      </SheetRise>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: RADIUS.xl, borderTopRightRadius: RADIUS.xl,
    paddingHorizontal: SP.md, paddingTop: SP.xs,
  },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: SP.sm },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: SP.sm },
  title: { fontFamily: FONT.bold, fontSize: FS.md },
  sub: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  balancePill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 6, marginBottom: SP.md,
  },
  balanceText: { fontFamily: FONT.semibold, fontSize: FS.xs },
  promoNote: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: -SP.sm + 2, marginBottom: SP.md },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: RADIUS.md,
    paddingHorizontal: SP.md, height: 52, gap: SP.xs,
  },
  dollarSign: { fontFamily: FONT.bold, fontSize: FS.lg },
  input: { flex: 1, fontFamily: FONT.bold, fontSize: FS.lg, height: '100%' },
  allChip: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm, paddingVertical: 6 },
  allChipText: { fontFamily: FONT.semibold, fontSize: FS.xs },
  quoteRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: SP.md, paddingTop: SP.md, borderTopWidth: 1,
  },
  quoteLabel: { fontFamily: FONT.medium, fontSize: FS.sm },
  quoteValue: { fontFamily: FONT.bold, fontSize: FS.md },
  feeText: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 4 },
  errorText: { fontFamily: FONT.medium, fontSize: FS.xs, marginTop: SP.xs },
  confirmBtn: { height: 52, borderRadius: RADIUS.pill, alignItems: 'center', justifyContent: 'center', marginTop: SP.md },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { fontFamily: FONT.bold, fontSize: FS.sm },
});
