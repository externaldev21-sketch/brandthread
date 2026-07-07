import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';

const SHIPMENTS = [
  { id: 'SH-8821', customer: 'Jordan Lee', carrier: 'UPS', status: 'In Transit', eta: 'Jul 10', progress: 70 },
  { id: 'SH-8820', customer: 'Maya Chen', carrier: 'FedEx', status: 'Out for Delivery', eta: 'Today', progress: 90 },
  { id: 'SH-8819', customer: 'Amir Patel', carrier: 'USPS', status: 'Label Created', eta: 'Jul 12', progress: 15 },
  { id: 'SH-8818', customer: 'Sofia Reyes', carrier: 'DHL', status: 'Delivered', eta: 'Jul 6', progress: 100 },
];

const RETURNS = [
  { id: 'RET-441', customer: 'T. Morrison', item: 'Hoodie – Black XL', reason: 'Wrong size', status: 'Pending' },
  { id: 'RET-440', customer: 'K. Wang', item: 'Classic Tee – White M', reason: 'Defect', status: 'Approved' },
];

const WAREHOUSES = [
  { name: 'East Coast Hub', location: 'Newark, NJ', stock: 2840, capacity: 85 },
  { name: 'West Coast Hub', location: 'Los Angeles, CA', stock: 1420, capacity: 60 },
];

export default function ShippingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  function shipmentBadge(status: string) {
    if (status === 'Delivered') return 'success';
    if (status === 'Out for Delivery') return 'info';
    if (status === 'In Transit') return 'gold';
    return 'default';
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={{ paddingTop: topPad + 8, paddingBottom: 100, paddingHorizontal: 16 }}
      showsVerticalScrollIndicator={false}
    >
      <TouchableOpacity onPress={() => router.back()} style={styles.back} activeOpacity={0.7}>
        <Feather name="arrow-left" size={20} color={colors.foreground} />
        <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
      </TouchableOpacity>

      <Text style={[styles.pageTitle, { color: colors.foreground }]}>Shipping & Fulfillment</Text>
      <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>Labels, carriers & returns</Text>

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'Pending', value: '8', color: colors.warning },
          { label: 'In Transit', value: '24', color: colors.primary },
          { label: 'Delivered', value: '384', color: colors.success },
          { label: 'Returns', value: '6', color: colors.destructive },
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
        {RETURNS.map((r, i) => (
          <View key={r.id} style={[styles.returnRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={styles.returnInfo}>
              <Text style={[styles.returnId, { color: colors.primary }]}>{r.id} · {r.customer}</Text>
              <Text style={[styles.returnItem, { color: colors.foreground }]}>{r.item}</Text>
              <Text style={[styles.returnReason, { color: colors.mutedForeground }]}>{r.reason}</Text>
            </View>
            <Badge label={r.status} variant={r.status === 'Approved' ? 'success' : 'warning'} />
          </View>
        ))}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
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
  warehouseCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 10 },
  warehouseHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  warehouseName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  warehouseLoc: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  warehouseStock: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  capacityBar: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  capacityFill: { height: '100%', borderRadius: 3 },
  capacityLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
});
