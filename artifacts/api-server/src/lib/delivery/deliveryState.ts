/**
 * Delivery-guarantee state changes against the database:
 *
 *  - stampDeliveryDeadlines  when a payment is captured: per-item and
 *    per-order deliver_by (15 / 60 days), pre-order flag, promised ship date.
 *  - recordDelivery          carrier says delivered, or the buyer confirms.
 *    The ONLY way an order becomes "delivered"; sellers cannot.
 *  - applyCarrierTracking    a tracking update (Shippo webhook or poll):
 *    scan history, statuses, ETA, buyer notifications.
 *  - shipItems               the seller ships part of an order separately.
 *
 * Every function is idempotent: a replayed webhook, a second poll or two
 * servers racing change nothing the second time.
 */
import { notifySellerOrderDelivered } from "../sellerMoneyNotifications";
import { payoutHoldApplies } from "./payoutGate";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, drops, orderItems, orderTrackingEvents, orders, productVariants, products } from "@workspace/db";
import type { DbExecutor } from "../money/ledger";
import { orderStatusMachine } from "../money/stateMachines";
import { logger } from "../logger";
import { computeDeliverBy, computePayoutReleaseAt } from "./policy";
import {
  notifyBuyerDelivered, notifyBuyerOutForDelivery,
} from "./notifications";
import { publishNotification } from "../../routes/notifications-feed";

// ─── At purchase ──────────────────────────────────────────────────────────────

/**
 * Stamps the deadlines on a freshly paid order. Call inside the order
 * transaction, after the order items exist. A no-op if already stamped.
 */
export async function stampDeliveryDeadlines(executor: DbExecutor, orderId: string, paidAt: Date): Promise<void> {
  const [existing] = await executor.select({ deliverBy: orders.deliverBy }).from(orders)
    .where(eq(orders.id, orderId)).limit(1);
  if (!existing || existing.deliverBy) return;

  const items = await executor.select({
    id: orderItems.id,
    productPreorder: products.isPreOrder,
    productShipDate: products.preOrderEstShipDate,
    dropType: drops.type,
    dropShipDate: drops.estimatedShipDate,
  }).from(orderItems)
    .leftJoin(productVariants, eq(productVariants.id, orderItems.variantId))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(drops, eq(drops.id, products.dropId))
    .where(eq(orderItems.orderId, orderId));
  if (items.length === 0) return;

  const preorderIds: string[] = [];
  const regularIds: string[] = [];
  let promisedShip: Date | null = null;
  for (const item of items) {
    if (item.productPreorder || item.dropType === "pre-order") {
      preorderIds.push(item.id);
      const ship = item.productShipDate ?? item.dropShipDate;
      if (ship && (!promisedShip || ship > promisedShip)) promisedShip = ship;
    } else {
      regularIds.push(item.id);
    }
  }
  if (preorderIds.length) {
    await executor.update(orderItems)
      .set({ isPreorder: true, deliverBy: computeDeliverBy(paidAt, true) })
      .where(inArray(orderItems.id, preorderIds));
  }
  if (regularIds.length) {
    await executor.update(orderItems)
      .set({ isPreorder: false, deliverBy: computeDeliverBy(paidAt, false) })
      .where(inArray(orderItems.id, regularIds));
  }
  await executor.update(orders).set({
    isPreorder: preorderIds.length > 0,
    promisedShipDate: promisedShip,
    // Earliest item deadline; refreshed as items are delivered/refunded.
    deliverBy: computeDeliverBy(paidAt, regularIds.length === 0),
    updatedAt: new Date(),
  }).where(eq(orders.id, orderId));
}

/** orders.deliver_by = the earliest deadline still open (undelivered, unrefunded items). */
export async function refreshOrderDeadline(executor: DbExecutor, orderId: string): Promise<void> {
  await executor.execute(sql`
    UPDATE orders o SET deliver_by = COALESCE(
      (SELECT min(i.deliver_by) FROM order_items i
        WHERE i.order_id = o.id AND i.delivered_at IS NULL AND i.refunded_at IS NULL),
      o.deliver_by)
    WHERE o.id = ${orderId}::uuid AND o.deliver_by IS NOT NULL
  `);
}

