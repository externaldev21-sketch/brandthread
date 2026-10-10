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
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, PrimaryButton, SecondaryButton, SectionHeader } from '@/components/BrandthreadUI';
import { EmptyState } from '@/components/layout/EmptyState';
import { goBackOr } from '@/lib/navigation/goBackOr';
import { useSellerTabBarInset } from '@/hooks/useSellerTabBarInset';
import { Button, Icon, ICON_SIZE } from '@/components/ui';
import { ScreenHeader } from '@/components/ScreenHeader';
import { FulfillSheet } from '@/components/orders/FulfillSheet';
import { useApi } from '@/lib/api';
import { adaptApiOrder } from '@/app/order-detail';
import { applyFulfillLocally, linesToFulfill, orderTitle, submitFulfillRequest, type FulfillRequest } from '@/lib/orderFulfillment';
import { isLocalPreviewSellerOrderId, loadPreviewSellerOrder, savePreviewSellerOrder } from '@/lib/previewOrderEdits';
import { sellerOrderConflictMessage } from '@/lib/deliveryGuarantee';
import {
  getPackagePresets, getParcelSuggestion, getShippingRates, isShipFromError, purchaseShippingLabel, type PackagePreset,
} from '@/services/orderService';
import { Order, ShippingRate } from '@/services/orderTypes';
import { formatCents } from '@/lib/money';
import { batchParcelWeightLb } from '@/lib/batchLabels';

type RowResult = { orderId: string; orderNumber: string; ok: boolean; message: string; labelUrl?: string };
type QuotedOrder = { order: Order; rate: ShippingRate; weight: string };

