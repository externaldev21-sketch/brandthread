/**
 * Live order info for 'order' message attachments (chat order card — item
 * 71). An order card's title/status are cached on the message attachment at
 * send time (see attachLinkedOrder() in app/seller-conversation.tsx and the
 * "order" attachment branch in routes/conversations.ts), which would go
 * stale the moment the order's status changes — a seller marking an order
 * shipped after sending the card must not leave the buyer looking at a
 * permanently "Processing" bubble. This module re-resolves the CURRENT
 * status/tracking state for every 'order' attachment on every read, the
 * same way lib/productAttachmentInfo.ts (item 70) keeps product cards live.
 *
 * Unlike a product, an order is never "deleted" from the buyer's own
 * history — a gone/unrecognized order id just renders the last-known title
 * with no status badge or Track action, an honest degrade rather than a
 * fabricated "not found" card.
 */
import { inArray } from "drizzle-orm";
import { db, orders } from "@workspace/db";

export interface OrderAttachmentInfo {
  orderNumber: string;
  /** Raw DB status column, e.g. 'pending' | 'processing' | 'fulfilled' |
   *  'shipped' | 'delivered' | 'cancelled' | 'refunded' | 'refund_pending' |
   *  'disputed'. The mobile client maps this the same way order list/detail
   *  screens do — see lib/orderStatusAdapter.ts's dbStatusToOrderStatus. */
  status: string;
  trackingNumber: string | null;
  carrier: string | null;
  trackingStatus: string | null;
  estimatedDelivery: string | null;
}

/** Fetch live status/tracking for a set of order IDs. */
export async function fetchOrderAttachmentInfo(orderIds: string[]): Promise<Map<string, OrderAttachmentInfo>> {
  const result = new Map<string, OrderAttachmentInfo>();
  const ids = [...new Set(orderIds)].filter(Boolean);
  if (ids.length === 0) return result;

  const rows = await db.select({
    id: orders.id,
    orderNumber: orders.orderNumber,
    status: orders.status,
    trackingNumber: orders.trackingNumber,
    carrier: orders.carrier,
    trackingStatus: orders.trackingStatus,
    estimatedDelivery: orders.estimatedDelivery,
  }).from(orders).where(inArray(orders.id, ids));

  for (const o of rows) {
    result.set(o.id, {
      orderNumber: o.orderNumber,
      status: o.status,
      trackingNumber: o.trackingNumber ?? null,
      carrier: o.carrier ?? null,
      trackingStatus: o.trackingStatus ?? null,
      estimatedDelivery: o.estimatedDelivery ?? null,
    });
  }
  // Orders missing from `rows` entirely (hard-deleted / bad id) are simply
  // absent from the map — callers keep whatever title was cached and drop
  // the status badge/Track action rather than fabricate anything.

  return result;
}

/** Mutates a single 'order' MessageAttachment-shaped object in place, if
 *  present, replacing its cached title/subtitle with the order's current
 *  number/status and filling `meta` with everything the client needs to
 *  render a status badge and a working Track action without a second
 *  fetch. */
export function applyOrderAttachmentInfo(attachment: any, infoByOrderId: Map<string, OrderAttachmentInfo>): void {
  if (!attachment || typeof attachment !== "object" || attachment.type !== "order") return;
  const orderId = attachment.meta?.orderId;
  if (!orderId) return;
  const info = infoByOrderId.get(orderId);
  attachment.meta = { ...(attachment.meta ?? {}), orderId };
  if (!info) {
    // Order id not resolvable any more — keep the last-known title, drop
    // any stale status so the client doesn't render a badge/Track action
    // for data it can no longer confirm.
    delete attachment.meta.status;
    delete attachment.meta.trackingNumber;
    delete attachment.meta.carrier;
    delete attachment.meta.trackingStatus;
    delete attachment.meta.estimatedDelivery;
    return;
  }
  attachment.title = `Order #${info.orderNumber}`;
  attachment.meta.status = info.status;
  if (info.trackingNumber) attachment.meta.trackingNumber = info.trackingNumber; else delete attachment.meta.trackingNumber;
  if (info.carrier) attachment.meta.carrier = info.carrier; else delete attachment.meta.carrier;
  if (info.trackingStatus) attachment.meta.trackingStatus = info.trackingStatus; else delete attachment.meta.trackingStatus;
  if (info.estimatedDelivery) attachment.meta.estimatedDelivery = info.estimatedDelivery; else delete attachment.meta.estimatedDelivery;
}

/** Collects every 'order' attachment's orderId across a page of adapted
 *  messages (checks both the primary `attachment` and the `attachments`
 *  array), fetches live info once, and enriches every one of them in
 *  place. */
export async function enrichOrderAttachments(adaptedMessages: { attachment?: any; attachments?: any[] }[]): Promise<void> {
  const orderIds: string[] = [];
  for (const m of adaptedMessages) {
    if (m.attachment?.type === "order" && m.attachment.meta?.orderId) orderIds.push(m.attachment.meta.orderId);
    for (const a of m.attachments ?? []) {
      if (a?.type === "order" && a.meta?.orderId) orderIds.push(a.meta.orderId);
    }
  }
  if (orderIds.length === 0) return;
  const infoByOrderId = await fetchOrderAttachmentInfo(orderIds);
  for (const m of adaptedMessages) {
    if (m.attachment) applyOrderAttachmentInfo(m.attachment, infoByOrderId);
    for (const a of m.attachments ?? []) applyOrderAttachmentInfo(a, infoByOrderId);
  }
}
