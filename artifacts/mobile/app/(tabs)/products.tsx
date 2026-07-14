import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  BG, SURFACE, CARD, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM,
  ORANGE, ORANGE_DIM, RED, RED_DIM,
  GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, COMP, ICON,
} from '@/lib/theme';
import {
  BrandthreadScreen, BrandthreadCard, GradientCard,
  PrimaryButton, SecondaryButton, IconButton,
  SearchBar, FilterChip, StatusBadge,
  EmptyState, SectionHeader, StatCard, GuidedTip,
} from '@/components/BrandthreadUI';
import { DEMO_PRODUCTS } from '@/services/data';

// ─── Category gradient map ────────────────────────────────────────────────────
function categoryGradient(category: string): [string, string] {
  const cat = category.toLowerCase();
  if (cat === 'tops' || cat.includes('shirt') || cat.includes('tee')) return ['#8B5CF6', '#22D3EE'];
  if (cat.includes('bottom') || cat.includes('pant')) return ['#3B82F6', '#22D3EE'];
  if (cat.includes('outer') || cat.includes('jacket')) return ['#F59E0B', '#F97316'];
  if (cat.includes('accessory') || cat.includes('accessories')) return ['#F59E0B', '#F97316'];
  if (cat.includes('footwear') || cat.includes('shoe')) return ['#3B82F6', '#22D3EE'];
  return ['#8B5CF6', '#3B82F6'];
}