export default function FulfillBatchScreen() {
  const { theme } = useAppTheme();
  const { accent: ACCENT, success: SUCCESS, error: ERROR, muted: MUTED } = theme;
  const s = useMemo(() => createStyles(theme), [theme]);
  const { orderIds } = useLocalSearchParams<{ orderIds: string }>();
  const router = useRouter();
  const bottomInset = useSellerTabBarInset();
  const api = useApi();

  const ids = useMemo(() => (orderIds ?? '').split(',').map(id => id.trim()).filter(Boolean), [orderIds]);

  const [orders, setOrders] = useState<Order[]>([]);
  const [raws, setRaws] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<'labels' | 'ship' | null>(null);
  const [lastRun, setLastRun] = useState<'labels' | 'ship'>('labels');
  const [results, setResults] = useState<RowResult[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  // Batch ship: the orders going through the sheet, and where we are.
  const [queue, setQueue] = useState<Order[]>([]);
  const [position, setPosition] = useState(0);
  const [presets, setPresets] = useState<PackagePreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [boxId, setBoxId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuotedOrder[]>([]);
  const [notice, setNotice] = useState<'no_box' | 'no_ship_from' | null>(null);
  const quoteTotal = quotes.reduce((sum, q) => sum + q.rate.priceCents, 0);

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
  }, [api, ids, reloadKey]);

  // Step 1 of "Print labels": quote every unlabeled order with a real box (a
  // saved package preset) and the items' stored weights, from the seller's
  // ship-from address. Nothing is bought until the seller confirms the total.
  async function handlePrintLabels(pickedBoxId?: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRunning('labels');
    setLastRun('labels');
    setNotice(null);
    setQuotes([]);
    try {
      let boxes = presets;
      if (!presetsLoaded) {
        boxes = await getPackagePresets().catch(() => []);
        setPresets(boxes);
        setPresetsLoaded(true);
      }
      const box = boxes.find(p => p.id === (pickedBoxId ?? boxId)) ?? boxes[0];
      if (!box) {
        setNotice('no_box');
        return;
      }
      setBoxId(box.id);
      const next: QuotedOrder[] = [];
      const rows: RowResult[] = [];
      for (const order of orders) {
        const existing = order.labels.find(l => l.status === 'active');
        if (existing) {
          rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: true, message: 'Already labeled', labelUrl: existing.labelUrl });
          continue;
        }
        try {
          const suggestion = await getParcelSuggestion(order.id).catch(() => null);
          const weight = batchParcelWeightLb(suggestion, box.weightOz);
          const fromAddress = order.fulfillment.fromAddress;
          const rates = await getShippingRates(order.id, {
            ...(fromAddress ? { fromAddress } : {}),
            weight, length: String(box.lengthIn), width: String(box.widthIn), height: String(box.heightIn),
          });
          const cheapest = [...rates].sort((a, b) => a.priceCents - b.priceCents)[0];
          if (!cheapest) {
            rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: false, message: 'No rates available' });
            continue;
          }
          next.push({ order, rate: cheapest, weight });
        } catch (err: any) {
          if (isShipFromError(err)) {
            setNotice('no_ship_from');
            return;
          }
          rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: false, message: err?.message ?? 'Could not get rates' });
        }
      }
      setQuotes(next);
      setResults(rows);
    } finally {
      setRunning(null);
    }
  }

  // Step 2: buy exactly the quoted labels after the seller saw the total.
  async function handleBuyQuoted() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRunning('labels');
    const rows: RowResult[] = [...results];
    for (const { order, rate } of quotes) {
      try {
        const label = await purchaseShippingLabel(order.id, rate, `fulfill-batch-${order.id}`);
        rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: true, message: `${label.carrier} ${label.service} purchased`, labelUrl: label.labelUrl });
      } catch (err: any) {
        rows.push({ orderId: order.id, orderNumber: order.orderNumber, ok: false, message: err?.message ?? 'Label purchase failed' });
      }
    }
    setQuotes([]);
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
                <Button label="Print labels" variant="secondary" onPress={() => handlePrintLabels()} loading={running === 'labels'} disabled={running !== null || orders.length === 0} fullWidth testID="batch-print-labels" />
              </View>
            </View>

            {notice === 'no_ship_from' && (
              <BrandthreadCard style={{ gap: SP.sm }}>
                <Text style={s.mutedText}>Add the address you ship from to buy labels.</Text>
                <SecondaryButton label="Add ship-from address" onPress={() => router.push('/locations' as any)} />
              </BrandthreadCard>
            )}
            {notice === 'no_box' && (
              <BrandthreadCard style={{ gap: SP.sm }}>
                <Text style={s.mutedText}>Save a box size first. Labels are priced by the box's size and weight.</Text>
                <SecondaryButton label="Add a box size" onPress={() => router.push({ pathname: '/fulfill-order', params: { orderId: orders[0]?.id } } as any)} />
              </BrandthreadCard>
            )}

            {quotes.length > 0 && (
              <>
                {presets.length > 0 && (
                  <View style={s.boxRow}>
                    {presets.map(p => (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => { if (p.id !== boxId) handlePrintLabels(p.id); }}
                        disabled={running !== null}
                        style={[s.boxChip, p.id === boxId && s.boxChipActive]}
                        accessibilityRole="button"
                        accessibilityLabel={`Use box ${p.name}`}
                      >
                        <Text style={s.orderNumber}>{p.name}</Text>
                        <Text style={s.mutedText}>{Number(p.lengthIn)}×{Number(p.widthIn)}×{Number(p.heightIn)} in</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                <SectionHeader title={`Review ${quotes.length} label${quotes.length === 1 ? '' : 's'}`} />
                {quotes.map(q => (
                  <BrandthreadCard key={q.order.id} style={s.resultRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.orderNumber}>#{q.order.orderNumber}</Text>
                      <Text style={s.mutedText}>{q.rate.carrier} {q.rate.service}, {q.weight} lb</Text>
                    </View>
                    <Text style={s.orderNumber}>{formatCents(q.rate.priceCents)}</Text>
                  </BrandthreadCard>
                ))}
                <View style={s.totalRow}>
                  <Text style={s.orderNumber}>Total</Text>
                  <Text style={s.orderNumber}>{formatCents(quoteTotal)}</Text>
                </View>
                <View style={s.actionRow}>
                  <PrimaryButton label={`Buy ${quotes.length} label${quotes.length === 1 ? '' : 's'}`} onPress={handleBuyQuoted} loading={running === 'labels'} disabled={running !== null} style={{ flex: 1 }} />
                  <SecondaryButton label="Cancel" onPress={() => setQuotes([])} disabled={running !== null} style={{ flex: 1 }} />
                </View>
              </>
            )}

            {results.length > 0 && quotes.length === 0 && (
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
      )}

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
    actionCell: { flex: 1 },
    stateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    half: { flex: 1 },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: BORDER },
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SP.md },
    boxRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
    boxChip: { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', gap: 2 },
    boxChipActive: { borderColor: FG },
  });
};
