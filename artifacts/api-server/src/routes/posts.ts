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
  db, posts, postTaggedProducts, products, productVariants, users, interactions, follows, boosts, blocks,
  savedItems, orders,
} from "@workspace/db";
import { eq, and, inArray, count, sql, desc, lte, lt, gte, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { deriveSellerVerified } from "../lib/sellerEligibility";
import { enqueueBatchedNotification } from "../lib/push";
import postVideoRouter, {
  mediaUrl as composedMediaUrl,
  setComposedMediaVisibility,
} from "./post-video";
import postSlideRouter from "./post-slide";
import { validateSlideOverlays, MAX_SLIDES } from "../lib/slideValidation";
import { evaluateContent, matchesMutedWords } from "../lib/contentModerator";
import { publicPostCondition, visibleCommentCounts } from "../lib/postVisibility";
import { parsePagination, setPaginationHeaders } from "../lib/pagination";
import {
  enqueueAutoFilterReport,
  isBlockedEitherWay,
  mutedPhrasesFor,
  notBlockedWith,
  optionalViewerId,
  publishingRestriction,
} from "../lib/safety";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POST_STATUSES = ["draft", "scheduled", "published", "archived", "deleted"] as const;
type PostStatus = typeof POST_STATUSES[number];
const OBJECT_PATH_RE = /^\/objects\/uploads\/[A-Za-z0-9._/-]+$/;

function validObjectPath(value: unknown): value is string {
  return typeof value === "string" &&
    OBJECT_PATH_RE.test(value) &&
    !value.split("/").includes("..");
}

/** Published, public, not held/removed by moderation, author in good standing. */
function visiblePostCondition(now = new Date()) {
  return publicPostCondition(now);
}

/** Caption + hashtags are what other people read, so both are filtered. */
function publicPostText(caption: unknown, hashtags: unknown): string {
  const tags = Array.isArray(hashtags) ? hashtags.filter((tag) => typeof tag === "string") : [];
  return [typeof caption === "string" ? caption : "", ...tags].join(" ").trim();
}

function parseScheduledAt(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function composedMediaPath(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const pathname = new URL(value, "https://brandthread.invalid").pathname;
    const marker = "/api/posts/media/";
    const index = pathname.indexOf(marker);
    if (index < 0) return null;
    const suffix = decodeURIComponent(pathname.slice(index + marker.length));
    if (!suffix || suffix.includes("..")) return null;
    return `/objects/${suffix.replace(/^\/+/, "")}`;
  } catch {
    return null;
  }
}

function composedMediaPaths(post: Pick<typeof posts.$inferSelect, "mediaUrl" | "thumbnailUrl">) {
  return [
    composedMediaPath(post.mediaUrl),
    composedMediaPath(post.thumbnailUrl),
  ];
}

async function sellerExists(clerkId: string): Promise<boolean> {
  const [seller] = await db
    .select({ accountType: users.accountType })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  return seller?.accountType === "seller";
}

/**
 * Lowest variant price per product — a product has no price of its own
 * (that lives only on its variants), so this is what a tagged product's
 * displayed price ("Shop · $X") must come from.
 */
async function productMinPrices(productIds: string[]): Promise<Record<string, number>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return {};
  const rows = await db
    .select({ productId: productVariants.productId, minPriceCents: sql<number>`min(${productVariants.priceCents})` })
    .from(productVariants)
    .where(inArray(productVariants.productId, ids))
    .groupBy(productVariants.productId);
  return Object.fromEntries(rows.map((r) => [r.productId, Number(r.minPriceCents)]));
}

router.use("/", postVideoRouter);
router.use("/", postSlideRouter);

// ─── GET /api/posts/repost-context ────────────────────────────────────────────
// Returns only the small, privacy-safe avatar context needed for Thread cards.
// Repost identity is intentionally not part of public post responses: mutual
// friendship is evaluated here against the authenticated viewer.
const MAX_REPOST_CONTEXT_POSTS = 50;
const MAX_REPOST_CONTEXT_ACTORS = 5;

