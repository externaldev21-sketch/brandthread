/**
 * Buyer "Request refund" (app/buyer-refund-request.tsx): which server path a
 * request takes, and the photo upload that has to happen before it.
 *
 *  - Not shipped yet: POST /api/buyer/orders/:id/cancel. The server refunds
 *    in full and cancels (pre-shipment, through day 21). /api/returns would
 *    reject the order ("must be shipped, fulfilled, or delivered").
 *  - Shipped or delivered: each photo is uploaded first (POST
 *    /api/returns/evidence, raw image body, answers { objectPath }), then
 *    POST /api/returns with those object paths as evidenceUrls. The server
 *    only accepts paths under the buyer's own evidence prefix, never file://.
 *
 * Pure apart from the injected API calls, so it is unit-tested.
 */
import type { OrderStatus } from '@/services/orderTypes';

export type RefundRoute = 'cancel' | 'return' | 'closed';

export function chooseRefundRoute(order: {
  status: OrderStatus | string;
  trackingNumber?: string | null;
}): RefundRoute {
  switch (order.status) {
    case 'cancelled':
    case 'refunded':
    case 'disputed':
      return 'closed';
    case 'shipped':
    case 'delivered':
      return 'return';
    default:
      // A server 'fulfilled' order maps to 'new' in the app; once it has a
      // tracking number it is in the carrier's hands, so it is a return.
      return order.trackingNumber?.trim() ? 'return' : 'cancel';
  }
}

export type EvidencePhotoState = 'uploading' | 'uploaded' | 'failed';

export type EvidencePhoto = {
  uri: string;
  mimeType?: string | null;
  state?: EvidencePhotoState;
  /** Set once uploaded; a retry never uploads the same photo twice. */
  objectPath?: string;
};

export class EvidenceUploadError extends Error {
  constructor(public readonly failedCount: number) {
    super(failedCount === 1 ? "A photo didn't upload. Remove it or try again." : `${failedCount} photos didn't upload. Remove them or try again.`);
    this.name = 'EvidenceUploadError';
  }
}

/**
 * Uploads every photo that has no objectPath yet, in parallel, reporting each
 * photo's state as it changes. Resolves to the object paths in photo order;
 * throws EvidenceUploadError if any photo failed (the others keep their paths).
 */
export async function uploadEvidencePhotos(
  photos: EvidencePhoto[],
  upload: (image: { uri: string; mimeType?: string | null }) => Promise<{ objectPath: string }>,
  onChange: (uri: string, patch: Partial<EvidencePhoto>) => void = () => {},
): Promise<string[]> {
  const results = await Promise.all(photos.map(async (photo) => {
    if (photo.objectPath) return photo.objectPath;
    // Already a stored object path (e.g. re-submitting a draft).
    if (photo.uri.startsWith('/objects/')) {
      onChange(photo.uri, { state: 'uploaded', objectPath: photo.uri });
      return photo.uri;
    }
    onChange(photo.uri, { state: 'uploading' });
    try {
      const { objectPath } = await upload({ uri: photo.uri, mimeType: photo.mimeType });
      if (typeof objectPath !== 'string' || !objectPath) throw new Error('No objectPath');
      onChange(photo.uri, { state: 'uploaded', objectPath });
      return objectPath;
    } catch {
      onChange(photo.uri, { state: 'failed' });
      return null;
    }
  }));
  const failed = results.filter((path) => path === null).length;
  if (failed > 0) throw new EvidenceUploadError(failed);
  return results as string[];
}

export type RefundRequestDeps = {
  uploadEvidence: (image: { uri: string; mimeType?: string | null }) => Promise<{ objectPath: string }>;
  createReturn: (body: {
    orderId: string; reason: string; notes?: string; resolutionRequested?: string; evidenceUrls?: string[];
  }) => Promise<unknown>;
  cancelOrder: (orderId: string) => Promise<{ cancelled: boolean; refunded: boolean }>;
  onPhotoChange?: (uri: string, patch: Partial<EvidencePhoto>) => void;
};

export type RefundRequestResult =
  | { kind: 'return' }
  | { kind: 'cancel'; refunded: boolean };

export async function submitRefundRequest(
  input: {
    order: { id: string; status: OrderStatus | string; trackingNumber?: string | null };
    reason: string;
    description: string;
    photos: EvidencePhoto[];
  },
  deps: RefundRequestDeps,
): Promise<RefundRequestResult> {
  const route = chooseRefundRoute(input.order);
  if (route === 'closed') throw new Error('This order can no longer be refunded here.');
  if (route === 'cancel') {
    const result = await deps.cancelOrder(input.order.id);
    if (!result.cancelled) throw new Error("This order couldn't be cancelled.");
    return { kind: 'cancel', refunded: result.refunded };
  }
  const evidenceUrls = await uploadEvidencePhotos(input.photos, deps.uploadEvidence, deps.onPhotoChange);
  await deps.createReturn({
    orderId: input.order.id,
    reason: input.reason,
    notes: input.description,
    resolutionRequested: 'refund',
    evidenceUrls,
  });
  return { kind: 'return' };
}

/** The server's own explanation when it has one ({ detail } or { error }). */
export function refundErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof EvidenceUploadError) return error.message;
  const body = (error as { body?: unknown } | null)?.body;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
      if (typeof parsed.detail === 'string' && parsed.detail) return parsed.detail;
      if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    } catch {
      // Non-JSON body: fall through.
    }
  }
  return fallback;
}
