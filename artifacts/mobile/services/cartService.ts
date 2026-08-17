/**
 * Brandthread Cart & Checkout Service
 * AsyncStorage-backed demo layer. All payment flows are demo-mode.
 * Mock services are separated from UI — no fake success in screen code.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { serviceRequest } from '@/lib/serviceConfig';
import {
  Cart, CartItem, SavedCartItem, CartSellerGroup,
  CheckoutSession, CheckoutContact, CheckoutAddress,
  CheckoutDeliveryGroup, CheckoutShippingMethod, CheckoutDiscount,
  CheckoutTax, CheckoutPaymentMethod, CheckoutSummary,
  CheckoutAcknowledgment, CheckoutAttribution,
  PaymentAttempt, PaymentAttemptStatus, PaymentFailureCode,
  CartValidationResult, CartValidationIssue,
  BuyerProduct, BuyerProductOption, BuyerProductVariant,
  BuyerReturnRequest, BuyerReturnReason, BuyerReturnResolution,
  BuyerRefundRequest, BuyerProblemReport, BuyerProblemType,
} from './cartTypes';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const KEYS = {
  cart:           'bt:cart:v1',
  checkout:       'bt:checkout:v1',
  returns:        'bt:buyer:returns:v1',
  refunds:        'bt:buyer:refunds:v1',
  problems:       'bt:buyer:problems:v1',
  paymentAttempts:'bt:buyer:payment_attempts:v1',
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 11); }
function now(): string { return new Date().toISOString(); }
function daysFromNow(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString();
}

// ─── Demo Products ────────────────────────────────────────────────────────────
// Stable buyer-facing product catalogue used by buyer-product-detail

const DEMO_PRODUCTS: BuyerProduct[] = [
  {
    id: 'prod_canvas_cargo',
    sellerId: 'seller_001',
    sellerName: 'Arc Studio',
    sellerHandle: '@arcstudio',
    name: 'Canvas Cargo Jacket',
    description: 'Heavyweight 12oz canvas shell with adjustable drawcord waist and articulated elbows. Built for the city and beyond.',
    price: 189,
    compareAtPrice: undefined,
    imageUris: [],
    category: 'Jacket',
    isPreOrder: false,
    cancellationPolicy: 'Orders may be cancelled within 24 hours of placement.',
    refundPolicy: '30-day returns on unworn items in original packaging.',
    isActive: true,
    tags: ['jacket', 'cargo', 'canvas'],
    options: [
      {
        id: 'opt_size', name: 'Size',
        values: [
          { id: 'v_xs', label: 'XS' }, { id: 'v_s', label: 'S' },
          { id: 'v_m', label: 'M' }, { id: 'v_l', label: 'L' },
          { id: 'v_xl', label: 'XL' },
        ],
      },
      {
        id: 'opt_color', name: 'Color',
        values: [
          { id: 'c_black', label: 'Black', colorHex: '#1A1A1A' },
          { id: 'c_olive', label: 'Olive', colorHex: '#6B7C45' },
          { id: 'c_sand', label: 'Sand', colorHex: '#C4A882' },
        ],
      },
    ],
    variants: [
      { id: 'var_xs_black', title: 'XS / Black', optionValues: [{ optionId: 'opt_size', valueId: 'v_xs' }, { optionId: 'opt_color', valueId: 'c_black' }], price: 189, inventoryQuantity: 4, isAvailable: true },
      { id: 'var_s_black',  title: 'S / Black',  optionValues: [{ optionId: 'opt_size', valueId: 'v_s'  }, { optionId: 'opt_color', valueId: 'c_black' }], price: 189, inventoryQuantity: 8, isAvailable: true },
      { id: 'var_m_black',  title: 'M / Black',  optionValues: [{ optionId: 'opt_size', valueId: 'v_m'  }, { optionId: 'opt_color', valueId: 'c_black' }], price: 189, inventoryQuantity: 12, isAvailable: true },
      { id: 'var_l_black',  title: 'L / Black',  optionValues: [{ optionId: 'opt_size', valueId: 'v_l'  }, { optionId: 'opt_color', valueId: 'c_black' }], price: 189, inventoryQuantity: 7, isAvailable: true },
      { id: 'var_xl_black', title: 'XL / Black', optionValues: [{ optionId: 'opt_size', valueId: 'v_xl' }, { optionId: 'opt_color', valueId: 'c_black' }], price: 189, inventoryQuantity: 3, isAvailable: true },
      { id: 'var_xs_olive', title: 'XS / Olive', optionValues: [{ optionId: 'opt_size', valueId: 'v_xs' }, { optionId: 'opt_color', valueId: 'c_olive' }], price: 189, inventoryQuantity: 2, isAvailable: true },
      { id: 'var_s_olive',  title: 'S / Olive',  optionValues: [{ optionId: 'opt_size', valueId: 'v_s'  }, { optionId: 'opt_color', valueId: 'c_olive' }], price: 189, inventoryQuantity: 6, isAvailable: true },
      { id: 'var_m_olive',  title: 'M / Olive',  optionValues: [{ optionId: 'opt_size', valueId: 'v_m'  }, { optionId: 'opt_color', valueId: 'c_olive' }], price: 189, inventoryQuantity: 9, isAvailable: true },
      { id: 'var_l_olive',  title: 'L / Olive',  optionValues: [{ optionId: 'opt_size', valueId: 'v_l'  }, { optionId: 'opt_color', valueId: 'c_olive' }], price: 189, inventoryQuantity: 5, isAvailable: true },
      { id: 'var_xl_olive', title: 'XL / Olive', optionValues: [{ optionId: 'opt_size', valueId: 'v_xl' }, { optionId: 'opt_color', valueId: 'c_olive' }], price: 189, inventoryQuantity: 0, isAvailable: false },
      { id: 'var_m_sand',   title: 'M / Sand',   optionValues: [{ optionId: 'opt_size', valueId: 'v_m'  }, { optionId: 'opt_color', valueId: 'c_sand'  }], price: 189, inventoryQuantity: 4, isAvailable: true },
      { id: 'var_l_sand',   title: 'L / Sand',   optionValues: [{ optionId: 'opt_size', valueId: 'v_l'  }, { optionId: 'opt_color', valueId: 'c_sand'  }], price: 189, inventoryQuantity: 3, isAvailable: true },
    ],
  },
  {
    id: 'prod_essential_tee',
    sellerId: 'seller_002',
    sellerName: 'Void Supply Co.',
    sellerHandle: '@voidsupply',
    name: 'Essential Relaxed Tee',
    description: 'Brushed 220g heavyweight jersey with a boxy relaxed silhouette. Ringspun cotton. Pre-shrunk.',
    price: 48,
    compareAtPrice: undefined,
    imageUris: [],
    category: 'T-shirt',
    isPreOrder: false,
    cancellationPolicy: 'Orders may be cancelled within 12 hours.',
    refundPolicy: '14-day returns on unworn items.',
    isActive: true,
    tags: ['tee', 'essentials'],
    options: [
      {
        id: 'opt_size2', name: 'Size',
        values: [
          { id: 'v2_xs', label: 'XS' }, { id: 'v2_s', label: 'S' },
          { id: 'v2_m', label: 'M' }, { id: 'v2_l', label: 'L' },
          { id: 'v2_xl', label: 'XL' }, { id: 'v2_xxl', label: 'XXL' },
        ],
      },
      {
        id: 'opt_color2', name: 'Color',
        values: [
          { id: 'c2_black', label: 'Washed Black', colorHex: '#2D2D2D' },
          { id: 'c2_white', label: 'Off White',    colorHex: '#F0EDE8' },
          { id: 'c2_slate', label: 'Slate',        colorHex: '#6C7A89' },
        ],
      },
    ],
    variants: [
      { id: 'var2_s_black',  title: 'S / Washed Black',  optionValues: [{ optionId: 'opt_size2', valueId: 'v2_s'  }, { optionId: 'opt_color2', valueId: 'c2_black' }], price: 48, inventoryQuantity: 20, isAvailable: true },
      { id: 'var2_m_black',  title: 'M / Washed Black',  optionValues: [{ optionId: 'opt_size2', valueId: 'v2_m'  }, { optionId: 'opt_color2', valueId: 'c2_black' }], price: 48, inventoryQuantity: 25, isAvailable: true },
      { id: 'var2_l_black',  title: 'L / Washed Black',  optionValues: [{ optionId: 'opt_size2', valueId: 'v2_l'  }, { optionId: 'opt_color2', valueId: 'c2_black' }], price: 48, inventoryQuantity: 18, isAvailable: true },
      { id: 'var2_xl_black', title: 'XL / Washed Black', optionValues: [{ optionId: 'opt_size2', valueId: 'v2_xl' }, { optionId: 'opt_color2', valueId: 'c2_black' }], price: 48, inventoryQuantity: 10, isAvailable: true },
      { id: 'var2_s_white',  title: 'S / Off White',  optionValues: [{ optionId: 'opt_size2', valueId: 'v2_s'  }, { optionId: 'opt_color2', valueId: 'c2_white' }], price: 48, inventoryQuantity: 14, isAvailable: true },
      { id: 'var2_m_white',  title: 'M / Off White',  optionValues: [{ optionId: 'opt_size2', valueId: 'v2_m'  }, { optionId: 'opt_color2', valueId: 'c2_white' }], price: 48, inventoryQuantity: 16, isAvailable: true },
      { id: 'var2_l_white',  title: 'L / Off White',  optionValues: [{ optionId: 'opt_size2', valueId: 'v2_l'  }, { optionId: 'opt_color2', valueId: 'c2_white' }], price: 48, inventoryQuantity: 0,  isAvailable: false },
      { id: 'var2_m_slate',  title: 'M / Slate',  optionValues: [{ optionId: 'opt_size2', valueId: 'v2_m'  }, { optionId: 'opt_color2', valueId: 'c2_slate' }], price: 48, inventoryQuantity: 8, isAvailable: true },
      { id: 'var2_l_slate',  title: 'L / Slate',  optionValues: [{ optionId: 'opt_size2', valueId: 'v2_l'  }, { optionId: 'opt_color2', valueId: 'c2_slate' }], price: 48, inventoryQuantity: 6, isAvailable: true },
    ],
  },
  {
    id: 'prod_ripstop_cargo',
    sellerId: 'seller_001',
    sellerName: 'Arc Studio',
    sellerHandle: '@arcstudio',
    name: 'Ripstop Cargo Trousers',
    description: 'Technical 6-pocket ripstop cargo with articulated knees and zip-off legs. Made to move.',
    price: 134,
    compareAtPrice: 160,
    imageUris: [],
    category: 'Shorts',
    isPreOrder: false,
    cancellationPolicy: 'Orders may be cancelled within 24 hours of placement.',
    refundPolicy: '30-day returns on unworn items in original packaging.',
    isActive: true,
    tags: ['cargo', 'trousers', 'technical'],
    options: [
      {
        id: 'opt_size3', name: 'Size',
        values: [
          { id: 'v3_28', label: '28' }, { id: 'v3_30', label: '30' },
          { id: 'v3_32', label: '32' }, { id: 'v3_34', label: '34' },
          { id: 'v3_36', label: '36' },
        ],
      },
      {
        id: 'opt_color3', name: 'Color',
        values: [
          { id: 'c3_black', label: 'Black', colorHex: '#1A1A1A' },
          { id: 'c3_khaki', label: 'Khaki', colorHex: '#B5A642' },
        ],
      },
    ],
    variants: [
      { id: 'var3_28_black', title: '28 / Black', optionValues: [{ optionId: 'opt_size3', valueId: 'v3_28' }, { optionId: 'opt_color3', valueId: 'c3_black' }], price: 134, compareAtPrice: 160, inventoryQuantity: 3, isAvailable: true },
      { id: 'var3_30_black', title: '30 / Black', optionValues: [{ optionId: 'opt_size3', valueId: 'v3_30' }, { optionId: 'opt_color3', valueId: 'c3_black' }], price: 134, compareAtPrice: 160, inventoryQuantity: 7, isAvailable: true },
      { id: 'var3_32_black', title: '32 / Black', optionValues: [{ optionId: 'opt_size3', valueId: 'v3_32' }, { optionId: 'opt_color3', valueId: 'c3_black' }], price: 134, compareAtPrice: 160, inventoryQuantity: 9, isAvailable: true },
      { id: 'var3_34_black', title: '34 / Black', optionValues: [{ optionId: 'opt_size3', valueId: 'v3_34' }, { optionId: 'opt_color3', valueId: 'c3_black' }], price: 134, compareAtPrice: 160, inventoryQuantity: 4, isAvailable: true },
      { id: 'var3_30_khaki', title: '30 / Khaki', optionValues: [{ optionId: 'opt_size3', valueId: 'v3_30' }, { optionId: 'opt_color3', valueId: 'c3_khaki' }], price: 134, compareAtPrice: 160, inventoryQuantity: 5, isAvailable: true },
      { id: 'var3_32_khaki', title: '32 / Khaki', optionValues: [{ optionId: 'opt_size3', valueId: 'v3_32' }, { optionId: 'opt_color3', valueId: 'c3_khaki' }], price: 134, compareAtPrice: 160, inventoryQuantity: 0, isAvailable: false },
    ],
  },
  {
    id: 'prod_sunday_hoodie',
    sellerId: 'seller_003',
    sellerName: 'Muted Works',
    sellerHandle: '@mutedworks',
    name: 'Sunday Washed Hoodie',
    description: 'Garment-washed 420g fleece pullover hoodie. Relaxed fit with a dropped shoulder and kangaroo pocket.',
    price: 98,
    compareAtPrice: undefined,
    imageUris: [],
    category: 'Hoodie',
    isPreOrder: true,
    preOrderClosingDate: daysFromNow(14),
    preOrderEstShipDate: daysFromNow(60),
    cancellationPolicy: 'Pre-orders can be cancelled before production begins. Once production starts, cancellations are not accepted.',
    refundPolicy: 'Pre-orders are final once production begins. Contact us for exceptions.',
    isActive: true,
    tags: ['hoodie', 'fleece', 'washed', 'pre-order'],
    options: [
      {
        id: 'opt_size4', name: 'Size',
        values: [
          { id: 'v4_s', label: 'S' }, { id: 'v4_m', label: 'M' },
          { id: 'v4_l', label: 'L' }, { id: 'v4_xl', label: 'XL' },
        ],
      },
      {
        id: 'opt_color4', name: 'Color',
        values: [
          { id: 'c4_ash', label: 'Ash', colorHex: '#A8A8A8' },
          { id: 'c4_pine', label: 'Pine', colorHex: '#3A5F4A' },
        ],
      },
    ],
    variants: [
      { id: 'var4_s_ash',   title: 'S / Ash',  optionValues: [{ optionId: 'opt_size4', valueId: 'v4_s'  }, { optionId: 'opt_color4', valueId: 'c4_ash'  }], price: 98, inventoryQuantity: 50, isAvailable: true },
      { id: 'var4_m_ash',   title: 'M / Ash',  optionValues: [{ optionId: 'opt_size4', valueId: 'v4_m'  }, { optionId: 'opt_color4', valueId: 'c4_ash'  }], price: 98, inventoryQuantity: 50, isAvailable: true },
      { id: 'var4_l_ash',   title: 'L / Ash',  optionValues: [{ optionId: 'opt_size4', valueId: 'v4_l'  }, { optionId: 'opt_color4', valueId: 'c4_ash'  }], price: 98, inventoryQuantity: 50, isAvailable: true },
      { id: 'var4_m_pine',  title: 'M / Pine', optionValues: [{ optionId: 'opt_size4', valueId: 'v4_m'  }, { optionId: 'opt_color4', valueId: 'c4_pine' }], price: 98, inventoryQuantity: 50, isAvailable: true },
      { id: 'var4_l_pine',  title: 'L / Pine', optionValues: [{ optionId: 'opt_size4', valueId: 'v4_l'  }, { optionId: 'opt_color4', valueId: 'c4_pine' }], price: 98, inventoryQuantity: 50, isAvailable: true },
    ],
  },
];

// Map from feed product names to demo product IDs
const FEED_PRODUCT_MAP: Record<string, string> = {
  'Canvas Cargo Jacket':    'prod_canvas_cargo',
  'Essential Relaxed Tee':  'prod_essential_tee',
  'Ripstop Cargo Trousers': 'prod_ripstop_cargo',
  'Sunday Washed Hoodie':   'prod_sunday_hoodie',
  'City Chore Coat':        'prod_canvas_cargo', // fallback to canvas cargo
};

// ─── Product lookup ───────────────────────────────────────────────────────────

export async function getBuyerProduct(productId: string): Promise<BuyerProduct | null> {
  const found = DEMO_PRODUCTS.find(p => p.id === productId);
  if (found) return found;
  // Fallback: return first product (for demo purposes when linked from feed)
  return DEMO_PRODUCTS[0];
}

export async function getBuyerProductByName(name: string): Promise<BuyerProduct> {
  const id = FEED_PRODUCT_MAP[name];
  if (id) {
    const found = DEMO_PRODUCTS.find(p => p.id === id);
    if (found) return found;
  }
  return DEMO_PRODUCTS[0];
}

export function getAllDemoProducts(): BuyerProduct[] {
  return DEMO_PRODUCTS;
}

// ─── DB sync ──────────────────────────────────────────────────────────────────

async function syncToDb(items: any[], savedItems: any[]): Promise<void> {
  try {
    await serviceRequest('/api/buyer/cart/sync', {
      method: 'POST',
      body: JSON.stringify({ items, savedItems }),
    });
  } catch { /* ignore — local is source of truth */ }
}

