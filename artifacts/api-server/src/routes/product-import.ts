/**
 * /api/product-import — CSV (Shopify / Etsy / Brandthread layouts) and Etsy
 * Open API product import. Extends the existing importers: the Shopify public
 * URL import (/api/shopify-imports) and the simple /api/products/import are
 * untouched; this adds a server-side parser, previews and idempotent commits.
 */
import express, { Router } from "express";
import crypto from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, etsyConnections, etsyOauthStates, productImportRuns, shopifyConnections } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole } from "../middlewares/requireRole";
import { getVerifiedPlanAccess, sendPlanLimitReached, sendPlanLookupUnavailable } from "../lib/planAccess";
import { CsvParseError, parseCsv, type Delimiter, DELIMITERS } from "../lib/productImport/csv";
import { detectLayout, mapCsv } from "../lib/productImport/layouts";
import {
  assignSkus, commitProducts, planImport, readCapacity, skusTakenElsewhere, type PlannedProduct,
} from "../lib/productImport/commit";
import {
  type CsvLayout, type ImportProduct, type ImportSource, type Issue, type MapResult,
  LAYOUT_SOURCE, MAX_CSV_BYTES, MAX_CSV_ROWS,
} from "../lib/productImport/types";
import {
  ETSY_DISABLED_REASON, buildEtsyAuthorizeUrl, decryptEtsySecret, encryptEtsySecret, etsyConfig, newCodeVerifier,
} from "../lib/etsy/config";
import { EtsyApiError, fetchAllActiveListings, getEtsyApi } from "../lib/etsy/client";
import { mapEtsyListings } from "../lib/etsy/mapper";
import { logger } from "../lib/logger";

const router = Router();
/** Unauthenticated: Etsy redirects the seller's browser here. Identity comes from the stored state row. */
export const etsyCallbackRouter = Router();
router.use(requireAuth);

const LAYOUT_LABEL: Record<CsvLayout, string> = {
  shopify: "Shopify export", etsy: "Etsy export", generic: "Brandthread template",
};
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_ISSUES_RETURNED = 200;

function ownerOf(req: express.Request): string {
  return (req as any).clerkUserId as string;
}

export function shopifyOauthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SHOPIFY_APP_API_KEY && env.SHOPIFY_APP_API_SECRET && env.SHOPIFY_APP_REDIRECT_URI && env.SHOPIFY_TOKEN_ENCRYPTION_KEY);
}

// ─── CSV body (text/csv, up to 5 MB) ────────────────────────────────────────

const textParser = express.text({ type: ["text/csv", "text/plain", "application/csv", "application/vnd.ms-excel"], limit: MAX_CSV_BYTES });
function csvBody(req: express.Request, res: express.Response, next: express.NextFunction) {
  textParser(req, res, (err?: unknown) => {
    if (err) {
      const tooLarge = (err as { type?: string }).type === "entity.too.large";
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "FILE_TOO_LARGE" : "BAD_BODY",
        message: tooLarge ? "That file is larger than 5 MB. Split it into smaller files and import them one at a time." : "We couldn't read that file.",
      });
      return;
    }
    next();
  });
}

type Fail = { status: number; error: string; message: string };

function parseUpload(req: express.Request): { csvMap: MapResult; layout: CsvLayout; delimiter: Delimiter; rowCount: number; source: ImportSource } | Fail {
  const text = typeof req.body === "string" ? req.body : "";
  if (!text.trim()) return { status: 400, error: "EMPTY_FILE", message: "The file is empty." };
  if (Buffer.byteLength(text) > MAX_CSV_BYTES) return { status: 413, error: "FILE_TOO_LARGE", message: "That file is larger than 5 MB. Split it into smaller files and import them one at a time." };
  const requestedDelimiter = DELIMITERS.find((d) => d === (req.query.delimiter as string));
  let parsed;
  try { parsed = parseCsv(text, requestedDelimiter ? { delimiter: requestedDelimiter } : {}); } catch (error) {
    if (error instanceof CsvParseError) return { status: 400, error: error.code === "EMPTY" ? "EMPTY_FILE" : "CSV_INVALID", message: error.message };
    throw error;
  }
  if (parsed.rows.length === 0) return { status: 422, error: "NO_ROWS", message: "The file has a header row but no products." };
  if (parsed.rows.length > MAX_CSV_ROWS) {
    return { status: 413, error: "TOO_MANY_ROWS", message: `This file has ${parsed.rows.length.toLocaleString()} rows. The limit is ${MAX_CSV_ROWS.toLocaleString()} per import; split it and import the parts one at a time.` };
  }
  const forced = ["shopify", "etsy", "generic"].includes(String(req.query.layout)) ? (req.query.layout as CsvLayout) : null;
  const detected = detectLayout(parsed.headers);
  const layout = forced ?? detected?.layout ?? null;
  if (!layout) {
    return { status: 422, error: "LAYOUT_UNKNOWN", message: "We couldn't recognise this file. It needs a name or title column (for example name, price, category, sku, images, tags, size, color, stock)." };
  }
  return { csvMap: mapCsv(layout, parsed), layout, delimiter: parsed.delimiter, rowCount: parsed.rows.length, source: LAYOUT_SOURCE[layout] };
}

