import { Router } from "express";
import { db, products, productVariants } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { logActivity, reqActor } from "../lib/activityLog";
import { notifyBackInStock, notifyStockLevelChanged } from "../lib/stockNotifications";

const router = Router();
router.use(requireAuth);
// Resolve team membership: managers act on the owner's store while the audit
// log keeps track of who actually performed each action.
router.use(teamContext());

function stockStatus(stock: number, threshold: number): "out_of_stock" | "low_stock" | "in_stock" {
  if (stock === 0) return "out_of_stock";
  if (stock <= threshold) return "low_stock";
  return "in_stock";
}

// GET /api/inventory
// Returns all variants with stock levels for the authenticated seller.
router.get("/", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;

  const rows = await db
    .select({
      variantId:         productVariants.id,
      sku:               productVariants.sku,
      size:              productVariants.size,
      color:             productVariants.color,
      stock:             productVariants.stock,
      lowStockThreshold: productVariants.lowStockThreshold,
      priceCents:        productVariants.priceCents,
      productId:         products.id,
      productName:       products.name,
      productStatus:     products.status,
    })
    .from(productVariants)
    .innerJoin(
      products,
      and(eq(productVariants.productId, products.id), eq(products.ownerId, ownerId), isNull(products.deletedAt)),
    )
    .orderBy(products.name);

  const result = rows.map((r) => ({
    ...r,
    status: stockStatus(r.stock, r.lowStockThreshold),
    variantLabel: [r.size, r.color].filter(Boolean).join(" / ") || r.sku,
  }));

  res.json(result);
});

// PATCH /api/inventory/:variantId/adjust
// Body: { delta?: number, newStock?: number }
// Adjusts stock by delta (positive=add, negative=remove), or sets to newStock directly.
router.patch("/:variantId/adjust", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { variantId } = req.params;
  const { delta, newStock } = req.body as { delta?: number; newStock?: number };

  if (delta === undefined && newStock === undefined) {
    return res.status(400).json({ error: "Provide delta or newStock" });
  }

  if (delta !== undefined && !Number.isInteger(delta)) {
    return res.status(400).json({ error: "delta must be an integer" });
  }
  if (newStock !== undefined && (!Number.isInteger(newStock) || newStock < 0)) {
    return res.status(400).json({ error: "newStock must be a non-negative integer" });
  }

  // Read and write under a row lock in one transaction. A paid-order webhook
  // decrements this same row (`stock = stock - qty`); a plain read-then-write
  // here would overwrite that sale with a stale value and oversell.
  const outcome = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        stock: productVariants.stock,
        threshold: productVariants.lowStockThreshold,
        productId: products.id,
        productName: products.name,
      })
      .from(productVariants)
      .innerJoin(
        products,
        and(eq(productVariants.productId, products.id), eq(products.ownerId, ownerId)),
      )
      .where(eq(productVariants.id, variantId))
      .for("update", { of: productVariants });
    if (!row) return { kind: "not_found" as const };

    const target = newStock !== undefined ? newStock : row.stock + (delta ?? 0);
    if (target < 0) return { kind: "negative" as const };

    const [updated] = await tx
      .update(productVariants)
      .set({ stock: target, updatedAt: new Date() })
      .where(eq(productVariants.id, variantId))
      .returning();
    return { kind: "ok" as const, row, updated, updatedStock: target };
  });

  if (outcome.kind === "not_found") return res.status(404).json({ error: "Variant not found" });
  if (outcome.kind === "negative") return res.status(400).json({ error: "Stock cannot go below 0" });
  const { row, updated, updatedStock } = outcome;

  const variantLabel = [updated.size, updated.color].filter(Boolean).join(" / ") || updated.sku;

  {
    const actor = reqActor(req);
    void logActivity(
      actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
      `Adjusted stock for ${variantLabel} to ${updatedStock}`,
      "inventory", variantId, { delta: delta ?? null, newStock: updatedStock },
    );
  }

  void notifyStockLevelChanged({
    productId: row.productId,
    ownerId,
    productName: row.productName,
    previousStock: row.stock,
    newStock: updatedStock,
    lowStockThreshold: row.threshold,
  });
  void notifyBackInStock({
    productId: row.productId,
    ownerId,
    productName: row.productName,
    previousStock: row.stock,
    newStock: updatedStock,
  });

  return res.json({
    ...updated,
    status: stockStatus(updatedStock, updated.lowStockThreshold),
    variantLabel,
  });
});

export default router;
