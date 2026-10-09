/**
 * Shippo tracking webhook — moves an order's tracking status (and, when the
 * carrier confirms transit/delivery, its order status) through
 * lib/delivery/deliveryState.ts, the same path the hourly poll uses. A
 * carrier "delivered" is what makes an order delivered (and starts the
 * seller's payout clock). Idempotent: each (transaction, status, scan time)
 * delivery is claimed once in `shippo_webhook_events`, so a retried or
 * duplicate delivery from the carrier is a no-op.
 *
 * Authenticity: Shippo has no per-request signature this repo can verify yet.
 * When SHIPPO_WEBHOOK_SECRET is set, the delivery must carry it (the
 * `x-shippo-webhook-secret` header, or `?secret=` on the webhook URL registered
 * in the Shippo dashboard — Shippo can't add custom headers), compared in
 * constant time, or it is rejected with 401. When it is NOT set, the payload is
 * treated only as a hint that "something changed for this tracking number": the
 * handler re-reads the status from Shippo's API (GET /tracks, the same call the
 * hourly poll makes) and applies that instead, so a forged "delivered" can never
 * mark an order delivered, start a payout clock or trigger a return refund.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, orderItems, orders, shippingLabels, shippoWebhookEvents, users } from "@workspace/db";
import { applyShippoTrack, mapShippoStatus } from "../lib/delivery/trackingSync";
import { getTrack, shippoCarrierToken, type ShippoTrack } from "../lib/shippo";
import { sendOrderShippingEmail } from "../lib/brandthreadEmail";
import { logger } from "../lib/logger";
import { handleReturnLabelTracking, returnLabelIdFromMetadata } from "../lib/returnLabels";

const router = Router();

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

type Credential = "verified" | "invalid" | "not_configured";

function checkSharedSecret(req: any): Credential {
  const configured = process.env.SHIPPO_WEBHOOK_SECRET;
  if (!configured) return "not_configured";
  const provided = (req.headers["x-shippo-webhook-secret"] as string | undefined) ?? (req.query.secret as string | undefined);
  return typeof provided === "string" && timingSafeEqual(provided, configured) ? "verified" : "invalid";
}

/**
 * Re-reads a tracking number's status from Shippo for an unauthenticated
 * delivery. Null when the carrier is unknown or Shippo can't be reached — the
 * hourly poll picks the order up instead.
 */
async function fetchAuthoritativeTrack(carrier: string | null | undefined, trackingNumber: string | null | undefined): Promise<ShippoTrack | null> {
  const token = shippoCarrierToken(carrier);
  if (!token || !trackingNumber) return null;
  try {
    return await getTrack(token, trackingNumber);
  } catch (err) {
    logger.warn({ err, carrier: token }, "Shippo webhook: could not confirm tracking status with Shippo");
    return null;
  }
}

