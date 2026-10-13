/**
 * Fits (F6 items 80-82).
 *
 * Stitch (TikTok "Stitch with @user"): the stitch is a normal post made with
 * POST /api/posts using the author's own media; it is then linked here to the
 * original and the clip used.
 *   GET  /api/fits/stitch-source/:postId    — can I stitch this? + original preview (auth)
 *   POST /api/fits/stitches                 — link my new post to the original (auth)
 *   GET  /api/fits/stitches/:postId         — attribution for a stitch post (public)
 *
 * Buyer fit checks: a buyer links their own profile post to a product they
 * bought (verified against orders here, never trusted from the client).
 *   GET    /api/fits/purchased-products     — products I can link (auth, buyers)
 *   GET    /api/fits/fit-checks/:postId     — the product a post is linked to (public)
 *   PUT    /api/fits/fit-checks/:postId     — link { productId } (auth, owner)
 *   DELETE /api/fits/fit-checks/:postId     — unlink (auth, owner)
 *   GET    /api/products/:id/fit-checks     — product page strip (public; see productFitChecksRouter)
 *
 * Brand reposts with permission (Instagram collab-invite pattern):
 *   GET  /api/fits/repost-requests/status?postId= — my request state for a post (auth, brands)
 *   POST /api/fits/repost-requests          — { postId } ask the buyer (auth, brands)
 *   GET  /api/fits/repost-requests/:id      — request + post preview (owner or requester)
 *   POST /api/fits/repost-requests/:id/respond — { decision: approve|decline } (owner)
 *   POST /api/fits/repost-requests/:id/cancel  — (requester)
 * Approving creates the brand's normal repost (interactions.type = 'repost'),
 * which keeps crediting the buyer as the post's author.
 */
import { Router } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db, interactions, postFitChecks, postStitches, posts, products, repostRequests, users,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { publicPostCondition } from "../lib/postVisibility";
import { isBlockedEitherWay, notBlockedWith, optionalViewerId, profilesById } from "../lib/safety";
import { postCardImage } from "../lib/quotedPosts";
import { parsePagination, setPaginationHeaders } from "../lib/pagination";
import {
  accountTypes, brandRepostBlocked, isFitCheckPost, isMutualFollow, purchasedProductIds,
  REPOST_PERMISSION_REQUIRED,
} from "../lib/fits";
import { STITCH_LINK_WINDOW_MS, nextRepostRequestStatus, validateStitchClip, type RepostRequestStatus } from "../lib/fitsRules";
import { actorFieldsFromProfile, postThumbnail } from "../lib/activityEvents";
import { publishNotification } from "./notifications-feed";
import { logger } from "../lib/logger";

const router = Router();
export const productFitChecksRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const me = (req: any) => req.clerkUserId as string;

type PostRow = typeof posts.$inferSelect & {
  author: { displayName: string | null; brandName: string | null; username: string | null; accountType: string | null };
};

/**
 * A post the viewer may see: publicly visible (private accounts → followers),
 * no block either way, and a buyer's profile post only for mutual friends or
 * when it is a linked fit check (which the buyer chose to show on the product).
 */
async function loadVisiblePost(postId: string, viewerId: string | null): Promise<PostRow | null> {
  const [row] = await db.select({
    post: posts,
    displayName: users.displayName, brandName: users.brandName, username: users.username, accountType: users.accountType,
  }).from(posts)
    .innerJoin(users, eq(users.clerkId, posts.userId))
    .where(and(eq(posts.id, postId), publicPostCondition(new Date(), viewerId)))
    .limit(1);
  if (!row) return null;
  const post = row.post;
  if (viewerId && viewerId !== post.userId && await isBlockedEitherWay(viewerId, post.userId)) return null;
  if (row.accountType === "buyer" && post.surface === "profile" && viewerId !== post.userId) {
    const allowed = (viewerId && await isMutualFollow(viewerId, post.userId)) || await isFitCheckPost(post.id);
    if (!allowed) return null;
  }
  return {
    ...post,
    author: {
      displayName: row.displayName ?? null,
      brandName: row.accountType === "seller" ? row.brandName ?? null : null,
      username: row.username ?? null,
      accountType: row.accountType ?? null,
    },
  };
}