// ─── Cart storage ─────────────────────────────────────────────────────────────

async function loadCart(): Promise<Cart> {
  let cart: Cart;
  try {
    const raw = await AsyncStorage.getItem(KEYS.cart);
    if (raw) {
      cart = JSON.parse(raw) as Cart;
    } else {
      cart = { id: uid(), items: [], savedItems: [], updatedAt: now() };
    }
  } catch {
    cart = { id: uid(), items: [], savedItems: [], updatedAt: now() };
  }

  // Background: attempt to load from DB and merge if DB has data
  try {
    const { items, savedItems } = await serviceRequest<{ items: any[]; savedItems: any[] }>('/api/buyer/cart', {});
    if (items.length > 0 || savedItems.length > 0) {
      // DB has data — use it and update local cache
      cart.items = items;
      cart.savedItems = savedItems;
      await AsyncStorage.setItem(KEYS.cart, JSON.stringify(cart));
    }
  } catch { /* ignore */ }

  return cart;
}

async function saveCart(cart: Cart): Promise<void> {
  cart.updatedAt = now();
  await AsyncStorage.setItem(KEYS.cart, JSON.stringify(cart));
  void syncToDb(cart.items, cart.savedItems);
}

// ─── Cart operations ──────────────────────────────────────────────────────────

