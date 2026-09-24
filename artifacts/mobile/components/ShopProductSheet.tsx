/**
 * ShopProductSheet — Compact shoppable-video drawer
 *
 * Hydrates product from the public buyer API, shows image/name/price/seller/trust cues,
 * handles variant selection, quantity, Add to cart (with attribution), and Buy Now.
 * Supports multi-tag switching, sold-out, unavailable, loading, success, and retry states.
 * Preserves video/feed position behind the drawer.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useThreadPull } from '@/contexts/ThreadPullTransitionContext';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { CachedImage } from '@/components/CachedImage';
import { formatCents } from '@/lib/money';
import {
  BG, CARD, CARD_ELEVATED, SURFACE,
  BORDER, BORDER_SUBTLE,
  FG, MUTED, SUBTLE, ON_DARK, OVERLAY,
  SUCCESS, SUCCESS_DIM,
  RED, RED_DIM,
  ORANGE,
  FONT, FS, SP, RADIUS, ICON,
} from '@/lib/theme';
import {
  addToCart,
  createBuyNowSession,
  getCart,
  getBuyerProduct,
} from '@/services/cartService';
import type {
  BuyerProduct,
  BuyerProductOption,
  BuyerProductVariant,
  CheckoutAttribution,
} from '@/services/cartTypes';
import {
  getCartFlightVector,
  getSuccessfulCartCount,
  measureCartTarget,
  shouldAnimateCartSuccess,
  type CartFlightPoint,
} from '@/lib/cartFlight';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShopTag {
  productId: string;
  productName: string;
  priceCents: number;
  tagId?: string;
}

export interface ShopSheetSelection {
  postId: string;
  postSellerId?: string;
  tags: ShopTag[];
  activeTagIndex: number;
  previewProduct?: BuyerProduct;
}

interface ShopProductSheetProps {
  selection: ShopSheetSelection;
  onClose: () => void;
  onCartUpdated?: (newCount: number) => void;
  cartTargetRef?: RefObject<View | null>;
  reduceMotion: boolean | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findVariant(
  product: BuyerProduct,
  selections: Record<string, string>,
): BuyerProductVariant | null {
  const optionIds = product.options.map(o => o.id);
  if (Object.keys(selections).length < optionIds.length) return null;
  return (
    product.variants.find(v =>
      optionIds.every(optId => {
        const valueId = selections[optId];
        return v.optionValues.some(
          ov => ov.optionId === optId && ov.valueId === valueId,
        );
      }),
    ) ?? null
  );
}

function isVariantComboAvailable(
  product: BuyerProduct,
  optionId: string,
  valueId: string,
  otherSelections: Record<string, string>,
): boolean {
  const candidate = { ...otherSelections, [optionId]: valueId };
  const filledOptionIds = Object.keys(candidate);
  return product.variants.some(
    v =>
      v.isAvailable &&
      filledOptionIds.every(oid =>
        v.optionValues.some(
          ov => ov.optionId === oid && ov.valueId === candidate[oid],
        ),
      ),
  );
}

// ─── Option Chip ──────────────────────────────────────────────────────────────

function OptionChip({
  label,
  selected,
  available,
  onPress,
  accentColor,
}: {
  label: string;
  selected: boolean;
  available: boolean;
  onPress: () => void;
  accentColor: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={!available}
      activeOpacity={0.75}
      accessibilityRole="radio"
      accessibilityLabel={label + (available ? '' : ', unavailable')}
      accessibilityState={{ selected, disabled: !available }}
      style={[
        chipS.chip,
        selected && { borderColor: accentColor, borderWidth: 2, backgroundColor: `${accentColor}1A` },
        !available && chipS.unavail,
      ]}
    >
      <Text
        style={[
          chipS.text,
          selected && { color: accentColor, fontFamily: FONT.bold },
          !available && chipS.textUnavail,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const chipS = StyleSheet.create({
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ELEVATED,
    minWidth: 40,
    alignItems: 'center',
    overflow: 'hidden',
  },
  text: { fontSize: FS.sm, fontFamily: FONT.medium, color: FG },
  textUnavail: { color: SUBTLE },
  // Dashed = unavailable, per the shop sheet's variant-chip convention
  // (bold solid border = selected).
  unavail: { borderStyle: 'dashed', borderColor: SUBTLE, backgroundColor: 'transparent' },
});

// ─── Quantity control ─────────────────────────────────────────────────────────

function QtyControl({
  qty,
  max,
  onDec,
  onInc,
}: {
  qty: number;
  max: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <View style={qtyS.row}>
      <TouchableOpacity
        onPress={onDec}
        disabled={qty <= 1}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Decrease quantity"
        accessibilityState={{ disabled: qty <= 1 }}
        style={qtyS.btn}
      >
        <Feather name="minus" size={14} color={qty <= 1 ? SUBTLE : FG} />
      </TouchableOpacity>
      <Text style={qtyS.val}>{qty}</Text>
      <TouchableOpacity
        onPress={onInc}
        disabled={qty >= max}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Increase quantity"
        accessibilityState={{ disabled: qty >= max }}
        style={qtyS.btn}
      >
        <Feather name="plus" size={14} color={qty >= max ? SUBTLE : FG} />
      </TouchableOpacity>
    </View>
  );
}

const qtyS = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_ELEVATED,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: BORDER,
  },
  btn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  val: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
    minWidth: 28,
    textAlign: 'center',
  },
});

// ─── Main Component ───────────────────────────────────────────────────────────

type SheetPhase =
  | 'loading'
  | 'error'
  | 'ready'
  | 'sold_out'
  | 'unavailable'
  | 'adding'
  | 'buying'
  | 'added';

export function ShopProductSheet({
  selection,
  onClose,
  onCartUpdated,
  cartTargetRef,
  reduceMotion,
}: ShopProductSheetProps) {
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const { push } = useThreadPull();

  const [activeTagIdx, setActiveTagIdx] = useState(selection.activeTagIndex);
  const activeTag = selection.tags[activeTagIdx];

  const [product, setProduct] = useState<BuyerProduct | null>(null);
  const [phase, setPhase] = useState<SheetPhase>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [qty, setQty] = useState(1);
  const [variantError, setVariantError] = useState('');
  const [flyingToCart, setFlyingToCart] = useState(false);
  const [showAddedConfirmation, setShowAddedConfirmation] = useState(false);
  const [cartTarget, setCartTarget] = useState<CartFlightPoint | null>(null);
  const addedConfirmationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Slide-up animation
  const slideY = useRef(new Animated.Value(400)).current;
  const cartFlyProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!shouldAnimateCartSuccess(reduceMotion)) {
      slideY.setValue(0);
      return;
    }
    Animated.spring(slideY, {
      toValue: 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 3,
    }).start();
  }, [reduceMotion, slideY]);

  useEffect(() => () => {
    if (addedConfirmationTimer.current) clearTimeout(addedConfirmationTimer.current);
  }, []);

  // Dismiss animation
  function dismissSheet(cb?: () => void) {
    if (!shouldAnimateCartSuccess(reduceMotion)) {
      cb?.();
      return;
    }
    Animated.timing(slideY, {
      toValue: 500,
      duration: 220,
      useNativeDriver: true,
    }).start(() => cb?.());
  }

  function handleClose() {
    dismissSheet(onClose);
  }

  function showCartSuccess(newCount: number) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onCartUpdated?.(newCount);
    setShowAddedConfirmation(true);
    addedConfirmationTimer.current = setTimeout(() => {
      setShowAddedConfirmation(false);
      addedConfirmationTimer.current = null;
    }, 1200);
  }

  async function flyProductToCart(newCount: number) {
    if (!shouldAnimateCartSuccess(reduceMotion)) {
      showCartSuccess(newCount);
      return;
    }
    const target = await measureCartTarget(
      cartTargetRef?.current?.measureInWindow.bind(cartTargetRef.current),
      safeFallbackTarget,
    );
    setCartTarget(target);
    setFlyingToCart(true);
    cartFlyProgress.setValue(0);
    requestAnimationFrame(() => {
      Animated.timing(cartFlyProgress, {
        toValue: 1,
        duration: 720,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        setFlyingToCart(false);
        showCartSuccess(newCount);
      });
    });
  }

  // Swipe-down to close
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) slideY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.8) {
          dismissSheet(onClose);
        } else {
          Animated.spring(slideY, { toValue: 0, useNativeDriver: true, speed: 20 }).start();
        }
      },
    }),
  ).current;

  // Hydrate product when active tag changes
  const loadProduct = useCallback(async (tagIdx: number) => {
    const tag = selection.tags[tagIdx];
    if (!tag?.productId) {
      setPhase('error');
      setErrorMsg('No product linked to this tag.');
      return;
    }
    setPhase('loading');
    setErrorMsg('');
    setSelections({});
    setQty(1);
    setVariantError('');
    if (selection.previewProduct && tag.productId === selection.previewProduct.id) {
      const preview = selection.previewProduct;
      setProduct(preview);
      const firstVariant = preview.variants.find(candidate => candidate.isAvailable);
      if (firstVariant) {
        setSelections(Object.fromEntries(firstVariant.optionValues.map(ov => [ov.optionId, ov.valueId])));
        setPhase('ready');
      } else {
        setPhase('sold_out');
      }
      return;
    }
    try {
      const p = await getBuyerProduct(tag.productId);
      if (!p) {
        setPhase('error');
        setErrorMsg('Product not found.');
        return;
      }
      setProduct(p);

      if (!p.isActive) {
        setPhase('unavailable');
        return;
      }

      // Auto-select if no variants or single variant
      if (p.variants.length === 0) {
        setPhase('sold_out');
        return;
      }
      if (p.variants.length === 1) {
        const only = p.variants[0];
        const autoSel = Object.fromEntries(only.optionValues.map(ov => [ov.optionId, ov.valueId]));
        setSelections(autoSel);
        setPhase(only.isAvailable ? 'ready' : 'sold_out');
        return;
      }

      const hasAnyStock = p.variants.some(v => v.isAvailable);
      setPhase(hasAnyStock ? 'ready' : 'sold_out');
    } catch {
      setPhase('error');
      setErrorMsg("Couldn't load this product. Tap to retry.");
    }
  }, [selection.tags]);

  useEffect(() => { loadProduct(activeTagIdx); }, [activeTagIdx, loadProduct]);

  // Variant → price
  const variant = product ? findVariant(product, selections) : null;
  const variantPrice = variant?.priceCents ?? product?.priceCents ?? 0;
  const variantCompare = variant?.compareAtPriceCents ?? product?.compareAtPriceCents;
  const hasDiscount = variantCompare != null && variantCompare > variantPrice;
  const allOptionsSelected =
    !product ||
    product.options.length === 0 ||
    Object.keys(selections).length === product.options.length;
  const inStock = variant
    ? variant.isAvailable && variant.inventoryQuantity > 0
    : product != null && product.variants.every(v => v.inventoryQuantity === 0)
      ? false
      : true;
  const maxQty = variant ? Math.max(1, variant.inventoryQuantity) : 10;

  const attribution: CheckoutAttribution = {
    sourcePostId: selection.postId,
    sourceTagId: activeTag?.tagId ?? activeTag?.productId,
    channel: 'thread',
  };

  // Add to cart
  async function handleAddToCart() {
    if (!product) return;
    if (!allOptionsSelected) {
      setVariantError('Please select all options before adding to cart.');
      return;
    }
    if (!variant) {
      setVariantError('Please select a valid combination.');
      return;
    }
    if (!variant.isAvailable) {
      setVariantError('This combination is out of stock.');
      return;
    }
    setVariantError('');
    if (selection.previewProduct) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setPhase('added');
      void flyProductToCart(qty);
      return;
    }
    setPhase('adding');
    try {
      const result = await addToCart({ product, variant, quantity: qty, attribution });
      const newCount = getSuccessfulCartCount(result);
      if (newCount == null) {
        setPhase('ready');
        setVariantError(result.message ?? 'Could not add to cart.');
        return;
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setPhase('added');
      void flyProductToCart(newCount);
    } catch {
      setPhase('ready');
      setVariantError("Couldn't add to bag. Try again.");
    }
  }

  // Buy now
  async function handleBuyNow() {
    if (!product) return;
    if (!allOptionsSelected) {
      setVariantError('Please select all options.');
      return;
    }
    if (!variant || !variant.isAvailable) {
      setVariantError('The selected variant is not available.');
      return;
    }
    setVariantError('');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setPhase('buying');
    try {
      const cart = await getCart();
      await createBuyNowSession(product, variant, qty, cart);
      dismissSheet(() => {
        router.push('/thread-checkout' as never);
      });
    } catch {
      setPhase('ready');
      setVariantError("Couldn't start checkout. Try again.");
    }
  }

  // View full detail
  function handleViewDetail() {
    if (!activeTag?.productId) return;
    dismissSheet(() => {
      push(
        `/thread-product-detail?productId=${encodeURIComponent(activeTag.productId)}&sourcePostId=${encodeURIComponent(selection.postId)}` as never,
      );
    });
  }

  function handleViewCart() {
    dismissSheet(() => {
      router.push('/(buyer)/cart' as never);
    });
  }

  const accent = theme.accent;
  const isBusy = phase === 'adding' || phase === 'buying';
  const flyStartLeft = windowWidth / 2 - 24;
  const flyStartTop = windowHeight - Math.min(330, windowHeight * 0.4);
  const safeFallbackTarget = { x: windowWidth - 54, y: insets.top + 26 };
  const resolvedCartTarget = cartTarget ?? safeFallbackTarget;
  const flightVector = getCartFlightVector(flyStartLeft, flyStartTop, resolvedCartTarget);
  // Capture phase as string to allow comparison across JSX blocks without narrowing conflicts
  const currentPhase: string = phase;

  return (
    <Modal transparent animationType="none" visible onRequestClose={handleClose}>
      {/* Dim backdrop — tap to dismiss */}
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={ss.backdrop} />
      </TouchableWithoutFeedback>

      <Animated.View
        style={[ss.sheet, {
          backgroundColor: theme.surface,
          borderColor: theme.border,
          paddingBottom: insets.bottom + 8,
          transform: [{ translateY: slideY }],
        }]}
        {...panResponder.panHandlers}
      >
        {/* ─ Handle ─ */}
        <View style={ss.handle} />

        {/* ─ Header ─ */}
        <View style={ss.header}>
          <Text style={ss.eyebrow}>SHOP THE POST</Text>
          <TouchableOpacity
            onPress={handleClose}
            style={ss.closeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Close"
          >
            <Feather name="x" size={17} color={FG} />
          </TouchableOpacity>
        </View>

        {/* ─ Multi-tag switcher ─ */}
        {selection.tags.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={ss.tagRow}
          >
            {selection.tags.map((tag, idx) => (
              <TouchableOpacity
                key={tag.productId + idx}
                onPress={() => {
                  Haptics.selectionAsync();
                  setActiveTagIdx(idx);
                }}
                style={[
                  ss.tagChip,
                  activeTagIdx === idx && { borderColor: accent, backgroundColor: `${accent}18` },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`Switch to ${tag.productName}`}
              >
                <Feather name="shopping-bag" size={11} color={activeTagIdx === idx ? accent : MUTED} />
                <Text
                  style={[ss.tagChipText, activeTagIdx === idx && { color: accent }]}
                  numberOfLines={1}
                >
                  {tag.productName}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* ─ Content ─ */}
        {phase === 'loading' && (
          <View style={ss.centerBox} accessibilityLiveRegion="polite">
            <ActivityIndicator color={accent} size="large" />
            <Text style={ss.loadingText}>Loading product…</Text>
          </View>
        )}

        {phase === 'error' && (
          <View style={ss.centerBox}>
            <Feather name="alert-circle" size={ICON.lg} color={RED} />
            <Text style={ss.errorText}>{errorMsg || 'Could not load product.'}</Text>
            <TouchableOpacity
              onPress={() => loadProduct(activeTagIdx)}
              style={[ss.retryBtn, { borderColor: accent }]}
            >
              <Feather name="refresh-cw" size={14} color={accent} />
              <Text style={[ss.retryText, { color: accent }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'sold_out' && product && (
          <ProductHeader
            product={product}
            variantPrice={variantPrice}
            variantCompare={variantCompare}
            hasDiscount={hasDiscount}
            accent={accent}
          />
        )}

        {phase === 'unavailable' && product && (
          <View>
            <ProductHeader
              product={product}
              variantPrice={variantPrice}
              variantCompare={variantCompare}
              hasDiscount={hasDiscount}
              accent={accent}
            />
            <View style={[ss.statusBanner, { backgroundColor: RED_DIM }]}>
              <Feather name="alert-triangle" size={14} color={RED} />
              <Text style={[ss.statusText, { color: RED }]}>This product is no longer available</Text>
            </View>
          </View>
        )}

        {(phase === 'ready' || phase === 'adding' || phase === 'buying' || phase === 'added') && product && (
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {/* Swipeable image gallery */}
            <ProductImageCarousel imageUris={product.imageUris} />

            {/* Product header row */}
            <ProductHeader
              product={product}
              variantPrice={variantPrice}
              variantCompare={variantCompare}
              hasDiscount={hasDiscount}
              accent={accent}
              onViewDetail={handleViewDetail}
            />

            <View style={ss.descriptionSection}>
              <Text style={ss.descriptionLabel}>Description</Text>
              <Text style={ss.descriptionText}>
                {product.description.trim() || 'Product details are not available.'}
              </Text>
            </View>

            {/* Variant options */}
            {product.options.map((option: BuyerProductOption) => (
              <View key={option.id} style={ss.optionSection}>
                <View style={ss.optionHeader}>
                  <Text style={ss.optionLabel}>{option.name}</Text>
                  {selections[option.id] && (
                    <Text style={[ss.optionSelected, { color: accent }]}>
                      {option.values.find(v => v.id === selections[option.id])?.label}
                    </Text>
                  )}
                </View>
                <View style={ss.chipsRow}>
                  {option.values.map(val => {
                    const { [option.id]: _ign, ...rest } = selections;
                    const available = isVariantComboAvailable(product, option.id, val.id, rest);
                    return (
                      <OptionChip
                        key={val.id}
                        label={val.label}
                        selected={selections[option.id] === val.id}
                        available={available}
                        accentColor={accent}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setSelections(prev => {
                            const updated = { ...prev, [option.id]: val.id };
                            const newVariant = findVariant(product, updated);
                            if (newVariant && qty > newVariant.inventoryQuantity) setQty(1);
                            return updated;
                          });
                          setVariantError('');
                        }}
                      />
                    );
                  })}
                </View>
              </View>
            ))}

            {/* Qty + stock */}
            <View style={ss.qtyRow}>
              <Text style={ss.optionLabel}>Qty</Text>
              <View style={{ flex: 1 }} />
              {variant && variant.inventoryQuantity <= 5 && (
                <Text style={ss.lowStock}>
                  Only {variant.inventoryQuantity} left
                </Text>
              )}
              <QtyControl
                qty={qty}
                max={maxQty}
                onDec={() => setQty(q => Math.max(1, q - 1))}
                onInc={() => setQty(q => Math.min(maxQty, q + 1))}
              />
            </View>

            {/* Variant error */}
            {!!variantError && (
              <View style={ss.variantError}>
                <Feather name="alert-circle" size={13} color={RED} />
                <Text style={ss.variantErrorText}>{variantError}</Text>
              </View>
            )}

            {/* Trust cues */}
            <View style={ss.trustRow}>
              <TrustCue icon="shield" label="Secure checkout" />
              <TrustCue icon="refresh-cw" label="Easy returns" />
              <TrustCue icon="truck" label="Fast shipping" />
            </View>

            <TouchableOpacity onPress={handleViewDetail} style={ss.viewDetailBtn}>
              <Text style={ss.viewDetailText}>View full product details</Text>
              <Feather name="chevron-right" size={13} color={MUTED} />
            </TouchableOpacity>

            {/* Spacer so content never sits behind the sticky action bar below */}
            <View style={{ height: 84 }} />
          </ScrollView>
        )}

        {/* Sticky Add to Cart + Buy Now — always reachable, never scrolls away */}
        {(phase === 'ready' || phase === 'adding' || phase === 'buying' || phase === 'added') && product && (
          <View style={ss.stickyActionsWrap}>
            <View style={ss.actions}>
              <TouchableOpacity
                onPress={phase === 'added' ? handleViewCart : handleAddToCart}
                disabled={isBusy || currentPhase === 'sold_out'}
                activeOpacity={0.85}
                style={[ss.addBtn, isBusy && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel={phase === 'added' ? 'View cart' : 'Add to cart'}
              >
                {phase === 'adding' ? (
                  <ActivityIndicator color={FG} size="small" />
                ) : (
                  <>
                    <Feather name="shopping-cart" size={17} color={FG} />
                    <Text style={ss.addBtnText}>{phase === 'added' ? 'View cart' : 'Add to cart'}</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleBuyNow}
                disabled={isBusy || currentPhase === 'sold_out'}
                activeOpacity={0.85}
                style={[ss.buyBtn, { backgroundColor: accent }, isBusy && { opacity: 0.6 }]}
                accessibilityRole="button"
                accessibilityLabel="Buy now"
              >
                {phase === 'buying' ? (
                  <ActivityIndicator color={theme.onAccent} size="small" />
                ) : (
                  <>
                    <Feather name="arrow-right-circle" size={18} color={theme.onAccent} />
                    <Text style={[ss.buyBtnText, { color: theme.onAccent }]}>Buy now</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {phase === 'sold_out' && product && (
          <View>
            <View style={[ss.statusBanner, { backgroundColor: `${ORANGE}22` }]}>
              <Feather name="clock" size={14} color={ORANGE} />
              <Text style={[ss.statusText, { color: ORANGE }]}>Sold out — check back soon</Text>
            </View>
            <TouchableOpacity onPress={handleViewDetail} style={[ss.addBtn, { marginHorizontal: 16, marginBottom: 8 }]}>
              <Feather name="eye" size={17} color={FG} />
              <Text style={ss.addBtnText}>View product</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>

      {flyingToCart && (
        <Animated.View
          pointerEvents="none"
          style={[
            ss.cartFlyItem,
            {
              left: flyStartLeft,
              top: flyStartTop,
              opacity: cartFlyProgress.interpolate({
                inputRange: [0, 0.82, 1],
                outputRange: [1, 1, 0],
              }),
              transform: [
                {
                  translateX: cartFlyProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, flightVector.x],
                  }),
                },
                {
                  translateY: cartFlyProgress.interpolate({
                    inputRange: [0, 0.55, 1],
                    outputRange: [
                      0,
                      -Math.min(windowHeight * 0.27, Math.max(48, flyStartTop - resolvedCartTarget.y) * 0.45),
                      flightVector.y,
                    ],
                  }),
                },
                {
                  scale: cartFlyProgress.interpolate({
                    inputRange: [0, 0.7, 1],
                    outputRange: [1, 0.72, 0.28],
                  }),
                },
                {
                  rotate: cartFlyProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '10deg'],
                  }),
                },
              ],
            },
          ]}
        >
          {product?.imageUris?.[0] ? (
            <Image source={{ uri: product.imageUris[0] }} style={ss.cartFlyImage} />
          ) : (
            <View style={[ss.cartFlyFallback, { backgroundColor: theme.accent }]}>
              <Feather name="shopping-bag" size={21} color={theme.onAccent} />
            </View>
          )}
        </Animated.View>
      )}

      {showAddedConfirmation && (
        <View style={ss.addedConfirmationOverlay} pointerEvents="none" accessibilityLiveRegion="polite">
          <View style={ss.addedConfirmationContent}>
            <Feather name="shopping-cart" size={36} color={ON_DARK} />
            <Text style={ss.addedConfirmationText}>Added to cart</Text>
          </View>
        </View>
      )}
    </Modal>
  );
}

// ─── ProductHeader ─────────────────────────────────────────────────────────────

function ProductHeader({
  product,
  variantPrice,
  variantCompare,
  hasDiscount,
  accent,
  onViewDetail,
}: {
  product: BuyerProduct;
  variantPrice: number;
  variantCompare?: number;
  hasDiscount: boolean;
  accent: string;
  onViewDetail?: () => void;
}) {
  const imageUri = product.imageUris[0];

  return (
    <TouchableOpacity
      style={ss.productRow}
      onPress={onViewDetail}
      activeOpacity={onViewDetail ? 0.8 : 1}
      accessibilityRole={onViewDetail ? 'button' : 'none'}
      accessibilityLabel={onViewDetail ? `View details for ${product.name}` : undefined}
    >
      <View style={ss.productImageWrap}>
        {imageUri ? (
          <CachedImage
            source={{ uri: imageUri }}
            style={ss.productImage}
            contentFit="cover"
          />
        ) : (
          <View style={[ss.productImage, ss.productImagePlaceholder]}>
            <Feather name="image" size={22} color={SUBTLE} />
          </View>
        )}
        {product.isPreOrder && (
          <View style={ss.preOrderBadge}>
            <Text style={ss.preOrderText}>PRE</Text>
          </View>
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={ss.productName} numberOfLines={2}>{product.name}</Text>
        <View style={ss.priceRow}>
          <Text style={[ss.productPrice, { color: accent }]}>
            {formatCents(variantPrice)}
          </Text>
          {hasDiscount && variantCompare != null && (
            <Text style={ss.comparePrice}>{formatCents(variantCompare)}</Text>
          )}
        </View>
        <Text style={ss.sellerName} numberOfLines={1}>
          by {product.sellerName}
          {product.sellerHandle ? ` · ${product.sellerHandle}` : ''}
        </Text>
      </View>
      {onViewDetail && (
        <Feather name="chevron-right" size={16} color={SUBTLE} style={{ alignSelf: 'center' }} />
      )}
    </TouchableOpacity>
  );
}

// ─── Product image carousel — swipeable, with a 1/N counter ─────────────────

function ProductImageCarousel({ imageUris }: { imageUris: string[] }) {
  const { width: windowWidth } = useWindowDimensions();
  const pageWidth = Math.min(windowWidth, 520);
  const [index, setIndex] = useState(0);
  const images = imageUris.length > 0 ? imageUris : [''];

  if (images.length === 1) {
    return (
      <View style={[ss.carouselWrap, { height: pageWidth }]}>
        {images[0] ? (
          <CachedImage source={{ uri: images[0] }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <View style={[StyleSheet.absoluteFill, ss.productImagePlaceholder]}>
            <Feather name="image" size={28} color={SUBTLE} />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[ss.carouselWrap, { height: pageWidth }]}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => {
          const next = Math.round(e.nativeEvent.contentOffset.x / pageWidth);
          setIndex(Math.max(0, Math.min(images.length - 1, next)));
        }}
      >
        {images.map((uri, i) => (
          <View key={`${uri}-${i}`} style={{ width: pageWidth, height: pageWidth }}>
            {uri ? (
              <CachedImage source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            ) : (
              <View style={[StyleSheet.absoluteFill, ss.productImagePlaceholder]}>
                <Feather name="image" size={28} color={SUBTLE} />
              </View>
            )}
          </View>
        ))}
      </ScrollView>
      <View style={ss.carouselCounter} pointerEvents="none">
        <Text style={ss.carouselCounterText}>{index + 1}/{images.length}</Text>
      </View>
    </View>
  );
}

// ─── Trust cue pill ───────────────────────────────────────────────────────────

function TrustCue({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={ss.trustCue}>
      <Feather name={icon as any} size={11} color={MUTED} />
      <Text style={ss.trustCueText}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  cartFlyItem: {
    position: 'absolute',
    zIndex: 20,
    width: 48,
    height: 48,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: ON_DARK,
    shadowColor: BG,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 12,
  },
  cartFlyImage: { width: '100%', height: '100%' },
  cartFlyFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addedConfirmationOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  addedConfirmationContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  addedConfirmationText: {
    color: ON_DARK,
    fontFamily: FONT.bold,
    fontSize: FS.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: OVERLAY,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderColor: BORDER,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: BORDER,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  eyebrow: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: MUTED,
    letterSpacing: 1.2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: CARD_ELEVATED,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Tag switcher
  tagRow: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
    flexDirection: 'row',
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    maxWidth: 180,
  },
  tagChipText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
    flexShrink: 1,
  },

  // Loading / error
  centerBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 40,
    paddingHorizontal: 24,
  },
  loadingText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
  },
  errorText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: RED,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
  },
  retryText: { fontSize: FS.sm, fontFamily: FONT.semibold },

  // Product header
  productRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  productImageWrap: { position: 'relative' },
  productImage: {
    width: 88,
    height: 108,
    borderRadius: RADIUS.md,
    backgroundColor: CARD_ELEVATED,
  },
  productImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_ELEVATED,
  },
  carouselWrap: { width: '100%', backgroundColor: CARD_ELEVATED },
  carouselCounter: {
    position: 'absolute', right: 10, bottom: 10,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  carouselCounterText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 11 },
  preOrderBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  preOrderText: { fontSize: FS.xs, fontFamily: FONT.bold, color: ON_DARK },
  productName: {
    fontSize: FS.md,
    fontFamily: FONT.bold,
    color: FG,
    lineHeight: 21,
  },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  productPrice: { fontSize: FS.lg, fontFamily: FONT.bold },
  comparePrice: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: SUBTLE,
    textDecorationLine: 'line-through',
  },
  sellerName: { fontSize: FS.xs, fontFamily: FONT.regular, color: MUTED },
  descriptionSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: BORDER_SUBTLE,
    gap: 6,
  },
  descriptionLabel: {
    fontSize: FS.xs,
    fontFamily: FONT.bold,
    color: FG,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  descriptionText: {
    fontSize: FS.sm,
    fontFamily: FONT.regular,
    color: MUTED,
    lineHeight: 20,
  },

  // Options
  optionSection: { paddingHorizontal: 16, marginBottom: 14 },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  optionLabel: { fontSize: FS.sm, fontFamily: FONT.semibold, color: FG },
  optionSelected: { fontSize: FS.sm, fontFamily: FONT.regular },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  // Qty row
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 10,
  },
  lowStock: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: ORANGE,
  },

  // Variant error
  variantError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  variantErrorText: {
    fontSize: FS.xs,
    fontFamily: FONT.regular,
    color: RED,
    flex: 1,
  },

  // Status banner
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 14,
    padding: 12,
    borderRadius: RADIUS.sm,
  },
  statusText: { fontSize: FS.sm, fontFamily: FONT.medium },

  // Trust cues
  trustRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginHorizontal: 16,
    marginBottom: 16,
  },
  trustCue: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  trustCueText: { fontSize: FS.xs, fontFamily: FONT.regular, color: SUBTLE },

  // Action buttons
  stickyActionsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    backgroundColor: CARD,
    borderTopWidth: 1,
    borderTopColor: BORDER_SUBTLE,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 50,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ELEVATED,
  },
  addBtnText: {
    fontSize: FS.base,
    fontFamily: FONT.semibold,
    color: FG,
  },
  buyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 50,
    borderRadius: RADIUS.md,
  },
  buyBtnText: {
    fontSize: FS.base,
    fontFamily: FONT.bold,
  },

  // View detail
  viewDetailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    marginBottom: 4,
  },
  viewDetailText: {
    fontSize: FS.xs,
    fontFamily: FONT.medium,
    color: MUTED,
  },
});