// ─── Filter chip labels ───────────────────────────────────────────────────────
const FILTER_OPTIONS = ['All', 'Active', 'Draft', 'Pre-order', 'Low Stock'] as const;
type FilterOption = typeof FILTER_OPTIONS[number];

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ProductsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterOption>('All');

  // ─── Summary counts ─────────────────────────────────────────────────────────
  const activeCount   = useMemo(() => DEMO_PRODUCTS.filter(p => p.status === 'active').length, []);
  const draftCount    = useMemo(() => DEMO_PRODUCTS.filter(p => p.status === 'draft').length, []);
  const lowStockCount = useMemo(() => DEMO_PRODUCTS.filter(p => p.totalInventory > 0 && p.totalInventory <= p.lowStockThreshold).length, []);
  const preOrderCount = useMemo(() => DEMO_PRODUCTS.filter(p => p.status === 'pre-order').length, []);

  // ─── Filtered list ──────────────────────────────────────────────────────────
  const filteredProducts = useMemo(() => {
    let list = [...DEMO_PRODUCTS];

    if (activeFilter === 'Active')    list = list.filter(p => p.status === 'active');
    if (activeFilter === 'Draft')     list = list.filter(p => p.status === 'draft');
    if (activeFilter === 'Pre-order') list = list.filter(p => p.status === 'pre-order');
    if (activeFilter === 'Low Stock') list = list.filter(p => p.totalInventory > 0 && p.totalInventory <= p.lowStockThreshold);

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.productType.toLowerCase().includes(q)
      );
    }

    return list;
  }, [activeFilter, search]);

  function handleAddProduct() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Add Product', 'Coming soon');
  }

  function handleProductPress() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Product', 'Detail coming soon');
  }

  function handleMorePress(productName: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(productName, 'Choose an action', [
      { text: 'Edit',           onPress: () => {} },
      { text: 'Duplicate',      onPress: () => {} },
      { text: 'Create Content', onPress: () => {} },
      { text: 'Archive',        style: 'destructive', onPress: () => {} },
      { text: 'Cancel',         style: 'cancel' },
    ]);
  }

  return (
    <BrandthreadScreen noSafeTop>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.scrollContent, { paddingBottom: COMP.tabBarH + SP.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Header ── */}
        <View style={[s.header, { paddingTop: insets.top + 8 }]}>
          <Text style={s.headerTitle}>Products</Text>
          <IconButton
            name="plus"
            onPress={handleAddProduct}
            color={FG}
          />
        </View>

        {/* ── Guided Tip ── */}
        <GuidedTip
          id="products-tip"
          text="Products you create here can be tagged in Seller posts on the Thread."
          dismissedIds={[]}
          onDismiss={() => {}}
          style={s.tip}
        />

        {/* ── Summary Stat Cards ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.statsRow}
          style={s.statsScroll}
        >
          <StatCard
            label="Active"
            value={String(activeCount)}
            icon="check-circle"
            accent={SUCCESS}
            style={s.statCard}
          />
          <StatCard
            label="Draft"
            value={String(draftCount)}
            icon="edit"
            accent={ORANGE}
            style={s.statCard}
          />
          <StatCard
            label="Low Stock"
            value={String(lowStockCount)}
            icon="alert-triangle"
            accent={RED}
            style={s.statCard}
          />
          <StatCard
            label="Pre-order"
            value={String(preOrderCount)}
            icon="clock"
            accent={BLUE}
            style={s.statCard}
          />
        </ScrollView>

        {/* ── Search Bar ── */}
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search products…"
          style={s.search}
        />

        {/* ── Filter Chips ── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.filtersRow}
          style={s.filtersScroll}
        >
          {FILTER_OPTIONS.map(opt => (
            <FilterChip
              key={opt}
              label={opt}
              active={activeFilter === opt}
              onPress={() => setActiveFilter(opt)}
            />
          ))}
        </ScrollView>

        {/* ── Product List ── */}
        <View style={s.listContainer}>
          {filteredProducts.length === 0 ? (
            <EmptyState
              icon="package"
              title="Your first product starts here."
              description="Add details, pricing, media and inventory."
              action={{
                label: 'Create product',
                icon: 'plus',
                onPress: handleAddProduct,
              }}
              style={s.emptyState}
            />
          ) : (
            filteredProducts.map(product => {
              const isLowStock = product.totalInventory > 0 && product.totalInventory <= product.lowStockThreshold;
              const isPreOrder = product.status === 'pre-order';
              const isOutOfStock = product.totalInventory === 0 && !isPreOrder;
              const initial = product.name.charAt(0).toUpperCase();
              const gradColors = categoryGradient(product.category);

              let statusVariant: 'success' | 'warning' | 'neutral' | 'info' | 'purple' = 'neutral';
              let statusLabel = 'Draft';
              if (product.status === 'active')    { statusVariant = 'success'; statusLabel = 'Active'; }
              if (product.status === 'draft')      { statusVariant = 'warning'; statusLabel = 'Draft'; }
              if (product.status === 'archived')   { statusVariant = 'neutral'; statusLabel = 'Archived'; }
              if (product.status === 'pre-order')  { statusVariant = 'info';    statusLabel = 'Pre-order'; }

              let inventoryColor = SUCCESS;
              let inventoryText = `${product.totalInventory} in stock`;
              if (isLowStock)    { inventoryColor = RED;    inventoryText = 'Low stock'; }
              if (isOutOfStock)  { inventoryColor = MUTED;  inventoryText = 'Out of stock'; }
              if (isPreOrder)    { inventoryColor = BLUE;   inventoryText = 'Pre-order'; }

              return (
                <BrandthreadCard
                  key={product.id}
                  style={s.productCard}
                  onPress={handleProductPress}
                >
                  <View style={s.productRow}>
                    {/* Left: gradient avatar */}
                    <LinearGradient
                      colors={gradColors}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={s.productAvatar}
                    >
                      <Text style={s.productInitial}>{initial}</Text>
                    </LinearGradient>

                    {/* Center: info */}
                    <View style={s.productInfo}>
                      {/* Name + status badge */}
                      <View style={s.productNameRow}>
                        <Text style={s.productName} numberOfLines={1}>{product.name}</Text>
                        <StatusBadge label={statusLabel} variant={statusVariant} small />
                      </View>

                      {/* Category */}
                      <Text style={s.productCategory}>{product.category} · {product.productType}</Text>

                      {/* Price row */}
                      <View style={s.priceRow}>
                        <Text style={s.price}>${product.price.toFixed(2)}</Text>
                        {product.compareAtPrice != null && (
                          <Text style={s.comparePrice}>${product.compareAtPrice.toFixed(2)}</Text>
                        )}
                      </View>

                      {/* Inventory status */}
                      <Text style={[s.inventoryText, { color: inventoryColor }]}>
                        {inventoryText}
                      </Text>
                    </View>

                    {/* Far right: more button */}
                    <TouchableOpacity
                      onPress={() => handleMorePress(product.name)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={s.moreBtn}
                    >
                      <Feather name="more-horizontal" size={ICON.md} color={MUTED} />
                    </TouchableOpacity>
                  </View>
                </BrandthreadCard>
              );
            })
          )}
        </View>
      </ScrollView>
    </BrandthreadScreen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  scrollContent: {
    gap: 0,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  headerTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },

  // Guided tip
  tip: {
    marginTop: SP.sm,
    marginBottom: SP.sm,
  },

  // Stats
  statsScroll: {
    flexGrow: 0,
    marginBottom: SP.sm,
  },
  statsRow: {
    flexDirection: 'row',
    gap: SP.sm,
    paddingHorizontal: SP.md,
  },
  statCard: {
    minWidth: 100,
  },

  // Search
  search: {
    marginHorizontal: SP.md,
    marginBottom: SP.sm,
  },

  // Filters
  filtersScroll: {
    flexGrow: 0,
    marginBottom: SP.md,
  },
  filtersRow: {
    flexDirection: 'row',
    gap: SP.sm,
    paddingHorizontal: SP.md,
  },

  // Product list
  listContainer: {
    paddingHorizontal: SP.md,
    gap: 10,
  },
  productCard: {
    marginBottom: 10,
    padding: SP.md,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },

  // Avatar
  productAvatar: {
    width: 64,
    height: 64,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  productInitial: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },

  // Info
  productInfo: {
    flex: 1,
    gap: 3,
    marginLeft: SP.xs,
  },
  productNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP.sm,
  },
  productName: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    flex: 1,
  },
  productCategory: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    marginTop: 1,
  },
  price: {
    fontSize: FS.sm,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
  },
  comparePrice: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    textDecorationLine: 'line-through',
  },
  inventoryText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },

  // More button
  moreBtn: {
    padding: SP.xs,
    alignSelf: 'center',
  },

  // Empty
  emptyState: {
    marginTop: SP.xl,
  },
});
