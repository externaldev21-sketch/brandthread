/**
 * Fulfill Batch — bulk "Print labels" / "Mark shipped" for a set of orders,
 * with a per-row success/failure summary (no silent partial failures).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, SecondaryButton, SectionHeader } from '@/components/BrandthreadUI';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { Button } from '@/components/ui/Button';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';
import { useApi } from '@/lib/api';
import { adaptApiOrder } from '@/app/order-detail';
import { getShippingRates, purchaseShippingLabel } from '@/services/orderService';
import { Order } from '@/services/orderTypes';

type RowResult = { orderId: string; orderNumber: string; ok: boolean; message: string; labelUrl?: string };

export default function FulfillBatchScreen() {
  const { theme } = useAppTheme();
  const { accent: ACCENT, success: SUCCESS, error: ERROR, muted: MUTED, text: FG } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const { orderIds } = useLocalSearchParams<{ orderIds: string }>();
  const router = useRouter();
  const bottomInset = useSellerTabBarInset();
  const api = useApi();

  const ids = useMemo(() => (orderIds ?? '').split(',').map(id => id.trim()).filter(Boolean), [orderIds]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<'labels' | 'ship' | null>(null);
  const [results, setResults] = useState<RowResult[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Nothing selected (opened directly, or every order was deselected):
      // resolve immediately to the empty state instead of a spinner.
      if (ids.length === 0) {
        setOrders([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const loaded: Order[] = [];
      for (const id of ids) {
        try {
          const raw = await api.orders.get(id);
          if (raw) loaded.push(adaptApiOrder(raw));
        } catch {
          // Skipped orders surface in the results list once an action runs.
        }
      }
      if (!cancelled) {
        setOrders(loaded);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api, ids, reloadKey]);

  async function handlePrintLabels() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRunning('labels');
    const rows: RowResult[] = [];
    for (const order of orders) {
      if (order.labels.some(l => l.status === 'active')) {
        const existing = order.labels.find(l => l.status === 'active')!;
        rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: true, message: 'Already labeled', labelUrl: existing.labelUrl });
        continue;
      }
      try {
        const fromAddress = order.fulfillment.fromAddress ?? order.customer.shippingAddress;
        const rates = await getShippingRates(order.id, {
          fromAddress, weight: '1', length: '10', width: '8', height: '4',
        });
        const cheapest = [...rates].sort((a, b) => a.priceCents - b.priceCents)[0];
        if (!cheapest) {
          rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: false, message: 'No rates available' });
          continue;
        }
        const label = await purchaseShippingLabel(order.id, cheapest, `fulfill-batch-${order.id}`);
        rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: true, message: `${label.carrier} ${label.service} purchased`, labelUrl: label.labelUrl });
      } catch (err: any) {
        rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: false, message: err?.message ?? 'Label purchase failed' });
      }
    }
    setResults(rows);
    setRunning(null);

    const urls = rows.filter(r => r.ok && r.labelUrl).map(r => r.labelUrl!) as string[];
    if (urls.length > 0 && await Sharing.isAvailableAsync().catch(() => false)) {
      // Share the first label directly; list the rest below for individual open.
      Sharing.shareAsync(urls[0]).catch(() => {});
    }
  }

  async function handleMarkShipped() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRunning('ship');
    const rows: RowResult[] = [];
    for (const order of orders) {
      try {
        await api.orders.updateStatus(order.id, 'shipped');
        rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: true, message: 'Marked shipped' });
      } catch (err: any) {
        rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: false, message: err?.message ?? 'Could not mark shipped' });
      }
    }
    setResults(rows);
    setRunning(null);
  }

  const successCount = results.filter(r => r.ok).length;
  const failCount = results.length - successCount;

  return (
    <View style={s.root}>
      <ScreenHeader
        title={ids.length === 0 ? 'Fulfill orders' : `Fulfill ${ids.length} order${ids.length === 1 ? '' : 's'}`}
        onBack={() => goBackOr(router, '/(tabs)/orders')}
      />
      {ids.length === 0 ? (
        <View style={[s.stateWrap, { paddingBottom: bottomInset }]}>
          <EmptyState
            icon="package"
            title="No orders selected"
            message="Select orders from your orders list to fulfill them together."
            actionLabel="Back to orders"
            onAction={() => goBackOr(router, '/(tabs)/orders')}
            testID="fulfill-batch-empty"
          />
        </View>
      ) : !loading && orders.length === 0 ? (
        <View style={[s.stateWrap, { paddingBottom: bottomInset }]}>
          <EmptyState
            variant="error"
            icon="alert-circle"
            title="Couldn't load these orders"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => setReloadKey(k => k + 1)}
            testID="fulfill-batch-error"
          />
        </View>
      ) : (
      <ScrollView contentContainerStyle={{ padding: SP.md, gap: SP.md, paddingBottom: bottomInset + SP.lg }}>
        {loading ? (
          <View style={s.centered}>
            <ActivityIndicator color={ACCENT} size="large" />
          </View>
        ) : (
          <>
            <SectionHeader title="Selected orders" />
            {orders.map(o => (
              <BrandthreadCard key={o.id} style={s.orderRow}>
                <Text style={s.orderNumber}>#{o.orderNumber}</Text>
                <Text style={s.mutedText}>{o.customer.name}</Text>
              </BrandthreadCard>
            ))}

            <View style={s.actionRow}>
              {/* Equal siblings: same variant/size, each taking half the row. */}
              <View style={s.actionCell}>
                <Button label="Print labels" icon="tag" variant="secondary" size="small" fullWidth onPress={handlePrintLabels} loading={running === 'labels'} disabled={running !== null || orders.length === 0} />
              </View>
              <View style={s.actionCell}>
                <Button label="Mark shipped" icon="send" variant="secondary" size="small" fullWidth onPress={handleMarkShipped} loading={running === 'ship'} disabled={running !== null || orders.length === 0} />
              </View>
            </View>

            {results.length > 0 && (
              <>
                <SectionHeader title={`Results — ${successCount} succeeded, ${failCount} failed`} />
                {results.map(r => (
                  <BrandthreadCard key={r.orderId} style={s.resultRow}>
                    <Feather name={r.ok ? 'check-circle' : 'alert-circle'} size={ICON.md} color={r.ok ? SUCCESS : ERROR} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.orderNumber}>#{r.orderNumber}</Text>
                      <Text style={s.mutedText}>{r.message}</Text>
                    </View>
                    {r.labelUrl && (
                      <TouchableOpacity onPress={() => Linking.openURL(r.labelUrl!)} accessibilityRole="button" accessibilityLabel={`Open label for order ${r.orderNumber}`}>
                        <Feather name="external-link" size={ICON.md} color={ACCENT} />
                      </TouchableOpacity>
                    )}
                  </BrandthreadCard>
                ))}
              </>
            )}

            <SecondaryButton label="Done" icon="check" onPress={() => router.replace('/(tabs)/orders')} />
          </>
        )}
      </ScrollView>
      )}
    </View>
  );
}

const createStyles = (theme: { text: string; muted: string }) => {
  const { text: FG, muted: MUTED } = theme;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: SP.xxl },
    mutedText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
    orderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    orderNumber: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
    actionRow: { flexDirection: 'row', gap: SP.sm },
    actionCell: { flex: 1 },
    stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  });
};
