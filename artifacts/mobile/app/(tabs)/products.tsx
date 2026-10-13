import { openPullDownMenu } from '@/lib/contextMenu';

/**
 * Brandthread — Seller Products Tab: "The Rack"
 *
 * An editorial, lookbook-style catalog: a 2-column (phone) / 3-4 column
 * (iPad) grid of image-forward cards replaces the old plain admin row list.
 * Every action, route and confirmation flow from the previous version is
 * preserved — only the presentation changed.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePersistedChoice } from '@/hooks/usePersistedChoice';

import { View, Text, ScrollView, StyleSheet, Alert, Share, Modal, Pressable, LayoutAnimation, UIManager, Platform } from 'react-native';

import { showActionSheet } from '@/components/ui/ActionSheet';

import { FlashList } from '@shopify/flash-list';

import { Icon, type IconName } from '@/components/ui/Icon';

import { useRouter, useFocusEffect, useLocalSearchParams } from 'expo-router';

import { useHeaderTopInset } from '@/hooks/useHeaderTopInset';

import { SellerListHeader, sellerListCountRowStyles } from '@/components/SellerListHeader';

import { FONT, FS, SP, RADIUS, ICON } from '@/lib/theme';

import { useAppTheme } from '@/contexts/AppThemeContext';

import { PrimaryButton, FilterChip, PressableScale, useUndoToast, FormInput } from '@/components/BrandthreadUI';

import { EmptyState, GridSkeleton, useGridColumns, useBreakpoint, useCenteredGridPadding } from '@/components/layout';

import { useScrollReset } from '@/hooks/useScrollReset';

import { haptics, haptic } from '@/lib/haptics';

import { useTabBarClearance, useTabBarMetrics } from '@/components/buyer-nav/buyerTabBarMetrics';



import { ProductCard } from '@/components/products/ProductCard';
import { ProductRow } from '@/components/products/ProductRow';
import { loadProductsViewMode, saveProductsViewMode, DEFAULT_PRODUCTS_VIEW_MODE, type ProductsViewMode } from '@/lib/productsViewMode';
import { StockEditorSheet } from '@/components/products/StockEditorSheet';

import { getProducts, getProductStats, getProduct, archiveProduct, unarchiveProduct, deleteProduct, restoreProduct, duplicateProduct, updateProduct, summarizeProducts } from '@/services/productService';

import { localPreviewSaves } from '@/lib/sellerProductPreview';

import { Product, ProductFilter } from '@/services/productTypes';

import { formatCents, parseDecimalToCents } from '@/lib/money';


import { SheetRise } from '@/components/motion/SheetRise';

import { isPreviewDemoMode, isSellerDevPreview } from '@/lib/devPreview';

import { useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/lib/queryClient';

import { prefetchOnPressIn } from '@/lib/prefetch';

import { FirstRunTip } from '@/components/first-run-tips/FirstRunTip';

import { DEFAULT_PRODUCT_SORT, PRODUCT_SORT_OPTIONS, productSortLabel, productSortQuery, type ProductSortKey } from '@/lib/sellerLists/productSort';

import { productEmptyCopy } from '@/lib/sellerLists/emptyCopy';

import { SELLER_PRODUCTS_GESTURE } from '@/lib/firstRunTips/content';

import { useApi } from '@/lib/api';

import { setPendingMockup, takePendingMockup, attachMockupToListedProduct } from '@/lib/mockupProductHandoff';

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

function getPreviewProductStats(products: readonly Product[]): Stats {
  return {
    active: products.filter((product) => product.status === 'active').length,
    draft: products.filter((product) => product.status === 'draft').length,
    archived: products.filter((product) => product.status === 'archived').length,
    lowStock: products.filter((product) =>
      product.inventory.totalStock > 0 && product.inventory.totalStock <= product.inventory.lowStockThreshold,
    ).length,
    outOfStock: products.filter((product) =>
      product.inventory.totalStock === 0 && product.inventory.policy === 'deny' && product.status === 'active',
    ).length,
    preOrder: products.filter((product) => product.salesModel === 'pre-order' || product.salesModel === 'both').length,
    totalInventoryValueCents: products.reduce(
      (sum, product) => sum + (product.pricing.costCents ?? 0) * product.inventory.totalStock,
      0,
    ),
  };
}

function matchesPreviewProductFilter(product: Product, filter: ProductFilter): boolean {
  switch (filter) {
    case 'active': return product.status === 'active';
    case 'draft': return product.status === 'draft';
    case 'scheduled': return product.status === 'scheduled';
    case 'archived': return product.status === 'archived';
    case 'pre-order': return product.salesModel === 'pre-order' || product.salesModel === 'both';
    case 'pre-made': return product.salesModel === 'pre-made' || product.salesModel === 'both';
    case 'low-stock': return product.inventory.totalStock > 0 && product.inventory.totalStock <= product.inventory.lowStockThreshold;
    case 'out-of-stock': return product.inventory.totalStock === 0 && product.inventory.policy === 'deny';
    default: return true;
  }
}

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
  // Pairings and video live on the server; only server-backed products (UUID ids) have them.
  const canManageFit = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(p.id) || p.id.startsWith('preview-product-');

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
    icon: IconName;
    accent?: string;
    onPress: () => void;
  }

  const actions: ActionItem[] = [
    { label: 'Edit', icon: 'edit-2', onPress: () => { closeSheet(); router.push(('/product-detail?id=' + p.id) as never); } },
    { label: 'Quick edit price', icon: 'dollar-sign', onPress: () => { closeSheet(); onQuickEditPrice(p); } },
    { label: 'Variants & stock', icon: 'layers', onPress: () => { closeSheet(); router.push(('/product-variants?productId=' + p.id) as never); } },
    { label: 'View store page', icon: 'eye', onPress: () => { closeSheet(); router.push(('/product-store?id=' + p.id) as never); } },
    { label: 'Create content', icon: 'video', onPress: () => { closeSheet(); router.push(('/create-post?productId=' + p.id) as never); } },
    { label: 'Tag in post', icon: 'tag', onPress: () => { router.push(('/create-post?productId=' + p.id) as never); closeSheet(); } },
    { label: 'Search listing (SEO)', icon: 'search', onPress: () => { closeSheet(); router.push(('/product-seo?productId=' + p.id) as never); } },
    { label: 'Details and colour photos', icon: 'info', onPress: () => { closeSheet(); router.push(('/product-page-details?productId=' + p.id) as never); } },
    { label: 'Duplicate', icon: 'copy', onPress: handleDuplicate },
    ...(canManageFit ? [
      { label: 'Complete the fit', icon: 'layers' as const, onPress: () => { closeSheet(); router.push(('/product-pairings?productId=' + p.id) as never); } },
      { label: 'Product video', icon: 'film' as const, onPress: () => { closeSheet(); router.push(('/product-video?productId=' + p.id) as never); } },
      { label: 'Make this a mystery box', icon: 'gift' as const, onPress: () => { closeSheet(); router.push(('/mystery-box-edit?productId=' + p.id) as never); } },
    ] : []),
    { label: 'Schedule launch', icon: 'clock', onPress: () => { closeSheet(); router.push(('/product-launches?productId=' + p.id) as never); } },
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
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={sh.overlay} onPress={closeSheet} />
      <SheetRise style={sh.sheet}>
        <View style={sh.handle} />
        <Text style={sh.sheetTitle} numberOfLines={1}>{p.name}</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
          {actions.map((item, idx) => (
            <PressableScale key={idx} style={sh.actionItem} onPress={item.onPress} accessibilityLabel={`${item.label}, ${p.name}`}>
              <View style={[sh.actionIcon, { backgroundColor: (item.accent ?? theme.accent) + '18' }]}>
                <Icon name={item.icon} size={ICON.sm} color={item.accent ?? MUTED} />
              </View>
              <Text style={[sh.actionLabel, item.accent ? { color: item.accent } : {}]}>{item.label}</Text>
              <Icon name="chevron-right" size={ICON.sm} color={SUBTLE} />
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
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={sh.overlay} onPress={closeSheet} />
      <SheetRise style={sh.sheet}>
        <View style={sh.handle} />
        <Text style={sh.sheetTitle} numberOfLines={1}>Edit price · {p.name}</Text>
        <Text style={{ fontSize: FS.sm, fontFamily: FONT.medium, color: theme.muted, marginBottom: SP.md }}>
          Current price: {formatCents(p.pricing.priceCents)}
        </Text>
        <FormInput
          label="New price"
          price
          value={priceInput}
          onChange={setPriceInput}
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
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={sh.overlay} onPress={onClose} />
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

// Options, labels and their sortBy/sortDir live in lib/sellerLists/productSort.ts
// (the sheet drives the real getProducts query — nothing is re-sorted here).
type SortKey = ProductSortKey;
const SORT_OPTIONS = PRODUCT_SORT_OPTIONS;
// Restored across launches when it's still one of these.
const PRODUCT_FILTER_KEYS: ProductFilter[] = ['all', 'active', 'draft', 'scheduled', 'archived', 'pre-order', 'pre-made', 'low-stock', 'out-of-stock'];

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
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={sh.overlay} onPress={onClose} />
      <SheetRise style={sh.sheet}>
        <View style={sh.handle} />
        <Text style={sh.sheetTitle}>Sort Products</Text>
        {SORT_OPTIONS.map(({ key, label }) => (
          <PressableScale
            key={key}
            style={[sh.sortOption, current === key && sh.sortOptionActive]}
            onPress={() => { haptic('select'); onSelect(key); onClose(); }}
            accessibilityLabel={label}
            accessibilityState={{ selected: current === key }}
          >
            <Text style={[sh.sortOptionText, current === key && sh.sortOptionTextActive]}>
              {label}
            </Text>
            {current === key && <Icon name="check" size={ICON.sm} color={PURPLE_LIGHT} />}
          </PressableScale>
        ))}
      </SheetRise>
    </Modal>
  );
}

const FAB_CLEARANCE = 64; // 56pt button + 8pt gap

// ─── List skeleton ───────────────────────────────────────────────────────────

function ListRowsSkeleton() {
  const { theme } = useAppTheme();
  return (
    <View testID="products-list-skeleton" style={{ paddingHorizontal: SP.md }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
          <View style={{ width: 56, height: 56, borderRadius: RADIUS.sm, backgroundColor: theme.surfaceGlass }} />
          <View style={{ flex: 1, gap: SP.sm }}>
            <View style={{ height: 12, width: '60%', borderRadius: RADIUS.xs, backgroundColor: theme.surfaceGlass }} />
            <View style={{ height: 12, width: '35%', borderRadius: RADIUS.xs, backgroundColor: theme.surfaceGlass }} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ProductsScreen() {
  const scrollResetRef = useScrollReset<any>(true, false);
  const { theme } = useAppTheme();
  const sellerPreview = isSellerDevPreview();
  const previewDemo = sellerPreview && isPreviewDemoMode();
  // Preview mode is always read-only, even if Clerk happens to have a real
  // session. Demo mode may browse local fixtures; it never uses account data.
  const previewOnly = sellerPreview;
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
  const tabBarClearance = useTabBarClearance(2); // seller bar: Studio + AI side circles
  const { width: screenWidth } = useBreakpoint();
  const gridColumns = useGridColumns({ phone: 2, tablet: 3, tabletLandscape: 4 });
  const gridGutter = useCenteredGridPadding();
  const gridGap = SP.sm;
  const contentWidth = Math.min(screenWidth, 1080) - gridGutter * 2;
  const cardWidth = (contentWidth - gridGap * (gridColumns - 1)) / gridColumns;

  const params = useLocalSearchParams<{ filter?: ProductFilter; pickForMockup?: string; projectId?: string }>();
  const api = useApi();
  const [products, setProducts] = useState<Product[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = usePersistedChoice<ProductFilter>(
    'seller-products.filter', params.filter ?? 'all', PRODUCT_FILTER_KEYS, { restore: !params.filter },
  );
  const [sort, setSort] = useState<SortKey>(DEFAULT_PRODUCT_SORT);
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
  // List (Shopify-style rows) or grid, remembered on this device.
  const [viewMode, setViewMode] = useState<ProductsViewMode>(DEFAULT_PRODUCTS_VIEW_MODE);
  useEffect(() => {
    let cancelled = false;
    void loadProductsViewMode().then((mode) => { if (!cancelled) setViewMode(mode); });
    return () => { cancelled = true; };
  }, []);
  const toggleViewMode = useCallback(() => {
    hapticToggle();
    setViewMode((prev) => {
      const next: ProductsViewMode = prev === 'grid' ? 'list' : 'grid';
      void saveProductsViewMode(next);
      return next;
    });
  }, []);
  const isGrid = viewMode === 'grid';

  const showPreviewOnlyFeedback = useCallback(() => {
    Alert.alert('Sign in required', 'Sign in to manage products.');
  }, []);

  const loadStats = useCallback(async () => {
    if (previewDemo) {
      const { getPreviewSellerProducts } = await import('@/lib/previewSellerProducts');
      setStats(getPreviewProductStats(getPreviewSellerProducts()));
      return;
    }
    if (previewOnly || previewOnlyRef.current) {
      // Signed-out preview: counts for the products saved on this device only.
      try {
        setStats(Platform.OS === 'web' ? summarizeProducts(localPreviewSaves(await getProducts())) : EMPTY_STATS);
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
  }, [previewDemo, previewOnly]);

  // Search runs 250 ms after typing stops instead of on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // The filter + search the list on screen was loaded for. Coming back to
  // this tab re-fetches that same list silently: no skeleton, and a failed
  // background refresh keeps what's already shown (less-AI pass, item 89).
  const loadedKeyRef = React.useRef<string | null>(null);

  const loadProducts = useCallback(async () => {
    if (previewDemo) {
      const { getPreviewSellerProducts } = await import('@/lib/previewSellerProducts');
      const allProducts = getPreviewSellerProducts();
      const query = debouncedQuery.toLowerCase();
      const filtered = allProducts.filter((product) =>
        matchesPreviewProductFilter(product, filter)
        && (!query
          || product.name.toLowerCase().includes(query)
          || product.tags.some((tag) => tag.toLowerCase().includes(query))
          || product.variants.some((variant) => variant.sku?.toLowerCase().includes(query))
          || product.category.toLowerCase().includes(query)),
      );
      setProducts(filtered);
      setStats(getPreviewProductStats(allProducts));
      setLoading(false);
      return;
    }
    if ((previewOnly || previewOnlyRef.current) && Platform.OS !== 'web') {
      setProducts([]);
      setStats(EMPTY_STATS);
      setLoading(false);
      return;
    }
    const key = `${filter}|${debouncedQuery}|${sort}`;
    const silent = loadedKeyRef.current === key;
    if (!silent) setLoading(true);
    try {
      const result = await getProducts({ filter, text: debouncedQuery || undefined, ...productSortQuery(sort) });
      if (previewOnlyRef.current && Platform.OS !== 'web') {
        setProducts([]);
        setStats(EMPTY_STATS);
        return;
      }
      const list = Array.isArray(result) ? result : [];
      setProducts(previewOnlyRef.current ? localPreviewSaves(list) : list);
      loadedKeyRef.current = key;
      await loadStats();
    } catch {
      if (!silent) setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQuery, sort, loadStats, previewDemo, previewOnly]);

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
      Alert.alert('Sign in required', 'Sign in to duplicate products.');
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
      Alert.alert('Sign in required', 'Sign in to delete products.');
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
      Alert.alert('Sign in required', 'Sign in to archive products.');
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
    if (previewOnly) {
      if (previewDemo || Platform.OS === 'web') await loadProducts();
      else {
        setProducts([]);
        setStats(EMPTY_STATS);
      }
      return;
    }
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
    if (previewOnly && !previewDemo && Platform.OS !== 'web') return [];
    // Real products retain the query's sort; URL-only fixtures are local.
    if (!previewDemo) return products;
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
  }, [products, sort, previewDemo, previewOnly]);

  // Status filter pills
  const filterPills: { label: string; value: ProductFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Draft', value: 'draft' },
    { label: 'Archived', value: 'archived' },
    { label: 'Low Stock', value: 'low-stock' },
    { label: 'Out of Stock', value: 'out-of-stock' },
  ];

  const currentSortLabel = productSortLabel(sort);
  // The selected status chip already shows Active/Draft/etc. as selected.
  // Highlight the separate filter control only for choices outside that row.
  const hasActiveFilter = filter !== 'all' && !filterPills.some(pill => pill.value === filter);

  // Product detail reads the same device product store, so a signed-out
  // preview's saved product opens there too.
  const openProduct = useCallback((product: Product) => {
    if (previewOnly && !previewDemo && Platform.OS !== 'web') {
      showPreviewOnlyFeedback();
      return;
    }
    // Opened from Mockup preview "Add to product → Existing product": the
    // tapped product receives the mockup photo, then opens.
    const mockup = params.pickForMockup === '1' ? takePendingMockup(params.projectId) : null;
    if (mockup) {
      attachMockupToListedProduct({ api, updateLocal: updateProduct }, product, mockup.uri)
        .then(() => {
          router.setParams({ pickForMockup: undefined, projectId: undefined } as never);
          router.push(('/product-detail?id=' + product.id) as never);
        })
        .catch(() => { setPendingMockup(mockup); showActionSheet('Couldn’t add the mockup', 'Check your connection and try again.', [{ text: 'OK', style: 'cancel' }]); });
      return;
    }
    router.push(('/product-detail?id=' + product.id) as never);
  }, [router, previewOnly, previewDemo, showPreviewOnlyFeedback, params.pickForMockup, params.projectId, api]);

  const openActionSheet = useCallback((product: Product) => {
    if (previewOnly) {
      showPreviewOnlyFeedback();
      return;
    }
    haptic('sheet');
    setActionProduct(product);
    setActionSheetVisible(true);
  }, [previewOnly, showPreviewOnlyFeedback]);

  const openStockEditor = useCallback((product: Product) => {
    if (previewOnly) {
      showPreviewOnlyFeedback();
      return;
    }
    haptic('sheet');
    setStockEditProduct(product);
    setStockEditVisible(true);
  }, [previewOnly, showPreviewOnlyFeedback]);

  const handleStockChanged = useCallback((updated: Product) => {
    setProducts(prev => prev.map(p => (p.id === updated.id ? updated : p)));
    setStockEditProduct(updated);
    void loadStats();
  }, [loadStats]);

  const queryClient = useQueryClient();
  const onProductPressIn = useCallback((product: Product) => {
    if (previewOnly) return;
    prefetchOnPressIn(
      queryClient,
      queryKeys.product(product.id),
      () => getProduct(product.id),
      product.media.find(m => m.isCover)?.uri ?? product.media[0]?.uri,
    )();
  }, [previewOnly, queryClient]);

  const renderProduct = useCallback(({ item }: { item: Product }) => (
    !isGrid ? (
      <View style={{ paddingHorizontal: gridGap / 2 }}>
        <ProductRow
          product={item}
          onPress={openProduct}
          onPressIn={onProductPressIn}
          onMore={openActionSheet}
          onEditStock={openStockEditor}
        />
      </View>
    ) : (
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
    )
  ), [isGrid, openProduct, onProductPressIn, openActionSheet, openStockEditor, cardWidth, gridGap]);

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

  // Belt-and-suspenders alongside contentContainerStyle's paddingBottom below:
  // FlashList's web renderer doesn't always honor a large contentContainerStyle
  // bottom padding, letting the last row sit under the floating tab bar — a
  // real DOM footer of that height guarantees the scrollable area actually
  // extends past the bar.
  // + FAB_CLEARANCE so the last row also clears the floating add button.
  const ListFooter = useMemo(() => <View style={{ height: tabBar.occupiedHeight + FAB_CLEARANCE }} />, [tabBar.occupiedHeight]);

  // One honest title per filter (lib/sellerLists/emptyCopy.ts); only All
  // and Active offer "Add product", which opens add-product as a modal over
  // this tab — its Cancel lands back here (from=products).
  const ListEmpty = useMemo(() => {
    const copy = productEmptyCopy(filter, debouncedQuery);
    return (
      <View style={s.emptyWrap}>
        <EmptyState
          icon={copy.icon}
          title={copy.title}
          actionLabel={copy.action ? 'Add product' : undefined}
          actionSize="slim"
          onAction={copy.action ? () => router.push('/add-product?from=products' as never) : undefined}
          testID="products-empty"
        />
      </View>
    );
  }, [router, filter, debouncedQuery]);

  return (
    <View style={[s.root, { paddingTop: topInset + 12, backgroundColor: palette.background ?? palette.surface ?? SCREEN_BG }]}>
      {/* ── Fixed header ── */}
      <SellerListHeader
        title="Products"
        titleMenu={[
          { key: 'all', label: 'All products', selected: filter === 'all', onSelect: () => setFilter('all') },
          { key: 'collections', label: 'Collections', selected: false, onSelect: () => router.push('/store-collections' as never) },
          { key: 'bundles', label: 'Bundles', selected: false, onSelect: () => router.push('/product-bundles' as never) },
        ]}
        titleAccessibilityLabel="Products, choose a view"
        actions={[
          {
            icon: isGrid ? 'list' : 'grid',
            onPress: toggleViewMode,
            accessibilityLabel: isGrid ? 'Show as list' : 'Show as grid',
          },
          {
            icon: 'more-horizontal',
            onPress: (event?: unknown) => openPullDownMenu(event, [
              { label: 'Select products', icon: 'check-square', onPress: () => router.push('/products-bulk-edit' as never) },
              { label: 'Import products (CSV)', icon: 'file-text', onPress: () => router.push('/product-import' as never) },
              { label: 'Import from Shopify', icon: 'shopping-bag', onPress: () => router.push('/shopify-import' as never) },
              { label: 'Export products', icon: 'download', onPress: () => { void handleExportProducts(); } },
              { label: 'Scheduled launches', icon: 'calendar', onPress: () => router.push('/product-launches' as never) },
              { label: 'Waitlist demand', icon: 'users', onPress: () => router.push('/waitlist-demand' as never) },
              { label: 'Size charts', icon: 'maximize-2', onPress: () => router.push('/size-chart-templates' as never) },
            ]),
            accessibilityLabel: 'More product actions',
          },
        ]}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search products…"
        onFilterPress={() => { haptic('sheet'); setFilterModalVisible(true); }}
        hasActiveFilter={hasActiveFilter}
        filterAccessibilityLabel={filter !== 'all' ? `Filter: ${filter}` : 'Filter products'}
        onSortPress={() => setSortModalVisible(true)}
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
          {isGrid
            ? <GridSkeleton columns={gridColumns} cardWidth={cardWidth} rows={3} gap={gridGap} />
            : <ListRowsSkeleton />}
        </View>
      ) : (
        <FlashList
          ref={scrollResetRef}
          data={sortedProducts}
          keyExtractor={keyExtractor}
          renderItem={renderProduct}
          numColumns={isGrid ? gridColumns : 1}
          key={isGrid ? `cols-${gridColumns}` : 'list'}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={ListFooter}
          ListEmptyComponent={ListEmpty}
          contentContainerStyle={{ paddingHorizontal: gridGutter - gridGap / 2, paddingBottom: tabBarClearance + SP.md }}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={handleRefresh}
        />
      )}

      {/* Add product — floating, bottom-right, always above the tab bar. */}
      <Pressable
        style={({ pressed }) => [s.fab, { bottom: tabBar.occupiedHeight + SP.sm, right: gridGutter }, pressed && s.fabPressed]}
        onPress={() => { hapticPrimaryAction(); router.push('/add-product' as never); }}
        accessibilityRole="button"
        accessibilityLabel="Add product"
        testID="products-add-fab"
      >
        <Feather name="plus" size={ICON.lg} color={theme.background} />
      </Pressable>

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

  // Floating add button: solid text-colour disc (white on dark themes).
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: FG,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.shadowColor,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  });
};

const createSheetStyles = (theme: any) => {
  const SURFACE = theme.surface, BORDER = theme.border, FG = theme.text, MUTED = theme.muted;
  const PURPLE_LIGHT = theme.accentLight;
  return StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.72)', // theme-exempt: neutral scrim behind product actions
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
