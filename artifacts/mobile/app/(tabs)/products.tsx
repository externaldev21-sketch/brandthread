/**
 * Brandthread — Seller Products Tab
 * Main catalog management screen.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import { View, Text, ScrollView, FlatList, StyleSheet, Alert, Share, Modal, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { BG, SCREEN_BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, BLUE_DIM, ORANGE, ORANGE_DIM, RED, RED_DIM, GOLD, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, COMP, ICON, PURPLE, PURPLE_LIGHT, PURPLE_DIM } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { AnimatedEntrance, BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, SearchBar, FilterChip, StatusBadge, EmptyState, SectionHeader, StatCard, GuidedTip, ProductGridSkeleton, PressableScale, useUndoToast } from '@/components/BrandthreadUI';
import { CachedImage } from '@/components/CachedImage';
import { getProducts, getProductStats, archiveProduct, unarchiveProduct, deleteProduct, restoreProduct, duplicateProduct, listDrafts, deleteDraft } from '@/services/productService';
import { Product, ProductDraft, ProductFilter, ProductCategory } from '@/services/productTypes';
import { formatCents, integerPercent } from '@/lib/money';

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
  lowStock: number;
  outOfStock: number;
  preOrder: number;
  totalInventoryValueCents: number;
}

// ─── Product Card ─────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: Product;
  onEdit: () => void;
  onDuplicate: () => void;
  onMore: () => void;
}

function ProductCard({ product, onEdit, onDuplicate, onMore }: ProductCardProps) {
  const { theme } = useAppTheme();
  const coverUri = product.media.find(m => m.isCover)?.uri ?? product.media[0]?.uri;
  const gradColors = getCategoryColors(product.category, theme);

  const stock = product.inventory.totalStock;
  const threshold = product.inventory.lowStockThreshold;
  const stockColor = stock === 0 ? RED : stock <= threshold ? ORANGE : SUCCESS;
  const stockLabel = stock === 0 ? 'Out of stock' : `${stock} in stock`;

  const price = product.pricing.priceCents;
  const compare = product.pricing.compareAtPriceCents;
  const discountPct = compare && compare > price
    ? integerPercent(compare - price, compare)
    : null;

  return (
    <BrandthreadCard style={[s.productCard, { padding: 0, overflow: 'hidden' }]}>
      {/* Main row */}
      <View style={s.cardRow}>
        {/* Thumbnail */}
        <View style={s.thumbWrap}>
          {coverUri ? (
            <CachedImage source={{ uri: coverUri }} style={s.thumb} contentFit="cover" />
          ) : (
            <LinearGradient colors={gradColors} style={s.thumb} />
          )}
        </View>

        {/* Content */}
        <View style={s.cardContent}>
          {/* Name + status */}
          <View style={s.cardTopRow}>
            <Text style={s.productName} numberOfLines={1}>{product.name}</Text>
            <StatusBadge label={statusLabel(product.status)} variant={statusVariant(product.status)} small />
          </View>

          {/* Category + sales model */}
          <View style={s.cardMetaRow}>
            <Text style={s.categoryText}>{product.category}</Text>
            {product.salesModel === 'pre-order' && (
              <StatusBadge label="Pre-order" variant="purple" small />
            )}
            {product.salesModel === 'pre-made' && (
              <StatusBadge label="Pre-made" variant="neutral" small />
            )}
          </View>

          {/* Price row */}
          <View style={s.priceRow}>
            <Text style={s.price}>{formatCents(price)}</Text>
            {compare && compare > price && (
              <Text style={s.comparePrice}>{formatCents(compare)}</Text>
            )}
            {discountPct && (
              <Text style={s.discount}>-{discountPct}%</Text>
            )}
          </View>

          {/* Inventory row */}
          <View style={s.infoRow}>
            <Feather name="layers" size={11} color={MUTED} />
            <Text style={s.infoText}>
              {product.variants.length} variant{product.variants.length !== 1 ? 's' : ''}
            </Text>
            <Text style={s.bullet}>·</Text>
            <Text style={[s.infoText, { color: stockColor }]}>{stockLabel}</Text>
          </View>

          {/* Sales row */}
          <View style={s.infoRow}>
            <Feather name="bar-chart-2" size={11} color={MUTED} />
            <Text style={s.infoText}>{product.totalSales} sold</Text>
            <Text style={s.bullet}> · </Text>
            <Text style={[s.infoText, { color: SUBTLE }]}>{formatCents(product.totalRevenueCents)} revenue</Text>
          </View>
        </View>
      </View>

      {/* Action row */}
      <View style={s.actionRow}>
        <PressableScale style={s.actionBtn} onPress={onEdit} accessibilityLabel={`Edit ${product.name}`}>
          <Feather name="edit-2" size={13} color={theme.accentLight} />
          <Text style={[s.actionLabel, { color: theme.accentLight }]}>Edit</Text>
        </PressableScale>
        <View style={s.actionDivider} />
        <PressableScale style={s.actionBtn} onPress={onDuplicate} accessibilityLabel={`Duplicate ${product.name}`}>
          <Feather name="copy" size={13} color={MUTED} />
          <Text style={s.actionLabel}>Duplicate</Text>
        </PressableScale>
        <View style={s.actionDivider} />
        <PressableScale style={s.actionBtn} onPress={onMore} accessibilityLabel={`More actions for ${product.name}`}>
          <Feather name="more-horizontal" size={13} color={MUTED} />
          <Text style={s.actionLabel}>More</Text>
        </PressableScale>
      </View>
    </BrandthreadCard>
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
  if (!product) return null;

  const p = product as Product; // non-nullable alias for closure capture
  const isArchived = p.status === 'archived';

  function closeSheet() {
    onClose();
  }

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
      label: 'Send to manufacturer', icon: 'tool', accent: ORANGE,
      onPress: () => { closeSheet(); router.push(('/manufacturer-hub?productId=' + p.id) as never); },
    },
    { label: 'View analytics', icon: 'bar-chart-2', onPress: () => { closeSheet(); router.push(('/product-detail?id=' + p.id + '&tab=analytics') as never); } },
    isArchived
      ? { label: 'Unarchive', icon: 'rotate-ccw', onPress: handleUnarchive }
      : { label: 'Archive', icon: 'archive', onPress: handleArchive },
    { label: 'Delete', icon: 'trash-2', accent: RED, onPress: handleDelete },
  ];

  const { theme } = useAppTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={closeSheet}
    >
      <Pressable style={as.overlay} onPress={closeSheet} />
      <View style={as.sheet}>
        <View style={as.handle} />
        <Text style={as.sheetTitle} numberOfLines={1}>{p.name}</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
          {actions.map((item, idx) => (
            <PressableScale key={idx} style={as.actionItem} onPress={item.onPress} accessibilityLabel={`${item.label}, ${p.name}`}>
              <View style={[as.actionIcon, { backgroundColor: (item.accent ?? theme.accent) + '18' }]}>
                <Feather name={item.icon} size={ICON.sm} color={item.accent ?? MUTED} />
              </View>
              <Text style={[as.actionLabel, item.accent ? { color: item.accent } : {}]}>{item.label}</Text>
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
  const [selected, setSelected] = useState<ProductFilter>(current);

  useEffect(() => { setSelected(current); }, [current, visible]);

  // Use static chips for filter modal (no counts needed here)
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
      <Pressable style={as.overlay} onPress={onClose} />
      <View style={[as.sheet, { paddingBottom: SP.xl }]}>
        <View style={as.handle} />
        <Text style={as.sheetTitle}>Filter Products</Text>
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

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ProductsScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showUndo } = useUndoToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [inProgressDrafts, setInProgressDrafts] = useState<ProductDraft[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<ProductFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [dismissedTips, setDismissedTips] = useState<string[]>([]);
  const [actionProduct, setActionProduct] = useState<Product | null>(null);
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadStats = useCallback(async () => {
    try {
      const s = await getProductStats();
      setStats({
        active: s.active,
        draft: s.draft,
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
      // Always refresh stats after products refresh
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

  // Reload when the tab comes back into focus (e.g. after creating a product)
  useFocusEffect(useCallback(() => {
    loadProducts();
    listDrafts().then(rows => setInProgressDrafts(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, [loadProducts]));

  function refresh() {
    loadProducts();
  }

  const handleDiscardDraft = useCallback((draftId: string, draftName: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      'Discard draft?',
      `"${draftName || 'Untitled product'}" will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await deleteDraft(draftId);
            setInProgressDrafts(prev => prev.filter(d => d.id !== draftId));
          },
        },
      ]
    );
  }, []);

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
            // Remove immediately; if the authoritative request fails, reload
            // rather than retaining a client-side deletion.
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

  // Computed filter chips with count badges from stats
  const filterChips: { label: string; value: ProductFilter }[] = [
    { label: 'All', value: 'all' as ProductFilter },
    { label: stats ? `Active (${stats.active})` : 'Active', value: 'active' as ProductFilter },
    { label: stats ? `Draft (${stats.draft})` : 'Draft', value: 'draft' as ProductFilter },
    { label: 'Scheduled', value: 'scheduled' as ProductFilter },
    { label: 'Archived', value: 'archived' as ProductFilter },
    { label: stats ? `Pre-order (${stats.preOrder})` : 'Pre-order', value: 'pre-order' as ProductFilter },
    { label: 'Pre-made', value: 'pre-made' as ProductFilter },
    { label: stats ? `Low stock (${stats.lowStock})` : 'Low stock', value: 'low-stock' as ProductFilter },
    { label: stats ? `Out of stock (${stats.outOfStock})` : 'Out of stock', value: 'out-of-stock' as ProductFilter },
  ];

  const renderProduct = useCallback(({ item }: { item: Product }) => (
    <ProductCard
      product={item}
      onEdit={() => router.push(('/product-detail?id=' + item.id) as never)}
      onDuplicate={() => handleDuplicate(item.id)}
      onMore={() => openActionSheet(item)}
    />
  ), [router]);

  const keyExtractor = useCallback((item: Product) => item.id, []);

  const statsForDisplay = stats ?? { active: 0, draft: 0, lowStock: 0, outOfStock: 0, preOrder: 0, totalInventoryValueCents: 0 };

  const ListHeader = useMemo(() => (
    <>
      {/* In-progress creation drafts */}
      {inProgressDrafts.length > 0 && (
        <>
          <SectionHeader title={`In Progress (${inProgressDrafts.length})`} style={{ marginBottom: SP.sm }} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: SP.sm, paddingBottom: SP.sm }}
            style={{ marginBottom: SP.md }}
          >
            {inProgressDrafts.slice(0, 3).map(draft => (
              <PressableScale
                key={draft.id}
                style={s.draftCard}
                onPress={() => router.push(('/add-product?editId=' + draft.id) as never)}
                accessibilityLabel={`Resume ${draft.name || 'untitled product'} draft, step ${draft.currentStep ?? 1} of 10`}
              >
                <View style={s.draftCardTop}>
                  <Feather name="edit-3" size={14} color={ORANGE} />
                  <Text style={[s.draftStep, { flex: 1 }]}>Step {draft.currentStep ?? 1}/10</Text>
                  <PressableScale
                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                    onPress={() => handleDiscardDraft(draft.id, draft.name ?? '')}
                    accessibilityLabel={`Discard ${draft.name || 'untitled product'} draft`}
                  >
                    <Feather name="x" size={13} color={MUTED} />
                  </PressableScale>
                </View>
                <Text style={s.draftName} numberOfLines={1}>
                  {draft.name || 'Untitled product'}
                </Text>
                <Text style={s.draftTime} numberOfLines={1}>
                  Saved {draft.lastSavedAt ? new Date(draft.lastSavedAt).toLocaleDateString() : '—'}
                </Text>
                <View style={s.draftResume}>
                  <Text style={[s.draftResumeLabel, { color: theme.accentLight }]}>Resume →</Text>
                </View>
              </PressableScale>
            ))}
            {inProgressDrafts.length > 3 && (
              <PressableScale
                style={[s.seeAllDraftsCard, { backgroundColor: theme.accentDim, borderColor: theme.accent + '55' }]}
                onPress={() => router.push('/drafts' as never)}
                accessibilityRole="button"
                accessibilityLabel={`See all ${inProgressDrafts.length} drafts`}
              >
                <View style={[s.seeAllDraftsIcon, { backgroundColor: theme.accent + '22' }]}>
                  <Feather name="list" size={16} color={theme.accentLight} />
                </View>
                <Text style={[s.seeAllDraftsLabel, { color: theme.accentLight }]}>See all ({inProgressDrafts.length})</Text>
                <Feather name="chevron-right" size={14} color={theme.accentLight} />
              </PressableScale>
            )}
          </ScrollView>
        </>
      )}

      {/* Summary stats */}
      <AnimatedEntrance>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.statsRow}
          style={{ marginBottom: SP.md }}
        >
          <StatCard label="Active" value={String(statsForDisplay.active)} icon="check-circle" accent={SUCCESS} style={s.statCard} />
          <StatCard label="Draft" value={String(statsForDisplay.draft)} icon="edit-3" accent={ORANGE} style={s.statCard} />
          <StatCard label="Low Stock" value={String(statsForDisplay.lowStock)} icon="alert-triangle" accent={RED} style={s.statCard} />
          <StatCard label="Out of Stock" value={String(statsForDisplay.outOfStock)} icon="x-circle" accent={RED} style={s.statCard} />
          <StatCard label="Pre-orders" value={String(statsForDisplay.preOrder)} icon="clock" accent={theme.accent} style={s.statCard} />
          <StatCard label="Value" value={formatCents(statsForDisplay.totalInventoryValueCents)} icon="dollar-sign" accent={GOLD} style={s.statCard} />
        </ScrollView>
      </AnimatedEntrance>

      {/* Filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filterRow}
        style={{ marginBottom: SP.md }}
      >
        {filterChips.map(chip => (
          <FilterChip
            key={chip.value}
            label={chip.label}
            active={filter === chip.value}
            onPress={() => setFilter(chip.value)}
          />
        ))}
      </ScrollView>

      {/* Guided tip */}
      <GuidedTip
        id="products-tip"
        text="Products you create here can be tagged in Seller posts. Only active and scheduled products appear in the Thread."
        dismissedIds={dismissedTips}
        onDismiss={(id) => setDismissedTips(prev => [...prev, id])}
        style={{ marginBottom: SP.md, marginHorizontal: 0 }}
      />

      {/* Section header */}
      <SectionHeader
        title={filter === 'all' ? 'All Products' : filterChips.find(c => c.value === filter)?.label ?? 'Products'}
        action={{ label: 'Sort', onPress: () => {} }}
        style={{ marginBottom: SP.sm }}
      />
    </>
  ), [stats, filter, dismissedTips, inProgressDrafts, router, handleDiscardDraft]);

  const ListEmpty = useMemo(() => (
    <EmptyState
      icon="package"
      title="Your first product starts here."
      description="Add product details, media, pricing, variants and inventory."
      action={{ label: 'Create product', icon: 'plus', onPress: () => router.push('/add-product' as never) }}
    />
  ), [router]);

  return (
    <View style={s.root}>
      {/* Fixed header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <View style={s.headerRow}>
          <Text style={s.headerTitle}>Products</Text>
          <View style={s.headerActions}>
            <IconButton
              name="search"
              onPress={() => setSearchActive(v => !v)}
              color={searchActive ? PURPLE_LIGHT : FG}
              accessibilityLabel={searchActive ? 'Hide product search' : 'Search products'}
            />
            <IconButton
              name="filter"
              onPress={() => setFilterModalVisible(true)}
              color={filter !== 'all' ? PURPLE_LIGHT : FG}
              accessibilityLabel={filter === 'all' ? 'Filter products' : `Filter products, ${filter} selected`}
            />
            <IconButton
              name="download"
              onPress={() => router.push('/product-import' as never)}
              accessibilityLabel="Import products"
            />
            <IconButton
              name="plus"
              onPress={() => router.push('/add-product' as never)}
              color={PURPLE_LIGHT}
              accessibilityLabel="Add product"
            />
          </View>
        </View>
        {searchActive && (
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search products…"
            style={{ marginBottom: SP.sm }}
          />
        )}
      </View>

      {/* Product list */}
      <FlatList
        data={products}
        keyExtractor={keyExtractor}
        renderItem={renderProduct}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
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
      <AIBrainFAB context={{ screen: 'products' as const }} bottomOffset={72} />
      {loading && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: SCREEN_BG, zIndex: 10 }}>
          <ProductGridSkeleton />
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  header: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
    backgroundColor: BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: SP.sm,
  },
  headerTitle: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.3,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
  },
  draftCard: {
    width: 160,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: ORANGE + '55',
    padding: SP.sm,
    gap: 4,
  },
  draftCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  draftStep: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: ORANGE,
  },
  draftName: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  draftTime: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  draftResume: {
    marginTop: 4,
  },
  draftResumeLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
  },
  seeAllDraftsCard: {
    width: 132,
    minHeight: 132,
    backgroundColor: PURPLE_DIM,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER_ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.xs,
    paddingHorizontal: SP.sm,
  },
  seeAllDraftsIcon: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.sm,
    backgroundColor: PURPLE + '22',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  seeAllDraftsLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: PURPLE_LIGHT,
    textAlign: 'center',
  },
  statsRow: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
    paddingTop: SP.sm,
  },
  statCard: {
    minWidth: 90,
  },
  filterRow: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },
  listContent: {
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    paddingBottom: COMP.tabBarH + SP.xl,
  },
  productCard: {
    marginBottom: 0,
  },
  cardRow: {
    flexDirection: 'row',
  },
  thumbWrap: {
    width: 80,
    height: 80,
    overflow: 'hidden',
    borderTopLeftRadius: RADIUS.lg,
  },
  thumb: {
    width: 80,
    height: 80,
  },
  cardContent: {
    flex: 1,
    paddingHorizontal: SP.sm,
    paddingTop: SP.sm,
    paddingBottom: SP.xs,
    gap: 3,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SP.xs,
  },
  productName: {
    flex: 1,
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.2,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  categoryText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
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
  discount: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: RED,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  infoText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  bullet: {
    fontSize: FS.xs,
    color: SUBTLE,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: SP.xs,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 10,
  },
  actionDivider: {
    width: 1,
    height: 20,
    backgroundColor: BORDER,
  },
  actionLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: MUTED,
  },
});

const as = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
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
});

const fm = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SP.sm,
    paddingHorizontal: SP.xs,
    marginBottom: SP.sm,
  },
});
