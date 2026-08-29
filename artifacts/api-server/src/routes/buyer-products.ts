/**
 * Buyer-facing product actions (separate from the seller products router).
 *
 * Mounted at /api/buyer/products (before the catch-all /api/buyer).
 *
 * POST   /api/buyer/products/:productId/reserve    — demand signal (no charge)
 * DELETE /api/buyer/products/:productId/reserve    — cancel reservation
 * GET    /api/buyer/products/:productId/reservation — check current buyer's status
 */
import { Router } from "express";
import { db, productReserves, products, drops } from "@workspace/db";
import { eq, and, sql, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

// ── POST /reserve — buyer signals demand for a pre-order product ──────────────

router.post("/:productId/reserve", async (req, res) => {
  const userId    = (req as any).clerkUserId as string;
  const { productId } = req.params;

  const [product] = await db
    .select({ id: products.id, demandCount: products.demandCount, dropId: products.dropId, isPreOrder: products.isPreOrder })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.status, "active"), isNull(products.deletedAt)))
    .limit(1);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  // Upsert — one reserve per buyer per product
  const inserted = await db
    .insert(productReserves)
    .values({ productId, userId })
    .onConflictDoNothing()
    .returning();

  // Only update counts if a NEW reserve was created
  if (inserted.length > 0) {
    await db
      .update(products)
      .set({ demandCount: sql`${products.demandCount} + 1`, updatedAt: new Date() })
      .where(eq(products.id, productId));

    // Increment the linked drop's orderCount too if applicable
    if (product.dropId) {
      await db
        .update(drops)
        .set({ orderCount: sql`${drops.orderCount} + 1`, updatedAt: new Date() })
        .where(eq(drops.id, product.dropId));
    }
  }

  const [fresh] = await db
    .select({ demandCount: products.demandCount })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  res.json({ reserved: true, demandCount: fresh?.demandCount ?? product.demandCount });
});

// ── DELETE /reserve — buyer cancels their reservation ────────────────────────

router.delete("/:productId/reserve", async (req, res) => {
  const userId    = (req as any).clerkUserId as string;
  const { productId } = req.params;

  const deleted = await db
    .delete(productReserves)
    .where(and(eq(productReserves.productId, productId), eq(productReserves.userId, userId)))
    .returning();

  if (deleted.length > 0) {
    await db
      .update(products)
      .set({ demandCount: sql`greatest(${products.demandCount} - 1, 0)`, updatedAt: new Date() })
      .where(eq(products.id, productId));

    // Decrement the linked drop too
    const [product] = await db
      .select({ dropId: products.dropId })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    if (product?.dropId) {
      await db
        .update(drops)
        .set({ orderCount: sql`greatest(${drops.orderCount} - 1, 0)`, updatedAt: new Date() })
        .where(eq(drops.id, product.dropId));
    }
  }

  res.json({ reserved: false });
});

// ── GET /reservation — is the current buyer reserved? ────────────────────────

router.get("/:productId/reservation", async (req, res) => {
  const userId    = (req as any).clerkUserId as string;
  const { productId } = req.params;

  const [entry] = await db
    .select({ id: productReserves.id })
    .from(productReserves)
    .where(and(eq(productReserves.productId, productId), eq(productReserves.userId, userId)))
    .limit(1);

  const [prod] = await db
    .select({ demandCount: products.demandCount })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  res.json({ reserved: !!entry, demandCount: prod?.demandCount ?? 0 });
});

export default router;
