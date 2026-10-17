/**
 * Your Activity (item 110): the signed-in person's own likes and comments.
 * Mounted at /api/buyer/activity (ahead of the catch-all /buyer router).
 *
 *   GET /   { likes: { total, items }, comments: { total, items } }
 *
 * Likes are the durable `interactions` rows of type "like" (unliking deletes
 * the row, so every row is a current like). Comments are post_comments the
 * person wrote that moderation has not removed (held ones stay visible to
 * their author, as in the comment sheet). Both only count posts that are
 * still publicly visible to this viewer, so a deleted or removed post never
 * shows up as activity. Items are the 20 most recent; totals are exact.
 *
 * Search history has its own endpoint (GET /api/public/search/recent).
 * Time in app is not tracked anywhere, so nothing here reports it.
 */
import { Router } from "express";
import { and, count, desc, eq, ne, sql } from "drizzle-orm";
import { db, interactions, postComments, posts, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { publicPostCondition } from "../lib/postVisibility";

const router = Router();
router.use(requireAuth);

const ITEM_LIMIT = 20;
const authorName = sql<string>`COALESCE(${users.brandName}, ${users.displayName}, ${users.name}, 'Someone')`;

router.get("/", async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  try {
    const now = new Date();
    const likeWhere = and(
      eq(interactions.userId, viewerId),
      eq(interactions.type, "like"),
      publicPostCondition(now, viewerId),
    );
    const commentWhere = and(
      eq(postComments.authorId, viewerId),
      ne(postComments.moderationStatus, "removed"),
      publicPostCondition(now, viewerId),
    );

    const [likeTotal, likeRows, commentTotal, commentRows] = await Promise.all([
      db.select({ n: count() }).from(interactions)
        .innerJoin(posts, eq(posts.id, interactions.postId))
        .where(likeWhere),
      db.select({
        postId: posts.id,
        authorId: posts.userId,
        authorName,
        caption: posts.caption,
        likedAt: interactions.createdAt,
      }).from(interactions)
        .innerJoin(posts, eq(posts.id, interactions.postId))
        .leftJoin(users, eq(users.clerkId, posts.userId))
        .where(likeWhere)
        .orderBy(desc(interactions.createdAt))
        .limit(ITEM_LIMIT),
      db.select({ n: count() }).from(postComments)
        .innerJoin(posts, eq(posts.id, postComments.postId))
        .where(commentWhere),
      db.select({
        id: postComments.id,
        postId: posts.id,
        authorId: posts.userId,
        authorName,
        body: postComments.body,
        isReply: sql<boolean>`${postComments.parentId} IS NOT NULL`,
        createdAt: postComments.createdAt,
      }).from(postComments)
        .innerJoin(posts, eq(posts.id, postComments.postId))
        .leftJoin(users, eq(users.clerkId, posts.userId))
        .where(commentWhere)
        .orderBy(desc(postComments.createdAt))
        .limit(ITEM_LIMIT),
    ]);

    res.json({
      likes: {
        total: Number(likeTotal[0]?.n ?? 0),
        items: likeRows.map((row) => ({ ...row, likedAt: row.likedAt.toISOString() })),
      },
      comments: {
        total: Number(commentTotal[0]?.n ?? 0),
        items: commentRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      },
    });
  } catch (err) {
    req.log?.error({ err }, "Failed to load buyer activity");
    res.status(500).json({ error: "Failed to load your activity" });
  }
});

export default router;
