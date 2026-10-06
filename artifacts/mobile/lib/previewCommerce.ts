/**
 * Local-only preview records for order and live-commerce surfaces.
 *
 * These fixtures never represent completed payments: order status and payment
 * status remain pending, and every identifier is visibly synthetic. Callers
 * must use isSellerDevPreview/isBuyerDevPreview before exposing them.
 */
import type { BuyerOrderView, OrderStatus, TrackingStatus } from '@/services/orderTypes';
import { isBuyerDevPreview, isSellerDevPreview } from '@/lib/devPreview';

const PREVIEW_DATE = () => new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
const DELIVERY_DATE = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

export interface PreviewSellerOrderRow {
  id: string;
  orderNumber: string;
  status: 'pending';
  customerName: string;
  customerEmail: string;
  totalCents: number;
  itemCount: number;
  dropName: string;
  trackingNumber: string;
  carrier: string;
  trackingStatus: TrackingStatus;
  estimatedDelivery: string;
  createdAt: string;
  updatedAt: string;
  isPreview: true;
}

interface PreviewOrderSeed {
  id: string;
  orderNumber: string;
  sellerId: string;
  sellerName: string;
  sellerHandle: string;
  productName: string;
  productId: string;
  imageUri: string;
  totalCents: number;
  trackingNumber: string;
  trackingStatus: TrackingStatus;
}

const ORDER_SEEDS: PreviewOrderSeed[] = [
  {
    id: 'preview-order-01',
    orderNumber: 'PREVIEW-ORDER-01',
    sellerId: 'preview-seller-01',
    sellerName: 'Atelier Noire',
    sellerHandle: '@atelier_noire',
    productName: 'Sculpted Wool Coat',
    productId: 'preview-product-01',
    imageUri: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=480&q=80',
    totalCents: 48000,
    trackingNumber: 'PREVIEW-TRACKING-01',
    trackingStatus: 'label_created',
  },
  {
    id: 'preview-order-02',
    orderNumber: 'PREVIEW-ORDER-02',
    sellerId: 'preview-seller-02',
    sellerName: 'Maison Vela',
    sellerHandle: '@maison_vela',
    productName: 'Liquid Silver Dress',
    productId: 'preview-product-02',
    imageUri: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=480&q=80',
    totalCents: 32500,
    trackingNumber: 'PREVIEW-TRACKING-02',
    trackingStatus: 'accepted',
  },
];

/** Raw-row shape used by apiRowToOrder in the seller orders screen. */
export function getPreviewSellerOrderRows(): PreviewSellerOrderRow[] {
  if (!isSellerDevPreview()) return [];
  return ORDER_SEEDS.map((seed, index) => {
    const createdAt = new Date(Date.now() - (index + 1) * 3 * 60 * 60 * 1000).toISOString();
    return {
      id: seed.id,
      orderNumber: seed.orderNumber,
      status: 'pending',
      customerName: index === 0 ? 'Maya Chen' : 'Jordan Reyes',
      customerEmail: index === 0 ? 'maya.preview@example.test' : 'jordan.preview@example.test',
      totalCents: seed.totalCents,
      itemCount: 1,
      dropName: seed.productName,
      trackingNumber: seed.trackingNumber,
      carrier: 'Preview carrier',
      trackingStatus: seed.trackingStatus,
      estimatedDelivery: DELIVERY_DATE(),
      createdAt,
      updatedAt: createdAt,
      isPreview: true,
    };
  });
}

/** Buyer-list view of the same pending, synthetic preview orders. */
export function getPreviewBuyerOrders(): BuyerOrderView[] {
  if (!isBuyerDevPreview()) return [];
  return ORDER_SEEDS.map((seed, index) => ({
    id: seed.id,
    orderNumber: seed.orderNumber,
    sellerId: seed.sellerId,
    sellerName: seed.sellerName,
    sellerHandle: seed.sellerHandle,
    status: 'new' as OrderStatus,
    paymentStatus: 'pending',
    fulfillmentStatus: 'unfulfilled',
    lineItems: [{
      productId: seed.productId,
      productName: seed.productName,
      variant: index === 0 ? 'M' : 'S',
      quantity: 1,
      unitPriceCents: seed.totalCents,
      imageUri: seed.imageUri,
    }],
    shippingAddress: {
      name: index === 0 ? 'Maya Chen' : 'Jordan Reyes',
      line1: 'Preview address',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90001',
      country: 'US',
    },
    payment: {
      subtotalCents: seed.totalCents,
      shippingTotalCents: 0,
      taxTotalCents: 0,
      totalCents: seed.totalCents,
    },
    trackingNumber: seed.trackingNumber,
    trackingCarrier: 'Preview carrier',
    trackingStatus: seed.trackingStatus,
    estimatedDelivery: DELIVERY_DATE(),
    isPreOrder: false,
    hasReturnRequest: false,
    isCustomerVisible: true,
    createdAt: new Date(Date.now() - (index + 1) * 3 * 60 * 60 * 1000).toISOString(),
  }));
}

/**
 * Shape consumed by the existing live.active() → feed row adapter. Synthetic
 * IDs intentionally cannot be mistaken for server UUIDs; sessions contain no
 * Agora credentials and must not be joined by a native client.
 */
export interface PreviewLiveSession {
  id: string;
  status: 'live';
  seller_id: string;
  seller_name: string;
  brand_name: string;
  title: string;
  thumbnail_url: string;
  viewer_count: number;
  product_tags: { productId: string; productName: string; priceCents: number }[];
  is_preview: true;
}

const PREVIEW_LIVE_SESSIONS: PreviewLiveSession[] = [
  {
    id: 'preview-live-session-01',
    status: 'live',
    seller_id: 'preview-seller-01',
    seller_name: 'Atelier Noire',
    brand_name: 'Atelier Noire',
    title: 'Preview · The Atelier Noire fitting room',
    thumbnail_url: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?auto=format&fit=crop&w=900&q=82',
    viewer_count: 128,
    product_tags: [{ productId: 'preview-product-01', productName: 'Sculpted Wool Coat', priceCents: 48000 }],
    is_preview: true,
  },
  {
    id: 'preview-live-session-02',
    status: 'live',
    seller_id: 'preview-seller-02',
    seller_name: 'Maison Vela',
    brand_name: 'Maison Vela',
    title: 'Preview · Evening silhouettes with Maison Vela',
    thumbnail_url: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=900&q=82',
    viewer_count: 86,
    product_tags: [{ productId: 'preview-product-02', productName: 'Liquid Silver Dress', priceCents: 32500 }],
    is_preview: true,
  },
];

/** Live records are available only in the explicitly selected dev-web buyer preview. */
export function getPreviewLiveSessions(): PreviewLiveSession[] {
  return isBuyerDevPreview() ? PREVIEW_LIVE_SESSIONS.map(session => ({ ...session, product_tags: session.product_tags.map(tag => ({ ...tag })) })) : [];
}

export function isPreviewCommerceId(id: string | undefined): boolean {
  return !!id && (
    ORDER_SEEDS.some(order => order.id === id) ||
    PREVIEW_LIVE_SESSIONS.some(session => session.id === id)
  );
}