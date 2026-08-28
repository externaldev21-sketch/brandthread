/**
 * Product Store — Buyer Preview
 *
 * What buyers see when they shop a product.
 * Accessible from: product detail "Store page" tab, Thread shopping bag tap.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Image, Alert, Share, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { BG, SURFACE, CARD, BORDER, FG, MUTED, SUBTLE, SUCCESS, SUCCESS_DIM, BLUE, ORANGE, RED, ON_DARK, FONT, FS, SP, RADIUS, COMP, ICON, PURPLE, PURPLE_LIGHT, PURPLE_DIM, CYAN, CYAN_DIM } from '@/lib/theme';
import { getOnAccentTextStyle, useAppTheme } from '@/contexts/AppThemeContext';
import { BrandthreadCard, PrimaryButton, SecondaryButton, StatusBadge, FilterChip, SectionHeader } from '@/components/BrandthreadUI';
import { getProduct } from '@/services/productService';
import { Product, ProductVariant, OptionValue } from '@/services/productTypes';
import { calcPricing } from '@/lib/productUtils';
import { formatCents, integerPercent } from '@/lib/money';

const { width: SCREEN_W } = Dimensions.get('window');
const GALLERY_H = 380;

// ─── Category placeholder gradients ──────────────────────────────────────────

const CATEGORY_GRADS: Record<string, readonly [string, string]> = {
  'T-shirt':    ['#1a1a2e', '#16213e'],
  'Hoodie':     ['#0f3460', '#16213e'],
  'Jacket':     ['#1a1a2e', '#533483'],
  'Sweatpants': ['#0f3460', '#533483'],
  default:      ['#12121F', '#1a1a2e'],
};


// ─── Helper Components ────────────────────────────────────────────────────────

function StarRow({ rating, count }: { rating: number; count?: number }) {
  return (
    <View style={s.starRow}>
      {[1, 2, 3, 4, 5].map(i => (
        <Feather
          key={i}
          name="star"
          size={ICON.xs}
          color={i <= Math.round(rating) ? '#F59E0B' : SUBTLE}
        />
      ))}
      {count !== undefined && (
        <Text style={s.starCount}>{rating.toFixed(1)} ({count} reviews)</Text>
      )}
    </View>
  );
}

function AccordionSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={s.accordionWrap}>
      <TouchableOpacity
        style={s.accordionHeader}
        onPress={() => { Haptics.selectionAsync(); setOpen(v => !v); }}
        activeOpacity={0.7}
      >
        <Text style={s.accordionTitle}>{title}</Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={ICON.sm} color={MUTED} />
      </TouchableOpacity>
      {open && <View style={s.accordionBody}>{children}</View>}
      <View style={s.accordionDivider} />
    </View>
  );
}

function AccordionText({ text }: { text: string }) {
  return <Text style={s.accordionText}>{text}</Text>;
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ProductStoreScreen() {
  const { theme } = useAppTheme();
  const { accent: PURPLE, accentLight: PURPLE_LIGHT, accentDim: PURPLE_DIM, secondary: CYAN, secondaryDim: CYAN_DIM } = theme;
  const router = useRouter();
  const { id, variantId } = useLocalSearchParams<{ id: string; variantId?: string }>();
  const insets = useSafeAreaInsets();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [mediaIndex, setMediaIndex] = useState(0);

  // Selected option values: { [optionId]: valueId }
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});

  // Accordion state handled inside AccordionSection

  // ── Load product ───────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      let p: Product | undefined;
      if (id) {
        p = await getProduct(id);
      }
      // No demo fallback — if the product is not found, the screen shows an error.
      setProduct(p ?? null);

      if (p) {
        // Pre-select first value for each option
        const defaults: Record<string, string> = {};
        p.options.forEach(opt => {
          if (opt.values.length > 0) {
            defaults[opt.id] = opt.values[0].id;
          }
        });

        // Override with variantId if provided
        if (variantId) {
          const variant = p.variants.find(v => v.id === variantId);
          if (variant) {
            variant.optionValues.forEach(ov => {
              defaults[ov.optionId] = ov.valueId;
            });
          }
        }

        setSelectedOptions(defaults);
      }
      setLoading(false);
    }
    load();
  }, [id, variantId]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const pricing = product ? calcPricing(product.pricing) : null;

  const selectedVariant = product?.variants.find(v =>
    v.optionValues.every(ov => selectedOptions[ov.optionId] === ov.valueId)
  ) ?? null;

  const effectivePrice = selectedVariant?.priceCents ?? product?.pricing.priceCents ?? 0;
  const effectiveCompare = selectedVariant?.compareAtPriceCents ?? product?.pricing.compareAtPriceCents;
  const isOnSale = effectiveCompare !== undefined && effectiveCompare > effectivePrice;
  const discountPct = isOnSale && effectiveCompare
    ? integerPercent(effectiveCompare - effectivePrice, effectiveCompare)
    : undefined;

  function getStockBadge(): { label: string; variant: 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'purple' } {
    if (!product) return { label: 'Loading', variant: 'neutral' };
    const { salesModel, inventory, preorderSettings } = product;
    if (salesModel === 'pre-order' || salesModel === 'both') {
      return { label: 'Pre-order', variant: 'purple' };
    }
    if (inventory.totalStock === 0) {
      return { label: 'Out of stock', variant: 'error' };
    }
    if (inventory.totalStock <= inventory.lowStockThreshold) {
      return { label: 'Low stock', variant: 'warning' };
    }
    return { label: 'In stock', variant: 'success' };
  }

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.back();
  }, [router]);

  const handleShare = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await Share.share({ message: `Check out ${product?.name ?? 'this product'} on Brandthread!` });
  }, [product]);

  const handleAddToCart = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (product) {
      router.push(('/buyer-product-detail?productId=' + product.id + (selectedVariant ? '&variantId=' + selectedVariant.id : '')) as never);
    }
  }, [product, selectedVariant, router]);

  const handleMessageSeller = useCallback(() => {
    if (!product) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const sellerName = product.vendor ?? 'Seller';
    const sellerHandle = '@' + sellerName.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const sellerInitials = sellerName
      .split(/\s+/)
      .map(w => w[0] ?? '')
      .slice(0, 2)
      .join('')
      .toUpperCase();
    router.push((
      '/buyer-conversation?participantId=' + encodeURIComponent(product.sellerId) +
      '&participantName=' + encodeURIComponent(sellerName) +
      '&participantHandle=' + encodeURIComponent(sellerHandle) +
      '&participantInitials=' + encodeURIComponent(sellerInitials) +
      '&participantColor=' + encodeURIComponent(PURPLE) +
      '&participantAccountType=seller' +
      '&type=buyer_to_seller_product' +
      '&contextProductName=' + encodeURIComponent(product.name) +
      '&contextSellerName=' + encodeURIComponent(sellerName)
    ) as never);
  }, [router, product]);

  const handleReportSeller = useCallback(() => {
    if (!product) return;
    const sellerName = product.vendor ?? 'Seller';
    router.push((
      '/buyer-report?targetType=seller&targetId=' + encodeURIComponent(product.sellerId) +
      '&targetLabel=' + encodeURIComponent(sellerName)
    ) as never);
  }, [router, product]);

  const handleBuyNow = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (product) {
      router.push(('/buyer-product-detail?productId=' + product.id + (selectedVariant ? '&variantId=' + selectedVariant.id : '') + '&buyNow=1') as never);
    }
  }, [product, selectedVariant, router]);

  // ── Loading state ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <View style={[s.screen, { paddingTop: insets.top }]}>
        <Text style={s.loadingText}>Loading…</Text>
      </View>
    );
  }

  if (!product) {
    return (
      <View style={[s.screen, { paddingTop: insets.top, alignItems: 'center', justifyContent: 'center', padding: SP.xl }]}>
        <Feather name="alert-circle" size={ICON.xxl} color={MUTED} />
        <Text style={[s.loadingText, { marginTop: SP.md, textAlign: 'center' }]}>
          Product not found or no longer available.
        </Text>
        <TouchableOpacity style={{ marginTop: SP.md }} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.semibold, fontSize: FS.base }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const stockBadge = getStockBadge();
  const gradColors = CATEGORY_GRADS[product.category] ?? CATEGORY_GRADS.default;
  const coverMedia = product.media[0];
  const isPreorder = product.salesModel === 'pre-order' || product.salesModel === 'both';
  const preorder = product.preorderSettings;
  const fundProgress = preorder?.fundingGoalUnits
    ? Math.min(1, (preorder.unitsOrdered ?? 0) / preorder.fundingGoalUnits)
    : 0;

  // Related products are loaded from real product store's storeSettings.relatedProductIds
  const relatedProductIds: string[] = product.storeSettings?.relatedProductIds ?? [];

  const STICKY_BOTTOM_H = COMP.buttonH + SP.md + Math.max(insets.bottom, SP.md);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>

      {/* ── ScrollView content ──────────────────────────────────────────── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: STICKY_BOTTOM_H + SP.lg }}
      >

        {/* 1. Header row */}
        <View style={s.headerRow}>
          <TouchableOpacity onPress={handleBack} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="arrow-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          <Text style={s.headerLabel}>Product Preview</Text>
          <TouchableOpacity onPress={handleShare} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="share-2" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>

        {/* Preview notice */}
        <View style={s.previewNotice}>
          <StatusBadge label="Preview" variant="purple" />
          <Text style={s.previewText}>Buyer view — this is what shoppers see</Text>
        </View>

        {/* 2. Media gallery */}
        <View style={[s.galleryWrap, { width: SCREEN_W, height: GALLERY_H }]}>
          {coverMedia ? (
            <Image
              source={{ uri: coverMedia.uri }}
              style={s.galleryImage}
              resizeMode="cover"
            />
          ) : (
            <LinearGradient
              colors={gradColors as unknown as readonly [string, string, ...string[]]}
              style={s.galleryGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Feather name="image" size={ICON.xxl} color={SUBTLE} />
              <Text style={s.galleryPlaceholderText}>{product.category}</Text>
            </LinearGradient>
          )}

          {/* Watermark */}
          <View style={s.watermarkWrap}>
            <Text style={s.watermark}>Seller preview</Text>
          </View>

          {/* Dots indicator */}
          {product.media.length > 1 && (
            <View style={s.dotsRow}>
              {product.media.map((_, i) => (
                <View
                  key={i}
                  style={[s.dot, i === mediaIndex && s.dotActive]}
                />
              ))}
            </View>
          )}
        </View>

        {/* 3. Seller row */}
        {(() => {
          const sellerName = product.vendor ?? 'Seller';
          const sellerInitial = sellerName[0]?.toUpperCase() ?? 'S';
          return (
            <View style={s.sellerRow}>
              <View style={s.avatarCircle}>
                <Text style={s.avatarInitial}>{sellerInitial}</Text>
              </View>
              <View style={s.sellerInfo}>
                <View style={s.sellerNameRow}>
                  <Text style={s.sellerName}>{sellerName}</Text>
                  <Feather name="check-circle" size={ICON.xs} color={BLUE} />
                </View>
                <Text style={s.sellerSub}>Verified Brand</Text>
              </View>
              <SecondaryButton
                label="Follow"
                onPress={() => Alert.alert('Follow', 'Follow this seller to get drop alerts.')}
                small
                style={s.followBtn}
              />
              <TouchableOpacity style={s.msgIconBtn} onPress={handleMessageSeller} activeOpacity={0.75}>
                <Feather name="mail" size={ICON.sm} color={PURPLE_LIGHT} />
              </TouchableOpacity>
              <TouchableOpacity
                style={s.msgIconBtn}
                onPress={() => Alert.alert(
                  sellerName,
                  '',
                  [
                    { text: 'Message seller', onPress: handleMessageSeller },
                    { text: 'Report seller', style: 'destructive', onPress: handleReportSeller },
                    { text: 'Cancel', style: 'cancel' },
                  ]
                )}
                activeOpacity={0.75}
              >
                <Feather name="more-horizontal" size={ICON.sm} color={MUTED} />
              </TouchableOpacity>
            </View>
          );
        })()}

        {/* 4. Product info */}
        <View style={s.productInfo}>
          <Text style={s.productName}>{product.name}</Text>

          {/* Price row */}
          <View style={s.priceRow}>
            <Text style={s.retailPrice}>{formatCents(effectivePrice)}</Text>
            {isOnSale && effectiveCompare && (
              <Text style={s.comparePrice}>{formatCents(effectiveCompare)}</Text>
            )}
            {discountPct !== undefined && (
              <View style={s.discountBadge}>
                <Text style={s.discountText}>{discountPct}% OFF</Text>
              </View>
            )}
          </View>

          {/* Stock badge */}
          <View style={s.stockRow}>
            <StatusBadge label={stockBadge.label} variant={stockBadge.variant} />
          </View>

          {/* Stars */}
          <StarRow rating={4.8} count={23} />
        </View>

        {/* 5. Variant selector */}
        {product.options.length > 0 && (
          <View style={s.variantSection}>
            {product.options.map(option => (
              <View key={option.id} style={s.optionGroup}>
                <SectionHeader title={option.name} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipsRow}>
                  {option.values.map(val => (
                    <FilterChip
                      key={val.id}
                      label={val.value}
                      active={selectedOptions[option.id] === val.id}
                      onPress={() => setSelectedOptions(prev => ({ ...prev, [option.id]: val.id }))}
                    />
                  ))}
                </ScrollView>
              </View>
            ))}

            {/* Variant price/stock override */}
            {selectedVariant && selectedVariant.priceCents !== undefined && (
              <View style={s.variantOverride}>
                <Text style={s.variantOverrideLabel}>
                  {selectedVariant.title}: {formatCents(selectedVariant.priceCents)}
                  {'  '}
                  <Text style={s.variantStock}>
                    ({selectedVariant.inventoryQuantity} in stock)
                  </Text>
                </Text>
              </View>
            )}
          </View>
        )}

        {/* 6. Pre-order info */}
        {isPreorder && preorder && (
          <View style={s.sectionPad}>
            <LinearGradient
              colors={[theme.accentDim, theme.secondaryDim]}
              style={s.preorderCard}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={s.preorderHeaderRow}>
                <StatusBadge label="Pre-order" variant="purple" />
              </View>
              {preorder.closeDate && (
                <View style={s.preorderRow}>
                  <Feather name="calendar" size={ICON.xs} color={MUTED} />
                  <Text style={s.preorderLabel}>Order closes:</Text>
                  <Text style={s.preorderValue}>
                    {new Date(preorder.closeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
              )}
              {preorder.estimatedShippingDate && (
                <View style={s.preorderRow}>
                  <Feather name="truck" size={ICON.xs} color={MUTED} />
                  <Text style={s.preorderLabel}>Est. shipping:</Text>
                  <Text style={s.preorderValue}>
                    {new Date(preorder.estimatedShippingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
              )}
              {preorder.fundingGoalUnits !== undefined && (
                <View style={s.preorderProgress}>
                  <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${Math.round(fundProgress * 100)}%` }]} />
                  </View>
                  <Text style={s.progressText}>
                    {preorder.unitsOrdered ?? 0} of {preorder.fundingGoalUnits} units funded
                  </Text>
                </View>
              )}
              {preorder.disclaimer && (
                <Text style={s.preorderDisclaimer}>{preorder.disclaimer}</Text>
              )}
            </LinearGradient>
          </View>
        )}

        {/* 7. CTA buttons (in scroll) */}
        <View style={s.ctaRow}>
          <PrimaryButton
            label="Add to cart"
            onPress={handleAddToCart}
            icon="shopping-bag"
            style={s.ctaPrimary}
          />
          <SecondaryButton
            label="Buy now"
            onPress={handleBuyNow}
            style={s.ctaSecondary}
          />
        </View>

        {/* 8. Details accordions */}
        <View style={s.accordionsWrap}>
          <AccordionSection title="Description">
            {product.description.split('\n').map((line, i) => (
              <Text key={i} style={s.accordionText}>{line || ' '}</Text>
            ))}
          </AccordionSection>

          <AccordionSection title="Materials & Care">
            <AccordionText text="Refer to the product description for fabric and care instructions." />
          </AccordionSection>

          <AccordionSection title="Shipping">
          <AccordionText text="Estimated 3–7 business days. Free shipping on orders over $120." />
          </AccordionSection>

          <AccordionSection title="Returns">
          <AccordionText text="30-day returns on unworn, unwashed items with original tags attached." />
          </AccordionSection>

          <AccordionSection title="Reviews">
          <Text style={s.accordionText}>No reviews yet — be the first to rate this piece.</Text>
          </AccordionSection>
        </View>

        {/* 9. Related products — shown only when seller has configured related IDs */}
        {relatedProductIds.length > 0 && (
          <View style={s.relatedSection}>
            <SectionHeader title="You may also like" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.relatedScroll}>
              {relatedProductIds.map(rpId => (
                <TouchableOpacity
                  key={rpId}
                  style={s.relatedCard}
                  activeOpacity={0.8}
                  onPress={() => router.push(('/product-store?id=' + rpId) as never)}
                >
                  <View style={[s.relatedThumb, { backgroundColor: SURFACE, alignItems: 'center', justifyContent: 'center' }]}>
                    <Feather name="image" size={ICON.lg} color={SUBTLE} />
                  </View>
                  <Text style={s.relatedName} numberOfLines={1}>View product</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        {/* 10. Seller profile link */}
        {product.vendor ? (
          <View style={s.sectionPad}>
            <TouchableOpacity
              style={s.sellerProfileCard}
              activeOpacity={0.8}
              onPress={() => router.push(('/seller-profile?id=' + product.sellerId) as never)}
            >
              <View style={s.sellerProfileIcon}>
                <Feather name="user" size={ICON.md} color={PURPLE_LIGHT} />
              </View>
              <View style={s.sellerProfileInfo}>
                <Text style={s.sellerProfileLabel}>Shop {product.vendor}</Text>
                <Text style={s.sellerProfileDesc}>View full collection</Text>
              </View>
              <Feather name="chevron-right" size={ICON.sm} color={MUTED} />
            </TouchableOpacity>
          </View>
        ) : null}

      </ScrollView>

      {/* ── Sticky bottom bar ─────────────────────────────────────────────── */}
      <View
        style={[
          s.stickyBar,
          { paddingBottom: Math.max(insets.bottom, SP.md) },
        ]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={handleAddToCart}
          style={s.stickyBtn}
        >
          <LinearGradient
            colors={theme.primaryGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.stickyBtnGrad}
          >
            <Feather name="shopping-bag" size={ICON.sm} color={theme.onAccent} />
            <Text style={[s.stickyBtnText, { color: theme.onAccent }, getOnAccentTextStyle(theme)]}>Add to cart</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  loadingText: {
    color: MUTED,
    fontFamily: FONT.regular,
    fontSize: FS.base,
    textAlign: 'center',
    marginTop: SP.xxl,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.sm,
    minHeight: COMP.headerH,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: RADIUS.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  headerLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: MUTED,
    letterSpacing: 0.2,
  },

  // Preview notice
  previewNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingBottom: SP.sm,
  },
  previewText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },

  // Gallery
  galleryWrap: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: SURFACE,
  },
  galleryImage: {
    width: '100%',
    height: '100%',
  },
  galleryGradient: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
  },
  galleryPlaceholderText: {
    fontSize: FS.md,
    fontFamily: FONT.medium,
    color: SUBTLE,
  },
  watermarkWrap: {
    position: 'absolute',
    top: SP.sm,
    right: SP.sm,
  },
  watermark: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
    fontStyle: 'italic',
  },
  dotsRow: {
    position: 'absolute',
    bottom: SP.sm,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SP.xs,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: {
    backgroundColor: ON_DARK,
    width: 16,
  },

  // Seller row
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
    gap: SP.sm,
  },
  avatarCircle: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: PURPLE + '33',
    borderWidth: 1, borderColor: PURPLE + '55',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    color: PURPLE_LIGHT,
  },
  sellerInfo: {
    flex: 1,
  },
  sellerNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  sellerName: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  sellerSub: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  followBtn: {
    minWidth: 72,
  },

  // Product info
  productInfo: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
    marginBottom: SP.md,
  },
  productName: {
    fontSize: FS.xxl,
    fontFamily: FONT.bold,
    color: FG,
    letterSpacing: -0.5,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    flexWrap: 'wrap',
  },
  retailPrice: {
    fontSize: FS.xl,
    fontFamily: FONT.bold,
    color: FG,
  },
  comparePrice: {
    fontSize: FS.md,
    fontFamily: FONT.regular,
    color: MUTED,
    textDecorationLine: 'line-through',
  },
  discountBadge: {
    backgroundColor: RED + '22',
    borderRadius: RADIUS.pill,
    paddingHorizontal: SP.sm,
    paddingVertical: 3,
  },
  discountText: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: RED,
  },
  stockRow: {
    flexDirection: 'row',
  },
  starRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  starCount: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    marginLeft: SP.xs,
  },

  // Variants
  variantSection: {
    marginBottom: SP.md,
  },
  optionGroup: {
    marginBottom: SP.sm,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: SP.sm,
    paddingHorizontal: SP.md,
    paddingBottom: SP.xs,
  },
  variantOverride: {
    paddingHorizontal: SP.md,
    marginTop: SP.xs,
  },
  variantOverrideLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: CYAN,
  },
  variantStock: {
    color: MUTED,
    fontFamily: FONT.regular,
  },

  // Pre-order
  sectionPad: {
    paddingHorizontal: SP.md,
    marginBottom: SP.md,
  },
  preorderCard: {
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: PURPLE + '40',
    padding: SP.md,
    gap: SP.sm,
  },
  preorderHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  preorderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.xs,
  },
  preorderLabel: {
    fontSize: FS.sm,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  preorderValue: {
    fontSize: FS.sm,
    fontFamily: FONT.semibold,
    color: FG,
  },
  preorderProgress: {
    gap: SP.xs,
  },
  progressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: RADIUS.pill,
    backgroundColor: PURPLE,
  },
  progressText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  preorderDisclaimer: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: SUBTLE,
    lineHeight: 17,
  },

  // CTA buttons
  ctaRow: {
    paddingHorizontal: SP.md,
    flexDirection: 'column',
    gap: SP.sm,
    marginBottom: SP.md,
  },
  ctaPrimary: {
    width: '100%',
  },
  ctaSecondary: {
    width: '100%',
    height: COMP.buttonH,
  },

  // Accordions
  accordionsWrap: {
    marginBottom: SP.md,
  },
  accordionWrap: {},
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingVertical: SP.md,
  },
  accordionTitle: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  accordionBody: {
    paddingHorizontal: SP.md,
    paddingBottom: SP.md,
    gap: SP.xs,
  },
  accordionText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 20,
  },
  accordionDivider: {
    height: 1,
    backgroundColor: BORDER,
    marginHorizontal: SP.md,
  },

  // Reviews
  reviewsList: {
    gap: SP.md,
    marginTop: SP.sm,
  },
  reviewCard: {
    backgroundColor: SURFACE,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
    gap: SP.xs,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reviewerName: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
  reviewText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: FG,
    lineHeight: 20,
  },

  // Related
  relatedSection: {
    marginBottom: SP.md,
  },
  relatedScroll: {
    paddingHorizontal: SP.md,
    gap: SP.sm,
  },
  relatedCard: {
    width: 120,
    gap: SP.xs,
  },
  relatedThumb: {
    width: 120,
    height: 120,
    borderRadius: RADIUS.md,
    backgroundColor: SURFACE,
  },
  relatedName: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: FG,
  },
  relatedPrice: {
    fontSize: FS.xs,
    fontFamily: FONT.semibold,
    color: MUTED,
  },

  // Message icon button
  msgIconBtn: {
    width: 34, height: 34, borderRadius: RADIUS.sm,
    backgroundColor: CARD, borderWidth: 1, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },

  // Seller profile link
  sellerProfileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    backgroundColor: CARD,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    padding: SP.md,
  },
  sellerProfileIcon: {
    width: 40, height: 40, borderRadius: RADIUS.sm,
    backgroundColor: PURPLE + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  sellerProfileInfo: {
    flex: 1,
  },
  sellerProfileLabel: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  sellerProfileDesc: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: MUTED,
  },

  // Sticky bottom bar
  stickyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SP.md,
    paddingTop: SP.sm,
    backgroundColor: BG + 'F0',
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  stickyBtn: {
    borderRadius: RADIUS.md,
    overflow: 'hidden',
  },
  stickyBtnGrad: {
    height: COMP.buttonH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SP.sm,
  },
  stickyBtnText: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
    letterSpacing: 0.2,
  },
});
