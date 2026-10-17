/**
 * Registers the Shopify webhooks routes/webhooks-shopify.ts handles, so
 * fulfillment tracking, cancellations and uninstalls from Shopify (and the
 * fulfillment apps behind it, e.g. Tapstitch) actually reach Brandthread.
 *
 * Idempotent: lists the shop's existing subscriptions and only creates the
 * missing ones. Webhooks created this way are signed with the app's
 * SHOPIFY_API_SECRET, which is what verifyWebhookHmac checks — so this only
 * applies to OAuth connections. A merchant custom-app token signs with that
 * custom app's own secret, which the server does not hold.
 */
import { eq } from "drizzle-orm";
import { db, shopifyConnections } from "@workspace/db";
import { ShopifyAdminClient } from "./adminClient";
import { hasFulfillmentScopes } from "./constants";
import { decryptSecret } from "../shopifyCrypto";
import { getWebOrigin } from "../webOrigin";
import { logger } from "../logger";

export const SHOPIFY_BASE_TOPICS = ["app/uninstalled"] as const;
export const SHOPIFY_FULFILLMENT_TOPICS = ["fulfillments/create", "fulfillments/update", "orders/cancelled"] as const;

export function shopifyWebhookAddress(): string {
  return `${getWebOrigin()}/api/webhooks/shopify`;
}

export function topicsForScopes(scopes: string): string[] {
  return hasFulfillmentScopes(scopes)
    ? [...SHOPIFY_BASE_TOPICS, ...SHOPIFY_FULFILLMENT_TOPICS]
    : [...SHOPIFY_BASE_TOPICS];
}

export async function ensureShopifyWebhooks(
  client: Pick<ShopifyAdminClient, "listWebhooks" | "createWebhook">,
  scopes: string,
  address = shopifyWebhookAddress(),
): Promise<{ created: string[]; existing: string[] }> {
  const { webhooks } = await client.listWebhooks();
  const have = new Set(webhooks.filter((w) => w.address === address).map((w) => w.topic));
  const created: string[] = [];
  const existing: string[] = [];
  for (const topic of topicsForScopes(scopes)) {
    if (have.has(topic)) {
      existing.push(topic);
      continue;
    }
    await client.createWebhook(topic, address);
    created.push(topic);
  }
  return { created, existing };
}

/**
 * Registers webhooks for a stored connection and records any failure on the
 * row's lastError (shown on the Shopify settings screen). Returns null on
 * success, otherwise a seller-readable error.
 */
export async function registerWebhooksForConnection(
  row: typeof shopifyConnections.$inferSelect,
): Promise<string | null> {
  if (row.connectionType !== "oauth") {
    return "Automatic tracking sync needs the Brandthread Shopify app. Custom-app tokens can't receive Shopify webhooks yet.";
  }
  try {
    const client = new ShopifyAdminClient(row.shopDomain, decryptSecret(row.accessTokenEncrypted));
    const result = await ensureShopifyWebhooks(client, row.scopes);
    logger.info({ shopDomain: row.shopDomain, ...result }, "Shopify webhooks ensured");
    if (row.lastError) {
      await db.update(shopifyConnections).set({ lastError: null, updatedAt: new Date() })
        .where(eq(shopifyConnections.id, row.id));
    }
    return null;
  } catch (err) {
    logger.error({ err, shopDomain: row.shopDomain }, "Shopify webhook registration failed");
    const message = "Couldn't set up order sync with Shopify. Reconnect Shopify to try again.";
    await db.update(shopifyConnections).set({ lastError: message, updatedAt: new Date() })
      .where(eq(shopifyConnections.id, row.id));
    return message;
  }
}
