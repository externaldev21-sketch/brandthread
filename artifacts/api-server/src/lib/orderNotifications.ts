/**
 * Order-lifecycle Activity notifications that had no row before (item 79):
 *
 *   buyer  · order_confirmed          — paid checkout created the order
 *                                       (mirror of the seller's existing
 *                                       new_order_received, same webhook)
 *   buyer  · order_cancelled          — buyer cancelled it themselves, or an
 *                                       item sold out mid-payment and it was
 *                                       auto-refunded
 *   seller · order_cancelled_by_buyer — mirror of the buyer's own cancel
 *
 * Every other transition already publishes (routes/orders.ts status and
 * tracking changes, webhooks-shippo/-shopify, dropLifecycle, returns). Copy
 * uses the same "Order #<orderNumber>" / "$12.34" format as those. Buyer rows
 * target `buyer_order` so a tap opens the buyer's order screen, never the
 * seller's. All best-effort: a notification failure never fails the order
 * operation that triggered it.
 */
import { publishNotification } from "../routes/notifications-feed";
import { actorFieldsFromProfile } from "./activityEvents";
import { profilesById } from "./safety";
import { logger } from "./logger";

export const formatOrderCents = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

export async function notifyBuyerOrderConfirmed(input: {
  buyerId: string;
  orderId: string;
  orderNumber: string;
  totalCents: number;
  targetImageUrl?: string | null;
}): Promise<void> {
  try {
    await publishNotification({
      userId: input.buyerId,
      category: "orders",
      type: "order_confirmed",
      title: "Order confirmed",
      body: `Order #${input.orderNumber} for ${formatOrderCents(input.totalCents)} is confirmed. We'll let you know when it ships.`,
      targetId: input.orderId,
      targetType: "buyer_order",
      targetImageUrl: input.targetImageUrl ?? null,
    });
  } catch (err) {
    logger.warn({ err, orderId: input.orderId }, "Order confirmed notification failed");
  }
}

export async function notifyBuyerOrderCancelled(input: {
  buyerId: string;
  orderId: string;
  orderNumber: string;
  refundedCents: number;
  reason: "buyer_cancelled" | "sold_out";
}): Promise<void> {
  const refund = input.refundedCents > 0
    ? ` Your refund of ${formatOrderCents(input.refundedCents)} is on its way.`
    : "";
  const copy = input.reason === "sold_out"
    ? {
      title: "Order cancelled: item sold out",
      body: `An item in order #${input.orderNumber} sold out while you were paying, so the order was cancelled.${refund}`,
    }
    : { title: "Order cancelled", body: `You cancelled order #${input.orderNumber}.${refund}` };
  try {
    await publishNotification({
      userId: input.buyerId,
      category: "orders",
      type: "order_cancelled",
      ...copy,
      targetId: input.orderId,
      targetType: "buyer_order",
    });
  } catch (err) {
    logger.warn({ err, orderId: input.orderId }, "Order cancelled notification failed");
  }
}

/** The seller hears when a buyer cancels — the buyer is the row's actor. */
export async function notifySellerOrderCancelledByBuyer(input: {
  sellerId: string;
  buyerId: string;
  orderId: string;
  orderNumber: string;
  refundedCents: number;
}): Promise<void> {
  try {
    const profile = (await profilesById([input.buyerId])).get(input.buyerId);
    const actor = profile && !profile.deleted && !profile.suspended ? actorFieldsFromProfile(profile) : null;
    const who = actor?.actorName ?? "A buyer";
    const refund = input.refundedCents > 0 ? ` ${formatOrderCents(input.refundedCents)} was refunded.` : "";
    await publishNotification({
      userId: input.sellerId,
      category: "orders",
      type: "order_cancelled_by_buyer",
      title: `${who} cancelled order #${input.orderNumber}`,
      body: `The items were restocked.${refund}`,
      ...(actor ?? {}),
      targetId: input.orderId,
      targetType: "order",
    });
  } catch (err) {
    logger.warn({ err, orderId: input.orderId }, "Seller order-cancelled notification failed");
  }
}
