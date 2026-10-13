/**
 * Product mentions in captions + "Behind the scenes" post labels.
 *   PUT /api/posts/:id/product-mentions  { mentions: [{ productId, label }] }
 *        author only; replaces the post's mention set. Every product must be
 *        the author's own, active and not deleted; every label must appear in
 *        the caption. Empty array clears.
 *   PUT /api/posts/:id/labels            { bts: boolean }
 *        author only, seller accounts only.
 *   GET /api/posts?label=bts&sellerId=…  public: a seller's published BTS posts,
 *        newest first (for a future profile filter).
 * Reads of a post carry `productMentions` and `labels` (lib/postExtras.ts).
 */
import { Router, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, lt, notInArray } from "drizzle-orm";
import { db, postLabels, postProductMentions, posts, products, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { teamContext } from "../middlewares/requireRole";
import { publicPostCondition } from "../lib/postVisibility";
import { blockedUserIds, optionalViewerId } from "../lib/safety";
import { isPostLabel, parseProductMentions, POST_LABEL_TEXT } from "../lib/productMentions";
import { attachPostExtras } from "../lib/postExtras";
import { postCardImage } from "../lib/quotedPosts";

const router = Router();
// Same store context as the posts router (a team member acts on the store owner's posts).
const tc = teamContext();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function param(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

/** 404 for unknown/deleted posts, 403 for someone else's. */
async function ownedPost(req: Request, res: Response) {
  const id = param(req.params.id);
  if (!UUID_RE.test(id)) { res.status(404).json({ error: "Post not found" }); return null; }
  const [post] = await db.select({ id: posts.id, userId: posts.userId, caption: posts.caption, postStatus: posts.postStatus })
    .from(posts).where(eq(posts.id, id)).limit(1);
  if (!post || post.postStatus === "deleted") { res.status(404).json({ error: "Post not found" }); return null; }
  if (post.userId !== (req as any).clerkUserId) {
    res.status(403).json({ error: "Only the author can change this post.", code: "NOT_POST_OWNER" });
    return null;
  }
  return post;
}

router.put("/:id/product-mentions", requireAuth, tc, async (req, res) => {
  const post = await ownedPost(req, res);
  if (!post) return;
  const parsed = parseProductMentions(req.body?.mentions, post.caption ?? "");
  if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });

  const ids = parsed.mentions.map((m) => m.productId);
  if (ids.length > 0) {
    const owned = await db.select({ id: products.id }).from(products).where(and(
      inArray(products.id, ids),
      eq(products.ownerId, post.userId),
      eq(products.status, "active"),
      isNull(products.deletedAt),
    ));
    const ok = new Set(owned.map((p) => p.id));
    const rejected = ids.filter((id) => !ok.has(id));
    if (rejected.length > 0) {
      return res.status(400).json({
        error: "You can only mention your own active products.",
        code: "PRODUCT_NOT_MENTIONABLE",
        rejected,
      });
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(postProductMentions).where(eq(postProductMentions.postId, post.id));
    if (parsed.mentions.length > 0) {
      await tx.insert(postProductMentions).values(parsed.mentions.map((m) => ({ postId: post.id, ...m })));
    }
  });
  const [withExtras] = await attachPostExtras([{ id: post.id }]);
  return res.json({ productMentions: withExtras.productMentions });
});

router.put("/:id/labels", requireAuth, tc, async (req, res) => {
  const post = await ownedPost(req, res);
  if (!post) return;
  if (typeof req.body?.bts !== "boolean") {
    return res.status(400).json({ error: "bts must be true or false", code: "INVALID_LABELS" });
  }
  const [author] = await db.select({ accountType: users.accountType }).from(users)
    .where(eq(users.clerkId, post.userId)).limit(1);
  const isSeller = author?.accountType === "seller" || author?.accountType === "both";
  if (!isSeller) {
    return res.status(403).json({ error: "Only sellers can mark posts as behind the scenes.", code: "SELLER_ONLY" });
  }
  if (req.body.bts) {
    await db.insert(postLabels).values({ postId: post.id, label: "bts" }).onConflictDoNothing();
  } else {
    await db.delete(postLabels).where(and(eq(postLabels.postId, post.id), eq(postLabels.label, "bts")));
  }
  const [withExtras] = await attachPostExtras([{ id: post.id }]);
  return res.json({ labels: withExtras.labels });
});

router.get("/", async (req, res, next) => {
  const label = param(req.query.label);
  // Not ours: let any later GET / handler answer.
  if (!label) return next();
  if (!isPostLabel(label)) return res.status(400).json({ error: "Unknown label", code: "INVALID_LABEL" });
  const sellerId = param(req.query.sellerId);
  if (!sellerId) return res.status(400).json({ error: "sellerId is required", code: "SELLER_REQUIRED" });
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const before = param(req.query.before);
  const beforeDate = before ? new Date(before) : null;

  const viewerId = optionalViewerId(req);
  const blocked = await blockedUserIds(viewerId);
  if (blocked.has(sellerId)) return res.json({ label, text: POST_LABEL_TEXT[label], items: [] });

  const rows = await db.select({
    id: posts.id, userId: posts.userId, caption: posts.caption, mediaUrl: posts.mediaUrl,
    thumbnailUrl: posts.thumbnailUrl, mediaType: posts.mediaType, createdAt: posts.createdAt,
  })
    .from(posts)
    .innerJoin(postLabels, and(eq(postLabels.postId, posts.id), eq(postLabels.label, label)))
    .where(and(
      eq(posts.userId, sellerId),
      publicPostCondition(new Date(), viewerId),
      beforeDate && !Number.isNaN(beforeDate.getTime()) ? lt(posts.createdAt, beforeDate) : undefined,
      blocked.size > 0 ? notInArray(posts.userId, [...blocked]) : undefined,
    ))
    .orderBy(desc(posts.createdAt))
    .limit(limit);
  const items = await attachPostExtras(rows.map((row) => ({ ...row, image: postCardImage(row) })));
  return res.json({ label, text: POST_LABEL_TEXT[label], items });
});

export default router;
