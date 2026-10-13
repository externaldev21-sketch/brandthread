/**
 * Seller marketing tools: product feed URLs (Meta / TikTok catalogs) and the
 * pop-up QR sticker link. Seller-scoped API calls only; screens decide what
 * to show in the signed-out dev preview (serviceRequest refuses there).
 */
import { serviceRequest } from '@/lib/serviceConfig';

export type ProductFeedUrls = {
  metaUrl: string;
  tiktokUrl: string;
  createdAt: string;
  rotatedAt: string;
  metaFetchedAt: string | null;
  tiktokFetchedAt: string | null;
};

export type ProductFeedOverview = {
  feed: ProductFeedUrls | null;
  productCount: number;
  itemCount: number;
};

export type QrStickerLink = {
  id: string;
  code: string;
  /** What the QR encodes: the tracked short link (scans counted). */
  qrUrl: string;
  clicks: number;
  orders: number;
  username: string | null;
  storeName: string;
};

export const getProductFeed = () => serviceRequest<ProductFeedOverview>('/api/seller/product-feed');
export const createProductFeed = () => serviceRequest<ProductFeedOverview>('/api/seller/product-feed', { method: 'POST', body: '{}' });
export const regenerateProductFeed = () =>
  serviceRequest<ProductFeedOverview>('/api/seller/product-feed/regenerate', { method: 'POST', body: '{}' });

export const getQrStickerLink = () => serviceRequest<QrStickerLink>('/api/growth/qr-sticker-link', { method: 'POST', body: '{}' });
