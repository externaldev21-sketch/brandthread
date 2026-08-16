import { Router } from "express";
import { db, products, productVariants } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

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
      and(eq(productVariants.productId, products.id), eq(products.ownerId, ownerId)),
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
router.patch("/:variantId/adjust", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { variantId } = req.params;
  const { delta, newStock } = req.body as { delta?: number; newStock?: number };

  if (delta === undefined && newStock === undefined) {
    return res.status(400).json({ error: "Provide delta or newStock" });
  }

  // Verify ownership via join
  const [row] = await db
    .select({ stock: productVariants.stock, threshold: productVariants.lowStockThreshold })
    .from(productVariants)
    .innerJoin(
      products,
      and(eq(productVariants.productId, products.id), eq(products.ownerId, ownerId)),
    )
    .where(eq(productVariants.id, variantId));

  if (!row) return res.status(404).json({ error: "Variant not found" });

  const updatedStock =
    newStock !== undefined ? newStock : row.stock + (delta ?? 0);

  if (updatedStock < 0) {
    return res.status(400).json({ error: "Stock cannot go below 0" });
  }

  const [updated] = await db
    .update(productVariants)
    .set({ stock: updatedStock, updatedAt: new Date() })
    .where(eq(productVariants.id, variantId))
    .returning();

  return res.json({
    ...updated,
    status: stockStatus(updatedStock, updated.lowStockThreshold),
    variantLabel: [updated.size, updated.color].filter(Boolean).join(" / ") || updated.sku,
  });
});

export default router;
