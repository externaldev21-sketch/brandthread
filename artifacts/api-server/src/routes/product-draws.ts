/**
 * Draws for limited drops. Engine: lib/productDraws.ts.
 *
 * Public:
 *   GET    /api/product-draws/:productId                 draw state (window, status, seed hash)
 * Buyer (auth):
 *   GET    /api/product-draws/:productId/entry           my entry + result
 *   POST   /api/product-draws/:productId/entry/quote     what the entry would authorise
 *   POST   /api/product-draws/:productId/entry           enter: returns the PaymentIntent client secret
 *   POST   /api/product-draws/:productId/entry/confirm   after the app confirmed the card
 *   DELETE /api/product-draws/:productId/entry           withdraw while entries are open
 * Seller (auth, manager):
 *   PUT    /api/product-draws/:productId                 set draw mode + when entries close
 *   DELETE /api/product-draws/:productId                 cancel before the draw runs (releases every hold)
 *   GET    /api/product-draws/:productId/audit           the audit log
 */
import { Router, type Response } from "express";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { db, productDrawEntries, productDrawEvents, productDraws, productLaunches, products } from "@workspace/db";
import { z } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { validateRequest } from "../middlewares/validateRequest";
import { requireStripe } from "../lib/stripe";
import { isFeatureEnabled } from "../lib/threadCash/wallet";
import {
  DRAW_FEATURE_FLAG, DrawError, cancelDraw, confirmEntry, loadDraw, newDrawSeed, priceDrawEntry, recordDrawEvent,
  startEntry, validateDrawWindow, withdrawEntry,
} from "../lib/productDraws";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function notFound(res: Response) { res.status(404).json({ error: "Not found" }); }

function sendError(res: Response, error: unknown): boolean {
  if (error instanceof DrawError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

function stripeOr503(res: Response) {
  try {
    return requireStripe();
  } catch {
    res.status(503).json({ error: "Payments are unavailable right now.", code: "STRIPE_NOT_CONFIGURED" });
    return null;
  }
}

// ── Public state ──────────────────────────────────────────────────────────────

router.get("/:productId", async (req, res) => {
  if (!isUuid(req.params.productId)) { notFound(res); return; }
  const [product] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, req.params.productId), eq(products.status, "active"), isNull(products.deletedAt))).limit(1);
  const draw = product ? await loadDraw(req.params.productId) : null;
  res.json({ draw: draw && draw.status !== "cancelled" ? draw : null, serverNow: new Date().toISOString() });
});

// ── Buyer ─────────────────────────────────────────────────────────────────────

const entrySchema = z.object({
  variantId: z.string().uuid(),
  addressId: z.string().uuid(),
  notifyResult: z.boolean().optional(),
});

router.get("/:productId/entry", requireAuth, async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.productId)) { notFound(res); return; }
  const [entry] = await db.select({
    id: productDrawEntries.id, status: productDrawEntries.status, variantId: productDrawEntries.variantId,
    amountCents: productDrawEntries.amountCents, priced: productDrawEntries.priced, decidedAt: productDrawEntries.decidedAt,
    notifyResult: productDrawEntries.notifyResult,
  }).from(productDrawEntries)
    .where(and(eq(productDrawEntries.productId, req.params.productId), eq(productDrawEntries.buyerId, buyerId))).limit(1);
  if (!entry || entry.status === "withdrawn") { res.json({ entry: null }); return; }
  res.json({
    entry: {
      id: entry.id,
      status: entry.status,
      variantId: entry.variantId,
      variantLabel: entry.priced.items[0]?.variantLabel ?? "",
      amountCents: entry.amountCents,
      notifyResult: entry.notifyResult,
      decidedAt: entry.decidedAt ? entry.decidedAt.toISOString() : null,
    },
  });
});

router.post("/:productId/entry/quote", requireAuth, validateRequest({ body: entrySchema }), async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.productId)) { notFound(res); return; }
  if (!(await isFeatureEnabled(DRAW_FEATURE_FLAG))) { notFound(res); return; }
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const body = req.body as z.infer<typeof entrySchema>;
  try {
    const { snapshot } = await priceDrawEntry(stripe, { buyerId, productId: req.params.productId, variantId: body.variantId, addressId: body.addressId });
    res.json({
      subtotalCents: snapshot.subtotalCents, shippingCents: snapshot.shippingCents, taxCents: snapshot.taxCents,
      totalCents: snapshot.totalCents, variantLabel: snapshot.items[0]?.variantLabel ?? "",
    });
  } catch (error) {
    if (sendError(res, error)) return;
    throw error;
  }
});

router.post("/:productId/entry", requireAuth, validateRequest({ body: entrySchema }), async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.productId)) { notFound(res); return; }
  if (!(await isFeatureEnabled(DRAW_FEATURE_FLAG))) { notFound(res); return; }
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const body = req.body as z.infer<typeof entrySchema>;
  try {
    res.json(await startEntry(stripe, {
      buyerId, productId: req.params.productId, variantId: body.variantId, addressId: body.addressId,
      notifyResult: body.notifyResult ?? false,
    }));
  } catch (error) {
    if (sendError(res, error)) return;
    throw error;
  }
});

