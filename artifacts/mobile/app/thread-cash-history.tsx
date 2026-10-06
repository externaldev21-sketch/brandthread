/**
 * Seller Thread Cash history — a real ledger of every entry that moved the
 * balance: received (Live gift, message payment) and cash-outs, with a
 * running balance column. Read-only; the actual cash-out flow lives on the
 * Payouts screen (components/thread-cash/CashOutSheet.tsx) this links back
 * to. Same data source (useSellerThreadCashHistory) as the Payouts card and
 * dashboard row, so the numbers never drift.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { fmtDate } from '@/lib/format';
import { isBuyerDevPreview } from '@/lib/devPreview';
import { getPreviewSellerThreadCashBalanceCents, getPreviewSellerThreadCashHistory } from '@/lib/previewSellerThreadCash';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout';
import { RetryRow } from '@/components/ui/RetryRow';
import { SkeletonBlock } from '@/components/ui';
import { TABULAR_NUMS } from '@/constants/typography';
import { useSellerThreadCashBalance, useSellerThreadCashHistory } from '@/hooks/useSellerThreadCash';
import { ThreadCashBillIcon } from '@/components/thread-cash/ThreadCashBill';
import type { ThreadCashEntry } from '@/lib/threadCashTypes';

function historyLabel(entry: ThreadCashEntry): string {
  switch (entry.source) {
    case 'live_gift': return 'Live gift';
    case 'send_received': return 'Message payment';
    case 'cash_out': return 'Cashed out';
    default: return 'Adjustment';
  }
}

function historyGlyph(entry: ThreadCashEntry, theme: AppThemePreset): { icon: React.ComponentProps<typeof Feather>['name']; color: string } {
  switch (entry.source) {
    case 'live_gift': return { icon: 'gift', color: theme.success };
    case 'send_received': return { icon: 'message-circle', color: theme.success };
    case 'cash_out': return { icon: 'arrow-down-circle', color: theme.text };
    default: return { icon: 'dollar-sign', color: theme.muted };
  }
}

export default function ThreadCashHistoryScreen() {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  const balance = useSellerThreadCashBalance();
  const seller = useSellerThreadCashHistory(100);
  // The shared hook only falls back to the preview fixture for the seller
  // preview; a buyer-preview visit (no backend either) would otherwise read
  // as a load error. Same fixture, same demo gating: fresh preview → honest
  // empty state, demo opt-in → the seeded ledger.
  const buyerPreviewFallback = isBuyerDevPreview() && seller.error;
  const history = buyerPreviewFallback ? getPreviewSellerThreadCashHistory() : seller.history;
  const { loading, reload } = seller;
  const error = buyerPreviewFallback ? false : seller.error;
  const balanceCents = buyerPreviewFallback || (isBuyerDevPreview() && balance.error)
    ? getPreviewSellerThreadCashBalanceCents()
    : balance.balanceCents;

  // History is newest-first; walk backward from the current balance so each
  // row shows the balance immediately AFTER that entry took effect.
  let running = balanceCents ?? 0;
  const rows = history.map((entry) => {
    const balanceAfter = running;
    running -= entry.amountCents;
    return { entry, balanceAfter };
  });

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Thread Cash history" />

      <View style={[styles.balanceRow, { borderBottomColor: theme.borderSubtle }]}>
        <ThreadCashBillIcon size={16} />
        {balance.loading ? (
          <SkeletonBlock width={96} height={14} />
        ) : (
          <Text style={[styles.balanceText, { color: theme.text }]} testID="thread-cash-history-balance">
            {formatCents(balanceCents ?? 0)} balance
          </Text>
        )}
      </View>

      {loading ? (
        <View style={{ padding: SP.md, gap: SP.sm }}>
          {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} width="100%" height={56} radius={12} />)}
        </View>
      ) : error && history.length === 0 ? (
        <View style={{ padding: SP.md }}>
          <RetryRow label="Couldn't load history" onRetry={() => void reload()} />
        </View>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="dollar-sign"
          title="No Thread Cash activity yet"
          message="Live gifts and message payments from buyers will show up here."
        />
      ) : (
        <View style={styles.list} testID="thread-cash-history-list">
          {rows.map(({ entry, balanceAfter }, index) => {
            const glyph = historyGlyph(entry, theme);
            const isLast = index === rows.length - 1;
            return (
              <View
                key={entry.id}
                style={[styles.row, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: theme.borderSubtle }]}
              >
                <View style={[styles.icon, { backgroundColor: theme.cardElevated }]}>
                  <Feather name={glyph.icon} size={16} color={glyph.color} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.label, { color: theme.text }]} numberOfLines={1}>{historyLabel(entry)}</Text>
                  <Text style={[styles.date, { color: theme.subtle }]} numberOfLines={1}>
                    {fmtDate(entry.createdAt)}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.amount, TABULAR_NUMS, { color: entry.amountCents >= 0 ? theme.success : theme.text }]} numberOfLines={1}>
                    {entry.amountCents >= 0 ? '+' : '−'}{formatCents(Math.abs(entry.amountCents))}
                  </Text>
                  <Text style={[styles.runningBalance, TABULAR_NUMS, { color: theme.subtle }]} numberOfLines={1}>
                    {formatCents(balanceAfter)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { flex: 1 },
  balanceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: SP.md, paddingTop: SP.md, paddingBottom: SP.md, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  balanceText: { fontFamily: FONT.semibold, fontSize: FS.sm },
  list: { paddingHorizontal: SP.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm, minHeight: 60 },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: FONT.medium, fontSize: FS.sm },
  date: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 1 },
  amount: { fontFamily: FONT.bold, fontSize: FS.sm },
  runningBalance: { fontFamily: FONT.regular, fontSize: FS.xs, marginTop: 1 },
});
