/**
 * Fulfill Batch — the selected orders from the Orders list. "Fulfill orders"
 * runs the same "Fulfill item" sheet as the order detail, once per order in
 * sequence ("Fulfill 1 of 3", Skip / confirm); "Print labels" buys the
 * cheapest label for each. Every order gets its own result row (no silent
 * partial failures).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { FONT, FS, SP } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { SectionHeader } from '@/components/BrandthreadUI';
import { Button, Icon, ICON_SIZE } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';
import { FulfillSheet } from '@/components/orders/FulfillSheet';
import { useApi } from '@/lib/api';
import { adaptApiOrder } from '@/app/order-detail';
import { getShippingRates, purchaseShippingLabel } from '@/services/orderService';
import { applyFulfillLocally, linesToFulfill, orderTitle, submitFulfillRequest, type FulfillRequest } from '@/lib/orderFulfillment';
import { isLocalPreviewSellerOrderId, loadPreviewSellerOrder, savePreviewSellerOrder } from '@/lib/previewOrderEdits';
import { sellerOrderConflictMessage } from '@/lib/deliveryGuarantee';
import { Order } from '@/services/orderTypes';

type RowResult = { orderId: string; orderNumber: string; ok: boolean; message: string; labelUrl?: string };

export default function FulfillBatchScreen() {
  const { theme } = useAppTheme();
  const { accent: ACCENT, success: SUCCESS, error: ERROR, muted: MUTED } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const { orderIds } = useLocalSearchParams<{ orderIds: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api = useApi();

  const ids = useMemo(() => (orderIds ?? '').split(',').map(id => id.trim()).filter(Boolean), [orderIds]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [raws, setRaws] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<'labels' | 'ship' | null>(null);
  const [lastRun, setLastRun] = useState<'labels' | 'ship'>('labels');
  const [results, setResults] = useState<RowResult[]>([]);
  // Batch ship: the orders going through the sheet, and where we are.
  const [queue, setQueue] = useState<Order[]>([]);
  const [position, setPosition] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const loaded: Order[] = [];
      const rawById: Record<string, any> = {};
      for (const id of ids) {
        try {
          // Seller web preview demo orders never reach the API.
          const raw = isLocalPreviewSellerOrderId(id) ? loadPreviewSellerOrder(id) : await api.orders.get(id);
          if (raw) {
            loaded.push(adaptApiOrder(raw));
            rawById[id] = raw;
          }
        } catch {
          // Skipped orders surface in the results list once an action runs.
        }
      }
      if (!cancelled) {
        setOrders(loaded);
        setRaws(rawById);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api, ids]);

  async function handlePrintLabels() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRunning('labels');
    setLastRun('labels');
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

  const fulfillable = orders.filter(o => linesToFulfill(o).length > 0);

  function startShip() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setResults([]);
    setLastRun('ship');
    setQueue(fulfillable);
    setPosition(0);
    setRunning('ship');
  }

  function record(row: RowResult) {
    setResults(prev => [...prev.filter(r => r.orderId !== row.orderId), row]);
  }

  function stopShip() {
    setQueue([]);
    setPosition(0);
    setRunning(null);
  }

  function advance() {
    if (position + 1 >= queue.length) stopShip();
    else setPosition(position + 1);
  }

  /** The sheet's request for the current order — the same endpoints the order detail uses. */
  async function handleSubmit(request: FulfillRequest) {
    const order = queue[position];
    if (!order) return;
    if (isLocalPreviewSellerOrderId(order.id) && raws[order.id]) {
      const next = applyFulfillLocally(raws[order.id], request, new Date().toISOString());
      savePreviewSellerOrder(next);
      setRaws(prev => ({ ...prev, [order.id]: next }));
      setOrders(prev => prev.map(o => (o.id === order.id ? adaptApiOrder(next) : o)));
    } else {
      try {
        await submitFulfillRequest(api.orders, order.id, request);
      } catch (err: any) {
        throw new Error(sellerOrderConflictMessage(err?.code) ?? err?.message ?? 'Couldn’t fulfill this order.');
      }
    }
    record({ orderId: order.id, orderNumber: order.orderNumber, ok: true, message: 'Fulfilled' });
    advance();
  }

  function handleSkip() {
    const order = queue[position];
    if (order) record({ orderId: order.id, orderNumber: order.orderNumber, ok: false, message: 'Skipped' });
    advance();
  }

  const successCount = results.filter(r => r.ok).length;
  const failCount = results.length - successCount;
  const current = queue[position] ?? null;

  return (
    <View style={s.root}>
      <ScreenHeader title={`Fulfill ${ids.length} Order${ids.length === 1 ? '' : 's'}`} />
      <ScrollView contentContainerStyle={{ padding: SP.md, gap: SP.md, paddingBottom: insets.bottom + SP.xxl }}>
        {loading ? (
          <View style={s.centered}>
            <ActivityIndicator color={ACCENT} size="large" />
          </View>
        ) : (
          <>
            <SectionHeader title="Selected orders" />
            {orders.map(o => {
              const open = linesToFulfill(o).reduce((n, li) => n + li.quantity, 0);
              return (
                <View key={o.id} style={s.orderRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.orderNumber}>{orderTitle(o.orderNumber)}</Text>
                    <Text style={s.mutedText}>{o.customer.name}</Text>
                  </View>
                  <Text style={s.mutedText}>{open > 0 ? `Unfulfilled (${open})` : 'Fulfilled'}</Text>
                </View>
              );
            })}

            <View style={s.actionRow}>
              <View style={s.half}>
                <Button label="Fulfill orders" onPress={startShip} disabled={running !== null || fulfillable.length === 0} fullWidth testID="batch-fulfill" />
              </View>
              <View style={s.half}>
                <Button label="Print labels" variant="secondary" onPress={handlePrintLabels} loading={running === 'labels'} disabled={running !== null || orders.length === 0} fullWidth testID="batch-print-labels" />
              </View>
            </View>

            {results.length > 0 && (
              <>
                <SectionHeader title={lastRun === 'ship'
                  ? `Results — ${successCount} fulfilled, ${failCount} skipped`
                  : `Results — ${successCount} succeeded, ${failCount} failed`} />
                {results.map(r => (
                  <View key={r.orderId} style={s.resultRow}>
                    <Icon
                      name={r.ok ? 'check-circle' : lastRun === 'ship' ? 'skip-forward' : 'alert-circle'}
                      size={ICON_SIZE.md}
                      color={r.ok ? SUCCESS : lastRun === 'ship' ? MUTED : ERROR}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={s.orderNumber}>{orderTitle(r.orderNumber)}</Text>
                      <Text style={s.mutedText}>{r.message}</Text>
                    </View>
                    {r.labelUrl && (
                      <TouchableOpacity onPress={() => Linking.openURL(r.labelUrl!)} accessibilityRole="button" accessibilityLabel={`Open label for order ${r.orderNumber}`}>
                        <Icon name="external-link" size={ICON_SIZE.md} color={ACCENT} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </>
            )}

            <Button label="Done" variant="secondary" onPress={() => router.replace('/(tabs)/orders')} fullWidth />
          </>
        )}
      </ScrollView>

      <FulfillSheet
        visible={!!current}
        order={current}
        onCancel={stopShip}
        onSubmit={handleSubmit}
        batch={current ? { index: position, total: queue.length, onSkip: handleSkip } : undefined}
      />
    </View>
  );
}

const createStyles = (theme: { text: string; muted: string; border: string }) => {
  const { text: FG, muted: MUTED, border: BORDER } = theme;
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: 'transparent' },
    centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: SP.xxl },
    mutedText: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
    orderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SP.sm, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
    orderNumber: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG },
    actionRow: { flexDirection: 'row', gap: SP.sm },
    half: { flex: 1 },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
  });
};