export async function getCart(): Promise<Cart> {
  return loadCart();
}

export interface AddToCartParams {
  product: BuyerProduct;
  variant: BuyerProductVariant;
  quantity: number;
  attribution?: CheckoutAttribution;
}

export async function addToCart(params: AddToCartParams): Promise<{ success: boolean; message?: string; cart: Cart }> {
  const { product, variant, quantity, attribution } = params;
  const cart = await loadCart();

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
      price: variant.price ?? product.price,
      compareAtPrice: variant.compareAtPrice ?? product.compareAtPrice,
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

  await saveCart(cart);
  return { success: true, cart };
}

export async function updateCartItemQuantity(itemId: string, quantity: number): Promise<Cart> {
  const cart = await loadCart();
  const idx = cart.items.findIndex(i => i.id === itemId);
  if (idx >= 0) {
    if (quantity <= 0) {
      cart.items.splice(idx, 1);
    } else {
      const item = cart.items[idx];
      const capped = Math.min(quantity, item.maxQuantity || 99);
      cart.items[idx] = { ...item, quantity: capped };
    }
    await saveCart(cart);
  }
  return cart;
}

export async function removeCartItem(itemId: string): Promise<Cart> {
  const cart = await loadCart();
  cart.items = cart.items.filter(i => i.id !== itemId);
  await saveCart(cart);
  return cart;
}

