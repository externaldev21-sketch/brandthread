import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApi } from '@/lib/api';
import { formatCents } from '@/lib/money';
import { isSellerSetupOrigin, SELLER_HOME_ROUTE } from '@/lib/setupNavigation';
import { completeTask } from '@/lib/setupStore';

const SHIPMENTS = [
  { id: 'SH-8821', customer: 'Jordan Lee', carrier: 'UPS', status: 'In Transit', eta: 'Jul 10', progress: 70 },
  { id: 'SH-8820', customer: 'Maya Chen', carrier: 'FedEx', status: 'Out for Delivery', eta: 'Today', progress: 90 },
  { id: 'SH-8819', customer: 'Amir Patel', carrier: 'USPS', status: 'Label Created', eta: 'Jul 12', progress: 15 },
  { id: 'SH-8818', customer: 'Sofia Reyes', carrier: 'DHL', status: 'Delivered', eta: 'Jul 6', progress: 100 },
];

const WAREHOUSES = [
  { name: 'East Coast Hub', location: 'Newark, NJ', stock: 2840, capacity: 85 },
  { name: 'West Coast Hub', location: 'Los Angeles, CA', stock: 1420, capacity: 60 },
];

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
  }, []);

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
    Alert.prompt(
      'Add Shipping Rate',
      'Enter a name for this rate (e.g. "Standard Shipping"):',
      (name) => {
        if (!name?.trim()) return;
        Alert.prompt(
          'Flat Rate (cents)',
          'Enter the flat rate in cents (e.g. 499 for $4.99):',
          async (centsStr) => {
            const cents = parseInt(centsStr ?? '', 10);
            if (isNaN(cents) || cents < 0) {
              Alert.alert('Invalid amount', 'Please enter a valid number of cents.');
              return;
            }
            try {
              setRatesLoading(true);
              const newRate = await api.shippingRates.create({ name: name.trim(), flatRateCents: cents });
               await completeTask('shipping_rates');
              setShippingRates(prev => [...prev, newRate]);
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Could not create shipping rate.');
            } finally {
              setRatesLoading(false);
            }
          },
          'plain-text',
          '499',
        );
      },
      'plain-text',
      'Standard Shipping',
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <View style={[
        styles.header,
        {
          paddingTop: Platform.OS === 'web' ? 67 : insets.top + 8,
          borderBottomColor: colors.border,
        },
      ]}>
        <TouchableOpacity
          onPress={leaveSetupDestination}
          style={[styles.headerBack, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Returns from Shipping & Fulfillment"
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerTitleBlock}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Shipping & Fulfillment</Text>
          <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]}>Labels, carriers & returns</Text>
        </View>
        <View style={styles.headerRightSlot} />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'Pending', value: '8', color: colors.warning },
          { label: 'In Transit', value: '24', color: colors.primary },
          { label: 'Delivered', value: '384', color: colors.success },
          { label: 'Returns', value: String(sellerReturns.length || '6'), color: colors.destructive },
        ].map((s) => (
          <View key={s.label} style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.statVal, { color: s.color }]}>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Quick Actions */}
      <View style={styles.actionsRow}>
        {[
          { label: 'Print Labels', icon: 'printer' as const },
          { label: 'Add Carrier', icon: 'truck' as const },
          { label: 'Returns', icon: 'rotate-ccw' as const },
          { label: 'Pickup', icon: 'map-pin' as const },
        ].map((a) => (
          <TouchableOpacity key={a.label} activeOpacity={0.75} style={[styles.action, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name={a.icon} size={18} color={colors.primary} />
            <Text style={[styles.actionLabel, { color: colors.foreground }]}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Shipments */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Active Shipments</Text>
      {SHIPMENTS.map((s) => (
        <View key={s.id} style={[styles.shipCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.shipHeader}>
            <View>
              <Text style={[styles.shipId, { color: colors.primary }]}>{s.id}</Text>
              <Text style={[styles.shipCustomer, { color: colors.foreground }]}>{s.customer}</Text>
              <Text style={[styles.shipCarrier, { color: colors.mutedForeground }]}>{s.carrier} · ETA {s.eta}</Text>
            </View>
            <Badge label={s.status} variant={shipmentBadge(s.status) as any} />
          </View>
          <View style={[styles.progressBar, { backgroundColor: colors.secondary }]}>
            <View style={[styles.progressFill, {
              width: `${s.progress}%`,
              backgroundColor: s.progress === 100 ? colors.success : colors.primary,
            }]} />
          </View>
          <View style={styles.shipSteps}>
            {['Order', 'Label', 'Pickup', 'Transit', 'Delivered'].map((step, i) => {
              const stepPct = (i / 4) * 100;
              const active = s.progress >= stepPct;
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

      {/* Warehouses */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Fulfillment Locations</Text>
      {WAREHOUSES.map((w) => (
        <View key={w.name} style={[styles.warehouseCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.warehouseHeader}>
            <Feather name="map-pin" size={16} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.warehouseName, { color: colors.foreground }]}>{w.name}</Text>
              <Text style={[styles.warehouseLoc, { color: colors.mutedForeground }]}>{w.location}</Text>
            </View>
            <Text style={[styles.warehouseStock, { color: colors.foreground }]}>{w.stock.toLocaleString()} units</Text>
          </View>
          <View style={[styles.capacityBar, { backgroundColor: colors.secondary }]}>
            <View style={[styles.capacityFill, { width: `${w.capacity}%`, backgroundColor: w.capacity > 80 ? colors.warning : colors.success }]} />
          </View>
          <Text style={[styles.capacityLabel, { color: colors.mutedForeground }]}>Capacity: {w.capacity}% full</Text>
        </View>
      ))}
    </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    minHeight: 88,
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    gap: 8,
  },
  headerBack: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerTitleBlock: { flex: 1 },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  headerSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4 },
  headerRightSlot: { width: 40 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  statsRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  stat: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 3 },
  statVal: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  actionsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  action: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 6 },
  actionLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },
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
  stepLabel: { fontSize: 9, fontFamily: 'Inter_500Medium' },
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
