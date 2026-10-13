/**
 * Seller Thread Cash card — shown at the top of the Payouts screen. Big
 * balance in Thread Cash green (one of the app's allowed non-monochrome
 * accents — see scripts/audit/half-done-audit.mjs's ALLOWED_ACCENTS), a $
 * subtitle showing its live cash-out value (fee-aware, in case Dev ever
 * turns one on), and Cash out / History actions.
 *
 * Purely presentational — balance comes from useSellerThreadCashBalance()
 * so the dashboard row, the Studio/More tile and this card never drift.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { FONT, FS, RADIUS, SP } from '@/lib/theme';
import { THREAD_CASH_GREEN_MID, ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import { RetryRow } from '@/components/ui/RetryRow';
import { radius } from '@/constants/radii';

export function SellerThreadCashCard({
  balanceCents, loading, error, onReload, onCashOutPress,
}: {
  balanceCents: number | null;
  loading: boolean;
  error: boolean;
  onReload: () => void;
  onCashOutPress: () => void;
}) {
  const { theme } = useAppTheme();
  const router = useRouter();
  const api = useApi();
  const [cashOutValueCents, setCashOutValueCents] = useState<number | null>(null);

  useEffect(() => {
    if (!balanceCents) { setCashOutValueCents(balanceCents); return; }
    let cancelled = false;
    api.threadCash.cashOutQuote(balanceCents)
      .then((q) => { if (!cancelled) setCashOutValueCents(q.payoutCents); })
      .catch(() => { if (!cancelled) setCashOutValueCents(balanceCents); });
    return () => { cancelled = true; };
  }, [balanceCents, api]);

  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]} testID="seller-thread-cash-card">
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <ThreadCashBillIcon size={18} />
          <Text style={[styles.title, { color: theme.text }]}>Thread Cash</Text>
        </View>
        <Pressable
          onPress={() => { router.push('/thread-cash-history' as never); }}
          style={[styles.historyBtn, { borderColor: theme.border }]}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Thread Cash history"
          testID="seller-thread-cash-history-button"
        >
          <Text style={[styles.historyBtnText, { color: theme.text }]}>History</Text>
        </Pressable>
      </View>

      {loading ? (
        <Text style={[styles.balance, { color: THREAD_CASH_GREEN_MID }]}>···</Text>
      ) : error ? (
        <RetryRow label="Couldn't load Thread Cash" onRetry={onReload} />
      ) : (
        <>
          <Text style={[styles.balance, { color: THREAD_CASH_GREEN_MID }]} testID="seller-thread-cash-balance">
            {formatCents(balanceCents ?? 0)}
          </Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            {cashOutValueCents != null ? `Cash out for ${formatCents(cashOutValueCents)}` : ' '}
          </Text>
        </>
      )}

      <Pressable
        onPress={() => { onCashOutPress(); }}
        disabled={loading || error || !balanceCents}
        style={[
          styles.cashOutBtn,
          (loading || error || !balanceCents)
            ? [styles.cashOutBtnDisabled, { borderColor: theme.border }]
            : { backgroundColor: theme.accent },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Cash out Thread Cash"
        testID="seller-thread-cash-cash-out-button"
      >
        <Feather
          name="arrow-down-circle"
          size={16}
          color={(loading || error || !balanceCents) ? theme.muted : theme.onAccent}
        />
        <Text
          style={[
            styles.cashOutBtnText,
            { color: (loading || error || !balanceCents) ? theme.muted : theme.onAccent },
          ]}
        >
          Cash out
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SP.md,
    marginTop: SP.md,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SP.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontFamily: FONT.semibold, fontSize: FS.sm },
  historyBtn: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: SP.sm, paddingVertical: 6 },
  historyBtnText: { fontFamily: FONT.medium, fontSize: FS.xs },
  balance: { fontFamily: FONT.bold, fontSize: FS.h1, letterSpacing: -0.5 },
  subtitle: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 2 },
  cashOutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 44, borderRadius: radius.md, marginTop: SP.md,
  },
  cashOutBtnDisabled: { borderWidth: 1, backgroundColor: 'transparent' },
  cashOutBtnText: { fontFamily: FONT.bold, fontSize: FS.sm },
});