/**
 * The tracking number that covers an item. Items carry their own tracking
 * once any part of the order ships; the order's tracking number is only a
 * headline copy then (the first shipment). Orders from before item-level
 * tracking have no item tracking at all, and the order's covers everything.
 */
export function effectiveTrackingNumber(
  item: { trackingNumber: string | null },
  order: { trackingNumber: string | null },
  allItems: Array<{ trackingNumber: string | null }>,
): string | null {
  if (item.trackingNumber) return item.trackingNumber;
  return allItems.some((i) => i.trackingNumber) ? null : order.trackingNumber;
}

// ─── Delivered ────────────────────────────────────────────────────────────────

export type DeliveryResult = {
  found: boolean;
  /** At least one item newly became delivered. */
  changed: boolean;
  /** Every item that has not been refunded is now delivered. */
  allDelivered: boolean;
  blocked?: "cancelled" | "no_match";
};

/**
 * Marks items delivered. `trackingNumber` given → only the items that
 * tracking number covers (an item's own tracking, else the order's). Omitted
 * (buyer confirms receipt) → every undelivered, unrefunded item.
 */
export async function recordDelivery(input: {
  orderId: string;
  source: "carrier" | "buyer";
  at?: Date;
  trackingNumber?: string | null;
}): Promise<DeliveryResult> {
  const at = input.at ?? new Date();
  const outcome = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, input.orderId)).for("update");
    if (!order) return { result: { found: false, changed: false, allDelivered: false } as DeliveryResult, order: null };
    if (order.status === "cancelled" || order.status === "refund_pending") {
      return { result: { found: true, changed: false, allDelivered: false, blocked: "cancelled" } as DeliveryResult, order };
    }
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const live = items.filter((item) => !item.refundedAt);
    // The webhook/poll resolved this order itself (by label metadata or a
    // tracking-number match), so an order with no tracking number of its own
    // and no per-item shipments is covered in full by whatever it reports.
    const coversAll = !items.some((item) => item.trackingNumber) && !order.trackingNumber;
    const covered = live.filter((item) =>
      !item.deliveredAt
      && (!input.trackingNumber || coversAll || effectiveTrackingNumber(item, order, items) === input.trackingNumber));

    if (covered.length > 0) {
      await tx.update(orderItems).set({ deliveredAt: at, trackingStatus: "delivered" })
        .where(inArray(orderItems.id, covered.map((item) => item.id)));
    }
    const coveredIds = new Set(covered.map((item) => item.id));
    // An order with no item rows (created by hand) is one unit.
    const itemless = items.length === 0;
    const allDelivered = itemless || (live.length > 0 && live.every((item) => item.deliveredAt || coveredIds.has(item.id)));

    if (allDelivered && !order.deliveredAt) {
      await tx.update(orders).set({
        status: "delivered",
        trackingStatus: "delivered",
        deliveredAt: at,
        deliveryConfirmedBy: input.source,
        payoutReleaseAt: computePayoutReleaseAt(at),
        updatedAt: new Date(),
      }).where(eq(orders.id, order.id));
    } else if (covered.length > 0) {
      await refreshOrderDeadline(tx, order.id);
    }
    const blocked = covered.length === 0 && !allDelivered ? "no_match" as const : undefined;
    const changed = covered.length > 0 || (itemless && !order.deliveredAt);
    return {
      result: { found: true, changed, allDelivered, ...(blocked ? { blocked } : {}) } as DeliveryResult,
      order,
    };
  });

  if (outcome.order && outcome.result.changed) {
    await notifyBuyerDelivered(outcome.order, !outcome.result.allDelivered).catch(() => {});
    if (outcome.result.allDelivered && !outcome.order.deliveredAt) {
      // The seller hears it too: delivery is what starts their payout clock.
      await notifySellerOrderDelivered({
        sellerId: outcome.order.ownerId,
        orderId: outcome.order.id,
        orderNumber: outcome.order.orderNumber,
        payoutReleaseAt: payoutHoldApplies(outcome.order) ? computePayoutReleaseAt(at) : null,
        byBuyer: input.source === "buyer",
      }).catch(() => {});
    }
    logger.info({ orderId: input.orderId, source: input.source, allDelivered: outcome.result.allDelivered }, "Order delivery recorded");
  }
  return outcome.result;
}

