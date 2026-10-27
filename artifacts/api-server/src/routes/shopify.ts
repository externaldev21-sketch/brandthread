/**
 * Seller-authenticated Shopify fulfillment-bridge routes.
 *
 * Two independent capabilities share one connection row per seller:
 *  (A) Product transfer — POST /catalog-import (whole catalog, with live
 *      progress) and GET /products + POST /products/import. Only ever
 *      needs read_products/read_inventory scopes and never forwards orders.
 *  (B) Fulfillment via Shopify — POST /fulfillment/enable|disable. Requires
 *      the connection to carry order-write scopes; enabling it when the
 *      current connection doesn't have them returns an upgrade URL that
 *      re-runs OAuth with the fuller scope set (Shopify merges scopes for
 *      the same app, so the seller is only prompted for what's new).
 *
 * A connection is only ever made through Shopify's own OAuth consent screen;
 * there is deliberately no route that accepts a pasted token or API key.
 */
import { Router } from "express";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, shopifyCatalogImportJobs, shopifyConnections, shopifyProductLinks, shopifyOauthStates } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { ShopifyConnectPurpose, hasFulfillmentScopes, isValidShopDomain, normalizeShopDomain } from "../lib/shopify/constants";
import { buildAuthorizeUrl } from "../lib/shopify/oauth";
import { ShopifyAdminClient } from "../lib/shopify/adminClient";
import { decryptSecret } from "../lib/shopifyCrypto";
import { shopifyAppConfigured, shopifyRedirectUri } from "../lib/shopify/config";
import { createCatalogJob, expireIfStale, latestCatalogJob, publicCatalogJob, runCatalogImport } from "../lib/shopify/catalogImport";
import { importShopifyProducts } from "../lib/shopify/productImport";
import { registerWebhooksForConnection } from "../lib/shopify/webhooks";
import { logger } from "../lib/logger";
import { getSellerPayoutReadiness, payoutsNotReadyBody } from "../lib/payoutGate";

const router = Router();
router.use(requireAuth);

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function serializeConnection(row: typeof shopifyConnections.$inferSelect, linkedProductsCount: number) {
  return {
    configured: shopifyAppConfigured(),
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
  if (!row) { res.json({ configured: shopifyAppConfigured(), connected: false, fulfillmentEnabled: false, linkedProductsCount: 0 }); return; }
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
  if (!shopifyAppConfigured()) {
    res.status(503).json({ error: "not_configured", message: "Shopify import is almost ready — Brandthread's Shopify app is still being set up." });
    return;
  }
  const redirectUri = shopifyRedirectUri();

  const state = crypto.randomBytes(24).toString("hex");
  await db.insert(shopifyOauthStates).values({
    state, ownerId, shopDomain, purpose: purpose as ShopifyConnectPurpose,
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });

  const authorizeUrl = buildAuthorizeUrl({ shopDomain, state, purpose, redirectUri });
  res.json({ authorizeUrl });
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
  // Without the webhooks, Shopify tracking/cancellations never come back, so
  // don't report fulfillment as on unless they are registered.
  const webhookError = await registerWebhooksForConnection(row);
  if (webhookError && row.connectionType === "oauth") {
    res.status(502).json({ error: webhookError }); return;
  }
  await db.update(shopifyConnections).set({ fulfillmentEnabled: true, updatedAt: new Date() }).where(eq(shopifyConnections.id, row.id));
  res.json({ ok: true, fulfillmentEnabled: true, ...(webhookError ? { warning: webhookError } : {}) });
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
  if (publishStatus === "active") {
    // Payout gate: imported listings can only go live once payouts are set up.
    const payouts = await getSellerPayoutReadiness(ownerId);
    if (!payouts.ready) { res.status(409).json(payoutsNotReadyBody(payouts)); return; }
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

// POST /api/shopify/catalog-import — imports the whole connected catalog in
// the background; poll GET /catalog-import/:id for progress. Returns the job
// already running (200) instead of starting a second one.
router.post("/catalog-import", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const [row] = await db.select().from(shopifyConnections).where(eq(shopifyConnections.ownerId, ownerId)).limit(1);
  if (!row || row.status !== "connected") { res.status(400).json({ error: "not_connected", message: "Connect Shopify first." }); return; }
  const { job, created } = await createCatalogJob(ownerId, row.shopDomain);
  if (created) {
    void runCatalogImport(job.id).catch((err) => logger.error({ err, jobId: job.id }, "Shopify catalog import crashed"));
  }
  res.status(created ? 202 : 200).json(publicCatalogJob(job));
});

// GET /api/shopify/catalog-import/latest
router.get("/catalog-import/latest", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const job = await latestCatalogJob(ownerId);
  res.json(job ? publicCatalogJob(job) : null);
});

// GET /api/shopify/catalog-import/:id
router.get("/catalog-import/:id", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) { res.status(404).json({ error: "not_found" }); return; }
  const [job] = await db.select().from(shopifyCatalogImportJobs)
    .where(and(eq(shopifyCatalogImportJobs.id, req.params.id), eq(shopifyCatalogImportJobs.ownerId, ownerId))).limit(1);
  if (!job) { res.status(404).json({ error: "not_found" }); return; }
  res.json(publicCatalogJob(await expireIfStale(job)));
});

export default router;
