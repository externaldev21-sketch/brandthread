/**
 * The buyer-facing `delivery` object on /api/buyer/orders[/:id]
 * (contract: docs/payments/delivery-guarantee.md). Built from the order row,
 * its items and its carrier scan history; contains no seller-only data.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, orderItems, orderTrackingEvents, orders } from "@workspace/db";
import { AUTO_REFUND_LABEL, buildTimeline, type TimelineStep } from "./policy";
import { effectiveTrackingNumber } from "./deliveryState";

export type DeliveryOrderRow = {
  status: string;
  trackingStatus: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  estimatedDelivery: string | null;
  createdAt: Date;
  paidAt: Date | null;
  packedAt?: Date | null;
  shippedAt: Date | null;
  deliverBy: Date | null;
  isPreorder: boolean;
  promisedShipDate: Date | null;
  deliveredAt: Date | null;
  deliveryConfirmedBy: string | null;
  disputePausedAt: Date | null;
  autoRefundedAt: Date | null;
  refundedCents: number;
};

export type DeliveryItemRow = {
  id: string;
  trackingNumber: string | null;
  carrier: string | null;
  trackingStatus: string | null;
  deliveredAt: Date | null;
  refundedAt: Date | null;
  refundedCents: number;
};

export type DeliveryEventRow = {
  status: string;
  description: string;
  location: string | null;
  occurredAt: Date;
};

export function carrierTrackingUrl(carrier: string | null, trackingNumber: string): string {
  const key = (carrier ?? "").toLowerCase();
  const encoded = encodeURIComponent(trackingNumber);
  if (key.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encoded}`;
  if (key.includes("ups")) return `https://www.ups.com/track?tracknum=${encoded}`;
  if (key.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${encoded}`;
  if (key.includes("dhl")) return `https://www.dhl.com/en/express/tracking.html?AWB=${encoded}`;
  return `https://www.google.com/search?q=${encoded}+tracking`;
}

export type BuyerDelivery = {
  deliverBy: string | null;
  isPreorder: boolean;
  promisedShipDate: string | null;
  estimatedDelivery: string | null;
  deliveredAt: string | null;
  deliveryConfirmedBy: "carrier" | "buyer" | null;
  steps: TimelineStep[];
  events: Array<{ status: string; description: string; location: string | null; at: string }>;
  carrier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  canConfirmReceipt: boolean;
  disputePaused: boolean;
  autoRefund: null | { refundedCents: number; refundedAt: string; partial: boolean; label: string };
  shipments: Array<{
    trackingNumber: string; carrier: string | null; trackingStatus: string | null;
    deliveredAt: string | null; itemIds: string[];
  }>;
};

export function buildBuyerDelivery(
  order: DeliveryOrderRow,
  items: DeliveryItemRow[] = [],
  events: DeliveryEventRow[] = [],
): BuyerDelivery {
  const outForDelivery = events.filter((e) => e.status === "out_for_delivery")
    .sort((a, b) => a.occurredAt.valueOf() - b.occurredAt.valueOf())[0];
  const steps = buildTimeline({
    status: order.status,
    trackingStatus: order.trackingStatus,
    orderedAt: order.paidAt ?? order.createdAt,
    preparingAt: order.packedAt ?? order.paidAt ?? order.createdAt,
    shippedAt: order.shippedAt,
    outForDeliveryAt: outForDelivery?.occurredAt ?? null,
    deliveredAt: order.deliveredAt,
  });

  // Separate shipments only when the items really shipped apart.
  const groups = new Map<string, DeliveryItemRow[]>();
  for (const item of items) {
    const number = effectiveTrackingNumber(item, order, items);
    if (!number) continue;
    groups.set(number, [...(groups.get(number) ?? []), item]);
  }
  const shipments = groups.size > 1
    ? [...groups.entries()].map(([trackingNumber, group]) => ({
      trackingNumber,
      carrier: group[0].carrier ?? order.carrier,
      trackingStatus: group.every((i) => i.deliveredAt) ? "delivered" : group[0].trackingStatus,
      deliveredAt: group.every((i) => i.deliveredAt)
        ? new Date(Math.max(...group.map((i) => i.deliveredAt!.valueOf()))).toISOString()
        : null,
      itemIds: group.map((i) => i.id),
    }))
    : [];

  const refundedItemCents = items.reduce((sum, i) => sum + (i.refundedAt ? i.refundedCents : 0), 0);
  const fullyCancelled = order.status === "cancelled";
  const shipped = order.status === "shipped" || ["accepted", "in_transit", "out_for_delivery", "exception"].includes(order.trackingStatus ?? "");
  return {
    deliverBy: order.deliverBy?.toISOString() ?? null,
    isPreorder: order.isPreorder,
    promisedShipDate: order.promisedShipDate?.toISOString() ?? null,
    estimatedDelivery: order.estimatedDelivery,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    deliveryConfirmedBy: order.deliveryConfirmedBy === "buyer" || order.deliveryConfirmedBy === "carrier"
      ? order.deliveryConfirmedBy : null,
    steps,
    events: [...events]
      .sort((a, b) => b.occurredAt.valueOf() - a.occurredAt.valueOf())
      .map((e) => ({ status: e.status, description: e.description, location: e.location, at: e.occurredAt.toISOString() })),
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    trackingUrl: order.trackingNumber ? carrierTrackingUrl(order.carrier, order.trackingNumber) : null,
    canConfirmReceipt: shipped && !order.deliveredAt && !fullyCancelled,
    disputePaused: Boolean(order.disputePausedAt),
    autoRefund: order.autoRefundedAt
      ? {
        refundedCents: refundedItemCents > 0 ? refundedItemCents : order.refundedCents,
        refundedAt: order.autoRefundedAt.toISOString(),
        partial: !fullyCancelled,
        label: AUTO_REFUND_LABEL,
      }
      : null,
    shipments,
  };
}

export async function loadBuyerDelivery(orderId: string, order: DeliveryOrderRow): Promise<BuyerDelivery> {
  const [items, events] = await Promise.all([
    db.select({
      id: orderItems.id, trackingNumber: orderItems.trackingNumber, carrier: orderItems.carrier,
      trackingStatus: orderItems.trackingStatus, deliveredAt: orderItems.deliveredAt,
      refundedAt: orderItems.refundedAt, refundedCents: orderItems.refundedCents,
    }).from(orderItems).where(eq(orderItems.orderId, orderId)),
    db.select({
      status: orderTrackingEvents.status, description: orderTrackingEvents.description,
      location: orderTrackingEvents.location, occurredAt: orderTrackingEvents.occurredAt,
    }).from(orderTrackingEvents).where(eq(orderTrackingEvents.orderId, orderId))
      .orderBy(desc(orderTrackingEvents.occurredAt)).limit(50),
  ]);
  return buildBuyerDelivery(order, items, events);
}

/** Columns every buyer order projection needs to build `delivery`. */
export const deliveryColumns = {
  packedAt: orders.packedAt,
  deliverBy: orders.deliverBy,
  isPreorder: orders.isPreorder,
  promisedShipDate: orders.promisedShipDate,
  deliveredAt: orders.deliveredAt,
  deliveryConfirmedBy: orders.deliveryConfirmedBy,
  disputePausedAt: orders.disputePausedAt,
  autoRefundedAt: orders.autoRefundedAt,
  refundedCents: orders.refundedCents,
};
