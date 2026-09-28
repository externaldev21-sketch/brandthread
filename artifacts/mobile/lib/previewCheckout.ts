/**
 * Preview checkout: the one step of the buy flow that can't run for the
 * dev-web preview's seeded products (?bt_preview=buyer, no real account).
 *
 * Everything else is the real code, not a mock screen: the product page,
 * the cart, the checkout cards and validation, and the order-success
 * screen. Only two server calls have no preview equivalent, so this stands
 * in for them:
 *  - the seller's shipping rate (GET /api/shipping-rates/calculate). A
 *    preview seller has no rate row, so this returns a fixed "Standard
 *    shipping" rate;
 *  - Stripe (POST /api/buyer/checkout/session, then Stripe's hosted page,
 *    then verify). A preview order is "paid" locally with no charge, and
 *    the no-charge copy says so on the Payment card. The order is recorded
 *    in lib/previewOrders.ts so "View order" opens it.
 *
 * Gating:
 *  - `__DEV__` + isPreviewCatalogEnabled(), so it's dead code in production;
 *  - AND every item in the group must be a seeded `preview-product-*`,
 *    sold by a `preview-seller-*`.
 * A real product, a real seller, or a production build always takes the
 * real Stripe path. There is no way to reach this with a real account's
 * real cart.
 */
import type { CartItem } from '@/services/cartTypes';
import { isPreviewProductId } from './previewProducts';
import { recordPreviewOrder } from './previewOrders';

function previewEnabled(): boolean {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('./previewCatalog') as typeof import('./previewCatalog')).isPreviewCatalogEnabled();
}

export function isPreviewSellerId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('preview-seller-');
}

/** A preview seller's shipping rate: $12 standard, free from $500. */
export function previewShippingRate(sellerId: string, subtotalCents: number): { id: string; name: string; amountCents: number } | null {
  if (!isPreviewSellerId(sellerId) || !previewEnabled()) return null;
  return previewRateFor(sellerId, subtotalCents);
}

/** Pure rate rule behind previewShippingRate (exported for tests). */
export function previewRateFor(sellerId: string, subtotalCents: number): { id: string; name: string; amountCents: number } {
  const free = subtotalCents >= 50_000;
  return { id: `seller_rate_${sellerId}`, name: free ? 'Free shipping' : 'Standard shipping', amountCents: free ? 0 : 1_200 };
}

/** True only when every item is a seeded preview product from a preview seller. */
export function isPreviewCheckoutGroup(group: { sellerId: string; items: Pick<CartItem, 'productId' | 'sellerId'>[] }): boolean {
  if (!previewEnabled()) return false;
  return isPreviewGroupShape(group);
}

/** Pure shape check behind isPreviewCheckoutGroup (exported for tests). */
export function isPreviewGroupShape(group: { sellerId: string; items: Pick<CartItem, 'productId' | 'sellerId'>[] }): boolean {
  if (!isPreviewSellerId(group.sellerId) || group.items.length === 0) return false;
  return group.items.every(item => isPreviewProductId(item.productId) && isPreviewSellerId(item.sellerId));
}

let sequence = 0;

/**
 * "Pays" a preview group: no Stripe, no charge. Returns what checkout's
 * verify step would (a paid session with an order id and number) and
 * records the order for /buyer-order-detail.
 */
export function placePreviewOrder(input: {
  group: { sellerId: string; sellerName: string; items: CartItem[] };
  shippingCents: number;
  contact: { email?: string; phone?: string };
  address: { firstName?: string; lastName?: string; line1?: string; line2?: string; city?: string; state?: string; postalCode?: string; country?: string };
}): { orderId: string; orderNumber: string; amountTotal: number; paymentStatus: 'paid' } {
  sequence += 1;
  const { record, result } = buildPreviewOrder(input, Date.now(), sequence);
  recordPreviewOrder(record);
  return result;
}

/** Pure: the order record + the verify-style result for a preview group (exported for tests). */
export function buildPreviewOrder(
  input: Parameters<typeof placePreviewOrder>[0],
  nowMs: number,
  seq: number,
): { record: Record<string, unknown> & { id: string }; result: { orderId: string; orderNumber: string; amountTotal: number; paymentStatus: 'paid' } } {
  const subtotal = input.group.items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const total = subtotal + input.shippingCents;
  const orderId = `preview-order-${nowMs.toString(36)}-${seq}`;
  const orderNumber = `BT-${String(10_500 + (nowMs % 9_000) + seq).padStart(5, '0')}`;
  const now = new Date(nowMs).toISOString();
  const record = {
    id: orderId,
    orderNumber,
    ownerId: input.group.sellerId,
    sellerDisplayName: input.group.sellerName,
    status: 'pending',
    stripePaymentIntentId: null,
    paidAt: now,
    items: input.group.items.map(item => ({
      productId: item.productId,
      productName: item.productName,
      variantLabel: item.variantTitle,
      quantity: item.quantity,
      priceCents: item.priceCents,
      imageUrl: item.imageUri,
    })),
    shippingAddress: {
      name: [input.address.firstName, input.address.lastName].filter(Boolean).join(' '),
      street: input.address.line1 ?? '',
      line2: input.address.line2 ?? null,
      city: input.address.city ?? '',
      state: input.address.state ?? '',
      zip: input.address.postalCode ?? '',
      country: input.address.country || 'US',
    },
    subtotalCents: subtotal,
    shippingCents: input.shippingCents,
    totalCents: total,
    trackingNumber: null,
    carrier: null,
    trackingStatus: null,
    estimatedDelivery: null,
    shippedAt: null,
    isCustomerVisible: false,
    createdAt: now,
  };
  return { record, result: { orderId, orderNumber, amountTotal: total, paymentStatus: 'paid' } };
}

/**
 * The preview buyer's demo checkout details: the same Jordan Reyes /
 * 148 Mercer Street the seeded preview order ships to. Checkout fills them
 * in for an all-preview order, so "Place order" works in one tap on the
 * live preview. Only fields the buyer left empty are filled, and nothing is
 * saved to an account.
 */
export const PREVIEW_CHECKOUT_CONTACT = {
  email: 'jordan.reyes@example.com',
  phone: '(212) 555-0142',
} as const;

export const PREVIEW_CHECKOUT_ADDRESS = {
  firstName: 'Jordan',
  lastName: 'Reyes',
  line1: '148 Mercer Street',
  city: 'New York',
  state: 'NY',
  postalCode: '10012',
  country: 'US',
} as const;

/**
 * Pure: `contact`/`address` with the preview buyer's details filled into
 * any empty field. Anything the buyer typed is kept. The address is filled
 * as a whole, and only when it has no street yet, so a half-typed real
 * address is never mixed with the demo one.
 */
export function withPreviewCheckoutDetails<
  C extends { email?: string; phone?: string },
  A extends { line1?: string; saveAddress?: boolean },
>(contact: C, address: A): { contact: C; address: A } {
  return {
    contact: {
      ...contact,
      email: contact.email?.trim() ? contact.email : PREVIEW_CHECKOUT_CONTACT.email,
      phone: contact.phone?.trim() ? contact.phone : PREVIEW_CHECKOUT_CONTACT.phone,
    },
    address: address.line1?.trim() ? address : { ...address, ...PREVIEW_CHECKOUT_ADDRESS, saveAddress: false },
  };
}