export async function saveForLater(itemId: string): Promise<Cart> {
  const cart = await loadCart();
  const idx = cart.items.findIndex(i => i.id === itemId);
  if (idx >= 0) {
    const item = cart.items[idx];
    const saved: SavedCartItem = { ...item, savedAt: now() };
    cart.savedItems.push(saved);
    cart.items.splice(idx, 1);
    await saveCart(cart);
  }
  return cart;
}

export async function moveToCart(savedItemId: string): Promise<Cart> {
  const cart = await loadCart();
  const idx = cart.savedItems.findIndex(i => i.id === savedItemId);
  if (idx >= 0) {
    const saved = cart.savedItems[idx];
    const existing = cart.items.findIndex(i => i.variantId === saved.variantId);
    if (existing >= 0) {
      cart.items[existing].quantity += saved.quantity;
    } else {
      cart.items.push({ ...saved, addedAt: now() });
    }
    cart.savedItems.splice(idx, 1);
    await saveCart(cart);
  }
  return cart;
}

export async function removeSavedItem(savedItemId: string): Promise<Cart> {
  const cart = await loadCart();
  cart.savedItems = cart.savedItems.filter(i => i.id !== savedItemId);
  await saveCart(cart);
  return cart;
}

export async function clearCart(): Promise<void> {
  const empty: Cart = { id: uid(), items: [], savedItems: [], updatedAt: now() };
  await saveCart(empty);
}

