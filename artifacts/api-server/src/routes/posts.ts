/**
 * Seller-authored Thread posts.
 * POST /api/posts              — create post + tag products (requireAuth)
 * GET  /api/posts/:id          — get single post + tags + counts (public)
 * POST /api/posts/:id/interact — toggle like / repost; record watch_time (requireAuth)
 */
import { Router } from "express";
import {
  db, posts, postTaggedProducts, products, users, interactions,
} from "@workspace/db";
import { eq, and, inArray, count, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
