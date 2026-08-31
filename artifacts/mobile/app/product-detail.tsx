/**
 * Brandthread Product Detail Screen
 * 8-tab deep-dive into a single product: Overview, Variants, Inventory,
 * Orders, Production, Content, Analytics, Store page.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import AIBrainFAB from '@/components/AIBrainFAB';
import { View, Text, ScrollView, StyleSheet, Alert, Animated, Image, FlatList } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { BG, SURFACE, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, ORANGE, RED, RED_DIM, GOLD, GRAD_CARD_GLOW, FONT, FS, SP, RADIUS, COMP, ICON, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

import { AnimatedEntrance, BrandthreadCard, GradientCard, PrimaryButton, SecondaryButton, IconButton, SectionHeader, StatusBadge, StatCard, NavigationCard, LoadingSkeleton, EmptyState, FilterChip, PressableScale } from '@/components/BrandthreadUI';

import { getProduct, updateProduct, getProductAnalytics, archiveProduct, publishProduct, adjustInventory } from '@/services/productService';
import { Product, ProductVariant, ProductStatus } from '@/services/productTypes';
import { getItemsByProduct, adjustStock } from '@/services/inventoryService';
import { InventoryItem } from '@/services/inventoryTypes';
import { calcPricing, formatCurrency, isLowStock, isOutOfStock } from '@/lib/productUtils';
import { reportNetworkError } from '@/lib/networkNotice';

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
  const { theme } = useAppTheme();
  const s = React.useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; tab?: string }>();
  const id = params.id;

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Analytics state
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof getProductAnalytics>> | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(false);
  const [analyticsRetry, setAnalyticsRetry] = useState(0);

  const tabScrollRef = useRef<ScrollView>(null);

  const loadProduct = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const p = await getProduct(id);
      setProduct(p ?? null);
      setLoadError(false);
      // Fix 4: set initial tab from params after loading
      if (params.tab && TABS.some(t => t.key === params.tab)) {
        setActiveTab(params.tab as Tab);
      }
    } catch (error) {
      setLoadError(true);
      reportNetworkError(error, loadProduct);
    } finally {
      setLoading(false);
    }
  }, [id, params.tab]);

  // Load product
  useEffect(() => { void loadProduct(); }, [loadProduct]);

  // Load analytics when tab opens
  useEffect(() => {
    if (activeTab === 'analytics' && id && !analytics) {
      setAnalyticsLoading(true);
      getProductAnalytics(id).then(a => {
        setAnalytics(a);
        setAnalyticsError(false);
      }).catch(error => {
        setAnalyticsError(true);
        reportNetworkError(error, () => {
          setAnalytics(null);
          setActiveTab('analytics');
        });
      }).finally(() => setAnalyticsLoading(false));
    }
  }, [activeTab, id, analyticsRetry]);

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

  if (loadError && !product) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <EmptyState
          icon="wifi-off"
          title="Product couldn't load"
          description="Check your connection and try again."
          action={{ label: 'Try again', onPress: loadProduct, icon: 'refresh-cw' }}
        />
      </View>
    );
  }
  if (!product) {
    return (
      <View style={[s.root, { paddingTop: insets.top }]}>
        <EmptyState icon="package" title="Product not found" description="This product may have been deleted or the link is invalid." action={{ label: 'Go back', onPress: () => router.back() }} />
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
        <PressableScale
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
          style={s.backBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Back"
        >
          <Feather name="arrow-left" size={ICON.md} color={FG} />
        </PressableScale>

        <Text style={s.headerTitle} numberOfLines={1}>{product.name}</Text>

        <View style={s.headerRight}>
          {/* Fix 7: edit button navigates to /add-product with editId param */}
          <PressableScale
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push(('/add-product?editId=' + id) as never); }}
            style={s.headerBtn}
            accessibilityLabel={`Edit ${product.name}`}
          >
            <Text style={s.editBtnText}>Edit</Text>
          </PressableScale>
          <PressableScale
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              Alert.alert('Product Options', '', [
                { text: product.status === 'active' ? 'Archive' : 'Publish', onPress: () => {
                  if (product.status === 'active') {
                    archiveProduct(product.id).then(p => {
                      if (p) { setProduct(p); Alert.alert('Product archived'); }
                    }).catch(error => {
                      reportNetworkError(error, () => archiveProduct(product.id).then(p => p && setProduct(p)));
                      Alert.alert('Could not archive product', 'Check your connection and try again.');
                    });
                  } else {
                    publishProduct(product.id).then(p => {
                      if (p) { setProduct(p); Alert.alert('Product published'); }
                    }).catch(error => {
                      reportNetworkError(error, () => publishProduct(product.id).then(p => p && setProduct(p)));
                      Alert.alert('Could not publish product', 'Check your connection and try again.');
                    });
                  }
                }},
                { text: 'Duplicate', onPress: () => Alert.alert('Duplicating…') },
                { text: 'Share', onPress: () => Alert.alert('Share link copied') },
                { text: 'Cancel', style: 'cancel' },
              ]);
            }}
            style={s.iconBtnSmall}
            accessibilityLabel={`More actions for ${product.name}`}
          >
            <Feather name="more-horizontal" size={ICON.md} color={FG} />
          </PressableScale>
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
              <PressableScale
                key={tab.key}
                onPress={() => handleTabPress(tab.key, idx)}
                style={s.tabItem}
                accessibilityRole="tab"
                accessibilityLabel={`${tab.label} tab`}
                accessibilityState={{ selected: active }}
              >
                <Text style={[s.tabLabel, active && s.tabLabelActive]}>
                  {tab.label}
                </Text>
                {active && <View style={s.tabUnderline} />}
              </PressableScale>
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
        {activeTab === 'analytics'  && <AnalyticsTab  analytics={analytics} loading={analyticsLoading} error={analyticsError} onRetry={() => { setAnalyticsError(false); setAnalyticsRetry(value => value + 1); }} product={product} />}
        {activeTab === 'store'      && <StoreTab      product={product} pricing={pricing} coverImage={coverImage} router={router} id={id!} />}
      </ScrollView>

      {/* ── Floating Action Button ── */}
      <PressableScale
        style={[s.fab, { bottom: insets.bottom + SP.lg }]}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push(('/add-product?editId=' + id) as never); }}
      >
        <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.fabGrad}>
          <Feather name="edit-2" size={ICON.md} color={theme.onAccent} />
        </LinearGradient>
      </PressableScale>
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
  const { theme } = useAppTheme();
  const statusVariant = product.status === 'active' ? 'success' : product.status === 'draft' ? 'warning' : product.status === 'archived' ? 'neutral' : 'info';

  // Fix 8: show '—' if price is 0 or undefined; show '—' for margin if cost is undefined
  const priceDisplay = pricing.retailPriceCents ? formatCurrency(pricing.retailPriceCents) : '—';
  const marginDisplay = pricing.marginPercent !== undefined ? `${pricing.marginPercent.toFixed(0)}%` : '—';
  const profitDisplay = pricing.netProfitCents !== undefined ? formatCurrency(pricing.netProfitCents) : '—';

  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      {/* Hero card */}
      <AnimatedEntrance>
        <GradientCard glow style={{ marginHorizontal: SP.md, padding: 0, overflow: 'hidden' }}>
          {coverImage ? (
            <Image source={{ uri: coverImage.uri }} style={ov.heroImage} resizeMode="cover" />
          ) : (
            <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={ov.heroPlaceholder}>
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
              {pricing.compareAtPriceCents && (
                <Text style={ov.heroCompare}>{formatCurrency(pricing.compareAtPriceCents)}</Text>
              )}
              {pricing.discountPercent && (
                <StatusBadge label={`-${pricing.discountPercent}%`} variant="error" small />
              )}
            </View>
            {pricing.marginPercent !== undefined ? (
              <Text style={ov.heroMargin}>
                Profit: {profitDisplay} · Margin: {pricing.marginPercent.toFixed(1)}%
              </Text>
            ) : pricing.costCents === undefined ? (
              <Text style={ov.heroMargin}>Margin: — (add cost to calculate)</Text>
            ) : null}
          </View>
        </GradientCard>
      </AnimatedEntrance>

      {/* Stat strip */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ov.statStrip}>
        <StatCard label="Revenue" value={formatCurrency(product.totalRevenueCents)} icon="dollar-sign" accent={GOLD} style={ov.statCard} />
        <StatCard label="Sold" value={String(product.totalSales)} icon="shopping-bag" accent={theme.accent} style={ov.statCard} />
        <StatCard label="Stock" value={String(product.inventory.totalStock)} icon="layers" accent={theme.secondary} style={ov.statCard} />
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
  tag:             { backgroundColor: PURPLE_DIM, borderRadius: RADIUS.pill, paddingHorizontal: SP.sm + SP.xs, paddingVertical: SP.xs, borderWidth: 1, borderColor: BORDER_ACTIVE },
  tagText:         { fontSize: FS.xs, fontFamily: FONT.medium, color: PURPLE_LIGHT },
});

