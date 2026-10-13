/**
 * "Add to this order" (components/checkout/AddToOrderOffer.tsx): the offer
 * the server opens for a few minutes after a paid order
 * (GET/POST /api/buyer/add-on/:orderId). Pure helpers + types.
 */
export type AddOnVariant = { variantId: string; label: string; priceCents: number };
export type AddOnProduct = { productId: string; name: string; imageUrl: string | null; variants: AddOnVariant[] };
export type AddOnOffer = {
  orderId: string;
  sellerId: string;
  expiresAt: string;
  card: { brand: string | null; last4: string | null };
  products: AddOnProduct[];
};

/** "14:39" — minutes:seconds left, never negative. */
export function formatTimeLeft(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "Visa •••• 4242", or null when the server sent no card details. */
export function cardLabel(card: AddOnOffer['card']): string | null {
  if (!card.last4) return null;
  const brand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card';
  return `${brand} •••• ${card.last4}`;
}

/** The lowest price among a product's variants. */
export function fromPrice(product: AddOnProduct): number {
  return product.variants.reduce((min, v) => Math.min(min, v.priceCents), product.variants[0]?.priceCents ?? 0);
}
