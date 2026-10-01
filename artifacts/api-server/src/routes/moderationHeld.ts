/**
 * Held-content moderation queue (mounted under /api/moderation/held by
 * routes/moderation.ts, AFTER requireModerator, so every route here is
 * moderators-only).
 *
 * GET  /held?type=all|post|story|comment|media&limit=&cursor=  oldest first
 * GET  /held/counts                                          dashboard badges
 * POST /held/:type/:id/approve                               publish held item
 * POST /held/:type/:id/remove                                take it down
 *
 * Items held by the text filter, by automatic media screening, or both. The
 * existing /reports queue is untouched; approving/removing here also closes
 * the pending reports on the same item so the two queues never disagree.
 */
import { Router } from "express";
import { and, asc, count, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
import { db, mediaModerationResults, postComments, posts, reports, stories } from "@workspace/db";
import { releaseHeldContent, removeReportedContent } from "../lib/reportTargets";
import { profilesById } from "../lib/safety";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const HELD_TYPES = ["post", "story", "comment"] as const;
export type HeldType = typeof HELD_TYPES[number];

function normalizeHeldType(raw: unknown): HeldType | null {
  if (raw === "video") return "post";
  return typeof raw === "string" && (HELD_TYPES as readonly string[]).includes(raw) ? raw as HeldType : null;
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}
export function decodeCursor(raw: unknown): { at: Date; id: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) || !UUID_RE.test(id ?? "") ? null : { at, id };
  } catch {
    return null;
  }
}

interface HeldItem {
  type: HeldType;
  id: string;
  ownerId: string;
  createdAt: Date;
  reason: string | null;
  text: string | null;
  mediaType: string | null;
  mediaUrls: string[];
  parentId: string | null;
}

function storyMediaUrls(media: unknown): string[] {
  return (Array.isArray(media) ? media as Array<{ uri?: string; url?: string }> : [])
    .map((m) => m?.uri ?? m?.url ?? "")
    .filter(Boolean);
}

async function loadHeld(type: HeldType, limit: number, cursor: { at: Date; id: string } | null): Promise<HeldItem[]> {
  if (type === "post") {
    const after = cursor ? or(gt(posts.createdAt, cursor.at), and(eq(posts.createdAt, cursor.at), gt(posts.id, cursor.id))) : undefined;
    const rows = await db.select({
      id: posts.id, userId: posts.userId, caption: posts.caption, mediaType: posts.mediaType, mediaUrl: posts.mediaUrl,
      mediaUrls: posts.mediaUrls, thumbnailUrl: posts.thumbnailUrl, reason: posts.moderationReason, createdAt: posts.createdAt,
    }).from(posts)
      .where(and(eq(posts.moderationStatus, "held"), ne(posts.postStatus, "deleted"), after))
      .orderBy(asc(posts.createdAt), asc(posts.id)).limit(limit);
    return rows.map((r) => ({
      type: "post", id: r.id, ownerId: r.userId, createdAt: r.createdAt, reason: r.reason, text: r.caption || null,
      mediaType: r.mediaType,
      mediaUrls: [...new Set([r.mediaUrl, ...(Array.isArray(r.mediaUrls) ? r.mediaUrls : []), r.thumbnailUrl].filter((u): u is string => !!u))],
      parentId: null,
    }));
  }
  if (type === "story") {
    const after = cursor ? or(gt(stories.createdAt, cursor.at), and(eq(stories.createdAt, cursor.at), gt(stories.id, cursor.id))) : undefined;
    const rows = await db.select().from(stories)
      .where(and(eq(stories.moderationStatus, "held"), after))
      .orderBy(asc(stories.createdAt), asc(stories.id)).limit(limit);
    return rows.map((r) => ({
      type: "story", id: r.id, ownerId: r.authorId, createdAt: r.createdAt, reason: r.moderationReason, text: null,
      mediaType: "story", mediaUrls: storyMediaUrls(r.media), parentId: null,
    }));
  }
  const after = cursor ? or(gt(postComments.createdAt, cursor.at), and(eq(postComments.createdAt, cursor.at), gt(postComments.id, cursor.id))) : undefined;
  const rows = await db.select({
    id: postComments.id, authorId: postComments.authorId, body: postComments.body, postId: postComments.postId,
    reason: postComments.moderationReason, createdAt: postComments.createdAt,
  }).from(postComments)
    .where(and(eq(postComments.moderationStatus, "held"), after))
    .orderBy(asc(postComments.createdAt), asc(postComments.id)).limit(limit);
  return rows.map((r) => ({
    type: "comment", id: r.id, ownerId: r.authorId, createdAt: r.createdAt, reason: r.reason, text: r.body,
    mediaType: null, mediaUrls: [], parentId: r.postId,
  }));
}

