/**
 * Demo fixtures for the delivery guarantee (docs/payments/delivery-guarantee.md),
 * in the exact shapes GET /api/buyer/orders and GET /api/orders return.
 *
 * Builders only: lib/previewOrders.ts decides WHEN they are used, and that is
 * `demo=1` only (isPreviewDemoMode) and dev builds only. A fresh preview and
 * production never call them. Times are relative to "now" so the countdowns
 * and "Arriving" dates stay plausible whenever the preview is opened.
 */
import type { PreviewCatalogProduct } from './previewCatalog';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

type Step = 'done' | 'current' | 'upcoming';

function deliverySteps(states: Step[], ats: (string | null)[]) {
  const defs = [
    ['ordered', 'Ordered'], ['preparing', 'Preparing'], ['shipped', 'Shipped'],
    ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered'],
  ] as const;
  return defs.map(([key, label], i) => ({ key, label, state: states[i], at: ats[i] ?? null }));
}

type Row = Record<string, any>;

export function buildDemoBuyerOrders(productFor: (id: string) => PreviewCatalogProduct | null): Row[] {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const ahead = (ms: number) => new Date(now + ms).toISOString();
  const ymd = (ms: number) => new Date(now + ms).toISOString().slice(0, 10);
  const address = { name: 'Jordan Reyes', street: '148 Mercer Street', city: 'New York', state: 'NY', zip: '10012', country: 'US' };

  function base(n: number, productIds: string[], o: Row): Row | null {
    const products = productIds.map(productFor).filter((p): p is PreviewCatalogProduct => !!p);
    if (products.length === 0) return null;
    const items = products.map((p, i) => ({
      id: `preview-order-0${n}-item-${i + 1}`,
      productId: p.productId,
      productName: p.name,
      variantLabel: 'Black / M',
      quantity: 1,
      priceCents: p.currentPriceCents,
      imageUrl: p.images[0],
    }));
    const subtotal = items.reduce((sum, it) => sum + it.priceCents, 0);
    return {
      id: `preview-order-0${n}`,
      orderNumber: `BT-${10429 - n}`,
      ownerId: products[0].sellerId,
      sellerDisplayName: products[0].sellerDisplayName,
      stripePaymentIntentId: `pi_preview_order_0${n}`,
      items,
      shippingAddress: address,
      subtotalCents: subtotal,
      shippingCents: 0,
      totalCents: subtotal,
      isCustomerVisible: true,
      ...o,
    };
  }

  const none = { carrier: null, trackingNumber: null, trackingUrl: null, canConfirmReceipt: false, disputePaused: false, shipments: [] };
  const rows: (Row | null)[] = [
    // 1. Mid-transit, shipped 200 min ago (the seeded Activity "Your order shipped" row).
    base(1, ['preview-product-01'], {
      status: 'shipped', trackingStatus: 'in_transit', estimatedDelivery: ymd(2 * DAY),
      trackingNumber: '1Z999AA10123456784', carrier: 'UPS',
      shippedAt: ago(200 * MINUTE), paidAt: ago(2 * DAY - 2 * MINUTE), createdAt: ago(2 * DAY),
      delivery: {
        deliverBy: ahead(13 * DAY), isPreorder: false, promisedShipDate: null,
        estimatedDelivery: ymd(2 * DAY), deliveredAt: null, deliveryConfirmedBy: null,
        steps: deliverySteps(['done', 'done', 'current', 'upcoming', 'upcoming'], [ago(2 * DAY), ago(DAY), ago(200 * MINUTE), null, null]),
        events: [
          { status: 'in_transit', description: 'Departed facility', location: 'Newark, NJ', at: ago(90 * MINUTE) },
          { status: 'in_transit', description: 'Arrived at facility', location: 'Secaucus, NJ', at: ago(150 * MINUTE) },
          { status: 'accepted', description: 'Picked up by carrier', location: 'Brooklyn, NY', at: ago(200 * MINUTE) },
          { status: 'label_created', description: 'Label created', location: null, at: ago(230 * MINUTE) },
        ],
        carrier: 'UPS', trackingNumber: '1Z999AA10123456784',
        trackingUrl: 'https://www.ups.com/track?tracknum=1Z999AA10123456784',
        canConfirmReceipt: true, disputePaused: false, autoRefund: null, shipments: [],
      },
    }),
    // 2. Delivered 3 days ago.
    base(2, ['preview-product-02'], {
      status: 'delivered', trackingStatus: 'delivered', estimatedDelivery: ymd(-3 * DAY),
      trackingNumber: '9400111899223344556677', carrier: 'USPS',
      shippedAt: ago(7 * DAY), paidAt: ago(9 * DAY), createdAt: ago(9 * DAY),
      delivery: {
        deliverBy: ahead(6 * DAY), isPreorder: false, promisedShipDate: null,
        estimatedDelivery: ymd(-3 * DAY), deliveredAt: ago(3 * DAY), deliveryConfirmedBy: 'carrier',
        steps: deliverySteps(['done', 'done', 'done', 'done', 'done'], [ago(9 * DAY), ago(8 * DAY), ago(7 * DAY), ago(3 * DAY + 5 * HOUR), ago(3 * DAY)]),
        events: [
          { status: 'delivered', description: 'Delivered, left at front door', location: 'New York, NY', at: ago(3 * DAY) },
          { status: 'out_for_delivery', description: 'Out for delivery', location: 'New York, NY', at: ago(3 * DAY + 5 * HOUR) },
          { status: 'in_transit', description: 'Arrived at post office', location: 'New York, NY', at: ago(4 * DAY) },
        ],
        carrier: 'USPS', trackingNumber: '9400111899223344556677',
        trackingUrl: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223344556677',
        canConfirmReceipt: false, disputePaused: false, autoRefund: null, shipments: [],
      },
    }),
    // 3. Pre-order, seller promised to ship in three weeks.
    base(3, ['preview-product-03'], {
      status: 'processing', trackingStatus: null, estimatedDelivery: null,
      paidAt: ago(DAY), createdAt: ago(DAY),
      delivery: {
        deliverBy: ahead(59 * DAY), isPreorder: true, promisedShipDate: ahead(21 * DAY),
        estimatedDelivery: null, deliveredAt: null, deliveryConfirmedBy: null,
        steps: deliverySteps(['done', 'current', 'upcoming', 'upcoming', 'upcoming'], [ago(DAY), null, null, null, null]),
        events: [], ...none, autoRefund: null,
      },
    }),
    // 4. Auto-refunded in full: never shipped within 15 days.
    base(4, ['preview-product-04'], {
      status: 'cancelled', cancellationReason: 'not_delivered_in_time', trackingStatus: null,
      paidAt: ago(17 * DAY), createdAt: ago(17 * DAY),
      delivery: {
        deliverBy: ago(2 * DAY), isPreorder: false, promisedShipDate: null,
        estimatedDelivery: null, deliveredAt: null, deliveryConfirmedBy: null,
        steps: deliverySteps(['done', 'current', 'upcoming', 'upcoming', 'upcoming'], [ago(17 * DAY), null, null, null, null]),
        events: [], ...none, autoRefund: null,
      },
    }),
    // 5. Two lines: one shipped, the other never sent, so only that one was refunded.
    base(5, ['preview-product-05', 'preview-product-06'], {
      status: 'shipped', trackingStatus: 'in_transit', estimatedDelivery: ymd(3 * DAY),
      trackingNumber: '1Z999AA10987654321', carrier: 'UPS',
      shippedAt: ago(12 * DAY), paidAt: ago(16 * DAY), createdAt: ago(16 * DAY),
      delivery: {
        deliverBy: ago(DAY), isPreorder: false, promisedShipDate: null,
        estimatedDelivery: ymd(3 * DAY), deliveredAt: null, deliveryConfirmedBy: null,
        steps: deliverySteps(['done', 'done', 'current', 'upcoming', 'upcoming'], [ago(16 * DAY), ago(14 * DAY), ago(12 * DAY), null, null]),
        events: [
          { status: 'in_transit', description: 'In transit to next facility', location: 'Louisville, KY', at: ago(6 * HOUR) },
          { status: 'accepted', description: 'Picked up by carrier', location: 'Los Angeles, CA', at: ago(12 * DAY) },
        ],
        carrier: 'UPS', trackingNumber: '1Z999AA10987654321',
        trackingUrl: 'https://www.ups.com/track?tracknum=1Z999AA10987654321',
        canConfirmReceipt: true, disputePaused: false, shipments: [], autoRefund: null,
      },
    }),
  ];
  const out = rows.filter((r): r is Row => !!r);
  // Refund amounts come from the order's own lines: the auto-refund covers
  // the whole order (4) or just the second, never-shipped line (5).
  for (const r of out) {
    if (r.id === 'preview-order-04') {
      r.delivery.autoRefund = { refundedCents: r.totalCents, refundedAt: ago(2 * DAY), partial: false, label: 'Refunded, not delivered in time' };
    }
    if (r.id === 'preview-order-05') {
      r.delivery.autoRefund = { refundedCents: r.items[1]?.priceCents ?? 0, refundedAt: ago(DAY), partial: true, label: 'Refunded, not delivered in time' };
    }
  }
  return out;
}

