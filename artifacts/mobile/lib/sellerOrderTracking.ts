/**
 * Seller order "View Tracking": maps the carrier scan history the API
 * returns on GET /api/orders/:id (`trackingEvents`, recorded from Shippo)
 * and resolves the carrier tracking URL.
 */
import type { TrackingEvent, TrackingStatus } from '@/services/orderTypes';
import { carrierTrackingUrl } from '@/lib/orderStatusAdapter';
import { safeTrackingUrl } from '@/lib/deliveryGuarantee';

const STATUS_LABELS: Record<TrackingStatus, string> = {
  label_created: 'Label created',
  accepted: 'Accepted by carrier',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  exception: 'Delivery exception',
  returned_to_sender: 'Returned to sender',
};

export function trackingStatusText(status: string | null | undefined): string {
  if (!status) return 'Awaiting first carrier scan';
  return STATUS_LABELS[status as TrackingStatus] ?? status.replace(/_/g, ' ');
}

export function mapTrackingEvents(raw: unknown): TrackingEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e: any) => e && typeof e.status === 'string' && typeof e.occurredAt === 'string')
    .map((e: any, i: number) => ({
      id: typeof e.id === 'string' ? e.id : `ev-${i}`,
      status: e.status as TrackingStatus,
      description: typeof e.description === 'string' && e.description ? e.description : trackingStatusText(e.status),
      location: typeof e.location === 'string' && e.location ? e.location : undefined,
      timestamp: e.occurredAt,
    }));
}

/** Server-provided URL when safe, else built from carrier + number. */
export function resolveTrackingUrl(serverUrl: unknown, carrier: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  const fromServer = safeTrackingUrl(typeof serverUrl === 'string' ? serverUrl : null);
  if (fromServer) return fromServer;
  return trackingNumber ? carrierTrackingUrl(carrier, trackingNumber) : null;
}
