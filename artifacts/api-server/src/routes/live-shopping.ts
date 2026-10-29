/**
 * Live shopping extras (F6 live-commerce). Mounted at /api/live before
 * routes/live.ts so these literal sub-paths never fall into its GET /:id.
 *
 *  GET  /api/live/:id/bag               everything buyable in the live: host tags + co-host products
 *  PUT  /api/live/:id/cohost/products   an accepted co-host sets which of their products are in the bag
 *  GET  /api/live/:id/activity?since=   "just bought" + gift rows for clients that poll (app/live.tsx)
 *
 * Realtime clients get the same rows as `purchase` / `gift` / `bag` socket
 * events (see lib/livePurchases.ts, routes/thread-cash.ts).
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/requireAuth";
import { isBlockedEitherWay, optionalViewerId } from "../lib/safety";
import { broadcastToRoom } from "../ws/liveHub";
import { loadLiveBag } from "../lib/liveBag";
import { listLiveActivity } from "../lib/livePurchases";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_COHOST_PRODUCTS = 20;

router.get("/:id/bag", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Not found" });
  try {
    const bag = await loadLiveBag(id);
    if (!bag) return res.status(404).json({ error: "Not found" });
    const viewerId = optionalViewerId(req);
    if (viewerId && viewerId !== bag.sellerId && await isBlockedEitherWay(viewerId, bag.sellerId)) {
      return res.status(404).json({ error: "Not found" });
    }
    return res.json({ products: bag.products });
  } catch (e) {
    // Log the cause; never echo database error text to the client.
    logger.error({ err: e, path: req.path }, "live shopping request failed");
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.put("/:id/cohost/products", requireAuth, async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Not found" });
  const raw = req.body?.productIds;
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== "string" || !UUID_RE.test(p))) {
    return res.status(400).json({ error: "productIds must be an array of product ids" });
  }
  const productIds = [...new Set(raw as string[])];
  if (productIds.length > MAX_COHOST_PRODUCTS) {
    return res.status(400).json({ error: `Add up to ${MAX_COHOST_PRODUCTS} products` });
  }
  try {
    const onStage = await db.execute(sql`
      SELECT 1 FROM live_cohosts lc JOIN live_streams ls ON ls.id = lc.stream_id
      WHERE lc.stream_id = ${id}::uuid AND lc.cohost_id = ${userId} AND lc.status = 'accepted' AND ls.status = 'live'
      LIMIT 1
    `);
    if (!onStage.rows.length) return res.status(403).json({ error: "Only a co-host on stage can add products to this live" });
    if (productIds.length) {
      const owned = await db.execute(sql`
        SELECT count(*)::int AS n FROM products
        WHERE id IN (${sql.join(productIds.map((p) => sql`${p}::uuid`), sql`, `)})
          AND owner_id = ${userId} AND status = 'active' AND deleted_at IS NULL
      `);
      if (Number((owned.rows[0] as any)?.n ?? 0) !== productIds.length) {
        return res.status(400).json({ error: "You can only add your own active products" });
      }
    }
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM live_cohost_products WHERE stream_id = ${id}::uuid AND cohost_id = ${userId}`);
      for (const productId of productIds) {
        await tx.execute(sql`
          INSERT INTO live_cohost_products (stream_id, cohost_id, product_id, created_at)
          VALUES (${id}::uuid, ${userId}, ${productId}::uuid, clock_timestamp())
          ON CONFLICT DO NOTHING
        `);
      }
    });
    const bag = await loadLiveBag(id);
    broadcastToRoom(id, { type: "bag", products: bag?.products ?? [] });
    return res.json({ products: bag?.products ?? [] });
  } catch (e) {
    // Log the cause; never echo database error text to the client.
    logger.error({ err: e, path: req.path }, "live shopping request failed");
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.get("/:id/activity", async (req, res) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) return res.json({ activity: [] });
  const sinceRaw = typeof req.query.since === "string" ? Date.parse(req.query.since) : NaN;
  // Never more than the last 10 minutes: a ticker, not a history.
  const floor = Date.now() - 10 * 60_000;
  const since = new Date(Number.isFinite(sinceRaw) ? Math.max(sinceRaw, floor) : floor);
  try {
    const viewerId = optionalViewerId(req);
    if (viewerId) {
      const host = await db.execute(sql`SELECT seller_id FROM live_streams WHERE id = ${id}::uuid`);
      const sellerId = (host.rows[0] as any)?.seller_id as string | undefined;
      if (sellerId && viewerId !== sellerId && await isBlockedEitherWay(viewerId, sellerId)) {
        return res.json({ activity: [] });
      }
    }
    return res.json({ activity: await listLiveActivity(id, since) });
  } catch (e) {
    // Log the cause; never echo database error text to the client.
    logger.error({ err: e, path: req.path }, "live shopping request failed");
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

export default router;
