/**
 * GET /api/public/featured — brands and threads an admin has featured on
 * Discover, in display order. Unauthenticated and read-only; carries no
 * private data. The Discover surface consumes this (see docs/admin-dashboard.md).
 */
import { Router } from "express";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { db, featuredItems, posts, users } from "@workspace/db";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const rows = await db.select().from(featuredItems)
      .where(and(eq(featuredItems.active, true), or(isNull(featuredItems.endsAt), gt(featuredItems.endsAt, now))))
      .orderBy(asc(featuredItems.position), asc(featuredItems.createdAt));

    const brandIds = rows.filter((r) => r.kind === "brand").map((r) => r.targetId);
    const threadIds = rows.filter((r) => r.kind === "thread").map((r) => r.targetId);
    const [liveBrands, liveThreads] = await Promise.all([
      brandIds.length ? db.select({ clerkId: users.clerkId }).from(users)
        .where(and(inArray(users.clerkId, brandIds), isNull(users.suspendedAt), isNull(users.deletedAt))) : [],
      threadIds.length ? db.select({ id: posts.id }).from(posts)
        .where(and(sql`${posts.id}::text IN (${sql.join(threadIds.map((t) => sql`${t}`), sql`, `)})`,
          eq(posts.postStatus, "published"), eq(posts.moderationStatus, "visible"))) : [],
    ]);
    const liveB = new Set(liveBrands.map((b) => b.clerkId));
    const liveT = new Set(liveThreads.map((t) => t.id));

    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      brands: rows.filter((r) => r.kind === "brand" && liveB.has(r.targetId)).map((r) => ({ userId: r.targetId, label: r.label })),
      threads: rows.filter((r) => r.kind === "thread" && liveT.has(r.targetId)).map((r) => ({ postId: r.targetId, label: r.label })),
    });
  } catch (err) {
    req.log.error({ err }, "Featured list failed");
    res.status(500).json({ error: "Could not load featured items." });
  }
});

export default router;