function postSummary(p: PostRow) {
  return {
    id: p.id,
    userId: p.userId,
    caption: p.caption ?? "",
    mediaType: p.mediaType,
    mediaUrl: p.mediaUrl,
    thumbnailUrl: postCardImage(p),
    author: p.author,
  };
}

async function notifyStitch(sourcePostId: string, stitcherId: string, stitchPostId: string): Promise<void> {
  try {
    const [source] = await db.select().from(posts).where(eq(posts.id, sourcePostId)).limit(1);
    if (!source || source.userId === stitcherId) return;
    const profile = (await profilesById([stitcherId])).get(stitcherId);
    if (!profile || profile.deleted || profile.suspended) return;
    const actor = actorFieldsFromProfile(profile);
    await publishNotification({
      userId: source.userId, category: "social", type: "stitch",
      title: `${actor.actorName} stitched your post`,
      ...actor, targetId: stitchPostId, targetType: "post", targetImageUrl: postThumbnail(source),
    });
  } catch (err) {
    logger.warn({ err, sourcePostId }, "Stitch notification failed");
  }
}

// ─── Stitch ──────────────────────────────────────────────────────────────────

/** Shared stitchability check: visible, reposts allowed, brand permission. */
async function stitchSourceFor(sourcePostId: string, viewerId: string) {
  const source = await loadVisiblePost(sourcePostId, viewerId);
  if (!source || source.postStatus === "deleted") {
    return { error: { status: 404, body: { error: "This post is no longer available to stitch.", code: "STITCH_SOURCE_UNAVAILABLE" } } } as const;
  }
  if (source.userId === viewerId) {
    return { error: { status: 400, body: { error: "You can't stitch your own post.", code: "STITCH_OWN_POST" } } } as const;
  }
  if (source.visibility?.allowReposts === false) {
    return { error: { status: 403, body: { error: "The author turned off reposts for this post.", code: "REPOSTS_DISABLED" } } } as const;
  }
  if (await brandRepostBlocked(viewerId, source.userId, source.id)) {
    return { error: { status: 403, body: REPOST_PERMISSION_REQUIRED } } as const;
  }
  return { source } as const;
}

router.get("/stitch-source/:postId", requireAuth, async (req, res) => {
  const { postId } = req.params;
  if (!isUuid(postId)) return res.status(404).json({ error: "Post not found", code: "STITCH_SOURCE_UNAVAILABLE" });
  const result = await stitchSourceFor(postId, me(req));
  if ("error" in result && result.error) return res.status(result.error.status).json(result.error.body);
  return res.json({ source: postSummary(result.source!) });
});

router.post("/stitches", requireAuth, rateLimit("post-interact"), async (req, res) => {
  const userId = me(req);
  const { postId, sourcePostId, clipStartMs, clipEndMs } = (req.body ?? {}) as Record<string, unknown>;
  if (!isUuid(postId) || !isUuid(sourcePostId)) {
    return res.status(400).json({ error: "postId and sourcePostId must be post ids", code: "VALIDATION_ERROR" });
  }
  if (postId === sourcePostId) return res.status(400).json({ error: "A post can't stitch itself", code: "VALIDATION_ERROR" });
  const clip = validateStitchClip(clipStartMs, clipEndMs);
  if (!clip.ok) return res.status(400).json({ error: clip.error, code: "INVALID_CLIP" });

  const [own] = await db.select({ id: posts.id, userId: posts.userId, createdAt: posts.createdAt, postStatus: posts.postStatus })
    .from(posts).where(eq(posts.id, postId)).limit(1);
  if (!own || own.userId !== userId || own.postStatus === "deleted") {
    return res.status(404).json({ error: "Post not found" });
  }
  if (Date.now() - new Date(own.createdAt).getTime() > STITCH_LINK_WINDOW_MS) {
    return res.status(409).json({ error: "A stitch is linked when it is posted.", code: "STITCH_WINDOW_CLOSED" });
  }
  const result = await stitchSourceFor(sourcePostId, userId);
  if ("error" in result && result.error) return res.status(result.error.status).json(result.error.body);
  const source = result.source!;

  const inserted = await db.insert(postStitches).values({
    postId, sourcePostId, sourceAuthorId: source.userId, clipStartMs: clip.startMs, clipEndMs: clip.endMs,
  }).onConflictDoNothing().returning();
  if (inserted.length === 0) return res.status(409).json({ error: "This post is already a stitch.", code: "ALREADY_STITCHED" });

  // A stitch counts as a repost of the original (like a quote does).
  await db.insert(interactions)
    .values({ userId, postId: source.id, type: "repost", value: "stitch" })
    .onConflictDoNothing({ target: [interactions.userId, interactions.postId], where: sql`type = 'repost' AND post_id IS NOT NULL` })
    .catch((err) => req.log?.warn({ err }, "Could not record stitch repost interaction"));
  void notifyStitch(source.id, userId, postId);
  return res.status(201).json({
    stitch: { postId, sourcePostId, clipStartMs: clip.startMs, clipEndMs: clip.endMs, source: postSummary(source) },
  });
});

