/**
 * Fulfillment via Shopify (B): once a Brandthread order containing at least
 * one linked product is PAID, create the matching order in the seller's
 * Shopify store so their fulfillment app (Tapstitch, Printful, Printify, …)
 * picks it up automatically. Idempotent — one Shopify order per Brandthread
 * order, safe on retries, enforced by the unique `shopify_order_links.
 * brandthread_order_id` row claimed before the outbound API call.
 */
import { eq } from "drizzle-orm";
import {
  db, orders, orderItems, users, shopifyConnections, shopifyProductLinks, shopifyOrderLinks,
} from "@workspace/db";
import { ShopifyAdminClient } from "./adminClient";
import { decryptSecret } from "../shopifyCrypto";
import { logger } from "../logger";

export async function forwardOrderToShopifyIfLinked(orderId: string): Promise<void> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return;

  const [connection] = await db.select().from(shopifyConnections)
    .where(eq(shopifyConnections.ownerId, order.ownerId)).limit(1);
  if (!connection || connection.status !== "connected" || !connection.fulfillmentEnabled) return;

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  if (items.length === 0) return;

  const links = await db.select().from(shopifyProductLinks).where(eq(shopifyProductLinks.ownerId, order.ownerId));
  const shopifyVariantIdByBtVariantId = new Map<string, string>();
  for (const link of links) {
    for (const [btVariantId, shopifyVariantId] of Object.entries(link.variantMap)) {
      shopifyVariantIdByBtVariantId.set(btVariantId, shopifyVariantId);
    }
  }

  const lineItems = items
    .filter((item) => item.variantId && shopifyVariantIdByBtVariantId.has(item.variantId))
    .map((item) => ({
      variant_id: Number(shopifyVariantIdByBtVariantId.get(item.variantId as string)),
      quantity: item.quantity,
    }));
  if (lineItems.length === 0) return; // Nothing on this order is fulfilled through Shopify.

  // Claim the mapping row before calling out — a concurrent retry (webhook
  // redelivery, checkout-webhook retry) sees the conflict and no-ops.
  const claimed = await db.insert(shopifyOrderLinks)
    .values({ brandthreadOrderId: orderId, ownerId: order.ownerId, status: "pending" })
    .onConflictDoNothing({ target: shopifyOrderLinks.brandthreadOrderId })
    .returning({ id: shopifyOrderLinks.id });
  if (claimed.length === 0) return; // Already claimed (sent, pending, or failed-and-not-retried).

  try {
    let email: string | null = order.guestEmail;
    if (!email && order.buyerId) {
      const [buyer] = await db.select({ email: users.email }).from(users).where(eq(users.clerkId, order.buyerId)).limit(1);
      email = buyer?.email ?? null;
    }

    const accessToken = decryptSecret(connection.accessTokenEncrypted);
    const client = new ShopifyAdminClient(connection.shopDomain, accessToken);

    const partial = lineItems.length < items.length;
    const addr = order.shippingAddress as { name?: string; street: string; line2?: string | null; city: string; state: string; zip: string; country: string } | null;

    const { order: created } = await client.createOrder({
      line_items: lineItems,
      financial_status: "paid",
      note: `Brandthread order #${order.orderNumber}${partial ? " (partial — only Brandthread-linked items included)" : ""}`,
      tags: "brandthread",
      email: email ?? undefined,
      send_receipt: false,
      send_fulfillment_receipt: false,
      ...(addr ? {
        shipping_address: {
          name: addr.name, address1: addr.street, address2: addr.line2 ?? undefined,
          city: addr.city, province: addr.state, zip: addr.zip, country: addr.country,
        },
      } : {}),
    });

    await db.update(shopifyOrderLinks).set({
      status: "sent",
      shopifyOrderId: String(created.id),
      shopifyOrderName: created.name,
      updatedAt: new Date(),
    }).where(eq(shopifyOrderLinks.brandthreadOrderId, orderId));
  } catch (err) {
    await db.update(shopifyOrderLinks).set({
      status: "failed",
      lastError: err instanceof Error ? err.message : "Unknown error",
      updatedAt: new Date(),
    }).where(eq(shopifyOrderLinks.brandthreadOrderId, orderId));
    logger.error({ err, orderId }, "Forwarding order to Shopify failed");
  }
}
