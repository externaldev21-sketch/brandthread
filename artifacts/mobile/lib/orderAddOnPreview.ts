import { getPreviewRelatedProducts } from './previewProducts';
import type { AddOnOffer } from './orderAddOn';

/** Dev-web preview with demo=1 only: an offer built from the seeded preview catalog. */
export function previewAddOnOffer(orderId: string, sellerId: string, now = Date.now()): AddOnOffer {
  return {
    orderId,
    sellerId,
    expiresAt: new Date(now + 14 * 60_000 + 39_000).toISOString(),
    card: { brand: 'visa', last4: '4242' },
    products: getPreviewRelatedProducts('preview-product-01', 4).map((p, i) => ({
      productId: p.id,
      name: p.name,
      imageUrl: p.images[0] ?? null,
      variants: i === 0
        ? ['S', 'M', 'L'].map((size) => ({ variantId: `${p.id}-${size}`, label: size, priceCents: p.priceCents }))
        : [{ variantId: `${p.id}-one`, label: 'One size', priceCents: p.priceCents }],
    })),
  };
}
