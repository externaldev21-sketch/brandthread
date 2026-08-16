/**
 * Server-side cart persistence — full-replace sync model.
 * The client keeps AsyncStorage as the primary store; this is a durable backup.
 *
 * GET    /api/buyer/cart       — load cart from DB
 * POST   /api/buyer/cart/sync  — full replace (delete all + insert new)
 * DELETE /api/buyer/cart       — clear cart
 */
import { Router } from "express";
import { db, cartItems } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

// GET /api/buyer/cart
router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select().from(cartItems).where(eq(cartItems.userId, userId));

  return res.json({
    items:      rows.filter((r) => !r.savedForLater).map((r) => r.itemData),
    savedItems: rows.filter((r) =>  r.savedForLater).map((r) => r.itemData),
  });
});

// POST /api/buyer/cart/sync — full replace
router.post("/sync", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { items = [], savedItems: saved = [] } = req.body as {
    items?: any[];
    savedItems?: any[];
  };

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

  return res.json({ ok: true, count: rows.length });
});

// DELETE /api/buyer/cart
router.delete("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.delete(cartItems).where(eq(cartItems.userId, userId));
  return res.json({ ok: true });
});

export default router;