/**
 * After some items were refunded, the order may be left with only delivered
 * items: it is then delivered as a whole (and the seller's payout clock
 * starts). Call inside the refund's transaction.
 */
export async function finalizeIfAllDelivered(executor: DbExecutor, orderId: string): Promise<boolean> {
  const [order] = await executor.select({ deliveredAt: orders.deliveredAt, status: orders.status }).from(orders)
    .where(eq(orders.id, orderId)).limit(1);
  if (!order || order.deliveredAt || order.status === "cancelled") return false;
  const items = await executor.select({ deliveredAt: orderItems.deliveredAt, refundedAt: orderItems.refundedAt })
    .from(orderItems).where(eq(orderItems.orderId, orderId));
  const live = items.filter((item) => !item.refundedAt);
  if (live.length === 0 || live.some((item) => !item.deliveredAt)) return false;
  const at = new Date(Math.max(...live.map((item) => item.deliveredAt!.valueOf())));
  await executor.update(orders).set({
    status: "delivered", trackingStatus: "delivered", deliveredAt: at, deliveryConfirmedBy: "carrier",
    payoutReleaseAt: computePayoutReleaseAt(at), updatedAt: new Date(),
  }).where(eq(orders.id, orderId));
  return true;
}

// ─── Carrier tracking updates ─────────────────────────────────────────────────

export type TrackingStatus =
  | "label_created" | "accepted" | "in_transit" | "out_for_delivery" | "delivered" | "exception" | "returned_to_sender";

export type TrackingEvent = {
  status: TrackingStatus;
  description: string;
  location: string | null;
  occurredAt: Date;
};

export async function applyCarrierTracking(input: {
  orderId: string;
  trackingNumber: string;
  status: TrackingStatus;
  events?: TrackingEvent[];
  /** YYYY-MM-DD carrier estimate. */
  estimatedDelivery?: string | null;
  at?: Date;
}): Promise<{ applied: boolean }> {
  const at = input.at ?? new Date();
  const [before] = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  if (!before) return { applied: false };

  if (input.events?.length) {
    await db.insert(orderTrackingEvents).values(input.events.map((event) => ({
      orderId: input.orderId,
      trackingNumber: input.trackingNumber,
      status: event.status,
      description: event.description.slice(0, 500),
      location: event.location?.slice(0, 200) ?? null,
      occurredAt: event.occurredAt,
    }))).onConflictDoNothing();
  }
  if (before.status === "cancelled" || before.status === "refund_pending") return { applied: false };

  if (input.status === "delivered") {
    // Only the status the carrier reports for the newest scan can deliver.
    await recordDelivery({ orderId: input.orderId, source: "carrier", at, trackingNumber: input.trackingNumber });
    return { applied: true };
  }

  const isPrimary = !before.trackingNumber || before.trackingNumber === input.trackingNumber;
  const movedToShipped = ["accepted", "in_transit", "out_for_delivery"].includes(input.status);
  const preShipment = orderStatusMachine.sourcesOf("shipped").filter((s) => s !== "label_purchasing");

  await db.transaction(async (tx) => {
    if (isPrimary) {
      await tx.update(orders).set({
        trackingStatus: input.status,
        ...(input.estimatedDelivery ? { estimatedDelivery: input.estimatedDelivery } : {}),
        updatedAt: new Date(),
      }).where(eq(orders.id, input.orderId));
    }
    await tx.update(orderItems).set({ trackingStatus: input.status })
      .where(and(eq(orderItems.orderId, input.orderId), eq(orderItems.trackingNumber, input.trackingNumber), isNull(orderItems.deliveredAt)));
    if (movedToShipped) {
      await tx.update(orders).set({ status: "shipped", shippedAt: before.shippedAt ?? at, updatedAt: new Date() })
        .where(and(eq(orders.id, input.orderId), inArray(orders.status, preShipment)));
    }
  });

  const changed = isPrimary && before.trackingStatus !== input.status;
  if (changed && input.status === "out_for_delivery") {
    await notifyBuyerOutForDelivery(before).catch(() => {});
  }
  if (changed && before.buyerId && (input.status === "exception" || input.status === "returned_to_sender")) {
    await publishNotification({
      userId: before.buyerId, category: "orders", pushCategory: "order",
      type: input.status === "exception" ? "order_exception" : "order_returned_to_sender",
      title: input.status === "exception" ? "Delivery problem with your order" : "Your package is being returned",
      body: input.status === "exception"
        ? `Order #${before.orderNumber} has a delivery exception. Check the tracking details or contact the seller.`
        : `Order #${before.orderNumber} is being returned to the sender. Contact the seller for help.`,
      targetId: before.id, targetType: "buyer_order",
    }).catch(() => {});
  }
  return { applied: true };
}

