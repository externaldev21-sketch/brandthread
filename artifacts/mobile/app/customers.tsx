import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet, TextInput, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import { Badge } from '@/components/Badge';
import { useRouter } from 'expo-router';
import { serviceRequest } from '@/lib/serviceConfig';
import { FS } from '@/lib/theme';
import { formatCents } from '@/lib/money';
import { EmptyState } from '@/components/BrandthreadUI';
import { ErrorState } from '@/components/ui/ErrorState';

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


type SortOption = 'recent' | 'spend' | 'name';

const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'spend', label: 'Top spender' },
  { key: 'name', label: 'Name A-Z' },
];

function getInitials(name: string): string {
  return name.split(' ').map((p) => p[0] ?? '').join('').slice(0, 2).toUpperCase();
}

export default function CustomersScreen() {
  const colors = useColors();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const hasDataRef = useRef(false);

  const fetchCustomers = useCallback(async (searchText: string) => {
    try {
      const url = searchText.trim()
        ? `/api/customers?search=${encodeURIComponent(searchText.trim())}`
        : '/api/customers';
      const res = await serviceRequest<ApiCustomer[]>(url);
      if (Array.isArray(res)) {
        setCustomers(res);
        hasDataRef.current = res.length > 0;
        setError(false);
      }
    } catch {
      // Only surface a full ErrorState when there's nothing already on
      // screen — a failed background refresh (e.g. while searching) keeps
      // the last good list visible instead of replacing it with an error.
      setError(!hasDataRef.current);
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

  const totalCustomers = customers.length;
  const avgSpendCents = totalCustomers > 0
    ? Math.round(customers.reduce((sum, c) => sum + (c.totalSpentCents ?? 0), 0) / totalCustomers)
    : 0;

  const sortedCustomers = useMemo(() => {
    const list = [...customers];
    switch (sortBy) {
      case 'spend':
        return list.sort((a, b) => (b.totalSpentCents ?? 0) - (a.totalSpentCents ?? 0));
      case 'name':
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case 'recent':
      default:
        return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  }, [customers, sortBy]);

  return (
    <View style={[styles.container, { backgroundColor: 'transparent' }]}>
      <ScreenHeader
        title="Customers"
        subtitle="Your customer list"
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
          { label: 'Total', value: totalCustomers.toLocaleString(), icon: 'users' as const },
          { label: 'Avg. spend', value: formatCents(avgSpendCents), icon: 'heart' as const },
        ].map((s) => (
          <View key={s.label} style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name={s.icon} size={14} color={colors.primary} />
            <Text style={[styles.statVal, { color: colors.foreground }]}>{s.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
          </View>
        ))}
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

      {/* Sort */}
      <View style={styles.sortRow}>
        {SORT_OPTIONS.map((opt) => {
          const active = sortBy === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              activeOpacity={0.7}
              onPress={() => setSortBy(opt.key)}
              style={[
                styles.segChip,
                {
                  backgroundColor: active ? colors.primary : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.segText, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Customer List */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {loading ? (
          <View style={styles.custRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.custEmail, { color: colors.mutedForeground, marginLeft: 10 }]}>Loading customers...</Text>
          </View>
        ) : error ? (
          <ErrorState
            message="Couldn't load your customers."
            onRetry={() => { setLoading(true); fetchCustomers(search); }}
          />
        ) : sortedCustomers.length === 0 ? (
          <EmptyState
            icon="users"
            title={search.trim() ? 'No matching customers' : 'No customers yet'}
            description={
              search.trim()
                ? 'Try a different name, email or tag.'
                : 'Once someone buys from your store, they will show up here.'
            }
            action={
              search.trim()
                ? undefined
                : { label: 'View your store', onPress: () => router.push('/store-preview' as never), icon: 'external-link' }
            }
            compact
          />
        ) : (
          sortedCustomers.map((c, i) => {
            // Monochrome avatar tint (theme foreground) — no saturated per-user hues,
            // so it reads correctly across all 12 app themes.
            const color = colors.foreground;
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
  statLabel: { fontSize: FS.xs, fontFamily: 'Inter_400Regular' },
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
  sortRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
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
  tagText:   { fontSize: FS.xs, fontFamily: 'Inter_600SemiBold' },
  sectionTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  rewardIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rewardLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  rewardVal: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});
