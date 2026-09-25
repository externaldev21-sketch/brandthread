/**
 * Brandthread — Seller Products Tab
 * Shopify-pattern layout: persistent search row, status pills, divider-separated rows.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Share, Modal, Pressable, TouchableOpacity } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FONT, FS, SP, RADIUS, COMP, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { AnimatedEntrance, BrandthreadCard, PrimaryButton, IconButton, SearchBar, FilterChip, StatusBadge, EmptyState, ProductGridSkeleton, PressableScale, useUndoToast } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { getProducts, getProductStats, getProduct, archiveProduct, unarchiveProduct, deleteProduct, restoreProduct, duplicateProduct } from '@/services/productService';
import { Product, ProductFilter } from '@/services/productTypes';
import { formatCents, integerPercent } from '@/lib/money';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryClient';
import { prefetchOnPressIn } from '@/lib/prefetch';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCategoryColors(category: string, theme: any): readonly [string, string] {
  if (category === 'T-shirt' || category === 'Sweatshirt') return [theme.accent, theme.secondary];
  if (category === 'Hoodie' || category === 'Sweatpants') return [theme.secondary, theme.accentLight];
  if (category === 'Jacket' || category === 'Shorts') return [theme.accentLight, theme.secondaryDim];
  if (category === 'Denim' || category === 'Dress' || category === 'Skirt') return [theme.accentDim, theme.accent];
  return [theme.accent, theme.secondary];
}

function statusVariant(status: string): 'success' | 'warning' | 'purple' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'draft') return 'warning';
  if (status === 'scheduled') return 'purple';
  return 'neutral';
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface Stats {
  active: number;
  draft: number;
  archived: number;
  lowStock: number;
  outOfStock: number;
  preOrder: number;
  totalInventoryValueCents: number;
}

// ─── Product Row ─────────────────────────────────────────────────────────────

interface ProductRowProps {
  product: Product;
  onPress: () => void;
  onPressIn?: () => void;
  onMore: () => void;
  isLast: boolean;
}

function ProductRow({ product, onPress, onPressIn, onMore, isLast }: ProductRowProps) {
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const { error: RED, warning: ORANGE, success: SUCCESS, card: CARD, border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE } = theme;
  const palette = theme as typeof theme & Record<string, string>;
  const coverUri = product.media.find(m => m.isCover)?.uri ?? product.media[0]?.uri;
  const gradColors = getCategoryColors(product.category, theme);

  const stock = product.inventory.totalStock;
  const threshold = product.inventory.lowStockThreshold;
  const stockColor = stock === 0 ? theme.error : stock <= threshold ? theme.warning : theme.success;
  const stockLabel = stock === 0 ? 'Out of stock' : `${stock} in stock`;

  const price = product.pricing.priceCents;
  const compare = product.pricing.compareAtPriceCents;
  const discountPct = compare && compare > price
    ? integerPercent(compare - price, compare)
    : null;

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.82}
        onPress={onPress}
        onPressIn={onPressIn}
        style={[s.productRow, { backgroundColor: palette.card ?? CARD, borderColor: palette.border ?? BORDER }]}
        accessibilityLabel={`${product.name}, ${statusLabel(product.status)}, ${formatCents(price)}`}
      >
        {/* Square thumbnail */}
        <View style={s.rowThumb}>
          {coverUri ? (
            <CachedImage source={{ uri: coverUri }} style={s.rowThumbImg} contentFit="cover" />
          ) : (
            <LinearGradient colors={gradColors} style={s.rowThumbImg} />
          )}
        </View>

        {/* Content */}
        <View style={s.rowContent}>
          <View style={s.rowTopLine}>
            <Text style={[s.rowName, { color: palette.foreground ?? FG }]} numberOfLines={1}>{product.name}</Text>
            <StatusBadge label={statusLabel(product.status)} variant={statusVariant(product.status)} small />
          </View>

          <View style={s.rowMeta}>
            <Text style={[s.rowMetaText, { color: palette.muted ?? MUTED }]} numberOfLines={1}>
              {product.category}
              {product.variants.length > 0 ? ` · ${product.variants.length} variant${product.variants.length !== 1 ? 's' : ''}` : ''}
            </Text>
          </View>

          <View style={s.rowPriceLine}>
            <Text style={[s.rowPrice, { color: palette.foreground ?? FG }]}>{formatCents(price)}</Text>
            {compare && compare > price && (
              <Text style={s.rowCompare}>{formatCents(compare)}</Text>
            )}
            {discountPct !== null && (
              <Text style={s.rowDiscount}>-{discountPct}%</Text>
            )}
            <Text style={[s.rowStock, { color: stockColor }]}>{stockLabel}</Text>
          </View>
        </View>

        {/* More button */}
        <TouchableOpacity
          style={s.rowMoreBtn}
          onPress={e => { e.stopPropagation(); onMore(); }}
          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
          accessibilityLabel={`More actions for ${product.name}`}
        >
          <Feather name="more-horizontal" size={ICON.sm} color={palette.subtle ?? SUBTLE} />
        </TouchableOpacity>
      </TouchableOpacity>
      {!isLast && <View style={s.rowDivider} />}
    </>
  );
}

