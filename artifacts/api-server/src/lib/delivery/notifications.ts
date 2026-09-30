/**
 * Delivery-guarantee notifications (Activity feed + push, via
 * publishNotification). All best-effort: a notification failure never fails
 * the state change that triggered it. Buyer rows open the buyer's order
 * screen (`buyer_order`), seller rows the seller's (`order`).
 */
import { eq } from "drizzle-orm";
import { db, users } from "@workspace/db";
import { publishNotification } from "../../routes/notifications-feed";
import { logger } from "../logger";
import { formatOrderCents } from "../orderNotifications";
import { formatDeadline, warningLabel } from "./policy";

type Notify = Parameters<typeof publishNotification>[0];

async function send(input: Notify): Promise<void> {
  try {
    await publishNotification(input);
  } catch (err) {
    logger.warn({ err, type: input.type, targetId: input.targetId }, "Delivery notification failed");
  }
}

async function timeZoneOf(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db.select({ tz: users.quietHoursTimezone }).from(users)
    .where(eq(users.clerkId, userId)).limit(1);
  return row?.tz ?? null;
}

type OrderRef = { id: string; orderNumber: string; buyerId: string | null; ownerId: string };

export async function notifyBuyerPreparing(order: OrderRef): Promise<void> {
  if (!order.buyerId) return;
  await send({
    userId: order.buyerId, category: "orders", pushCategory: "order",
    type: "order_preparing", title: "The seller is preparing your order",
    body: `Order #${order.orderNumber} is being packed. We'll tell you when it ships.`,
    targetId: order.id, targetType: "buyer_order",
  });
}

export async function notifyBuyerOutForDelivery(order: OrderRef): Promise<void> {
  if (!order.buyerId) return;
  await send({
    userId: order.buyerId, category: "orders", pushCategory: "order",
    type: "order_out_for_delivery", title: "Your package is arriving today",
    body: `Order #${order.orderNumber} is out for delivery today.`,
    targetId: order.id, targetType: "buyer_order",
  });
}

export async function notifyBuyerDelivered(order: OrderRef, partial: boolean): Promise<void> {
  if (!order.buyerId) return;
  await send({
    userId: order.buyerId, category: "orders", pushCategory: "order",
    type: "order_delivered", title: partial ? "Part of your order was delivered" : "Your order was delivered!",
    body: partial
      ? `Some items in order #${order.orderNumber} were delivered. The rest are still on the way.`
      : `Order #${order.orderNumber} has been delivered.`,
    targetId: order.id, targetType: "buyer_order",
  });
}

export async function notifyAutoRefunded(order: OrderRef & { refundedCents: number; partial: boolean; windowDays: number }): Promise<void> {
  const amount = formatOrderCents(order.refundedCents);
  if (order.buyerId) {
    await send({
      userId: order.buyerId, category: "orders", pushCategory: "order",
      type: "order_auto_refunded", title: `You've been refunded ${amount}`,
      body: order.partial
        ? `Some items in order #${order.orderNumber} weren't delivered within ${order.windowDays} days, so ${amount} is on its way back to your original payment method.`
        : `Order #${order.orderNumber} wasn't delivered within ${order.windowDays} days, so ${amount} is on its way back to your original payment method.`,
      targetId: order.id, targetType: "buyer_order",
    });
  }
  await send({
    userId: order.ownerId, category: "orders",
    type: "order_auto_refunded_seller", title: `Order #${order.orderNumber} was auto-refunded`,
    body: `It wasn't delivered within ${order.windowDays} days, so the buyer was refunded ${amount}. You can no longer ship it.`,
    targetId: order.id, targetType: "order",
  });
}

export async function notifySellerDeadlineWarning(order: OrderRef & { deliverBy: Date }, level: number): Promise<void> {
  const tz = await timeZoneOf(order.ownerId);
  await send({
    userId: order.ownerId, category: "orders", pushCategory: "order",
    type: "order_refund_warning",
    title: `Order #${order.orderNumber} will be auto-refunded in ${warningLabel(level)}`,
    body: `Ship and add tracking or this order will be auto-refunded. It must be delivered by ${formatDeadline(order.deliverBy, tz)}.`,
    targetId: order.id, targetType: "order", cta: "Add tracking",
  });
}

export async function notifyBuyerDisputePaused(order: OrderRef): Promise<void> {
  if (!order.buyerId) return;
  await send({
    userId: order.buyerId, category: "orders",
    type: "order_refund_paused", title: "Automatic refund paused",
    body: `Order #${order.orderNumber} has an open payment dispute. We'll resume the delivery guarantee when it closes.`,
    targetId: order.id, targetType: "buyer_order",
  });
}
