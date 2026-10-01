/**
 * Shippo tracking webhook — moves an order's tracking status (and, when the
 * carrier confirms transit/delivery, its order status) through
 * lib/delivery/deliveryState.ts, the same path the hourly poll uses. A
 * carrier "delivered" is what makes an order delivered (and starts the
 * seller's payout clock). Idempotent: each (transaction, status, scan time)
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
import { db, orderItems, orders, shippingLabels, shippoWebhookEvents, users } from "@workspace/db";
import { applyShippoTrack, mapShippoStatus } from "../lib/delivery/trackingSync";
import type { ShippoTrack } from "../lib/shippo";
import { sendOrderShippingEmail } from "../lib/brandthreadEmail";
import { logger } from "../lib/logger";

const router = Router();

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

  const mapped = mapShippoStatus(shippoStatus, data.tracking_status?.status_details);
  if (!mapped || (!transactionId && !data.tracking_number)) {
    // Unrecognized or informational-only event (e.g. UNKNOWN) — accept and no-op.
    return void res.status(200).json({ ok: true, ignored: true });
  }

  const trackingNumber = (data.tracking_number as string | undefined) ?? undefined;
  // Each new scan (status_date) is its own event, so later transit and
  // out-for-delivery updates are not swallowed by the first one.
  const statusDate = data.tracking_status?.status_date as string | undefined;
  const dedupeId = `${transactionId ?? `track:${trackingNumber}`}:${mapped}${statusDate ? `:${statusDate}` : ""}`;
  const claimed = await db.insert(shippoWebhookEvents).values({ id: dedupeId, orderId: null })
    .onConflictDoNothing()
    .returning({ id: shippoWebhookEvents.id });
  if (claimed.length === 0) {
    return void res.status(200).json({ ok: true, duplicate: true });
  }

  try {
    const labelId = labelIdFromMetadata(metadata);
    let orderId: string | null = null;
    if (labelId) {
      const [label] = await db.select({ orderId: shippingLabels.orderId })
        .from(shippingLabels).where(eq(shippingLabels.id, labelId)).limit(1);
      if (label) orderId = label.orderId;
    }
    if (!orderId && typeof metadata === "string") {
      // Seller-typed numbers are registered with `brandthread-order/<orderId>` (lib/delivery/trackingSync.ts).
      const match = metadata.match(/^brandthread-order\/([0-9a-f-]{36})$/i);
      if (match) orderId = match[1];
    }
    if (!orderId && trackingNumber) {
      // Fall back to a tracking-number match when metadata is missing/unrecognized.
      const [order] = await db.select({ id: orders.id }).from(orders)
        .where(eq(orders.trackingNumber, trackingNumber)).limit(1);
      if (order) orderId = order.id;
      if (!orderId) {
        const [item] = await db.select({ orderId: orderItems.orderId }).from(orderItems)
          .where(eq(orderItems.trackingNumber, trackingNumber)).limit(1);
        if (item) orderId = item.orderId;
      }
    }
    if (!orderId) {
      logger.warn({ transactionId }, "Shippo webhook: could not resolve an order for this tracking update");
      return void res.status(200).json({ ok: true, unresolved: true });
    }

    // One code path for webhook and poll: scan history, statuses, ETA,
    // delivery (which starts the seller's payout clock) and the buyer alerts.
    const [before] = await db.select({ status: orders.status, trackingNumber: orders.trackingNumber }).from(orders)
      .where(eq(orders.id, orderId)).limit(1);
    const applied = await applyShippoTrack(
      orderId,
      trackingNumber ?? before?.trackingNumber ?? (transactionId as string),
      data as ShippoTrack,
    );
    if (!applied) return void res.status(200).json({ ok: true, unresolved: true });

    const [updated] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
    // The "your order shipped" email, once, when the carrier first confirms transit.
    if (updated && (mapped === "in_transit" || mapped === "accepted") && before?.status !== "shipped") {
      void notifyOrderShipped(updated).catch((err) => {
        logger.error({ err, orderId: updated.id }, "Shippo webhook: shipping email delivery failed");
      });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    logger.error({ err, transactionId }, "Shippo webhook processing failed");
    res.status(200).json({ ok: true, error: "processing_failed" }); // Ack so Shippo doesn't hammer retries; the hourly tracking poll covers gaps.
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
