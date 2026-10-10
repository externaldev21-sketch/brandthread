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
import { ScreenHeader } from '@/components/ScreenHeader';
import { useApi } from '@/lib/api';
import { adaptApiOrder } from '@/app/order-detail';
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
  const [presets, setPresets] = useState<PackagePreset[]>([]);
  const [presetsLoaded, setPresetsLoaded] = useState(false);
  const [boxId, setBoxId] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuotedOrder[]>([]);
  const [notice, setNotice] = useState<'no_box' | 'no_ship_from' | null>(null);
  const quoteTotal = quotes.reduce((sum, q) => sum + q.rate.priceCents, 0);

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

  // Step 1 of "Print labels": quote every unlabeled order with a real box (a
  // saved package preset) and the items' stored weights, from the seller's
  // ship-from address. Nothing is bought until the seller confirms the total.
  async function handlePrintLabels(pickedBoxId?: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setRunning('labels');
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
      <ScreenHeader title={`Fulfill ${ids.length} Order${ids.length === 1 ? '' : 's'}`} />
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
              <PrimaryButton label="Print labels" icon="tag" onPress={() => handlePrintLabels()} loading={running === 'labels'} disabled={running !== null || orders.length === 0} style={{ flex: 1 }} />
              <SecondaryButton label="Mark shipped" icon="send" onPress={handleMarkShipped} disabled={running !== null || orders.length === 0} style={{ flex: 1 }} />
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
                {presets.length > 1 && (
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
                        <Text style={s.mutedText}>{p.lengthIn}×{p.widthIn}×{p.heightIn} in</Text>
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
    totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: SP.md },
    boxRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
    boxChip: { paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: RADIUS.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', gap: 2 },
    boxChipActive: { borderColor: FG },
  });
};
