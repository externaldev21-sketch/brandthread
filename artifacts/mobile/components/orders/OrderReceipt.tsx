/**
 * Order detail money block as a receipt: label left, amount right in
 * tabular figures, a hairline above "Your payout", payout bold. Lines come
 * from lib/orderReceipt.ts (real fee columns only, never estimated).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { formatCents } from '@/lib/money';
import { receiptAmount, type OrderReceipt as Receipt } from '@/lib/orderReceipt';

export function OrderReceipt({ receipt, testID = 'order-receipt' }: { receipt: Receipt; testID?: string }) {
  const { theme } = useAppTheme();
  return (
    <View
      style={[st.card, { backgroundColor: theme.card, borderColor: theme.border }]}
      testID={testID}
    >
      {receipt.lines.map(line => (
        <View key={line.key} style={st.row} testID={`${testID}-${line.key}`}>
          <Text style={[st.label, { color: theme.muted }]} numberOfLines={1}>{line.label}</Text>
          <Text style={[st.amount, { color: theme.text }]} numberOfLines={1}>{receiptAmount(line.cents, formatCents)}</Text>
        </View>
      ))}
      <View style={[st.hairline, { backgroundColor: theme.border }]} />
      {receipt.payoutCents != null ? (
        <View style={st.row} testID={`${testID}-payout`}>
          <Text style={[st.totalLabel, { color: theme.text }]}>Your payout</Text>
          <Text style={[st.totalAmount, { color: theme.text }]} numberOfLines={1}>{formatCents(receipt.payoutCents)}</Text>
        </View>
      ) : (
        <>
          <View style={st.row} testID={`${testID}-total`}>
            <Text style={[st.totalLabel, { color: theme.text }]}>Order total</Text>
            <Text style={[st.totalAmount, { color: theme.text }]} numberOfLines={1}>{formatCents(receipt.orderTotalCents)}</Text>
          </View>
          <Text style={[st.note, { color: theme.muted }]}>Fees and your payout show once Stripe confirms the payment.</Text>
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: RADIUS.lg, paddingHorizontal: SP.md, paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SP.md, paddingVertical: 4 },
  label: { fontSize: FS.base, fontFamily: FONT.regular, flexShrink: 1 },
  amount: { fontSize: FS.base, fontFamily: FONT.regular, fontVariant: ['tabular-nums'], textAlign: 'right' },
  hairline: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  totalLabel: { fontSize: FS.base, fontFamily: FONT.bold },
  totalAmount: { fontSize: FS.base, fontFamily: FONT.bold, fontVariant: ['tabular-nums'], textAlign: 'right' },
  note: { fontSize: FS.sm, fontFamily: FONT.regular, marginTop: 4 },
});
