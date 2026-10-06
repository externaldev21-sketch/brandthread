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
import { showActionSheet } from '@/components/ui/ActionSheet';
import { FlashList } from '@shopify/flash-list';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';
import { SellerListHeader, sellerListCountRowStyles } from '@/components/SellerListHeader';
import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { PrimaryButton, FilterChip, PressableScale, useUndoToast } from '@/components/BrandthreadUI';
import { EmptyState, GridSkeleton, useGridColumns, useBreakpoint, useCenteredGridPadding } from '@/components/layout';
import { useScrollReset } from '@/hooks/useScrollReset';
import { hapticPrimaryAction, hapticToggle } from '@/lib/haptics';
import { useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';
import { ProductCard } from '@/components/products/ProductCard';
import { StockEditorSheet } from '@/components/products/StockEditorSheet';
import { getProducts, getProductStats, getProduct, archiveProduct, unarchiveProduct, deleteProduct, restoreProduct, duplicateProduct, updateProduct, summarizeProducts } from '@/services/productService';
import { localPreviewSaves } from '@/lib/sellerProductPreview';
import { Product, ProductFilter } from '@/services/productTypes';
import { formatCents, parseDecimalToCents } from '@/lib/money';
import { FormInput } from '@/components/BrandthreadUI';
import { SheetRise } from '@/components/motion/SheetRise';
import { isSellerDevPreview } from '@/lib/devPreview';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryClient';
import { prefetchOnPressIn } from '@/lib/prefetch';
import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';
import { SELLER_PRODUCTS_GESTURE } from '@/lib/firstRunTips/content';

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

const EMPTY_STATS: Stats = {
  active: 0,
  draft: 0,
  archived: 0,
  lowStock: 0,
  outOfStock: 0,
  preOrder: 0,
  totalInventoryValueCents: 0,
};

// ─── Action Sheet ─────────────────────────────────────────────────────────────

interface ActionSheetProps {
  product: Product | null;
  visible: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onDelete: (product: Product) => void;
  onQuickEditPrice: (product: Product) => void;
}

function ActionSheet({ product, visible, onClose, onRefresh, onDelete, onQuickEditPrice }: ActionSheetProps) {
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
    { label: 'Quick edit price', icon: 'dollar-sign', onPress: () => { closeSheet(); onQuickEditPrice(p); } },
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

// ─── Quick Edit Price Sheet ──────────────────────────────────────────────────
// Mirrors Depop's "Set discount" sheet (mobbin.com/screens/
// d7f04eb6-64b3-4407-8a85-95b65517b8a7): current price shown read-only above
// a single editable price field and a Save button, opened from the same
// "..." action sheet. Depop's percent-off quick-select chips are dropped —
// that's the separate Discounts feature (item 134), not a duplicate price
// calculator here.

function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

interface QuickEditPriceSheetProps {
  product: Product | null;
  visible: boolean;
  onClose: () => void;
  onSaved: (product: Product, newPriceCents: number, previousPriceCents: number) => void;
}

function QuickEditPriceSheet({ product, visible, onClose, onSaved }: QuickEditPriceSheetProps) {
  const { theme } = useAppTheme();
  const sh = React.useMemo(() => createSheetStyles(theme), [theme]);
  const [priceInput, setPriceInput] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (product) setPriceInput(centsToInput(product.pricing.priceCents));
  }, [product]);

  if (!product) return null;
  const p = product;

  function closeSheet() {
    if (saving) return;
    onClose();
  }

  async function handleSave() {
    const newCents = parseDecimalToCents(priceInput);
    if (newCents === null || newCents <= 0) {
      Alert.alert('Enter a valid price', 'Price must be a positive amount, like 45.00.');
      return;
    }
    const previousCents = p.pricing.priceCents;
    if (newCents === previousCents) {
      closeSheet();
      return;
    }
    setSaving(true);
    try {
      await updateProduct(p.id, { pricing: { ...p.pricing, priceCents: newCents } });
      closeSheet();
      onSaved(p, newCents, previousCents);
    } catch {
      Alert.alert('Could not update price', 'Your product was not updated. Please try again.');
    } finally {
      setSaving(false);
    }
  }

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
        <Text style={sh.sheetTitle} numberOfLines={1}>Edit price · {p.name}</Text>
        <Text style={{ fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted, marginBottom: SP.md }}>
          Current price: {formatCents(p.pricing.priceCents)}
        </Text>
        <FormInput
          label="New price"
          value={priceInput}
          onChange={setPriceInput}
          placeholder="0.00"
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={handleSave}
        />
        <PrimaryButton
          label="Save price"
          onPress={handleSave}
          loading={saving}
          disabled={saving}
          style={{ marginTop: SP.lg }}
        />
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
  const scrollResetRef = useScrollReset<any>(true, false);
  const { theme } = useAppTheme();
  const { isLoaded: authLoaded, isSignedIn, userId } = useAuth();
  const sellerPreview = isSellerDevPreview();
  // Do not treat the dev-web design preview as a real seller session. While
  // Clerk is resolving, keep the screen in its safe, empty preview state.
  const previewOnly = sellerPreview && (!authLoaded || !isSignedIn || !userId);
  const previewOnlyRef = React.useRef(previewOnly);
  previewOnlyRef.current = previewOnly;
  const palette = theme as typeof theme & Record<string, string>;
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const { background: SCREEN_BG, surface: SURFACE, card: CARD, border: BORDER, text: FG, muted: MUTED, subtle: SUBTLE, accent: PURPLE, accentLight: PURPLE_LIGHT } = theme;
  const BG = theme.surface;
  const topInset = useHeaderTopInset();
  const router = useRouter();
  const { showUndo } = useUndoToast();
  const tabBar = useTabBarMetrics();
  const { width: screenWidth } = useBreakpoint();
  const gridColumns = useGridColumns({ phone: 2, tablet: 3, tabletLandscape: 4 });
  const gridGutter = useCenteredGridPadding();
  const gridGap = SP.sm;
  const contentWidth = Math.min(screenWidth, 1080) - gridGutter * 2;
  const cardWidth = (contentWidth - gridGap * (gridColumns - 1)) / gridColumns;

  const params = useLocalSearchParams<{ filter?: ProductFilter }>();
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<ProductFilter>(params.filter ?? 'all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionProduct, setActionProduct] = useState<Product | null>(null);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [quickEditProduct, setQuickEditProduct] = useState<Product | null>(null);
  const [quickEditVisible, setQuickEditVisible] = useState(false);
  const [stockEditProduct, setStockEditProduct] = useState<Product | null>(null);
  const [stockEditVisible, setStockEditVisible] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const showPreviewOnlyFeedback = useCallback(() => {
    Alert.alert('Sign in required', 'Sign in to manage products.');
  }, []);

  const loadStats = useCallback(async () => {
    if (previewOnly || previewOnlyRef.current) {
      // Signed-out preview: counts for the products saved on this device only.
      try {
        setStats(summarizeProducts(localPreviewSaves(await getProducts())));
      } catch {
        setStats(EMPTY_STATS);
      }
      return;
    }
    try {
      const s = await getProductStats();
      if (previewOnlyRef.current) {
        setStats(EMPTY_STATS);
        return;
      }
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
  }, [previewOnly]);

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
      const list = Array.isArray(result) ? result : [];
      // Signed-out preview (no account): list exactly what the seller saved
      // on this device (Add product's local save) — never the seeded demo
      // catalog, never another account's data (the product store is scoped
      // to the signed-out 'anon' slot here).
      setProducts(previewOnly || previewOnlyRef.current ? localPreviewSaves(list) : list);
      await loadStats();
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQuery, loadStats, previewOnly]);

  // Re-apply the ?filter= deep link every time this screen is focused (not
  // just on first mount) — the seller tab bar keeps this screen mounted
  // (e.g. SellerDashboardActionNeeded's "N items low on stock" row), so
  // tapping it a second time needs to re-apply the filter even though
  // Products never unmounted. Same pattern as orders.tsx's own ?filter=.
  useFocusEffect(useCallback(() => {
    const requested = params.filter;
    const valid: ProductFilter[] = ['all', 'active', 'draft', 'scheduled', 'archived', 'pre-order', 'pre-made', 'low-stock', 'out-of-stock'];
    if (requested && valid.includes(requested)) setFilter(requested);
  }, [params.filter]));

  // useFocusEffect also re-runs while focused whenever loadProducts changes
  // (filter or search), so a separate mount effect would load everything twice.
  useFocusEffect(useCallback(() => {
    loadProducts();
  }, [loadProducts]));

  function refresh() { loadProducts(); }

  async function handleDuplicate(id: string) {
    if (previewOnly) {
      showPreviewOnlyFeedback();
      return;
    }
    await duplicateProduct(id);
    Alert.alert('Duplicated', 'Product duplicated as a draft.');
    refresh();
  }

  function handleQuickEditPriceSaved(product: Product, newPriceCents: number, previousPriceCents: number) {
    setProducts(prev => prev.map(p => (p.id === product.id ? { ...p, pricing: { ...p.pricing, priceCents: newPriceCents } } : p)));
    showUndo({
      message: `Price updated to ${formatCents(newPriceCents)}`,
      undo: async () => {
        await updateProduct(product.id, { pricing: { ...product.pricing, priceCents: previousPriceCents } });
        await loadProducts();
      },
    });
  }

  async function handleDelete(product: Product) {
    if (previewOnly) {
      showPreviewOnlyFeedback();
      return;
    }
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
    if (previewOnly) {
      showPreviewOnlyFeedback();
      return;
    }
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
    { label: 'Low Stock', value: 'low-stock' },
    { label: 'Out of Stock', value: 'out-of-stock' },
  ];

  const currentSortLabel = SORT_OPTIONS.find(o => o.key === sort)?.label ?? 'Sort';
  const hasActiveFilter = filter !== 'all';

  // Product detail reads the same device product store, so a signed-out
  // preview's saved product opens there too.
  const openProduct = useCallback((product: Product) => {
    router.push(('/product-detail?id=' + product.id) as never);
  }, [router]);

  const openActionSheet = useCallback((product: Product) => {
    if (previewOnly) {
      showPreviewOnlyFeedback();
      return;
    }
    hapticPrimaryAction();
    setActionProduct(product);
    setActionSheetVisible(true);
  }, [previewOnly, showPreviewOnlyFeedback]);

  const openStockEditor = useCallback((product: Product) => {
    hapticPrimaryAction();
    setStockEditProduct(product);
    setStockEditVisible(true);
  }, []);

  const handleStockChanged = useCallback((updated: Product) => {
    setProducts(prev => prev.map(p => (p.id === updated.id ? updated : p)));
    setStockEditProduct(updated);
    void loadStats();
  }, [loadStats]);

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
        onEditStock={openStockEditor}
      />
    </View>
  ), [openProduct, onProductPressIn, openActionSheet, openStockEditor, cardWidth, gridGap]);

  const keyExtractor = useCallback((item: Product) => item.id, []);

  // No count row on an empty list — the empty state below already says so;
  // showing "0 products" next to it is just clutter with no information.
  const ListHeader = useMemo(() => (
    sortedProducts.length === 0 ? null : (
      <View style={sellerListCountRowStyles.row}>
        <Text style={[sellerListCountRowStyles.text, { color: SUBTLE }]}>{sortedProducts.length} {sortedProducts.length === 1 ? 'product' : 'products'}</Text>
      </View>
    )
  ), [sortedProducts.length, SUBTLE]);

  // Rich, per-filter empty states instead of one generic message.
  const emptyCopy: Record<ProductFilter, { icon: keyof typeof Feather.glyphMap; title?: string; message: string }> = {
    'all': { icon: 'package', title: 'No products yet', message: 'Add your first product to start selling.' },
    'active': { icon: 'check-circle', message: 'No active products yet. Publish a draft to see it here.' },
    'draft': { icon: 'edit-2', message: 'No draft products yet. Start one and finish it later.' },
    'scheduled': { icon: 'clock', message: 'Nothing scheduled. Set a publish date on a draft to line it up.' },
    'archived': { icon: 'archive', message: 'No archived products. Archived items are hidden from your storefront.' },
    'pre-order': { icon: 'calendar', message: 'No pre-order products yet.' },
    'pre-made': { icon: 'box', message: 'No pre-made products yet.' },
    'low-stock': { icon: 'alert-triangle', message: 'Nothing running low. You\'re fully stocked.' },
    'out-of-stock': { icon: 'x-circle', message: 'Nothing is out of stock right now.' },
  };

  // Belt-and-suspenders alongside contentContainerStyle's paddingBottom below:
  // FlashList's web renderer doesn't always honor a large contentContainerStyle
  // bottom padding, letting the last row sit under the floating tab bar — a
  // real DOM footer of that height guarantees the scrollable area actually
  // extends past the bar.
  const ListFooter = useMemo(() => <View style={{ height: tabBar.occupiedHeight }} />, [tabBar.occupiedHeight]);

  const ListEmpty = useMemo(() => {
    const copy = emptyCopy[filter] ?? emptyCopy.all;
    return (
      <View style={s.emptyWrap}>
        <EmptyState
          icon={copy.icon}
          title={copy.title}
          message={copy.message}
          // Every filter's empty state gets a real next step, not just "all".
          actionLabel="Add your first product"
          onAction={() => router.push('/add-product' as never)}
        />
      </View>
    );
  }, [router, filter]);

  return (
    <View style={[s.root, { paddingTop: topInset + 12, backgroundColor: palette.background ?? palette.surface ?? SCREEN_BG }]}>
      {/* ── Fixed header ── */}
      <SellerListHeader
        title="Products"
        titleMenu={[
          { key: 'all', label: 'All products', selected: filter === 'all', onSelect: () => setFilter('all') },
          { key: 'collections', label: 'Collections', selected: false, onSelect: () => router.push('/store-collections' as never) },
        ]}
        titleAccessibilityLabel="Products, choose a view"
        actions={[
          { icon: 'plus', onPress: () => router.push('/add-product' as never), accessibilityLabel: 'Add product' },
          {
            icon: 'more-horizontal',
            onPress: () => showActionSheet('Products', 'Choose an action', [
              { text: 'Import products (CSV)', onPress: () => router.push('/product-import' as never) },
              { text: 'Import from Shopify', onPress: () => router.push('/shopify-import' as never) },
              { text: 'Export products', onPress: () => { void handleExportProducts(); } },
              { text: 'Cancel', style: 'cancel' },
            ]),
            accessibilityLabel: 'More product actions',
          },
        ]}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search products…"
        onFilterPress={() => { hapticPrimaryAction(); setFilterModalVisible(true); }}
        hasActiveFilter={hasActiveFilter}
        filterAccessibilityLabel={hasActiveFilter ? `Filter: ${filter}` : 'Filter products'}
        onSortPress={() => { hapticPrimaryAction(); setSortModalVisible(true); }}
        sortAccessibilityLabel={`Sort: ${currentSortLabel}`}
        chips={filterPills.map(pill => ({
          key: pill.value,
          label: pill.label,
          active: filter === pill.value,
          onPress: () => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setFilter(pill.value);
          },
          count:
            pill.value === 'active' ? stats?.active ?? 0 :
            pill.value === 'draft' ? stats?.draft ?? 0 :
            pill.value === 'archived' ? stats?.archived ?? 0 :
            pill.value === 'low-stock' ? stats?.lowStock ?? 0 :
            pill.value === 'out-of-stock' ? stats?.outOfStock ?? 0 :
            undefined,
        }))}
      />

      {/* ── Product grid ── */}
      {loading && sortedProducts.length === 0 ? (
        <View style={[s.listContent, { paddingHorizontal: gridGutter }]}>
          <GridSkeleton columns={gridColumns} cardWidth={cardWidth} rows={3} gap={gridGap} />
        </View>
      ) : (
        <FlashList
          ref={scrollResetRef}
          data={sortedProducts}
          keyExtractor={keyExtractor}
          renderItem={renderProduct}
          numColumns={gridColumns}
          key={`cols-${gridColumns}`}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={ListFooter}
          ListEmptyComponent={ListEmpty}
          contentContainerStyle={{ paddingHorizontal: gridGutter - gridGap / 2, paddingBottom: tabBar.occupiedHeight + SP.xl }}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      )}

      {/* Action sheet */}
      <ActionSheet
        product={previewOnly ? null : actionProduct}
        visible={actionSheetVisible}
        onClose={() => setActionSheetVisible(false)}
        onRefresh={refresh}
        onDelete={handleDelete}
        onQuickEditPrice={(product) => {
          setQuickEditProduct(product);
          setQuickEditVisible(true);
        }}
      />

      {/* Quick edit price sheet */}
      <QuickEditPriceSheet
        product={quickEditProduct}
        visible={quickEditVisible}
        onClose={() => setQuickEditVisible(false)}
        onSaved={handleQuickEditPriceSaved}
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

      {/* Quick stock editor — tapping a card's stock chip/label opens this. */}
      <StockEditorSheet
        product={stockEditProduct}
        visible={stockEditVisible}
        onClose={() => setStockEditVisible(false)}
        onChanged={handleStockChanged}
      />
      <FirstRunTip
        id="seller-products"
        variant="gesture"
        contentReady={!loading}
        gesture={SELLER_PRODUCTS_GESTURE}
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