function isFail(v: unknown): v is Fail {
  return typeof v === "object" && v !== null && "status" in v && "error" in v;
}

// ─── Preview building (read-only) ───────────────────────────────────────────

async function buildPreview(ownerId: string, source: ImportSource, mapped: MapResult, planLimit: number | null) {
  const plan = await planImport(ownerId, source, mapped.products);
  const issues: Issue[] = [...mapped.issues];

  // SKU collisions, exactly as commit would resolve them.
  const claimed = new Set<string>();
  for (const planned of plan) {
    if (planned.action === "unchanged") continue;
    const { skus, notes } = assignSkus(ownerId, source, planned.product, claimed);
    for (const note of notes) issues.push({ severity: "warning", line: planned.product.lines[0] ?? 0, product: planned.product.name, field: "sku", message: note });
    const taken = await skusTakenElsewhere(skus, planned.productId);
    for (const sku of taken) {
      issues.push({ severity: "warning", line: planned.product.lines[0] ?? 0, product: planned.product.name, field: "sku", message: `SKU ${sku} is already used by another product; it will be saved with a short suffix.` });
    }
  }

  const capacity = await readCapacity(ownerId, planLimit);
  const creates = plan.filter((p) => p.action === "create" && p.product.sourceStatus !== "archived").length;
  const wouldExceed = capacity.remaining !== null && creates > capacity.remaining;
  if (wouldExceed) {
    issues.push({
      severity: "warning", line: 0, product: "", field: null,
      message: `Your plan allows ${capacity.limit} products and ${capacity.used} are in use, so only the first ${capacity.remaining} new product${capacity.remaining === 1 ? "" : "s"} will be imported.`,
    });
  }

  const notes: string[] = [];
  if (mapped.products.some((p) => p.variants.some((v) => v.compareAtCents))) notes.push("Compare-at prices aren't imported.");
  if (mapped.products.some((p) => p.seoTitle || p.seoDescription || p.vendor)) notes.push("Vendor and SEO fields aren't imported.");
  notes.push("Products are imported as drafts. Publish when ready.");

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const sorted = [...errors, ...warnings];
  return {
    counts: {
      products: plan.length,
      variants: plan.reduce((n, p) => n + p.product.variants.length, 0),
      create: plan.filter((p) => p.action === "create").length,
      update: plan.filter((p) => p.action === "update").length,
      unchanged: plan.filter((p) => p.action === "unchanged").length,
      errors: errors.length,
      warnings: warnings.length,
    },
    capacity: { ...capacity, newProducts: creates, wouldExceed },
    issues: sorted.slice(0, MAX_ISSUES_RETURNED),
    issuesTruncated: sorted.length > MAX_ISSUES_RETURNED,
    sample: plan.slice(0, 5).map((p) => sampleOf(p)),
    ignoredColumns: mapped.ignoredColumns,
    notes,
  };
}

function sampleOf(planned: PlannedProduct) {
  const p: ImportProduct = planned.product;
  return {
    name: p.name, category: p.category, tags: p.tags.slice(0, 6), imageCount: p.images.length, firstImage: p.images[0] ?? null,
    action: planned.action, variantCount: p.variants.length,
    variants: p.variants.slice(0, 4).map((v) => ({ sku: v.sku || null, size: v.size, color: v.color, priceCents: v.priceCents, stock: v.stock })),
    priceFromCents: Math.min(...p.variants.map((v) => v.priceCents)),
  };
}