// Merge guest cart into authenticated cart (no duplicates)
export async function mergeGuestCart(guestCart: Cart): Promise<Cart> {
  const cart = await loadCart();
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
  await saveCart(cart);
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
        subtotal: 0,
        hasPreOrder: false,
        estimatedShipping: 0,
        fulfillmentEstimate: '3–5 business days',
      });
    }
    const group = map.get(item.sellerId)!;
    group.items.push(item);
    group.subtotal += item.price * item.quantity;
    if (item.isPreOrder) group.hasPreOrder = true;
  }
  return Array.from(map.values());
}

// ─── Cart summary ─────────────────────────────────────────────────────────────

export function calculateCartSummary(items: CartItem[], discountTotal = 0, shippingTotal = 0): CheckoutSummary {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const taxTotal = 0; // Calculated accurately by Stripe at checkout; not estimated here
  const total = +(subtotal - discountTotal + shippingTotal + taxTotal).toFixed(2);
  return {
    subtotal: +subtotal.toFixed(2),
    discountTotal: +discountTotal.toFixed(2),
    shippingTotal: +shippingTotal.toFixed(2),
    taxTotal,
    total: Math.max(total, 0),
    currency: 'USD',
  };
}

// ─── Real shipping rate fetch ─────────────────────────────────────────────────

/**
 * Fetch the real shipping rate from the seller's configured rates.
 * Returns rate in dollars (not cents). Falls back to 0 (free) on error.
 */
export async function fetchShippingRate(sellerId: string, subtotalCents: number): Promise<number> {
  try {
    const resp = await serviceRequest(
      `/api/shipping-rates/calculate?sellerId=${encodeURIComponent(sellerId)}&subtotalCents=${subtotalCents}`,
    ) as any;
    if (typeof resp?.shippingCents === 'number') return resp.shippingCents / 100;
  } catch {}
  return 0;
}

// ─── Cart validation ──────────────────────────────────────────────────────────

export async function validateCart(items: CartItem[]): Promise<CartValidationResult> {
  // Demo validation: all items are valid (real implementation would hit backend)
  const issues: CartValidationIssue[] = [];
  for (const item of items) {
    if (!item.isAvailable) {
      issues.push({
        itemId: item.id,
        productName: item.productName,
        type: 'unavailable',
        message: `${item.productName} is no longer available.`,
        canContinue: false,
      });
    }
  }
  return { isValid: issues.length === 0, issues };
}

// ─── Checkout session ─────────────────────────────────────────────────────────

async function loadCheckout(): Promise<CheckoutSession | null> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.checkout);
    if (raw) return JSON.parse(raw) as CheckoutSession;
  } catch {}
  return null;
}

async function saveCheckout(session: CheckoutSession): Promise<void> {
  session.updatedAt = now();
  await AsyncStorage.setItem(KEYS.checkout, JSON.stringify(session));
}

