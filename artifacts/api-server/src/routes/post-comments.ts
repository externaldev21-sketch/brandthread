/**
 * Thread post comments.
 *
 * GET    /api/posts/:postId/comments                       — list (signed-out allowed)
 * POST   /api/posts/:postId/comments                       — add a comment or reply
 * DELETE /api/posts/:postId/comments/:commentId            — author or post owner
 * POST   /api/posts/:postId/comments/:commentId/like       — { liked: boolean }
 *
 * Safety rules:
 *   • Slurs and threats are rejected; profanity/abuse/spam is held (visible to
 *     its author only, marked "In review") and queued for moderators.
 *   • Comments by anyone with a block relationship to the viewer are hidden,
 *     and blocked people cannot comment on each other's posts or reply to
 *     each other.
 *   • Comments containing the viewer's muted words are hidden from them.
 *   • Suspended accounts cannot comment and their comments are hidden.
 *
 * Mounted without team context: a comment is always attributed to the person
 * who wrote it, never rewritten to a store owner.
 */
import { Router } from "express";
import { and, asc, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db, postCommentLikes, postComments, posts } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { evaluateContent, matchesMutedWords } from "../lib/contentModerator";
import { publicPostCondition } from "../lib/postVisibility";
import {
  authorInGoodStanding,
  blockRelation,
  blockedUserIds,
  enqueueAutoFilterReport,
  mutedPhrasesFor,
  optionalViewerId,
  profilesById,
  publishingRestriction,
  type ProfileSummary,
} from "../lib/safety";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_COMMENT_LENGTH = 1000;
const PAGE_SIZE = 50;

type CommentRow = typeof postComments.$inferSelect;

export interface CommentView {
  id: string;
  postId: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: ProfileSummary;
  likesCount: number;
  likedByMe: boolean;
  isMine: boolean;
  canDelete: boolean;
  pendingReview: boolean;
  replies: CommentView[];
}

async function loadPost(postId: string, viewerId: string | null) {
  const [post] = await db
    .select({ id: posts.id, userId: posts.userId, visibility: posts.visibility })
    .from(posts)
    .where(and(eq(posts.id, postId), publicPostCondition()))
    .limit(1);
  if (post) return post;
  // Authors can always open comments on their own post, including while a
  // caption is held for review.
  if (!viewerId) return null;
  const [own] = await db
    .select({ id: posts.id, userId: posts.userId, visibility: posts.visibility })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.userId, viewerId)))
    .limit(1);
  return own ?? null;
}

