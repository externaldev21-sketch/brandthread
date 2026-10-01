/**
 * Demo fixture for "Reorder" (demo=1 only, via lib/previewOrders.ts): a
 * delivered order with two products that are still sold and one that no
 * longer exists, so the partial-availability sheet has something honest to
 * show. Same row shape as GET /api/buyer/orders.
 */
import type { PreviewCatalogProduct } from './previewCatalog';

export function buildDemoReorderOrders(
  productFor: (id: string) => PreviewCatalogProduct | null,
): Record<string, unknown>[] {
  const a = productFor('preview-product-04');
  const b = productFor('preview-product-05');
  if (!a || !b) return [];
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const DAY = 24 * 60 * 60_000;
  const line = (p: PreviewCatalogProduct, n: number, variantLabel: string) => ({
    id: `preview-order-reorder-item-${n}`,
    productId: p.productId,
    productName: p.name,
    variantLabel,
    quantity: 1,
    priceCents: p.currentPriceCents,
    imageUrl: p.images[0],
  });
  const items = [
    line(a, 1, a.sizes[1] ?? 'M'),
    line(b, 2, b.sizes[1] ?? 'M'),
    {
      id: 'preview-order-reorder-item-3', productId: 'preview-product-discontinued',
      productName: 'Wool Scarf', variantLabel: 'One size', quantity: 1, priceCents: 9500,
    },
  ];
  const subtotal = items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
  return [{
    id: 'preview-order-reorder',
    orderNumber: 'BT-10377',
    ownerId: a.sellerId,
    sellerDisplayName: a.sellerDisplayName,
    status: 'delivered',
    stripePaymentIntentId: 'pi_preview_order_reorder',
    items,
    shippingAddress: { name: 'Jordan Reyes', street: '148 Mercer Street', city: 'New York', state: 'NY', zip: '10012', country: 'US' },
    subtotalCents: subtotal, shippingCents: 0, totalCents: subtotal,
    trackingNumber: '1Z999AA10123456701', carrier: 'UPS', trackingStatus: 'delivered',
    estimatedDelivery: ago(11 * DAY).slice(0, 10),
    shippedAt: ago(12 * DAY), paidAt: ago(14 * DAY), createdAt: ago(14 * DAY),
    isCustomerVisible: true,
  }];
}