async function planAccess(req: express.Request, res: express.Response) {
  try { return await getVerifiedPlanAccess(ownerOf(req)); } catch (error) {
    sendPlanLookupUnavailable(req, res, error);
    return null;
  }
}

// ─── Providers ──────────────────────────────────────────────────────────────

router.get("/providers", async (req, res) => {
  const ownerId = ownerOf(req);
  const [shop] = await db.select({ shopDomain: shopifyConnections.shopDomain, status: shopifyConnections.status })
    .from(shopifyConnections).where(eq(shopifyConnections.ownerId, ownerId)).limit(1);
  const etsyEnabled = etsyConfig() !== null;
  const [etsy] = etsyEnabled
    ? await db.select({ shopName: etsyConnections.shopName, status: etsyConnections.status }).from(etsyConnections).where(eq(etsyConnections.ownerId, ownerId)).limit(1)
    : [];
  res.json({
    csv: true,
    shopify: {
      publicUrl: true,
      oauth: shopifyOauthEnabled(),
      connected: Boolean(shop && shop.status === "connected"),
      shopDomain: shop?.shopDomain ?? null,
    },
    etsy: etsyEnabled
      ? { enabled: true, connected: Boolean(etsy && etsy.status === "connected"), shopName: etsy?.shopName ?? null }
      : { enabled: false, connected: false, reason: ETSY_DISABLED_REASON },
  });
});

// ─── CSV ────────────────────────────────────────────────────────────────────

router.post("/csv/preview", requireRole("manager"), csvBody, async (req, res) => {
  const parsed = parseUpload(req);
  if (isFail(parsed)) { res.status(parsed.status).json({ error: parsed.error, message: parsed.message }); return; }
  const access = await planAccess(req, res);
  if (!access) return;
  const preview = await buildPreview(ownerOf(req), parsed.source, parsed.csvMap, access.limits.products);
  res.json({
    layout: parsed.layout, layoutLabel: LAYOUT_LABEL[parsed.layout], source: parsed.source,
    delimiter: parsed.delimiter, rowCount: parsed.rowCount, ...preview,
  });
});

async function runCommit(req: express.Request, res: express.Response, source: ImportSource, mapped: MapResult, filename: string | null) {
  const ownerId = ownerOf(req);
  if (!mapped.products.length) {
    res.status(422).json({ error: "NOTHING_TO_IMPORT", message: "No products in this file could be imported.", issues: mapped.issues.slice(0, MAX_ISSUES_RETURNED) });
    return;
  }
  const access = await planAccess(req, res);
  if (!access) return;
  const runId = crypto.randomUUID();
  const summary = await commitProducts({ ownerId, source, items: mapped.products, planLimit: access.limits.products, runId, log: req.log ?? logger });
  const c = summary.runCounts;
  if (summary.planLimitReached && c.created === 0 && c.updated === 0 && c.unchanged === 0) {
    sendPlanLimitReached(res, { resource: "products", currentPlan: access.planId, requiredPlan: "growth", limit: access.limits.products! });
    return;
  }
  const rowErrors = mapped.issues.filter((i) => i.severity === "error");
  await db.insert(productImportRuns).values({
    id: runId, ownerId, source, filename: filename?.slice(0, 200) ?? null,
    createdCount: c.created, updatedCount: c.updated, unchangedCount: c.unchanged,
    failedCount: c.failed + rowErrors.length, skippedCount: c.skipped,
  });
  res.json({
    runId, source, counts: { ...c, invalid: rowErrors.length }, planLimitReached: summary.planLimitReached,
    results: summary.results, issues: mapped.issues.slice(0, MAX_ISSUES_RETURNED),
    ...(summary.planLimitReached ? { plan: { planId: access.planId, limit: access.limits.products } } : {}),
  });
}

router.post("/csv/commit", requireRole("manager"), csvBody, async (req, res) => {
  const parsed = parseUpload(req);
  if (isFail(parsed)) { res.status(parsed.status).json({ error: parsed.error, message: parsed.message }); return; }
  await runCommit(req, res, parsed.source, parsed.csvMap, typeof req.query.filename === "string" ? req.query.filename : null);
});

