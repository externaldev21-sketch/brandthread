/**
 * Server-side cart persistence — full-replace sync model.
 * The client keeps AsyncStorage as the primary store; this is a durable backup.
 *
 * GET    /api/buyer/cart       — load cart from DB (each line + `live` catalog fields)
 * POST   /api/buyer/cart/sync  — full replace (delete all + insert new)
 * DELETE /api/buyer/cart       — clear cart
 */
import { Router } from "express";
import { db, cartItems } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { newlyAddedVariantIds, recordAddToCartEvents } from "../lib/sellerProductEvents";
import { loadCartLiveFields } from "../lib/cartLive";

const router = Router();

/** `live` is computed per read; it is never part of the stored snapshot. */
function stripLive(item: any): any {
  if (!item || typeof item !== "object" || !("live" in item)) return item;
  const { live: _live, ...rest } = item;
  return rest;
}
router.use(requireAuth);

// GET /api/buyer/cart
router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select().from(cartItems).where(eq(cartItems.userId, userId));

  // Each line keeps its stored snapshot shape and gains `live` (current price,
  // stock and availability from the catalog). A catalog read failure never
  // fails the bag load — lines are then returned without `live`.
  const data = rows.map((r) => (r.itemData && typeof r.itemData === "object" ? r.itemData as Record<string, unknown> : {}));
  const live = await loadCartLiveFields(data).catch(() => null);
  const withLive = rows.map((r, i) => (live ? { ...data[i], live: live[i] } : r.itemData));

  return res.json({
    items:      withLive.filter((_, i) => !rows[i].savedForLater),
    savedItems: withLive.filter((_, i) =>  rows[i].savedForLater),
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

  const rows: (typeof cartItems.$inferInsert)[] = [
    ...items.map((item: any) => ({
      userId,
      variantId:     String(item.variantId ?? item.id ?? "unknown"),
      savedForLater: false as const,
      itemData:      stripLive(item),
    })),
    ...(saved as any[]).map((item: any) => ({
      userId,
      variantId:     String(item.variantId ?? item.id ?? "unknown"),
      savedForLater: true as const,
      itemData:      stripLive(item),
    })),
  ];

  // One transaction, serialized per buyer: two overlapping full-replace syncs
  // (two devices, or a retry racing the original) can never interleave their
  // delete + insert and leave duplicated or half-replaced lines behind.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"buyer_cart_sync:" + userId}))`);
    await tx.delete(cartItems).where(eq(cartItems.userId, userId));
    if (rows.length > 0) {
      await tx.insert(cartItems).values(rows);
    }
  });

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
