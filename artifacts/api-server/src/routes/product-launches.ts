/**
 * Scheduled product launches + "Notify me".
 *
 * Public:
 *   GET    /api/product-launches/:productId         launch state for an active product (no subscriber data)
 * Buyer (auth):
 *   GET    /api/product-launches/:productId/alert   am I subscribed?
 *   POST   /api/product-launches/:productId/alert   notify me at launch
 *   DELETE /api/product-launches/:productId/alert   stop
 * Seller (auth, manager):
 *   GET    /api/product-launches                    my launches with notify-me counts
 *   PUT    /api/product-launches/:productId         schedule / reschedule
 *   DELETE /api/product-launches/:productId         cancel the launch (product becomes purchasable)
 */
import { Router } from "express";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, productLaunchAlerts, productLaunches, products } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { requireRole, teamContext } from "../middlewares/requireRole";
import { isProductLive, validateLaunchAt } from "../lib/productLaunch";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function badId(res: any) { res.status(404).json({ error: "Not found" }); }

// ── Seller list ───────────────────────────────────────────────────────────────

router.get("/", requireAuth, teamContext(), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const rows = await db
    .select({
      productId: products.id,
      name: products.name,
      images: products.images,
      status: products.status,
      launchAt: productLaunches.launchAt,
      launchedAt: productLaunches.launchedAt,
      notifyFollowers: productLaunches.notifyFollowers,
      alertCount: sql<number>`(select count(*)::int from ${productLaunchAlerts} where ${productLaunchAlerts.productId} = ${productLaunches.productId})`,
    })
    .from(productLaunches)
    .innerJoin(products, eq(products.id, productLaunches.productId))
    .where(and(eq(products.ownerId, ownerId), isNull(products.deletedAt)))
    .orderBy(asc(productLaunches.launchAt));
  res.json(rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    imageUrl: Array.isArray(r.images) ? (r.images[0] ?? null) : null,
    status: r.status,
    launchAt: r.launchAt.toISOString(),
    launchedAt: r.launchedAt ? r.launchedAt.toISOString() : null,
    notifyFollowers: r.notifyFollowers,
    alertCount: r.alertCount,
  })));
});

// ── Public state ──────────────────────────────────────────────────────────────

router.get("/:productId", async (req, res) => {
  if (!isUuid(req.params.productId)) { badId(res); return; }
  const [row] = await db
    .select({ launchAt: productLaunches.launchAt, launchedAt: productLaunches.launchedAt })
    .from(productLaunches)
    .innerJoin(products, eq(products.id, productLaunches.productId))
    .where(and(eq(productLaunches.productId, req.params.productId), eq(products.status, "active"), isNull(products.deletedAt)))
    .limit(1);
  const now = new Date();
  const launching = !!row && !isProductLive(row, now);
  res.json({
    launching,
    launchAt: launching ? row!.launchAt.toISOString() : null,
    serverNow: now.toISOString(),
  });
});

// ── Buyer notify-me ───────────────────────────────────────────────────────────

router.get("/:productId/alert", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.productId)) { badId(res); return; }
  const [row] = await db
    .select({ id: productLaunchAlerts.id })
    .from(productLaunchAlerts)
    .where(and(eq(productLaunchAlerts.productId, req.params.productId), eq(productLaunchAlerts.userId, userId)))
    .limit(1);
  res.json({ subscribed: !!row });
});

router.post("/:productId/alert", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const productId = req.params.productId;
  if (!isUuid(productId)) { badId(res); return; }
  const [row] = await db
    .select({ launchAt: productLaunches.launchAt, launchedAt: productLaunches.launchedAt })
    .from(productLaunches)
    .innerJoin(products, eq(products.id, productLaunches.productId))
    .where(and(eq(productLaunches.productId, productId), eq(products.status, "active"), isNull(products.deletedAt)))
    .limit(1);
  if (!row) { res.status(404).json({ error: "This product has no scheduled launch." }); return; }
  if (isProductLive(row)) { res.status(409).json({ error: "This product has already launched.", code: "ALREADY_LAUNCHED" }); return; }
  await db.insert(productLaunchAlerts).values({ productId, userId }).onConflictDoNothing();
  res.json({ subscribed: true });
});

router.delete("/:productId/alert", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  if (!isUuid(req.params.productId)) { badId(res); return; }
  await db
    .delete(productLaunchAlerts)
    .where(and(eq(productLaunchAlerts.productId, req.params.productId), eq(productLaunchAlerts.userId, userId)));
  res.json({ subscribed: false });
});

// ── Seller schedule / cancel ──────────────────────────────────────────────────

router.put("/:productId", requireAuth, teamContext(), requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const productId = req.params.productId;
  if (!isUuid(productId)) { badId(res); return; }
  const rawLaunchAt = (req.body as any)?.launchAt;
  const rawNotify = (req.body as any)?.notifyFollowers;
  if (typeof rawLaunchAt !== "string" || !rawLaunchAt || (rawNotify != null && typeof rawNotify !== "boolean")) { res.status(400).json({ error: "Choose a launch date and time.", code: "VALIDATION_ERROR" }); return; }

  const launchAt = new Date(rawLaunchAt);
  const problem = validateLaunchAt(launchAt);
  if (problem) { res.status(400).json({ error: problem, code: "INVALID_LAUNCH_AT" }); return; }

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, ownerId), isNull(products.deletedAt)))
    .limit(1);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const [existing] = await db
    .select({ launchedAt: productLaunches.launchedAt })
    .from(productLaunches)
    .where(eq(productLaunches.productId, productId))
    .limit(1);
  if (existing?.launchedAt) {
    res.status(409).json({ error: "This product has already launched.", code: "ALREADY_LAUNCHED" });
    return;
  }

  const notifyFollowers = rawNotify ?? false;
  await db
    .insert(productLaunches)
    .values({ productId, launchAt, notifyFollowers })
    .onConflictDoUpdate({
      target: productLaunches.productId,
      set: { launchAt, notifyFollowers, updatedAt: new Date() },
    });
  res.json({ productId, launchAt: launchAt.toISOString(), notifyFollowers });
});

router.delete("/:productId", requireAuth, teamContext(), requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const productId = req.params.productId;
  if (!isUuid(productId)) { badId(res); return; }
  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.ownerId, ownerId)))
    .limit(1);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  await db.delete(productLaunches).where(eq(productLaunches.productId, productId));
  // Pending subscribers are dropped with the launch; nobody is notified for a cancelled launch.
  await db.delete(productLaunchAlerts).where(and(eq(productLaunchAlerts.productId, productId), isNull(productLaunchAlerts.notifiedAt)));
  res.json({ cancelled: true });
});

export default router;