// ─── GET /held ────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const typeParam = String(req.query.type ?? "all");
  const type = typeParam === "all" || typeParam === "media" ? null : normalizeHeldType(typeParam);
  if (typeParam !== "all" && typeParam !== "media" && !type) {
    return res.status(400).json({ error: "type must be all, post, story, comment or media" });
  }
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? 30), 10) || 30, 1), 100);
  if (req.query.cursor !== undefined && req.query.cursor !== "" && !decodeCursor(req.query.cursor)) {
    return res.status(400).json({ error: "Invalid cursor" });
  }
  const cursor = decodeCursor(req.query.cursor);
  const types: HeldType[] = type ? [type] : typeParam === "media" ? ["post", "story"] : [...HELD_TYPES];

  try {
    const batches = await Promise.all(types.map((t) => loadHeld(t, limit + 1, cursor)));
    let merged = batches.flat().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));

    const keys = [...new Set(merged.map((i) => i.id))];
    const results = keys.length
      ? await db.select().from(mediaModerationResults).where(inArray(mediaModerationResults.targetId, keys))
      : [];
    const resultByItem = new Map<string, typeof results[number]>();
    for (const row of results) {
      const k = `${row.targetType}:${row.targetId}`;
      const prev = resultByItem.get(k);
      if (!prev || prev.createdAt < row.createdAt) resultByItem.set(k, row);
    }
    if (typeParam === "media") merged = merged.filter((i) => resultByItem.has(`${i.type}:${i.id}`));

    const page = merged.slice(0, limit);
    const hasMore = merged.length > limit || batches.some((b) => b.length > limit);
    const profiles = await profilesById(page.map((i) => i.ownerId));

    const items = page.map((i) => {
      const result = resultByItem.get(`${i.type}:${i.id}`);
      return {
        type: i.type,
        id: i.id,
        createdAt: i.createdAt.toISOString(),
        reason: i.reason,
        text: i.text,
        mediaType: i.mediaType,
        mediaUrls: i.mediaUrls,
        parentId: i.parentId,
        author: profiles.get(i.ownerId) ?? null,
        authorId: i.ownerId,
        moderation: result ? {
          verdict: result.verdict,
          categories: result.categories,
          scores: result.scores,
          maxScore: result.maxScore,
          framesChecked: result.framesChecked,
          priority: result.priority,
          provider: result.provider,
        } : null,
      };
    });
    const last = page[page.length - 1];
    return res.json({ items, hasMore, nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null });
  } catch (err) {
    req.log.error({ err }, "Failed to load held content");
    return res.status(500).json({ error: "Could not load held content." });
  }
});

// ─── GET /held/counts ─────────────────────────────────────────────────────────
router.get("/counts", async (req, res) => {
  try {
    const [p, s, c, high] = await Promise.all([
      db.select({ n: count() }).from(posts).where(and(eq(posts.moderationStatus, "held"), ne(posts.postStatus, "deleted"))),
      db.select({ n: count() }).from(stories).where(eq(stories.moderationStatus, "held")),
      db.select({ n: count() }).from(postComments).where(eq(postComments.moderationStatus, "held")),
      db.select({ n: count() }).from(mediaModerationResults)
        .where(and(eq(mediaModerationResults.priority, "high"), sql`${mediaModerationResults.reviewedAt} IS NULL`)),
    ]);
    const posts_ = Number(p[0]?.n ?? 0), stories_ = Number(s[0]?.n ?? 0), comments_ = Number(c[0]?.n ?? 0);
    return res.json({
      total: posts_ + stories_ + comments_,
      posts: posts_,
      stories: stories_,
      comments: comments_,
      highPriorityUnreviewed: Number(high[0]?.n ?? 0),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to count held content");
    return res.status(500).json({ error: "Could not load counts." });
  }
});

// ─── POST /held/:type/:id/approve|remove ─────────────────────────────────────
async function review(action: "approve" | "remove", req: any, res: any) {
  const moderatorId = req.clerkUserId as string;
  const type = normalizeHeldType(req.params.type);
  const id = String(req.params.id);
  if (!type) return res.status(400).json({ error: "type must be post, story or comment" });
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Item not found" });

  try {
    let done: boolean;
    if (action === "approve") {
      done = await releaseHeldContent(type, id, moderatorId);
    } else {
      // Only items that are still held can be removed from this queue.
      const held = type === "post"
        ? await db.select({ id: posts.id }).from(posts).where(and(eq(posts.id, id), eq(posts.moderationStatus, "held"))).limit(1)
        : type === "story"
          ? await db.select({ id: stories.id }).from(stories).where(and(eq(stories.id, id), eq(stories.moderationStatus, "held"))).limit(1)
          : await db.select({ id: postComments.id }).from(postComments).where(and(eq(postComments.id, id), eq(postComments.moderationStatus, "held"))).limit(1);
      done = held.length > 0 && await removeReportedContent(type, id, moderatorId);
    }
    if (!done) return res.status(409).json({ error: "This item is no longer held." });

    const now = new Date();
    await db.update(mediaModerationResults)
      .set({ reviewedBy: moderatorId, reviewedAt: now, reviewAction: action })
      .where(and(eq(mediaModerationResults.targetType, type), eq(mediaModerationResults.targetId, id), sql`${mediaModerationResults.reviewedAt} IS NULL`));
    await db.update(reports)
      .set({
        status: action === "approve" ? "dismissed" : "actioned",
        resolutionAction: action === "approve" ? "dismiss" : "remove_content",
        resolvedBy: moderatorId,
        resolvedAt: now,
      })
      .where(and(
        inArray(reports.targetType, type === "post" ? ["post", "video"] : [type]),
        eq(reports.targetId, id),
        eq(reports.status, "pending"),
      ));
    return res.json({ ok: true, type, id, action, reviewedBy: moderatorId, reviewedAt: now.toISOString() });
  } catch (err) {
    req.log.error({ err, type, id, action }, "Failed to review held content");
    return res.status(500).json({ error: "Could not apply that action. Try again." });
  }
}

router.post("/:type/:id/approve", (req, res) => review("approve", req, res));
router.post("/:type/:id/remove", (req, res) => review("remove", req, res));

export default router;