// ─── Variants Tab ─────────────────────────────────────────────────────────────

function VariantsTab({ product, setProduct, id }: { product: Product; setProduct: (p: Product) => void; id: string }) {
  const { theme } = useAppTheme();
  // Fix 2: bulk edit price handler
  const handleBulkPrice = () => {
    const currentPrice = product.pricing.priceCents;
    Alert.alert('Bulk Edit Price', `Current price: ${formatCurrency(currentPrice)}`, [
      {
        text: `Set all to ${formatCurrency(currentPrice)}`,
        onPress: () => {
          const updatedVariants = product.variants.map(v => ({ ...v, priceCents: currentPrice }));
          updateProduct(id, { variants: updatedVariants }).then(p => {
            if (p) { setProduct(p); Alert.alert('Variant prices updated'); }
          }).catch(error => {
            reportNetworkError(error, () => updateProduct(id, { variants: updatedVariants }).then(p => { if (p) setProduct(p); }));
            Alert.alert('Could not update variants', 'Check your connection and try again.');
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
            if (p) { setProduct(p); Alert.alert('Inventory updated'); }
          }).catch(error => {
            reportNetworkError(error, () => updateProduct(id, { variants: updatedVariants }).then(p => { if (p) setProduct(p); }));
            Alert.alert('Could not update inventory', 'Check your connection and try again.');
          });
        },
      },
      {
        text: 'Remove 5 from all',
        onPress: () => {
          const updatedVariants = product.variants.map(v => ({ ...v, inventoryQuantity: Math.max(0, v.inventoryQuantity - 5) }));
          updateProduct(id, { variants: updatedVariants }).then(p => {
            if (p) { setProduct(p); Alert.alert('Inventory updated'); }
          }).catch(error => {
            reportNetworkError(error, () => updateProduct(id, { variants: updatedVariants }).then(p => { if (p) setProduct(p); }));
            Alert.alert('Could not update inventory', 'Check your connection and try again.');
          });
        },
      },
      {
        text: 'Reset all to 0',
        onPress: () => {
          const updatedVariants = product.variants.map(v => ({ ...v, inventoryQuantity: 0 }));
          updateProduct(id, { variants: updatedVariants }).then(p => {
            if (p) { setProduct(p); Alert.alert('Inventory updated'); }
          }).catch(error => {
            reportNetworkError(error, () => updateProduct(id, { variants: updatedVariants }).then(p => { if (p) setProduct(p); }));
            Alert.alert('Could not update inventory', 'Check your connection and try again.');
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
        action={{ label: 'Add variant', onPress: () => Alert.alert('Add Variant', 'Select sizes, colors, and other options for this product.') }}
      />

      {/* Bulk edit */}
      <BrandthreadCard style={{ marginHorizontal: SP.md }}>
        <Text style={vt.bulkTitle}>Bulk Edit</Text>
        <View style={vt.bulkRow}>
          <PressableScale style={vt.bulkBtn} onPress={handleBulkPrice}>
            <Feather name="dollar-sign" size={ICON.sm} color={theme.accentLight} />
            <Text style={vt.bulkBtnText}>Price</Text>
          </PressableScale>
          <PressableScale style={vt.bulkBtn} onPress={handleBulkInventory}>
            <Feather name="layers" size={ICON.sm} color={theme.secondary} />
            <Text style={vt.bulkBtnText}>Inventory</Text>
          </PressableScale>
          <PressableScale style={vt.bulkBtn} onPress={() => Alert.alert('Bulk Status Edit', 'Set status for all variants.')}>
            <Feather name="toggle-right" size={ICON.sm} color={SUCCESS} />
            <Text style={vt.bulkBtnText}>Status</Text>
          </PressableScale>
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
            const price = variant.priceCents ?? product.pricing.priceCents;
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
                  <PressableScale
                    style={vt.actionBtn}
                    onPress={() => Alert.alert('Edit Variant', `Edit ${variant.title}`)}
                  >
                    <Feather name="edit-2" size={12} color={theme.accentLight} />
                    <Text style={vt.actionBtnText}>Edit</Text>
                  </PressableScale>
                  <PressableScale
                    style={[vt.actionBtn, { borderColor: RED_DIM }]}
                    onPress={() => Alert.alert('Delete Variant', `Delete ${variant.title}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => Alert.alert('Deleted') },
                    ])}
                  >
                    <Feather name="trash-2" size={12} color={RED} />
                    <Text style={[vt.actionBtnText, { color: RED }]}>Delete</Text>
                  </PressableScale>
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
  const { theme } = useAppTheme();
  const router = useRouter();
  const inv = product.inventory;
  const [invItems, setInvItems] = useState<InventoryItem[]>([]);
  const [invLoading, setInvLoading] = useState(true);
  const [invError, setInvError] = useState(false);

  const loadInventoryItems = useCallback(async () => {
    setInvLoading(true);
    try {
      setInvItems(await getItemsByProduct(product.id));
      setInvError(false);
    } catch (error) {
      setInvError(true);
      reportNetworkError(error, loadInventoryItems);
    } finally {
      setInvLoading(false);
    }
  }, [product.id]);

  useEffect(() => { void loadInventoryItems(); }, [loadInventoryItems]);

  const totalOnHand   = invItems.reduce((s, i) => s + i.onHand, 0);
  const totalAvail    = invItems.reduce((s, i) => s + i.available, 0);
  const totalReserved = invItems.reduce((s, i) => s + i.reserved, 0);

  // Fix 1: doAdjust calls adjustInventory then reloads product
  const doAdjust = async (delta: number, reason: string) => {
    try {
      await adjustInventory(product.id, undefined, delta, reason);
      const refreshed = await getProduct(id);
      if (refreshed) setProduct(refreshed);
      await loadInventoryItems();
      Alert.alert('Stock updated');
    } catch (error) {
      reportNetworkError(error, () => doAdjust(delta, reason));
      Alert.alert('Could not update stock', 'Check your connection and try again.');
    }
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
        <StatCard label="On Hand"   value={String(invOnHand)}        icon="layers"       accent={theme.secondary}    style={{ minWidth: 100 }} />
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

      {invLoading && <View style={{ paddingHorizontal: SP.md }}><LoadingSkeleton height={72} /></View>}
      {invError && !invLoading && (
        <EmptyState
          icon="wifi-off"
          title="Inventory details couldn't load"
          description="Your product totals are still shown above."
          action={{ label: 'Try again', onPress: loadInventoryItems, icon: 'refresh-cw' }}
        />
      )}

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
                  <PressableScale
                    style={[invS.adjBtn, { marginLeft: SP.sm }]}
                    onPress={() => router.push(('/inventory-adjust?itemId=' + item.id) as never)}
                    accessibilityLabel="Adjust inventory"
                  >
                    <Feather name="sliders" size={12} color={theme.accent} />
                  </PressableScale>
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
                  <PressableScale
                    style={invS.adjBtn}
                    onPress={() => doAdjust(-1, `Decrease ${variant.title}`)}
                    accessibilityLabel={`Decrease ${variant.title} inventory`}
                  >
                    <Feather name="minus" size={12} color={RED} />
                  </PressableScale>
                  <Text style={invS.qty}>{variant.inventoryQuantity}</Text>
                  <PressableScale
                    style={invS.adjBtn}
                    onPress={() => doAdjust(1, `Increase ${variant.title}`)}
                    accessibilityLabel={`Increase ${variant.title} inventory`}
                  >
                    <Feather name="plus" size={12} color={SUCCESS} />
                  </PressableScale>
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
  adjBtn:        { width: COMP.minTouchTarget, height: COMP.minTouchTarget, borderRadius: RADIUS.sm, backgroundColor: CARD_ELEVATED,
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

function OrdersTab({ product, router }: { product: Product; router: ReturnType<typeof useRouter> }) {
  return (
    <EmptyState
      icon="shopping-bag"
      title="Order details unavailable"
      description="Product-specific orders will appear here once the live order filter is connected."
      style={{ marginTop: SP.xl }}
    />
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
  const { theme } = useAppTheme();
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
                <View style={[pt.stageDot, done && { backgroundColor: theme.accent, borderColor: theme.accent }, current && { backgroundColor: theme.secondary, borderColor: theme.secondary, shadowColor: theme.shadowColor }]}>
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
          accent={theme.accent}
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
  stageLine:       { position: 'absolute', top: 8, left: '50%', right: '-50%', height: 1, backgroundColor: BORDER },
  stageLineDone:   { backgroundColor: PURPLE },
  stageLabel:      { fontSize: 8, fontFamily: FONT.medium, color: MUTED, marginTop: 4, textAlign: 'center' },
  stageLabelDone:  { color: PURPLE_LIGHT },
  deadline:        { fontSize: FS.xs, fontFamily: FONT.medium, color: MUTED },
  unitsText:       { fontSize: FS.xs, fontFamily: FONT.medium, color: CYAN },
});

// ─── Content Tab ──────────────────────────────────────────────────────────────

function ContentTab({ product, router, id }: { product: Product; router: ReturnType<typeof useRouter>; id: string }) {
  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      <SectionHeader
        title="Seller posts featuring this product"
        action={{ label: 'Create post', onPress: () => router.push('/create-post' as never) }}
      />

      <EmptyState
        icon="video"
        title="No posts yet"
        description="Create content with this product tagged. Performance appears here once real post analytics are available."
        action={{ label: 'Create post', onPress: () => router.push('/create-post' as never), icon: 'video' }}
      />
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
  analytics, loading, error, onRetry, product,
}: {
  analytics: Awaited<ReturnType<typeof getProductAnalytics>> | null;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  product: Product;
}) {
  const { theme } = useAppTheme();
  if (error) {
    return (
      <EmptyState
        icon="wifi-off"
        title="Analytics couldn't load"
        description="Check your connection and try again."
        action={{ label: 'Try again', onPress: onRetry, icon: 'refresh-cw' }}
      />
    );
  }
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
  const maxRev = Math.max(...analytics.revenueByDay.map(d => d.revenueCents), 1);

  return (
    <View style={{ gap: SP.md, paddingTop: SP.md }}>
      <SectionHeader title="Performance" />

      {/* 2-row stat grid */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.md }}>
        <StatCard label="Revenue" value={formatCurrency(analytics.revenueCents)} icon="dollar-sign" accent={GOLD} style={{ minWidth: 120 }} />
        <StatCard label="Units Sold" value={String(analytics.unitsSold)} icon="shopping-bag" accent={theme.accent} style={{ minWidth: 120 }} />
        <StatCard label="Page Views" value={String(analytics.pageViews)} icon="eye" accent={theme.secondary} style={{ minWidth: 120 }} />
        <StatCard label="Add to Cart" value={String(analytics.addToCartCount)} icon="shopping-cart" accent={BLUE} style={{ minWidth: 120 }} />
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: SP.sm, paddingHorizontal: SP.md }}>
        <StatCard label="Conversion" value={`${(analytics.conversionRate * 100).toFixed(1)}%`} icon="trending-up" accent={SUCCESS} style={{ minWidth: 120 }} />
        <StatCard label="Refund Rate" value={`${(analytics.refundRate * 100).toFixed(1)}%`} icon="refresh-cw" accent={ORANGE} style={{ minWidth: 120 }} />
        <StatCard label="Return Rate" value={`${(analytics.returnRate * 100).toFixed(1)}%`} icon="rotate-ccw" accent={RED} style={{ minWidth: 120 }} />
        <StatCard label="Sell-Through" value={`${(analytics.sellThroughRate * 100).toFixed(0)}%`} icon="bar-chart-2" accent={theme.secondary} style={{ minWidth: 120 }} />
      </ScrollView>

      {/* Bar chart — Fix 5: bars scaled by maxRev, height = (day.revenue / maxRev) * 60 */}
      <View style={{ paddingHorizontal: SP.md }}>
        <SectionHeader title="Revenue — Last 14 Days" style={{ paddingHorizontal: 0 }} />
        <BrandthreadCard>
          <View style={an.chartRow}>
            {analytics.revenueByDay.map((day, idx) => {
              const barH = Math.max(4, (day.revenueCents / maxRev) * 60);
              return (
                <View key={day.date} style={an.barWrap}>
                  <View style={an.barContainer}>
                    <LinearGradient
                      colors={theme.primaryGradient}
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
                <Feather name="maximize" size={14} color={theme.accentLight} />
                <Text style={an.perfLabel}>Best Size</Text>
                <Text style={an.perfValue}>{analytics.bestSize}</Text>
              </View>
            </>
          )}
          {analytics.bestColor && (
            <>
              <View style={an.perfDivider} />
              <View style={an.perfRow}>
                <Feather name="droplet" size={14} color={theme.secondary} />
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
  const { theme } = useAppTheme();
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
          <LinearGradient colors={theme.primaryGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.coverPlaceholder}>
            <Feather name="image" size={ICON.xxl} color="rgba(255,255,255,0.4)" />
          </LinearGradient>
        )}

        <View style={{ padding: SP.md, gap: SP.md }}>
          {/* Name & price */}
          <View>
            <Text style={st.productName}>{product.name}</Text>
            <View style={st.priceRow}>
              <Text style={st.price}>{formatCurrency(pricing.retailPriceCents)}</Text>
              {pricing.compareAtPriceCents && (
                <Text style={st.comparePrice}>{formatCurrency(pricing.compareAtPriceCents)}</Text>
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
            <GradientCard colors={[theme.accentDim, theme.secondaryDim]}>
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
          <PressableScale
            onPress={() => { Haptics.selectionAsync(); setDescOpen(o => !o); }}
            style={st.descHeader}
            accessibilityLabel="Description"
            accessibilityState={{ expanded: descOpen }}
          >
            <Text style={st.descTitle}>Description</Text>
            <Feather name={descOpen ? 'chevron-up' : 'chevron-down'} size={ICON.sm} color={MUTED} />
          </PressableScale>
          {descOpen && product.description ? (
            <Text style={st.descText}>{product.description}</Text>
          ) : null}

          {/* Seller card */}
          <NavigationCard
            icon="user"
            label="Seller"
            description={product.vendor ?? 'View seller profile'}
            onPress={() => Alert.alert('Seller', 'Navigate to seller profile.')}
            accent={theme.accent}
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

const createStyles = (theme: { accent: string; accentLight: string; accentDim: string; secondary: string; secondaryDim: string; shadowColor: string }) => {
  return StyleSheet.create({
  root:         { flex: 1, backgroundColor: BG },
  header:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SP.md,
                  paddingVertical: SP.sm, minHeight: COMP.headerH, gap: SP.sm,
                  borderBottomWidth: 1, borderBottomColor: BORDER },
  backBtn:      { width: COMP.minTouchTarget, height: COMP.minTouchTarget, borderRadius: RADIUS.sm, backgroundColor: CARD,
                  borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  headerTitle:  { flex: 1, fontSize: FS.base, fontFamily: FONT.bold, color: FG, letterSpacing: -0.2 },
  headerRight:  { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  headerBtn:    { minHeight: COMP.minTouchTarget, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: theme.accentDim,
                  borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER_ACTIVE },
  editBtnText:  { fontSize: FS.sm, fontFamily: FONT.semibold, color: theme.accentLight },
  iconBtnSmall: { width: COMP.minTouchTarget, height: COMP.minTouchTarget, borderRadius: RADIUS.sm, backgroundColor: CARD,
                  borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  tabBarWrap:   { borderBottomWidth: 1, borderBottomColor: BORDER, backgroundColor: SURFACE },
  tabBarContent:{ paddingHorizontal: SP.sm },
  tabItem:      { minHeight: COMP.minTouchTarget, paddingHorizontal: SP.md, paddingVertical: 12, alignItems: 'center', position: 'relative' },
  tabLabel:     { fontSize: FS.sm, fontFamily: FONT.medium, color: MUTED },
  tabLabelActive:{ color: FG, fontFamily: FONT.semibold },
  tabUnderline: { position: 'absolute', bottom: 0, left: SP.md, right: SP.md, height: 2,
                  backgroundColor: theme.accent, borderRadius: RADIUS.pill },
  tabContent:   { flex: 1 },
  fab:          { position: 'absolute', right: SP.lg, width: 56, height: 56, borderRadius: 28,
                  overflow: 'hidden', shadowColor: theme.shadowColor, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 8 },
  fabGrad:      { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  });
};
