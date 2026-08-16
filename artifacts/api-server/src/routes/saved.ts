/**
 * Buyer saved / wishlisted items.
 * GET    /api/buyer/saved            — list
 * POST   /api/buyer/saved            — save
 * DELETE /api/buyer/saved/:targetId  — unsave
 */
import { Router } from "express";
import { db, savedItems } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
router.use(requireAuth);

function adapt(r: typeof savedItems.$inferSelect) {
  return {
    id:          r.id,
    type:        r.itemType,
    targetId:    r.targetId,
    title:       r.title,
    subtitle:    r.subtitle   ?? undefined,
    accentColor: r.accentColor ?? undefined,
    savedAt:     r.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select().from(savedItems)
    .where(eq(savedItems.userId, userId))
    .orderBy(desc(savedItems.createdAt));
  return res.json(rows.map(adapt));
});

router.post("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { type, targetId, title, subtitle, accentColor } = req.body as {
    type: string;
    targetId: string;
    title: string;
    subtitle?: string;
    accentColor?: string;
  };

  if (!targetId || !title) return res.status(400).json({ error: "targetId and title required" });

  try {
    const [row] = await db.insert(savedItems)
      .values({ userId, itemType: type ?? "product", targetId, title, subtitle: subtitle ?? null, accentColor: accentColor ?? null })
      .returning();
    return res.status(201).json(adapt(row));
  } catch (err: any) {
    if (err?.code === "23505") {
      // Already saved — fetch + return existing row
      const [row] = await db.select().from(savedItems)
        .where(and(eq(savedItems.userId, userId), eq(savedItems.targetId, targetId)))
        .limit(1);
      return res.json(row ? adapt(row) : { error: "not found" });
    }
    throw err;
  }
});

router.delete("/:targetId", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  await db.delete(savedItems)
    .where(and(eq(savedItems.userId, userId), eq(savedItems.targetId, req.params.targetId)));
  return res.json({ ok: true });
});

export default router;