// ─── GET /api/posts/:postId/comments ─────────────────────────────────────────
router.get("/:postId/comments", async (req, res) => {
  const postId = String(req.params.postId);
  if (!UUID_RE.test(postId)) return res.status(404).json({ error: "Post not found" });
  const viewerId = optionalViewerId(req);
  const before = typeof req.query.before === "string" ? new Date(req.query.before) : null;
  if (before && Number.isNaN(before.getTime())) {
    return res.status(400).json({ error: "before must be an ISO timestamp" });
  }

  try {
    const post = await loadPost(postId, viewerId);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (viewerId && viewerId !== post.userId && (await blockRelation(viewerId, post.userId)) !== "none") {
      return res.status(404).json({ error: "Post not found" });
    }

    const [blocked, muted] = await Promise.all([blockedUserIds(viewerId), mutedPhrasesFor(viewerId)]);

    // Visible comments, plus the viewer's own held comments so they can see
    // what is waiting for review.
    const visibility = viewerId
      ? or(
          eq(postComments.moderationStatus, "visible"),
          and(eq(postComments.moderationStatus, "held"), eq(postComments.authorId, viewerId)),
        )
      : eq(postComments.moderationStatus, "visible");
    const standing = authorInGoodStanding(postComments.authorId);

    const topLevel = await db
      .select()
      .from(postComments)
      .where(and(
        eq(postComments.postId, postId),
        sql`${postComments.parentId} IS NULL`,
        visibility,
        standing,
        before ? lt(postComments.createdAt, before) : undefined,
      ))
      .orderBy(desc(postComments.createdAt))
      .limit(PAGE_SIZE + 1);
    const hasMore = topLevel.length > PAGE_SIZE;
    const page = topLevel.slice(0, PAGE_SIZE);

    const replies = page.length === 0 ? [] : await db
      .select()
      .from(postComments)
      .where(and(
        inArray(postComments.parentId, page.map((c) => c.id)),
        visibility,
        standing,
      ))
      .orderBy(asc(postComments.createdAt));

    const all = [...page, ...replies];
    let hiddenByMutedWords = 0;
    const shown = all.filter((comment) => {
      if (blocked.has(comment.authorId)) return false;
      if (comment.authorId !== viewerId && matchesMutedWords(comment.body, muted)) {
        hiddenByMutedWords += 1;
        return false;
      }
      return true;
    });

    const ids = shown.map((c) => c.id);
    const [likeRows, myLikeRows, profiles, totalRows] = await Promise.all([
      ids.length ? db.select({ commentId: postCommentLikes.commentId, n: count() })
        .from(postCommentLikes).where(inArray(postCommentLikes.commentId, ids))
        .groupBy(postCommentLikes.commentId) : Promise.resolve([]),
      ids.length && viewerId ? db.select({ commentId: postCommentLikes.commentId })
        .from(postCommentLikes)
        .where(and(inArray(postCommentLikes.commentId, ids), eq(postCommentLikes.userId, viewerId)))
        : Promise.resolve([]),
      profilesById(shown.map((c) => c.authorId)),
      db.select({ n: count() }).from(postComments)
        .where(and(eq(postComments.postId, postId), eq(postComments.moderationStatus, "visible"), standing)),
    ]);
    const likes = new Map(likeRows.map((row) => [row.commentId, Number(row.n)]));
    const mine = new Set(myLikeRows.map((row) => row.commentId));

    const toView = (comment: CommentRow): CommentView => ({
      id: comment.id,
      postId: comment.postId,
      parentId: comment.parentId,
      body: comment.body,
      createdAt: comment.createdAt.toISOString(),
      author: profiles.get(comment.authorId) ?? {
        userId: comment.authorId, name: "Brandthread member", handle: "", initials: "BM",
        avatarUrl: null, accountType: null, suspended: false, deleted: false,
      },
      likesCount: likes.get(comment.id) ?? 0,
      likedByMe: mine.has(comment.id),
      isMine: !!viewerId && comment.authorId === viewerId,
      canDelete: !!viewerId && (comment.authorId === viewerId || post.userId === viewerId),
      pendingReview: comment.moderationStatus === "held",
      replies: [],
    });

    const views = new Map<string, CommentView>();
    for (const comment of shown) views.set(comment.id, toView(comment));
    const roots: CommentView[] = [];
    for (const comment of shown) {
      const view = views.get(comment.id)!;
      if (comment.parentId) views.get(comment.parentId)?.replies.push(view);
      else roots.push(view);
    }

    const commentsDisabled = post.visibility?.allowComments === false;
    return res.json({
      comments: roots,
      total: Number(totalRows[0]?.n ?? 0),
      hiddenByMutedWords,
      commentsDisabled,
      canComment: !!viewerId && !commentsDisabled,
      nextCursor: hasMore ? page[page.length - 1].createdAt.toISOString() : null,
    });
  } catch (err) {
    req.log.error({ err, postId }, "Failed to list comments");
    return res.status(500).json({ error: "Could not load comments." });
  }
});

