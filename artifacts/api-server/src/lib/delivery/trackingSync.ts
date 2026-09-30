/**
 * Carrier tracking → order state.
 *
 * Two inputs feed the same applyCarrierTracking():
 *  - Shippo `track_updated` webhooks (routes/webhooks-shippo.ts), and
 *  - an hourly poll of every shipped, undelivered order — the safety net for
 *    a missed webhook and for numbers Shippo never pushed (a seller-typed
 *    number Shippo couldn't register). The auto-refund sweep also polls an
 *    order one last time before refunding it.
 *
 * Shippo is reached through the connector proxy (lib/shippo.ts), so its API
 * key never leaves the server.
 */
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, orderItems, orders } from "@workspace/db";
import { getTrack, registerTrack, shippoCarrierToken, type ShippoTrack, type ShippoTrackStatus } from "../shippo";
import { logger } from "../logger";
import { applyCarrierTracking, effectiveTrackingNumber, type TrackingEvent, type TrackingStatus } from "./deliveryState";

export function mapShippoStatus(status: string | undefined, details?: string | null): TrackingStatus | null {
  switch ((status ?? "").toUpperCase()) {
    case "PRE_TRANSIT": return "accepted";
    case "TRANSIT": return /out for delivery/i.test(details ?? "") ? "out_for_delivery" : "in_transit";
    case "DELIVERED": return "delivered";
    case "RETURNED": return "returned_to_sender";
    case "FAILURE": return "exception";
    default: return null;
  }
}

function locationLabel(location: ShippoTrackStatus["location"]): string | null {
  const parts = [location?.city, location?.state, location?.country].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function eventsFromShippo(track: Pick<ShippoTrack, "tracking_history" | "tracking_status">): TrackingEvent[] {
  const all = [...(track.tracking_history ?? []), ...(track.tracking_status ? [track.tracking_status] : [])];
  const events: TrackingEvent[] = [];
  for (const entry of all) {
    const status = mapShippoStatus(entry.status, entry.status_details);
    const occurredAt = entry.status_date ? new Date(entry.status_date) : null;
    if (!status || !occurredAt || Number.isNaN(occurredAt.valueOf())) continue;
    events.push({
      status,
      description: entry.status_details?.trim() || defaultDescription(status),
      location: locationLabel(entry.location),
      occurredAt,
    });
  }
  return events;
}

function defaultDescription(status: TrackingStatus): string {
  return ({
    label_created: "Label created", accepted: "Carrier has the shipping information", in_transit: "In transit",
    out_for_delivery: "Out for delivery", delivered: "Delivered", exception: "Delivery exception",
    returned_to_sender: "Returning to sender",
  } as const)[status];
}

/** YYYY-MM-DD from a Shippo ETA (an ISO timestamp), or null. */
export function etaDate(eta: string | null | undefined): string | null {
  if (!eta) return null;
  const d = new Date(eta);
  return Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10);
}

/** Applies one Shippo tracking payload (webhook `data` or GET /tracks result) to an order. */
export async function applyShippoTrack(orderId: string, trackingNumber: string, track: ShippoTrack): Promise<boolean> {
  const status = mapShippoStatus(track.tracking_status?.status, track.tracking_status?.status_details);
  if (!status) return false;
  const at = track.tracking_status?.status_date ? new Date(track.tracking_status.status_date) : undefined;
  const result = await applyCarrierTracking({
    orderId,
    trackingNumber,
    status,
    events: eventsFromShippo(track),
    estimatedDelivery: etaDate(track.eta),
    at: at && !Number.isNaN(at.valueOf()) ? at : undefined,
  });
  return result.applied;
}

export type TrackFetcher = (carrierToken: string, trackingNumber: string) => Promise<ShippoTrack>;

/** Polls every distinct tracking number on the order. Never throws for one bad number. */
export async function syncOrderTracking(orderId: string, fetchTrack: TrackFetcher = getTrack): Promise<void> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const numbers = new Map<string, string | null>();
  for (const item of items) {
    if (item.deliveredAt || item.refundedAt) continue;
    const number = effectiveTrackingNumber(item, order, items);
    if (number) numbers.set(number, item.carrier ?? order.carrier);
  }
  for (const [number, carrier] of numbers) {
    const token = shippoCarrierToken(carrier);
    if (!token) continue; // unknown carrier: rely on webhook / buyer confirmation
    try {
      await applyShippoTrack(orderId, number, await fetchTrack(token, number));
    } catch (err) {
      logger.warn({ err, orderId, carrier: token }, "Tracking poll failed for one number");
    }
  }
  await db.update(orders).set({ trackingPolledAt: new Date() }).where(eq(orders.id, orderId));
}

/** Hourly: poll shipped, undelivered, guaranteed orders that haven't been polled for an hour. */
export async function pollShippedOrders(options: { now?: Date; limit?: number; fetchTrack?: TrackFetcher } = {}): Promise<number> {
  const now = options.now ?? new Date();
  const due = await db.select({ id: orders.id }).from(orders).where(and(
    sql`${orders.deliverBy} IS NOT NULL`,
    eq(orders.status, "shipped"),
    isNull(orders.deliveredAt),
    or(isNull(orders.trackingPolledAt), lt(orders.trackingPolledAt, new Date(now.valueOf() - 3_600_000))),
  )).orderBy(asc(orders.trackingPolledAt)).limit(options.limit ?? 100);
  for (const { id } of due) await syncOrderTracking(id, options.fetchTrack);
  return due.length;
}

/** Best effort: ask Shippo to push updates for a seller-typed tracking number. */
export async function registerTrackingWithCarrier(orderId: string, carrier: string | null, trackingNumber: string): Promise<void> {
  const token = shippoCarrierToken(carrier);
  if (!token) return;
  try {
    await registerTrack(token, trackingNumber, `brandthread-order/${orderId}`);
  } catch (err) {
    logger.warn({ err, orderId }, "Could not register tracking with the carrier API; the hourly poll covers it");
  }
}
