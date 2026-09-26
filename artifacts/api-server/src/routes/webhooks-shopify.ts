/**
 * Shopify webhooks — HMAC-SHA256 verified over the raw request body (see
 * app.ts, which mounts express.raw() for this path ahead of the global JSON
 * parser). Two topics matter for the fulfillment bridge:
 *
 *  - app/uninstalled: the seller removed the Brandthread app from Shopify —
 *    mark the connection disconnected so nothing keeps trying to use its
 *    (now revoked) access token.
 *  - fulfillments/create + fulfillments/update: the seller's fulfillment app
 *    (Tapstitch, Printful, Printify, …) added tracking in Shopify. We write
 *    that tracking onto the matching Brandthread order and release escrowed
 *    funds through the SAME requestOrderRelease()/executeOrderRelease() path
 *    a staff member entering tracking manually would trigger — never a
 *    reimplementation of that money logic.
 *
 * Idempotent: each webhook delivery is claimed once in
 * `shopify_webhook_events`, keyed by Shopify's own `X-Shopify-Webhook-Id`.
 */
import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, orders, shopifyConnections, shopifyOrderLinks, shopifyWebhookEvents } from "@workspace/db";
import { verifyWebhookHmac } from "../lib/shopify/oauth";
import { requestOrderRelease, executeOrderRelease } from "../lib/money/escrow";
import { publishNotification } from "./notifications-feed";
import { logger } from "../lib/logger";

const router = Router();

router.post("/", async (req, res) => {
  const rawBody = req.body as Buffer;
  const hmacHeader = req.headers["x-shopify-hmac-sha256"] as string | undefined;
  if (!Buffer.isBuffer(rawBody) || !verifyWebhookHmac(rawBody, hmacHeader)) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  const topic = req.headers["x-shopify-topic"] as string | undefined;
  const shopDomain = req.headers["x-shopify-shop-domain"] as string | undefined;
  const webhookId = req.headers["x-shopify-webhook-id"] as string | undefined;
  if (!topic || !shopDomain || !webhookId) {
    res.status(400).json({ error: "Missing Shopify webhook headers" });
    return;
  }

  const dedupeId = `${shopDomain}:${webhookId}`;
  const claimed = await db.insert(shopifyWebhookEvents).values({ id: dedupeId, shopDomain, topic })
    .onConflictDoNothing()
    .returning({ id: shopifyWebhookEvents.id });
  if (claimed.length === 0) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    res.status(200).json({ ok: true, error: "invalid_json" });
    return;
  }

  try {
    if (topic === "app/uninstalled") {
      await db.update(shopifyConnections).set({
        status: "disconnected",
        disconnectedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(shopifyConnections.shopDomain, shopDomain));
      res.status(200).json({ ok: true });
      return;
    }

    if (topic === "fulfillments/create" || topic === "fulfillments/update") {
      await handleFulfillmentWebhook(shopDomain, payload);
      res.status(200).json({ ok: true });
      return;
    }

    if (topic === "orders/cancelled") {
      await handleOrderCancelledWebhook(shopDomain, payload);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(200).json({ ok: true, ignored: true });
  } catch (err) {
    logger.error({ err, topic, shopDomain }, "Shopify webhook processing failed");
    // Ack anyway so Shopify doesn't hammer retries; this is advisory tracking
    // sync, not the source of truth for money — the escrow sweep and manual
    // tracking entry both remain available as a backstop.
    res.status(200).json({ ok: true, error: "processing_failed" });
  }
});

async function handleFulfillmentWebhook(shopDomain: string, payload: any): Promise<void> {
  const shopifyOrderId = String(payload.order_id ?? "");
  const trackingNumber: string | undefined = payload.tracking_number
    ?? (Array.isArray(payload.tracking_numbers) ? payload.tracking_numbers[0] : undefined);
  const carrier: string | undefined = payload.tracking_company ?? undefined;
  if (!shopifyOrderId || !trackingNumber) return;

  const [link] = await db.select().from(shopifyOrderLinks)
    .where(eq(shopifyOrderLinks.shopifyOrderId, shopifyOrderId)).limit(1);
  if (!link) {
    logger.warn({ shopDomain, shopifyOrderId }, "Shopify fulfillment webhook: no matching Brandthread order");
    return;
  }

  // Same IS DISTINCT FROM idempotency guard as PATCH /api/orders/:id/tracking:
  // a redelivered or duplicate webhook for the same tracking number is a no-op.
  const [updated] = await db.update(orders).set({
    trackingNumber,
    carrier: carrier ?? null,
    trackingStatus: "in_transit",
    status: "shipped",
    shippedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(orders.id, link.brandthreadOrderId),
    sql`${orders.trackingNumber} IS DISTINCT FROM ${trackingNumber}`,
  )).returning();
  if (!updated) return;

  if (updated.buyerId) {
    publishNotification({
      userId: updated.buyerId,
      category: "orders",
      type: "order_shipped",
      title: "Your order has shipped! 🚚",
      body: `Order #${updated.orderNumber} is on its way via ${carrier ?? "carrier"} — tracking: ${trackingNumber}`,
      targetId: updated.id,
      targetType: "order",
    }).catch(() => { /* non-critical */ });
  }

  // Held preorder funds: identical trigger to a staff member entering
  // tracking by hand (routes/orders.ts PATCH /:id/tracking). Never
  // reimplemented here — same escrow functions, same "tracking" trigger.
  if (updated.chargeModel === "held" && updated.trackingNumber) {
    try {
      const release = await requestOrderRelease(updated.id, "tracking");
      if (release.releaseId) {
        const releaseId = release.releaseId;
        setImmediate(() => {
          executeOrderRelease(releaseId, { reclaimStale: true }).catch((err) =>
            logger.error({ err, orderId: updated.id, releaseId }, "Order release transfer failed; sweep will retry"));
        });
      }
    } catch (err) {
      logger.error({ err, orderId: updated.id }, "Could not record the order release; sweep will retry");
    }
  }
}

async function handleOrderCancelledWebhook(shopDomain: string, payload: any): Promise<void> {
  const shopifyOrderId = String(payload.id ?? "");
  if (!shopifyOrderId) return;
  const [link] = await db.select().from(shopifyOrderLinks)
    .where(eq(shopifyOrderLinks.shopifyOrderId, shopifyOrderId)).limit(1);
  if (!link) return;

  const [order] = await db.select({ id: orders.id, ownerId: orders.ownerId, orderNumber: orders.orderNumber, status: orders.status, notes: orders.notes })
    .from(orders).where(eq(orders.id, link.brandthreadOrderId)).limit(1);
  if (!order || order.status === "cancelled" || order.status === "shipped") return;

  // Never auto-refund from a Shopify-side signal — refunds stay a deliberate,
  // staff-initiated action on Brandthread (see lib/money/refunds.ts) so a
  // cancellation can never be double-refunded. Surface it instead.
  const note = `Shopify order ${payload.name ?? shopifyOrderId} was cancelled in Shopify (${shopDomain}). Review this order's fulfillment.`;
  await db.update(orders).set({
    notes: order.notes ? `${order.notes}\n${note}` : note,
    updatedAt: new Date(),
  }).where(eq(orders.id, order.id));

  publishNotification({
    userId: order.ownerId,
    category: "orders",
    type: "shopify_order_cancelled",
    title: "Shopify order cancelled",
    body: `The Shopify order for Brandthread order #${order.orderNumber} was cancelled. Review it.`,
    targetId: order.id,
    targetType: "order",
  }).catch(() => { /* non-critical */ });
}

export default router;
