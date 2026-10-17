/**
 * GET /api/public/featured — brands and threads an admin has featured on
 * Discover, in display order. Unauthenticated and read-only; carries no
 * private data. The Discover surface consumes this (see docs/admin-dashboard.md
 * and the mobile DiscoverFeaturedRail).
 *
 * Each item carries the display data the Discover rail needs (brand name /
 * avatar / verified, thread thumbnail / caption) so the client doesn't have
 * to fan out a request per pick. `userId` / `postId` / `label` are unchanged.
 */
import { Router } from "express";
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, featuredItems, posts, users } from "@workspace/db";
import { deriveSellerVerified } from "../lib/sellerEligibility";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const rows = await db.select().from(featuredItems)
      .where(and(
        eq(featuredItems.active, true),
        or(isNull(featuredItems.startsAt), lte(featuredItems.startsAt, now)),
        or(isNull(featuredItems.endsAt), gt(featuredItems.endsAt, now)),
      ))
      .orderBy(asc(featuredItems.position), asc(featuredItems.createdAt));

    const brandIds = rows.filter((r) => r.kind === "brand").map((r) => r.targetId);
    const threadIds = rows.filter((r) => r.kind === "thread").map((r) => r.targetId);
    const [liveBrands, liveThreads] = await Promise.all([
      brandIds.length ? db.select({
        clerkId: users.clerkId,
        displayName: users.displayName,
        brandName: users.brandName,
        avatarUrl: users.avatarUrl,
        verified: users.verified,
        verificationStatus: users.verificationStatus,
        activeStanding: users.activeStanding,
        policyRestricted: users.policyRestricted,
      }).from(users)
        .where(and(inArray(users.clerkId, brandIds), isNull(users.suspendedAt), isNull(users.deletedAt))) : [],
      threadIds.length ? db.select({
        id: posts.id,
        userId: posts.userId,
        caption: posts.caption,
        mediaUrl: posts.mediaUrl,
        thumbnailUrl: posts.thumbnailUrl,
        mediaType: posts.mediaType,
      }).from(posts)
        .where(and(sql`${posts.id}::text IN (${sql.join(threadIds.map((t) => sql`${t}`), sql`, `)})`,
          eq(posts.postStatus, "published"), eq(posts.moderationStatus, "visible"))) : [],
    ]);
    const brandById = new Map(liveBrands.map((b) => [b.clerkId, b]));
    const threadById = new Map(liveThreads.map((t) => [t.id, t]));

    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      brands: rows.filter((r) => r.kind === "brand" && brandById.has(r.targetId)).map((r) => {
        const b = brandById.get(r.targetId)!;
        return {
          userId: r.targetId,
          label: r.label,
          name: b.brandName ?? b.displayName ?? "Brand",
          imageUrl: b.avatarUrl ?? null,
          verified: deriveSellerVerified(b),
        };
      }),
      threads: rows.filter((r) => r.kind === "thread" && threadById.has(r.targetId)).map((r) => {
        const t = threadById.get(r.targetId)!;
        return {
          postId: r.targetId,
          label: r.label,
          authorId: t.userId,
          caption: t.caption ?? null,
          mediaType: t.mediaType,
          thumbnailUrl: t.thumbnailUrl ?? (t.mediaType === "video" ? null : t.mediaUrl) ?? null,
        };
      }),
    });
  } catch (err) {
    req.log.error({ err }, "Featured list failed");
    res.status(500).json({ error: "Could not load featured items." });
  }
});

export default router;