router.post("/:productId/entry/confirm", requireAuth, async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.productId)) { notFound(res); return; }
  const stripe = stripeOr503(res);
  if (!stripe) return;
  try {
    res.json(await confirmEntry(stripe, { buyerId, productId: req.params.productId }));
  } catch (error) {
    if (sendError(res, error)) return;
    throw error;
  }
});

router.delete("/:productId/entry", requireAuth, async (req, res) => {
  const buyerId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.productId)) { notFound(res); return; }
  const stripe = stripeOr503(res);
  if (!stripe) return;
  try {
    res.json(await withdrawEntry(stripe, { buyerId, productId: req.params.productId }));
  } catch (error) {
    if (sendError(res, error)) return;
    throw error;
  }
});

// ── Seller ────────────────────────────────────────────────────────────────────

async function ownedProduct(ownerId: string, productId: string) {
  const [product] = await db.select({ id: products.id }).from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, ownerId), isNull(products.deletedAt))).limit(1);
  return product ?? null;
}

router.put("/:productId", requireAuth, teamContext(), requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const productId = req.params.productId;
  if (!isUuid(productId)) { notFound(res); return; }
  if (!(await isFeatureEnabled(DRAW_FEATURE_FLAG))) {
    res.status(403).json({ error: "Draws aren't available yet.", code: "FEATURE_DISABLED" });
    return;
  }
  const raw = (req.body as any)?.entryClosesAt;
  if (typeof raw !== "string" || !raw) { res.status(400).json({ error: "Choose when entries close.", code: "VALIDATION_ERROR" }); return; }
  if (!(await ownedProduct(ownerId, productId))) { res.status(404).json({ error: "Product not found" }); return; }

  const [launch] = await db.select({ launchAt: productLaunches.launchAt, launchedAt: productLaunches.launchedAt })
    .from(productLaunches).where(eq(productLaunches.productId, productId)).limit(1);
  if (!launch) { res.status(409).json({ error: "Schedule the drop first.", code: "NO_LAUNCH" }); return; }

  const entryClosesAt = new Date(raw);
  const problem = validateDrawWindow(launch.launchAt, entryClosesAt);
  if (problem) { res.status(400).json({ error: problem, code: "INVALID_WINDOW" }); return; }

  const [existing] = await db.select({ status: productDraws.status }).from(productDraws).where(eq(productDraws.productId, productId)).limit(1);
  if (existing && existing.status !== "open" && existing.status !== "cancelled") {
    res.status(409).json({ error: "This draw has already run.", code: "DRAW_CLOSED" });
    return;
  }
  const [{ n: entries }] = await db.select({ n: count() }).from(productDrawEntries)
    .where(and(eq(productDrawEntries.productId, productId), eq(productDrawEntries.status, "entered")));
  if (existing?.status === "open" && entries > 0) {
    // People entered under the current window; moving it would change the deal they entered.
    res.status(409).json({ error: "People have entered. Cancel the draw to change it.", code: "HAS_ENTRIES" });
    return;
  }

  const now = new Date();
  if (existing) {
    const reopen = existing.status === "cancelled" ? newDrawSeed() : null;
    await db.update(productDraws).set({
      entryClosesAt, status: "open", updatedAt: now, drawnAt: null,
      ...(reopen ? { seed: reopen.seed, seedHash: reopen.seedHash } : {}),
    }).where(eq(productDraws.productId, productId));
    await recordDrawEvent(db, { productId, kind: "updated", actor: ownerId, detail: { entryClosesAt: entryClosesAt.toISOString() } });
  } else {
    const { seed, seedHash } = newDrawSeed();
    await db.insert(productDraws).values({ productId, entryClosesAt, seed, seedHash });
    await recordDrawEvent(db, { productId, kind: "created", actor: ownerId, detail: { opensAt: launch.launchAt.toISOString(), entryClosesAt: entryClosesAt.toISOString(), seedHash } });
  }
  res.json(await loadDraw(productId));
});

router.delete("/:productId", requireAuth, teamContext(), requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const productId = req.params.productId;
  if (!isUuid(productId)) { notFound(res); return; }
  if (!(await ownedProduct(ownerId, productId))) { res.status(404).json({ error: "Product not found" }); return; }
  const stripe = stripeOr503(res);
  if (!stripe) return;
  const cancelled = await cancelDraw(stripe, productId, ownerId);
  if (!cancelled) { res.status(409).json({ error: "This draw has already run.", code: "DRAW_CLOSED" }); return; }
  res.json({ cancelled: true });
});

router.get("/:productId/audit", requireAuth, teamContext(), requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const productId = req.params.productId;
  if (!isUuid(productId)) { notFound(res); return; }
  if (!(await ownedProduct(ownerId, productId))) { res.status(404).json({ error: "Product not found" }); return; }
  const events = await db.select().from(productDrawEvents)
    .where(eq(productDrawEvents.productId, productId)).orderBy(asc(productDrawEvents.createdAt));
  res.json(events.map((e) => ({
    id: e.id, kind: e.kind, entryId: e.entryId, actor: e.actor, detail: e.detail, createdAt: e.createdAt.toISOString(),
  })));
});

export default router;
