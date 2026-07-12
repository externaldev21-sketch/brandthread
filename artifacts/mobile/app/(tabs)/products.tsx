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
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const FILTERS = ['All', 'Active', 'Draft', 'Archived'] as const;
type Filter = typeof FILTERS[number];
type Status = 'Active' | 'Draft' | 'Archived';

const PRODUCTS: { name: string; variants: number; status: Status; color: string }[] = [
  { name: '"Runner Tee" Dark Grey',    variants: 5, status: 'Active', color: '#5C5C5C' },
  { name: '"Runner Tight Shorts"',      variants: 5, status: 'Active', color: '#2A2A2A' },
  { name: '"Runner Hoodie" Black',      variants: 5, status: 'Active', color: '#17140F' },
  { name: '"i miss you" tee',           variants: 6, status: 'Active', color: '#B8AD8F' },
  { name: '"perception" thermal',       variants: 5, status: 'Active', color: '#8A7C63' },
  { name: '"faceless" tank',            variants: 5, status: 'Active', color: '#4A4638' },
  { name: '"nothing" tee',              variants: 6, status: 'Active', color: '#2A2A2A' },
  { name: '"i miss you" tee',           variants: 6, status: 'Active', color: '#B8AD8F' },
  { name: '"nostalgia" tee',            variants: 6, status: 'Active', color: '#C7BFA8' },
  { name: '"vacant" hoodie',            variants: 4, status: 'Draft',  color: '#3A3A3A' },
  { name: '"echo" longsleeve',          variants: 3, status: 'Archived', color: '#5C5248' },
];

const statusKind: Record<Status, 'success' | 'warning' | 'default'> = {
  Active: 'success',
  Draft: 'warning',
  Archived: 'default',
};

export default function ProductsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('All');
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState(PRODUCTS);
  const [reordering, setReordering] = useState(false);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : 0;

  const filtered = reordering
    ? products
    : products.filter((p) => {
        if (filter !== 'All' && p.status !== filter) return false;
        if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      });

  function haptic() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  function moveItem(index: number, direction: -1 | 1) {
    const next = [...products];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= next.length) return;
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setProducts(next);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Dark header */}
      <View style={[styles.header, { paddingTop: topPad + 12, backgroundColor: '#17140F' }]}>
        <TouchableOpacity style={styles.titleRow} activeOpacity={0.7} onPress={haptic}>
          <Text style={styles.title}>Products</Text>
          <Feather name="chevron-down" size={18} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerIconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={() => { haptic(); router.push('/product-editor'); }}
          >
            <Feather name="plus" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconBtn}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={haptic}
          >
            <Feather name="more-horizontal" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.sheet, { backgroundColor: colors.background }]}>
        {/* Search + sort/filter */}
        <View style={styles.toolRow}>
          <View style={[styles.searchWrap, { backgroundColor: colors.secondary }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: colors.foreground }]}
              placeholder="Search"
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
          <TouchableOpacity
            style={[styles.toolBtn, { backgroundColor: reordering ? colors.primary : colors.secondary }]}
            activeOpacity={0.7}
            onPress={() => { haptic(); setReordering(r => !r); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {reordering
              ? <Feather name="check" size={16} color={reordering ? colors.background : colors.foreground} />
              : <>
                  <Feather name="arrow-up" size={16} color={colors.foreground} style={{ marginBottom: -6 }} />
                  <Feather name="arrow-down" size={16} color={colors.foreground} />
                </>
            }
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toolBtn, { backgroundColor: colors.secondary }]}
            activeOpacity={0.7}
            onPress={haptic}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="sliders" size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersRow}
          contentContainerStyle={styles.filtersContent}
        >
          {FILTERS.map((f) => (
            <TouchableOpacity
              key={f}
              onPress={() => { haptic(); setFilter(f); }}
              activeOpacity={0.7}
              style={[
                styles.filterChip,
                {
                  backgroundColor: filter === f ? colors.foreground : 'transparent',
                  borderColor: filter === f ? colors.foreground : colors.border,
                },
              ]}
            >
              <Text
                style={[styles.filterText, { color: filter === f ? colors.background : colors.mutedForeground }]}
                numberOfLines={1}
              >
                {f}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Product list */}
        <ScrollView
          contentContainerStyle={{ paddingBottom: bottomPad + 130 }}
          showsVerticalScrollIndicator={false}
        >
          {filtered.map((product, i) => {
            // In reorder mode, i is the index in `products` (since filtered === products)
            const productIndex = reordering ? i : products.indexOf(product);
            return (
              <View
                key={`${product.name}-${i}`}
                style={[
                  styles.row,
                  i < filtered.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                ]}
              >
                {reordering && (
                  <View style={styles.reorderBtns}>
                    <TouchableOpacity
                      onPress={() => moveItem(productIndex, -1)}
                      hitSlop={6}
                      disabled={productIndex === 0}
                      activeOpacity={0.6}
                    >
                      <Feather name="chevron-up" size={18} color={productIndex === 0 ? colors.border : colors.foreground} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => moveItem(productIndex, 1)}
                      hitSlop={6}
                      disabled={productIndex === products.length - 1}
                      activeOpacity={0.6}
                    >
                      <Feather name="chevron-down" size={18} color={productIndex === products.length - 1 ? colors.border : colors.foreground} />
                    </TouchableOpacity>
                  </View>
                )}
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={haptic}
                  style={{ flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 }}
                >
                  <View style={[styles.thumb, { backgroundColor: product.color }]} />
                  <View style={styles.rowInfo}>
                    <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>{product.name}</Text>
                    <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>{product.variants} variants</Text>
                  </View>
                  {!reordering && (
                    <View
                      style={[
                        styles.statusPill,
                        {
                          backgroundColor:
                            statusKind[product.status] === 'success' ? `${colors.success}22`
                              : statusKind[product.status] === 'warning' ? `${colors.warning}22`
                              : colors.secondary,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusText,
                          {
                            color:
                              statusKind[product.status] === 'success' ? colors.success
                                : statusKind[product.status] === 'warning' ? colors.warning
                                : colors.mutedForeground,
                          },
                        ]}
                      >
                        {product.status}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            );
          })}
          {filtered.length === 0 && (
            <View style={styles.emptyState}>
              <Feather name="package" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No products found</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  title: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: -0.5 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  headerIconBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  sheet: {
    flex: 1,
    marginTop: -24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  searchWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, gap: 10 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  toolBtn: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  filtersRow: { marginBottom: 16, flexGrow: 0 },
  filtersContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  filterChip: {
    flexShrink: 0,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  reorderBtns: { alignItems: 'center', justifyContent: 'center', gap: 2, paddingRight: 4 },
  thumb: { width: 44, height: 44, borderRadius: 8 },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowSub: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 },
  emptyText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});