/** `brandthread-label/<labelId>` — set as the purchase transaction's metadata in lib/shippo.ts's purchaseTransaction call. */
function labelIdFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "string") return null;
  const match = metadata.match(/^brandthread-label\/([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

router.post("/", async (req, res) => {
  const credential = checkSharedSecret(req);
  if (credential === "invalid") {
    return void res.status(401).json({ error: "Invalid webhook credential" });
  }
  const verified = credential === "verified";

  const body = req.body ?? {};
  let data = body.data ?? {};
  const transactionId: string | undefined = data.transaction ?? body.transaction;
  const metadata: unknown = data.metadata ?? body.metadata;
  let trackingNumber = (data.tracking_number as string | undefined) ?? undefined;

  if (!mapShippoStatus(data.tracking_status?.status, data.tracking_status?.status_details) || (!transactionId && !trackingNumber)) {
    // Unrecognized or informational-only event (e.g. UNKNOWN) — accept and no-op.
    return void res.status(200).json({ ok: true, ignored: true });
  }

  try {
    // Resolve what this update is about: a prepaid return label, or an order
    // (via the label we bought, the seller-typed number's metadata, or the
    // tracking number itself).
    const returnLabelId = returnLabelIdFromMetadata(metadata);
    let carrier: string | null = null;
    let orderId: string | null = null;
    if (returnLabelId) {
      const [label] = await db.select({ carrier: shippingLabels.carrier, trackingNumber: shippingLabels.trackingNumber })
        .from(shippingLabels).where(eq(shippingLabels.id, returnLabelId)).limit(1);
      if (!label) return void res.status(200).json({ ok: true, unresolved: true });
      carrier = label.carrier;
      if (!verified) trackingNumber = label.trackingNumber ?? undefined;
    } else {
      const labelId = labelIdFromMetadata(metadata);
      if (labelId) {
        const [label] = await db.select({ orderId: shippingLabels.orderId, carrier: shippingLabels.carrier, trackingNumber: shippingLabels.trackingNumber })
          .from(shippingLabels).where(eq(shippingLabels.id, labelId)).limit(1);
        if (label) {
          orderId = label.orderId;
          carrier = label.carrier;
          if (!verified && label.trackingNumber) trackingNumber = label.trackingNumber;
        }
      }
      if (!orderId && typeof metadata === "string") {
        // Seller-typed numbers are registered with `brandthread-order/<orderId>` (lib/delivery/trackingSync.ts).
        const match = metadata.match(/^brandthread-order\/([0-9a-f-]{36})$/i);
        if (match) orderId = match[1];
      }
      if (!orderId && trackingNumber) {
        // Fall back to a tracking-number match when metadata is missing/unrecognized.
        const [order] = await db.select({ id: orders.id, carrier: orders.carrier }).from(orders)
          .where(eq(orders.trackingNumber, trackingNumber)).limit(1);
        if (order) {
          orderId = order.id;
          carrier = carrier ?? order.carrier;
        }
        if (!orderId) {
          const [item] = await db.select({ orderId: orderItems.orderId, carrier: orderItems.carrier }).from(orderItems)
            .where(eq(orderItems.trackingNumber, trackingNumber)).limit(1);
          if (item) {
            orderId = item.orderId;
            carrier = carrier ?? item.carrier;
          }
        }
      }
      if (!orderId) {
        logger.warn({ transactionId }, "Shippo webhook: could not resolve an order for this tracking update");
        return void res.status(200).json({ ok: true, unresolved: true });
      }
      if (!carrier || !trackingNumber) {
        const [order] = await db.select({ carrier: orders.carrier, trackingNumber: orders.trackingNumber })
          .from(orders).where(eq(orders.id, orderId)).limit(1);
        carrier = carrier ?? order?.carrier ?? null;
        if (!verified || !trackingNumber) trackingNumber = trackingNumber ?? order?.trackingNumber ?? undefined;
      }
    }

    if (!verified) {
      // Unauthenticated delivery: never act on its contents, only on what
      // Shippo itself reports for the number we have on file.
      const track = await fetchAuthoritativeTrack(carrier, trackingNumber);
      if (!track) return void res.status(200).json({ ok: true, unverified: true });
      data = { ...track, transaction: transactionId, tracking_number: trackingNumber, metadata };
    }

    const mapped = mapShippoStatus(data.tracking_status?.status, data.tracking_status?.status_details);
    if (!mapped) return void res.status(200).json({ ok: true, ignored: true });

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

    // A prepaid return label's scans move the return (and trigger its refund), never the order's own tracking.
    if (returnLabelId) {
      const outcome = await handleReturnLabelTracking(returnLabelId, mapped);
      return void res.status(200).json({ ok: true, return: true, refunded: outcome.refunded });
    }

    // One code path for webhook and poll: scan history, statuses, ETA,
    // delivery (which starts the seller's payout clock) and the buyer alerts.
    const [before] = await db.select({ status: orders.status, trackingNumber: orders.trackingNumber }).from(orders)
      .where(eq(orders.id, orderId!)).limit(1);
    const applied = await applyShippoTrack(
      orderId!,
      trackingNumber ?? before?.trackingNumber ?? (transactionId as string),
      data as ShippoTrack,
    );
    if (!applied) return void res.status(200).json({ ok: true, unresolved: true });

    const [updated] = await db.select().from(orders).where(eq(orders.id, orderId!)).limit(1);
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
