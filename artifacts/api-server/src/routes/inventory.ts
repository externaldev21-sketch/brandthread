import { Router } from "express";
import { db, products, productVariants, sellerInventorySettings } from "@workspace/db";
import { eq, and, asc, isNull, lte } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext, requireRole } from "../middlewares/requireRole";
import { logActivity, reqActor } from "../lib/activityLog";
import { notifyBackInStock, notifyStockLevelChanged } from "../lib/stockNotifications";
import { afterStockChange } from "../lib/stockRules";
import { lookupInventoryCode, normalizeScanCode, stockStatus } from "../lib/inventoryLookup";
import { productThumbnail } from "../lib/activityEvents";
import {
  PLATFORM_LOW_STOCK_THRESHOLD, getStoreLowStockThreshold, parseLowStockThreshold,
  resetVariantsToInherit, syncInheritedLowStock,
} from "../lib/lowStockThreshold";

const router = Router();
router.use(requireAuth);
// Resolve team membership: managers act on the owner's store while the audit
// log keeps track of who actually performed each action.
router.use(teamContext());

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

// GET /api/inventory/lookup?code=
// Barcode or SKU match for the inventory scanner. A read, so every team role
// that can open the store (packers included) can scan; adjusting stays manager+.
router.get("/lookup", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const code = normalizeScanCode(req.query.code);
  if (!code) return res.status(400).json({ error: "Enter a barcode or SKU" });
  const matches = await lookupInventoryCode(ownerId, code);
  return res.json({ code, matches });
});

const LOW_STOCK_SUMMARY_LIMIT = 50;

async function lowStockSettingsPayload(ownerId: string) {
  const store = await getStoreLowStockThreshold(ownerId);
  const rows = await db
    .select({
      variantId: productVariants.id, size: productVariants.size, color: productVariants.color, sku: productVariants.sku,
      stock: productVariants.stock, lowStockThreshold: productVariants.lowStockThreshold,
      productId: products.id, productName: products.name, images: products.images,
    })
    .from(productVariants)
    .innerJoin(products, and(eq(productVariants.productId, products.id), eq(products.ownerId, ownerId), isNull(products.deletedAt)))
    .where(lte(productVariants.stock, productVariants.lowStockThreshold))
    .orderBy(asc(productVariants.stock), asc(products.name))
    .limit(LOW_STOCK_SUMMARY_LIMIT + 1);
  return {
    lowStockThresholdDefault: store ?? PLATFORM_LOW_STOCK_THRESHOLD,
    isCustom: store !== null,
    platformDefault: PLATFORM_LOW_STOCK_THRESHOLD,
    lowStock: rows.slice(0, LOW_STOCK_SUMMARY_LIMIT).map((r) => ({
      variantId: r.variantId, productId: r.productId, productName: r.productName, sku: r.sku,
      variantLabel: [r.size, r.color].filter(Boolean).join(" / "),
      stock: r.stock, lowStockThreshold: r.lowStockThreshold, imageUrl: productThumbnail(r.images),
      status: stockStatus(r.stock, r.lowStockThreshold),
    })),
    hasMore: rows.length > LOW_STOCK_SUMMARY_LIMIT,
  };
}

// GET /api/inventory/settings
// The store-wide low-stock level and the variants at or below their level now.
router.get("/settings", async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  return res.json(await lowStockSettingsPayload(ownerId));
});

// PUT /api/inventory/settings
// Body: { lowStockThresholdDefault: number, applyToExisting?: boolean }
// Saves the store level and re-resolves every variant that follows the
// defaults. applyToExisting also makes variants with their own level follow
// it again (products with their own default keep that default).
router.put("/settings", requireRole("manager"), async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const level = parseLowStockThreshold(req.body?.lowStockThresholdDefault);
  if (level === null) return res.status(400).json({ error: "Low stock level must be a whole number of 0 or more" });
  const now = new Date();
  await db.insert(sellerInventorySettings)
    .values({ sellerId: ownerId, lowStockThresholdDefault: level, updatedAt: now })
    .onConflictDoUpdate({ target: sellerInventorySettings.sellerId, set: { lowStockThresholdDefault: level, updatedAt: now } });
  if (req.body?.applyToExisting === true) await resetVariantsToInherit({ ownerId });
  else await syncInheritedLowStock({ ownerId });
  const actor = reqActor(req);
  void logActivity(actor.ownerClerkId, actor.actorClerkId, actor.actorRole,
    `Set the store low stock level to ${level}`, "inventory", ownerId, { lowStockThresholdDefault: level, applyToExisting: req.body?.applyToExisting === true });
  return res.json(await lowStockSettingsPayload(ownerId));
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

  // Verify ownership via join
  const [row] = await db
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

  await afterStockChange(row.productId);

  return res.json({
    ...updated,
    status: stockStatus(updatedStock, updated.lowStockThreshold),
    variantLabel,
  });
});

export default router;
