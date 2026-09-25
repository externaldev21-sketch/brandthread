/**
 * Brandthread Cart & Checkout Service
 * AsyncStorage-backed layer. Real API failures propagate; no fake product substitution.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '@/lib/serviceConfig';
import {
  Cart, CartItem, SavedCartItem, CartSellerGroup,
  CheckoutSession, CheckoutContact, CheckoutAddress,
  CheckoutDeliveryGroup, CheckoutShippingMethod, CheckoutDiscount,
  CheckoutTax, CheckoutSummary,
  CheckoutLoyaltyRedemption, CheckoutThreadCashRedemption,
  CheckoutAcknowledgment, CheckoutAttribution,
  CartValidationResult, CartValidationIssue,
  BuyerProduct, BuyerProductOption, BuyerProductVariant,
  BuyerReturnRequest, BuyerReturnReason, BuyerReturnResolution,
  BuyerRefundRequest, BuyerProblemReport, BuyerProblemType,
} from './cartTypes';
import { formatCents } from '@/lib/money';
import { trackAndRelayConversionEvent } from '@/lib/marketingPixels';

// ─── Storage keys (scoped by user ID so two accounts never share storage) ─────

/** Set by initCartService() after sign-in. Falls back to 'anon'. */
let _cartUserId = 'anon';

/** Call once after Clerk resolves the current user ID (and again on sign-out
 *  with null to reset to 'anon'). */
export function initCartService(userId: string | null): void {
  _cartUserId = userId ?? 'anon';
}

function keys(uid = _cartUserId) {
  return {
    /** Baked-in user ID — compare against _cartUserId after awaits to detect account switches. */
    userId:          uid,
    cart:            `bt:cart:${uid}:v1`,
    checkout:        `bt:checkout:${uid}:v1`,
    returns:         `bt:buyer:${uid}:returns:v1`,
    refunds:         `bt:buyer:${uid}:refunds:v1`,
    problems:        `bt:buyer:${uid}:problems:v1`,
    paymentAttempts: `bt:buyer:${uid}:payment_attempts:v1`,
  };
}
/** Keys snapshot type — passed through the call chain so private helpers
 *  never re-resolve _cartUserId in async continuations. */
type CartKeys = ReturnType<typeof keys>;

/**
 * Money-schema boundary for persisted cart records.  Pre-cents records used a
 * floating `price` field; intentionally do not guess/scale it.  Such lines
 * must be refreshed from the catalog rather than charged at an inferred price.
 */
function normalizeCart(cart: Cart): Cart {
  const isCents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
  return {
    ...cart,
    items: (Array.isArray(cart.items) ? cart.items : []).filter(item => isCents((item as CartItem).priceCents)),
    savedItems: (Array.isArray(cart.savedItems) ? cart.savedItems : []).filter(item => isCents((item as SavedCartItem).priceCents)),
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 11); }
function now(): string { return new Date().toISOString(); }
function daysFromNow(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString();
}

// ─── Product lookup ───────────────────────────────────────────────────────────
// Returns null when the product is not found — callers must handle the absent case.
// No fallback substitution: an unavailable product must not silently become another.