export async function createCheckoutSession(cart: Cart, isBuyNow = false, buyNowItems?: CartItem[]): Promise<CheckoutSession> {
  const items = isBuyNow && buyNowItems ? buyNowItems : cart.items;
  const groups = groupCartBySeller(items);

  const deliveryGroups: CheckoutDeliveryGroup[] = groups.map(g => ({
    sellerId: g.sellerId,
    sellerName: g.sellerName,
    items: g.items,
    selectedMethodId: 'rate_usps_priority',
    availableMethods: getDemoShippingMethods(g.hasPreOrder),
    hasPreOrder: g.hasPreOrder,
  }));

  const summary = calculateCartSummary(items);

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
    step: 'contact',
    savedAddresses: [],
    deliveryGroups,
    discounts: [],
    summary,
    acknowledgments: acks,
    isBuyNow,
    buyNowCartItems: isBuyNow ? buyNowItems : undefined,
    idempotencyKey: uid(),
    createdAt: now(),
    updatedAt: now(),
  };

  // Preserve any existing saved addresses from prior session
  const existing = await loadCheckout();
  if (existing) {
    session.savedAddresses = existing.savedAddresses ?? [];
    if (existing.contact) session.contact = existing.contact;
    if (existing.shippingAddress) session.shippingAddress = existing.shippingAddress;
  }

  await saveCheckout(session);
  return session;
}

export async function getCheckoutSession(): Promise<CheckoutSession | null> {
  return loadCheckout();
}

export async function saveCheckoutProgress(session: CheckoutSession): Promise<CheckoutSession> {
  await saveCheckout(session);
  return session;
}

export async function clearCheckoutSession(): Promise<void> {
  await AsyncStorage.removeItem(KEYS.checkout);
}

// ─── Shipping rates ───────────────────────────────────────────────────────────

export function getDemoShippingMethods(isPreOrder = false): CheckoutShippingMethod[] {
  if (isPreOrder) {
    return [
      {
        id: 'rate_preorder_standard',
        carrier: 'USPS',
        service: 'Priority Mail (est. after production)',
        price: 12.40,
        estimatedDays: 3,
        estimatedDelivery: 'After production',
        trackingIncluded: true,
        isRecommended: true,
        isPreOrderEstimate: true,
      },
      {
        id: 'rate_preorder_express',
        carrier: 'FedEx',
        service: 'Express (est. after production)',
        price: 19.85,
        estimatedDays: 2,
        estimatedDelivery: 'After production',
        trackingIncluded: true,
        isRecommended: false,
        isPreOrderEstimate: true,
      },
    ];
  }
  return [
    {
      id: 'rate_ups_ground',
      carrier: 'UPS',
      service: 'Ground',
      price: 8.99,
      estimatedDays: 5,
      estimatedDelivery: '5–7 business days',
      trackingIncluded: true,
      isRecommended: false,
    },
    {
      id: 'rate_usps_priority',
      carrier: 'USPS',
      service: 'Priority Mail',
      price: 12.40,
      estimatedDays: 3,
      estimatedDelivery: '2–3 business days',
      trackingIncluded: true,
      isRecommended: true,
    },
    {
      id: 'rate_fedex_2day',
      carrier: 'FedEx',
      service: '2Day',
      price: 19.85,
      estimatedDays: 2,
      estimatedDelivery: '2 business days',
      trackingIncluded: true,
      isRecommended: false,
    },
    {
      id: 'rate_ups_next',
      carrier: 'UPS',
      service: 'Next Day Air',
      price: 38.50,
      estimatedDays: 1,
      estimatedDelivery: 'Next business day',
      trackingIncluded: true,
      isRecommended: false,
    },
  ];
}

// ─── Discounts ────────────────────────────────────────────────────────────────

const DEMO_DISCOUNT_CODES: Record<string, CheckoutDiscount> = {
  'THREAD10': {
    code: 'THREAD10',
    type: 'percentage',
    value: 10,
    appliedAmount: 0,
    description: '10% off your order',
    isValid: true,
  },
  'FREESHIP': {
    code: 'FREESHIP',
    type: 'free_shipping',
    value: 0,
    appliedAmount: 0,
    description: 'Free standard shipping',
    isValid: true,
  },
  'FIRST20': {
    code: 'FIRST20',
    type: 'fixed',
    value: 20,
    appliedAmount: 20,
    description: '$20 off your first order',
    isValid: true,
  },
};

