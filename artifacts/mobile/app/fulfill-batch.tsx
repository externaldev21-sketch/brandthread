/**
 * Fulfill Batch — bulk "Print labels" / "Mark shipped" for a set of orders,
 * with a per-row success/failure summary (no silent partial failures).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/BrandthreadUI';
import { Header } from '@/components/layout';
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
  const insets = useSafeAreaInsets();
  const api = useApi();

  const ids = useMemo(() => (orderIds ?? '').split(',').map(id => id.trim()).filter(Boolean), [orderIds]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<'labels' | 'ship' | null>(null);
  const [results, setResults] = useState<RowResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
  }, [api, ids]);

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
      <Header title={`Fulfill ${ids.length} Order${ids.length === 1 ? '' : 's'}`} />
      <ScrollView contentContainerStyle={{ padding: SP.md, gap: SP.md, paddingBottom: insets.bottom + SP.xxl }}>
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
              <PrimaryButton label="Print labels" icon="tag" onPress={handlePrintLabels} loading={running === 'labels'} disabled={running !== null || orders.length === 0} style={{ flex: 1 }} />
              <SecondaryButton label="Mark shipped" icon="send" onPress={handleMarkShipped} disabled={running !== null || orders.length === 0} style={{ flex: 1 }} />
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
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  });
};