router.get("/stitches/:postId", async (req, res) => {
  const { postId } = req.params;
  if (!isUuid(postId)) return res.status(404).json({ error: "Not a stitch" });
  const viewerId = optionalViewerId(req);
  const stitchPost = await loadVisiblePost(postId, viewerId);
  if (!stitchPost) return res.status(404).json({ error: "Not a stitch" });
  const [link] = await db.select().from(postStitches).where(eq(postStitches.postId, postId)).limit(1);
  if (!link) return res.status(404).json({ error: "Not a stitch" });
  const source = link.sourcePostId ? await loadVisiblePost(link.sourcePostId, viewerId) : null;
  // Attribution name survives even when the original is gone or hidden.
  const [author] = await db.select({ displayName: users.displayName, brandName: users.brandName, username: users.username, accountType: users.accountType })
    .from(users).where(eq(users.clerkId, link.sourceAuthorId)).limit(1);
  const blocked = viewerId ? await isBlockedEitherWay(viewerId, link.sourceAuthorId) : false;
  return res.json({
    stitch: {
      postId,
      clipStartMs: link.clipStartMs,
      clipEndMs: link.clipEndMs,
      sourceAuthor: blocked || !author ? null : {
        displayName: author.displayName ?? null,
        brandName: author.accountType === "seller" ? author.brandName ?? null : null,
        username: author.username ?? null,
      },
      source: source ? postSummary(source) : { unavailable: true },
    },
  });
});

// ─── Buyer fit checks ────────────────────────────────────────────────────────

function productCard(p: { id: string; name: string; images: unknown; brandName?: string | null; displayName?: string | null }) {
  const images = Array.isArray(p.images) ? p.images.filter((v): v is string => typeof v === "string") : [];
  return { id: p.id, name: p.name, imageUrl: images[0] ?? null, brandName: p.brandName ?? p.displayName ?? null };
}

router.get("/purchased-products", requireAuth, async (req, res) => {
  const userId = me(req);
  const ids = [...await purchasedProductIds(userId)];
  if (ids.length === 0) return res.json({ products: [] });
  const rows = await db.select({
    id: products.id, name: products.name, images: products.images,
    brandName: users.brandName, displayName: users.displayName,
  }).from(products)
    .leftJoin(users, eq(users.clerkId, products.ownerId))
    .where(inArray(products.id, ids))
    .orderBy(products.name);
  return res.json({ products: rows.map(productCard) });
});

router.get("/fit-checks/:postId", async (req, res) => {
  const { postId } = req.params;
  if (!isUuid(postId)) return res.status(404).json({ error: "Not a fit check" });
  const post = await loadVisiblePost(postId, optionalViewerId(req));
  if (!post) return res.status(404).json({ error: "Not a fit check" });
  const [row] = await db.select({
    productId: postFitChecks.productId, name: products.name, images: products.images,
    brandName: users.brandName, displayName: users.displayName,
  }).from(postFitChecks)
    .innerJoin(products, eq(products.id, postFitChecks.productId))
    .leftJoin(users, eq(users.clerkId, products.ownerId))
    .where(eq(postFitChecks.postId, postId)).limit(1);
  if (!row) return res.status(404).json({ error: "Not a fit check" });
  return res.json({ fitCheck: { postId, product: productCard({ ...row, id: row.productId }) } });
});

