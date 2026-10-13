/**
 * Fits API (F6 items 80-82): stitches, buyer fit checks on products, brand
 * repost requests. Server: artifacts/api-server/src/routes/fits.ts.
 */
import { serviceRequest } from '@/lib/serviceConfig';

export interface FitsAuthor {
  displayName: string | null;
  brandName: string | null;
  username: string | null;
  accountType?: string | null;
}

export interface FitsPostSummary {
  id: string;
  userId: string;
  caption: string;
  mediaType: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  author: FitsAuthor;
}

export interface StitchInfo {
  postId: string;
  clipStartMs: number;
  clipEndMs: number;
  sourceAuthor: Omit<FitsAuthor, 'accountType'> | null;
  source: FitsPostSummary | { unavailable: true };
}

export interface FitProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  brandName: string | null;
}

export interface ProductFitCheck {
  postId: string;
  userId: string;
  caption: string;
  mediaType: string;
  thumbnailUrl: string | null;
  createdAt: string;
  author: { displayName: string | null; username: string | null };
}

export type RepostRequestStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export interface RepostRequestDetail {
  id: string;
  postId: string;
  status: RepostRequestStatus;
  createdAt: string;
  respondedAt: string | null;
  brand: { userId: string; name: string; handle: string; avatarUrl: string | null } | null;
  post: { id: string; caption: string; mediaType: string; mediaUrl: string; thumbnailUrl: string | null } | null;
}

const enc = encodeURIComponent;
const jsonBody = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const fitsService = {
  stitchSource: (postId: string) =>
    serviceRequest<{ source: FitsPostSummary }>(`/api/fits/stitch-source/${enc(postId)}`),
  linkStitch: (input: { postId: string; sourcePostId: string; clipStartMs?: number; clipEndMs?: number }) =>
    serviceRequest<{ stitch: StitchInfo }>('/api/fits/stitches', jsonBody(input)),
  /** Removes a just-created stitch post when linking it to the original fails. */
  discardPost: (postId: string) =>
    serviceRequest<unknown>(`/api/posts/${enc(postId)}`, { method: 'DELETE' }, false),
  stitch: (postId: string) =>
    serviceRequest<{ stitch: StitchInfo }>(`/api/fits/stitches/${enc(postId)}`, {}, false),

  purchasedProducts: () =>
    serviceRequest<{ products: FitProduct[] }>('/api/fits/purchased-products'),
  fitCheck: (postId: string) =>
    serviceRequest<{ fitCheck: { postId: string; product: FitProduct } }>(`/api/fits/fit-checks/${enc(postId)}`, {}, false),
  linkFitCheck: (postId: string, productId: string) =>
    serviceRequest<{ fitCheck: { postId: string; productId: string } }>(`/api/fits/fit-checks/${enc(postId)}`, {
      method: 'PUT', body: JSON.stringify({ productId }),
    }),
  unlinkFitCheck: (postId: string) =>
    serviceRequest<{ ok: true }>(`/api/fits/fit-checks/${enc(postId)}`, { method: 'DELETE' }),
  productFitChecks: (productId: string, limit = 12) =>
    serviceRequest<{ fitChecks: ProductFitCheck[] }>(`/api/products/${enc(productId)}/fit-checks?limit=${limit}`, {}, false),

  repostRequestStatus: (postId: string) =>
    serviceRequest<{ request: { id: string; status: RepostRequestStatus } | null }>(`/api/fits/repost-requests/status?postId=${enc(postId)}`, {}, false),
  requestRepost: (postId: string) =>
    serviceRequest<{ request: { id: string; status: RepostRequestStatus } }>('/api/fits/repost-requests', jsonBody({ postId })),
  repostRequest: (id: string) =>
    serviceRequest<{ request: RepostRequestDetail }>(`/api/fits/repost-requests/${enc(id)}`),
  respondToRepostRequest: (id: string, decision: 'approve' | 'decline') =>
    serviceRequest<{ request: { id: string; status: RepostRequestStatus } }>(`/api/fits/repost-requests/${enc(id)}/respond`, jsonBody({ decision })),
  cancelRepostRequest: (id: string) =>
    serviceRequest<{ request: { id: string; status: RepostRequestStatus } }>(`/api/fits/repost-requests/${enc(id)}/cancel`, jsonBody({})),
};