router.get("/repost-context", requireAuth, async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  const rawPostIds = req.query.postIds;
  if (typeof rawPostIds !== "string" || rawPostIds.trim() === "") {
    return res.status(400).json({ error: "postIds is required" });
  }

  const postIds = [...new Set(rawPostIds.split(",").map((value) => value.trim()).filter(Boolean))];
  if (postIds.length === 0 || postIds.length > MAX_REPOST_CONTEXT_POSTS) {
    return res.status(400).json({ error: `postIds must contain 1-${MAX_REPOST_CONTEXT_POSTS} IDs` });
  }
  if (postIds.some((postId) => !UUID_RE.test(postId))) {
    return res.status(400).json({ error: "postIds must contain UUIDs" });
  }

  try {
    const [viewer] = await db
      .select({ accountType: users.accountType })
      .from(users)
      .where(eq(users.clerkId, viewerId))
      .limit(1);
    if (viewer?.accountType !== "buyer") {
      return res.status(403).json({ error: "Buyer account required" });
    }

    const postIdList = sql.join(postIds.map((postId) => sql`${postId}::uuid`), sql`, `);
    const [rows, ownRows] = await Promise.all([
      db.execute(sql`
      SELECT
        i.post_id,
        u.clerk_id AS user_id,
        COALESCE(NULLIF(u.display_name, ''), NULLIF(u.name, '')) AS display_name,
        COALESCE(NULLIF(u.profile_image_url, ''), NULLIF(u.avatar_url, '')) AS avatar_url,
        i.created_at
      FROM interactions i
      INNER JOIN posts p ON p.id = i.post_id
      INNER JOIN users u ON u.clerk_id = i.user_id
      WHERE i.type = 'repost'
        AND i.post_id IN (${postIdList})
        AND COALESCE((p.visibility->>'isPublic')::boolean, true) = true
        AND (
          p.post_status = 'published'
          OR (p.post_status = 'scheduled' AND p.scheduled_at <= NOW())
        )
        AND u.account_type = 'buyer'
        AND i.user_id <> ${viewerId}
        AND EXISTS (
          SELECT 1
          FROM follows viewer_follows
          INNER JOIN follows actor_follows
            ON actor_follows.follower_id = viewer_follows.following_id
           AND actor_follows.following_id = viewer_follows.follower_id
          WHERE viewer_follows.follower_id = ${viewerId}
            AND viewer_follows.following_id = i.user_id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM blocks b
          WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = i.user_id)
             OR (b.blocker_id = i.user_id AND b.blocked_id = ${viewerId})
        )
      ORDER BY i.created_at DESC
    `),
      db.execute(sql`
        SELECT i.post_id
        FROM interactions i
        INNER JOIN posts p ON p.id = i.post_id
        WHERE i.type = 'repost'
          AND i.user_id = ${viewerId}
          AND i.post_id IN (${postIdList})
          AND COALESCE((p.visibility->>'isPublic')::boolean, true) = true
          AND (
            p.post_status = 'published'
            OR (p.post_status = 'scheduled' AND p.scheduled_at <= NOW())
          )
      `),
    ]);

    const ownPostIds = new Set(
      ((((ownRows as any).rows ?? []) as any[]).map((row) => String(row.post_id))),
    );
    const context: Record<string, {
      repostedByMe: boolean;
      reposters: Array<{
      userId: string;
      displayName: string | null;
      avatarUrl: string | null;
      createdAt: Date;
      }>;
    }> = Object.fromEntries(postIds.map((postId) => [
      postId,
      { repostedByMe: ownPostIds.has(postId), reposters: [] },
    ]));
    for (const row of (((rows as any).rows ?? []) as any[])) {
      const postId = String(row.post_id);
      const actors = context[postId]?.reposters;
      if (!actors) continue;
      if (actors.length >= MAX_REPOST_CONTEXT_ACTORS) continue;
      actors.push({
        userId: String(row.user_id),
        displayName: row.display_name == null ? null : String(row.display_name),
        avatarUrl: row.avatar_url == null ? null : String(row.avatar_url),
        createdAt: row.created_at,
      });
    }
    return res.json(context);
  } catch (err) {
    req.log.error({ err, viewerId }, "Failed to fetch repost context");
    return res.status(500).json({ error: "Failed to fetch repost context" });
  }
});

