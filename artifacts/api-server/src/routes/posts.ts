/**
 * Seller-authored Thread posts.
 * GET  /api/posts/feed          — buyer's personalised Thread feed (requireAuth)
 *                                 Posts from sellers the buyer follows, newest-first.
 * GET  /api/public/posts        — paginated public feed of all published posts (no auth)
 * POST /api/posts              — create post + tag products (requireAuth)
 * GET  /api/posts/:id          — get single post + tags + counts (public)
 * POST /api/posts/:id/interact — toggle like / repost; record watch_time (requireAuth)
 */
import { Router } from "express";
import {
  db, posts, postTaggedProducts, products, users, interactions, follows, boosts,
} from "@workspace/db";
import { eq, and, inArray, count, sql, desc, lt, gte } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── GET /api/posts/feed ──────────────────────────────────────────────────────
// Buyer's personalised Thread feed: posts from sellers the buyer follows,
// newest-first. Requires auth so we can resolve the buyer's follows.
// Query params: ?limit=30&offset=0
router.get("/feed", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const lim = Math.min(parseInt((req.query.limit as string) || "30", 10) || 30, 50);
  const off = Math.max(parseInt((req.query.offset as string) || "0", 10) || 0, 0);

  try {
    // 1. Which seller accounts does this buyer follow?
    const followRows = await db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(eq(follows.followerId, clerkId));

    const followedIds = followRows.map((r) => r.followingId);

    // No followed sellers → return empty feed (real empty, not demo)
    if (followedIds.length === 0) {
      return res.json([]);
    }

    // 2. Fetch posts from those followed accounts (seller-only gate via users join)
    const rows = await db
      .select({
        id:          posts.id,
        userId:      posts.userId,
        mediaUrl:    posts.mediaUrl,
        mediaType:   posts.mediaType,
        caption:     posts.caption,
        styleTags:   posts.styleTags,
        createdAt:   posts.createdAt,
        displayName: users.displayName,
        brandName:   users.brandName,
        verified:    users.verified,
        accountType: users.accountType,
      })
      .from(posts)
      .innerJoin(users, and(
        eq(users.clerkId, posts.userId),
        eq(users.accountType, "seller"),        // seller-only gate
        inArray(posts.userId, followedIds),     // followed-only gate
      ))
      .orderBy(desc(posts.createdAt))
      .limit(lim)
      .offset(off);

    if (rows.length === 0) {
      return res.json([]);
    }

    const postIds = rows.map((r) => r.id);

    // 3. Fetch tagged products and interaction counts in parallel
    const [tagRows, likeRows, repostRows, commentRows] = await Promise.all([
      db
        .select({
          postId:    postTaggedProducts.postId,
          productId: postTaggedProducts.productId,
          position:  postTaggedProducts.position,
          name:      products.name,
          images:    products.images,
        })
        .from(postTaggedProducts)
        .leftJoin(products, eq(products.id, postTaggedProducts.productId))
        .where(inArray(postTaggedProducts.postId, postIds))
        .orderBy(postTaggedProducts.position),

      db
        .select({ postId: interactions.postId, cnt: count() })
        .from(interactions)
        .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "like")))
        .groupBy(interactions.postId),

      db
        .select({ postId: interactions.postId, cnt: count() })
        .from(interactions)
        .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "repost")))
        .groupBy(interactions.postId),

      db
        .select({ postId: interactions.postId, cnt: count() })
        .from(interactions)
        .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "comment")))
        .groupBy(interactions.postId),
    ]);

    // Index by postId for O(1) lookup
    const tagsByPost: Record<string, typeof tagRows> = {};
    for (const t of tagRows) {
      if (!tagsByPost[t.postId]) tagsByPost[t.postId] = [];
      tagsByPost[t.postId].push(t);
    }
    const likesByPost: Record<string, number> = {};
    for (const r of likeRows) if (r.postId) likesByPost[r.postId] = Number(r.cnt);
    const repostsByPost: Record<string, number> = {};
    for (const r of repostRows) if (r.postId) repostsByPost[r.postId] = Number(r.cnt);
    const commentsByPost: Record<string, number> = {};
    for (const r of commentRows) if (r.postId) commentsByPost[r.postId] = Number(r.cnt);

    // ─── Boost ranking: find active boosts for this page of posts ────────────
    const now = new Date();
    const boostRows = await db
      .select({ id: boosts.id, targetId: boosts.targetId })
      .from(boosts)
      .where(and(
        eq(boosts.targetType, "post"),
        eq(boosts.status, "active"),
        gte(boosts.endsAt, now),
        inArray(boosts.targetId, postIds),
      ));
    const boostedPostIds = new Set(boostRows.map((b) => b.targetId));

    // Fire-and-forget: increment impressions_count for each active boost that
    // appears in this feed page. One increment per boost row per request.
    if (boostRows.length > 0) {
      const boostIds = boostRows.map((b) => b.id);
      db.update(boosts)
        .set({ impressionsCount: sql`${boosts.impressionsCount} + 1` })
        .where(inArray(boosts.id, boostIds))
        .catch(() => {});
    }

    const result = rows.map((p) => ({
      id:        p.id,
      userId:    p.userId,
      mediaUrl:  p.mediaUrl,
      mediaType: p.mediaType,
      caption:   p.caption,
      styleTags: p.styleTags,
      createdAt: p.createdAt,
      boosted:   boostedPostIds.has(p.id),
      seller: {
        displayName: p.displayName,
        brandName:   p.brandName,
        verified:    p.verified,
      },
      taggedProducts: (tagsByPost[p.id] ?? []).map((t) => ({
        productId: t.productId,
        position:  t.position,
        name:      t.name,
        images:    t.images,
      })),
      likesCount:    likesByPost[p.id]    ?? 0,
      repostsCount:  repostsByPost[p.id]  ?? 0,
      commentsCount: commentsByPost[p.id] ?? 0,
    }));

    // Stable-sort: boosted posts surface first, rest preserve createdAt DESC order
    result.sort((a, b) => {
      const boost = (b.boosted ? 1 : 0) - (a.boosted ? 1 : 0);
      return boost; // ties keep their original relative order (stable in V8)
    });

    return res.json(result);
  } catch (err) {
    req.log.error({ err, clerkId }, "Failed to fetch posts feed");
    return res.status(500).json({ error: "Failed to fetch feed" });
  }
});

