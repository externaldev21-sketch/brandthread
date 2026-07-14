/**
 * Brandthread Product Detail Screen
 * 8-tab deep-dive into a single product: Overview, Variants, Inventory,
 * Orders, Production, Content, Analytics, Store page.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, Animated, Image, FlatList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import {
  BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE,
  FG, MUTED, SUBTLE, PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, SUCCESS, SUCCESS_DIM, BLUE, ORANGE, RED, RED_DIM,
  GOLD, GRAD_PRIMARY, GRAD_CARD_GLOW,
  FONT, FS, SP, RADIUS, COMP, ICON, SHADOW_PURPLE,
} from '@/lib/theme';

import {
  BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton,
  IconButton, SectionHeader, StatusBadge, StatCard, NavigationCard,
  LoadingSkeleton, EmptyState, FilterChip,
} from '@/components/BrandthreadUI';

import { getProduct, updateProduct, getProductAnalytics, archiveProduct, publishProduct, adjustInventory } from '@/services/productService';
import { Product, ProductVariant, ProductStatus } from '@/services/productTypes';
import { getItemsByProduct, adjustStock } from '@/services/inventoryService';
import { InventoryItem } from '@/services/inventoryTypes';
import { calcPricing, formatCurrency, isLowStock, isOutOfStock } from '@/lib/productUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'overview' | 'variants' | 'inventory' | 'orders' | 'production' | 'content' | 'analytics' | 'store';

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview',    label: 'Overview' },
  { key: 'variants',    label: 'Variants' },
  { key: 'inventory',   label: 'Inventory' },
  { key: 'orders',      label: 'Orders' },
  { key: 'production',  label: 'Production' },
  { key: 'content',     label: 'Content' },
  { key: 'analytics',   label: 'Analytics' },
  { key: 'store',       label: 'Store page' },
];

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ProductDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const id = params.id;

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Analytics state
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof getProductAnalytics>> | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const tabScrollRef = useRef<ScrollView>(null);

  // Load product
  useEffect(() => {
    if (!id) return;
    getProduct(id).then(p => {
      setProduct(p ?? null);
      setLoading(false);
      // Fix 4: set initial tab from params after loading
      if (params.tab && TABS.some(t => t.key === params.tab)) {
        setActiveTab(params.tab as Tab);
      }
    });
  }, [id]);

  // Load analytics when tab opens
  useEffect(() => {
    if (activeTab === 'analytics' && id && !analytics) {
      setAnalyticsLoading(true);
      getProductAnalytics(id).then(a => {
        setAnalytics(a);
        setAnalyticsLoading(false);
      });
    }
  }, [activeTab, id]);

  const handleTabPress = useCallback((tab: Tab, index: number) => {
    Haptics.selectionAsync();
    setActiveTab(tab);
  }, []);

  if (loading) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <View style={s.header}>
          <LoadingSkeleton height={36} style={{ width: 200 }} />
        </View>
        <View style={{ padding: SP.md, gap: SP.md }}>
          <LoadingSkeleton height={200} />
          <LoadingSkeleton height={80} />
          <LoadingSkeleton height={80} />
        </View>
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <EmptyState
          icon="package"
          title="Product not found"
          description="This product may have been deleted or the link is invalid."
          action={{ label: 'Go back', onPress: () => router.back() }}
        />
      </View>
    );
  }

  const pricing = calcPricing(product.pricing);
  const coverImage = product.media.find(m => m.isCover) ?? product.media[0];

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {/* ── Fixed Header ── */}
      <View style={s.header}>
        {/* Fix 3: back button uses router.back() */}
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={s.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </TouchableOpacity>

        <Text style={s.headerTitle} numberOfLines={1}>{product.name}</Text>

        <View style={s.headerRight}>
          {/* Fix 7: edit button navigates to /add-product with editId param */}
          <TouchableOpacity
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(('/add-product?editId=' + id) as never); }}
            style={s.headerBtn}
          >
            <Text style={s.editBtnText}>Edit</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Alert.alert('Product Options', '', [
                { text: product.status === 'active' ? 'Archive' : 'Publish', onPress: () => {
                  if (product.status === 'active') {
                    archiveProduct(product.id).then(p => p && setProduct(p));
                  } else {
                    publishProduct(product.id).then(p => p && setProduct(p));
                  }
                }},
                { text: 'Duplicate', onPress: () => Alert.alert('Duplicating…') },
                { text: 'Share', onPress: () => Alert.alert('Share link copied') },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
            style={s.iconBtnSmall}
          >
            <Feather name="more-horizontal" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Tab Bar ── */}
      <View style={s.tabBarWrap}>
        <ScrollView
          ref={tabScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.tabBarContent}
        >
          {TABS.map((tab, idx) => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => handleTabPress(tab.key, idx)}
                style={s.tabItem}
                activeOpacity={0.7}
              >
                <Text style={[s.tabLabel, active && s.tabLabelActive]}>
                  {tab.label}
                </Text>
                {active && <View style={s.tabUnderline} />}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Tab Content ── */}
      <ScrollView
        style={s.tabContent}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {activeTab === 'overview'   && <OverviewTab   product={product} pricing={pricing} coverImage={coverImage} />}
        {activeTab === 'variants'   && <VariantsTab   product={product} setProduct={setProduct} id={id!} />}
        {activeTab === 'inventory'  && <InventoryTab  product={product} setProduct={setProduct} id={id!} />}
        {activeTab === 'orders'     && <OrdersTab     product={product} router={router} />}
        {activeTab === 'production' && <ProductionTab product={product} router={router} />}
        {activeTab === 'content'    && <ContentTab    product={product} router={router} id={id!} />}
        {activeTab === 'analytics'  && <AnalyticsTab  analytics={analytics} loading={analyticsLoading} product={product} />}
        {activeTab === 'store'      && <StoreTab      product={product} pricing={pricing} coverImage={coverImage} router={router} id={id!} />}
      </ScrollView>

      {/* ── Floating Action Button ── */}
      <TouchableOpacity
        style={[s.fab, { bottom: insets.bottom + SP.lg }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push(('/add-product?editId=' + id) as never); }}
        activeOpacity={0.85}
      >
        <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fabGrad}>
          <Feather name="edit-2" size={ICON.md} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>
      <AIBrainFAB context={{ screen: 'product_detail' as const, productId: String(id ?? ''), productName: String(product.name ?? '') }} bottomOffset={0} />
    </View>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ product, pricing, coverImage }: {
  product: Product;
  pricing: ReturnType<typeof calcPricing>;
  coverImage: Product['media'][0] | undefined;
}) {
  const statusVariant = product.status === 'active' ? 'success' : product.status === 'draft' ? 'warning' : product.status === 'archived' ? 'neutral' : 'info';

  // Fix 8: show '—' if price is 0 or undefined; show '—' for margin if cost is undefined
  const priceDisplay = pricing.retailPrice ? formatCurrency(pricing.retailPrice) : '—';
  const marginDisplay = pricing.marginPercent !== undefined ? `${pricing.marginPercent.toFixed(0)}%` : '—';
  const profitDisplay = pricing.netProfit !== undefined ? formatCurrency(pricing.netProfit) : '—';

  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      {/* Hero card */}
      <GradientCard glow style={{ marginHorizontal: SP.md, padding: 0, overflow: 'hidden' }}>
        {coverImage ? (
          <Image source={{ uri: coverImage.uri }} style={ov.heroImage} resizeMode="cover" />
        ) : (
          <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={ov.heroPlaceholder}>
            <Feather name="package" size={ICON.xxl} color="rgba(255,255,255,0.4)" />
          </LinearGradient>
        )}
        <View style={ov.heroBadgeRow}>
          <StatusBadge label={product.status.toUpperCase()} variant={statusVariant} />
          <StatusBadge
            label={product.salesModel === 'pre-order' ? 'PRE-ORDER' : product.salesModel === 'both' ? 'PRE-ORDER + STOCK' : 'IN STOCK'}
            variant={product.salesModel === 'pre-order' ? 'info' : 'purple'}
          />
        </View>
        <View style={ov.heroPriceSection}>
          <View style={ov.heroPriceRow}>
            <Text style={ov.heroPrice}>{priceDisplay}</Text>
            {pricing.compareAtPrice && (
              <Text style={ov.heroCompare}>{formatCurrency(pricing.compareAtPrice)}</Text>
            )}
            {pricing.discountPercent && (
              <StatusBadge label={`-${pricing.discountPercent}%`} variant="error" small />
            )}
          </View>
          {pricing.marginPercent !== undefined ? (
            <Text style={ov.heroMargin}>
              Profit: {profitDisplay} · Margin: {pricing.marginPercent.toFixed(1)}%
            </Text>
          ) : pricing.cost === undefined ? (
            <Text style={ov.heroMargin}>Margin: — (add cost to calculate)</Text>
          ) : null}
        </View>
      </GradientCard>

      {/* Stat strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ov.statStrip}>
        <StatCard label="Revenue" value={formatCurrency(product.totalRevenue)} icon="dollar-sign" accent={GOLD} style={ov.statCard} />
        <StatCard label="Sold" value={String(product.totalSales)} icon="shopping-bag" accent={PURPLE} style={ov.statCard} />
        <StatCard label="Stock" value={String(product.inventory.totalStock)} icon="layers" accent={CYAN} style={ov.statCard} />
        <StatCard
          label="Margin"
          value={marginDisplay}
          icon="trending-up"
          accent={SUCCESS}
          style={ov.statCard}
        />
      </ScrollView>

      {/* Info rows */}
      <View style={{ paddingHorizontal: SP.md, gap: SP.sm }}>
        <SectionHeader title="Details" />
        <View style={ov.infoCard}>
          <InfoRow label="Manufacturer" value={product.manufacturing.manufacturerName ?? 'Not assigned'} icon="tool" />
          <View style={ov.divider} />
          <InfoRow
            label="Store status"
            value=""
            icon="shopping-cart"
            right={<StatusBadge label={product.storeSettings.status.toUpperCase()} variant={product.storeSettings.status === 'active' ? 'success' : 'warning'} small />}
          />
          <View style={ov.divider} />
          <InfoRow label="Last updated" value={new Date(product.updatedAt).toLocaleDateString()} icon="clock" />
          {product.storeSettings.seo.title && (
            <>
              <View style={ov.divider} />
              <InfoRow label="SEO title" value={product.storeSettings.seo.title} icon="search" />
            </>
          )}
          {product.category && (
            <>
              <View style={ov.divider} />
              <InfoRow label="Category" value={product.category} icon="tag" />
            </>
          )}
          {product.vendor && (
            <>
              <View style={ov.divider} />
              <InfoRow label="Vendor" value={product.vendor} icon="briefcase" />
            </>
          )}
        </View>

        {product.tags.length > 0 && (
          <View style={{ marginTop: SP.sm }}>
            <SectionHeader title="Tags" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={ov.tagRow}>
                {product.tags.map(tag => (
                  <View key={tag} style={ov.tag}>
                    <Text style={ov.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

function InfoRow({ label, value, icon, right }: { label: string; value: string; icon: keyof typeof Feather.glyphMap; right?: React.ReactNode }) {
  return (
    <View style={ov.infoRow}>
      <Feather name={icon} size={ICON.sm} color={MUTED} />
      <Text style={ov.infoLabel}>{label}</Text>
      <View style={ov.infoValueWrap}>
        {right ?? <Text style={ov.infoValue} numberOfLines={1}>{value}</Text>}
      </View>
    </View>
  );
}

const ov = StyleSheet.create({
  heroImage:       { width: '100%', height: 180 },
  heroPlaceholder: { width: '100%', height: 180, alignItems: 'center', justifyContent: 'center' },
  heroBadgeRow:    { flexDirection: 'row', gap: SP.sm, padding: SP.md, paddingBottom: 0 },
  heroPriceSection:{ padding: SP.md },
  heroPriceRow:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  heroPrice:       { fontSize: FS.xxl, fontFamily: FONT.bold, color: FG },
  heroCompare:     { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textDecorationLine: 'line-through' },
  heroMargin:      { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, marginTop: 4 },
  statStrip:       { gap: SP.sm, paddingHorizontal: SP.md },
  statCard:        { minWidth: 110 },
  infoCard:        { backgroundColor: CARD, borderRadius: RADIUS.md, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  infoRow:         { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: 12 },
  infoLabel:       { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED, width: 110 },
  infoValueWrap:   { flex: 1, alignItems: 'flex-end' },
  infoValue:       { fontSize: FS.sm, fontFamily: FONT.medium, color: FG, textAlign: 'right' },
  divider:         { height: 1, backgroundColor: BORDER, marginHorizontal: SP.md },
  tagRow:          { flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingVertical: SP.sm },
  tag:             { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: BORDER_ACTIVE },
  tagText:         { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
});

// ─── Variants Tab ─────────────────────────────────────────────────────────────

function VariantsTab({ product, setProduct, id }: { product: Product; setProduct: (p: Product) => void; id: string }) {
  // Fix 2: bulk edit price handler
  const handleBulkPrice = () => {
    const currentPrice = product.pricing.price;
    Alert.alert('Bulk Edit Price', `Current price: ${formatCurrency(currentPrice)}`, [
      {
        text: `Set all to ${formatCurrency(currentPrice)}`,
        onPress: () => {
          const updatedVariants = product.variants.map(v => ({ ...v, price: currentPrice }));
          updateProduct(id, { variants: updatedVariants }).then(p => {
            if (p) setProduct(p);
          });
        },
      },
      {
        text: 'Edit individually',
        onPress: () => Alert.alert('Individual Edit', 'Tap a variant to edit its price.'),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  // Fix 2: bulk edit inventory handler
  const handleBulkInventory = () => {
    const totalStock = product.inventory.totalStock;
    Alert.alert('Bulk Edit Inventory', 'Choose an adjustment for all variants', [
      {
        text: 'Add 5 to all',
        onPress: () => {
          const updatedVariants = product.variants.map(v => ({ ...v, inventoryQuantity: v.inventoryQuantity + 5 }));
          updateProduct(id, { variants: updatedVariants }).then(p => {
            if (p) setProduct(p);
          });
        },
      },
      {
        text: 'Remove 5 from all',
        onPress: () => {
          const updatedVariants = product.variants.map(v => ({ ...v, inventoryQuantity: Math.max(0, v.inventoryQuantity - 5) }));
          updateProduct(id, { variants: updatedVariants }).then(p => {
            if (p) setProduct(p);
          });
        },
      },
      {
        text: 'Reset all to 0',
        onPress: () => {
          const updatedVariants = product.variants.map(v => ({ ...v, inventoryQuantity: 0 }));
          updateProduct(id, { variants: updatedVariants }).then(p => {
            if (p) setProduct(p);
          });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      <SectionHeader
        title="Variants"
        action={{ label: 'Add variant', onPress: () => Alert.alert('Add Variant', 'Variant editor coming soon.') }}
      />

      {/* Bulk edit */}
      <BrandthreadCard style={{ marginHorizontal: SP.md }}>
        <Text style={vt.bulkTitle}>Bulk Edit</Text>
        <View style={vt.bulkRow}>
          <TouchableOpacity style={vt.bulkBtn} onPress={handleBulkPrice}>
            <Feather name="dollar-sign" size={ICON.sm} color={PURPLE_LIGHT} />
            <Text style={vt.bulkBtnText}>Price</Text>
          </TouchableOpacity>
          <TouchableOpacity style={vt.bulkBtn} onPress={handleBulkInventory}>
            <Feather name="layers" size={ICON.sm} color={CYAN} />
            <Text style={vt.bulkBtnText}>Inventory</Text>
          </TouchableOpacity>
          <TouchableOpacity style={vt.bulkBtn} onPress={() => Alert.alert('Bulk Status Edit', 'Set status for all variants.')}>
            <Feather name="toggle-right" size={ICON.sm} color={SUCCESS} />
            <Text style={vt.bulkBtnText}>Status</Text>
          </TouchableOpacity>
        </View>
      </BrandthreadCard>

      {product.variants.length === 0 ? (
        <EmptyState
          icon="sliders"
          title="No variants"
          description="Add sizes, colors, or other options to create variants."
          action={{ label: 'Add variant', onPress: () => Alert.alert('Add Variant'), icon: 'plus' }}
        />
      ) : (
        <View style={{ paddingHorizontal: SP.md, gap: SP.sm }}>
          {product.variants.map(variant => {
            const price = variant.price ?? product.pricing.price;
            const inStock = variant.inventoryQuantity > 0;
            const lowStock = variant.inventoryQuantity <= 5 && variant.inventoryQuantity > 0;
            return (
              <BrandthreadCard key={variant.id} style={{ marginBottom: 0 }}>
                <View style={vt.variantHeader}>
                  <Text style={vt.variantTitle}>{variant.title}</Text>
                  <View style={vt.variantHeaderRight}>
                    <Text style={vt.variantPrice}>{formatCurrency(price)}</Text>
                    <StatusBadge
                      label={variant.status.toUpperCase()}
                      variant={variant.status === 'active' ? 'success' : 'neutral'}
                      small
                    />
                  </View>
                </View>
                {variant.sku ? (
                  <Text style={vt.sku}>SKU: {variant.sku}</Text>
                ) : null}
                <View style={vt.variantStockRow}>
                  <Feather name="package" size={12} color={inStock ? (lowStock ? ORANGE : SUCCESS) : RED} />
                  <Text style={[vt.stockText, { color: inStock ? (lowStock ? ORANGE : SUCCESS) : RED }]}>
                    {variant.inventoryQuantity} in stock
                  </Text>
                  {variant.incomingQuantity > 0 && (
                    <Text style={vt.incomingText}>· {variant.incomingQuantity} incoming</Text>
                  )}
                </View>
                <View style={vt.variantActions}>
                  <TouchableOpacity
                    style={vt.actionBtn}
                    onPress={() => Alert.alert('Edit Variant', `Edit ${variant.title}`)}
                  >
                    <Feather name="edit-2" size={12} color={PURPLE_LIGHT} />
                    <Text style={vt.actionBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[vt.actionBtn, { borderColor: RED_DIM }]}
                    onPress={() => Alert.alert('Delete Variant', `Delete ${variant.title}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => Alert.alert('Deleted') },
                    ])}
                  >
                    <Feather name="trash-2" size={12} color={RED} />
                    <Text style={[vt.actionBtnText, { color: RED }]}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </BrandthreadCard>
            );
          })}
        </View>
      )}
    </View>
  );
}

const vt = StyleSheet.create({
  bulkTitle:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.sm },
  bulkRow:         { flexDirection: 'row', gap: SP.sm },
  bulkBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                     backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm, paddingVertical: SP.sm,
                     borderWidth: 1, borderColor: BORDER },
  bulkBtnText:     { fontSize: FS.xs, fontFamily: FONT.medium, color: FG },
  variantHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  variantHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  variantTitle:    { fontSize: FS.base, fontFamily: FONT.bold, color: FG, flex: 1 },
  variantPrice:    { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  sku:             { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginBottom: 6 },
  variantStockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 10 },
  stockText:       { fontSize: FS.xs, fontFamily: FONT.semibold },
  incomingText:    { fontSize: FS.xs, fontFamily: FONT.regular, color: BLUE },
  variantActions:  { flexDirection: 'row', gap: SP.sm },
  actionBtn:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 6,
                     backgroundColor: PURPLE_DIM, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER_ACTIVE },
  actionBtnText:   { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
});

// ─── Inventory Tab ────────────────────────────────────────────────────────────

function InventoryTab({ product, setProduct, id }: { product: Product; setProduct: (p: Product) => void; id: string }) {
  const router = useRouter();
  const inv = product.inventory;
  const [invItems, setInvItems] = useState<InventoryItem[]>([]);

  useEffect(() => {
    getItemsByProduct(product.id).then(setInvItems).catch(() => {});
  }, [product.id]);

  const totalOnHand   = invItems.reduce((s, i) => s + i.onHand, 0);
  const totalAvail    = invItems.reduce((s, i) => s + i.available, 0);
  const totalReserved = invItems.reduce((s, i) => s + i.reserved, 0);

  // Fix 1: doAdjust calls adjustInventory then reloads product
  const doAdjust = async (delta: number, reason: string) => {
    await adjustInventory(product.id, undefined, delta, reason);
    const refreshed = await getProduct(id);
    if (refreshed) setProduct(refreshed);
    // Reload inv items
    getItemsByProduct(product.id).then(setInvItems).catch(() => {});
  };

  // Fix 1: Adjust Stock button with Alert options
  const handleAdjustStock = () => {
    Alert.alert('Adjust stock', 'Enter adjustment (+/- units)', [
      { text: 'Add 5', onPress: () => doAdjust(5, 'Manual add') },
      { text: 'Remove 5', onPress: () => doAdjust(-5, 'Manual remove') },
      { text: 'Set to 0', onPress: () => doAdjust(-product.inventory.totalStock, 'Reset to zero') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const invOnHand   = invItems.length > 0 ? totalOnHand   : inv.totalStock;
  const invAvail    = invItems.length > 0 ? totalAvail    : inv.availableStock;
  const invReserved = invItems.length > 0 ? totalReserved : inv.reservedStock;

  function invItemStatusVariant(item: InventoryItem): 'success' | 'warning' | 'error' | 'neutral' {
    if (item.status === 'available') return 'success';
    if (item.status === 'low_stock') return 'warning';
    if (item.status === 'out_of_stock') return 'error';
    return 'neutral';
  }

  function invItemStatusLabel(item: InventoryItem): string {
    switch (item.status) {
      case 'available':    return 'In Stock';
      case 'low_stock':    return 'Low Stock';
      case 'out_of_stock': return 'Out of Stock';
      case 'reserved':     return 'Reserved';
      case 'incoming':     return 'Incoming';
      case 'pre_order':    return 'Pre-Order';
      default:             return item.status;
    }
  }

  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      <SectionHeader title="Inventory Summary" />

      {/* Stat strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.md }}>
        <StatCard label="On Hand"   value={String(invOnHand)}        icon="layers"       accent={CYAN}    style={{ minWidth: 100 }} />
        <StatCard label="Available" value={String(invAvail)}          icon="check-circle" accent={SUCCESS} style={{ minWidth: 100 }} />
        <StatCard label="Reserved"  value={String(invReserved)}       icon="lock"         accent={ORANGE}  style={{ minWidth: 100 }} />
        <StatCard label="Incoming"  value={String(inv.incomingStock)} icon="truck"        accent={BLUE}    style={{ minWidth: 100 }} />
      </ScrollView>

      {/* Actions */}
      <View style={{ paddingHorizontal: SP.md, flexDirection: 'row', gap: SP.sm }}>
        <PrimaryButton
          label="Adjust Stock"
          icon="plus-circle"
          onPress={handleAdjustStock}
          style={{ flex: 1 }}
        />
        <SecondaryButton
          label="View Full Inventory"
          onPress={() => router.push('/inventory' as never)}
          style={{ flex: 1 }}
        />
      </View>

      {/* Inventory items from inventoryService */}
      {invItems.length > 0 && (
        <View style={{ paddingHorizontal: SP.md }}>
          <SectionHeader title="Inventory by Variant" style={{ paddingHorizontal: 0 }} />
          <BrandthreadCard>
            {invItems.map((item, idx) => (
              <View key={item.id}>
                {idx > 0 && <View style={invS.divider} />}
                <View style={invS.variantRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={invS.variantName}>{item.variantLabel}</Text>
                    <Text style={invS.variantSku}>SKU: {item.sku}</Text>
                  </View>
                  <StatusBadge label={invItemStatusLabel(item)} variant={invItemStatusVariant(item)} small />
                  <TouchableOpacity
                    style={[invS.adjBtn, { marginLeft: SP.sm }]}
                    onPress={() => router.push(('/inventory-adjust?itemId=' + item.id) as never)}
                  >
                    <Feather name="sliders" size={12} color={PURPLE} />
                  </TouchableOpacity>
                </View>
                <View style={invS.itemStatsRow}>
                  <Text style={invS.itemStat}>{item.available} avail</Text>
                  <Text style={invS.itemStatDot}>·</Text>
                  <Text style={invS.itemStat}>{item.onHand} on hand</Text>
                  {item.reserved > 0 && (
                    <>
                      <Text style={invS.itemStatDot}>·</Text>
                      <Text style={invS.itemStat}>{item.reserved} reserved</Text>
                    </>
                  )}
                  {item.incoming > 0 && (
                    <>
                      <Text style={invS.itemStatDot}>·</Text>
                      <Text style={[invS.itemStat, { color: BLUE }]}>{item.incoming} incoming</Text>
                    </>
                  )}
                </View>
              </View>
            ))}
          </BrandthreadCard>
        </View>
      )}

      {/* Fallback: by product variant when no inventory items */}
      {invItems.length === 0 && product.variants.length > 0 && (
        <View style={{ paddingHorizontal: SP.md }}>
          <SectionHeader title="Inventory by Variant" style={{ paddingHorizontal: 0 }} />
          <BrandthreadCard>
            {product.variants.map((variant, idx) => (
              <View key={variant.id}>
                {idx > 0 && <View style={invS.divider} />}
                <View style={invS.variantRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={invS.variantName}>{variant.title}</Text>
                    {variant.sku ? <Text style={invS.variantSku}>{variant.sku}</Text> : null}
                  </View>
                  <TouchableOpacity
                    style={invS.adjBtn}
                    onPress={() => doAdjust(-1, `Decrease ${variant.title}`)}
                  >
                    <Feather name="minus" size={12} color={RED} />
                  </TouchableOpacity>
                  <Text style={invS.qty}>{variant.inventoryQuantity}</Text>
                  <TouchableOpacity
                    style={invS.adjBtn}
                    onPress={() => doAdjust(1, `Increase ${variant.title}`)}
                  >
                    <Feather name="plus" size={12} color={SUCCESS} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </BrandthreadCard>
        </View>
      )}
    </View>
  );
}

const invS = StyleSheet.create({
  variantRow:    { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm },
  variantName:   { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  variantSku:    { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  adjBtn:        { width: 28, height: 28, borderRadius: RADIUS.sm, backgroundColor: CARD_ELEVATED,
                   borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  qty:           { fontSize: FS.base, fontFamily: FONT.bold, color: FG, minWidth: 32, textAlign: 'center' },
  divider:       { height: 1, backgroundColor: BORDER },
  historyRow:    { flexDirection: 'row', alignItems: 'center' },
  historyReason: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  historyDate:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  historyDelta:  { fontSize: FS.lg, fontFamily: FONT.bold },
  itemStatsRow:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: SP.sm, flexWrap: 'wrap' },
  itemStat:      { fontSize: FS.xs, fontFamily: FONT.medium, color: SUBTLE },
  itemStatDot:   { fontSize: FS.xs, color: SUBTLE },
});

// ─── Orders Tab ───────────────────────────────────────────────────────────────

const DEMO_ORDERS = [
  { id: 'ord_1042', customer: 'Alex Carter', qty: 2, date: '2025-01-12', status: 'fulfilled' as const, total: 136 },
  { id: 'ord_1038', customer: 'Sam Rivera', qty: 1, date: '2025-01-10', status: 'processing' as const, total: 68 },
  { id: 'ord_1031', customer: 'Morgan Lee', qty: 3, date: '2025-01-07', status: 'fulfilled' as const, total: 204 },
];

function OrdersTab({ product, router }: { product: Product; router: ReturnType<typeof useRouter> }) {
  const hasOrders = product.totalSales > 0;

  if (!hasOrders && DEMO_ORDERS.length === 0) {
    return (
      <EmptyState
        icon="shopping-bag"
        title="No orders yet"
        description="Orders for this product appear here."
        style={{ marginTop: SP.xl }}
      />
    );
  }

  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      <SectionHeader title={`Orders containing this product`} />
      <View style={{ paddingHorizontal: SP.md, gap: SP.sm }}>
        {DEMO_ORDERS.map(order => (
          <BrandthreadCard key={order.id}>
            <View style={ord.orderHeader}>
              <View>
                <Text style={ord.orderId}>#{order.id.replace('ord_', '')}</Text>
                <Text style={ord.customer}>{order.customer}</Text>
              </View>
              <StatusBadge
                label={order.status.toUpperCase()}
                variant={order.status === 'fulfilled' ? 'success' : 'info'}
              />
            </View>
            <View style={ord.orderMeta}>
              <Text style={ord.metaText}>Qty: {order.qty} · {formatCurrency(order.total)}</Text>
              <Text style={ord.metaDate}>{order.date}</Text>
            </View>
            <TouchableOpacity
              style={ord.viewBtn}
              onPress={() => Alert.alert('View Order', `Navigate to order #${order.id}`)}
            >
              <Text style={ord.viewBtnText}>View order</Text>
              <Feather name="arrow-right" size={12} color={PURPLE_LIGHT} />
            </TouchableOpacity>
          </BrandthreadCard>
        ))}
      </View>
    </View>
  );
}

const ord = StyleSheet.create({
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SP.sm },
  orderId:     { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  customer:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  orderMeta:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.sm },
  metaText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  metaDate:    { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  viewBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start',
                 paddingVertical: 4 },
  viewBtnText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
});

// ─── Production Tab ───────────────────────────────────────────────────────────

const PRODUCTION_STAGES = ['Quote', 'Sample', 'Production', 'Quality', 'Shipped', 'Done'];
const STAGE_MAP: Record<string, number> = {
  none: -1, quote_requested: 0, quote_received: 0, sample_pending: 1,
  sample_approved: 1, in_production: 2, quality_check: 3, shipped: 4, done: 5,
};

function ProductionTab({ product, router }: { product: Product; router: ReturnType<typeof useRouter> }) {
  const mfg = product.manufacturing;
  const stageIdx = STAGE_MAP[mfg.stage] ?? -1;

  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      <SectionHeader title="Manufacturing" />

      <GradientCard glow style={{ marginHorizontal: SP.md }}>
        <View style={pt.mfgHeader}>
          <View>
            <Text style={pt.mfgName}>{mfg.manufacturerName ?? 'No manufacturer assigned'}</Text>
            <Text style={pt.mfgSub}>{mfg.requiredQuantity ? `${mfg.requiredQuantity} units ordered` : 'No quantity set'}</Text>
          </View>
          <StatusBadge
            label={mfg.stage === 'none' ? 'NOT STARTED' : mfg.stage.replace(/_/g, ' ').toUpperCase()}
            variant={mfg.stage === 'none' ? 'neutral' : mfg.stage === 'shipped' ? 'success' : 'info'}
          />
        </View>

        {/* Progress steps */}
        <View style={pt.stagesRow}>
          {PRODUCTION_STAGES.map((stage, idx) => {
            const done = idx <= stageIdx;
            const current = idx === stageIdx;
            return (
              <View key={stage} style={pt.stageItem}>
                <View style={[pt.stageDot, done && pt.stageDotDone, current && pt.stageDotCurrent]}>
                  {done && <Feather name="check" size={8} color="#fff" />}
                </View>
                {idx < PRODUCTION_STAGES.length - 1 && (
                  <View style={[pt.stageLine, done && pt.stageLineDone]} />
                )}
                <Text style={[pt.stageLabel, done && pt.stageLabelDone]}>{stage}</Text>
              </View>
            );
          })}
        </View>

        {mfg.productionDeadline && (
          <Text style={pt.deadline}>
            Est. completion: {new Date(mfg.productionDeadline).toLocaleDateString()}
          </Text>
        )}
        {mfg.unitsInProduction && (
          <Text style={pt.unitsText}>{mfg.unitsInProduction} units in production</Text>
        )}
      </GradientCard>

      {mfg.stage === 'none' && (
        <View style={{ paddingHorizontal: SP.md }}>
          <SecondaryButton
            label="Request Quote"
            icon="send"
            onPress={() => Alert.alert('Request Quote', 'Send quote request to manufacturer.')}
          />
        </View>
      )}

      <View style={{ paddingHorizontal: SP.md }}>
        <NavigationCard
          icon="tool"
          label="View Manufacturer"
          description={mfg.manufacturerName ?? 'Find a manufacturer'}
          onPress={() => Alert.alert('Manufacturer', 'Navigate to manufacturer profile.')}
          accent={PURPLE}
        />
      </View>

      {mfg.techPackUri && (
        <View style={{ paddingHorizontal: SP.md }}>
          <NavigationCard
            icon="file-text"
            label="Tech Pack"
            description="View uploaded tech pack document"
            onPress={() => Alert.alert('Tech Pack', 'Open tech pack viewer.')}
            accent={BLUE}
          />
        </View>
      )}
    </View>
  );
}

const pt = StyleSheet.create({
  mfgHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SP.md },
  mfgName:         { fontSize: FS.base, fontFamily: FONT.bold, color: FG },
  mfgSub:          { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED, marginTop: 2 },
  stagesRow:       { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: SP.md },
  stageItem:       { alignItems: 'center', flex: 1, position: 'relative' },
  stageDot:        { width: 18, height: 18, borderRadius: 9, backgroundColor: CARD, borderWidth: 1,
                     borderColor: BORDER, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  stageDotDone:    { backgroundColor: PURPLE, borderColor: PURPLE },
  stageDotCurrent: { backgroundColor: CYAN, borderColor: CYAN, ...SHADOW_PURPLE },
  stageLine:       { position: 'absolute', top: 8, left: '50%', right: '-50%', height: 1, backgroundColor: BORDER },
  stageLineDone:   { backgroundColor: PURPLE },
  stageLabel:      { fontSize: 8, fontFamily: FONT.medium, color: MUTED, marginTop: 4, textAlign: 'center' },
  stageLabelDone:  { color: PURPLE_LIGHT },
  deadline:        { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  unitsText:       { fontSize: FS.xs, fontFamily: FONT.medium, color: CYAN },
});

// ─── Content Tab ──────────────────────────────────────────────────────────────

const DEMO_CONTENT = [
  { id: 'c1', type: 'Reel', date: '2025-01-11', views: 12400, clicks: 342, purchases: 18, grad: [PURPLE, CYAN] as [string, string] },
  { id: 'c2', type: 'Story', date: '2025-01-09', views: 5800, clicks: 187, purchases: 9,  grad: [ORANGE, GOLD] as [string, string] },
  { id: 'c3', type: 'Post',  date: '2025-01-06', views: 8200, clicks: 261, purchases: 14, grad: [BLUE, CYAN] as [string, string] },
];

function ContentTab({ product, router, id }: { product: Product; router: ReturnType<typeof useRouter>; id: string }) {
  const hasContent = DEMO_CONTENT.length > 0;

  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      <SectionHeader
        title="Seller posts featuring this product"
        action={{ label: 'Create post', onPress: () => router.push('/create-post' as never) }}
      />

      {!hasContent ? (
        <EmptyState
          icon="video"
          title="No posts yet"
          description="Create content with this product tagged."
          action={{ label: 'Create post', onPress: () => router.push('/create-post' as never), icon: 'video' }}
        />
      ) : (
        <View style={{ paddingHorizontal: SP.md, gap: SP.sm }}>
          {DEMO_CONTENT.map(item => (
            <BrandthreadCard key={item.id}>
              <View style={ct.contentRow}>
                <LinearGradient colors={item.grad} style={ct.thumbnail} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                  <Feather name="play-circle" size={20} color="rgba(255,255,255,0.8)" />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <View style={ct.contentHeader}>
                    <StatusBadge label={item.type.toUpperCase()} variant="purple" small />
                    <Text style={ct.contentDate}>{item.date}</Text>
                  </View>
                  <View style={ct.statsRow}>
                    <View style={ct.stat}>
                      <Feather name="eye" size={10} color={MUTED} />
                      <Text style={ct.statText}>{(item.views / 1000).toFixed(1)}k</Text>
                    </View>
                    <View style={ct.stat}>
                      <Feather name="mouse-pointer" size={10} color={MUTED} />
                      <Text style={ct.statText}>{item.clicks}</Text>
                    </View>
                    <View style={ct.stat}>
                      <Feather name="shopping-bag" size={10} color={SUCCESS} />
                      <Text style={[ct.statText, { color: SUCCESS }]}>{item.purchases}</Text>
                    </View>
                  </View>
                </View>
              </View>
            </BrandthreadCard>
          ))}
        </View>
      )}
    </View>
  );
}

const ct = StyleSheet.create({
  contentRow:    { flexDirection: 'row', gap: SP.md, alignItems: 'center' },
  thumbnail:     { width: 56, height: 56, borderRadius: RADIUS.sm, alignItems: 'center', justifyContent: 'center' },
  contentHeader: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm },
  contentDate:   { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  statsRow:      { flexDirection: 'row', gap: SP.md },
  stat:          { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statText:      { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
});

// ─── Analytics Tab ────────────────────────────────────────────────────────────

function AnalyticsTab({
  analytics, loading, product,
}: {
  analytics: Awaited<ReturnType<typeof getProductAnalytics>> | null;
  loading: boolean;
  product: Product;
}) {
  if (loading || !analytics) {
    return (
      <View style={{ padding: SP.md, gap: SP.md }}>
        <LoadingSkeleton height={80} />
        <LoadingSkeleton height={80} />
        <LoadingSkeleton height={160} />
      </View>
    );
  }

  // Fix 5: use revenueByDay data for bar chart with proper max revenue scaling
  const maxRev = Math.max(...analytics.revenueByDay.map(d => d.revenue), 1);

  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      <SectionHeader title="Performance" />

      {/* 2-row stat grid */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.md }}>
        <StatCard label="Revenue" value={formatCurrency(analytics.revenue)} icon="dollar-sign" accent={GOLD} style={{ minWidth: 120 }} />
        <StatCard label="Units Sold" value={String(analytics.unitsSold)} icon="shopping-bag" accent={PURPLE} style={{ minWidth: 120 }} />
        <StatCard label="Page Views" value={String(analytics.pageViews)} icon="eye" accent={CYAN} style={{ minWidth: 120 }} />
        <StatCard label="Add to Cart" value={String(analytics.addToCartCount)} icon="shopping-cart" accent={BLUE} style={{ minWidth: 120 }} />
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.md }}>
        <StatCard label="Conversion" value={`${(analytics.conversionRate * 100).toFixed(1)}%`} icon="trending-up" accent={SUCCESS} style={{ minWidth: 120 }} />
        <StatCard label="Refund Rate" value={`${(analytics.refundRate * 100).toFixed(1)}%`} icon="refresh-cw" accent={ORANGE} style={{ minWidth: 120 }} />
        <StatCard label="Return Rate" value={`${(analytics.returnRate * 100).toFixed(1)}%`} icon="rotate-ccw" accent={RED} style={{ minWidth: 120 }} />
        <StatCard label="Sell-Through" value={`${(analytics.sellThroughRate * 100).toFixed(0)}%`} icon="bar-chart-2" accent={CYAN} style={{ minWidth: 120 }} />
      </ScrollView>

      {/* Bar chart — Fix 5: bars scaled by maxRev, height = (day.revenue / maxRev) * 60 */}
      <View style={{ paddingHorizontal: SP.md }}>
        <SectionHeader title="Revenue — Last 14 Days" style={{ paddingHorizontal: 0 }} />
        <BrandthreadCard>
          <View style={an.chartRow}>
            {analytics.revenueByDay.map((day, idx) => {
              const barH = Math.max(4, (day.revenue / maxRev) * 60);
              return (
                <View key={day.date} style={an.barWrap}>
                  <View style={an.barContainer}>
                    <LinearGradient
                      colors={GRAD_PRIMARY}
                      start={{ x: 0, y: 1 }}
                      end={{ x: 0, y: 0 }}
                      style={[an.bar, { height: barH }]}
                    />
                  </View>
                  {idx % 7 === 0 && (
                    <Text style={an.barLabel}>{day.date.slice(5)}</Text>
                  )}
                </View>
              );
            })}
          </View>
        </BrandthreadCard>
      </View>

      {/* Best performers */}
      <View style={{ paddingHorizontal: SP.md }}>
        <SectionHeader title="Best Performers" style={{ paddingHorizontal: 0 }} />
        <BrandthreadCard elevated>
          {analytics.bestVariantId && (
            <View style={an.perfRow}>
              <Feather name="star" size={14} color={GOLD} />
              <Text style={an.perfLabel}>Best Variant</Text>
              <Text style={an.perfValue}>
                {product.variants.find(v => v.id === analytics.bestVariantId)?.title ?? analytics.bestVariantId}
              </Text>
            </View>
          )}
          {analytics.bestSize && (
            <>
              <View style={an.perfDivider} />
              <View style={an.perfRow}>
                <Feather name="maximize" size={14} color={PURPLE_LIGHT} />
                <Text style={an.perfLabel}>Best Size</Text>
                <Text style={an.perfValue}>{analytics.bestSize}</Text>
              </View>
            </>
          )}
          {analytics.bestColor && (
            <>
              <View style={an.perfDivider} />
              <View style={an.perfRow}>
                <Feather name="droplet" size={14} color={CYAN} />
                <Text style={an.perfLabel}>Best Color</Text>
                <Text style={an.perfValue}>{analytics.bestColor}</Text>
              </View>
            </>
          )}
        </BrandthreadCard>
      </View>
    </View>
  );
}

const an = StyleSheet.create({
  chartRow:    { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 70 },
  barWrap:     { flex: 1, alignItems: 'center' },
  barContainer:{ flex: 1, justifyContent: 'flex-end', width: '100%' },
  bar:         { width: '100%', borderRadius: 2 },
  barLabel:    { fontSize: 8, fontFamily: FONT.regular, color: MUTED, marginTop: 3 },
  perfRow:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingVertical: SP.sm },
  perfLabel:   { flex: 1, fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  perfValue:   { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  perfDivider: { height: 1, backgroundColor: BORDER },
});

// ─── Store Page Tab ───────────────────────────────────────────────────────────

function StoreTab({
  product, pricing, coverImage, router, id,
}: {
  product: Product;
  pricing: ReturnType<typeof calcPricing>;
  coverImage: Product['media'][0] | undefined;
  router: ReturnType<typeof useRouter>;
  id: string;
}) {
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [descOpen, setDescOpen] = useState(false);

  const sizeOption = product.options.find(o => o.type === 'size');
  const colorOption = product.options.find(o => o.type === 'color');
  const stockStatus = isOutOfStock(product.inventory.totalStock, product.inventory.policy) ? 'out' :
                      isLowStock(product.inventory.totalStock, product.inventory.lowStockThreshold) ? 'low' : 'in';

  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      <SectionHeader title="Buyer Store Preview" />

      {/* Preview card */}
      <BrandthreadCard elevated style={{ marginHorizontal: SP.md, padding: 0, overflow: 'hidden' }}>
        {/* Cover */}
        {coverImage ? (
          <Image source={{ uri: coverImage.uri }} style={st.coverImg} resizeMode="cover" />
        ) : (
          <LinearGradient colors={GRAD_PRIMARY} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.coverPlaceholder}>
            <Feather name="image" size={ICON.xxl} color="rgba(255,255,255,0.4)" />
          </LinearGradient>
        )}

        <View style={{ padding: SP.md, gap: SP.md }}>
          {/* Name & price */}
          <View>
            <Text style={st.productName}>{product.name}</Text>
            <View style={st.priceRow}>
              <Text style={st.price}>{formatCurrency(pricing.retailPrice)}</Text>
              {pricing.compareAtPrice && (
                <Text style={st.comparePrice}>{formatCurrency(pricing.compareAtPrice)}</Text>
              )}
              {pricing.discountPercent && (
                <StatusBadge label={`Save ${pricing.discountPercent}%`} variant="error" small />
              )}
            </View>
          </View>

          {/* Size selector */}
          {sizeOption && (
            <View>
              <Text style={st.optionLabel}>Select Size</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={st.chipRow}>
                  {sizeOption.values.map(v => (
                    <FilterChip
                      key={v.id}
                      label={v.value}
                      active={selectedSize === v.id}
                      onPress={() => setSelectedSize(selectedSize === v.id ? null : v.id)}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Color selector */}
          {colorOption && (
            <View>
              <Text style={st.optionLabel}>Select Color</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={st.chipRow}>
                  {colorOption.values.map(v => (
                    <FilterChip
                      key={v.id}
                      label={v.value}
                      active={selectedColor === v.id}
                      onPress={() => setSelectedColor(selectedColor === v.id ? null : v.id)}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          {/* Stock status */}
          <View style={st.stockRow}>
            <Feather
              name={stockStatus === 'out' ? 'x-circle' : stockStatus === 'low' ? 'alert-circle' : 'check-circle'}
              size={14}
              color={stockStatus === 'out' ? RED : stockStatus === 'low' ? ORANGE : SUCCESS}
            />
            <Text style={[st.stockText, {
              color: stockStatus === 'out' ? RED : stockStatus === 'low' ? ORANGE : SUCCESS
            }]}>
              {stockStatus === 'out' ? 'Out of stock' : stockStatus === 'low' ? `Only ${product.inventory.availableStock} left` : 'In stock'}
            </Text>
          </View>

          {/* Pre-order info */}
          {product.salesModel === 'pre-order' && product.preorderSettings && (
            <GradientCard colors={['rgba(59,130,246,0.12)', 'rgba(34,211,238,0.04)'] as [string, string]}>
              <View style={st.preorderRow}>
                <Feather name="clock" size={14} color={BLUE} />
                <Text style={st.preorderText}>
                  Pre-order · {product.preorderSettings.unitsOrdered}/{product.preorderSettings.fundingGoalUnits ?? '?'} units ordered
                </Text>
              </View>
              {product.preorderSettings.estimatedShippingDate && (
                <Text style={st.preorderSub}>
                  Est. ship: {new Date(product.preorderSettings.estimatedShippingDate).toLocaleDateString()}
                </Text>
              )}
            </GradientCard>
          )}

          {/* CTA buttons */}
          <View style={st.ctaRow}>
            <SecondaryButton
              label="Add to Cart"
              icon="shopping-cart"
              onPress={() => Alert.alert('Add to Cart', 'Item added to cart.')}
              style={{ flex: 1 }}
            />
            <PrimaryButton
              label="Buy Now"
              icon="zap"
              onPress={() => Alert.alert('Buy Now', 'Proceeding to checkout.')}
              style={{ flex: 1 }}
            />
          </View>

          {/* Description accordion */}
          <TouchableOpacity
            onPress={() => { Haptics.selectionAsync(); setDescOpen(o => !o); }}
            style={st.descHeader}
          >
            <Text style={st.descTitle}>Description</Text>
            <Feather name={descOpen ? 'chevron-up' : 'chevron-down'} size={ICON.sm} color={MUTED} />
          </TouchableOpacity>
          {descOpen && product.description ? (
            <Text style={st.descText}>{product.description}</Text>
          ) : null}

          {/* Seller card */}
          <NavigationCard
            icon="user"
            label="Seller"
            description={product.vendor ?? 'View seller profile'}
            onPress={() => Alert.alert('Seller', 'Navigate to seller profile.')}
            accent={PURPLE}
          />
        </View>
      </BrandthreadCard>

      {/* Fix 6: Open full preview routes to /product-store with id param */}
      <View style={{ paddingHorizontal: SP.md }}>
        <PrimaryButton
          label="Open Full Preview"
          icon="external-link"
          onPress={() => router.push(('/product-store?id=' + id) as never)}
        />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  coverImg:        { width: '100%', height: 200 },
  coverPlaceholder:{ width: '100%', height: 200, alignItems: 'center', justifyContent: 'center' },
  productName:     { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, marginBottom: SP.sm },
  priceRow:        { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  price:           { fontSize: FS.lg, fontFamily: FONT.bold, color: FG },
  comparePrice:    { fontSize: FS.base, fontFamily: FONT.regular, color: MUTED, textDecorationLine: 'line-through' },
  optionLabel:     { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, marginBottom: SP.sm },
  chipRow:         { flexDirection: 'row', gap: SP.sm, paddingBottom: SP.xs },
  stockRow:        { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  stockText:       { fontSize: FS.sm, fontFamily: FONT.semibold },
  preorderRow:     { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: 4 },
  preorderText:    { fontSize: FS.sm, fontFamily: FONT.medium, color: BLUE, flex: 1 },
  preorderSub:     { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  ctaRow:          { flexDirection: 'row', gap: SP.sm },
  descHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                     paddingVertical: SP.sm, borderTopWidth: 1, borderTopColor: BORDER },
  descTitle:       { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  descText:        { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
});

// ─── Root Styles ──────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root:         { flex: 1, backgroundColor: BG },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md,
                  paddingVertical: SP.sm, minHeight: COMP.headerH, gap: SP.sm,
                  borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:      { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
                  borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { flex: 1, fontSize: FS.base, fontFamily: FONT.bold, color: FG, letterSpacing: -0.2 },
  headerRight:  { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  headerBtn:    { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: PURPLE_DIM,
                  borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER_ACTIVE },
  editBtnText:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  iconBtnSmall: { width: 36, height: 36, borderRadius: RADIUS.sm, backgroundColor: CARD,
                  borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  tabBarWrap:   { borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: SURFACE },
  tabBarContent:{ paddingHorizontal: SP.sm },
  tabItem:      { paddingHorizontal: SP.md, paddingVertical: 12, alignItems: 'center', position: 'relative' },
  tabLabel:     { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  tabLabelActive:{ color: FG, fontFamily: FONT.semibold },
  tabUnderline: { position: 'absolute', bottom: 0, left: SP.md, right: SP.md, height: 2,
                  backgroundColor: PURPLE, borderRadius: RADIUS.pill },
  tabContent:   { flex: 1 },
  fab:          { position: 'absolute', right: SP.lg, width: 56, height: 56, borderRadius: 28,
                  overflow: 'hidden', ...SHADOW_PURPLE },
  fabGrad:      { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
});