async function postDetails(postRows: typeof posts.$inferSelect[]) {
  if (postRows.length === 0) return [];
  const postIds = postRows.map((post) => post.id);
  const sellerIds = [...new Set(postRows.map((post) => post.userId))];
  const [sellerRows, tagRows, likeRows, repostRows, commentRows] = await Promise.all([
    db.select({
      clerkId: users.clerkId,
      displayName: users.displayName,
      brandName: users.brandName,
      verified: users.verified,
      verificationStatus: users.verificationStatus,
      activeStanding: users.activeStanding,
      policyRestricted: users.policyRestricted,
    }).from(users).where(inArray(users.clerkId, sellerIds)),
    db.select({
      postId: postTaggedProducts.postId,
      productId: postTaggedProducts.productId,
      position: postTaggedProducts.position,
      name: products.name,
      images: products.images,
    }).from(postTaggedProducts)
      .leftJoin(products, eq(products.id, postTaggedProducts.productId))
      .where(inArray(postTaggedProducts.postId, postIds))
      .orderBy(postTaggedProducts.position),
    db.select({ postId: interactions.postId, cnt: count() }).from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "like")))
      .groupBy(interactions.postId),
    db.select({ postId: interactions.postId, cnt: count() }).from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "repost")))
      .groupBy(interactions.postId),
    visibleCommentCounts(postIds),
  ]);
  const sellerById = new Map(sellerRows.map((seller) => [seller.clerkId, seller]));
  const tagsByPost: Record<string, typeof tagRows> = {};
  for (const tag of tagRows) (tagsByPost[tag.postId] ??= []).push(tag);
  const minPriceByProduct = await productMinPrices(tagRows.map((tag) => tag.productId));
  const countByPost = (rows: Array<{ postId: string | null; cnt: number }>) =>
    Object.fromEntries(rows.filter((row) => row.postId).map((row) => [row.postId, Number(row.cnt)]));
  const likesByPost = countByPost(likeRows);
  const repostsByPost = countByPost(repostRows);
  const commentsByPost = Object.fromEntries(commentRows);

  return postRows.map((post) => {
    const seller = sellerById.get(post.userId);
    const isDue = post.postStatus === "scheduled" &&
      !!post.scheduledAt && post.scheduledAt.getTime() <= Date.now();
    return {
      ...post,
      postStatus: isDue ? "published" : post.postStatus,
      seller: seller ? {
        displayName: seller.displayName,
        brandName: seller.brandName,
        verified: deriveSellerVerified(seller),
      } : null,
      taggedProducts: (tagsByPost[post.id] ?? []).map((tag) => ({
        productId: tag.productId,
        position: tag.position,
        name: tag.name,
        images: tag.images,
        priceCents: minPriceByProduct[tag.productId] ?? 0,
      })),
      likesCount: post.visibility?.showLikeCount === false ? null : likesByPost[post.id] ?? 0,
      repostsCount: repostsByPost[post.id] ?? 0,
      commentsCount: commentsByPost[post.id] ?? 0,
    };
  });
}

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
    const pageRows = await db
      .select({
        id:          posts.id,
        userId:      posts.userId,
        mediaUrl:    posts.mediaUrl,
        thumbnailUrl: posts.thumbnailUrl,
        mediaUrls:   posts.mediaUrls,
        mediaType:   posts.mediaType,
        aspectRatio: posts.aspectRatio,
        caption:     posts.caption,
        hashtags:    posts.hashtags,
        styleTags:   posts.styleTags,
        sound:       posts.sound,
        visibility:  posts.visibility,
        createdAt:   posts.createdAt,
        displayName: users.displayName,
        brandName:   users.brandName,
        verified:    users.verified,
        verificationStatus: users.verificationStatus,
        activeStanding: users.activeStanding,
        policyRestricted: users.policyRestricted,
        accountType: users.accountType,
      })
      .from(posts)
      .innerJoin(users, and(
        eq(users.clerkId, posts.userId),
        eq(users.accountType, "seller"),        // seller-only gate
        inArray(posts.userId, followedIds),     // followed-only gate
      ))
      .where(and(visiblePostCondition(), notBlockedWith(clerkId, posts.userId)))
      .orderBy(desc(posts.createdAt))
      .limit(lim)
      .offset(off);

    // Muted words hide matching captions from this viewer only.
    const muted = await mutedPhrasesFor(clerkId);
    const rows = muted.length === 0
      ? pageRows
      : pageRows.filter((row) => !matchesMutedWords(publicPostText(row.caption, row.hashtags), muted));

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

      visibleCommentCounts(postIds),
    ]);

    // Index by postId for O(1) lookup
    const tagsByPost: Record<string, typeof tagRows> = {};
    for (const t of tagRows) {
      if (!tagsByPost[t.postId]) tagsByPost[t.postId] = [];
      tagsByPost[t.postId].push(t);
    }
    const minPriceByProduct = await productMinPrices(tagRows.map((t) => t.productId));
    const likesByPost: Record<string, number> = {};
    for (const r of likeRows) if (r.postId) likesByPost[r.postId] = Number(r.cnt);
    const repostsByPost: Record<string, number> = {};
    for (const r of repostRows) if (r.postId) repostsByPost[r.postId] = Number(r.cnt);
    const commentsByPost: Record<string, number> = Object.fromEntries(commentRows);

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
      thumbnailUrl: p.thumbnailUrl,
      mediaUrls: p.mediaUrls,
      mediaType: p.mediaType,
      aspectRatio: p.aspectRatio,
      caption:   p.caption,
      hashtags:  p.hashtags,
      styleTags: p.styleTags,
      sound:     p.sound,
      visibility: p.visibility,
      createdAt: p.createdAt,
      boosted:   boostedPostIds.has(p.id),
      seller: {
        displayName: p.displayName,
        brandName:   p.brandName,
        verified:    deriveSellerVerified(p),
      },
      taggedProducts: (tagsByPost[p.id] ?? []).map((t) => ({
        productId: t.productId,
        position:  t.position,
        name:      t.name,
        images:    t.images,
        priceCents: minPriceByProduct[t.productId] ?? 0,
      })),
      likesCount:    p.visibility?.showLikeCount === false ? null : likesByPost[p.id] ?? 0,
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
// Sellers publish to the Thread feed (GET /feed already restricts the feed
// join to accountType='seller', so this is the only writer that can reach
// it). Buyers may post PHOTO posts (single photo or a photo carousel, with a
// caption) to their own profile only — the accountType='seller' join on the
// feed means a buyer post can never surface there no matter what fields are
// set on it, but we additionally hard-block video/product-tagging for buyers
// below so the write path itself can't be used to fake a Thread post.
router.post("/", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;

  const [poster] = await db
    .select({ accountType: users.accountType })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);

  if (!poster || (poster.accountType !== "seller" && poster.accountType !== "buyer")) {
    return res.status(403).json({
      error: "Only buyer and seller accounts can post.",
      code:  "ACCOUNT_TYPE_REQUIRED",
    });
  }
  const isBuyer = poster.accountType === "buyer";

  const {
    mediaUrl: requestedMediaUrl, thumbnailUrl: requestedThumbnailUrl, mediaPath, thumbnailPath,
    mediaPaths: requestedMediaPaths, slideOverlays: requestedSlideOverlays,
    mediaUrls, mediaType, aspectRatio, caption, hashtags, styleTags,
    sound, visibility, taggedProductIds, isDraft, scheduledAt,
  } = req.body as {
    mediaUrl?:          string;
    thumbnailUrl?:      string;
    mediaPath?:         string;
    thumbnailPath?:     string;
    mediaPaths?:        string[];
    slideOverlays?:     unknown;
    mediaUrls?:         string[];
    mediaType?:         string;
    aspectRatio?:       string;
    caption?:           string;
    hashtags?:          string[];
    styleTags?:         string[];
    sound?:             typeof posts.$inferInsert.sound;
    visibility?:        typeof posts.$inferInsert.visibility;
    taggedProductIds?:  string[];
    isDraft?:           boolean;
    scheduledAt?:       string | null;
  };

  const restriction = await publishingRestriction(clerkId);
  if (restriction) return res.status(restriction.status).json(restriction.body);

  // ── Buyer posting rules ─────────────────────────────────────────────────────
  // Buyers may only post photos (single or carousel) to their own profile —
  // no video, no product tagging (they don't own products), no scheduling.
  if (isBuyer) {
    const requestedType = (mediaType as string | undefined) ?? "photo";
    if (requestedType !== "photo" && requestedType !== "slideshow") {
      return res.status(403).json({
        error: "Buyer accounts can only post photos (single or carousel).",
        code:  "BUYER_PHOTO_ONLY",
      });
    }
    if (taggedProductIds && taggedProductIds.length > 0) {
      return res.status(403).json({
        error: "Buyer accounts cannot tag products.",
        code:  "BUYER_NO_PRODUCT_TAGS",
      });
    }
    if (scheduledAt) {
      return res.status(403).json({
        error: "Buyer posts cannot be scheduled.",
        code:  "BUYER_NO_SCHEDULING",
      });
    }
  }

  if (caption !== undefined && caption !== null && typeof caption !== "string") {
    return res.status(400).json({ error: "caption must be a string" });
  }
  const captionDecision = evaluateContent(publicPostText(caption, hashtags), "public");
  if (captionDecision.action === "reject") {
    return res.status(422).json({
      error: `${captionDecision.reason} Edit your caption and try again.`,
      category: captionDecision.category,
      code: "CONTENT_REJECTED",
    });
  }
  const captionHeld = captionDecision.action === "hold";

  const parsedScheduledAt = parseScheduledAt(scheduledAt);
  if (scheduledAt !== undefined && parsedScheduledAt === undefined) {
    return res.status(400).json({ error: "scheduledAt must be a valid ISO date or null" });
  }
  if (isDraft && parsedScheduledAt) {
    return res.status(400).json({ error: "Draft posts cannot also be scheduled" });
  }
  if (mediaUrls !== undefined && (
    !Array.isArray(mediaUrls) || mediaUrls.some((url) => typeof url !== "string")
  )) {
    return res.status(400).json({ error: "mediaUrls must be an array of strings" });
  }
  // Validate mediaPaths — all must be valid owned object paths; max MAX_SLIDES entries; no duplicates
  let resolvedMediaPaths: string[] = [];
  if (requestedMediaPaths !== undefined) {
    if (!Array.isArray(requestedMediaPaths)) {
      return res.status(400).json({ error: "mediaPaths must be an array" });
    }
    if (requestedMediaPaths.length > MAX_SLIDES) {
      return res.status(400).json({ error: `mediaPaths: max ${MAX_SLIDES} entries` });
    }
    if (requestedMediaPaths.some((p) => !validObjectPath(p))) {
      return res.status(400).json({ error: "mediaPaths must be an array of valid object paths" });
    }
    const unique = new Set(requestedMediaPaths);
    if (unique.size !== requestedMediaPaths.length) {
      return res.status(400).json({ error: "mediaPaths must not contain duplicates" });
    }
    resolvedMediaPaths = requestedMediaPaths;
  }
  if (hashtags !== undefined && (
    !Array.isArray(hashtags) || hashtags.some((tag) => typeof tag !== "string")
  )) {
    return res.status(400).json({ error: "hashtags must be an array of strings" });
  }
  if (styleTags !== undefined && (
    !Array.isArray(styleTags) || styleTags.some((tag) => typeof tag !== "string")
  )) {
    return res.status(400).json({ error: "styleTags must be an array of strings" });
  }
  if (sound !== undefined && sound !== null && (typeof sound !== "object" || Array.isArray(sound))) {
    return res.status(400).json({ error: "sound must be an object or null" });
  }
  if (visibility !== undefined) {
    if (!visibility || typeof visibility !== "object" || Array.isArray(visibility)) {
      return res.status(400).json({ error: "visibility must be an object" });
    }
    const controls = visibility as Record<string, unknown>;
    if (["allowComments", "allowReposts", "showLikeCount"].some((key) => typeof controls[key] !== "boolean")) {
      return res.status(400).json({ error: "visibility controls must be booleans" });
    }
    if (controls.isPublic !== undefined && typeof controls.isPublic !== "boolean") {
      return res.status(400).json({ error: "visibility.isPublic must be a boolean" });
    }
  }
  const now = new Date();
  if (parsedScheduledAt && parsedScheduledAt.getTime() <= now.getTime()) {
    return res.status(400).json({ error: "scheduledAt must be in the future" });
  }
  const postStatus: PostStatus = isDraft
    ? "draft"
    : parsedScheduledAt && parsedScheduledAt.getTime() > now.getTime()
      ? "scheduled"
      : "published";

  const mediaUrl = mediaPath ? composedMediaUrl(req, mediaPath) : (requestedMediaUrl ?? "");
  const thumbnailUrl = thumbnailPath ? composedMediaUrl(req, thumbnailPath) : requestedThumbnailUrl;
  const resolvedVisibility = visibility ?? {
    isPublic: true,
    allowComments: true,
    allowReposts: true,
    showLikeCount: true,
  };
  // Strictly validate slideOverlays — must pass even if compose-slideshow was bypassed
  const slideOverlaysResult = validateSlideOverlays(requestedSlideOverlays);
  if (!slideOverlaysResult.ok) {
    return res.status(400).json({ error: slideOverlaysResult.error });
  }
  const safeSlideOverlays = slideOverlaysResult.records;

  const [post] = await db.insert(posts).values({
    userId:    clerkId,
    mediaUrl,
    thumbnailUrl: thumbnailUrl ?? null,
    mediaUrls: mediaPath ? [mediaUrl] : (resolvedMediaPaths.length > 0 ? [] : (mediaUrls ?? (mediaUrl ? [mediaUrl] : []))),
    mediaPaths: resolvedMediaPaths,
    slideOverlays: safeSlideOverlays as any,
    mediaType: (mediaType as any) ?? "photo",
    aspectRatio: aspectRatio ?? "9:16",
    caption:   caption   ?? "",
    hashtags: hashtags ?? [],
    styleTags: styleTags ?? [],
    sound: sound ?? null,
    visibility: resolvedVisibility,
    postStatus,
    scheduledAt: postStatus === "scheduled" ? parsedScheduledAt : null,
    publishedAt: postStatus === "published" ? now : null,
    moderationStatus: captionHeld ? "held" : "visible",
    moderationReason: captionDecision.action === "hold" ? captionDecision.category : null,
    updatedAt: now,
  }).returning();

  if (captionDecision.action === "hold") {
    await enqueueAutoFilterReport({
      targetType: post.mediaType === "video" ? "video" : "post",
      targetId: post.id,
      ownerId: clerkId,
      excerpt: publicPostText(caption, hashtags),
      category: captionDecision.category,
      label: post.mediaType === "video" ? "Video" : "Post",
    }).catch((err) => req.log.error({ err, postId: post.id }, "Could not queue held caption for review"));
  }

  // Determine which composed paths to set ACL on
  const allComposedPaths = [
    ...(mediaPath ? [mediaPath] : []),
    ...(thumbnailPath ? [thumbnailPath] : []),
    ...resolvedMediaPaths,
  ];
  if (allComposedPaths.length > 0) {
    try {
      await setComposedMediaVisibility(
        clerkId,
        allComposedPaths,
        postStatus === "published" && resolvedVisibility.isPublic !== false
          ? "public"
          : "private",
      );
    } catch (err) {
      await db.delete(posts).where(eq(posts.id, post.id)).catch(() => {});
      req.log.error({ err, clerkId, postId: post.id }, "Could not publish composed post media");
      return res.status(400).json({ error: "Composed media is unavailable or is not owned by this seller" });
    }
  }

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

  return res.status(201).json({
    ...post,
    taggedProducts,
    moderation: captionHeld
      ? { status: "held", message: "Your caption is in review. The post stays hidden from others until a moderator approves it." }
      : { status: "visible" },
  });
});

