import React, { useState, useEffect, useCallback } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';
import { serviceRequest } from '@/lib/serviceConfig';

const SEGMENTS = ['All', 'VIP', 'Returning', 'At-Risk'] as const;
type Segment = typeof SEGMENTS[number];

type ApiCustomer = {
  id: string;
  ownerId: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  tags?: string[];
  notes?: string;
  orderCount?: number;
  totalSpentCents?: number;
  createdAt: string;
};

const AVATAR_COLORS = ['#0F766E', '#4A6FA5', '#22D3EE', '#B98A2E', '#EF4444', '#0EA5E9', '#F59E0B', '#1D4ED8'];

function getInitials(name: string): string {
  return name.split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
}

function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}


export default function CustomersScreen() {
  const colors = useColors();
  const router = useRouter();
  const [segment, setSegment] = useState<Segment>('All');
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCustomers = useCallback(async (searchText: string) => {
    try {
      const url = searchText.trim()
        ? `/api/customers?search=${encodeURIComponent(searchText.trim())}`
        : '/api/customers';
      const res = await serviceRequest<ApiCustomer[]>(url);
      if (Array.isArray(res)) setCustomers(res);
    } catch {
      // silently keep existing data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCustomers('');
  }, [fetchCustomers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim()) fetchCustomers(search);
      else fetchCustomers('');
    }, 400);
    return () => clearTimeout(timer);
  }, [search, fetchCustomers]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader
        title="Customers"
        subtitle="CRM, loyalty & rewards"
        rightElement={
          <TouchableOpacity
            onPress={() => router.push('/(tabs)/analytics' as never)}
            hitSlop={10}
            activeOpacity={0.7}
            style={[styles.analyticsBtnHdr, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Feather name="bar-chart-2" size={18} color={colors.foreground} />
          </TouchableOpacity>
        }
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >

      {/* Stats */}
      <View style={styles.statsRow}>
        {[
          { label: 'Total', value: '1,240', icon: 'users' as const },
          { label: 'VIP', value: '84', icon: 'star' as const },
          { label: 'CLV', value: '$480', icon: 'heart' as const },
          { label: 'Retention', value: '42%', icon: 'refresh-cw' as const },
        ].map((s) => (
          <View key={s.label} style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name={s.icon} size={14} color={colors.primary} />
            <Text style={[styles.statVal, { color: colors.foreground }]}>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Loyalty Card */}
      <View style={[styles.loyaltyCard, { backgroundColor: colors.card, borderColor: colors.primary }]}>
        <View style={styles.loyaltyLeft}>
          <Feather name="star" size={20} color={colors.primary} />
          <View>
            <Text style={[styles.loyaltyTitle, { color: colors.foreground }]}>Loyalty Program</Text>
            <Text style={[styles.loyaltySub, { color: colors.mutedForeground }]}>840 customers enrolled · $3.2k rewards issued</Text>
          </View>
        </View>
        <TouchableOpacity style={[styles.loyaltyBtn, { backgroundColor: colors.primary }]} activeOpacity={0.8}>
          <Text style={[styles.loyaltyBtnText, { color: colors.primaryForeground }]}>Manage</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Search customers..."
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Segments */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.segments} contentContainerStyle={{ gap: 8 }}>
        {SEGMENTS.map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => setSegment(s)}
            activeOpacity={0.7}
            style={[styles.segChip, { backgroundColor: segment === s ? colors.primary : colors.card, borderColor: segment === s ? colors.primary : colors.border }]}
          >
            <Text style={[styles.segText, { color: segment === s ? colors.primaryForeground : colors.mutedForeground }]}>{s}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Customer List */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {loading ? (
          <View style={styles.custRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.custEmail, { color: colors.mutedForeground, marginLeft: 10 }]}>Loading customers...</Text>
          </View>
        ) : customers.length === 0 ? (
          <View style={styles.custRow}>
            <Text style={[styles.custEmail, { color: colors.mutedForeground }]}>No customers found.</Text>
          </View>
        ) : (
          customers.map((c, i) => {
            const color = getAvatarColor(c.id);
            const initials = getInitials(c.name);
            return (
              <TouchableOpacity
                key={c.id}
                activeOpacity={0.8}
                style={[styles.custRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                onPress={() => router.push(`/customer-orders?customerId=${c.id}` as never)}
              >
                <View style={[styles.avatar, { backgroundColor: color + '33' }]}>
                  <Text style={[styles.avatarText, { color }]}>{initials}</Text>
                </View>
                <View style={styles.custInfo}>
                  <Text style={[styles.custName, { color: colors.foreground }]}>{c.name}</Text>
                  <Text style={[styles.custEmail, { color: colors.mutedForeground }]}>{c.email}</Text>
                  {c.phone ? (
                    <Text style={[styles.custOrders, { color: colors.mutedForeground }]}>{c.phone}</Text>
                  ) : null}
                  {c.tags && c.tags.length > 0 && (
                    <View style={styles.tagsRow}>
                      {c.tags.slice(0, 3).map((tag) => (
                        <View key={tag} style={[styles.tagChip, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}>
                          <Text style={[styles.tagText, { color: colors.primary }]}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
                <View style={styles.custRight}>
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {/* Wishlists & Gift Cards */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Rewards & Gifts</Text>
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          { label: 'Active Wishlists', value: '312', icon: 'heart' as const },
          { label: 'Gift Cards Issued', value: '$4,800', icon: 'gift' as const },
          { label: 'Points Redeemed', value: '18,400 pts', icon: 'award' as const },
          { label: 'Referrals Active', value: '124', icon: 'share-2' as const },
        ].map((r, i) => (
          <View key={r.label} style={[styles.rewardRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
            <View style={[styles.rewardIcon, { backgroundColor: colors.secondary }]}>
              <Feather name={r.icon} size={15} color={colors.primary} />
            </View>
            <Text style={[styles.rewardLabel, { color: colors.foreground }]}>{r.label}</Text>
            <Text style={[styles.rewardVal, { color: colors.mutedForeground }]}>{r.value}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
      <AIBrainFAB context={{ screen: 'customers' as const }} bottomOffset={0} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  backText: { fontSize: 15, fontFamily: 'Inter_500Medium' },
  pageTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  pageSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 20 },
  statsRow: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  stat: { flex: 1, borderRadius: 12, padding: 10, borderWidth: 1, alignItems: 'center', gap: 3 },
  statVal: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  analyticsBtnHdr: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  loyaltyCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 16 },
  loyaltyLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  loyaltyTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  loyaltySub: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  loyaltyBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  loyaltyBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  segments: { marginBottom: 16 },
  segChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  segText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  section: { borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  custRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  custInfo: { flex: 1, gap: 2 },
  custName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  custEmail: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  custOrders: { fontSize: 11, fontFamily: 'Inter_400Regular' },
  custRight: { alignItems: 'flex-end', justifyContent: 'center' },
  tagsRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tagChip:   { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  tagText:   { fontSize: 9, fontFamily: 'Inter_600SemiBold' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  rewardIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rewardLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  rewardVal: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});
