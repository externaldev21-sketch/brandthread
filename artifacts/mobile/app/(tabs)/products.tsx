import React, { useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SectionHeader } from '@/components/SectionHeader';
import { ProductCard } from '@/components/ProductCard';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const FILTERS = ['All', 'Active', 'Draft', 'Archived'] as const;
type Filter = typeof FILTERS[number];

const PRODUCTS = [
  { name: 'Classic Thread Tee', category: 'T-Shirts', price: '$42.00', stock: 124, color: '#C9A96E' },
  { name: 'Cargo Shorts', category: 'Bottoms', price: '$68.00', stock: 3, color: '#5C8A5C' },
  { name: 'Oversized Hoodie', category: 'Outerwear', price: '$115.00', stock: 0, color: '#2A2A5A' },
  { name: 'Wide-Leg Trousers', category: 'Bottoms', price: '$98.00', stock: 47, color: '#8A6A5C' },
  { name: 'Logo Cap', category: 'Accessories', price: '$36.00', stock: 88, color: '#2A5A4A' },
  { name: 'Canvas Tote Bag', category: 'Accessories', price: '$28.00', stock: 7, color: '#5A2A2A' },
  { name: 'Drop-Shoulder Blazer', category: 'Outerwear', price: '$185.00', stock: 22, color: '#1A1A3A' },
  { name: 'Ribbed Tank Top', category: 'T-Shirts', price: '$34.00', stock: 65, color: '#6A5C5C' },
];

export default function ProductsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('All');
  const [search, setSearch] = useState('');

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  const filtered = PRODUCTS.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingTop: topPad + 16, paddingBottom: bottomPad + 120, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: colors.foreground }]}>Products</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{PRODUCTS.length} items · 847 total variants</Text>
          </View>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={20} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search products..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} activeOpacity={0.7}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filters */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersRow} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => setFilter(f)}
              activeOpacity={0.7}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === f ? colors.primary : colors.card,
                  borderColor: filter === f ? colors.primary : colors.border,
                },
              ]}
            >
              <Text style={[styles.filterText, { color: filter === f ? colors.primaryForeground : colors.mutedForeground }]}>
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* AI Studio Card */}
        <TouchableOpacity
          onPress={() => router.push('/ai-studio')}
          activeOpacity={0.8}
          style={[styles.studioCard, { borderColor: '#C9A96E44' }]}
        >
          <View style={styles.studioLeft}>
            <View style={[styles.studioIcon, { backgroundColor: '#C9A96E22' }]}>
              <Feather name="zap" size={20} color={colors.primary} />
            </View>
            <View>
              <Text style={[styles.studioTitle, { color: colors.foreground }]}>AI Design Studio</Text>
              <Text style={[styles.studioSub, { color: colors.mutedForeground }]}>Generate mockups & photography</Text>
            </View>
          </View>
          <Feather name="arrow-right" size={18} color={colors.primary} />
        </TouchableOpacity>

        {/* Product List */}
        <SectionHeader title={`${filter} Products`} />
        {filtered.map((product) => (
          <ProductCard
            key={product.name}
            name={product.name}
            category={product.category}
            price={product.price}
            stock={product.stock}
            colorDot={product.color}
          />
        ))}

        {/* Inventory Overview */}
        <SectionHeader title="Inventory Overview" />
        <View style={[styles.invGrid, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { label: 'Total SKUs', value: '2,840', icon: 'tag' as const },
            { label: 'Low Stock', value: '14', icon: 'alert-triangle' as const },
            { label: 'Out of Stock', value: '3', icon: 'x-circle' as const },
            { label: 'Inventory Value', value: '$84k', icon: 'dollar-sign' as const },
          ].map((item, i) => (
            <View key={item.label} style={[styles.invItem, i % 2 === 0 && { borderRightWidth: 1, borderRightColor: colors.border }]}>
              <Feather name={item.icon} size={16} color={colors.primary} />
              <Text style={[styles.invValue, { color: colors.foreground }]}>{item.value}</Text>
              <Text style={[styles.invLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  addBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, padding: 12, gap: 10, borderWidth: 1, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  filtersRow: { marginBottom: 20 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  studioCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1A1500', borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 24 },
  studioLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  studioIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  studioTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  studioSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  invGrid: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 14, borderWidth: 1, marginBottom: 24 },
  invItem: { width: '50%', padding: 16, gap: 4, borderBottomWidth: 1 },
  invValue: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  invLabel: { fontSize: 12, fontFamily: 'Inter_400Regular' },
});
