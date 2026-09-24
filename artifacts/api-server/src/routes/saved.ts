/**
 * Buyer saved / wishlisted items.
 * GET    /api/buyer/saved                     — list, enriched with live price/stock badges
 * POST   /api/buyer/saved                     — save (optionally into a collection)
 * PATCH  /api/buyer/saved/:targetId           — move to a collection (or null to un-file)
 * DELETE /api/buyer/saved/:targetId           — unsave
 */
import { Router } from "express";
import { db, savedItems } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { adaptSavedRows } from "../lib/savedItemAdapter";

const router = Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select().from(savedItems)
    .where(eq(savedItems.userId, userId))
    .orderBy(desc(savedItems.createdAt));
  return res.json(await adaptSavedRows(rows));
});

router.post("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { type, targetId, title, subtitle, accentColor, collectionId, priceCents } = req.body as {
    type: string;
    targetId: string;
    title: string;
    subtitle?: string;
    accentColor?: string;
    collectionId?: string | null;
    /** Current price at save time — becomes the "old price" a future drop compares against. */
    priceCents?: number;
  };

  if (!targetId || !title) return res.status(400).json({ error: "targetId and title required" });

  try {
    const [row] = await db.insert(savedItems)
      .values({
        userId,
        itemType: type ?? "product",
        targetId,
        title,
        subtitle: subtitle ?? null,
        accentColor: accentColor ?? null,
        collectionId: collectionId ?? null,
        savedPriceCents: typeof priceCents === "number" ? priceCents : null,
        lastNotifiedPriceCents: typeof priceCents === "number" ? priceCents : null,
      })
      .returning();
    return res.status(201).json((await adaptSavedRows([row]))[0]);
  } catch (err: any) {
    if (err?.code === "23505") {
      // Already saved — fetch + return existing row
      const [row] = await db.select().from(savedItems)
        .where(and(eq(savedItems.userId, userId), eq(savedItems.targetId, targetId)))
        .limit(1);
      return res.json(row ? (await adaptSavedRows([row]))[0] : { error: "not found" });
    }
    throw err;
  }
});

router.patch("/:targetId", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { collectionId } = req.body as { collectionId?: string | null };

  const [row] = await db.update(savedItems)
    .set({ collectionId: collectionId ?? null })
    .where(and(eq(savedItems.userId, userId), eq(savedItems.targetId, req.params.targetId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Saved item not found" });
  return res.json((await adaptSavedRows([row]))[0]);
});

router.delete("/:targetId", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.delete(savedItems)
    .where(and(eq(savedItems.userId, userId), eq(savedItems.targetId, req.params.targetId)));
  return res.json({ ok: true });
});

export default router;
