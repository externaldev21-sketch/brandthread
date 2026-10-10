/**
 * "Held until delivery" under the payout balance (Shopify payouts pattern:
 * plain label + amount, one line of timing, then a short list of rows).
 * Sellers are paid only after an order is delivered + the payout buffer
 * (api-server lib/delivery/policy.ts), so without this the balance can read
 * $0.00 for weeks with no explanation.
 *
 *   <HeldForDeliveryRow summary={summary} />   when the screen already has
 *                                              GET /api/finance/summary
 *   <HeldForDeliverySection />                 loads it itself (compact: total,
 *                                              rule and the next dated payout;
 *                                              no per-order list, so payouts.tsx's
 *                                              fixed header stays short)
 */
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useAppTheme, type AppThemePreset } from '@/contexts/AppThemeContext';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { useApi } from '@/lib/api';
import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';
import type { FinanceSummary } from '@/lib/financeSummary';
import { buildHeldForDeliveryView, previewHeldForDelivery } from '@/lib/payoutHoldTiming';

type Props = {
  summary: Pick<FinanceSummary, 'held'> | null | undefined;
  /** Horizontal inset; the payouts screen uses SP.md, finance its own padding. */
  inset?: number;
  /** Total + rule + next payout only, without the per-order rows. */
  compact?: boolean;
};

export function HeldForDeliveryRow({ summary, inset = 0, compact = false }: Props) {
  const { theme } = useAppTheme();
  const styles = React.useMemo(() => createStyles(theme), [theme]);
  // Demo preview (finance.tsx's demo ledger has no held orders) gets the
  // labelled local illustration; everything else shows the real figures.
  const demo = isSellerDevPreview() && isPreviewDemoMode() && !summary?.held.orders?.length;
  const view = buildHeldForDeliveryView(demo ? previewHeldForDelivery() : summary);
  if (!view.visible) return null;

  return (
    <View style={[styles.root, { marginHorizontal: inset }]} testID="held-for-delivery">
      <View style={styles.headRow}>
        <Text style={styles.label}>{view.label}</Text>
        <Text style={[styles.amount, TABULAR_NUMS]}>{view.amount}</Text>
      </View>
      <Text style={styles.rule}>{view.rule}</Text>
      {compact && view.next ? <Text style={styles.rule}>{view.next}</Text> : null}
      {!compact && view.orders.map((order) => (
        <View key={order.id} style={styles.orderRow}>
          <View style={styles.orderText}>
            <Text style={styles.orderTitle} numberOfLines={1}>{order.title}</Text>
            <Text style={styles.orderStatus} numberOfLines={1}>{order.status}</Text>
          </View>
          <Text style={[styles.orderAmount, TABULAR_NUMS]}>{order.amount}</Text>
        </View>
      ))}
      {!compact && view.moreCount > 0 && (
        <Text style={styles.more}>{`${view.moreCount} more ${view.moreCount === 1 ? 'order' : 'orders'} held`}</Text>
      )}
    </View>
  );
}

/** Self-loading variant for screens that don't fetch /finance/summary. */
export function HeldForDeliverySection({ inset = SP.md, compact = true }: { inset?: number; compact?: boolean }) {
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const preview = isSellerDevPreview();
  const [summary, setSummary] = useState<Pick<FinanceSummary, 'held'> | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusEffect(useCallback(() => {
    // Preview never calls protected APIs; signed-out never either.
    if (preview || !isLoaded || !isSignedIn) return;
    let active = true;
    api.finance.summary()
      .then((next) => { if (active) { setSummary(next); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [api, preview, isLoaded, isSignedIn]));

  // A failed load shows nothing rather than a misleading $0.00; the balance
  // above already offers the retry.
  if (failed && !summary) return null;
  if (!preview && !summary) return null;
  return <HeldForDeliveryRow summary={summary} inset={inset} compact={compact} />;
}

const createStyles = (theme: AppThemePreset) => StyleSheet.create({
  root: { marginBottom: SP.md },
  headRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SP.sm },
  label: { color: theme.text, fontSize: FS.base, fontFamily: FONT.semibold },
  amount: { color: theme.text, fontSize: FS.base, fontFamily: FONT.semibold },
  rule: { color: theme.muted, fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 2 },
  orderRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm,
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
  },
  orderText: { flex: 1, minWidth: 0 },
  orderTitle: { color: theme.text, fontSize: FS.sm, fontFamily: FONT.medium },
  orderStatus: { color: theme.muted, fontSize: FS.meta, fontFamily: FONT.regular, marginTop: 2 },
  orderAmount: { color: theme.text, fontSize: FS.sm, fontFamily: FONT.medium },
  more: { color: theme.muted, fontSize: FS.meta, fontFamily: FONT.regular, marginTop: SP.sm },
});