router.put("/fit-checks/:postId", requireAuth, async (req, res) => {
  const userId = me(req);
  const { postId } = req.params;
  const { productId } = (req.body ?? {}) as { productId?: unknown };
  if (!isUuid(postId) || !isUuid(productId)) {
    return res.status(400).json({ error: "postId and productId must be ids", code: "VALIDATION_ERROR" });
  }
  const [post] = await db.select({ userId: posts.userId, surface: posts.surface, postStatus: posts.postStatus })
    .from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post || post.userId !== userId || post.postStatus === "deleted") return res.status(404).json({ error: "Post not found" });
  const types = await accountTypes([userId]);
  if (types.get(userId) !== "buyer") {
    return res.status(403).json({ error: "Fit checks are for buyer posts.", code: "BUYERS_ONLY" });
  }
  if (post.surface !== "profile") return res.status(400).json({ error: "Only profile posts can be fit checks.", code: "VALIDATION_ERROR" });
  const [product] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
  if (!product) return res.status(404).json({ error: "Product not found" });
  if (!(await purchasedProductIds(userId, [productId])).has(productId)) {
    return res.status(403).json({ error: "You can link a fit check to something you bought.", code: "NOT_PURCHASED" });
  }
  await db.insert(postFitChecks).values({ postId, productId, buyerId: userId })
    .onConflictDoUpdate({ target: postFitChecks.postId, set: { productId, createdAt: new Date() } });
  return res.json({ fitCheck: { postId, productId } });
});

router.delete("/fit-checks/:postId", requireAuth, async (req, res) => {
  const userId = me(req);
  const { postId } = req.params;
  if (!isUuid(postId)) return res.status(404).json({ error: "Not a fit check" });
  const removed = await db.delete(postFitChecks)
    .where(and(eq(postFitChecks.postId, postId), eq(postFitChecks.buyerId, userId)))
    .returning({ postId: postFitChecks.postId });
  if (removed.length === 0) return res.status(404).json({ error: "Not a fit check" });
  return res.json({ ok: true });
});

productFitChecksRouter.get("/:id/fit-checks", async (req, res) => {
  const { id } = req.params;
  if (!isUuid(id)) return res.status(404).json({ error: "Product not found" });
  const page = parsePagination(req.query, { limit: 12 });
  if (!page.success || page.data.limit > 50) return res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" });
  const { limit, offset } = page.data;
  const viewerId = optionalViewerId(req);
  const rows = await db.select({
    postId: posts.id, userId: posts.userId, caption: posts.caption, mediaType: posts.mediaType,
    mediaUrl: posts.mediaUrl, thumbnailUrl: posts.thumbnailUrl, createdAt: postFitChecks.createdAt,
    displayName: users.displayName, username: users.username,
  }).from(postFitChecks)
    .innerJoin(posts, eq(posts.id, postFitChecks.postId))
    .innerJoin(users, eq(users.clerkId, posts.userId))
    .where(and(
      eq(postFitChecks.productId, id),
      eq(posts.userId, postFitChecks.buyerId),
      eq(posts.postStatus, "published"),
      publicPostCondition(new Date(), viewerId),
      notBlockedWith(viewerId, posts.userId),
    ))
    .orderBy(desc(postFitChecks.createdAt), posts.id)
    .limit(limit).offset(offset);
  setPaginationHeaders(res, page.data, rows.length);
  return res.json({
    fitChecks: rows.map((r) => ({
      postId: r.postId,
      userId: r.userId,
      caption: r.caption ?? "",
      mediaType: r.mediaType,
      thumbnailUrl: postCardImage(r),
      createdAt: r.createdAt,
      author: { displayName: r.displayName ?? null, username: r.username ?? null },
    })),
  });
});

// ─── Brand repost requests ───────────────────────────────────────────────────

router.get("/repost-requests/status", requireAuth, async (req, res) => {
  const postId = req.query.postId;
  if (!isUuid(postId)) return res.status(400).json({ error: "postId is required", code: "VALIDATION_ERROR" });
  const [row] = await db.select({ id: repostRequests.id, status: repostRequests.status }).from(repostRequests)
    .where(and(eq(repostRequests.postId, postId), eq(repostRequests.requesterSellerId, me(req))))
    .orderBy(desc(repostRequests.createdAt)).limit(1);
  return res.json({ request: row ?? null });
});

