/**
 * Live shopping extras (F6 live-commerce): the live bag with co-host
 * products, a co-host adding their products, and the "just bought" / gift
 * activity the polling pager reads. Server: routes/live-shopping.ts.
 */
import { serviceRequest } from '@/lib/serviceConfig';

export interface LiveBagProduct {
  productId: string;
  productName: string;
  priceCents: number;
  imageUri: string | null;
  sellerId: string;
  sellerName: string;
  fromHost: boolean;
  highlighted?: boolean;
}

export interface LiveActivityItem {
  id: string;
  kind: 'purchase' | 'gift';
  /** First name or @handle only. */
  name: string;
  text: string;
  /** ISO time. */
  at: string;
}

export const fetchLiveBag = (streamId: string) =>
  serviceRequest<{ products: LiveBagProduct[] }>(`/api/live/${encodeURIComponent(streamId)}/bag`, {}, false)
    .then(r => r.products ?? []);

export const setCohostLiveProducts = (streamId: string, productIds: string[]) =>
  serviceRequest<{ products: LiveBagProduct[] }>(
    `/api/live/${encodeURIComponent(streamId)}/cohost/products`,
    { method: 'PUT', body: JSON.stringify({ productIds }) },
    false,
  ).then(r => r.products ?? []);

export const fetchLiveActivity = (streamId: string, sinceIso: string) =>
  serviceRequest<{ activity: LiveActivityItem[] }>(
    `/api/live/${encodeURIComponent(streamId)}/activity?since=${encodeURIComponent(sinceIso)}`, {}, false,
  ).then(r => r.activity ?? []);
