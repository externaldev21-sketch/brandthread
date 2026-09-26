/**
 * Seller-authenticated Shopify fulfillment-bridge routes.
 *
 * Two independent capabilities share one connection row per seller:
 *  (A) Product transfer — GET /products, POST /products/import. Only ever
 *      needs read_products/read_inventory scopes and never forwards orders.
 *  (B) Fulfillment via Shopify — POST /fulfillment/enable|disable. Requires
 *      the connection to carry order-write scopes; enabling it when the
 *      current connection doesn't have them returns an upgrade URL that
 *      re-runs OAuth with the fuller scope set (Shopify merges scopes for
 *      the same app, so the seller is only prompted for what's new).
 */
import { Router } from "express";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, shopifyConnections, shopifyProductLinks, shopifyOauthStates } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { ShopifyConnectPurpose, hasFulfillmentScopes, isValidShopDomain, normalizeShopDomain } from "../lib/shopify/constants";
import { buildAuthorizeUrl } from "../lib/shopify/oauth";
import { ShopifyAdminClient } from "../lib/shopify/adminClient";
import { encryptSecret, decryptSecret } from "../lib/shopifyCrypto";
import { importShopifyProducts } from "../lib/shopify/productImport";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuth);

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function serializeConnection(row: typeof shopifyConnections.$inferSelect, linkedProductsCount: number) {
  return {
    connected: row.status === "connected",
    shopDomain: row.shopDomain,
    connectionType: row.connectionType,
    scopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean),
    fulfillmentEnabled: row.fulfillmentEnabled,
    fulfillmentEligible: hasFulfillmentScopes(row.scopes),
    status: row.status,
    lastError: row.lastError,
    lastImportAt: row.lastImportAt,
    lastOrderSyncAt: row.lastOrderSyncAt,
    linkedProductsCount,
  };
}

// GET /api/shopify/status
router.get("/status", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [row] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.ownerId, ownerId)).limit(1);
  if (!row) { res.json({ connected: false, fulfillmentEnabled: false, linkedProductsCount: 0 }); return; }
  const links = await db.select({ id: shopifyProductLinks.id }).from(shopifyProductLinks).where(eq(shopifyProductLinks.ownerId, ownerId));
  res.json(serializeConnection(row, links.length));
});

// POST /api/shopify/connect/start { shopDomain, purpose }
router.post("/connect/start", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { shopDomain: rawShopDomain, purpose } = req.body ?? {};
  if (!rawShopDomain || typeof rawShopDomain !== "string") {
    res.status(400).json({ error: "shopDomain is required" }); return;
  }
  if (purpose !== "import" && purpose !== "fulfillment") {
    res.status(400).json({ error: "purpose must be 'import' or 'fulfillment'" }); return;
  }
  const shopDomain = normalizeShopDomain(rawShopDomain);
  if (!isValidShopDomain(shopDomain)) {
    res.status(400).json({ error: "That doesn't look like a valid myshopify.com domain" }); return;
  }
  const redirectUri = process.env.SHOPIFY_APP_REDIRECT_URI;
  if (!redirectUri) {
    res.status(503).json({ error: "Shopify connections are not configured yet" }); return;
  }

  const state = crypto.randomBytes(24).toString("hex");
  await db.insert(shopifyOauthStates).values({
    state, ownerId, shopDomain, purpose: purpose as ShopifyConnectPurpose,
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });

  const authorizeUrl = buildAuthorizeUrl({ shopDomain, state, purpose, redirectUri });
  res.json({ authorizeUrl });
});

// POST /api/shopify/connect/custom-app { shopDomain, accessToken, purpose }
// Fallback for testing against the owner's own store before the public
// Shopify app is approved — a merchant-generated custom-app Admin API token.
router.post("/connect/custom-app", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { shopDomain: rawShopDomain, accessToken, purpose } = req.body ?? {};
  if (!rawShopDomain || typeof rawShopDomain !== "string" || !accessToken || typeof accessToken !== "string") {
    res.status(400).json({ error: "shopDomain and accessToken are required" }); return;
  }
  if (purpose !== "import" && purpose !== "fulfillment") {
    res.status(400).json({ error: "purpose must be 'import' or 'fulfillment'" }); return;
  }
  const shopDomain = normalizeShopDomain(rawShopDomain);
  if (!isValidShopDomain(shopDomain)) {
    res.status(400).json({ error: "That doesn't look like a valid myshopify.com domain" }); return;
  }

  try {
    const client = new ShopifyAdminClient(shopDomain, accessToken);
    await client.getShop(); // Verifies the token actually works before we store it.
  } catch (err) {
    logger.warn({ err, shopDomain }, "Shopify custom-app token verification failed");
    res.status(400).json({ error: "Could not verify that access token against the shop" }); return;
  }

  const scopes = (purpose === "fulfillment"
    ? ["read_products", "read_inventory", "read_orders", "write_orders", "read_fulfillments"]
    : ["read_products", "read_inventory"]).join(",");
  const accessTokenEncrypted = encryptSecret(accessToken);

  const [existing] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.ownerId, ownerId)).limit(1);
  if (existing) {
    await db.update(shopifyConnections).set({
      shopDomain, accessTokenEncrypted, connectionType: "custom_app",
      // A custom-app connection is configured with whatever scopes the
      // merchant granted it in Shopify admin; trust the requested purpose
      // rather than re-deriving from an OAuth grant (there is none here).
      scopes: purpose === "fulfillment" ? scopes : existing.scopes || scopes,
      status: "connected", lastError: null, disconnectedAt: null, updatedAt: new Date(),
      ...(purpose === "fulfillment" ? { fulfillmentEnabled: true } : {}),
    }).where(eq(shopifyConnections.id, existing.id));
  } else {
    await db.insert(shopifyConnections).values({
      ownerId, shopDomain, accessTokenEncrypted, connectionType: "custom_app", scopes,
      fulfillmentEnabled: purpose === "fulfillment",
    });
  }
  const [row] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.ownerId, ownerId)).limit(1);
  res.json(serializeConnection(row!, 0));
});

