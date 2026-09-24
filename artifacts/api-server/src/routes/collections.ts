/**
 * Buyer saved collections (boards).
 * GET    /api/buyer/collections            — list, with item count + auto cover
 * POST   /api/buyer/collections             — create
 * PATCH  /api/buyer/collections/:id         — rename / set cover / toggle public
 * DELETE /api/buyer/collections/:id         — delete (items fall back to "All", not deleted)
 * POST   /api/buyer/collections/reorder     — persist drag-to-reorder
 */
import { Router } from "express";
import { db, savedCollections, savedItems } from "@workspace/db";
import { eq, and, asc, desc, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { fetchProductBadgeInfo } from "../lib/savedProductBadges";
import { adaptSavedRows } from "../lib/savedItemAdapter";

const router = Router();
router.use(requireAuth);

async function withCovers(userId: string, rows: (typeof savedCollections.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const collectionIds = rows.map((r) => r.id);
  const items = await db.select({
    id: savedItems.id,
    collectionId: savedItems.collectionId,
    itemType: savedItems.itemType,
    targetId: savedItems.targetId,
    accentColor: savedItems.accentColor,
    createdAt: savedItems.createdAt,
  })
    .from(savedItems)
    .where(and(eq(savedItems.userId, userId), inArray(savedItems.collectionId, collectionIds)));

  const productIds = items.filter((i) => i.itemType === "product").map((i) => i.targetId);
  const badgeInfo = await fetchProductBadgeInfo(productIds);

  const countByCollection = new Map<string, number>();
  const autoCoverByCollection = new Map<string, string | null>();
  for (const item of items) {
    if (!item.collectionId) continue;
    countByCollection.set(item.collectionId, (countByCollection.get(item.collectionId) ?? 0) + 1);
    if (!autoCoverByCollection.has(item.collectionId)) {
      const image = badgeInfo.get(item.targetId)?.image ?? item.accentColor ?? null;
      autoCoverByCollection.set(item.collectionId, image);
    }
  }

  return rows.map((r) => ({
    id:            r.id,
    name:          r.name,
    coverImageUrl: r.coverImageUrl ?? autoCoverByCollection.get(r.id) ?? null,
    isPublic:      r.isPublic,
    sortOrder:     r.sortOrder,
    itemCount:     countByCollection.get(r.id) ?? 0,
    createdAt:     r.createdAt.toISOString(),
    updatedAt:     r.updatedAt.toISOString(),
  }));
}

router.get("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const rows = await db.select().from(savedCollections)
    .where(eq(savedCollections.userId, userId))
    .orderBy(asc(savedCollections.sortOrder), asc(savedCollections.createdAt));
  return res.json(await withCovers(userId, rows));
});

router.get("/:id/items", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const [collection] = await db.select().from(savedCollections)
    .where(and(eq(savedCollections.id, req.params.id), eq(savedCollections.userId, userId)))
    .limit(1);
  if (!collection) return res.status(404).json({ error: "Collection not found" });

  const rows = await db.select().from(savedItems)
    .where(and(eq(savedItems.userId, userId), eq(savedItems.collectionId, collection.id)))
    .orderBy(desc(savedItems.createdAt));
  return res.json({ collection: (await withCovers(userId, [collection]))[0], items: await adaptSavedRows(rows) });
});

router.post("/", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) return res.status(400).json({ error: "name required" });

  const [{ maxOrder } = { maxOrder: -1 }] = await db
    .select({ maxOrder: sql<number>`coalesce(max(${savedCollections.sortOrder}), -1)::int` })
    .from(savedCollections)
    .where(eq(savedCollections.userId, userId));

  const [row] = await db.insert(savedCollections)
    .values({ userId, name: name.trim(), sortOrder: maxOrder + 1 })
    .returning();
  return res.status(201).json((await withCovers(userId, [row]))[0]);
});

router.patch("/:id", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { name, coverImageUrl, isPublic } = req.body as {
    name?: string;
    coverImageUrl?: string | null;
    isPublic?: boolean;
  };

  const updates: Partial<typeof savedCollections.$inferInsert> = { updatedAt: new Date() };
  if (typeof name === "string" && name.trim()) updates.name = name.trim();
  if (coverImageUrl !== undefined) updates.coverImageUrl = coverImageUrl;
  if (typeof isPublic === "boolean") updates.isPublic = isPublic;

  const [row] = await db.update(savedCollections)
    .set(updates)
    .where(and(eq(savedCollections.id, req.params.id), eq(savedCollections.userId, userId)))
    .returning();
  if (!row) return res.status(404).json({ error: "Collection not found" });
  return res.json((await withCovers(userId, [row]))[0]);
});

router.delete("/:id", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  // Items belonging to this collection fall back to unfiled ("All") — never deleted.
  await db.update(savedItems)
    .set({ collectionId: null })
    .where(and(eq(savedItems.userId, userId), eq(savedItems.collectionId, req.params.id)));
  await db.delete(savedCollections)
    .where(and(eq(savedCollections.id, req.params.id), eq(savedCollections.userId, userId)));
  return res.json({ ok: true });
});

router.post("/reorder", async (req, res) => {
  const userId = (req as any).clerkUserId as string;
  const { orderedIds } = req.body as { orderedIds?: string[] };
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: "orderedIds required" });
  }

  await Promise.all(orderedIds.map((id, index) =>
    db.update(savedCollections)
      .set({ sortOrder: index, updatedAt: new Date() })
      .where(and(eq(savedCollections.id, id), eq(savedCollections.userId, userId))),
  ));
  return res.json({ ok: true });
});

export default router;