export function isPreviewSellerOrderId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('preview-seller-order-');
}

/** Seller orders (GET /api/orders[/:id] shape) with deadline countdowns. */
export function buildDemoSellerOrders(): Row[] {
  const now = Date.now();
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const ahead = (ms: number) => new Date(now + ms).toISOString();
  const shippingAddress = { name: 'Maya Chen', street: '22 Bedford Avenue', city: 'Brooklyn', state: 'NY', zip: '11211', country: 'US' };
  const item = (n: number, i: number, name: string, variantLabel: string, priceCents: number, extra: Row = {}) => ({
    id: `preview-seller-order-0${n}-item-${i}`, productId: null, productName: name, variantLabel,
    quantity: 1, priceCents, deliverBy: null, deliveredAt: null, trackingNumber: null, carrier: null, refundedAt: null, ...extra,
  });
  function order(n: number, o: Row & { items: ReturnType<typeof item>[] }): Row {
    const total = o.items.reduce((sum, it) => sum + it.priceCents, 0);
    return {
      id: `preview-seller-order-0${n}`, orderNumber: `BT-2031${n}`, customerName: 'Maya Chen', customerEmail: '',
      customer: { name: 'Maya Chen', email: '' }, shippingAddress,
      subtotalCents: total, shippingCents: 0, totalCents: total, itemCount: o.items.length,
      stripePaymentIntentId: `pi_preview_seller_0${n}`, trackingNumber: null, carrier: null,
      isPreorder: false, promisedShipDate: null, deliveredAt: null, autoRefundedAt: null, disputePausedAt: null,
      updatedAt: ago(HOUR), ...o,
    };
  }
  return [
    // 9 days left.
    order(1, {
      status: 'processing', paidAt: ago(6 * DAY - 4 * HOUR), createdAt: ago(6 * DAY - 4 * HOUR), deliverBy: ahead(9 * DAY + 4 * HOUR),
      items: [item(1, 1, 'Sculpted Wool Coat', 'Black / M', 18900, { deliverBy: ahead(9 * DAY + 4 * HOUR) })],
    }),
    // Under two days; two items, one already shipped.
    order(2, {
      status: 'processing', paidAt: ago(13 * DAY - 6 * HOUR), createdAt: ago(13 * DAY - 6 * HOUR), deliverBy: ahead(DAY + 6 * HOUR),
      items: [
        item(2, 1, 'Leather Ankle Boots', 'Black / 9', 24500, { deliverBy: ahead(DAY + 6 * HOUR), trackingNumber: '1Z999AA10123456784', carrier: 'UPS' }),
        item(2, 2, 'Crystal Mesh Top', 'Silver / S', 8900, { deliverBy: ahead(DAY + 6 * HOUR) }),
      ],
    }),
    // Pre-order: 12 days left, promised ship date in 10.
    order(3, {
      status: 'processing', paidAt: ago(48 * DAY), createdAt: ago(48 * DAY), deliverBy: ahead(12 * DAY + 4 * HOUR),
      isPreorder: true, promisedShipDate: ahead(10 * DAY),
      items: [item(3, 1, 'Ivory Column Set', 'White / S', 32000, { deliverBy: ahead(12 * DAY + 4 * HOUR) })],
    }),
    // Auto-refunded: read-only.
    order(4, {
      status: 'cancelled', cancellationReason: 'not_delivered_in_time', paidAt: ago(17 * DAY), createdAt: ago(17 * DAY),
      deliverBy: ago(2 * DAY), autoRefundedAt: ago(2 * DAY),
      items: [item(4, 1, 'Tailored Silk Trousers', 'Ivory / M', 15900, { deliverBy: ago(2 * DAY), refundedAt: ago(2 * DAY) })],
    }),
  ];
}