// ─── POST /api/posts ─────────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;

  // ── Seller-only gate ────────────────────────────────────────────────────────
  // Only seller accounts may publish to the Thread feed. This is enforced
  // server-side so a buyer cannot bypass it by calling the API directly.
  const [poster] = await db
    .select({ accountType: users.accountType })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!poster || poster.accountType !== "seller") {
    return res.status(403).json({
      error: "Only seller accounts can post to the Thread feed.",
      code:  "SELLER_ONLY",
    });
  }
  // ───────────────────────────────────────────────────────────────────────────

  const {
    mediaUrl, mediaType, caption, styleTags, taggedProductIds,
  } = req.body as {
    mediaUrl?:          string;
    mediaType?:         string;
    caption?:           string;
    styleTags?:         string[];
    taggedProductIds?:  string[];
  };

  const [post] = await db.insert(posts).values({
    userId:    clerkId,
    mediaUrl:  mediaUrl  ?? "",
    mediaType: (mediaType as any) ?? "photo",
    caption:   caption   ?? "",
    styleTags: styleTags ?? [],
  }).returning();

  // Validate + tag products (must belong to the posting seller)
  const taggedProducts: any[] = [];
  if (taggedProductIds && taggedProductIds.length > 0) {
    const validIds = taggedProductIds.filter((id) => UUID_RE.test(id));
    if (validIds.length > 0) {
      const sellerProds = await db
        .select({ id: products.id, name: products.name, images: products.images })
        .from(products)
        .where(and(inArray(products.id, validIds), eq(products.ownerId, clerkId)));

      if (sellerProds.length > 0) {
        await db.insert(postTaggedProducts).values(
          sellerProds.map((p, i) => ({ postId: post.id, productId: p.id, position: i })),
        );
        taggedProducts.push(...sellerProds);
      }
    }
  }

  return res.status(201).json({ ...post, taggedProducts });
});

// ─── GET /api/posts/:id ──────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Post not found" });

  const [post] = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  if (!post) return res.status(404).json({ error: "Post not found" });

  const [sellerRows, tags, likeRows, repostRows] = await Promise.all([
    db.select({ displayName: users.displayName, brandName: users.brandName, verified: users.verified })
      .from(users).where(eq(users.clerkId, post.userId)).limit(1),
    db.select({
      productId: postTaggedProducts.productId,
      position:  postTaggedProducts.position,
      name:      products.name,
      images:    products.images,
    }).from(postTaggedProducts)
      .leftJoin(products, eq(products.id, postTaggedProducts.productId))
      .where(eq(postTaggedProducts.postId, id))
      .orderBy(postTaggedProducts.position),
    db.select({ count: count() }).from(interactions)
      .where(and(eq(interactions.postId, id), eq(interactions.type, "like"))),
    db.select({ count: count() }).from(interactions)
      .where(and(eq(interactions.postId, id), eq(interactions.type, "repost"))),
  ]);

  return res.json({
    ...post,
    seller:       sellerRows[0] ?? null,
    taggedProducts: tags,
    likeCount:    likeRows[0]?.count   ?? 0,
    repostCount:  repostRows[0]?.count ?? 0,
  });
});

// ─── POST /api/posts/:id/interact ────────────────────────────────────────────
router.post("/:id/interact", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const { id } = req.params;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return res.status(404).json({ error: "Post not found" });
  }
  const { type, value } = req.body as {
    type: "like" | "repost" | "watch_time";
    value?: string;
  };

  if (!["like", "repost", "watch_time"].includes(type)) {
    return res.status(400).json({ error: "type must be like, repost, or watch_time" });
  }

  if (type === "watch_time") {
    await db.insert(interactions).values({ userId: clerkId, postId: id, type, value: value ?? null });
    return res.json({ action: "recorded" });
  }

  // Toggle for like / repost
  const [existing] = await db
    .select({ id: interactions.id })
    .from(interactions)
    .where(and(eq(interactions.userId, clerkId), eq(interactions.postId, id), eq(interactions.type, type)))
    .limit(1);

  let action: string;
  if (existing) {
    await db.delete(interactions).where(eq(interactions.id, existing.id));
    action = "removed";
  } else {
    await db.insert(interactions).values({ userId: clerkId, postId: id, type, value: null });
    action = "added";
  }

  const [{ count: newCount }] = await db
    .select({ count: count() })
    .from(interactions)
    .where(and(eq(interactions.postId, id), eq(interactions.type, type)));

  return res.json({ action, count: newCount });
});

export default router;
