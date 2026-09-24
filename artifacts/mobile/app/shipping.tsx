import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, TextInput } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Header } from '@/components/layout';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeSetupTaskAfter } from '@/lib/setupCompletion';
import { FS, SP, RADIUS } from '@/lib/theme';
import { dbStatusToOrderStatus } from '@/lib/orderStatusAdapter';
import { parseDecimalToCents } from '@/lib/money';

function shipmentProgress(status: string): number {
  // Order → Label → Pickup → Transit → Delivered, derived from the real
  // order status — never fabricated.
  switch (status) {
    case 'ready_to_ship': return 25;
    case 'shipped':       return 70;
    case 'delivered':     return 100;
    default:              return 10;
  }
}

function shipmentStatusLabel(status: string): string {
  switch (status) {
    case 'ready_to_ship': return 'Label Created';
    case 'shipped':       return 'In Transit';
    case 'delivered':     return 'Delivered';
    default:              return 'Processing';
  }
}

function capitalize(s: string) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export default function ShippingScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams();
  const launchedFromSellerSetup = isSellerSetupOrigin(params.from);
  const insets = useSafeAreaInsets();
  const api = useApi();

  const [sellerReturns, setSellerReturns] = useState<any[]>([]);
  const [shippingRates, setShippingRates] = useState<any[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [addRateVisible, setAddRateVisible] = useState(false);
  const [newRateName, setNewRateName] = useState('');
  const [newRatePrice, setNewRatePrice] = useState('');

  function leaveSetupDestination() {
    if (launchedFromSellerSetup) {
      router.replace(SELLER_HOME_ROUTE as never);
      return;
    }
    router.back();
  }

  useEffect(() => {
    api.returns.listSeller().then(data => setSellerReturns(data ?? [])).catch(() => {});
    api.shippingRates.list().then(data => setShippingRates(data ?? [])).catch(() => {});
    api.orders.list().then(data => setOrders(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const orderStatuses = orders.map(o => dbStatusToOrderStatus(o.status));
  const pendingCount = orderStatuses.filter(s => s === 'new' || s === 'processing').length;
  const inTransitCount = orderStatuses.filter(s => s === 'shipped').length;
  const deliveredCount = orderStatuses.filter(s => s === 'delivered').length;
  const activeShipments = orders
    .map(o => ({ row: o, status: dbStatusToOrderStatus(o.status) }))
    .filter(({ row, status }) => !!row.trackingNumber && (status === 'ready_to_ship' || status === 'shipped'))
    .slice(0, 10);

  function shipmentBadge(status: string) {
    if (status === 'Delivered') return 'success';
    if (status === 'Out for Delivery') return 'info';
    if (status === 'In Transit') return 'gold';
    return 'default';
  }

  function returnBadge(status: string) {
    const s = status?.toLowerCase();
    if (s === 'approved') return 'success';
    if (s === 'rejected' || s === 'denied') return 'error';
    return 'warning';
  }

  function handleAddRate() {
    setNewRateName('');
    setNewRatePrice('');
    setAddRateVisible(true);
  }

  async function handleSaveRate() {
    const name = newRateName.trim();
    const cents = parseDecimalToCents(newRatePrice);
    if (!name) {
      Alert.alert('Name required', 'Enter a name for this rate.');
      return;
    }
    if (cents == null || cents < 0) {
      Alert.alert('Invalid price', 'Enter a valid price, like 4.99.');
      return;
    }
    try {
      setRatesLoading(true);
      const newRate = await completeSetupTaskAfter(
        'shipping_rates',
        () => api.shippingRates.create({ name, flatRateCents: cents }),
      );
      setShippingRates(prev => [...prev, newRate]);
      setAddRateVisible(false);
    } catch (e: any) {
      Alert.alert('Couldn’t add this rate', 'Check your connection and try again.');
    } finally {
      setRatesLoading(false);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <Header title="Shipping & Fulfillment" onBack={leaveSetupDestination} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'Pending', value: String(pendingCount), color: colors.warning },
          { label: 'In Transit', value: String(inTransitCount), color: colors.primary },
          { label: 'Delivered', value: String(deliveredCount), color: colors.success },
          { label: 'Returns', value: String(sellerReturns.length), color: colors.destructive },
        ].map((s) => (
          <View key={s.label} style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Shipments */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Active Shipments</Text>
      {activeShipments.length === 0 ? (
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.emptySection}>
            <Feather name="truck" size={20} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No active shipments</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Buy a label on an order to start tracking.</Text>
          </View>
        </View>
      ) : activeShipments.map(({ row, status }) => (
        <View key={row.id} style={[styles.shipCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.shipHeader}>
            <View>
              <Text style={[styles.shipId, { color: colors.primary }]}>{row.orderNumber ?? row.id}</Text>
              <Text style={[styles.shipCustomer, { color: colors.foreground }]}>{row.customerName ?? 'Customer'}</Text>
              <Text style={[styles.shipCarrier, { color: colors.mutedForeground }]}>
                {row.carrier ?? 'Carrier'}{row.trackingNumber ? ` · ${row.trackingNumber}` : ''}
              </Text>
            </View>
            <Badge label={shipmentStatusLabel(status)} variant={shipmentBadge(shipmentStatusLabel(status)) as any} />
          </View>
          <View style={[styles.progressBar, { backgroundColor: colors.secondary }]}>
            <View style={[styles.progressFill, {
              width: `${shipmentProgress(status)}%`,
              backgroundColor: shipmentProgress(status) === 100 ? colors.success : colors.primary,
            }]} />
          </View>
          <View style={styles.shipSteps}>
            {['Order', 'Label', 'Pickup', 'Transit', 'Delivered'].map((step, i) => {
              const stepPct = (i / 4) * 100;
              const active = shipmentProgress(status) >= stepPct;
              return (
                <View key={step} style={styles.stepItem}>
                  <View style={[styles.stepDot, { backgroundColor: active ? colors.primary : colors.secondary }]} />
                  <Text style={[styles.stepLabel, { color: active ? colors.primary : colors.mutedForeground }]}>{step}</Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}

      {/* Returns */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Returns & Exchanges</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {sellerReturns.length === 0 ? (
          <View style={styles.emptySection}>
            <Feather name="rotate-ccw" size={20} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No return requests</Text>
          </View>
        ) : (
          sellerReturns.map((r, i) => (
            <View key={r.id} style={[styles.returnRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={styles.returnInfo}>
                <Text style={[styles.returnId, { color: colors.primary }]}>
                  {r.id?.slice(0, 8).toUpperCase()} · Buyer {r.buyer_id?.slice(0, 8) ?? '—'}
                </Text>
                <Text style={[styles.returnItem, { color: colors.foreground }]}>{r.reason ?? '—'}</Text>
                <Text style={[styles.returnReason, { color: colors.mutedForeground }]}>{r.notes ?? ''}</Text>
              </View>
              <Badge label={capitalize(r.status)} variant={returnBadge(r.status) as any} />
            </View>
          ))
        )}
      </View>

      {/* Shipping Rates */}
      <View style={styles.sectionTitleRow}>
        <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Shipping Rates</Text>
        <TouchableOpacity
          onPress={handleAddRate}
          activeOpacity={0.75}
          style={[styles.addRateBtn, { backgroundColor: colors.primary + '18', borderColor: colors.primary }]}
        >
          <Feather name="plus" size={14} color={colors.primary} />
          <Text style={[styles.addRateBtnText, { color: colors.primary }]}>Add Rate</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
        {shippingRates.length === 0 ? (
          <View style={styles.emptySection}>
            <Feather name="truck" size={20} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No shipping rates configured</Text>
          </View>
        ) : (
          shippingRates.map((rate, i) => (
            <View key={rate.id} style={[styles.rateRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={styles.rateInfo}>
                <Text style={[styles.rateName, { color: colors.foreground }]}>{rate.name ?? 'Shipping Rate'}</Text>
                {rate.freeAboveCents != null && (
                  <Text style={[styles.rateSub, { color: colors.mutedForeground }]}>
                    Free above {formatCents(rate.freeAboveCents)}
                  </Text>
                )}
              </View>
              <View style={styles.rateRight}>
                <Text style={[styles.rateAmount, { color: colors.foreground }]}>
                  {formatCents(rate.flatRateCents)}
                </Text>
                <Badge
                  label={rate.active !== false ? 'Active' : 'Inactive'}
                  variant={(rate.active !== false ? 'success' : 'default') as any}
                />
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>

    {addRateVisible && (
      <View style={styles.sheetBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setAddRateVisible(false)} />
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 20 }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Add shipping rate</Text>
          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Name</Text>
          <TextInput
            value={newRateName}
            onChangeText={setNewRateName}
            placeholder="Standard Shipping"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <Text style={[styles.sheetLabel, { color: colors.mutedForeground }]}>Price</Text>
          <TextInput
            value={newRatePrice}
            onChangeText={setNewRatePrice}
            placeholder="$4.99"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="decimal-pad"
            style={[styles.sheetInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          <View style={styles.sheetActions}>
            <TouchableOpacity
              onPress={() => setAddRateVisible(false)}
              style={[styles.sheetBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.sheetBtnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSaveRate}
              disabled={ratesLoading}
              style={[styles.sheetBtn, { backgroundColor: colors.primary, borderColor: colors.primary }]}
            >
              <Text style={[styles.sheetBtnText, { color: colors.primaryForeground }]}>{ratesLoading ? 'Saving…' : 'Save rate'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sheetBackdrop: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', // theme-exempt: modal scrim over the whole screen
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SP.md,
    gap: SP.xs,
  },
  sheetTitle: { fontSize: FS.lg, fontWeight: '700', marginBottom: SP.sm },
  sheetLabel: { fontSize: FS.xs, fontWeight: '500', marginTop: SP.xs },
  sheetInput: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SP.sm,
    paddingVertical: 12,
    fontSize: FS.md,
  },
  sheetActions: { flexDirection: 'row', gap: SP.sm, marginTop: SP.md },
  sheetBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetBtnText: { fontSize: FS.md, fontWeight: '600' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  statsRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  stat: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 3 },
  statVal: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: FS.xs, fontFamily: 'Inter_400Regular' },
  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  action: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 6 },
  actionLabel: { fontSize: FS.xs, fontFamily: 'Inter_500Medium' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0 },
  addRateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  addRateBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  emptySection: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  shipCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10 },
  shipHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  shipId: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  shipCustomer: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  shipCarrier: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  progressBar: { height: 4, borderRadius: 2, overflow: 'hidden', marginBottom: 10 },
  progressFill: { height: '100%', borderRadius: 2 },
  shipSteps: { flexDirection: 'row', justifyContent: 'space-between' },
  stepItem: { alignItems: 'center', gap: 4 },
  stepDot: { width: 8, height: 8, borderRadius: 4 },
  stepLabel: { fontSize: FS.xs, fontFamily: 'Inter_500Medium' },
  returnRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  returnInfo: { flex: 1, gap: 2 },
  returnId: { fontSize: 11, fontFamily: 'Inter_700Bold' },
  returnItem: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  returnReason: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  rateRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  rateInfo: { flex: 1, gap: 2 },
  rateName: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  rateSub: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  rateRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rateAmount: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  warehouseCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10 },
  warehouseHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  warehouseName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  warehouseLoc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  warehouseStock: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  capacityBar: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  capacityFill: { height: '100%', borderRadius: 3 },
  capacityLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
});
