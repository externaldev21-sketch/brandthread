/**
 * Server-side cart persistence — full-replace sync model.
 * For a signed-in buyer this is the bag's source of truth; the client keeps
 * AsyncStorage as a cache and pushes unsynced local edits first.
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
import { loadCartLiveFields, type CartLiveFields } from "../lib/cartLive";

const router = Router();

/** Server-computed per read; never part of the stored snapshot. */
const READ_ONLY_KEYS = ["live", "unavailable"] as const;
function stripLive(item: any): any {
  if (!item || typeof item !== "object" || !READ_ONLY_KEYS.some((k) => k in item)) return item;
  const { live: _live, unavailable: _unavailable, ...rest } = item;
  return rest;
}

/**
 * One line as the bag reads it: the stored snapshot, `live` catalog fields,
 * and the availability flags derived from them. A deleted / off-sale product
 * or a sold-out variant stays in the bag (the seller may restore or restock)
 * but is flagged `unavailable` / `isAvailable: false` so it can't be checked
 * out; a line that is shoppable again loses any stale flag.
 */
function withLive(itemData: unknown, live: CartLiveFields): Record<string, unknown> {
  const line: Record<string, unknown> = { ...stripLive(itemData && typeof itemData === "object" ? itemData : {}), live };
  if (live.available) {
    line.isAvailable = true;
    delete line.unavailableReason;
  } else {
    line.unavailable = true;
    line.isAvailable = false;
    line.unavailableReason = live.reason === "out_of_stock" ? "Out of stock" : "No longer available";
  }
  return line;
}
router.use(requireAuth);

// GET /api/buyer/cart
router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select().from(cartItems).where(eq(cartItems.userId, userId));

  // Older line shapes carry the variant id only in the row's column.
  const lookups = rows.map((r) => {
    const d = (r.itemData && typeof r.itemData === "object" ? r.itemData : {}) as Record<string, unknown>;
    return { ...d, variantId: d.variantId ?? r.variantId };
  });
  // A catalog read failure never fails the bag load — lines are then
  // returned as stored, without `live`.
  const live = await loadCartLiveFields(lookups).catch(() => null);
  const lines = rows.map((r, i) => (live ? withLive(r.itemData, live[i]) : r.itemData));

  return res.json({
    items:      lines.filter((_, i) => !rows[i].savedForLater),
    savedItems: lines.filter((_, i) =>  rows[i].savedForLater),
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
