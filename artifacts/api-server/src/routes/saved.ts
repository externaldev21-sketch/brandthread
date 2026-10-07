/**
 * Buyer saved / wishlisted items.
 * GET    /api/buyer/saved                     — list, enriched with live price/stock badges
 * POST   /api/buyer/saved                     — save (optionally into a collection)
 * PATCH  /api/buyer/saved/:targetId           — move to a collection (or null to un-file) and/or
 *                                              set per-item alerts { notifyOnPriceDrop, notifyOnBackInStock }
 * DELETE /api/buyer/saved/:targetId           — unsave
 */
import { Router } from "express";
import { db, savedItems, posts } from "@workspace/db";
import { notifyPostSave } from "../lib/activityEvents";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { adaptSavedRows } from "../lib/savedItemAdapter";
import { blockRelation } from "../lib/safety";
import { publicPostCondition as visiblePostCondition } from "../lib/postVisibility";
import { applyEventToProfile } from "../lib/ranking/forYou";
import { currentProductPriceCents } from "../lib/savedProductAlerts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  let { type, targetId, title, subtitle, accentColor, collectionId, priceCents } = req.body as {
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

  let savedPost: { userId: string; styleTags: unknown } | null = null;
  if (type === "post") {
    // Only real, visible posts can be saved, and never across a block.
    if (typeof targetId !== "string" || !UUID_RE.test(targetId)) return res.status(404).json({ error: "Post not found" });
    const [post] = await db.select({ userId: posts.userId, styleTags: posts.styleTags }).from(posts)
      .where(and(eq(posts.id, targetId), visiblePostCondition()))
      .limit(1);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.userId !== userId && (await blockRelation(userId, post.userId)) !== "none") {
      return res.status(404).json({ error: "Post not found" });
    }
    savedPost = post;
  }
  if ((type ?? "product") === "product" && typeof targetId === "string" && UUID_RE.test(targetId)) {
    // The server's live lowest price is the snapshot a future price drop is
    // measured against — never a stale client-side number.
    const live = await currentProductPriceCents(targetId);
    if (live != null) priceCents = live;
  }

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
    if (row.itemType === "post") void notifyPostSave({ postId: row.targetId, saverId: userId });
    if (savedPost) {
      // New row only (a duplicate hits 23505 below), so the taste signal fires once per save.
      void applyEventToProfile(userId, {
        type: "save",
        styleTags: Array.isArray(savedPost.styleTags) ? (savedPost.styleTags as string[]) : [],
        sellerId: savedPost.userId,
      }).catch(() => undefined);
    }
    return res.status(201).json((await adaptSavedRows([row]))[0]);
  } catch (err: any) {
    if ((err?.code ?? err?.cause?.code) === "23505") {
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
  const body = (req.body ?? {}) as {
    collectionId?: string | null;
    notifyOnPriceDrop?: unknown;
    notifyOnBackInStock?: unknown;
  };
  const patch: Partial<typeof savedItems.$inferInsert> = {};
  if ("collectionId" in body) patch.collectionId = body.collectionId ?? null;
  for (const key of ["notifyOnPriceDrop", "notifyOnBackInStock"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") return res.status(400).json({ error: `${key} must be a boolean` });
    patch[key] = body[key];
  }
  // Legacy callers sent `{}` to un-file; keep that meaning.
  if (Object.keys(patch).length === 0) patch.collectionId = null;

  const [row] = await db.update(savedItems)
    .set(patch)
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