// ─── POST /api/posts/:postId/comments ────────────────────────────────────────
router.post("/:postId/comments", requireAuth, rateLimit("comment"), async (req, res) => {
  const authorId = (req as any).clerkUserId as string;
  const postId = String(req.params.postId);
  if (!UUID_RE.test(postId)) return res.status(404).json({ error: "Post not found" });

  const { body: rawBody, parentId: rawParentId } = (req.body ?? {}) as { body?: unknown; parentId?: unknown };
  const body = typeof rawBody === "string" ? rawBody.trim() : "";
  if (!body) return res.status(400).json({ error: "Write something before posting.", code: "VALIDATION_ERROR" });
  if (body.length > MAX_COMMENT_LENGTH) {
    return res.status(400).json({ error: `Comments can be up to ${MAX_COMMENT_LENGTH} characters.`, code: "VALIDATION_ERROR" });
  }
  if (rawParentId != null && (typeof rawParentId !== "string" || !UUID_RE.test(rawParentId))) {
    return res.status(400).json({ error: "parentId must be a comment id", code: "VALIDATION_ERROR" });
  }

  try {
    const restriction = await publishingRestriction(authorId);
    if (restriction) return res.status(restriction.status).json(restriction.body);

    const post = await loadPost(postId, authorId);
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.visibility?.allowComments === false) {
      return res.status(403).json({ error: "Comments are turned off for this post.", code: "COMMENTS_DISABLED" });
    }
    if (post.userId !== authorId && (await blockRelation(authorId, post.userId)) !== "none") {
      return res.status(403).json({ error: "You can't comment on this post.", code: "BLOCKED" });
    }

    let parentId: string | null = null;
    if (typeof rawParentId === "string") {
      const [parent] = await db
        .select({ id: postComments.id, parentId: postComments.parentId, authorId: postComments.authorId, status: postComments.moderationStatus })
        .from(postComments)
        .where(and(eq(postComments.id, rawParentId), eq(postComments.postId, postId)))
        .limit(1);
      if (!parent || parent.status === "removed") {
        return res.status(404).json({ error: "That comment is no longer available." });
      }
      if (parent.authorId !== authorId && (await blockRelation(authorId, parent.authorId)) !== "none") {
        return res.status(403).json({ error: "You can't reply to this comment.", code: "BLOCKED" });
      }
      // Threads are one level deep: replies to replies attach to the root.
      parentId = parent.parentId ?? parent.id;
    }

    const decision = evaluateContent(body, "public");
    if (decision.action === "reject") {
      return res.status(422).json({
        error: `${decision.reason} Please review the Community Guidelines.`,
        category: decision.category,
        code: "CONTENT_REJECTED",
      });
    }

    const held = decision.action === "hold";
    const [created] = await db.insert(postComments).values({
      postId,
      authorId,
      parentId,
      body,
      moderationStatus: held ? "held" : "visible",
      moderationReason: held ? decision.category : null,
    }).returning();

    if (held) {
      await enqueueAutoFilterReport({
        targetType: "comment",
        targetId: created.id,
        ownerId: authorId,
        excerpt: body,
        category: decision.category,
        label: "Comment",
      });
    }

    const profiles = await profilesById([authorId]);
    const view: CommentView = {
      id: created.id,
      postId,
      parentId,
      body,
      createdAt: created.createdAt.toISOString(),
      author: profiles.get(authorId)!,
      likesCount: 0,
      likedByMe: false,
      isMine: true,
      canDelete: true,
      pendingReview: held,
      replies: [],
    };
    return res.status(201).json({
      comment: view,
      moderation: held
        ? { status: "held", message: "Your comment is in review. Only you can see it until a moderator approves it." }
        : { status: "visible" },
    });
  } catch (err) {
    req.log.error({ err, postId }, "Failed to create comment");
    return res.status(500).json({ error: "Could not post your comment. Try again." });
  }
});

// ─── DELETE /api/posts/:postId/comments/:commentId ───────────────────────────
router.delete("/:postId/comments/:commentId", requireAuth, async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  const postId = String(req.params.postId);
  const commentId = String(req.params.commentId);
  if (!UUID_RE.test(postId) || !UUID_RE.test(commentId)) return res.status(404).json({ error: "Comment not found" });

  const [row] = await db
    .select({ id: postComments.id, authorId: postComments.authorId, postOwnerId: posts.userId })
    .from(postComments)
    .innerJoin(posts, eq(posts.id, postComments.postId))
    .where(and(eq(postComments.id, commentId), eq(postComments.postId, postId)))
    .limit(1);
  if (!row) return res.status(404).json({ error: "Comment not found" });
  if (row.authorId !== viewerId && row.postOwnerId !== viewerId) {
    return res.status(403).json({ error: "Only the author or the post owner can delete this comment." });
  }
  await db.delete(postComments).where(eq(postComments.id, commentId));
  return res.json({ ok: true });
});

// ─── POST /api/posts/:postId/comments/:commentId/like ────────────────────────
router.post("/:postId/comments/:commentId/like", requireAuth, async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  const postId = String(req.params.postId);
  const commentId = String(req.params.commentId);
  if (!UUID_RE.test(postId) || !UUID_RE.test(commentId)) return res.status(404).json({ error: "Comment not found" });
  const liked = (req.body as { liked?: unknown })?.liked !== false;

  const [comment] = await db
    .select({ id: postComments.id, authorId: postComments.authorId })
    .from(postComments)
    .where(and(
      eq(postComments.id, commentId),
      eq(postComments.postId, postId),
      eq(postComments.moderationStatus, "visible"),
    ))
    .limit(1);
  if (!comment) return res.status(404).json({ error: "Comment not found" });
  if (comment.authorId !== viewerId && (await blockRelation(viewerId, comment.authorId)) !== "none") {
    return res.status(404).json({ error: "Comment not found" });
  }

  if (liked) {
    await db.insert(postCommentLikes).values({ commentId, userId: viewerId }).onConflictDoNothing();
  } else {
    await db.delete(postCommentLikes)
      .where(and(eq(postCommentLikes.commentId, commentId), eq(postCommentLikes.userId, viewerId)));
  }
  const [{ n }] = await db.select({ n: count() }).from(postCommentLikes).where(eq(postCommentLikes.commentId, commentId));
  return res.json({ liked, likesCount: Number(n) });
});

export default router;