/**
 * Whether the caller (a brand) may ask to repost this post — the ••• menu
 * shows "Request to repost" only when `eligible`. Same checks as the POST
 * below: caller is a seller, post is published and visible to them (blocks,
 * private accounts, friends-only buyer posts), and its author is a buyer.
 */
router.get("/posts/:postId/repost-eligibility", requireAuth, async (req, res) => {
  const userId = me(req);
  const { postId } = req.params;
  if (!isUuid(postId)) return res.status(404).json({ error: "Post not found" });
  const types = await accountTypes([userId]);
  const post = types.get(userId) === "seller" ? await loadVisiblePost(postId, userId) : null;
  const eligible = !!post && post.postStatus === "published" && post.userId !== userId && post.author.accountType === "buyer";
  if (!eligible) return res.json({ eligible: false, request: null });
  const [row] = await db.select({ id: repostRequests.id, status: repostRequests.status }).from(repostRequests)
    .where(and(eq(repostRequests.postId, postId), eq(repostRequests.requesterSellerId, userId)))
    .orderBy(desc(repostRequests.createdAt)).limit(1);
  return res.json({ eligible: true, request: row ?? null });
});

router.post("/repost-requests", requireAuth, rateLimit("post-interact"), async (req, res) => {
  const userId = me(req);
  const { postId } = (req.body ?? {}) as { postId?: unknown };
  if (!isUuid(postId)) return res.status(400).json({ error: "postId must be a post id", code: "VALIDATION_ERROR" });
  const types = await accountTypes([userId]);
  if (types.get(userId) !== "seller") return res.status(403).json({ error: "Only brands can request to repost.", code: "SELLERS_ONLY" });
  const post = await loadVisiblePost(postId, userId);
  if (!post || post.postStatus !== "published") return res.status(404).json({ error: "Post not found" });
  if (post.userId === userId) return res.status(400).json({ error: "This is your own post.", code: "OWN_POST" });
  if (post.author.accountType !== "buyer") {
    return res.status(400).json({ error: "Repost requests are for buyer posts.", code: "NOT_A_BUYER_POST" });
  }
  const [latest] = await db.select().from(repostRequests)
    .where(and(eq(repostRequests.postId, postId), eq(repostRequests.requesterSellerId, userId)))
    .orderBy(desc(repostRequests.createdAt)).limit(1);
  if (latest?.status === "pending") return res.json({ request: latest });
  if (latest?.status === "approved") return res.status(409).json({ error: "Already approved.", code: "ALREADY_APPROVED", request: latest });
  if (latest?.status === "declined") return res.status(409).json({ error: "They declined this request.", code: "REQUEST_DECLINED", request: latest });

  const [created] = await db.insert(repostRequests).values({ postId, requesterSellerId: userId, ownerUserId: post.userId })
    .onConflictDoNothing().returning();
  if (!created) {
    const [pending] = await db.select().from(repostRequests).where(and(
      eq(repostRequests.postId, postId), eq(repostRequests.requesterSellerId, userId), eq(repostRequests.status, "pending"),
    )).limit(1);
    return res.json({ request: pending ?? null });
  }
  try {
    const profile = (await profilesById([userId])).get(userId);
    if (profile && !profile.deleted && !profile.suspended) {
      const actor = actorFieldsFromProfile(profile);
      await publishNotification({
        userId: post.userId, category: "social", type: "repost_request",
        title: `${actor.actorName} wants to repost your post`,
        ...actor, targetId: created.id, targetType: "repost_request", cta: "Review",
        targetImageUrl: postThumbnail(post),
      });
    }
  } catch (err) {
    req.log?.warn({ err, requestId: created.id }, "Repost request notification failed");
  }
  return res.status(201).json({ request: created });
});

async function loadRequest(id: string) {
  const [row] = await db.select().from(repostRequests).where(eq(repostRequests.id, id)).limit(1);
  return row ?? null;
}

