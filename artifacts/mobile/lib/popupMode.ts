/**
 * Pop-up mode (in-person Tap to Pay) — types for /api/seller/terminal and the
 * pure cart math the screen uses. Money is integer cents throughout; the
 * server re-prices every sale, these totals are only what the seller sees.
 */

export type PopupStatus = {
  enabled: boolean;
  paymentsReady: boolean;
  location: { id: string; displayName: string } | null;
  hasSellerLocation: boolean;
};

export type PopupVariant = { variantId: string; label: string; priceCents: number; stock: number };
export type PopupProduct = { productId: string; name: string; imageUrl: string | null; variants: PopupVariant[] };

export type PopupPaymentStart = {
  paymentIntentId: string;
  clientSecret: string;
  status: string;
  amountCents: number;
};

export type PopupPaymentStatus = {
  status: string;
  amountCents: number;
  order: { orderId: string; orderNumber: string; totalCents: number; status: string } | null;
};

export type PopupCartLine = {
  productId: string;
  variantId: string;
  name: string;
  variantLabel: string;
  imageUrl: string | null;
  unitCents: number;
  quantity: number;
  stock: number;
};

export function addToCart(cart: PopupCartLine[], product: PopupProduct, variant: PopupVariant): PopupCartLine[] {
  const existing = cart.find((line) => line.variantId === variant.variantId);
  if (existing) {
    return cart.map((line) => line.variantId === variant.variantId
      ? { ...line, quantity: Math.min(line.stock, line.quantity + 1) }
      : line);
  }
  return [...cart, {
    productId: product.productId,
    variantId: variant.variantId,
    name: product.name,
    variantLabel: variant.label,
    imageUrl: product.imageUrl,
    unitCents: variant.priceCents,
    quantity: 1,
    stock: variant.stock,
  }];
}

export function setQuantity(cart: PopupCartLine[], variantId: string, quantity: number): PopupCartLine[] {
  if (quantity <= 0) return cart.filter((line) => line.variantId !== variantId);
  return cart.map((line) => line.variantId === variantId
    ? { ...line, quantity: Math.min(line.stock, Math.max(1, Math.floor(quantity))) }
    : line);
}

export function cartTotalCents(cart: PopupCartLine[]): number {
  return cart.reduce((sum, line) => sum + line.unitCents * line.quantity, 0);
}

export function cartItemCount(cart: PopupCartLine[]): number {
  return cart.reduce((sum, line) => sum + line.quantity, 0);
}

/** The request body: ids and quantities only. Prices never leave the server. */
export function paymentBody(cart: PopupCartLine[], clientIdempotencyKey: string) {
  return {
    items: cart.map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity })),
    clientIdempotencyKey,
  };
}

/** Labelled demo catalog for the dev web preview only (?demo=1). */
export const POPUP_DEMO_PRODUCTS: PopupProduct[] = [
  {
    productId: 'demo-tee', name: 'Heavyweight Tee', imageUrl: null,
    variants: [
      { variantId: 'demo-tee-s', label: 'S / Black', priceCents: 3800, stock: 6 },
      { variantId: 'demo-tee-m', label: 'M / Black', priceCents: 3800, stock: 9 },
      { variantId: 'demo-tee-l', label: 'L / Black', priceCents: 3800, stock: 2 },
    ],
  },
  {
    productId: 'demo-cap', name: 'Washed Cap', imageUrl: null,
    variants: [{ variantId: 'demo-cap-os', label: 'One size', priceCents: 2800, stock: 12 }],
  },
  {
    productId: 'demo-hoodie', name: 'Fleece Hoodie', imageUrl: null,
    variants: [
      { variantId: 'demo-hoodie-m', label: 'M / Grey', priceCents: 7200, stock: 4 },
      { variantId: 'demo-hoodie-l', label: 'L / Grey', priceCents: 7200, stock: 3 },
    ],
  },
  {
    productId: 'demo-tote', name: 'Canvas Tote', imageUrl: null,
    variants: [{ variantId: 'demo-tote-os', label: 'One size', priceCents: 2200, stock: 20 }],
  },
];
