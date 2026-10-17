/**
 * Item 109: the buyer's "Track shipment" screen (app/buyer-order-tracking.tsx)
 * reads GET /api/buyer/orders/:id and turns it into what that screen shows —
 * one block per shipment (carrier, tracking number, status, carrier link) plus
 * the carrier scan history. Pure, so it is unit tested without rendering.
 *
 * The server owns the data: orders.carrier / tracking_number / tracking_status
 * and the delivery block (lib/delivery/buyerView.ts) with its shipments,
 * events (order_tracking_events, newest first) and carrier trackingUrl.
 */
import { mapDelivery, safeTrackingUrl } from '@/lib/deliveryGuarantee';
import type { BuyerDelivery, DeliveryEvent } from '@/services/orderTypes';

/** A real carrier tracking page; a tracking-number web search when the carrier isn't recognised. */
export function carrierTrackingUrl(carrier: string | null | undefined, trackingNumber: string): string {
  const key = (carrier ?? '').toLowerCase();
  const encoded = encodeURIComponent(trackingNumber);
  if (key.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  if (key.includes('ups')) return `https://www.ups.com/track?tracknum=${encoded}`;
  if (key.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  if (key.includes('dhl')) return `https://www.dhl.com/en/express/tracking.html?AWB=${encoded}`;
  return `https://www.google.com/search?q=${encoded}+tracking`;
}

export function trackingStatusText(status: string | null | undefined): string {
  switch (status) {
    case 'label_created': return 'Label created';
    case 'accepted': return 'Accepted by carrier';
    case 'pre_transit': return 'Label created';
    case 'in_transit': return 'In transit';
    case 'out_for_delivery': return 'Out for delivery';
    case 'delivered': return 'Delivered';
    case 'exception':
    case 'failure': return 'Delivery problem';
    case 'returned_to_sender':
    case 'returned': return 'Returned to sender';
    case null:
    case undefined:
    case '': return 'Awaiting carrier scan';
    default: return status.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
  }
}

export interface TrackingShipmentView {
  trackingNumber: string;
  carrier: string;
  statusLabel: string;
  status: string | null;
  url: string;
  deliveredAt: string | null;
}

export interface OrderTrackingView {
  orderId: string;
  orderNumber: string;
  orderStatus: string;
  shipments: TrackingShipmentView[];
  /** Carrier scans, newest first. */
  events: DeliveryEvent[];
  estimatedDelivery: string | null;
  deliveredAt: string | null;
}

/** GET /api/buyer/orders/:id → the tracking screen's view. */
export function buildOrderTracking(row: any): OrderTrackingView {
  const delivery: BuyerDelivery | undefined = mapDelivery(row?.delivery);
  const primaryNumber: string | null = row?.trackingNumber || delivery?.trackingNumber || null;
  const primaryCarrier: string | null = row?.carrier || delivery?.carrier || null;
  const serverUrl = safeTrackingUrl(delivery?.trackingUrl);

  const toView = (trackingNumber: string, carrier: string | null, status: string | null, deliveredAt: string | null): TrackingShipmentView => ({
    trackingNumber,
    carrier: carrier || 'Carrier',
    status,
    statusLabel: trackingStatusText(status),
    // The server's carrier link is for the order's primary tracking number only.
    url: (trackingNumber === primaryNumber && serverUrl) || carrierTrackingUrl(carrier, trackingNumber),
    deliveredAt,
  });

  const fromDelivery = (delivery?.shipments ?? []).filter(s => !!s.trackingNumber);
  const shipments: TrackingShipmentView[] = fromDelivery.length > 0
    ? fromDelivery.map(s => toView(s.trackingNumber, s.carrier ?? primaryCarrier, s.trackingStatus ?? (s.trackingNumber === primaryNumber ? row?.trackingStatus ?? null : null), s.deliveredAt))
    : primaryNumber
      ? [toView(primaryNumber, primaryCarrier, row?.trackingStatus ?? null, delivery?.deliveredAt ?? null)]
      : [];

  return {
    orderId: String(row?.id ?? ''),
    orderNumber: String(row?.orderNumber ?? ''),
    orderStatus: String(row?.status ?? ''),
    shipments,
    events: delivery?.events ?? [],
    estimatedDelivery: delivery?.estimatedDelivery ?? row?.estimatedDelivery ?? null,
    deliveredAt: delivery?.deliveredAt ?? null,
  };
}