router.get("/runs", async (req, res) => {
  const rows = await db.select().from(productImportRuns).where(eq(productImportRuns.ownerId, ownerOf(req)))
    .orderBy(desc(productImportRuns.createdAt)).limit(10);
  res.json({ runs: rows.map((r) => ({
    id: r.id, source: r.source, filename: r.filename, createdAt: r.createdAt,
    created: r.createdCount, updated: r.updatedCount, unchanged: r.unchangedCount, failed: r.failedCount, skipped: r.skippedCount,
  })) });
});

// ─── Etsy ───────────────────────────────────────────────────────────────────

function etsyOff(res: express.Response) {
  res.status(503).json({ error: "ETSY_NOT_ENABLED", message: ETSY_DISABLED_REASON });
}

router.post("/etsy/connect/start", requireRole("manager"), async (req, res) => {
  const cfg = etsyConfig();
  if (!cfg) { etsyOff(res); return; }
  const state = crypto.randomBytes(24).toString("hex");
  const verifier = newCodeVerifier();
  await db.insert(etsyOauthStates).values({
    state, ownerId: ownerOf(req), codeVerifierEncrypted: encryptEtsySecret(verifier),
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });
  res.json({ authorizeUrl: buildEtsyAuthorizeUrl(cfg, state, verifier) });
});

router.post("/etsy/disconnect", requireRole("manager"), async (req, res) => {
  await db.delete(etsyConnections).where(eq(etsyConnections.ownerId, ownerOf(req)));
  res.json({ ok: true });
});

/** Returns a usable access token, refreshing (and re-encrypting) it when close to expiry. */
async function etsyAccess(ownerId: string): Promise<{ accessToken: string; shopId: string } | Fail> {
  const cfg = etsyConfig();
  if (!cfg) return { status: 503, error: "ETSY_NOT_ENABLED", message: ETSY_DISABLED_REASON };
  const [row] = await db.select().from(etsyConnections).where(eq(etsyConnections.ownerId, ownerId)).limit(1);
  if (!row || row.status !== "connected" || !row.shopId) {
    return { status: 409, error: "ETSY_NOT_CONNECTED", message: "Connect your Etsy shop first." };
  }
  try {
    if (row.expiresAt.getTime() - Date.now() > 60_000) return { accessToken: decryptEtsySecret(row.accessTokenEncrypted), shopId: row.shopId };
    const tokens = await getEtsyApi(cfg).refresh(decryptEtsySecret(row.refreshTokenEncrypted));
    await db.update(etsyConnections).set({
      accessTokenEncrypted: encryptEtsySecret(tokens.accessToken),
      refreshTokenEncrypted: encryptEtsySecret(tokens.refreshToken),
      expiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000), status: "connected", lastError: null, updatedAt: new Date(),
    }).where(eq(etsyConnections.id, row.id));
    return { accessToken: tokens.accessToken, shopId: row.shopId };
  } catch (error) {
    await db.update(etsyConnections).set({ status: "error", lastError: "Token refresh failed", updatedAt: new Date() }).where(eq(etsyConnections.id, row.id));
    logger.warn({ err: error }, "Etsy token refresh failed");
    return { status: 409, error: "ETSY_RECONNECT", message: "Your Etsy connection expired. Connect your shop again." };
  }
}

async function loadEtsyProducts(ownerId: string): Promise<{ mapped: MapResult; truncated: boolean; total: number } | Fail> {
  const cfg = etsyConfig();
  if (!cfg) return { status: 503, error: "ETSY_NOT_ENABLED", message: ETSY_DISABLED_REASON };
  const access = await etsyAccess(ownerId);
  if ("status" in access) return access;
  try {
    const { listings, total, truncated } = await fetchAllActiveListings(getEtsyApi(cfg), access.accessToken, access.shopId, MAX_CSV_ROWS);
    if (!listings.length) return { status: 422, error: "NO_LISTINGS", message: "Your Etsy shop has no active listings to import." };
    const { products, issues } = mapEtsyListings(listings);
    return { mapped: { products, issues, ignoredColumns: [] }, truncated, total };
  } catch (error) {
    if (error instanceof EtsyApiError && error.status === 429) return { status: 429, error: "ETSY_RATE_LIMITED", message: "Etsy is limiting requests right now. Try again in a minute." };
    if (error instanceof EtsyApiError && (error.status === 401 || error.status === 403)) {
      await db.update(etsyConnections).set({ status: "error", lastError: "Etsy rejected the token", updatedAt: new Date() }).where(eq(etsyConnections.ownerId, ownerId));
      return { status: 409, error: "ETSY_RECONNECT", message: "Etsy no longer accepts this connection. Connect your shop again." };
    }
    logger.error({ err: error }, "Etsy listing fetch failed");
    return { status: 502, error: "ETSY_UNAVAILABLE", message: "We couldn't reach Etsy. Try again in a moment." };
  }
}

