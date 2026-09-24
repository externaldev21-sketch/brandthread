/**
 * Shippo tracking webhook — moves an order's tracking status (and, when the
 * carrier confirms transit/delivery, its order status) using the same
 * TRACKING_STATUSES vocabulary and buyer-notification shapes as
 * PATCH /api/orders/:id/tracking. Idempotent: each (transaction, status)
 * delivery is claimed once in `shippo_webhook_events`, so a retried or
 * duplicate delivery from the carrier is a no-op.
 *
 * TODO(signature verification): Shippo signs webhook deliveries with a
 * per-webhook-endpoint secret configured in the Shippo dashboard, but this
 * repo has no such secret provisioned (Shippo is only ever called outbound,
 * through `lib/shippo.ts`'s ReplitConnectors proxy — there is no existing
 * inbound-webhook credential to reuse). Until SHIPPO_WEBHOOK_SECRET is
 * provisioned and the exact header Shippo signs with is confirmed against
 * their current docs, this handler does a best-effort shared-secret check
 * (a `?secret=` query param or `x-shippo-webhook-secret` header, compared in
 * constant time) and otherwise accepts the payload — never trust this
 * endpoint's input for anything beyond advancing tracking status.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, orders, shippingLabels, shippoWebhookEvents, users } from "@workspace/db";
import { publishNotification } from "./notifications-feed";
import { sendOrderShippingEmail } from "../lib/brandthreadEmail";
import { logger } from "../lib/logger";

const router = Router();

const SHIPPO_STATUS_MAP: Record<string, string> = {
  PRE_TRANSIT: "accepted",
  TRANSIT: "in_transit",
  DELIVERED: "delivered",
  RETURNED: "returned_to_sender",
  FAILURE: "exception",
};

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifySharedSecret(req: any): boolean {
  const configured = process.env.SHIPPO_WEBHOOK_SECRET;
  if (!configured) return true; // Not provisioned yet — see module TODO.
  const provided = (req.headers["x-shippo-webhook-secret"] as string | undefined) ?? (req.query.secret as string | undefined);
  return typeof provided === "string" && timingSafeEqual(provided, configured);
}

/** `brandthread-label/<labelId>` — set as the purchase transaction's metadata in lib/shippo.ts's purchaseTransaction call. */
function labelIdFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "string") return null;
  const match = metadata.match(/^brandthread-label\/([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

router.post("/", async (req, res) => {
  if (!verifySharedSecret(req)) {
    return void res.status(401).json({ error: "Invalid webhook credential" });
  }

  const body = req.body ?? {};
  const data = body.data ?? {};
  const shippoStatus = data.tracking_status?.status as string | undefined;
  const transactionId: string | undefined = data.transaction ?? body.transaction;
  const metadata: unknown = data.metadata ?? body.metadata;

  const mapped = shippoStatus ? SHIPPO_STATUS_MAP[shippoStatus] : undefined;
  if (!mapped || !transactionId) {
    // Unrecognized or informational-only event (e.g. UNKNOWN) — accept and no-op.
    return void res.status(200).json({ ok: true, ignored: true });
  }

  const dedupeId = `${transactionId}:${mapped}`;
  const claimed = await db.insert(shippoWebhookEvents).values({ id: dedupeId, orderId: null })
    .onConflictDoNothing()
    .returning({ id: shippoWebhookEvents.id });
  if (claimed.length === 0) {
    return void res.status(200).json({ ok: true, duplicate: true });
  }

  try {
    const labelId = labelIdFromMetadata(metadata);
    let orderId: string | null = null;
    let ownerId: string | null = null;
    if (labelId) {
      const [label] = await db.select({ orderId: shippingLabels.orderId, ownerId: shippingLabels.ownerId })
        .from(shippingLabels).where(eq(shippingLabels.id, labelId)).limit(1);
      if (label) { orderId = label.orderId; ownerId = label.ownerId; }
    }
    if (!orderId) {
      // Fall back to a tracking-number match when metadata is missing/unrecognized.
      const trackingNumber = data.tracking_number as string | undefined;
      if (trackingNumber) {
        const [order] = await db.select({ id: orders.id, ownerId: orders.ownerId })
          .from(orders).where(eq(orders.trackingNumber, trackingNumber)).limit(1);
        if (order) { orderId = order.id; ownerId = order.ownerId; }
      }
    }
    if (!orderId) {
      logger.warn({ transactionId }, "Shippo webhook: could not resolve an order for this tracking update");
      return void res.status(200).json({ ok: true, unresolved: true });
    }

    const shouldMarkShipped = mapped === "in_transit" || mapped === "accepted";
    const [updated] = await db.update(orders).set({
      trackingStatus: mapped,
      ...(shouldMarkShipped ? { status: "shipped", shippedAt: new Date() } : {}),
      ...(mapped === "delivered" ? { status: "delivered" } : {}),
      updatedAt: new Date(),
    }).where(eq(orders.id, orderId)).returning();
    if (!updated) return void res.status(200).json({ ok: true, unresolved: true });

    const alertMap: Record<string, { type: string; title: string; body: string; targetType: string } | undefined> = {
      delivered: {
        type: "order_delivered", title: "Your order was delivered! 📦",
        body: `Order #${updated.orderNumber} has been delivered.`, targetType: "order",
      },
      exception: {
        type: "order_exception", title: "Delivery problem with your order",
        body: `Order #${updated.orderNumber} has a delivery exception. Check the tracking details or contact the seller.`,
        targetType: "buyer_order",
      },
      returned_to_sender: {
        type: "order_returned_to_sender", title: "Your package is being returned",
        body: `Order #${updated.orderNumber} is being returned to the sender. Contact the seller for help.`,
        targetType: "buyer_order",
      },
    };
    const alert = alertMap[mapped];
    if (alert && updated.buyerId) {
      publishNotification({
        userId: updated.buyerId, category: "orders", pushCategory: "order",
        type: alert.type, title: alert.title, body: alert.body,
        targetId: updated.id, targetType: alert.targetType,
      }).catch(() => { /* non-critical */ });
    }
    if (shouldMarkShipped) {
      void notifyOrderShipped(updated).catch((err) => {
        logger.error({ err, orderId: updated.id }, "Shippo webhook: shipping email delivery failed");
      });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err, transactionId }, "Shippo webhook processing failed");
    res.status(200).json({ ok: true, error: "processing_failed" }); // Ack so Shippo doesn't hammer retries; the sweep/manual review covers gaps.
  }
});

async function notifyOrderShipped(order: {
  id: string; buyerId: string | null; guestEmail: string | null;
  orderNumber: string; trackingNumber: string | null; carrier: string | null;
}): Promise<void> {
  let recipient = order.guestEmail;
  if (order.buyerId) {
    const [buyer] = await db.select({ email: users.email }).from(users)
      .where(eq(users.clerkId, order.buyerId)).limit(1);
    recipient = buyer?.email ?? recipient;
  }
  if (!recipient) {
    logger.warn({ orderId: order.id }, "Shippo webhook: shipping email skipped because recipient is missing");
    return;
  }
  await sendOrderShippingEmail({
    to: recipient,
    orderNumber: order.orderNumber,
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    trackingUpdate: true,
    idempotencyKey: `order-tracking-webhook/${order.id}`,
  }).catch(() => false);
}

export default router;