// ─── Partial shipments ───────────────────────────────────────────────────────

export type ShipItemsResult =
  | { ok: true; shippedItemIds: string[]; buyerId: string | null; orderNumber: string }
  | { ok: false; status: number; code: string; message: string };

export async function shipItems(input: {
  orderId: string;
  ownerId: string;
  itemIds: string[];
  trackingNumber: string;
  carrier: string | null;
}): Promise<ShipItemsResult> {
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.ownerId, input.ownerId))).for("update");
    if (!order) return { ok: false, status: 404, code: "NOT_FOUND", message: "Not found" } as const;
    if (order.autoRefundedAt) {
      return { ok: false, status: 409, code: "AUTO_REFUNDED", message: "This order was refunded because it wasn't delivered in time, so it can no longer be shipped." } as const;
    }
    if (["cancelled", "refund_pending", "label_purchasing", "delivered"].includes(order.status)) {
      return { ok: false, status: 409, code: "ILLEGAL_STATUS_TRANSITION", message: `An order that is ${order.status} cannot be shipped.` } as const;
    }
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    const byId = new Map(items.map((item) => [item.id, item]));
    const chosen = [...new Set(input.itemIds)].map((id) => byId.get(id));
    if (chosen.length === 0 || chosen.some((item) => !item)) {
      return { ok: false, status: 400, code: "INVALID_ITEMS", message: "Choose items that belong to this order." } as const;
    }
    const usable = chosen as typeof items;
    if (usable.some((item) => item.refundedAt || item.deliveredAt)) {
      return { ok: false, status: 409, code: "ITEM_NOT_SHIPPABLE", message: "An item you chose was already refunded or delivered." } as const;
    }
    const now = new Date();
    await tx.update(orderItems).set({
      trackingNumber: input.trackingNumber, carrier: input.carrier, shippedAt: now, trackingStatus: "accepted",
    }).where(inArray(orderItems.id, usable.map((item) => item.id)));
    await tx.update(orders).set({
      status: "shipped",
      shippedAt: order.shippedAt ?? now,
      // The first shipment doubles as the order's headline tracking.
      ...(order.trackingNumber ? {} : { trackingNumber: input.trackingNumber, carrier: input.carrier, trackingStatus: "accepted" }),
      updatedAt: now,
    }).where(eq(orders.id, order.id));
    return { ok: true, shippedItemIds: usable.map((item) => item.id), buyerId: order.buyerId, orderNumber: order.orderNumber } as const;
  });
}