// POST /api/shopify/disconnect
router.post("/disconnect", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  await db.update(shopifyConnections).set({
    status: "disconnected", fulfillmentEnabled: false, disconnectedAt: new Date(), updatedAt: new Date(),
  }).where(eq(shopifyConnections.ownerId, ownerId));
  res.json({ ok: true });
});

// POST /api/shopify/fulfillment/enable — flips the switch, or hands back an
// upgrade URL if the current connection doesn't carry order-write scopes.
router.post("/fulfillment/enable", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [row] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.ownerId, ownerId)).limit(1);
  if (!row || row.status !== "connected") {
    res.status(400).json({ error: "Connect Shopify first" }); return;
  }
  if (!hasFulfillmentScopes(row.scopes)) {
    if (row.connectionType === "custom_app") {
      res.status(400).json({ error: "This custom-app token needs read_orders, write_orders and read_fulfillments scopes in Shopify before fulfillment can be enabled" });
      return;
    }
    res.status(409).json({ error: "needs_upgrade", needsUpgrade: true, message: "Re-connect Shopify to grant order permissions" });
    return;
  }
  await db.update(shopifyConnections).set({ fulfillmentEnabled: true, updatedAt: new Date() }).where(eq(shopifyConnections.id, row.id));
  res.json({ ok: true, fulfillmentEnabled: true });
});

// POST /api/shopify/fulfillment/disable
router.post("/fulfillment/disable", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  await db.update(shopifyConnections).set({ fulfillmentEnabled: false, updatedAt: new Date() }).where(eq(shopifyConnections.ownerId, ownerId));
  res.json({ ok: true, fulfillmentEnabled: false });
});

// GET /api/shopify/products?pageInfo=... — for the import picker.
router.get("/products", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [row] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.ownerId, ownerId)).limit(1);
  if (!row || row.status !== "connected") { res.status(400).json({ error: "Connect Shopify first" }); return; }

  try {
    const client = new ShopifyAdminClient(row.shopDomain, decryptSecret(row.accessTokenEncrypted));
    const pageInfo = typeof req.query.pageInfo === "string" ? req.query.pageInfo : undefined;
    const { products, nextPageInfo } = await client.listProducts(pageInfo);

    const links = await db.select().from(shopifyProductLinks).where(eq(shopifyProductLinks.ownerId, ownerId));
    const linkedShopifyIds = new Set(links.map((l) => l.shopifyProductId));

    res.json({
      products: products.map((p) => ({
        shopifyProductId: String(p.id),
        title: p.title,
        image: p.images?.[0]?.src ?? null,
        variantCount: p.variants?.length ?? 0,
        alreadyImported: linkedShopifyIds.has(String(p.id)),
      })),
      nextPageInfo,
    });
  } catch (err) {
    logger.error({ err, ownerId }, "Listing Shopify products failed");
    res.status(502).json({ error: "Could not reach Shopify" });
  }
});

// POST /api/shopify/products/import { shopifyProductIds: string[], publishStatus: 'draft'|'active' }
router.post("/products/import", requireRole("staff"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { shopifyProductIds, publishStatus } = req.body ?? {};
  if (!Array.isArray(shopifyProductIds) || shopifyProductIds.length === 0) {
    res.status(400).json({ error: "shopifyProductIds must be a non-empty array" }); return;
  }
  if (publishStatus !== "draft" && publishStatus !== "active") {
    res.status(400).json({ error: "publishStatus must be 'draft' or 'active'" }); return;
  }
  const [row] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.ownerId, ownerId)).limit(1);
  if (!row || row.status !== "connected") { res.status(400).json({ error: "Connect Shopify first" }); return; }

  const summary = await importShopifyProducts({
    ownerId,
    shopDomain: row.shopDomain,
    accessToken: decryptSecret(row.accessTokenEncrypted),
    shopifyProductIds: shopifyProductIds.map(String),
    publishStatus,
  });

  await db.update(shopifyConnections).set({ lastImportAt: new Date(), updatedAt: new Date() }).where(eq(shopifyConnections.id, row.id));
  res.json(summary);
});

export default router;