// ─── GET /api/posts/mine ─────────────────────────────────────────────────────
// Authenticated seller library. Unlike /api/public/posts this includes only
// the caller's own published, draft, and scheduled posts.
// Query params: ?limit=&offset= (default 100, capped at MAX_PAGE_LIMIT) — a
// long-lived seller's full post history was previously loaded unbounded.
router.get("/mine", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  if (!await sellerExists(clerkId)) {
    return res.status(403).json({ error: "Only seller accounts can manage posts.", code: "SELLER_ONLY" });
  }
  const page = parsePagination(req.query, { limit: 100 });
  if (!page.success) return res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" });
  const { limit, offset } = page.data;
  try {
    const rows = await db.select().from(posts)
      .where(and(
        eq(posts.userId, clerkId),
        inArray(posts.postStatus, ["draft", "scheduled", "published", "archived"]),
      ))
      .orderBy(desc(posts.createdAt))
      .limit(limit)
      .offset(offset);
    setPaginationHeaders(res, page.data, rows.length);
    return res.json(await postDetails(rows));
  } catch (err) {
    req.log.error({ err, clerkId }, "Failed to fetch seller posts");
    return res.status(500).json({ error: "Failed to fetch seller posts" });
  }
});

// ─── PATCH /api/posts/:id ────────────────────────────────────────────────────
router.patch("/:id", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return res.status(404).json({ error: "Post not found" });
  }
  if (!await sellerExists(clerkId)) {
    return res.status(403).json({ error: "Only seller accounts can manage posts.", code: "SELLER_ONLY" });
  }

  const body = req.body as Record<string, unknown>;
  const [existing] = await db.select().from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, clerkId))).limit(1);
  if (!existing) return res.status(404).json({ error: "Post not found" });

  const updates: Partial<typeof posts.$inferInsert> = {};
  if (body.mediaUrl !== undefined) {
    if (typeof body.mediaUrl !== "string") return res.status(400).json({ error: "mediaUrl must be a string" });
    updates.mediaUrl = body.mediaUrl;
  }
  if (body.thumbnailUrl !== undefined) {
    if (body.thumbnailUrl !== null && typeof body.thumbnailUrl !== "string") {
      return res.status(400).json({ error: "thumbnailUrl must be a string or null" });
    }
    updates.thumbnailUrl = body.thumbnailUrl as string | null;
  }
  if (body.mediaUrls !== undefined) {
    if (!Array.isArray(body.mediaUrls) || body.mediaUrls.some((url) => typeof url !== "string")) {
      return res.status(400).json({ error: "mediaUrls must be an array of strings" });
    }
    updates.mediaUrls = body.mediaUrls as string[];
    updates.mediaUrl = (body.mediaUrls as string[])[0] ?? "";
  }
  if (body.mediaPaths !== undefined) {
    if (!Array.isArray(body.mediaPaths)) {
      return res.status(400).json({ error: "mediaPaths must be an array" });
    }
    if ((body.mediaPaths as unknown[]).length > MAX_SLIDES) {
      return res.status(400).json({ error: `mediaPaths: max ${MAX_SLIDES} entries` });
    }
    if ((body.mediaPaths as unknown[]).some((p) => !validObjectPath(p))) {
      return res.status(400).json({ error: "mediaPaths must be an array of valid object paths" });
    }
    const patchPaths = body.mediaPaths as string[];
    if (new Set(patchPaths).size !== patchPaths.length) {
      return res.status(400).json({ error: "mediaPaths must not contain duplicates" });
    }
    updates.mediaPaths = patchPaths;
  }
  if (body.slideOverlays !== undefined) {
    // Strictly validate — cannot trust caller bypassed compose-slideshow
    const patchOverlayResult = validateSlideOverlays(body.slideOverlays);
    if (!patchOverlayResult.ok) {
      return res.status(400).json({ error: patchOverlayResult.error });
    }
    updates.slideOverlays = patchOverlayResult.records as any;
  }
  if (body.mediaType !== undefined) {
    if (typeof body.mediaType !== "string" || body.mediaType.trim() === "") {
      return res.status(400).json({ error: "mediaType must be a non-empty string" });
    }
    updates.mediaType = body.mediaType;
  }
  if (body.aspectRatio !== undefined) {
    if (!["9:16", "3:4", "1:1"].includes(body.aspectRatio as string)) {
      return res.status(400).json({ error: "aspectRatio must be 9:16, 3:4, or 1:1" });
    }
    updates.aspectRatio = body.aspectRatio as string;
  }
  if (body.caption !== undefined && typeof body.caption !== "string") {
    return res.status(400).json({ error: "caption must be a string" });
  }
  if (body.hashtags !== undefined && (!Array.isArray(body.hashtags) || body.hashtags.some((tag) => typeof tag !== "string"))) {
    return res.status(400).json({ error: "hashtags must be an array of strings" });
  }
  if (body.caption !== undefined || body.hashtags !== undefined) {
    const nextText = publicPostText(
      body.caption !== undefined ? body.caption : existing.caption,
      body.hashtags !== undefined ? body.hashtags : existing.hashtags,
    );
    const decision = evaluateContent(nextText, "public");
    if (decision.action === "reject") {
      return res.status(422).json({
        error: `${decision.reason} Edit your caption and try again.`,
        category: decision.category,
        code: "CONTENT_REJECTED",
      });
    }
    if (decision.action === "hold" && existing.moderationStatus === "visible") {
      updates.moderationStatus = "held";
      updates.moderationReason = decision.category;
      await enqueueAutoFilterReport({
        targetType: existing.mediaType === "video" ? "video" : "post",
        targetId: existing.id,
        ownerId: clerkId,
        excerpt: nextText,
        category: decision.category,
        label: existing.mediaType === "video" ? "Video" : "Post",
      });
    }
  }
  if (body.caption !== undefined) {
    if (typeof body.caption !== "string") return res.status(400).json({ error: "caption must be a string" });
    updates.caption = body.caption;
  }
  if (body.hashtags !== undefined) {
    if (!Array.isArray(body.hashtags) || body.hashtags.some((tag) => typeof tag !== "string")) {
      return res.status(400).json({ error: "hashtags must be an array of strings" });
    }
    updates.hashtags = body.hashtags as string[];
  }
  if (body.styleTags !== undefined) {
    if (!Array.isArray(body.styleTags) || body.styleTags.some((tag) => typeof tag !== "string")) {
      return res.status(400).json({ error: "styleTags must be an array of strings" });
    }
    updates.styleTags = body.styleTags as string[];
  }
  if (body.sound !== undefined) {
    if (body.sound !== null && (typeof body.sound !== "object" || Array.isArray(body.sound))) {
      return res.status(400).json({ error: "sound must be an object or null" });
    }
    updates.sound = body.sound as typeof posts.$inferInsert.sound;
  }
  if (body.visibility !== undefined) {
    if (!body.visibility || typeof body.visibility !== "object" || Array.isArray(body.visibility)) {
      return res.status(400).json({ error: "visibility must be an object" });
    }
    const visibility = body.visibility as Record<string, unknown>;
    if (["allowComments", "allowReposts", "showLikeCount"].some((key) => typeof visibility[key] !== "boolean")) {
      return res.status(400).json({ error: "visibility controls must be booleans" });
    }
    if (visibility.isPublic !== undefined && typeof visibility.isPublic !== "boolean") {
      return res.status(400).json({ error: "visibility.isPublic must be a boolean" });
    }
    updates.visibility = body.visibility as typeof posts.$inferInsert.visibility;
  }
  if (body.postStatus !== undefined && (
    typeof body.postStatus !== "string" || !POST_STATUSES.includes(body.postStatus as PostStatus)
  )) {
    return res.status(400).json({ error: `postStatus must be one of ${POST_STATUSES.join(", ")}` });
  }

  const parsedScheduledAt = parseScheduledAt(body.scheduledAt);
  if (body.scheduledAt !== undefined && parsedScheduledAt === undefined) {
    return res.status(400).json({ error: "scheduledAt must be a valid ISO date or null" });
  }
  if (parsedScheduledAt && parsedScheduledAt.getTime() <= Date.now()) {
    return res.status(400).json({ error: "scheduledAt must be in the future" });
  }
  if (body.isDraft !== undefined && typeof body.isDraft !== "boolean") {
    return res.status(400).json({ error: "isDraft must be a boolean" });
  }
  const wantsDraft = body.isDraft === true || body.postStatus === "draft";
  const scheduled = body.scheduledAt !== undefined ? parsedScheduledAt : existing.scheduledAt;
  if (wantsDraft && scheduled) {
    return res.status(400).json({ error: "Draft posts cannot also be scheduled" });
  }

  const now = new Date();
  const requestedStatus = body.postStatus as PostStatus | undefined;
  let nextStatus = existing.postStatus as PostStatus;
  if (requestedStatus === "deleted") nextStatus = "deleted";
  else if (wantsDraft) nextStatus = "draft";
  else if (requestedStatus === "archived") nextStatus = "archived";
  else if (scheduled && scheduled.getTime() > now.getTime()) nextStatus = "scheduled";
  else if (requestedStatus === "published" || body.isDraft === false || body.scheduledAt !== undefined) nextStatus = "published";

  updates.postStatus = nextStatus;
  updates.scheduledAt = nextStatus === "scheduled" ? scheduled : null;
  updates.publishedAt = nextStatus === "published" ? (existing.publishedAt ?? now) : existing.publishedAt;
  updates.updatedAt = now;
  const nextVisibility = (updates.visibility ?? existing.visibility) as typeof posts.$inferInsert.visibility;
  const nextMediaPaths = [
    ...composedMediaPaths({
      mediaUrl: (updates.mediaUrl as string | undefined) ?? existing.mediaUrl,
      thumbnailUrl: (updates.thumbnailUrl as string | null | undefined) ?? existing.thumbnailUrl,
    }),
    // Include all slide media paths (new or existing)
    ...((updates.mediaPaths as string[] | undefined) ?? existing.mediaPaths ?? []),
  ].filter((p): p is string => !!p);

  const taggedProductIds = body.taggedProductIds;
  if (taggedProductIds !== undefined && (
    !Array.isArray(taggedProductIds) || taggedProductIds.some((productId) => typeof productId !== "string")
  )) {
    return res.status(400).json({ error: "taggedProductIds must be an array of strings" });
  }

  try {
    // Demote before the database transition; promote only after it. This keeps
    // failures closed rather than exposing unpublished composed objects.
    const shouldBePublic = nextStatus === "published" && nextVisibility?.isPublic !== false;
    if (!shouldBePublic) {
      await setComposedMediaVisibility(clerkId, nextMediaPaths, "private");
    }
    const updated = await db.transaction(async (tx) => {
      const [post] = await tx.update(posts).set(updates).where(eq(posts.id, id)).returning();
      if (taggedProductIds !== undefined) {
        const validIds = (taggedProductIds as string[]).filter((productId) => UUID_RE.test(productId));
        const ownedProducts = validIds.length > 0
          ? await tx.select({ id: products.id }).from(products)
            .where(and(inArray(products.id, validIds), eq(products.ownerId, clerkId)))
          : [];
        await tx.delete(postTaggedProducts).where(eq(postTaggedProducts.postId, id));
        if (ownedProducts.length > 0) {
          await tx.insert(postTaggedProducts).values(
            ownedProducts.map((product, position) => ({ postId: id, productId: product.id, position })),
          );
        }
      }
      return post;
    });
    if (shouldBePublic) {
      await setComposedMediaVisibility(clerkId, nextMediaPaths, "public");
    }
    return res.json((await postDetails([updated]))[0]);
  } catch (err) {
    req.log.error({ err, clerkId, postId: id }, "Failed to update seller post");
    return res.status(500).json({ error: "Failed to update post" });
  }
});