router.post("/etsy/preview", requireRole("manager"), async (req, res) => {
  const loaded = await loadEtsyProducts(ownerOf(req));
  if (isFail(loaded)) { res.status(loaded.status).json({ error: loaded.error, message: loaded.message }); return; }
  const access = await planAccess(req, res);
  if (!access) return;
  const preview = await buildPreview(ownerOf(req), "etsy_api", loaded.mapped, access.limits.products);
  if (loaded.truncated) {
    preview.notes.unshift(`Your shop has ${loaded.total.toLocaleString()} active listings; the first ${MAX_CSV_ROWS.toLocaleString()} are included.`);
  }
  res.json({ layout: "etsy", layoutLabel: "Etsy shop", source: "etsy_api", rowCount: loaded.mapped.products.length, ...preview });
});

router.post("/etsy/commit", requireRole("manager"), async (req, res) => {
  const loaded = await loadEtsyProducts(ownerOf(req));
  if (isFail(loaded)) { res.status(loaded.status).json({ error: loaded.error, message: loaded.message }); return; }
  await runCommit(req, res, "etsy_api", loaded.mapped, "Etsy shop");
});

// ─── Etsy OAuth callback (unauthenticated) ──────────────────────────────────

function resultPage(ok: boolean, message: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: -apple-system, sans-serif; text-align:center; padding-top:80px;">
<h2>${ok ? "Etsy connected" : "Connection failed"}</h2>
<p>${message}</p>
<p>You can close this window and return to Brandthread.</p>
</body></html>`;
}

etsyCallbackRouter.get("/", async (req, res) => {
  const cfg = etsyConfig();
  if (!cfg) { res.status(503).send(resultPage(false, ETSY_DISABLED_REASON)); return; }
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) { res.status(400).send(resultPage(false, "Etsy didn't grant access.")); return; }
  if (!code || !state) { res.status(400).send(resultPage(false, "Missing authorization details.")); return; }
  const [stateRow] = await db.select().from(etsyOauthStates).where(eq(etsyOauthStates.state, state)).limit(1);
  await db.delete(etsyOauthStates).where(eq(etsyOauthStates.state, state));
  if (!stateRow || stateRow.expiresAt < new Date()) {
    res.status(400).send(resultPage(false, "This connection link has expired. Start again from the app."));
    return;
  }
  try {
    const api = getEtsyApi(cfg);
    const tokens = await api.exchangeCode({ code, codeVerifier: decryptEtsySecret(stateRow.codeVerifierEncrypted) });
    const shop = await api.getMyShop(tokens.accessToken);
    const values = {
      etsyUserId: shop.userId, shopId: shop.shopId, shopName: shop.shopName,
      accessTokenEncrypted: encryptEtsySecret(tokens.accessToken),
      refreshTokenEncrypted: encryptEtsySecret(tokens.refreshToken),
      expiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      scopes: "listings_r shops_r", status: "connected", lastError: null, disconnectedAt: null, updatedAt: new Date(),
    };
    await db.insert(etsyConnections).values({ ownerId: stateRow.ownerId, ...values })
      .onConflictDoUpdate({ target: etsyConnections.ownerId, set: values });
    res.send(resultPage(true, `Your Etsy shop ${shop.shopName ? `“${shop.shopName.replace(/[<>&"]/g, "")}” ` : ""}is now connected.`));
  } catch (err) {
    logger.error({ err }, "Etsy OAuth callback failed");
    res.status(500).send(resultPage(false, "Something went wrong finishing the connection. Please try again."));
  }
});

export default router;

