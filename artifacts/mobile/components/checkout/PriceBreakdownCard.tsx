/**
 * The ONE price breakdown on the checkout screen (SSENSE Subtotal / Shipping
 * Total / Order Total; GOAT "Total" block): Subtotal, Shipping, Tax,
 * Discount (only when a promo applies), Rewards (only when used), Total.
 * With Thread Cash applied, Total becomes Order total → Thread Cash →
 * Charged to card.
 * The sticky footer's "Place order · $X" repeats only the final number, as
 * the button's own label — there is no second breakdown anywhere.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import type { CheckoutDisplayTotals } from '@/lib/checkoutReadiness';
import { FONT, FS, SP } from '@/lib/theme';
import { TABULAR_NUMS } from '@/constants/typography';
import { CheckoutCard, Hairline } from './CheckoutPrimitives';

function Line({ label, value, strong = false, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={styles.line} testID={testID}>
      <Text style={[strong ? styles.totalLabel : styles.label, { color: strong ? theme.text : theme.muted }]}>{label}</Text>
      <Text style={[strong ? styles.totalValue : styles.value, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

export function PriceBreakdownCard({ totals, itemCount }: { totals: CheckoutDisplayTotals; itemCount: number }) {
  return (
    <CheckoutCard title="Order total" testID="checkout-price-breakdown">
      <Line label={`Subtotal (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`} value={formatCents(totals.subtotalCents)} />
      <Line label="Shipping" value={totals.shippingCents === 0 ? 'Free' : formatCents(totals.shippingCents)} />
      <Line label="Tax" value={totals.taxCents > 0 ? formatCents(totals.taxCents) : 'Calculated at payment'} />
      {totals.promoCents > 0 ? (
        <Line label="Discount" value={`−${formatCents(totals.promoCents)}`} testID="checkout-discount-line" />
      ) : null}
      {totals.rewardsCents > 0 ? (
        <Line label="Rewards" value={`−${formatCents(totals.rewardsCents)}`} />
      ) : null}
      <Hairline style={{ marginVertical: SP.sm }} />
      {totals.threadCashCents > 0 ? (
        <>
          {/* Item 109: Thread Cash pays part of the total, so it comes after
              it; the card line is what Stripe charges (talabat "Pay by card"). */}
          <Line label="Order total" value={formatCents(totals.orderTotalCents)} testID="checkout-order-total-line" />
          <Line label="Thread Cash" value={`−${formatCents(totals.threadCashCents)}`} testID="checkout-thread-cash-line" />
          <Line label="Charged to card" value={formatCents(totals.totalCents)} strong testID="checkout-total-line" />
        </>
      ) : (
        <Line label="Total" value={formatCents(totals.totalCents)} strong testID="checkout-total-line" />
      )}
    </CheckoutCard>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: SP.sm, paddingVertical: 5 },
  label: { fontFamily: FONT.regular, fontSize: FS.base, flexShrink: 1 },
  value: { fontFamily: FONT.medium, fontSize: FS.base, ...TABULAR_NUMS },
  totalLabel: { fontFamily: FONT.semibold, fontSize: FS.md },
  totalValue: { fontFamily: FONT.bold, fontSize: FS.lg, ...TABULAR_NUMS },
});