// ─── DELETE /api/posts/:id ───────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req, res) => {
  const clerkId = (req as any).clerkUserId as string;
  const id = req.params.id;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return res.status(404).json({ error: "Post not found" });
  }
  // Fetch existing post to get all media paths for cleanup
  const [existing] = await db.select().from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, clerkId))).limit(1);
  if (!existing) return res.status(404).json({ error: "Post not found" });

  const [deleted] = await db.update(posts)
    .set({ postStatus: "deleted", scheduledAt: null, updatedAt: new Date() })
    .where(and(eq(posts.id, id), eq(posts.userId, clerkId)))
    .returning({ id: posts.id });
  if (!deleted) return res.status(404).json({ error: "Post not found" });

  // Fire-and-forget: clean up all composed slide media paths
  const slidePaths = (existing.mediaPaths ?? []).filter(Boolean);
  if (slidePaths.length > 0) {
    Promise.all(
      slidePaths.map((p) =>
        setComposedMediaVisibility(clerkId, [p], "private").catch(() => {}),
      ),
    ).catch(() => {});
  }

  return res.json({ id: deleted.id, deleted: true });
});

// ─── GET /api/posts/:id/analytics ────────────────────────────────────────────
// Owner-only, server-verified post performance.
//
// Metric availability:
// - likes/reposts: always returned from durable interaction rows.
// - views: returned only after explicit `view` events have been recorded.
// - saves: current live saves from saved_items (`item_type = post`).
// - product clicks: explicit `shop_click` events.
// - conversions: non-cancelled orders whose source_post_id matches this post.
// - retention: average watch time only when valid `watch_time` samples exist.
//
// We intentionally do not derive views from feed delivery, infer completion
// rate without media duration, or fabricate unavailable values.
router.get("/:id/analytics", requireAuth, async (req, res) => {
  const ownerId = (req as any).clerkUserId as string;
  const { id } = req.params;
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return res.status(404).json({ error: "Post analytics not found" });
  }

  const [post] = await db
    .select({
      id: posts.id,
      mediaType: posts.mediaType,
      mediaUrl: posts.mediaUrl,
      caption: posts.caption,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(and(eq(posts.id, id), eq(posts.userId, ownerId)))
    .limit(1);

  // Deliberately return the same response for a missing post and another
  // seller's post so this endpoint never reveals ownership information.
  if (!post) {
    return res.status(404).json({ error: "Post analytics not found" });
  }

  try {
    const [interactionRows, saveRows, conversionRows, watchRows] = await Promise.all([
      db
        .select({
          type: interactions.type,
          count: sql<number>`count(*)::int`,
          uniqueUsers: sql<number>`count(distinct ${interactions.userId})::int`,
        })
        .from(interactions)
        .where(and(
          eq(interactions.postId, id),
          inArray(interactions.type, ["like", "repost", "view", "shop_click"]),
        ))
        .groupBy(interactions.type),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(savedItems)
        .where(and(eq(savedItems.itemType, "post"), eq(savedItems.targetId, id))),
      db
        .select({
          count: sql<number>`count(*)::int`,
          revenueCents: sql<number>`coalesce(sum(${orders.totalCents}), 0)::int`,
        })
        .from(orders)
        .where(and(
          eq(orders.ownerId, ownerId),
          eq(orders.sourcePostId, id),
          sql`${orders.status} != 'cancelled'`,
        )),
      db
        .select({ value: interactions.value })
        .from(interactions)
        .where(and(eq(interactions.postId, id), eq(interactions.type, "watch_time"))),
    ]);

    const interactionsByType = new Map(
      interactionRows.map((row) => [
        row.type,
        { count: Number(row.count), uniqueUsers: Number(row.uniqueUsers) },
      ]),
    );
    const views = interactionsByType.get("view");
    const productClicks = interactionsByType.get("shop_click");
    const validWatchSeconds = watchRows
      .map((row) => Number(row.value))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const conversionCount = Number(conversionRows[0]?.count ?? 0);
    const productClickCount = productClicks?.count ?? 0;

    return res.json({
      post: {
        ...post,
        createdAt: post.createdAt.toISOString(),
      },
      metrics: {
        likes: interactionsByType.get("like")?.count ?? 0,
        reposts: interactionsByType.get("repost")?.count ?? 0,
        views: views
          ? { tracked: true, count: views.count, uniqueViewers: views.uniqueUsers }
          : { tracked: false, count: null, uniqueViewers: null },
        saves: {
          tracked: true,
          count: Number(saveRows[0]?.count ?? 0),
        },
        productClicks: {
          tracked: true,
          count: productClickCount,
          uniqueClickers: productClicks?.uniqueUsers ?? 0,
        },
        conversions: {
          tracked: true,
          orders: conversionCount,
          revenueCents: Number(conversionRows[0]?.revenueCents ?? 0),
          rate: productClickCount > 0 ? conversionCount / productClickCount : null,
        },
        retention: validWatchSeconds.length > 0
          ? {
              tracked: true,
              sampleCount: validWatchSeconds.length,
              averageWatchTimeSeconds:
                validWatchSeconds.reduce((sum, seconds) => sum + seconds, 0) /
                validWatchSeconds.length,
            }
          : {
              tracked: false,
              sampleCount: 0,
              averageWatchTimeSeconds: null,
            },
      },
    });
  } catch (err) {
    req.log.error({ err, ownerId, postId: id }, "Failed to load post analytics");
    return res.status(500).json({ error: "Failed to load post analytics" });
  }
});

// ─── GET /api/posts/:id ──────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(404).json({ error: "Post not found" });

  const [post] = await db.select().from(posts)
    .where(and(eq(posts.id, id), visiblePostCondition()))
    .limit(1);
  if (!post) return res.status(404).json({ error: "Post not found" });
  const viewerId = optionalViewerId(req);
  if (viewerId && viewerId !== post.userId && await isBlockedEitherWay(viewerId, post.userId)) {
    return res.status(404).json({ error: "Post not found" });
  }

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

  const minPriceByProduct = await productMinPrices(tags.map((t) => t.productId));
  return res.json({
    ...post,
    seller:       sellerRows[0] ?? null,
    taggedProducts: tags.map((t) => ({ ...t, priceCents: minPriceByProduct[t.productId] ?? 0 })),
    likeCount:    post.visibility?.showLikeCount === false ? null : likeRows[0]?.count ?? 0,
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
    type: "like" | "repost" | "view" | "watch_time" | "shop_click" | "share";
    value?: string;
  };

  // "share" is a new interaction type added for Discover's seller-ranking
  // job (see jobs/computeSellerRanking.ts): it records a buyer sharing a
  // post out of the app (share sheet, copy link, etc.), which previously had
  // no tracking at all. Non-idempotent, like view/watch_time/shop_click —
  // one row is recorded per share tap.
  if (!["like", "repost", "view", "watch_time", "shop_click", "share"].includes(type)) {
    return res.status(400).json({ error: "type must be like, repost, view, watch_time, shop_click, or share" });
  }
  const [visiblePost] = await db.select({ id: posts.id, visibility: posts.visibility, ownerId: posts.userId }).from(posts)
    .where(and(eq(posts.id, id), visiblePostCondition()))
    .limit(1);
  if (!visiblePost) return res.status(404).json({ error: "Post not found" });
  if (type === "repost" && visiblePost.visibility?.allowReposts === false) {
    return res.status(403).json({ error: "Reposts are disabled for this post" });
  }

  if (type === "view" || type === "watch_time" || type === "shop_click" || type === "share") {
    await db.insert(interactions).values({ userId: clerkId, postId: id, type, value: value ?? null });
    return res.json({ action: "recorded" });
  }

  // Likes are idempotent: a retry or concurrent request must not create a
  // second effective like. The partial unique index is the serialization
  // boundary; ON CONFLICT handles the losing concurrent insert. Clients that
  // need to unlike send value="remove"; an omitted value always means "like".
  if (type === "like") {
    const removing = value === "remove";
    if (removing) {
      await db.delete(interactions).where(and(
        eq(interactions.userId, clerkId),
        eq(interactions.postId, id),
        eq(interactions.type, type),
      ));
    } else {
      await db
        .insert(interactions)
        .values({ userId: clerkId, postId: id, type, value: null })
        .onConflictDoNothing({
          target: [interactions.userId, interactions.postId],
          where: sql`type = 'like' AND post_id IS NOT NULL`,
        });
    }

    const [{ count: newCount }] = await db
      .select({ count: count() })
      .from(interactions)
      .where(and(eq(interactions.postId, id), eq(interactions.type, type)));

    if (!removing && visiblePost.ownerId && visiblePost.ownerId !== clerkId) {
      const [liker] = await db.select({
        name: sql<string>`COALESCE(${users.brandName}, ${users.displayName}, 'Someone')`,
      }).from(users).where(eq(users.clerkId, clerkId)).limit(1);
      // Likes are bursty and low-priority: collapse them into one notification
      // instead of pushing on every tap (see jobs/notificationBatchFlush.ts).
      void enqueueBatchedNotification({
        userId: visiblePost.ownerId,
        category: "social",
        type: "post_liked",
        targetId: id,
        targetType: "post",
        actorName: liker?.name ?? "Someone",
        cta: "View post",
      });
    }

    return res.json({ action: removing ? "removed" : "added", count: newCount });
  }

  // Reposts are explicit and idempotent. Omitted value means add; callers that
  // need to undo a repost send value="remove". The partial unique index is the
  // serialization boundary for retries and rapid concurrent taps.
  const removing = value === "remove";
  if (removing) {
    await db.delete(interactions).where(and(
      eq(interactions.userId, clerkId),
      eq(interactions.postId, id),
      eq(interactions.type, type),
    ));
  } else {
    await db
      .insert(interactions)
      .values({ userId: clerkId, postId: id, type, value: null })
      .onConflictDoNothing({
        target: [interactions.userId, interactions.postId],
        where: sql`type = 'repost' AND post_id IS NOT NULL`,
      });
  }

  const [{ count: newCount }] = await db
    .select({ count: count() })
    .from(interactions)
    .where(and(eq(interactions.postId, id), eq(interactions.type, type)));

  return res.json({ action: removing ? "removed" : "added", count: newCount });
});

export default router;