export async function applyDiscount(
  code: string,
  subtotalDollars: number,
  existingDiscounts: CheckoutDiscount[],
): Promise<CheckoutDiscount> {
  const trimmedCode = code.trim().toUpperCase();
  if (!trimmedCode) {
    return { code: '', type: 'percentage' as any, value: 0, description: '', isValid: false, appliedAmount: 0, errorMessage: 'Please enter a code.' };
  }
  // Get current checkout session to find the seller
  const sess = await getCheckoutSession();
  const sellerId = (sess as any)?.items?.[0]?.sellerId ?? (sess as any)?.deliveryGroups?.[0]?.sellerId ?? '';
  if (!sellerId) {
    // Fall back to demo codes if no seller context
    const upper = trimmedCode;
    if (existingDiscounts.some(d => d.code === upper)) {
      return { code: upper, type: 'percentage' as any, value: 0, appliedAmount: 0, description: '', isValid: false, errorMessage: 'This code has already been applied.' };
    }
    const found = DEMO_DISCOUNT_CODES[upper];
    if (!found) {
      return { code: upper, type: 'percentage' as any, value: 0, appliedAmount: 0, description: '', isValid: false, errorMessage: 'Invalid discount code.' };
    }
    let appliedAmount = 0;
    if (found.type === 'percentage') appliedAmount = +(subtotalDollars * found.value / 100).toFixed(2) as unknown as number;
    else if (found.type === 'fixed') appliedAmount = Math.min(found.value, subtotalDollars);
    else if (found.type === 'free_shipping') appliedAmount = 12.40;
    return { ...found, appliedAmount };
  }
  const subtotalCents = Math.round(subtotalDollars * 100);
  try {
    const { api } = await import('@/lib/api');
    const result = await api.discountCodes.validate(trimmedCode, sellerId, subtotalCents);
    return {
      code: result.code,
      type: result.type,
      value: result.value,
      description: result.description ?? `${result.type === 'percentage' ? result.value + '% off' : '$' + (result.value / 100).toFixed(2) + ' off'}`,
      isValid: true,
      appliedAmount: result.appliedAmountCents / 100,
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
                errCode === 'MAX_USES_REACHED' ? 'This code has reached its usage limit.' :
                errCode === 'MIN_ORDER_NOT_MET' ? 'Minimum order not met for this code.' :
                'Invalid or expired discount code.';
    return { code: trimmedCode, type: 'percentage' as any, value: 0, description: '', isValid: false, appliedAmount: 0, errorMessage: msg };
  }
}

export async function removeDiscount(code: string, discounts: CheckoutDiscount[]): Promise<CheckoutDiscount[]> {
  return discounts.filter(d => d.code !== code);
}

// ─── Tax estimation ───────────────────────────────────────────────────────────

export function calculateDemoTax(subtotal: number, state: string): CheckoutTax {
  // Demo tax rates by state — NOT real tax calculation
  const rates: Record<string, number> = {
    CA: 0.0725, NY: 0.0800, TX: 0.0825, FL: 0.0600, WA: 0.0650,
    IL: 0.1025, PA: 0.0600, OH: 0.0575, GA: 0.0400,
  };
  const rate = rates[state.toUpperCase()] ?? 0.0875;
  return {
    jurisdiction: state.toUpperCase() || 'Unknown',
    rate,
    amount: +(subtotal * rate).toFixed(2),
    isEstimate: true,
    note: 'Tax is estimated. Final amount calculated at order completion. Demo rates — not verified.',
  };
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export function getDemoPaymentMethods(): CheckoutPaymentMethod[] {
  return [
    {
      type: 'card',
      label: 'Credit / Debit Card',
      saveForFuture: false,
      isAvailable: true,
    },
    {
      type: 'apple_pay',
      label: 'Apple Pay',
      saveForFuture: false,
      isAvailable: false, // requires real payment provider + device support
    },
    {
      type: 'google_pay',
      label: 'Google Pay',
      saveForFuture: false,
      isAvailable: false, // requires real payment provider + device support
    },
  ];
}

export interface PlaceOrderParams {
  session: CheckoutSession;
  cardNumber?: string; // last 4 only, never full card
  idempotencyKey: string;
}

export interface PlaceOrderResult {
  success: boolean;
  orderIds: string[];
  orderNumbers: string[];
  paymentAttemptId: string;
  failureCode?: PaymentFailureCode;
  failureMessage?: string;
  totalCharged: number;
}

// Simulate order placement — no real payment processing
export async function placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
  const { session } = params;

  // Check idempotency — prevent duplicate submissions
  const attempts = await loadPaymentAttempts();
  const duplicate = attempts.find(a => a.checkoutId === session.id && a.status === 'succeeded');
  if (duplicate) {
    return {
      success: true,
      orderIds: ['dup_prevented'],
      orderNumbers: ['Duplicate prevented'],
      paymentAttemptId: duplicate.id,
      totalCharged: session.summary.total,
    };
  }

  // Record attempt
  const attempt: PaymentAttempt = {
    id: uid(),
    checkoutId: session.id,
    status: 'processing',
    method: session.paymentMethod?.type ?? 'card',
    amount: session.summary.total,
    currency: 'USD',
    isDemo: true,
    createdAt: now(),
  };
  attempts.push(attempt);
  await savePaymentAttempts(attempts);

  // Demo: succeed if contact + address exist; fail on specific test conditions
  const cardLast4 = params.cardNumber ?? '';
  if (cardLast4 === '0002') {
    attempt.status = 'failed';
    attempt.failureCode = 'card_declined';
    attempt.failureMessage = 'Your card was declined. Please check your card details and try again.';
    await savePaymentAttempts(attempts.map(a => a.id === attempt.id ? attempt : a));
    return {
      success: false,
      orderIds: [],
      orderNumbers: [],
      paymentAttemptId: attempt.id,
      failureCode: 'card_declined',
      failureMessage: attempt.failureMessage,
      totalCharged: 0,
    };
  }

  if (cardLast4 === '0003') {
    attempt.status = 'failed';
    attempt.failureCode = 'insufficient_funds';
    attempt.failureMessage = 'Insufficient funds. Please use a different payment method.';
    await savePaymentAttempts(attempts.map(a => a.id === attempt.id ? attempt : a));
    return {
      success: false,
      orderIds: [],
      orderNumbers: [],
      paymentAttemptId: attempt.id,
      failureCode: 'insufficient_funds',
      failureMessage: attempt.failureMessage,
      totalCharged: 0,
    };
  }

  // Success path
  const orderIds = session.deliveryGroups.map(() => uid());
  const orderNumbers = orderIds.map((_, i) => `BT-${Date.now().toString().slice(-6)}-${i + 1}`);

  attempt.status = 'succeeded';
  await savePaymentAttempts(attempts.map(a => a.id === attempt.id ? attempt : a));

  // Track attribution
  if (session.attribution) {
    await trackCheckoutAttribution(session.attribution, session.summary.total);
  }

  return {
    success: true,
    orderIds,
    orderNumbers,
    paymentAttemptId: attempt.id,
    totalCharged: session.summary.total,
  };
}

async function loadPaymentAttempts(): Promise<PaymentAttempt[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.paymentAttempts);
    if (raw) return JSON.parse(raw) as PaymentAttempt[];
  } catch {}
  return [];
}