router.get("/repost-requests/:id", requireAuth, async (req, res) => {
  const userId = me(req);
  const { id } = req.params;
  if (!isUuid(id)) return res.status(404).json({ error: "Request not found" });
  const request = await loadRequest(id);
  if (!request || (request.ownerUserId !== userId && request.requesterSellerId !== userId)) {
    return res.status(404).json({ error: "Request not found" });
  }
  if (await isBlockedEitherWay(request.ownerUserId, request.requesterSellerId)) {
    return res.status(404).json({ error: "Request not found" });
  }
  const [postRow] = await db.select().from(posts).where(eq(posts.id, request.postId)).limit(1);
  const brand = (await profilesById([request.requesterSellerId])).get(request.requesterSellerId);
  return res.json({
    request: {
      id: request.id, postId: request.postId, status: request.status,
      createdAt: request.createdAt, respondedAt: request.respondedAt,
      brand: brand ? { userId: brand.userId, name: brand.name, handle: brand.handle, avatarUrl: brand.avatarUrl } : null,
      post: postRow && postRow.postStatus !== "deleted" ? {
        id: postRow.id, caption: postRow.caption ?? "", mediaType: postRow.mediaType,
        mediaUrl: postRow.mediaUrl, thumbnailUrl: postCardImage(postRow),
      } : null,
    },
  });
});

async function transition(req: any, res: any, action: "approve" | "decline" | "cancel") {
  const userId = me(req);
  const { id } = req.params;
  if (!isUuid(id)) return res.status(404).json({ error: "Request not found" });
  const request = await loadRequest(id);
  if (!request || (request.ownerUserId !== userId && request.requesterSellerId !== userId)) {
    return res.status(404).json({ error: "Request not found" });
  }
  const actor = request.ownerUserId === userId ? "owner" : "requester";
  const next = nextRepostRequestStatus(request.status as RepostRequestStatus, action, actor);
  if (!next.ok) {
    return next.code === "NOT_PENDING"
      ? res.status(409).json({ error: "This request was already answered.", code: "NOT_PENDING", status: request.status })
      : res.status(403).json({ error: "Not allowed", code: "FORBIDDEN" });
  }
  if (action === "approve" && await isBlockedEitherWay(request.ownerUserId, request.requesterSellerId)) {
    return res.status(404).json({ error: "Request not found" });
  }
  // Conditional update: a concurrent second answer finds nothing pending.
  const [updated] = await db.update(repostRequests)
    .set({ status: next.status, respondedAt: new Date() })
    .where(and(eq(repostRequests.id, id), eq(repostRequests.status, "pending")))
    .returning();
  if (!updated) return res.status(409).json({ error: "This request was already answered.", code: "NOT_PENDING" });

  if (next.status === "approved") {
    // The brand's repost — the same row a repost tap writes — crediting the buyer.
    const inserted = await db.insert(interactions)
      .values({ userId: request.requesterSellerId, postId: request.postId, type: "repost", value: "approved_request" })
      .onConflictDoNothing({ target: [interactions.userId, interactions.postId], where: sql`type = 'repost' AND post_id IS NOT NULL` })
      .returning({ id: interactions.id });
    try {
      const profile = (await profilesById([userId])).get(userId);
      const [postRow] = await db.select().from(posts).where(eq(posts.id, request.postId)).limit(1);
      if (profile && postRow) {
        await publishNotification({
          userId: request.requesterSellerId, category: "social", type: "repost_request_approved",
          title: `${profile.name} approved your repost request`,
          ...actorFieldsFromProfile(profile), targetId: request.postId, targetType: "post",
          targetImageUrl: postThumbnail(postRow),
        });
      }
    } catch (err) {
      req.log?.warn({ err, requestId: id }, "Repost approval notification failed");
    }
    if (inserted.length === 0) logger.info({ requestId: id }, "Brand had already reposted");
  }
  return res.json({ request: updated });
}

router.post("/repost-requests/:id/respond", requireAuth, async (req, res) => {
  const decision = (req.body ?? {}).decision;
  if (decision !== "approve" && decision !== "decline") {
    return res.status(400).json({ error: "decision must be approve or decline", code: "VALIDATION_ERROR" });
  }
  return transition(req, res, decision);
});

router.post("/repost-requests/:id/cancel", requireAuth, async (req, res) => transition(req, res, "cancel"));

export default router;
