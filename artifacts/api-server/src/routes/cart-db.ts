/**
 * Server-side cart persistence — full-replace sync model.
 * The client keeps AsyncStorage as the primary store; this is a durable backup.
 *
 * GET    /api/buyer/cart       — load cart from DB
 * POST   /api/buyer/cart/sync  — full replace (delete all + insert new)
 * DELETE /api/buyer/cart       — clear cart
 */
import { Router } from "express";
import { db, cartItems, products, productVariants } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { newlyAddedVariantIds, recordAddToCartEvents } from "../lib/sellerProductEvents";
import { isProductAvailable } from "../lib/productVisibility";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CartRow = typeof cartItems.$inferSelect;

function cartLineProductId(r: CartRow, variantToProduct: Map<string, string>): string | null {
  const productId = (r.itemData as any)?.productId;
  if (typeof productId === "string" && UUID_RE.test(productId)) return productId;
  return variantToProduct.get(r.variantId) ?? null;
}

/** Product ids in these cart rows that are deleted or no longer active. */
async function unavailableCartProductIds(rows: CartRow[]) {
  const variantIds = rows.map((r) => r.variantId).filter((id) => UUID_RE.test(id));
  const variantRows = variantIds.length === 0 ? [] : await db
    .select({ id: productVariants.id, productId: productVariants.productId })
    .from(productVariants)
    .where(inArray(productVariants.id, variantIds));
  const variantToProduct = new Map(variantRows.map((v) => [v.id, v.productId]));
  const productIds = [...new Set(rows.map((r) => cartLineProductId(r, variantToProduct)).filter((id): id is string => !!id))];
  const productRows = productIds.length === 0 ? [] : await db
    .select({ id: products.id, status: products.status, deletedAt: products.deletedAt })
    .from(products)
    .where(inArray(products.id, productIds));
  return {
    variantToProduct,
    ids: new Set(productRows.filter((p) => !isProductAvailable(p)).map((p) => p.id)),
  };
}

const router = Router();
router.use(requireAuth);

// GET /api/buyer/cart
router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select().from(cartItems).where(eq(cartItems.userId, userId));
  const unavailable = await unavailableCartProductIds(rows);
  // Lines whose product was deleted / taken off sale stay in the bag (the
  // seller may undo a delete) but are flagged so they can't be checked out.
  const withAvailability = (r: typeof rows[number]) => {
    const productId = cartLineProductId(r, unavailable.variantToProduct);
    return productId && unavailable.ids.has(productId)
      ? { ...(r.itemData as object), unavailable: true, isAvailable: false, unavailableReason: "No longer available" }
      : r.itemData;
  };

  return res.json({
    items:      rows.filter((r) => !r.savedForLater).map(withAvailability),
    savedItems: rows.filter((r) =>  r.savedForLater).map(withAvailability),
  });
});

// POST /api/buyer/cart/sync — full replace
router.post("/sync", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { items = [], savedItems: saved = [] } = req.body as {
    items?: any[];
    savedItems?: any[];
  };

  // Analytics only: remember which lines were already in the cart so a full
  // replace sync can tell genuinely new add-to-carts apart. Never blocks sync.
  const previousVariantIds: string[] = await db
    .select({ variantId: cartItems.variantId, savedForLater: cartItems.savedForLater })
    .from(cartItems)
    .where(eq(cartItems.userId, userId))
    .then((prev) => prev.filter((r) => !r.savedForLater).map((r) => r.variantId))
    .catch(() => []);

  await db.delete(cartItems).where(eq(cartItems.userId, userId));

  const rows: (typeof cartItems.$inferInsert)[] = [
    ...items.map((item: any) => ({
      userId,
      variantId:     String(item.variantId ?? item.id ?? "unknown"),
      savedForLater: false as const,
      itemData:      item,
    })),
    ...(saved as any[]).map((item: any) => ({
      userId,
      variantId:     String(item.variantId ?? item.id ?? "unknown"),
      savedForLater: true as const,
      itemData:      item,
    })),
  ];

  if (rows.length > 0) {
    await db.insert(cartItems).values(rows);
  }

  // Fire-and-forget: recordAddToCartEvents swallows its own errors.
  void recordAddToCartEvents(
    userId,
    newlyAddedVariantIds(previousVariantIds, rows.filter((r) => !r.savedForLater).map((r) => r.variantId)),
  );

  return res.json({ ok: true, count: rows.length });
});

// DELETE /api/buyer/cart
router.delete("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.delete(cartItems).where(eq(cartItems.userId, userId));
  return res.json({ ok: true });
});

export default router;