async function savePaymentAttempts(attempts: PaymentAttempt[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.paymentAttempts, JSON.stringify(attempts));
}

// ─── Attribution ──────────────────────────────────────────────────────────────

async function trackCheckoutAttribution(attr: CheckoutAttribution, revenue: number): Promise<void> {
  // Demo: log to analytics service if available; no real tracking in demo
  // In production this would hit the analytics endpoint
  console.info('[Brandthread] Checkout attribution tracked:', { ...attr, revenue });
}

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
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
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
  // Try real API first
  try {
    const { api } = await import('@/lib/api');
    const result = await api.returns.create({
      orderId: params.orderId,
      reason: params.reason,
      notes: params.description,
      resolutionRequested: params.preferredResolution,
    });
    // Map API response back to local BuyerReturnRequest shape
    const req: BuyerReturnRequest = {
      id: result.id ?? uid(),
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      sellerName: params.sellerName,
      items: params.items,
      reason: params.reason,
      description: params.description,
      imageUris: params.imageUris,
      preferredResolution: params.preferredResolution,
      status: result.status ?? 'requested',
      refundEstimate: params.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
      returnDeadline: daysFromNow(30),
      returnPolicy: '30-day returns on unworn items. Return shipping may be covered by the seller.',
      submittedAt: result.createdAt ?? now(),
      updatedAt: result.updatedAt ?? now(),
    };
    // Cache locally for offline viewing
    const returns = await loadReturns();
    returns.push(req);
    await AsyncStorage.setItem(KEYS.returns, JSON.stringify(returns));
    return req;
  } catch {
    // AsyncStorage fallback for demo/offline
    const returns = await loadReturns();
    const req: BuyerReturnRequest = {
      id: uid(),
      ...params,
      status: 'requested',
      refundEstimate: params.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0),
      returnDeadline: daysFromNow(30),
      returnPolicy: '30-day returns on unworn items. Return shipping may be covered by the seller.',
      submittedAt: now(),
      updatedAt: now(),
    };
    returns.push(req);
    await AsyncStorage.setItem(KEYS.returns, JSON.stringify(returns));
    return req;
  }
}

async function loadReturns(): Promise<BuyerReturnRequest[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.returns);
    if (raw) return JSON.parse(raw) as BuyerReturnRequest[];
  } catch {}
  return [];
}

export async function getBuyerReturns(): Promise<BuyerReturnRequest[]> {
  return loadReturns();
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
  const refunds = await loadRefunds();
  const req: BuyerRefundRequest = {
    id: uid(),
    ...params,
    status: 'pending',
    submittedAt: now(),
  };
  refunds.push(req);
  await AsyncStorage.setItem(KEYS.refunds, JSON.stringify(refunds));
  return req;
}

async function loadRefunds(): Promise<BuyerRefundRequest[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.refunds);
    if (raw) return JSON.parse(raw) as BuyerRefundRequest[];
  } catch {}
  return [];
}

// ─── Problem reports ──────────────────────────────────────────────────────────

export async function createProblemReport(params: {
  orderId: string;
  orderNumber: string;
  type: BuyerProblemType;
  description: string;
  evidenceUris: string[];
  contactedSeller: boolean;
}): Promise<BuyerProblemReport> {
  const problems = await loadProblems();
  const report: BuyerProblemReport = {
    id: uid(),
    ...params,
    escalatedToSupport: false,
    status: 'open',
    submittedAt: now(),
  };
  problems.push(report);
  await AsyncStorage.setItem(KEYS.problems, JSON.stringify(problems));
  return report;
}

async function loadProblems(): Promise<BuyerProblemReport[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.problems);
    if (raw) return JSON.parse(raw) as BuyerProblemReport[];
  } catch {}
  return [];
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

/**
 * Clear all cart/checkout AsyncStorage keys for the current device.
 * Call this on sign-out so the next account starts with an empty cart.
 */
export async function clearCartCache(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(Object.values(KEYS));
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
