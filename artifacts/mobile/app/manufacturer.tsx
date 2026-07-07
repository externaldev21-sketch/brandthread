import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';

const MANUFACTURERS = [
  { name: 'Apex Garment Co.', location: 'Guangzhou, CN', moq: 50, rating: 4.9, verified: true, specialty: 'T-shirts, Hoodies' },
  { name: 'EcoThread Factory', location: 'Mumbai, IN', moq: 100, rating: 4.7, verified: true, specialty: 'Sustainable fabrics' },
  { name: 'CraftWear Studio', location: 'Dhaka, BD', moq: 30, rating: 4.5, verified: false, specialty: 'Knitwear, Denim' },
  { name: 'Milano Couture', location: 'Milan, IT', moq: 200, rating: 5.0, verified: true, specialty: 'Luxury, Tailoring' },
];

const ORDERS = [
  { id: 'PO-2041', mfr: 'Apex Garment Co.', items: 400, status: 'In Production', delivery: 'Aug 15', progress: 65 },
  { id: 'PO-2040', mfr: 'EcoThread Factory', items: 150, status: 'QC Review', delivery: 'Jul 28', progress: 88 },
  { id: 'PO-2039', mfr: 'CraftWear Studio', items: 60, status: 'Sampling', delivery: 'Sep 1', progress: 20 },
];

export default function ManufacturerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<'hub' | 'orders'>('hub');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

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

      <Text style={[styles.pageTitle, { color: colors.foreground }]}>Manufacturer Hub</Text>
      <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>Find, connect & manage production partners</Text>

      {/* Tab Toggle */}
      <View style={[styles.tabRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {(['hub', 'orders'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tabBtn, { backgroundColor: tab === t ? colors.primary : 'transparent' }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, { color: tab === t ? colors.primaryForeground : colors.mutedForeground }]}>
              {t === 'hub' ? 'Manufacturer Hub' : 'My Orders'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'hub' ? (
        <>
          {/* Stats */}
          <View style={styles.statsRow}>
            {[
              { label: 'Verified', value: '2,400+' },
              { label: 'Countries', value: '38' },
              { label: 'Avg. MOQ', value: '50 pcs' },
            ].map((s) => (
              <View key={s.label} style={[styles.statChip, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statVal, { color: colors.foreground }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>

          {MANUFACTURERS.map((m) => (
            <TouchableOpacity
              key={m.name}
              activeOpacity={0.8}
              style={[styles.mfCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.mfHeader}>
                <View style={[styles.mfAvatar, { backgroundColor: colors.secondary }]}>
                  <Feather name="tool" size={18} color={colors.mutedForeground} />
                </View>
                <View style={styles.mfInfo}>
                  <View style={styles.mfNameRow}>
                    <Text style={[styles.mfName, { color: colors.foreground }]}>{m.name}</Text>
                    {m.verified && <Feather name="check-circle" size={14} color={colors.success} />}
                  </View>
                  <Text style={[styles.mfLocation, { color: colors.mutedForeground }]}>{m.location}</Text>
                </View>
                <View style={styles.mfRating}>
                  <Feather name="star" size={12} color={colors.primary} />
                  <Text style={[styles.mfRatingText, { color: colors.foreground }]}>{m.rating}</Text>
                </View>
              </View>
              <View style={[styles.mfDivider, { backgroundColor: colors.border }]} />
              <View style={styles.mfFooter}>
                <Text style={[styles.mfSpecialty, { color: colors.mutedForeground }]}>{m.specialty}</Text>
                <Badge label={`MOQ: ${m.moq}`} variant="gold" />
              </View>
              <View style={styles.mfActions}>
                <TouchableOpacity style={[styles.mfBtn, { backgroundColor: colors.secondary }]} activeOpacity={0.7}>
                  <Text style={[styles.mfBtnText, { color: colors.foreground }]}>Request Sample</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.mfBtn, { backgroundColor: colors.primary }]} activeOpacity={0.7}>
                  <Text style={[styles.mfBtnText, { color: colors.primaryForeground }]}>Send RFQ</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          ))}
        </>
      ) : (
        <>
          {ORDERS.map((order) => (
            <View key={order.id} style={[styles.orderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.orderHeader}>
                <View>
                  <Text style={[styles.orderId, { color: colors.primary }]}>{order.id}</Text>
                  <Text style={[styles.orderMfr, { color: colors.foreground }]}>{order.mfr}</Text>
                  <Text style={[styles.orderItems, { color: colors.mutedForeground }]}>{order.items} units · Delivery {order.delivery}</Text>
                </View>
                <Badge label={order.status} variant={order.status === 'QC Review' ? 'warning' : order.status === 'Sampling' ? 'info' : 'gold'} />
              </View>
              <View style={[styles.progressBar, { backgroundColor: colors.secondary }]}>
                <View style={[styles.progressFill, { width: `${order.progress}%`, backgroundColor: colors.primary }]} />
              </View>
              <Text style={[styles.progressLabel, { color: colors.mutedForeground }]}>{order.progress}% complete</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  tabRow: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 3, marginBottom: 20 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statChip: { flex: 1, borderRadius: 12, padding: 12, borderWidth: 1, alignItems: 'center', gap: 3 },
  statVal: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  mfCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  mfHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  mfAvatar: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  mfInfo: { flex: 1 },
  mfNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mfName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  mfLocation: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  mfRating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  mfRatingText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  mfDivider: { height: 1, marginBottom: 12 },
  mfFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  mfSpecialty: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  mfActions: { flexDirection: 'row', gap: 8 },
  mfBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  mfBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  orderCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  orderHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  orderId: { fontSize: 13, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  orderMfr: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  orderItems: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  progressBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 6 },
});