// ─── Action Sheet ─────────────────────────────────────────────────────────────

interface ActionSheetProps {
  product: Product | null;
  visible: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onDelete: (product: Product) => void;
}

function ActionSheet({ product, visible, onClose, onRefresh, onDelete }: ActionSheetProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const sh = React.useMemo(() => createSheetStyles(theme), [theme]);
  const { muted: MUTED, subtle: SUBTLE } = theme;
  if (!product) return null;

  const p = product as Product;
  const isArchived = p.status === 'archived';

  function closeSheet() { onClose(); }

  async function handleArchive() {
    closeSheet();
    await archiveProduct(p.id);
    onRefresh();
  }

  async function handleUnarchive() {
    closeSheet();
    await unarchiveProduct(p.id);
    onRefresh();
  }

  async function handleDelete() {
    closeSheet();
    onDelete(p);
  }

  async function handleDuplicate() {
    closeSheet();
    await duplicateProduct(p.id);
    Alert.alert('Duplicated', `"${p.name}" was duplicated as a draft.`);
    onRefresh();
  }

  async function handleShare() {
    closeSheet();
    await Share.share({ message: p.name + ' on Brandthread' });
  }

  interface ActionItem {
    label: string;
    icon: keyof typeof Feather.glyphMap;
    accent?: string;
    onPress: () => void;
  }

  const actions: ActionItem[] = [
    { label: 'Edit', icon: 'edit-2', onPress: () => { closeSheet(); router.push(('/product-detail?id=' + p.id) as never); } },
    { label: 'View store page', icon: 'eye', onPress: () => { closeSheet(); router.push(('/product-store?id=' + p.id) as never); } },
    { label: 'Create content', icon: 'video', onPress: () => { closeSheet(); router.push(('/create-post?productId=' + p.id) as never); } },
    { label: 'Tag in post', icon: 'tag', onPress: () => { router.push(('/create-post?productId=' + p.id) as never); closeSheet(); } },
    { label: 'Duplicate', icon: 'copy', onPress: handleDuplicate },
    { label: 'Share', icon: 'share', onPress: handleShare },
    {
      label: 'Send to manufacturer', icon: 'tool', accent: theme.warning,
      onPress: () => { closeSheet(); router.push(('/manufacturer-hub?productId=' + p.id) as never); },
    },
    { label: 'View analytics', icon: 'bar-chart-2', onPress: () => { closeSheet(); router.push(('/product-detail?id=' + p.id + '&tab=analytics') as never); } },
    isArchived
      ? { label: 'Unarchive', icon: 'rotate-ccw', onPress: handleUnarchive }
      : { label: 'Archive', icon: 'archive', onPress: handleArchive },
    { label: 'Delete', icon: 'trash-2', accent: theme.error, onPress: handleDelete },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={closeSheet}
    >
      <Pressable style={sh.overlay} onPress={closeSheet} />
      <View style={sh.sheet}>
        <View style={sh.handle} />
        <Text style={sh.sheetTitle} numberOfLines={1}>{p.name}</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
          {actions.map((item, idx) => (
            <PressableScale key={idx} style={sh.actionItem} onPress={item.onPress} accessibilityLabel={`${item.label}, ${p.name}`}>
              <View style={[sh.actionIcon, { backgroundColor: (item.accent ?? theme.accent) + '18' }]}>
                <Feather name={item.icon} size={ICON.sm} color={item.accent ?? MUTED} />
              </View>
              <Text style={[sh.actionLabel, item.accent ? { color: item.accent } : {}]}>{item.label}</Text>
              <Feather name="chevron-right" size={ICON.sm} color={SUBTLE} />
            </PressableScale>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Filter Modal ─────────────────────────────────────────────────────────────

interface FilterModalProps {
  visible: boolean;
  current: ProductFilter;
  onApply: (f: ProductFilter) => void;
  onClose: () => void;
}

function FilterModal({ visible, current, onApply, onClose }: FilterModalProps) {
  const { theme } = useAppTheme();
  const sh = React.useMemo(() => createSheetStyles(theme), [theme]);
  const PURPLE_LIGHT = theme.accentLight;
  const [selected, setSelected] = useState<ProductFilter>(current);

  useEffect(() => { setSelected(current); }, [current, visible]);

  const staticChips: { label: string; value: ProductFilter }[] = [
    { label: 'All',          value: 'all' },
    { label: 'Active',       value: 'active' },
    { label: 'Draft',        value: 'draft' },
    { label: 'Scheduled',    value: 'scheduled' },
    { label: 'Archived',     value: 'archived' },
    { label: 'Pre-order',    value: 'pre-order' },
    { label: 'Pre-made',     value: 'pre-made' },
    { label: 'Low Stock',    value: 'low-stock' },
    { label: 'Out of Stock', value: 'out-of-stock' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={sh.overlay} onPress={onClose} />
      <View style={[sh.sheet, { paddingBottom: SP.xl }]}>
        <View style={sh.handle} />
        <Text style={sh.sheetTitle}>Filter Products</Text>
        <View style={fm.chips}>
          {staticChips.map(chip => (
            <FilterChip
              key={chip.value}
              label={chip.label}
              active={selected === chip.value}
              onPress={() => setSelected(chip.value)}
            />
          ))}
        </View>
        <PrimaryButton
          label="Apply"
          onPress={() => { onApply(selected); onClose(); }}
          style={{ marginTop: SP.md, marginHorizontal: SP.md }}
        />
      </View>
    </Modal>
  );
}

// ─── Sort Modal ───────────────────────────────────────────────────────────────

type SortKey = 'name' | 'price_asc' | 'price_desc' | 'newest' | 'oldest' | 'sales';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'name', label: 'Name A-Z' },
  { key: 'price_asc', label: 'Price: low to high' },
  { key: 'price_desc', label: 'Price: high to low' },
  { key: 'sales', label: 'Best selling' },
];

function SortModal({
  visible, current, onSelect, onClose,
}: {
  visible: boolean;
  current: SortKey;
  onSelect: (k: SortKey) => void;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const sh = React.useMemo(() => createSheetStyles(theme), [theme]);
  const PURPLE_LIGHT = theme.accentLight;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={sh.overlay} onPress={onClose} />
      <View style={sh.sheet}>
        <View style={sh.handle} />
        <Text style={sh.sheetTitle}>Sort Products</Text>
        {SORT_OPTIONS.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[sh.sortOption, current === key && sh.sortOptionActive]}
            onPress={() => { Haptics.selectionAsync(); onSelect(key); onClose(); }}
            activeOpacity={0.8}
          >
            <Text style={[sh.sortOptionText, current === key && sh.sortOptionTextActive]}>
              {label}
            </Text>
            {current === key && <Feather name="check" size={ICON.sm} color={PURPLE_LIGHT} />}
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ProductsScreen() {
  const { theme } = useAppTheme();
  const palette = theme as typeof theme & Record<string, string>;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const { background: SCREEN_BG, surface: SURFACE, card: CARD, border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE, accent: PURPLE, accentLight: PURPLE_LIGHT } = theme;
  const BG = theme.surface;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showUndo } = useUndoToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionProduct, setActionProduct] = useState<Product | null>(null);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const s = await getProductStats();
      setStats({
        active: s.active,
        draft: s.draft,
        archived: s.archived,
        lowStock: s.lowStock,
        outOfStock: s.outOfStock,
        preOrder: s.preOrder,
        totalInventoryValueCents: s.totalInventoryValueCents,
      });
    } catch { /* use defaults */ }
  }, []);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getProducts({ filter, text: searchQuery || undefined });
      setProducts(Array.isArray(result) ? result : []);
      await loadStats();
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [filter, searchQuery, loadStats]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  useFocusEffect(useCallback(() => {
    loadProducts();
  }, [loadProducts]));

  function refresh() { loadProducts(); }

  async function handleDuplicate(id: string) {
    await duplicateProduct(id);
    Alert.alert('Duplicated', 'Product duplicated as a draft.');
    refresh();
  }

  async function handleDelete(product: Product) {
    Alert.alert(
      'Delete product?',
      'You can undo this for a short time.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setProducts(prev => prev.filter(p => p.id !== product.id));
            try {
              await deleteProduct(product.id);
              showUndo({
                message: `"${product.name}" deleted`,
                undo: async () => {
                  await restoreProduct(product.id);
                  await loadProducts();
                },
              });
            } catch {
              await loadProducts();
              Alert.alert('Could not delete product', 'Your product was not deleted. Please try again.');
            }
          },
        },
      ]
    );
  }

  function openActionSheet(product: Product) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionProduct(product);
    setActionSheetVisible(true);
  }

  async function handleExportProducts() {
    const escapeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = products.map(product => [
      product.name,
      product.status,
      product.variants.length,
      formatCents(product.pricing.priceCents),
      product.inventory.totalStock,
    ].map(escapeCsv).join(','));
    const csv = [
      'Product,Status,Variants,Price,Inventory',
      ...rows,
    ].join('\n');
    await Share.share({ title: 'Products Export', message: csv });
  }

  // Sorted products
  const sortedProducts = useMemo(() => {
    const arr = [...products];
    switch (sort) {
      case 'name': return arr.sort((a, b) => a.name.localeCompare(b.name));
      case 'price_asc': return arr.sort((a, b) => a.pricing.priceCents - b.pricing.priceCents);
      case 'price_desc': return arr.sort((a, b) => b.pricing.priceCents - a.pricing.priceCents);
      case 'oldest': return arr.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      case 'sales': return arr.sort((a, b) => b.totalSales - a.totalSales);
      case 'newest':
      default: return arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  }, [products, sort]);

  // Status filter pills
  const filterPills: { label: string; value: ProductFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Draft', value: 'draft' },
    { label: 'Archived', value: 'archived' },
  ];

  const currentSortLabel = SORT_OPTIONS.find(o => o.key === sort)?.label ?? 'Sort';
  const hasActiveFilter = filter !== 'all';

  const queryClient = useQueryClient();
  const renderProduct = useCallback(({ item, index }: { item: Product; index: number }) => (
    <ProductRow
      product={item}
      onPress={() => router.push(('/product-detail?id=' + item.id) as never)}
      onPressIn={prefetchOnPressIn(
        queryClient,
        queryKeys.product(item.id),
        () => getProduct(item.id),
        item.media.find(m => m.isCover)?.uri ?? item.media[0]?.uri,
      )}
      onMore={() => openActionSheet(item)}
      isLast={index === sortedProducts.length - 1}
    />
  ), [router, sortedProducts.length, queryClient]);

  const keyExtractor = useCallback((item: Product) => item.id, []);

  const ListHeader = useMemo(() => (
    <View>
      {/* Products group container */}
      <View style={s.groupContainer}>
        {/* Group header */}
        <View style={s.groupHeader}>
          <Text style={s.groupCount}>{sortedProducts.length} {sortedProducts.length === 1 ? 'product' : 'products'}</Text>
        </View>
      </View>
    </View>
  ), [sortedProducts.length]);

  const ListEmpty = useMemo(() => (
    <View style={s.groupContainer}>
      <EmptyState
        icon="package"
        title="Your first product starts here."
        description="Add product details, media, pricing, variants and inventory."
        action={{ label: 'Create product', icon: 'plus', onPress: () => router.push('/add-product' as never) }}
      />
    </View>
  ), [router]);

  return (
    <View style={[s.root, { backgroundColor: palette.background ?? palette.surface ?? SCREEN_BG }]}>
      {/* ── Fixed header ── */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm, backgroundColor: palette.surface ?? BG, borderBottomColor: palette.border ?? BORDER }]}>
        {/* Title row */}
        <View style={s.titleRow}>
          <TouchableOpacity
            style={s.titleBtn}
            onPress={() => Alert.alert('Product view', 'Choose a view', [
              { text: 'All products', onPress: () => setFilter('all') },
              { text: 'Collections', onPress: () => router.push('/store-collections' as never) },
              { text: 'Cancel', style: 'cancel' },
            ])}
            activeOpacity={0.7}
          >
            <Text style={[s.titleText, { color: palette.foreground ?? FG }]}>Products</Text>
            <Feather name="chevron-down" size={18} color={MUTED} />
          </TouchableOpacity>
          <View style={s.titleActions}>
            <TouchableOpacity
              style={s.headerIconBtn}
              onPress={() => router.push('/add-product' as never)}
              accessibilityLabel="Add product"
            >
              <Feather name="plus" size={ICON.md} color={FG} />
            </TouchableOpacity>
            <TouchableOpacity
              style={s.headerIconBtn}
              onPress={() => Alert.alert('Products', 'Choose an action', [
                { text: 'Import products', onPress: () => router.push('/product-import' as never) },
                { text: 'Export products', onPress: () => { void handleExportProducts(); } },
                { text: 'Cancel', style: 'cancel' },
              ])}
              accessibilityLabel="More product actions"
            >
              <Feather name="more-horizontal" size={ICON.md} color={FG} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Persistent search row */}
        <View style={s.searchRow}>
          <View style={s.searchBox}>
            <SearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search products…"
              style={s.searchInput}
            />
          </View>
          <TouchableOpacity
            style={[s.controlBtn, hasActiveFilter && s.controlBtnActive]}
            onPress={() => setFilterModalVisible(true)}
            accessibilityLabel={hasActiveFilter ? `Filter: ${filter}` : 'Filter products'}
          >
            <Feather name="sliders" size={14} color={hasActiveFilter ? PURPLE_LIGHT : MUTED} />
          </TouchableOpacity>
          <TouchableOpacity
            style={s.controlBtn}
            onPress={() => setSortModalVisible(true)}
            accessibilityLabel={`Sort: ${currentSortLabel}`}
          >
            <Feather name="chevrons-down" size={14} color={MUTED} />
          </TouchableOpacity>
        </View>

        {/* Status pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.pillsRow}
        >
          {filterPills.map(pill => (
            <FilterChip
              key={pill.value}
              label={pill.label}
              active={filter === pill.value}
              onPress={() => setFilter(pill.value)}
              count={
                pill.value === 'active' ? stats?.active ?? 0 :
                pill.value === 'draft' ? stats?.draft ?? 0 :
                pill.value === 'archived' ? stats?.archived ?? 0 :
                undefined
              }
            />
          ))}
        </ScrollView>
      </View>

      {/* ── Product list ── */}
      <FlashList
        data={sortedProducts}
        keyExtractor={keyExtractor}
        renderItem={renderProduct}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={loading ? null : ListEmpty}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
      />

      {/* Action sheet */}
      <ActionSheet
        product={actionProduct}
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        onRefresh={refresh}
        onDelete={handleDelete}
      />

      {/* Filter modal */}
      <FilterModal
        visible={filterModalVisible}
        current={filter}
        onApply={(f) => setFilter(f)}
        onClose={() => setFilterModalVisible(false)}
      />

      {/* Sort modal */}
      <SortModal
        visible={sortModalVisible}
        current={sort}
        onSelect={k => setSort(k)}
        onClose={() => setSortModalVisible(false)}
      />


      {loading && (
        <View style={s.loadingOverlay} pointerEvents="none">
          <ProductGridSkeleton />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const createStyles = (theme: any) => {
  const SCREEN_BG = theme.background, BG = theme.surface, CARD = theme.card, BORDER = theme.border;
  const BORDER_ACTIVE = theme.accent, FG = theme.text, MUTED = theme.muted, SUBTLE = theme.subtle;
  const PURPLE_DIM = theme.accentDim, PURPLE_LIGHT = theme.accentLight, RED = theme.error;
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },

  // Header
  header: {
    backgroundColor: BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    minHeight: 44,
  },
  titleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  titleText: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  titleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  headerIconBtn: {
    width: COMP.iconBtn,
    height: COMP.iconBtn,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Search row
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: SP.sm,
    height: 36,
  },
  searchInput: {
    flex: 1,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    height: 36,
  },
  controlBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
  },
  controlBtnActive: {
    borderColor: BORDER_ACTIVE,
    backgroundColor: PURPLE_DIM,
  },

  // Status pills row
  pillsRow: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    paddingTop: 2,
    gap: SP.xs,
  },

  // Group container (card background for list)
  groupContainer: {
    marginHorizontal: SP.md,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
    marginBottom: SP.sm,
  },
  groupHeader: {
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  groupCount: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },

  // Product row
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    minHeight: 72,
    backgroundColor: CARD,
  },
  rowThumb: {
    width: 52,
    height: 52,
    borderRadius: RADIUS.xs,
    overflow: 'hidden',
    flexShrink: 0,
  },
  rowThumbImg: {
    width: 52,
    height: 52,
  },
  rowContent: {
    flex: 1,
    paddingHorizontal: SP.sm,
    gap: 2,
  },
  rowTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP.xs,
  },
  rowName: {
    flex: 1,
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
    letterSpacing: -0.1,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowMetaText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  rowPriceLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
    flexWrap: 'wrap',
  },
  rowPrice: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: FG,
  },
  rowCompare: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    textDecorationLine: 'line-through',
  },
  rowDiscount: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: RED,
  },
  rowStock: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
  },
  rowMoreBtn: {
    width: COMP.minTouchTarget,
    height: COMP.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginLeft: 52 + SP.md + SP.md, // align with content start after thumb
  },

  // List
  listContent: {
    paddingBottom: COMP.tabBarH + SP.xl,
  },

  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    top: 120,
    backgroundColor: SCREEN_BG,
    zIndex: 10,
  },
  });
};

const createSheetStyles = (theme: any) => {
  const SURFACE = theme.surface, BORDER = theme.border, FG = theme.text, MUTED = theme.muted;
  const PURPLE_LIGHT = theme.accentLight;
  return StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: SURFACE,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    paddingTop: SP.sm,
    paddingBottom: SP.xxl,
    paddingHorizontal: SP.md,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: RADIUS.pill,
    backgroundColor: BORDER,
    alignSelf: 'center',
    marginBottom: SP.md,
  },
  sheetTitle: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
    marginBottom: SP.md,
    letterSpacing: -0.2,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    flex: 1,
    fontSize: FS.base,
    fontFamily: FONT.medium,
    color: FG,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  sortOptionActive: {},
  sortOptionText: {
    fontSize: FS.base,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  sortOptionTextActive: {
    color: PURPLE_LIGHT,
    fontFamily: FONT.semibold,
  },
  });
};

const fm = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
    paddingHorizontal: SP.xs,
    marginBottom: SP.sm,
  },
});
