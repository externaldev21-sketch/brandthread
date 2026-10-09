/**
 * Press-in prefetch for detail pages: product tiles → app/buyer-product-detail.tsx,
 * order rows → app/buyer-order-detail.tsx, creator avatars → app/seller-profile.tsx. The row (and a product's hero
 * image) starts loading the moment a finger lands (~100–200ms before the tap
 * registers). The detail page reads the same query key — it paints straight
 * from a finished prefetch, and TanStack Query joins an in-flight one instead
 * of firing a second request.
 *
 * Plain functions (no hooks/providers), so any tile or row can call them.
 */
import { DETAIL_STALE_TIME_MS, PRESS_IN_REUSE_MS, queryClient, queryKeys } from '@/lib/queryClient';
import { prefetchImage, prefetchQuery } from '@/lib/prefetch';

async function getQuietly(path: string): Promise<unknown> {
  const { serviceRequest } = await import('@/lib/serviceConfig');
  // reportErrors=false: a speculative prefetch never raises the network banner.
  return serviceRequest(path, {}, false);
}

/** GET /api/public/products/:id — the same row api.publicProducts.get returns. */
export function fetchPublicProduct(productId: string): Promise<unknown> {
  return getQuietly(`/api/public/products/${encodeURIComponent(productId)}`);
}

/** GET /api/buyer/orders/:id — the same row api.buyer.orders.get returns. */
export function fetchBuyerOrder(orderId: string): Promise<unknown> {
  return getQuietly(`/api/buyer/orders/${encodeURIComponent(orderId)}`);
}

export function prefetchProductOnPressIn(productId: string | null | undefined, imageUri?: string | null): void {
  if (!productId) return;
  prefetchQuery(queryClient, queryKeys.publicProduct(productId), () => fetchPublicProduct(productId), DETAIL_STALE_TIME_MS);
  if (imageUri) prefetchImage(imageUri);
}

export function prefetchBuyerOrderOnPressIn(orderId: string | null | undefined): void {
  if (!orderId) return;
  prefetchQuery(queryClient, queryKeys.buyerOrder(orderId), () => fetchBuyerOrder(orderId), PRESS_IN_REUSE_MS);
}

/** GET /api/public/sellers/:id — the same row api.publicSellers.get returns. */
export function fetchPublicSeller(sellerId: string): Promise<unknown> {
  return getQuietly(`/api/public/sellers/${encodeURIComponent(sellerId)}`);
}

export function prefetchSellerOnPressIn(sellerId: string | null | undefined): void {
  if (!sellerId) return;
  prefetchQuery(queryClient, queryKeys.publicSeller(sellerId), () => fetchPublicSeller(sellerId), PRESS_IN_REUSE_MS);
}