function adaptApiProduct(row: any): BuyerProduct {
  const apiVariants: any[] = Array.isArray(row?.variants) ? row.variants : [];
  const sizes = [...new Set<string>(apiVariants.map(v => v.size).filter(Boolean))];
  const colors = [...new Set<string>(apiVariants.map(v => v.color).filter(Boolean))];

  const options: BuyerProductOption[] = [];
  if (sizes.length > 0) {
    options.push({
      id: 'opt_size',
      name: 'Size',
      values: sizes.map(size => ({ id: `size_${size}`, label: size })),
    });
  }
  if (colors.length > 0) {
    options.push({
      id: 'opt_color',
      name: 'Color',
      values: colors.map(color => ({ id: `color_${color}`, label: color })),
    });
  }

  const firstImage = Array.isArray(row?.images) ? row.images[0] : undefined;
  const variants: BuyerProductVariant[] = apiVariants.map(variant => {
    const optionValues: { optionId: string; valueId: string }[] = [];
    if (variant.size) {
      optionValues.push({ optionId: 'opt_size', valueId: `size_${variant.size}` });
    }
    if (variant.color) {
      optionValues.push({ optionId: 'opt_color', valueId: `color_${variant.color}` });
    }
    return {
      id: variant.id,
      title: [variant.size, variant.color].filter(Boolean).join(' / ') || 'Default',
      optionValues,
      priceCents: variant.priceCents ?? 0,
      inventoryQuantity: variant.stock ?? 0,
      isAvailable: (variant.stock ?? 0) > 0,
      imageUri: firstImage,
    };
  });

  return {
    id: row.id,
    sellerId: row.ownerId,
    sellerName: row.sellerDisplayName ?? 'Seller',
    sellerHandle: row.sellerHandle ?? '',
    name: row.name,
    description: row.description ?? '',
    priceCents: variants.length > 0 ? Math.min(...variants.map(v => v.priceCents)) : 0,
    imageUris: Array.isArray(row.images) ? row.images : [],
    category: row.category ?? 'apparel',
    isPreOrder: row.isPreOrder ?? false,
    preOrderClosingDate: row.preOrderClosingDate
      ? new Date(row.preOrderClosingDate).toISOString()
      : undefined,
    preOrderEstShipDate: row.preOrderEstShipDate
      ? new Date(row.preOrderEstShipDate).toISOString()
      : undefined,
    cancellationPolicy: 'All sales final unless the item arrives damaged.',
    refundPolicy: 'Contact seller within 7 days of delivery for returns.',
    options,
    variants,
    isActive: row.status ? row.status === 'active' : true,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

export async function getBuyerProduct(productId: string): Promise<BuyerProduct | null> {
  if (!productId) return null;
  try {
    const row = await serviceRequest<any>(
      `/api/public/products/${encodeURIComponent(productId)}`,
    );
    return row?.id ? adaptApiProduct(row) : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('API 404:')) return null;
    throw error;
  }
}

// ─── DB sync ──────────────────────────────────────────────────────────────────

async function syncToDb(items: any[], savedItems: any[], expectedUserId: string): Promise<void> {
  // Guard: if the account has changed since saveCart() was called, discard this
  // sync so user A's cart payload is never POSTed using user B's Clerk token.
  if (_cartUserId !== expectedUserId) return;
  try {
    await serviceRequest('/api/buyer/cart/sync', {
      method: 'POST',
      body: JSON.stringify({ items, savedItems }),
    });
  } catch { /* ignore — local is source of truth */ }
}

// ─── Cart storage ─────────────────────────────────────────────────────────────

async function loadCartWithStatus(k: CartKeys = keys()): Promise<{ cart: Cart; remoteConfirmed: boolean }> {
  let cart: Cart;
  try {
    const raw = await AsyncStorage.getItem(k.cart);
    if (raw) {
      cart = normalizeCart(JSON.parse(raw) as Cart);
    } else {
      cart = { id: uid(), items: [], savedItems: [], updatedAt: now() };
    }
  } catch {
    cart = { id: uid(), items: [], savedItems: [], updatedAt: now() };
  }

  // Attempt to load from DB and merge if DB has data.
  // Uses the already-captured k so the continuation can't pick up a changed userId.
  let remoteConfirmed = false;
  try {
    const { items, savedItems } = await serviceRequest<{ items: any[]; savedItems: any[] }>('/api/buyer/cart', {});
    remoteConfirmed = true;
    if (items.length > 0 || savedItems.length > 0) {
      // DB has data — use it and update local cache.
      // Guard: skip cache write if account switched while the request was in-flight.
      if (_cartUserId === k.userId) {
        cart.items = items.filter(item => typeof item?.priceCents === 'number' && Number.isSafeInteger(item.priceCents));
        cart.savedItems = savedItems.filter(item => typeof item?.priceCents === 'number' && Number.isSafeInteger(item.priceCents));
        await AsyncStorage.setItem(k.cart, JSON.stringify(cart));
      }
    }
  } catch { /* remoteConfirmed stays false — see getCartForScreen() */ }

  return { cart, remoteConfirmed };
}

async function loadCart(k: CartKeys = keys()): Promise<Cart> {
  return (await loadCartWithStatus(k)).cart;
}

/**
 * Cart-screen-only read: on top of the cart, reports whether we could
 * actually confirm its contents against the server this time.
 *
 * Root-cause note: a plain empty local cache can mean either "the buyer's
 * cart is genuinely empty" or "we couldn't reach /api/buyer/cart to confirm
 * it" (a signed-out token race, a network blip). Silently treating both the
 * same way is what made the cart page look empty even when the buyer really
 * did have items pending sync — the screen should only ever show the real
 * empty state when it's actually confirmed empty, not merely unconfirmed.
 */
export async function getCartForScreen(): Promise<{ cart: Cart; loadError: boolean }> {
  const { cart, remoteConfirmed } = await loadCartWithStatus();
  const loadError = !remoteConfirmed && cart.items.length === 0 && cart.savedItems.length === 0;
  return { cart, loadError };
}

async function saveCart(cart: Cart, k: CartKeys = keys()): Promise<void> {
  cart.updatedAt = now();
  await AsyncStorage.setItem(k.cart, JSON.stringify(cart));
  // Pass k.userId so syncToDb can drop the request if the account switches before it fires.
  void syncToDb(cart.items, cart.savedItems, k.userId);
}

// ─── Cart operations ──────────────────────────────────────────────────────────

export async function getCart(): Promise<Cart> {
  const k = keys();
  return loadCart(k);
}

export interface AddToCartParams {
  product: BuyerProduct;
  variant: BuyerProductVariant;
  quantity: number;
  attribution?: CheckoutAttribution;
}

export async function addToCart(params: AddToCartParams): Promise<{ success: boolean; message?: string; cart: Cart }> {
  const k = keys();
  const { product, variant, quantity, attribution } = params;
  const cart = await loadCart(k);

  // Validate
  if (!product.isActive) return { success: false, message: 'This product is no longer available.', cart };
  if (!variant.isAvailable) return { success: false, message: 'The selected variant is not available.', cart };
  if (variant.inventoryQuantity < quantity && product.isPreOrder === false) {
    return { success: false, message: `Only ${variant.inventoryQuantity} units available.`, cart };
  }

  // Check existing
  const existingIdx = cart.items.findIndex(i => i.variantId === variant.id);
  if (existingIdx >= 0) {
    const existing = cart.items[existingIdx];
    const newQty = existing.quantity + quantity;
    const cap = variant.inventoryQuantity > 0 ? variant.inventoryQuantity : 99;
    if (newQty > cap) {
      return { success: false, message: `You already have ${existing.quantity} in your cart. Can't add more.`, cart };
    }
    cart.items[existingIdx] = { ...existing, quantity: newQty };
  } else {
    const item: CartItem = {
      id: uid(),
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantTitle: variant.title,
      imageUri: variant.imageUri ?? product.imageUris[0],
      sellerId: product.sellerId,
      sellerName: product.sellerName,
      sellerHandle: product.sellerHandle,
      priceCents: variant.priceCents ?? product.priceCents,
      compareAtPriceCents: variant.compareAtPriceCents ?? product.compareAtPriceCents,
      quantity,
      maxQuantity: variant.inventoryQuantity > 0 ? variant.inventoryQuantity : 99,
      isPreOrder: product.isPreOrder,
      preOrderEstShipDate: product.preOrderEstShipDate,
      inventoryPolicy: 'deny',
      isAvailable: true,
      sourcePostId: attribution?.sourcePostId,
      sourceTagId: attribution?.sourceTagId,
      addedAt: now(),
    };
    cart.items.push(item);
  }

  await saveCart(cart, k);

  // Meta Pixel + Conversions API — this is the single choke point every
  // "Add to cart" entry point (product detail, shop sheet, …) funnels
  // through, so it's the correct place to fire AddToCart once.
  const itemValueCents = (variant.priceCents ?? product.priceCents) * quantity;
  void trackAndRelayConversionEvent(
    'AddToCart',
    { content_ids: [product.id], content_type: 'product', value: itemValueCents / 100, currency: 'usd' },
    { productId: product.id, valueCents: itemValueCents, currency: 'usd' },
  );

  return { success: true, cart };
}

export async function updateCartItemQuantity(itemId: string, quantity: number): Promise<Cart> {
  const k = keys();
  const cart = await loadCart(k);
  const idx = cart.items.findIndex(i => i.id === itemId);
  if (idx >= 0) {
    if (quantity <= 0) {
      cart.items.splice(idx, 1);
    } else {
      const item = cart.items[idx];
      const capped = Math.min(quantity, item.maxQuantity || 99);
      cart.items[idx] = { ...item, quantity: capped };
    }
    await saveCart(cart, k);
  }
  return cart;
}

/** Replace one existing cart line after the buyer changes its variant on product detail. */
export async function replaceCartItemVariant(
  itemId: string,
  product: BuyerProduct,
  variant: BuyerProductVariant,
  quantity: number,
): Promise<{ success: boolean; message?: string; cart: Cart }> {
  const k = keys();
  const cart = await loadCart(k);
  const index = cart.items.findIndex(item => item.id === itemId);
  if (index < 0) return { success: false, message: 'That cart item is no longer available.', cart };
  if (!product.isActive || !variant.isAvailable) {
    return { success: false, message: 'The selected variant is no longer available.', cart };
  }
  if (!product.isPreOrder && variant.inventoryQuantity < quantity) {
    return { success: false, message: `Only ${variant.inventoryQuantity} units are available.`, cart };
  }

  const current = cart.items[index];
  const duplicateIndex = cart.items.findIndex(item => item.id !== itemId && item.variantId === variant.id);
  if (duplicateIndex >= 0) {
    const duplicate = cart.items[duplicateIndex];
    const mergedQuantity = duplicate.quantity + quantity;
    if (!product.isPreOrder && mergedQuantity > variant.inventoryQuantity) {
      return { success: false, message: `You already have ${duplicate.quantity} of this variant in your cart.`, cart };
    }
    cart.items[duplicateIndex] = { ...duplicate, quantity: mergedQuantity, maxQuantity: variant.inventoryQuantity || 99 };
    cart.items.splice(index, 1);
  } else {
    cart.items[index] = {
      ...current,
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantTitle: variant.title,
      imageUri: variant.imageUri ?? product.imageUris[0],
      priceCents: variant.priceCents ?? product.priceCents,
      compareAtPriceCents: variant.compareAtPriceCents ?? product.compareAtPriceCents,
      quantity,
      maxQuantity: variant.inventoryQuantity || 99,
      isAvailable: true,
      unavailableReason: undefined,
    };
  }
  await saveCart(cart, k);
  return { success: true, cart };
}

export async function removeCartItem(itemId: string): Promise<Cart> {
  const k = keys();
  const cart = await loadCart(k);
  cart.items = cart.items.filter(i => i.id !== itemId);
  await saveCart(cart, k);
  return cart;
}

/**
 * Remove exactly these line IDs, leaving every other cart line untouched.
 * Used after a checkout completes (whole-cart, selected, or single-item Buy)
 * so only the item(s) that were actually paid for ever leave the cart —
 * a Buy Now purchase on one item must never wipe unrelated items sitting in
 * the buyer's cart alongside it. IDs with no matching line (e.g. a Buy Now
 * from the product sheet, which never touches the persisted cart) are
 * harmlessly ignored.
 */
export async function removeCartItems(itemIds: string[]): Promise<Cart> {
  if (itemIds.length === 0) return getCart();
  const k = keys();
  const cart = await loadCart(k);
  const idSet = new Set(itemIds);
  cart.items = cart.items.filter(i => !idSet.has(i.id));
  await saveCart(cart, k);
  return cart;
}

/** Restore a cart snapshot captured immediately before a reversible removal.
 * The snapshot preserves line ordering and quantity (including a decrement to
 * zero) instead of attempting to reconstruct an item from catalog data. */
export async function restoreCartSnapshot(snapshot: Cart): Promise<Cart> {
  const k = keys();
  const restored: Cart = normalizeCart({
    ...snapshot,
    items: snapshot.items.map(item => ({ ...item })),
    savedItems: snapshot.savedItems.map(item => ({ ...item })),
  });
  await saveCart(restored, k);
  return restored;
}

export async function saveForLater(itemId: string): Promise<Cart> {
  const k = keys();
  const cart = await loadCart(k);
  const idx = cart.items.findIndex(i => i.id === itemId);
  if (idx >= 0) {
    const item = cart.items[idx];
    const saved: SavedCartItem = { ...item, savedAt: now() };
    cart.savedItems.push(saved);
    cart.items.splice(idx, 1);
    await saveCart(cart, k);
  }
  return cart;
}

export async function moveToCart(savedItemId: string): Promise<Cart> {
  const k = keys();
  const cart = await loadCart(k);
  const idx = cart.savedItems.findIndex(i => i.id === savedItemId);
  if (idx >= 0) {
    const saved = cart.savedItems[idx];
    const existing = cart.items.findIndex(i => i.variantId === saved.variantId);
    if (existing >= 0) {
      const current = cart.items[existing];
      cart.items[existing] = {
        ...current,
        quantity: Math.min(current.quantity + saved.quantity, current.maxQuantity || 99),
      };
    } else {
      cart.items.push({ ...saved, addedAt: now() });
    }
    cart.savedItems.splice(idx, 1);
    await saveCart(cart, k);
  }
  return cart;
}

export async function removeSavedItem(savedItemId: string): Promise<Cart> {
  const k = keys();
  const cart = await loadCart(k);
  cart.savedItems = cart.savedItems.filter(i => i.id !== savedItemId);
  await saveCart(cart, k);
  return cart;
}

export async function clearCart(): Promise<void> {
  const k = keys();
  const empty: Cart = { id: uid(), items: [], savedItems: [], updatedAt: now() };
  await saveCart(empty, k);
}

// Merge guest cart into authenticated cart (no duplicates)
export async function mergeGuestCart(guestCart: Cart): Promise<Cart> {
  const k = keys();
  const cart = await loadCart(k);
  for (const guestItem of guestCart.items) {
    const existing = cart.items.findIndex(i => i.variantId === guestItem.variantId);
    if (existing >= 0) {
      // Keep higher quantity, don't double-count
      if (guestItem.quantity > cart.items[existing].quantity) {
        cart.items[existing].quantity = guestItem.quantity;
      }
    } else {
      cart.items.push(guestItem);
    }
  }
  await saveCart(cart, k);
  return cart;
}

// ─── Cart grouping ────────────────────────────────────────────────────────────

export function groupCartBySeller(items: CartItem[]): CartSellerGroup[] {
  const map = new Map<string, CartSellerGroup>();
  for (const item of items) {
    if (!map.has(item.sellerId)) {
      map.set(item.sellerId, {
        sellerId: item.sellerId,
        sellerName: item.sellerName,
        sellerHandle: item.sellerHandle,
        sellerInitial: item.sellerName.charAt(0).toUpperCase(),
        items: [],
        subtotalCents: 0,
        hasPreOrder: false,
        estimatedShippingCents: 0,
        fulfillmentEstimate: '3–5 business days',
      });
    }
    const group = map.get(item.sellerId)!;
    group.items.push(item);
    group.subtotalCents += item.priceCents * item.quantity;
    if (item.isPreOrder) group.hasPreOrder = true;
  }
  return Array.from(map.values());
}

// ─── Cart summary ─────────────────────────────────────────────────────────────

export function calculateCartSummary(items: CartItem[], discountTotalCents = 0, shippingTotalCents = 0): CheckoutSummary {
  const subtotalCents = items.reduce((s, i) => s + i.priceCents * i.quantity, 0);
  const taxTotalCents = 0; // Calculated accurately by Stripe at checkout; not estimated here
  const totalCents = Math.max(0, subtotalCents - discountTotalCents + shippingTotalCents + taxTotalCents);
  return {
    subtotalCents,
    discountTotalCents,
    shippingTotalCents,
    taxTotalCents,
    totalCents,
    currency: 'USD',
  };
}

// ─── Real shipping rate fetch ─────────────────────────────────────────────────

/**
 * Fetch the real shipping rate from the seller's configured rates.
 * Returns seller-configured rate details in dollars. It deliberately throws on
 * failure so checkout never labels an unavailable rate as free shipping.
 */
async function fetchShippingRateDetails(
  sellerId: string,
  subtotalCents: number,
): Promise<{ id: string; name: string; amountCents: number }> {
  const resp = await serviceRequest<{
    shippingCents: number;
    rateName: string;
    isFree: boolean;
  }>(`/api/shipping-rates/calculate?sellerId=${encodeURIComponent(sellerId)}&subtotalCents=${subtotalCents}`);
  if (typeof resp.shippingCents !== 'number') throw new Error('Seller shipping rate is unavailable.');
  return {
    id: `seller_rate_${sellerId}`,
    name: resp.rateName || (resp.isFree ? 'Free shipping' : 'Standard shipping'),
    amountCents: resp.shippingCents,
  };
}

// ─── Cart validation ──────────────────────────────────────────────────────────

export async function validateCart(items: CartItem[], discountCodes: string[] = []): Promise<CartValidationResult> {
  const result = await serviceRequest<{ isValid: boolean; issues: CartValidationIssue[] }>(
    '/api/buyer/cart/validate',
    {
      method: 'POST',
      body: JSON.stringify({
        items: items.map(item => ({
          id: item.id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          priceCents: item.priceCents,
        })),
        discountCodes,
      }),
    },
  );
  return { isValid: result.isValid, issues: result.issues ?? [] };
}

// ─── Checkout session ─────────────────────────────────────────────────────────

async function loadCheckout(k: CartKeys = keys()): Promise<CheckoutSession | null> {
  try {
    const raw = await AsyncStorage.getItem(k.checkout);
    if (raw) return JSON.parse(raw) as CheckoutSession;
  } catch {}
  return null;
}

async function saveCheckout(session: CheckoutSession, k: CartKeys = keys()): Promise<void> {
  session.updatedAt = now();
  await AsyncStorage.setItem(k.checkout, JSON.stringify(session));
}

export async function createCheckoutSession(
  cart: Cart,
  isBuyNow = false,
  buyNowItems?: CartItem[],
  loyaltyRedemption?: CheckoutLoyaltyRedemption,
  // THREAD CASH HOOK POINT: additive trailing param, mirrors loyaltyRedemption.
  // Not yet sent to the server as a real discount — see
  // docs/payments/thread-cash-checkout-todo.md — but already flows through the
  // session/summary math so the UI can be built and reviewed ahead of that.
  threadCashRedemption?: CheckoutThreadCashRedemption,
): Promise<CheckoutSession> {
  const items = isBuyNow && buyNowItems ? buyNowItems : cart.items;
  const groups = groupCartBySeller(items);

  const deliveryGroups: CheckoutDeliveryGroup[] = await Promise.all(groups.map(async group => {
    const rate = await fetchShippingRateDetails(group.sellerId, group.subtotalCents);
    const method: CheckoutShippingMethod = {
      id: rate.id,
      carrier: 'Seller shipping',
      service: rate.name,
      priceCents: rate.amountCents,
      estimatedDays: 0,
      estimatedDelivery: group.hasPreOrder ? 'Ships after production' : 'Rate set by seller',
      trackingIncluded: false,
      isRecommended: true,
      ...(group.hasPreOrder ? { isPreOrderEstimate: true } : {}),
    };
    return {
      sellerId: group.sellerId,
      sellerName: group.sellerName,
      items: group.items,
      selectedMethodId: method.id,
      availableMethods: [method],
      hasPreOrder: group.hasPreOrder,
    };
  }));

  const shippingTotalCents = deliveryGroups.reduce((total, group) => {
    const selected = group.availableMethods.find(method => method.id === group.selectedMethodId);
    return total + (selected?.priceCents ?? 0);
  }, 0);
  const rewardsDiscountCents = Math.min(
    (loyaltyRedemption?.discountCents ?? 0) + (threadCashRedemption?.discountCents ?? 0),
    items.reduce((total, item) => total + item.priceCents * item.quantity, 0) + shippingTotalCents,
  );
  const summary = calculateCartSummary(items, rewardsDiscountCents, shippingTotalCents);

  const acks: CheckoutAcknowledgment[] = [];
  const hasPreOrder = items.some(i => i.isPreOrder);
  if (hasPreOrder) {
    acks.push({
      key: 'preorder_policy',
      label: 'I understand this is a pre-order. Production and ship dates are estimates and may change.',
      required: true,
      acknowledged: false,
    });
    acks.push({
      key: 'preorder_cancellation',
      label: 'I understand that once production begins, cancellations may not be possible.',
      required: true,
      acknowledged: false,
    });
  }
  acks.push({
    key: 'terms',
    label: 'I agree to the Brandthread Terms of Service and Refund Policy.',
    required: true,
    acknowledged: false,
  });

  const session: CheckoutSession = {
    id: uid(),
    cartId: cart.id,
    step: 'information',
    savedAddresses: [],
    deliveryGroups,
    discounts: [],
    loyaltyRedemption,
    threadCashRedemption,
    summary,
    acknowledgments: acks,
    isBuyNow,
    buyNowCartItems: isBuyNow ? buyNowItems : undefined,
    idempotencyKey: uid(),
    createdAt: now(),
    updatedAt: now(),
  };

  const k = keys();
  // Preserve any existing saved addresses from prior session
  const existing = await loadCheckout(k);
  if (existing) {
    session.savedAddresses = existing.savedAddresses ?? [];
    if (existing.contact) session.contact = existing.contact;
    if (existing.shippingAddress) session.shippingAddress = existing.shippingAddress;
  }

  await saveCheckout(session, k);
  return session;
}

export async function getCheckoutSession(): Promise<CheckoutSession | null> {
  return loadCheckout(keys());
}

export async function saveCheckoutProgress(session: CheckoutSession): Promise<CheckoutSession> {
  const k = keys();
  await saveCheckout(session, k);
  return session;
}

export async function clearCheckoutSession(): Promise<void> {
  await AsyncStorage.removeItem(keys().checkout);
}

// ─── Discounts ────────────────────────────────────────────────────────────────

export async function applyDiscount(
  code: string,
  subtotalCents: number,
  existingDiscounts: CheckoutDiscount[],
): Promise<CheckoutDiscount> {
  const trimmedCode = code.trim().toUpperCase();
  if (!trimmedCode) {
    return { code: '', type: 'percentage' as any, value: 0, description: '', isValid: false, appliedAmountCents: 0, errorMessage: 'Please enter a code.' };
  }
  // Get current checkout session to find the seller and line items (for
  // product-scoped codes — an entire_store code ignores these anyway).
  const sess = await getCheckoutSession();
  const group = (sess as any)?.deliveryGroups?.[0];
  const sellerId = group?.sellerId ?? '';
  if (!sellerId) {
    // No seller context to validate a code against — fail closed rather than
    // accepting an unvalidated code.
    return { code: trimmedCode, type: 'percentage' as any, value: 0, appliedAmountCents: 0, description: '', isValid: false, errorMessage: 'Add items to your cart before applying a discount code.' };
  }
  const items = Array.isArray(group?.items)
    ? group.items.map((item: CartItem) => ({ productId: item.productId, priceCents: item.priceCents, quantity: item.quantity }))
    : undefined;
  try {
    const { api } = await import('@/lib/api');
    const result = await api.discountCodes.validate(trimmedCode, sellerId, subtotalCents, items);
    return {
      code: result.code,
      type: result.type,
      value: result.value,
      description: result.description ?? `${result.type === 'percentage' ? result.value + '% off' : formatCents(result.value) + ' off'}`,
      isValid: true,
      appliedAmountCents: result.appliedAmountCents,
      errorMessage: undefined,
    } as CheckoutDiscount;
  } catch (err: any) {
    // Parse error code from API response body
    let errCode = 'UNKNOWN';
    try {
      const body = err?.message ?? '';
      const match = body.match(/\{.*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        errCode = parsed?.error ?? errCode;
      }
    } catch {}
    const msg = errCode === 'EXPIRED' ? 'This code has expired.' :
                errCode === 'NOT_STARTED' ? "This code isn't active yet." :
                errCode === 'MAX_USES_REACHED' ? 'This code has reached its usage limit.' :
                errCode === 'ALREADY_USED_BY_CUSTOMER' ? "You've already used this code." :
                errCode === 'MIN_ORDER_NOT_MET' ? 'Minimum order not met for this code.' :
                errCode === 'NO_ELIGIBLE_ITEMS' ? 'No items in your cart qualify for this code.' :
                errCode === 'INACTIVE' ? 'This code is paused.' :
                'Invalid or expired discount code.';
    return { code: trimmedCode, type: 'percentage' as any, value: 0, description: '', isValid: false, appliedAmountCents: 0, errorMessage: msg };
  }
}

export async function removeDiscount(code: string, discounts: CheckoutDiscount[]): Promise<CheckoutDiscount[]> {
  return discounts.filter(d => d.code !== code);
}

// ─── Tax estimation ───────────────────────────────────────────────────────────

// ─── Buy Now ──────────────────────────────────────────────────────────────────

export async function createBuyNowSession(
  product: BuyerProduct,
  variant: BuyerProductVariant,
  quantity: number,
  currentCart: Cart,
): Promise<CheckoutSession> {
  const buyNowItem: CartItem = {
    id: uid(),
    productId: product.id,
    variantId: variant.id,
    productName: product.name,
    variantTitle: variant.title,
    imageUri: product.imageUris[0],
    sellerId: product.sellerId,
    sellerName: product.sellerName,
    sellerHandle: product.sellerHandle,
    priceCents: variant.priceCents,
    compareAtPriceCents: variant.compareAtPriceCents,
    quantity,
    maxQuantity: variant.inventoryQuantity || 99,
    isPreOrder: product.isPreOrder,
    preOrderEstShipDate: product.preOrderEstShipDate,
    inventoryPolicy: 'deny',
    isAvailable: true,
    addedAt: now(),
  };
  // Create session with buy-now items, NOT touching the existing cart
  return createCheckoutSession(currentCart, true, [buyNowItem]);
}

// ─── Buy Again ────────────────────────────────────────────────────────────────

export async function validateBuyAgain(
  productId: string,
  variantId: string,
): Promise<{ canAdd: boolean; message?: string; product?: BuyerProduct; variant?: BuyerProductVariant }> {
  const product = await getBuyerProduct(productId);
  if (!product) return { canAdd: false, message: 'Product is no longer available.' };
  if (!product.isActive) return { canAdd: false, message: 'This product is no longer active.' };

  const variant = product.variants.find(v => v.id === variantId);
  if (!variant) return { canAdd: false, message: 'This variant is no longer available.' };
  if (!variant.isAvailable) return { canAdd: false, message: 'This variant is currently out of stock.' };

  return { canAdd: true, product, variant };
}

// ─── Returns ──────────────────────────────────────────────────────────────────

export async function createReturnRequest(params: {
  orderId: string;
  orderNumber: string;
  sellerName: string;
  items: BuyerReturnRequest['items'];
  reason: BuyerReturnReason;
  description: string;
  imageUris: string[];
  preferredResolution: BuyerReturnResolution;
}): Promise<BuyerReturnRequest> {
  const { api } = await import('@/lib/api');
  const result = await api.returns.create({
    orderId: params.orderId,
    reason: params.reason,
    notes: params.description,
    resolutionRequested: params.preferredResolution,
    evidenceUrls: params.imageUris,
    requestedItems: params.items,
  });
  return {
    id: result.id,
    orderId: result.orderId,
    orderNumber: params.orderNumber,
    sellerName: params.sellerName,
    items: result.requestedItems ?? params.items,
    reason: result.reason,
    description: result.notes ?? '',
    imageUris: result.evidenceUrls ?? [],
    preferredResolution: result.resolutionRequested,
    status: result.status,
    refundEstimateCents: params.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0),
    returnDeadline: daysFromNow(30),
    returnPolicy: 'Return approval and refund amount are determined by the seller.',
    submittedAt: result.createdAt,
    updatedAt: result.updatedAt,
    sellerResponse: result.sellerResponse ?? undefined,
    refundAmountCents: result.refundAmountCents ?? undefined,
  };
}

async function loadReturns(k: CartKeys = keys()): Promise<BuyerReturnRequest[]> {
  try {
    const raw = await AsyncStorage.getItem(k.returns);
    if (raw) return JSON.parse(raw) as BuyerReturnRequest[];
  } catch {}
  return [];
}

export async function getBuyerReturns(): Promise<BuyerReturnRequest[]> {
  const { api } = await import('@/lib/api');
  const rows = await api.returns.listBuyer();
  return rows.map((row: any) => ({
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    sellerName: row.sellerName ?? 'Seller',
    items: row.requestedItems ?? [],
    reason: row.reason,
    description: row.notes ?? '',
    imageUris: row.evidenceUrls ?? [],
    preferredResolution: row.resolutionRequested,
    status: row.status,
    refundEstimateCents: row.refundAmountCents ?? row.totalCents ?? 0,
    returnDeadline: daysFromNow(30),
    returnPolicy: 'Return approval and refund amount are determined by the seller.',
    submittedAt: row.createdAt,
    updatedAt: row.updatedAt,
    sellerResponse: row.sellerResponse ?? undefined,
    refundAmountCents: row.refundAmountCents ?? undefined,
  }));
}

// ─── Refunds ──────────────────────────────────────────────────────────────────

export async function createRefundRequest(params: {
  orderId: string;
  orderNumber: string;
  sellerName: string;
  reason: string;
  description: string;
  evidenceUris: string[];
  maxRefundAmount: number;
}): Promise<BuyerRefundRequest> {
  const { api } = await import('@/lib/api');
  const result = await api.returns.create({
    orderId: params.orderId,
    reason: params.reason,
    notes: params.description,
    resolutionRequested: 'refund',
    evidenceUrls: params.evidenceUris,
  });
  const req: BuyerRefundRequest = {
    id: result.id,
    ...params,
    status: result.status,
    submittedAt: result.createdAt,
    sellerResponse: result.sellerResponse ?? undefined,
    refundAmountCents: result.refundAmountCents ?? undefined,
  };
  return req;
}

async function loadRefunds(k: CartKeys = keys()): Promise<BuyerRefundRequest[]> {
  try {
    const raw = await AsyncStorage.getItem(k.refunds);
    if (raw) return JSON.parse(raw) as BuyerRefundRequest[];
  } catch {}
  return [];
}

// ─── Problem reports ──────────────────────────────────────────────────────────

export async function createProblemReport(params: {
  orderId?: string;
  orderNumber?: string;
  type: BuyerProblemType;
  description: string;
  evidenceUris: string[];
  contactedSeller: boolean;
}): Promise<BuyerProblemReport> {
  const k = keys();
  const problems = await loadProblems(k);
  const report: BuyerProblemReport = {
    id: uid(),
    ...params,
    escalatedToSupport: false,
    status: 'open',
    submittedAt: now(),
  };
  problems.push(report);
  await AsyncStorage.setItem(k.problems, JSON.stringify(problems));
  return report;
}

async function loadProblems(k: CartKeys = keys()): Promise<BuyerProblemReport[]> {
  try {
    const raw = await AsyncStorage.getItem(k.problems);
    if (raw) return JSON.parse(raw) as BuyerProblemReport[];
  } catch {}
  return [];
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

/**
 * Clear all cart/checkout AsyncStorage keys for the given user (defaults to current).
 * Pass an explicit userId when calling during sign-out to avoid a race between
 * this function and initCartService(null) resetting _cartUserId to 'anon'.
 */
export async function clearCartCache(userId?: string): Promise<void> {
  const u = userId ?? _cartUserId;
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const toRemove = (allKeys as string[]).filter(k =>
      k.startsWith(`bt:cart:${u}:`) ||
      k.startsWith(`bt:checkout:${u}:`) ||
      k.startsWith(`bt:buyer:${u}:`)
    );
    if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
  } catch {}
}

// ─── Cancellation ─────────────────────────────────────────────────────────────

export function isCancellationEligible(orderStatus: string): { eligible: boolean; reason?: string } {
  switch (orderStatus) {
    case 'new':        return { eligible: true };
    case 'processing': return { eligible: true, reason: 'Cancellation may be limited — contact seller.' };
    default:           return { eligible: false, reason: 'Order is past the cancellation window.' };
  }
}
