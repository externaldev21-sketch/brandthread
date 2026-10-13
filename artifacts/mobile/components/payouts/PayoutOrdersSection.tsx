/**
 * "Orders" on payout detail (Shopify payout detail transactions): one row
 * per order in the payout with its number, date and net amount. Rows open
 * the seller order detail. Renders nothing when the payout has no orders.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { PressableScale } from '@/components/BrandthreadUI';
import { AppThemePreset, useAppTheme } from '@/contexts/AppThemeContext';
import { FONT, FS, ICON, RADIUS, SP } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { fmtDate, type PayoutOrder } from '@/lib/payoutScheduleView';

export function PayoutOrdersSection({ orders }: { orders: PayoutOrder[] | undefined }) {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  if (!orders?.length) return null;

  return (
    <>
      <View style={styles.titleRow}>
        <Text style={styles.sectionTitle}>Orders</Text>
        <Text style={styles.sectionCount}>{orders.length}</Text>
      </View>
      <View style={styles.group} testID="payout-detail-orders">
        {orders.map((order, index) => (
          <PressableScale
            key={order.orderId}
            onPress={() => router.push(`/order-detail?id=${encodeURIComponent(order.orderId)}` as never)}
            accessibilityRole="button"
            accessibilityLabel={`Order ${order.orderNumber}, ${formatCents(order.net)}`}
            style={[styles.row, index > 0 && styles.rowBorder]}
          >
            <View style={styles.rowText}>
              <Text style={styles.orderNumber} numberOfLines={1}>{order.orderNumber}</Text>
              <Text style={styles.meta} numberOfLines={1}>{fmtDate(order.createdAt)}</Text>
            </View>
            <Text style={styles.net}>{formatCents(order.net)}</Text>
            <Feather name="chevron-right" size={ICON.sm} color={theme.muted} />
          </PressableScale>
        ))}
      </View>
    </>
  );
}

const createStyles = (theme: AppThemePreset) => {
  const { text, muted, border, card } = theme;
  return StyleSheet.create({
    titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm, marginTop: SP.sm },
    sectionTitle: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium, textTransform: 'uppercase', letterSpacing: 0.5 },
    sectionCount: { color: muted, fontSize: FS.xs, fontFamily: FONT.medium },
    group: { backgroundColor: card, borderRadius: RADIUS.lg, borderWidth: 1, borderColor: border, paddingHorizontal: SP.md, marginBottom: SP.md },
    row: { flexDirection: 'row', alignItems: 'center', paddingVertical: SP.md, gap: SP.sm },
    rowBorder: { borderTopWidth: 1, borderTopColor: border },
    rowText: { flex: 1, gap: 2 },
    orderNumber: { color: text, fontSize: FS.sm, fontFamily: FONT.medium },
    meta: { color: muted, fontSize: FS.xs, fontFamily: FONT.regular },
    net: { color: text, fontSize: FS.sm, fontFamily: FONT.medium },
  });
};
