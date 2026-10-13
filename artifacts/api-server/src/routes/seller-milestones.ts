/**
 * Seller milestones (migration 291).
 * GET  /api/seller/milestones/next        — record newly reached milestones; return the highest unseen one, or null
 * POST /api/seller/milestones/:key/seen   — the seller shared or closed the card; never show it again
 *
 * Evaluated lazily here (no job, no push): the dashboard asks on load. When
 * several are reached at once (a seller with history the first time this
 * runs), all are recorded but only the highest is surfaced; the lower ones
 * are marked seen. Inserts are ON CONFLICT DO NOTHING, so two dashboards
 * loading at the same moment can't double-record or error.
 * Mounted behind teamContext, so `req.clerkUserId` is the store owner.
 */
import { Router } from "express";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, products, sellerMilestones, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  isMilestoneKey,
  milestoneLabel,
  milestoneRank,
  planSurface,
  reachedMilestones,
  type MilestoneKey,
  type SellerTotals,
} from "../lib/sellerMilestones";

export interface NextMilestoneResponse {
  key: MilestoneKey;
  label: string;
  reachedAt: string;
  storeName: string;
  handle: string | null;
  productImageUrl: string | null;
}

const rows = (result: unknown) => ((result as { rows?: unknown[] }).rows ?? []) as Array<Record<string, unknown>>;

export async function sellerTotals(ownerId: string): Promise<SellerTotals> {
  const [row] = rows(await db.execute(sql`
    SELECT count(*)::int AS orders,
           coalesce(sum(greatest(total_cents - coalesce(refunded_cents, 0), 0)), 0)::bigint AS sales_cents
    FROM orders
    WHERE owner_id = ${ownerId} AND paid_at IS NOT NULL AND status != 'cancelled'
  `));
  return { orders: Number(row?.orders ?? 0), salesCents: Number(row?.sales_cents ?? 0) };
}

/**
 * The product a milestone card shows: for "First sale", the product in the
 * seller's first order; otherwise their best seller by units.
 */
async function milestoneProductId(ownerId: string, key: MilestoneKey): Promise<string | null> {
  const query = key === "first_sale"
    ? sql`
      SELECT p.id
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN product_variants v ON v.id = oi.variant_id
      JOIN products p ON p.id = v.product_id AND p.owner_id = ${ownerId}
      WHERE o.owner_id = ${ownerId} AND o.paid_at IS NOT NULL AND o.status != 'cancelled'
      ORDER BY o.paid_at ASC, oi.id ASC
      LIMIT 1`
    : sql`
      SELECT p.id
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN product_variants v ON v.id = oi.variant_id
      JOIN products p ON p.id = v.product_id AND p.owner_id = ${ownerId} AND p.deleted_at IS NULL
      WHERE o.owner_id = ${ownerId} AND o.paid_at IS NOT NULL AND o.status != 'cancelled'
      GROUP BY p.id
      ORDER BY sum(oi.quantity) DESC, p.id
      LIMIT 1`;
  const [row] = rows(await db.execute(query));
  return row?.id ? String(row.id) : null;
}

/** Records newly reached milestones, then returns the highest unseen one (superseding lower ones). */
export async function nextMilestone(ownerId: string): Promise<NextMilestoneResponse | null> {
  const reached = reachedMilestones(await sellerTotals(ownerId));
  if (reached.length > 0) {
    const known = new Set((await db.select({ key: sellerMilestones.key }).from(sellerMilestones)
      .where(eq(sellerMilestones.ownerId, ownerId))).map((r) => r.key));
    const fresh = reached.filter((k) => !known.has(k));
    if (fresh.length > 0) {
      const top = fresh.reduce((a, b) => (milestoneRank(b) > milestoneRank(a) ? b : a));
      const productId = await milestoneProductId(ownerId, top);
      await db.insert(sellerMilestones)
        .values(fresh.map((key) => ({ ownerId, key, productId: key === top ? productId : null })))
        .onConflictDoNothing({ target: [sellerMilestones.ownerId, sellerMilestones.key] });
    }
  }

  const unseen = (await db.select().from(sellerMilestones)
    .where(and(eq(sellerMilestones.ownerId, ownerId), isNull(sellerMilestones.seenAt))))
    .filter((r) => isMilestoneKey(r.key));
  const { surface, supersede } = planSurface(unseen.map((r) => r.key as MilestoneKey));
  if (supersede.length > 0) {
    await db.update(sellerMilestones)
      .set({ seenAt: new Date() })
      .where(and(eq(sellerMilestones.ownerId, ownerId), inArray(sellerMilestones.key, supersede), isNull(sellerMilestones.seenAt)));
  }
  if (!surface) return null;
  const row = unseen.find((r) => r.key === surface)!;

  // No product was recorded (the seller had none with a sale then); look again.
  let productId = row.productId;
  if (!productId) {
    productId = await milestoneProductId(ownerId, surface);
    if (productId) {
      await db.update(sellerMilestones).set({ productId })
        .where(and(eq(sellerMilestones.ownerId, ownerId), eq(sellerMilestones.key, surface)));
    }
  }

  const [[user], [product]] = await Promise.all([
    db.select({ brandName: users.brandName, displayName: users.displayName, username: users.username })
      .from(users).where(eq(users.clerkId, ownerId)).limit(1),
    productId
      ? db.select({ images: products.images }).from(products)
        .where(and(eq(products.id, productId), eq(products.ownerId, ownerId), isNull(products.deletedAt))).limit(1)
      : Promise.resolve([] as Array<{ images: string[] }>),
  ]);
  const image = Array.isArray(product?.images) ? product.images.find((u) => typeof u === "string" && u.length > 0) : undefined;

  return {
    key: surface,
    label: milestoneLabel(surface),
    reachedAt: row.reachedAt.toISOString(),
    storeName: user?.brandName || user?.displayName || user?.username || "Your store",
    handle: user?.username ?? null,
    productImageUrl: image ?? null,
  };
}

const router = Router();
router.use(requireAuth);

router.get("/next", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  try {
    res.json(await nextMilestone(ownerId));
  } catch (error) {
    req.log?.error?.({ err: error }, "milestones next failed");
    res.status(500).json({ error: "Could not load milestones" });
  }
});

router.post("/:key/seen", async (req, res): Promise<void> => {
  const ownerId = (req as any).clerkUserId as string;
  const key = req.params.key;
  if (!isMilestoneKey(key)) {
    res.status(404).json({ error: "Unknown milestone" });
    return;
  }
  await db.update(sellerMilestones)
    .set({ seenAt: new Date() })
    .where(and(eq(sellerMilestones.ownerId, ownerId), eq(sellerMilestones.key, key), isNull(sellerMilestones.seenAt)));
  res.status(204).end();
});

export default router;
