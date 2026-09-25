/**
 * Brandthread — Seller Products Tab: "The Rack"
 *
 * An editorial, lookbook-style catalog: a 2-column (phone) / 3-4 column
 * (iPad) grid of image-forward cards replaces the old plain admin row list.
 * Every action, route and confirmation flow from the previous version is
 * preserved — only the presentation changed.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Share, Modal, Pressable, LayoutAnimation, UIManager, Platform } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT, FS, SP, RADIUS, COMP, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PrimaryButton, SearchBar, FilterChip, PressableScale, useUndoToast } from '@/components/BrandthreadUI';
import { EmptyState, GridSkeleton, useGridColumns, useBreakpoint, useCenteredGridPadding } from '@/components/layout';
import { IconButton } from '@/components/ui/IconButton';
import { hapticPrimaryAction, hapticToggle } from '@/lib/haptics';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ProductCard } from '@/components/products/ProductCard';
import { getProducts, getProductStats, getProduct, archiveProduct, unarchiveProduct, deleteProduct, restoreProduct, duplicateProduct } from '@/services/productService';
import { Product, ProductFilter } from '@/services/productTypes';
import { formatCents } from '@/lib/money';
import { SheetRise } from '@/components/motion/SheetRise';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryClient';
import { prefetchOnPressIn } from '@/lib/prefetch';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
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
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={closeSheet}
    >
      <Pressable style={sh.overlay} onPress={closeSheet} />
      <SheetRise style={sh.sheet}>
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
      </SheetRise>
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
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={sh.overlay} onPress={onClose} />
      <SheetRise style={[sh.sheet, { paddingBottom: SP.xl }]}>
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
      </SheetRise>
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={sh.overlay} onPress={onClose} />
      <SheetRise style={sh.sheet}>
        <View style={sh.handle} />
        <Text style={sh.sheetTitle}>Sort Products</Text>
        {SORT_OPTIONS.map(({ key, label }) => (
          <PressableScale
            key={key}
            style={[sh.sortOption, current === key && sh.sortOptionActive]}
            onPress={() => { hapticToggle(); onSelect(key); onClose(); }}
            accessibilityLabel={label}
            accessibilityState={{ selected: current === key }}
          >
            <Text style={[sh.sortOptionText, current === key && sh.sortOptionTextActive]}>
              {label}
            </Text>
            {current === key && <Feather name="check" size={ICON.sm} color={PURPLE_LIGHT} />}
          </PressableScale>
        ))}
      </SheetRise>
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
  const tabBar = useTabBarMetrics();
  const { width: screenWidth } = useBreakpoint();
  const gridColumns = useGridColumns({ phone: 2, tablet: 3, tabletLandscape: 4 });
  const gridGutter = useCenteredGridPadding();
  const gridGap = SP.sm;
  const contentWidth = Math.min(screenWidth, 1080) - gridGutter * 2;
  const cardWidth = (contentWidth - gridGap * (gridColumns - 1)) / gridColumns;

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
  const [refreshing, setRefreshing] = useState(false);

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

  // Search runs 250 ms after typing stops instead of on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getProducts({ filter, text: debouncedQuery || undefined });
      setProducts(Array.isArray(result) ? result : []);
      await loadStats();
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQuery, loadStats]);

  // useFocusEffect also re-runs while focused whenever loadProducts changes
  // (filter or search), so a separate mount effect would load everything twice.
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

  // Swipe quick-action: archives (or unarchives) without opening the sheet.
  async function handleQuickArchive(product: Product) {
    const wasArchived = product.status === 'archived';
    setProducts(prev => prev.map(p => (p.id === product.id ? { ...p, status: wasArchived ? 'active' : 'archived' } : p)));
    try {
      if (wasArchived) await unarchiveProduct(product.id);
      else await archiveProduct(product.id);
      await loadStats();
    } catch {
      await loadProducts();
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await loadProducts();
    } finally {
      setRefreshing(false);
    }
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

  const openProduct = useCallback((product: Product) => {
    router.push(('/product-detail?id=' + product.id) as never);
  }, [router]);

  const openActionSheet = useCallback((product: Product) => {
    hapticPrimaryAction();
    setActionProduct(product);
    setActionSheetVisible(true);
  }, []);

  const queryClient = useQueryClient();
  const onProductPressIn = useCallback((product: Product) => {
    prefetchOnPressIn(
      queryClient,
      queryKeys.product(product.id),
      () => getProduct(product.id),
      product.media.find(m => m.isCover)?.uri ?? product.media[0]?.uri,
    )();
  }, [queryClient]);

  const renderProduct = useCallback(({ item }: { item: Product }) => (
    <View style={{ paddingHorizontal: gridGap / 2 }}>
      <ProductCard
        product={item}
        width={cardWidth}
        onPress={openProduct}
        onPressIn={onProductPressIn}
        onMore={openActionSheet}
        onQuickArchive={handleQuickArchive}
        onQuickDelete={handleDelete}
      />
    </View>
  ), [openProduct, onProductPressIn, openActionSheet, cardWidth, gridGap]);

  const keyExtractor = useCallback((item: Product) => item.id, []);

  const ListHeader = useMemo(() => (
    <View style={s.groupHeaderRow}>
      <Text style={s.groupCount}>{sortedProducts.length} {sortedProducts.length === 1 ? 'product' : 'products'}</Text>
    </View>
  ), [sortedProducts.length]);

  // Rich, per-filter empty states instead of one generic message.
  const emptyCopy: Record<ProductFilter, { icon: keyof typeof Feather.glyphMap; message: string }> = {
    'all': { icon: 'package', message: 'Your first product starts here. Add media, pricing, variants and inventory.' },
    'active': { icon: 'check-circle', message: 'No active products yet. Publish a draft to see it here.' },
    'draft': { icon: 'edit-2', message: 'No draft products yet. Start one and finish it later.' },
    'scheduled': { icon: 'clock', message: 'Nothing scheduled. Set a publish date on a draft to line it up.' },
    'archived': { icon: 'archive', message: 'No archived products. Archived items are hidden from your storefront.' },
    'pre-order': { icon: 'calendar', message: 'No pre-order products yet.' },
    'pre-made': { icon: 'box', message: 'No pre-made products yet.' },
    'low-stock': { icon: 'alert-triangle', message: 'Nothing running low. You\'re fully stocked.' },
    'out-of-stock': { icon: 'x-circle', message: 'Nothing is out of stock right now.' },
  };

  const ListEmpty = useMemo(() => {
    const copy = emptyCopy[filter] ?? emptyCopy.all;
    return (
      <View style={s.emptyWrap}>
        <EmptyState
          icon={copy.icon}
          message={copy.message}
          actionLabel={filter === 'all' ? 'Create product' : undefined}
          onAction={filter === 'all' ? () => router.push('/add-product' as never) : undefined}
        />
      </View>
    );
  }, [router, filter]);

  return (
    <View style={[s.root, { backgroundColor: palette.background ?? palette.surface ?? SCREEN_BG }]}>
      {/* ── Fixed header ── */}
      <View style={[s.header, { paddingTop: insets.top + SP.sm, backgroundColor: palette.surface ?? BG, borderBottomColor: palette.border ?? BORDER }]}>
        {/* Title row */}
        <View style={s.titleRow}>
          <PressableScale
            style={s.titleBtn}
            onPress={() => {
              hapticPrimaryAction();
              Alert.alert('Product view', 'Choose a view', [
                { text: 'All products', onPress: () => setFilter('all') },
                { text: 'Collections', onPress: () => router.push('/store-collections' as never) },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
            accessibilityLabel="Products, choose a view"
          >
            <Text style={[s.titleText, { color: palette.foreground ?? FG }]}>Products</Text>
            <Feather name="chevron-down" size={ICON.sm} color={MUTED} />
          </PressableScale>
          <View style={s.titleActions}>
            <IconButton
              name="plus"
              variant="plain"
              size={ICON.md}
              color={FG}
              onPress={() => router.push('/add-product' as never)}
              accessibilityLabel="Add product"
            />
            <IconButton
              name="more-horizontal"
              variant="plain"
              size={ICON.md}
              color={FG}
              onPress={() => Alert.alert('Products', 'Choose an action', [
                { text: 'Import products', onPress: () => router.push('/product-import' as never) },
                { text: 'Export products', onPress: () => { void handleExportProducts(); } },
                { text: 'Cancel', style: 'cancel' },
              ])}
              accessibilityLabel="More product actions"
            />
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
          <PressableScale
            style={[s.controlBtn, hasActiveFilter && s.controlBtnActive]}
            onPress={() => { hapticPrimaryAction(); setFilterModalVisible(true); }}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityLabel={hasActiveFilter ? `Filter: ${filter}` : 'Filter products'}
          >
            <Feather name="sliders" size={ICON.xs} color={hasActiveFilter ? PURPLE_LIGHT : MUTED} />
          </PressableScale>
          <PressableScale
            style={s.controlBtn}
            onPress={() => { hapticPrimaryAction(); setSortModalVisible(true); }}
            hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
            accessibilityLabel={`Sort: ${currentSortLabel}`}
          >
            <Feather name="chevrons-down" size={ICON.xs} color={MUTED} />
          </PressableScale>
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
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setFilter(pill.value);
              }}
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

      {/* ── Product grid ── */}
      {loading && sortedProducts.length === 0 ? (
        <View style={[s.listContent, { paddingHorizontal: gridGutter }]}>
          <GridSkeleton columns={gridColumns} cardWidth={cardWidth} rows={3} gap={gridGap} />
        </View>
      ) : (
        <FlashList
          data={sortedProducts}
          keyExtractor={keyExtractor}
          renderItem={renderProduct}
          numColumns={gridColumns}
          key={`cols-${gridColumns}`}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={ListEmpty}
          contentContainerStyle={{ paddingHorizontal: gridGutter - gridGap / 2, paddingBottom: tabBar.occupiedHeight + SP.xl }}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      )}

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
        onApply={(f) => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setFilter(f);
        }}
        onClose={() => setFilterModalVisible(false)}
      />

      {/* Sort modal */}
      <SortModal
        visible={sortModalVisible}
        current={sort}
        onSelect={k => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setSort(k);
        }}
        onClose={() => setSortModalVisible(false)}
      />
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
    minHeight: COMP.minTouchTarget,
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

  // Grid section header ("N products")
  groupHeaderRow: {
    paddingHorizontal: SP.xs,
    paddingBottom: SP.sm,
    paddingTop: SP.sm,
  },
  groupCount: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },

  emptyWrap: {
    paddingHorizontal: SP.md,
  },

  // List / grid
  listContent: {
    paddingBottom: SP.xl,
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
