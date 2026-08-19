/**
 * Brandthread Buyer Product Detail
 * Variant selection, add to cart, buy now.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import {
  addToCart, createBuyNowSession,
  getCart,
} from '@/services/cartService';
import { BuyerProduct, BuyerProductOption, BuyerProductVariant, CheckoutAttribution } from '@/services/cartTypes';
import { useApi } from '@/hooks/useApi';
import {
  BG, CARD, CARD_ELEVATED, BORDER, BORDER_ACTIVE, BORDER_FOCUS,
  FG, MUTED, SUBTLE, ON_DARK,
  PURPLE, PURPLE_LIGHT, PURPLE_DIM,
  CYAN, CYAN_DIM,
  SUCCESS, SUCCESS_DIM,
  ORANGE, ORANGE_DIM,
  RED, RED_DIM,
  GOLD,
  GRAD_PRIMARY, GRAD_SUCCESS_G,
  FONT, FS, SP, RADIUS, COMP, ICON,
  SHADOW_PURPLE,
} from '@/lib/theme';

// ─── API → BuyerProduct adapter ───────────────────────────────────────────────
// Converts a raw row from GET /api/public/products/:id to the BuyerProduct
// shape expected by addToCart. Variant UUIDs from the DB are preserved so the
// checkout server can look them up correctly.

function adaptApiProductToBuyerProduct(row: any): BuyerProduct {
  const apiVariants: any[] = row.variants ?? [];

  // Derive options from unique size / color values across all variants
  const sizes  = [...new Set<string>(apiVariants.map((v: any) => v.size).filter(Boolean))] as string[];
  const colors = [...new Set<string>(apiVariants.map((v: any) => v.color).filter(Boolean))] as string[];

  const options: BuyerProductOption[] = [];
  if (sizes.length  > 0) options.push({ id: 'opt_size',  name: 'Size',  values: sizes.map (s => ({ id: `size_${s}`,  label: s })) });
  if (colors.length > 0) options.push({ id: 'opt_color', name: 'Color', values: colors.map(c => ({ id: `color_${c}`, label: c })) });

  const firstImage: string | undefined = (row.images ?? [])[0];

  const variants: BuyerProductVariant[] = apiVariants.map((v: any) => {
    const ovs: { optionId: string; valueId: string }[] = [];
    if (v.size)  ovs.push({ optionId: 'opt_size',  valueId: `size_${v.size}`  });
    if (v.color) ovs.push({ optionId: 'opt_color', valueId: `color_${v.color}` });
    return {
      id:                v.id,
      title:             [v.size, v.color].filter(Boolean).join(' / ') || 'Default',
      optionValues:      ovs,
      price:             (v.priceCents ?? 0) / 100,
      inventoryQuantity: v.stock ?? 0,
      isAvailable:       (v.stock ?? 0) > 0,
      imageUri:          firstImage,
    };
  });

  const lowestPrice = variants.length > 0 ? Math.min(...variants.map(v => v.price)) : 0;

  return {
    id:                 row.id,
    sellerId:           row.ownerId,
    sellerName:         row.sellerDisplayName ?? 'Independent Seller',
    sellerHandle:       '',
    name:               row.name,
    description:        row.description ?? '',
    price:              lowestPrice,
    imageUris:          row.images ?? [],
    category:           row.category ?? 'apparel',
    isPreOrder:           row.isPreOrder           ?? false,
    preOrderClosingDate:  row.preOrderClosingDate ? new Date(row.preOrderClosingDate).toISOString() : undefined,
    preOrderEstShipDate:  row.preOrderEstShipDate ? new Date(row.preOrderEstShipDate).toISOString() : undefined,
    cancellationPolicy:   'All sales final. Returns accepted only for damaged or incorrect items.',
    refundPolicy:       'Contact the seller within 7 days of delivery to start a return.',
    options,
    variants,
    isActive:           true,
    tags:               row.tags ?? [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPrice(n: number) { return '$' + n.toFixed(2); }

function renderStars(rating: number): string {
  const full = Math.round(Math.max(0, Math.min(5, rating)));
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

function findVariant(product: BuyerProduct, selections: Record<string, string>): BuyerProductVariant | null {
  const optionIds = product.options.map(o => o.id);
  if (Object.keys(selections).length < optionIds.length) return null;
  return product.variants.find(v =>
    optionIds.every(optId => {
      const valueId = selections[optId];
      return v.optionValues.some(ov => ov.optionId === optId && ov.valueId === valueId);
    })
  ) ?? null;
}

function isVariantComboAvailable(
  product: BuyerProduct,
  optionId: string,
  valueId: string,
  otherSelections: Record<string, string>,
): boolean {
  const candidate = { ...otherSelections, [optionId]: valueId };
  const filledOptionIds = Object.keys(candidate);
  return product.variants.some(v =>
    v.isAvailable &&
    filledOptionIds.every(oid => v.optionValues.some(ov => ov.optionId === oid && ov.valueId === candidate[oid]))
  );
}

// ─── Option Picker ────────────────────────────────────────────────────────────

function OptionPicker({ product, option, selections, onSelect }: {
  product: BuyerProduct;
  option: BuyerProduct['options'][0];
  selections: Record<string, string>;
  onSelect: (optionId: string, valueId: string) => void;
}) {
  const isColor = option.name.toLowerCase() === 'color';
  return (
    <View style={op.root}>
      <View style={op.labelRow}>
        <Text style={op.optionName}>{option.name}</Text>
        {selections[option.id] && (
          <Text style={op.selectedLabel}>
            {option.values.find(v => v.id === selections[option.id])?.label}
          </Text>
        )}
      </View>
      <View style={op.chips}>
        {option.values.map(val => {
          const isSelected = selections[option.id] === val.id;
          const { [option.id]: _ignored, ...rest } = selections;
          const available = isVariantComboAvailable(product, option.id, val.id, rest);

          if (isColor && val.colorHex) {
            return (
              <TouchableOpacity
                key={val.id}
                style={[
                  op.colorSwatch,
                  isSelected && op.colorSwatchSelected,
                  !available && op.unavail,
                ]}
                onPress={() => { if (available) { Haptics.selectionAsync(); onSelect(option.id, val.id); } }}
                activeOpacity={0.8}
              >
                <View style={[op.colorDot, { backgroundColor: val.colorHex }]} />
                {!available && <View style={op.slashOverlay}><Text style={op.slash}>✕</Text></View>}
              </TouchableOpacity>
            );
          }

          return (
            <TouchableOpacity
              key={val.id}
              style={[
                op.chip,
                isSelected && op.chipSelected,
                !available && op.chipUnavail,
              ]}
              onPress={() => { if (available) { Haptics.selectionAsync(); onSelect(option.id, val.id); } }}
              activeOpacity={0.8}
              disabled={!available}
            >
              <Text style={[op.chipText, isSelected && op.chipTextSelected, !available && op.chipTextUnavail]}>
                {val.label}
              </Text>
              {!available && <View style={op.unavailLine} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const op = StyleSheet.create({
  root: { marginBottom: SP.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm },
  optionName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  selectedLabel: { fontSize: FS.sm, fontFamily: FONT.regular, color: PURPLE_LIGHT },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER,
    backgroundColor: CARD_ELEVATED, minWidth: 44, alignItems: 'center',
    overflow: 'hidden',
  },
  chipSelected: { borderColor: PURPLE, backgroundColor: PURPLE_DIM },
  chipUnavail: { opacity: 0.45 },
  chipText: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  chipTextSelected: { color: PURPLE_LIGHT },
  chipTextUnavail: { textDecorationLine: 'line-through' },
  unavailLine: { position: 'absolute', left: 0, right: 0, top: '50%', height: 1, backgroundColor: RED },
  colorSwatch: {
    width: 40, height: 40, borderRadius: RADIUS.sm,
    borderWidth: 2, borderColor: BORDER,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchSelected: { borderColor: PURPLE },
  colorDot: { width: 28, height: 28, borderRadius: RADIUS.xs },
  unavail: { opacity: 0.4 },
  slashOverlay: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  slash: { fontSize: 18, color: RED, fontFamily: FONT.bold },
});

// ─── Quantity Selector ────────────────────────────────────────────────────────

function QtySelector({ qty, max, onDec, onInc }: { qty: number; max: number; onDec: () => void; onInc: () => void }) {
  return (
    <View style={qs.root}>
      <Text style={qs.label}>Qty</Text>
      <View style={qs.ctrl}>
        <TouchableOpacity style={qs.btn} onPress={onDec} disabled={qty <= 1} activeOpacity={0.7}>
          <Feather name="minus" size={15} color={qty <= 1 ? SUBTLE : FG} />
        </TouchableOpacity>
        <Text style={qs.val}>{qty}</Text>
        <TouchableOpacity style={qs.btn} onPress={onInc} disabled={qty >= max} activeOpacity={0.7}>
          <Feather name="plus" size={15} color={qty >= max ? SUBTLE : FG} />
        </TouchableOpacity>
      </View>
      {max <= 5 && <Text style={qs.stock}>{max} left</Text>}
    </View>
  );
}
const qs = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  label: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  ctrl: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: CARD_ELEVATED, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER, paddingHorizontal: SP.sm },
  btn: { paddingVertical: 8, paddingHorizontal: 6 },
  val: { fontSize: FS.base, fontFamily: FONT.semibold, color: FG, minWidth: 24, textAlign: 'center' },
  stock: { fontSize: FS.xs, fontFamily: FONT.medium, color: ORANGE },
});

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function BuyerProductDetailScreen() {
  const { productId, sourcePostId, sourceTagId } = useLocalSearchParams<{
    productId?: string;
    sourcePostId?: string;
    sourceTagId?: string;
  }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const api    = useApi();

  const [product, setProduct] = useState<BuyerProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [addingToCart, setAddingToCart] = useState(false);
  const [buyingNow, setBuyingNow] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [productReviews, setProductReviews] = useState<any[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);

  // Waitlist & pre-order reservation state
  const [waitlistJoined,  setWaitlistJoined]  = useState(false);
  const [waitlistLoading, setWaitlistLoading] = useState(false);
  const [reserved,        setReserved]        = useState(false);
  const [reserveLoading,  setReserveLoading]  = useState(false);
  const [sizeChartOpen,   setSizeChartOpen]   = useState(false);

  useEffect(() => {
    (async () => {
      try {
        let prod: BuyerProduct | null = null;

        if (productId) {
          // Load the live product from the public API.
          // DB product UUIDs from the discover feed carry real variant IDs
          // so the checkout server can look them up correctly.
          try {
            const row = await api.publicProducts.get(productId);
            if (row && !row.error) prod = adaptApiProductToBuyerProduct(row);
          } catch { /* API unavailable — product will show as not found */ }
        }
        // productName-only navigation is not supported; all entry points
        // must supply a productId so real variant data is loaded.

        setProduct(prod);
      } catch {}
      setLoading(false);
    })();
  }, [productId]);

  useEffect(() => {
    if (!product?.id) return;
    api.reviews.forProduct(product.id)
      .then((data: any) => {
        setProductReviews(data.reviews ?? []);
        setAvgRating(data.avgRating ?? 0);
        setReviewCount(data.totalCount ?? 0);
      })
      .catch(() => {});
  }, [product?.id]);

  // Check waitlist status when selected variant changes
  useEffect(() => {
    if (!product) return;
    const v = findVariant(product, selections);
    if (!v?.id || v.isAvailable) { setWaitlistJoined(false); return; }
    (api as any).waitlist?.check?.(v.id)
      ?.then((d: any) => setWaitlistJoined(d?.joined ?? false))
      ?.catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, JSON.stringify(selections)]);

  // Check reservation status for pre-order products
  useEffect(() => {
    if (!product?.id || !product.isPreOrder) { setReserved(false); return; }
    (api as any).buyer?.checkReservation?.(product.id)
      ?.then((d: any) => setReserved(d?.reserved ?? false))
      ?.catch(() => {});
  }, [product?.id, product?.isPreOrder]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={PURPLE} size="large" />
      </View>
    );
  }

  if (!product) {
    return (
      <View style={{ flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', padding: SP.xl }}>
        <Feather name="alert-circle" size={ICON.xxl} color={MUTED} />
        <Text style={{ color: MUTED, marginTop: SP.md, fontFamily: FONT.regular, textAlign: 'center' }}>
          Product not found or no longer available.
        </Text>
        <TouchableOpacity style={{ marginTop: SP.md }} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={{ color: PURPLE_LIGHT, fontFamily: FONT.semibold }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const variant = findVariant(product, selections);
  const variantPrice = variant?.price ?? product.price;
  const variantCompare = variant?.compareAtPrice ?? product.compareAtPrice;
  const hasDiscount = variantCompare && variantCompare > variantPrice;
  const savingsAmt = hasDiscount ? variantCompare! - variantPrice : 0;
  const allSelected = product.options.length > 0 && Object.keys(selections).length === product.options.length;
  const inStock = variant ? variant.isAvailable && variant.inventoryQuantity > 0 : true;
  const maxQty = variant ? Math.max(1, variant.inventoryQuantity) : 10;

  function handleSelect(optionId: string, valueId: string) {
    setSelections(prev => {
      const updated = { ...prev, [optionId]: valueId };
      // Reset qty if max changed
      const newVariant = findVariant(product!, updated);
      if (newVariant && qty > newVariant.inventoryQuantity) setQty(1);
      return updated;
    });
    setAddedToCart(false);
  }

  const attribution: CheckoutAttribution = {
    sourcePostId: sourcePostId,
    sourceTagId: sourceTagId,
    channel: sourcePostId ? 'thread' : 'discover',
  };

  async function handleJoinWaitlist() {
    if (!product || !variant) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setWaitlistLoading(true);
    try {
      await (api as any).waitlist.join(product.id, variant.id);
      setWaitlistJoined(true);
      Alert.alert("You're on the waitlist", "We'll notify you the moment this drops back in stock.");
    } catch { Alert.alert('Error', 'Could not join waitlist. Please try again.'); }
    finally { setWaitlistLoading(false); }
  }

  async function handleReserve() {
    if (!product) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setReserveLoading(true);
    try {
      await (api as any).buyer.reserve(product.id);
      setReserved(true);
      Alert.alert('Reserved!', "Spot secured. We'll notify you once production is confirmed.");
    } catch { Alert.alert('Error', 'Could not reserve. Please try again.'); }
    finally { setReserveLoading(false); }
  }

  async function handleAddToCart() {
    if (!allSelected) {
      Alert.alert('Select Options', 'Please select all options before adding to cart.');
      return;
    }
    if (!variant) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAddingToCart(true);
    const result = await addToCart({ product: product!, variant, quantity: qty, attribution });
    setAddingToCart(false);
    if (result.success) {
      setAddedToCart(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Alert.alert('Cannot Add to Cart', result.message ?? 'Please try again.');
    }
  }

  async function handleBuyNow() {
    if (!allSelected) {
      Alert.alert('Select Options', 'Please select all options before continuing.');
      return;
    }
    if (!variant) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBuyingNow(true);
    try {
      // Check seller payment readiness before entering checkout
      const sellerId = product!.sellerId;
      if (sellerId) {
        try {
          const status = await api.buyer.sellerPaymentStatus(sellerId);
          if (!status.ready) {
            Alert.alert(
              'Payments Unavailable',
              status.reason ?? 'This seller can\'t accept payments right now. Please try again later.',
              [{ text: 'OK' }],
            );
            setBuyingNow(false);
            return;
          }
        } catch {
          // Non-fatal: if the status check fails (e.g. network error), proceed —
          // the server will reject the checkout session if the account is truly unready.
        }
      }

      const cart = await getCart();
      await createBuyNowSession(product!, variant, qty, cart);
      router.push('/buyer-checkout?source=buynow' as never);
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
    setBuyingNow(false);
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}
      >
        {/* Image area */}
        <View style={s.imageArea}>
          <View style={s.imagePlaceholder}>
            <Feather name="image" size={ICON.xxl} color={MUTED} />
            <Text style={s.imagePlaceholderText}>{product.name}</Text>
          </View>
          {/* Back button */}
          <TouchableOpacity style={[s.backBtn, { top: insets.top + SP.sm }]} onPress={() => router.back()} activeOpacity={0.8}>
            <Feather name="chevron-left" size={ICON.md} color={FG} />
          </TouchableOpacity>
          {/* Cart button */}
          <TouchableOpacity
            style={[s.cartBtn, { top: insets.top + SP.sm }]}
            onPress={() => router.push('/(buyer)/cart' as never)}
            activeOpacity={0.8}
          >
            <Feather name="shopping-bag" size={ICON.md} color={FG} />
          </TouchableOpacity>
        </View>

        <View style={s.body}>
          {/* Badges */}
          <View style={s.badgeRow}>
            {product.isPreOrder && (
              <View style={s.preOrderBadge}>
                <Feather name="clock" size={12} color={CYAN} />
                <Text style={s.preOrderBadgeText}>PRE-ORDER</Text>
              </View>
            )}
            {hasDiscount && (
              <View style={s.saleBadge}>
                <Text style={s.saleBadgeText}>SALE</Text>
              </View>
            )}
          </View>

          {/* Title & Seller */}
          <Text style={s.productName}>{product.name}</Text>
          <TouchableOpacity style={s.sellerRow} onPress={() => router.push(('/seller-profile?id=' + product.sellerId) as never)} activeOpacity={0.7}>
            <View style={s.sellerAvatar}><Text style={s.sellerInitial}>{product.sellerName.charAt(0)}</Text></View>
            <Text style={s.sellerName}>{product.sellerName}</Text>
            <Text style={s.sellerHandle}>{product.sellerHandle}</Text>
            <Feather name="chevron-right" size={14} color={MUTED} />
          </TouchableOpacity>

          {/* Price */}
          <View style={s.priceRow}>
            <Text style={[s.price, hasDiscount ? s.priceSale : undefined]}>{fmtPrice(variantPrice)}</Text>
            {hasDiscount && <Text style={s.comparePrice}>{fmtPrice(variantCompare!)}</Text>}
            {hasDiscount && <Text style={s.savings}>Save {fmtPrice(savingsAmt)}</Text>}
          </View>

          {/* Pre-order info */}
          {product.isPreOrder && (
            <View style={s.preOrderCard}>
              <View style={s.preOrderRow}>
                <Feather name="clock" size={ICON.sm} color={CYAN} />
                <Text style={s.preOrderTitle}>Pre-Order Item</Text>
              </View>
              {product.preOrderClosingDate && (
                <Text style={s.preOrderDetail}>
                  Pre-order closes: {new Date(product.preOrderClosingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </Text>
              )}
              {product.preOrderEstShipDate && (
                <Text style={s.preOrderDetail}>
                  Est. ship date: {new Date(product.preOrderEstShipDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </Text>
              )}
              <Text style={s.preOrderDisclaimer}>
                Production and ship dates are estimates and may change. You will be notified of any updates.
              </Text>
            </View>
          )}

          {/* Divider */}
          <View style={s.divider} />

          {/* Options */}
          {product.options.map(option => (
            <OptionPicker
              key={option.id}
              product={product}
              option={option}
              selections={selections}
              onSelect={handleSelect}
            />
          ))}

          {/* Stock status */}
          {allSelected && variant && (
            <View style={s.stockRow}>
              <View style={[s.stockDot, { backgroundColor: variant.isAvailable ? SUCCESS : RED }]} />
              <Text style={[s.stockText, { color: variant.isAvailable ? SUCCESS : RED }]}>
                {variant.isAvailable
                  ? variant.inventoryQuantity <= 5
                    ? `Only ${variant.inventoryQuantity} left in stock`
                    : 'In stock'
                  : 'Out of stock — select another option'
                }
              </Text>
            </View>
          )}

          {/* Waitlist — shown when selected variant is OOS and not pre-order */}
          {allSelected && variant && !variant.isAvailable && !product.isPreOrder && (
            <TouchableOpacity
              style={[wl.btn, waitlistJoined && wl.joined]}
              onPress={waitlistJoined ? undefined : handleJoinWaitlist}
              disabled={waitlistLoading || waitlistJoined}
              activeOpacity={0.8}
            >
              {waitlistLoading ? (
                <ActivityIndicator size="small" color={PURPLE_LIGHT} />
              ) : (
                <>
                  <Feather name={waitlistJoined ? 'check' : 'bell'} size={14} color={waitlistJoined ? SUCCESS : PURPLE_LIGHT} />
                  <Text style={[wl.text, waitlistJoined && { color: SUCCESS }]}>
                    {waitlistJoined ? "You're on the waitlist" : 'Notify me when back in stock'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {/* Quantity */}
          {allSelected && inStock && (
            <View style={{ marginVertical: SP.md }}>
              <QtySelector
                qty={qty}
                max={maxQty}
                onDec={() => setQty(q => Math.max(1, q - 1))}
                onInc={() => setQty(q => Math.min(maxQty, q + 1))}
              />
            </View>
          )}

          {/* Description */}
          <View style={s.divider} />
          <Text style={s.descTitle}>About this piece</Text>
          <Text style={s.desc}>{product.description}</Text>

          {/* Policies */}
          <View style={s.divider} />
          <PolicyRow icon="refresh-ccw" label="Returns" value={product.refundPolicy} />
          <PolicyRow icon="x-circle" label="Cancellation" value={product.cancellationPolicy} />

          {/* Size Chart — expandable table */}
          {!!(product as any).sizeChart && (
            <>
              <View style={s.divider} />
              <TouchableOpacity
                style={sz.toggle}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSizeChartOpen(o => !o); }}
                activeOpacity={0.7}
              >
                <Text style={sz.label}>Size Chart</Text>
                <Feather name={sizeChartOpen ? 'chevron-up' : 'chevron-down'} size={16} color={MUTED} />
              </TouchableOpacity>
              {sizeChartOpen && <SizeChartViewer chart={(product as any).sizeChart} />}
            </>
          )}

          {/* Reviews */}
          <View style={s.divider} />
          <Text style={s.reviewsHeader}>Customer Reviews</Text>
          {reviewCount === 0 ? (
            <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, marginBottom: SP.md }}>
              No reviews yet
            </Text>
          ) : (
            <>
              <View style={s.ratingRow}>
                <Text style={s.ratingAvg}>{avgRating.toFixed(1)}</Text>
                <Text style={{ fontSize: FS.sm, fontFamily: FONT.regular, color: GOLD }}>
                  {renderStars(avgRating)}
                </Text>
                <Text style={s.ratingCount}>({reviewCount} review{reviewCount !== 1 ? 's' : ''})</Text>
              </View>
              {productReviews.slice(0, 5).map((r: any) => (
                <View key={r.id} style={s.reviewRow}>
                  <Text style={s.reviewStars}>{renderStars(r.rating)}</Text>
                  {r.body ? <Text style={s.reviewBody}>{r.body}</Text> : null}
                  <Text style={s.reviewDate}>
                    {new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </Text>
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>

      {/* Bottom action bar */}
      <View style={[s.actionBar, { paddingBottom: insets.bottom + SP.sm }]}>
        {addedToCart ? (
          <TouchableOpacity
            style={s.viewCartBtn}
            onPress={() => router.push('/(buyer)/cart' as never)}
            activeOpacity={0.85}
          >
            <LinearGradient colors={[...GRAD_SUCCESS_G]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.actionGrad}>
              <Feather name="shopping-bag" size={18} color={ON_DARK} />
              <Text style={s.actionBtnText}>View Cart</Text>
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.addToCartBtn, (!allSelected || !inStock) && s.btnDisabled]}
            onPress={handleAddToCart}
            activeOpacity={0.85}
            disabled={addingToCart || !inStock}
          >
            {addingToCart ? (
              <ActivityIndicator color={PURPLE_LIGHT} size="small" />
            ) : (
              <>
                <Feather name="shopping-bag" size={18} color={allSelected && inStock ? PURPLE_LIGHT : SUBTLE} />
                <Text style={[s.addToCartText, (!allSelected || !inStock) && { color: SUBTLE }]}>
                  {!allSelected ? 'Select Options' : !inStock ? 'Out of Stock' : 'Add to Cart'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {product.isPreOrder ? (
          <TouchableOpacity
            style={s.buyNowBtn}
            onPress={handleReserve}
            disabled={reserveLoading || reserved}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={reserved ? [CARD_ELEVATED, CARD_ELEVATED] : [PURPLE_DIM, PURPLE_DIM]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={[s.actionGrad, { borderWidth: 1, borderColor: reserved ? SUCCESS + '44' : PURPLE + '44' }]}
            >
              {reserveLoading ? (
                <ActivityIndicator color={PURPLE_LIGHT} size="small" />
              ) : (
                <Text style={[s.actionBtnText, { color: reserved ? SUCCESS : PURPLE_LIGHT }]}>
                  {reserved ? 'Reserved ✓' : 'Reserve (No Charge)'}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.buyNowBtn, (!allSelected || !inStock) && s.btnDisabled]}
            onPress={handleBuyNow}
            activeOpacity={0.85}
            disabled={buyingNow || !inStock || !allSelected}
          >
            <LinearGradient
              colors={allSelected && inStock ? [...GRAD_PRIMARY] : [CARD_ELEVATED, CARD_ELEVATED]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={s.actionGrad}
            >
              {buyingNow ? (
                <ActivityIndicator color={ON_DARK} size="small" />
              ) : (
                <Text style={[s.actionBtnText, (!allSelected || !inStock) && { color: SUBTLE }]}>
                  {!allSelected ? 'Select Options' : 'Buy Now'}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Size Chart Viewer ────────────────────────────────────────────────────────

interface SizeChart { columns: string[]; rows: { size: string; values: string[] }[]; unit?: string; notes?: string }

function SizeChartViewer({ chart }: { chart: SizeChart }) {
  if (!chart?.columns?.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: SP.sm }}>
      <View>
        <View style={sch.row}>
          <View style={[sch.cell, sch.sizeCell, sch.headerCell]}>
            <Text style={sch.headerText}>Size</Text>
          </View>
          {chart.columns.map((col, i) => (
            <View key={i} style={[sch.cell, sch.headerCell]}>
              <Text style={sch.headerText}>{col}{chart.unit ? ` (${chart.unit})` : ''}</Text>
            </View>
          ))}
        </View>
        {(chart.rows ?? []).map((row, ri) => (
          <View key={ri} style={[sch.row, ri % 2 === 0 && sch.altRow]}>
            <View style={[sch.cell, sch.sizeCell]}>
              <Text style={sch.sizeText}>{row.size}</Text>
            </View>
            {row.values.map((v, ci) => (
              <View key={ci} style={sch.cell}>
                <Text style={sch.valueText}>{v || '—'}</Text>
              </View>
            ))}
          </View>
        ))}
        {chart.notes ? <Text style={sch.notes}>{chart.notes}</Text> : null}
      </View>
    </ScrollView>
  );
}
const sch = StyleSheet.create({
  row:        { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER },
  altRow:     { backgroundColor: CARD_ELEVATED },
  cell:       { width: 72, paddingVertical: 8, paddingHorizontal: 4, justifyContent: 'center' },
  sizeCell:   { width: 52 },
  headerCell: { backgroundColor: PURPLE_DIM },
  headerText: { fontFamily: FONT.semibold, fontSize: 10, color: PURPLE_LIGHT, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 0.4 },
  sizeText:   { fontFamily: FONT.semibold, fontSize: FS.xs, color: FG, textAlign: 'center' },
  valueText:  { fontFamily: FONT.regular, fontSize: FS.xs, color: MUTED, textAlign: 'center' },
  notes:      { fontFamily: FONT.regular, fontSize: FS.xs, color: SUBTLE, marginTop: SP.sm, lineHeight: 17 },
});

// ─────────────────────────────────────────────────────────────────────────────

function PolicyRow({ icon, label, value }: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  return (
    <View style={pr.root}>
      <Feather name={icon} size={14} color={MUTED} />
      <View style={{ flex: 1 }}>
        <Text style={pr.label}>{label}</Text>
        <Text style={pr.value}>{value}</Text>
      </View>
    </View>
  );
}
const pr = StyleSheet.create({
  root: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.md },
  label: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED },
  value: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 2, lineHeight: 17 },
});

const s = StyleSheet.create({
  imageArea: { height: 360, backgroundColor: CARD, position: 'relative' },
  imagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  imagePlaceholderText: { fontSize: FS.sm, fontFamily: FONT.regular, color: SUBTLE, textAlign: 'center', paddingHorizontal: SP.lg },
  backBtn: {
    position: 'absolute', left: SP.md, width: 40, height: 40,
    borderRadius: RADIUS.pill, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  cartBtn: {
    position: 'absolute', right: SP.md, width: 40, height: 40,
    borderRadius: RADIUS.pill, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  body: { padding: SP.md },
  badgeRow: { flexDirection: 'row', gap: SP.sm, marginBottom: SP.sm },
  preOrderBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: CYAN_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  preOrderBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: CYAN, letterSpacing: 0.4 },
  saleBadge: { backgroundColor: RED_DIM, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  saleBadgeText: { fontSize: FS.xs, fontFamily: FONT.bold, color: RED, letterSpacing: 0.4 },
  productName: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG, marginBottom: SP.sm, lineHeight: 28 },
  sellerRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs, marginBottom: SP.md },
  sellerAvatar: { width: 24, height: 24, borderRadius: RADIUS.pill, backgroundColor: PURPLE_DIM, alignItems: 'center', justifyContent: 'center' },
  sellerInitial: { fontSize: FS.xs, fontFamily: FONT.bold, color: PURPLE_LIGHT },
  sellerName: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  sellerHandle: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  price: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  priceSale: { color: SUCCESS },
  comparePrice: { fontSize: FS.base, fontFamily: FONT.regular, color: SUBTLE, textDecorationLine: 'line-through' },
  savings: { fontSize: FS.sm, fontFamily: FONT.semibold, color: SUCCESS },
  preOrderCard: { backgroundColor: CYAN_DIM, borderRadius: RADIUS.md, padding: SP.md, borderWidth: 1, borderColor: 'rgba(34,211,238,0.25)', marginBottom: SP.md, gap: 4 },
  preOrderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  preOrderTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: CYAN },
  preOrderDetail: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
  preOrderDisclaimer: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 4, lineHeight: 17 },
  divider: { height: 1, backgroundColor: BORDER, marginVertical: SP.md },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm },
  stockDot: { width: 8, height: 8, borderRadius: 4 },
  stockText: { fontSize: FS.sm, fontFamily: FONT.medium },
  descTitle: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  desc: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 22 },
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: SP.sm, paddingHorizontal: SP.md, paddingTop: SP.md,
    backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER,
  },
  addToCartBtn: {
    flex: 1, height: COMP.buttonH, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
  },
  addToCartText: { fontSize: FS.sm, fontFamily: FONT.semibold, color: PURPLE_LIGHT },
  buyNowBtn: { flex: 1, borderRadius: RADIUS.md, overflow: 'hidden' },
  viewCartBtn: { flex: 2, borderRadius: RADIUS.md, overflow: 'hidden' },
  actionGrad: { height: COMP.buttonH, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  actionBtnText: { fontSize: FS.sm, fontFamily: FONT.bold, color: ON_DARK },
  btnDisabled: { opacity: 0.5 },
  reviewsHeader: { fontSize: FS.sm, fontFamily: FONT.semibold, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: SP.sm },
  reviewRow: { marginBottom: SP.md, paddingBottom: SP.md, borderBottomWidth: 1, borderBottomColor: BORDER },
  reviewStars: { fontSize: FS.sm, fontFamily: FONT.regular, color: GOLD, marginBottom: 2 },
  reviewBody: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED, lineHeight: 20 },
  reviewDate: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE, marginTop: 2 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md },
  ratingAvg: { fontSize: FS.xl, fontFamily: FONT.bold, color: FG },
  ratingCount: { fontSize: FS.sm, fontFamily: FONT.regular, color: MUTED },
});

// Waitlist button styles
const wl = StyleSheet.create({
  btn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm, marginTop: SP.sm, paddingVertical: SP.sm, borderRadius: RADIUS.sm, borderWidth: 1, borderColor: BORDER_ACTIVE, backgroundColor: PURPLE_DIM },
  joined: { borderColor: SUCCESS + '44', backgroundColor: 'transparent' },
  text:   { fontFamily: FONT.medium, fontSize: FS.sm, color: PURPLE_LIGHT },
});

// Size chart toggle styles
const sz = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: SP.sm },
  label:  { fontFamily: FONT.semibold, fontSize: FS.sm, color: FG },
});
