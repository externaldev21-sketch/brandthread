/**
 * Profile media — the video grid behind every buyer and seller profile, and
 * the "featured in" videos behind a product detail page.
 *
 * Mounted under /api/public (no requireAuth — a signed-out visitor can browse a
 * seller's videos). A signed-in viewer is still resolved so block, mute, and
 * friends-only rules apply exactly as they do everywhere else.
 *
 * GET /api/public/users/:userId/videos?limit=30&offset=0
 *   Every post the user published to the feed, newest first, in the same row
 *   shape as GET /api/public/posts (so the full-screen feed player renders it
 *   unchanged) plus `viewsCount`, `authorAccountType`, and tagged-product
 *   `priceCents`. `:userId` accepts the Clerk ID or the users.id UUID alias.
 *   - Seller: public published posts (same rule as the public Thread feed).
 *   - Buyer: friends-only, exactly like GET /api/social/profile/:id/posts —
 *     a non-friend gets `{ restricted: "friends_only", videos: [] }`.
 *   - The owner viewing themself also sees their own non-public posts.
 *
 * GET /api/public/products/:productId/videos?limit=12
 *   Public posts that tag the product, newest first — the "Featured in" strip
 *   on product detail links into these.
 */
import { Router, type Request } from "express";
import { and, asc, count, desc, eq, inArray, lte, ne, or, sql } from "drizzle-orm";
import {
  db, follows, interactions, postTaggedProducts, posts, products, productVariants, users,
} from "@workspace/db";
import { resolveToClerkId } from "./public";
import { publicPostCondition, visibleCommentCounts } from "../lib/postVisibility";
import {
  authorInGoodStanding,
  isBlockedEitherWay,
  mutedPhrasesFor,
  notBlockedWith,
  optionalViewerId,
} from "../lib/safety";
import { matchesMutedWords } from "../lib/contentModerator";
import { deriveSellerVerified } from "../lib/sellerEligibility";
import { parsePagination } from "../lib/pagination";

const router = Router();

export const PROFILE_VIDEOS_MAX_LIMIT = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const videoRowSelection = {
  id:           posts.id,
  userId:       posts.userId,
  mediaUrl:     posts.mediaUrl,
  thumbnailUrl: posts.thumbnailUrl,
  mediaUrls:    posts.mediaUrls,
  mediaType:    posts.mediaType,
  aspectRatio:  posts.aspectRatio,
  caption:      posts.caption,
  hashtags:     posts.hashtags,
  styleTags:    posts.styleTags,
  sound:        posts.sound,
  visibility:   posts.visibility,
  createdAt:    posts.createdAt,
  accountType:  users.accountType,
  displayName:  users.displayName,
  brandName:    users.brandName,
  name:         users.name,
  username:     users.username,
  verified:     users.verified,
  verificationStatus: users.verificationStatus,
  activeStanding: users.activeStanding,
  policyRestricted: users.policyRestricted,
};

type VideoRow = {
  id: string;
  userId: string;
  mediaUrl: string;
  thumbnailUrl: string | null;
  mediaUrls: string[];
  mediaType: string;
  aspectRatio: string;
  caption: string | null;
  hashtags: string[];
  styleTags: string[];
  sound: unknown;
  visibility: { isPublic?: boolean; allowComments: boolean; allowReposts: boolean; showLikeCount: boolean } | null;
  createdAt: Date;
  accountType: string | null;
  displayName: string | null;
  brandName: string | null;
  name: string | null;
  username: string | null;
  verified: boolean | null;
  verificationStatus: string | null;
  activeStanding: boolean | null;
  policyRestricted: boolean | null;
};

/** Lowest variant price per product — the price a tagged product displays. */
async function minVariantPrices(productIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ productId: productVariants.productId, minPriceCents: sql<number>`min(${productVariants.priceCents})` })
    .from(productVariants)
    .where(inArray(productVariants.productId, ids))
    .groupBy(productVariants.productId);
  return new Map(rows.map((row) => [row.productId, Number(row.minPriceCents)]));
}

/**
 * Attach tagged products, engagement counts and view counts to a page of
 * posts, returning the public Thread row shape the mobile feed player reads.
 */
export async function hydrateVideoRows(rows: VideoRow[], viewerId: string | null, isOwnerView = false) {
  if (rows.length === 0) return [];
  const postIds = rows.map((row) => row.id);
  const [tagRows, likeRows, repostRows, viewRows, commentCounts, myReposts] = await Promise.all([
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
    db.select({ postId: interactions.postId, n: count() }).from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "like")))
      .groupBy(interactions.postId),
    db.select({ postId: interactions.postId, n: count() }).from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "repost")))
      .groupBy(interactions.postId),
    db.select({ postId: interactions.postId, n: count() }).from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, "view")))
      .groupBy(interactions.postId),
    visibleCommentCounts(postIds),
    viewerId
      ? db.select({ postId: interactions.postId }).from(interactions)
          .where(and(
            inArray(interactions.postId, postIds),
            eq(interactions.userId, viewerId),
            eq(interactions.type, "repost"),
          ))
      : Promise.resolve([] as Array<{ postId: string | null }>),
  ]);

  const prices = await minVariantPrices(tagRows.map((tag) => tag.productId));
  const byPost = <T extends { postId: string | null; n: number }>(list: T[]) =>
    new Map(list.filter((row) => row.postId).map((row) => [row.postId as string, Number(row.n)]));
  const likes = byPost(likeRows);
  const reposts = byPost(repostRows);
  const views = byPost(viewRows);
  const repostedByMe = new Set(myReposts.map((row) => row.postId).filter(Boolean) as string[]);
  const tagsByPost = new Map<string, typeof tagRows>();
  for (const tag of tagRows) {
    if (!tagsByPost.has(tag.postId)) tagsByPost.set(tag.postId, []);
    tagsByPost.get(tag.postId)!.push(tag);
  }

  return rows.map((row) => ({
    id:           row.id,
    userId:       row.userId,
    mediaUrl:     row.mediaUrl,
    thumbnailUrl: row.thumbnailUrl,
    mediaUrls:    row.mediaUrls,
    mediaType:    row.mediaType,
    aspectRatio:  row.aspectRatio,
    caption:      row.caption,
    hashtags:     row.hashtags,
    styleTags:    row.styleTags,
    sound:        row.sound,
    visibility:   row.visibility,
    createdAt:    row.createdAt,
    authorAccountType: row.accountType === "seller" ? "seller" : "buyer",
    seller: {
      // Same field names as GET /api/public/posts so one client mapper reads both.
      displayName: row.displayName ?? row.name,
      brandName:   row.accountType === "seller" ? row.brandName : null,
      username:    row.username,
      verified:    row.accountType === "seller" ? deriveSellerVerified(row as any) : false,
    },
    taggedProducts: (tagsByPost.get(row.id) ?? []).map((tag) => ({
      productId:  tag.productId,
      position:   tag.position,
      name:       tag.name,
      images:     tag.images,
      priceCents: prices.get(tag.productId) ?? 0,
    })),
    likesCount:    !isOwnerView && row.visibility?.showLikeCount === false ? null : likes.get(row.id) ?? 0,
    repostsCount:  reposts.get(row.id) ?? 0,
    commentsCount: commentCounts.get(row.id) ?? 0,
    viewsCount:    views.get(row.id) ?? 0,
    repostedByMe:  repostedByMe.has(row.id),
  }));
}

async function isMutualFollow(a: string, b: string): Promise<boolean> {
  const rows = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(or(
      and(eq(follows.followerId, a), eq(follows.followingId, b)),
      and(eq(follows.followerId, b), eq(follows.followingId, a)),
    ));
  return rows.some((row) => row.followerId === a) && rows.some((row) => row.followerId === b);
}

/** Owner view: their own published (or due-scheduled) posts, public or not, unless a moderator removed them. */
function ownPostsCondition(now = new Date()) {
  return and(
    or(
      eq(posts.postStatus, "published"),
      and(eq(posts.postStatus, "scheduled"), lte(posts.scheduledAt, now)),
    ),
    ne(posts.moderationStatus, "removed"),
  );
}

/** Buyer posts other people can read — same rule as GET /api/social/profile/:id/posts. */
function buyerFriendPostsCondition() {
  return and(
    sql`${posts.postStatus} NOT IN ('deleted', 'archived', 'draft')`,
    eq(posts.moderationStatus, "visible"),
    authorInGoodStanding(posts.userId),
  );
}

function filterMuted<T extends { caption: string | null; hashtags: string[] }>(rows: T[], muted: string[]): T[] {
  if (muted.length === 0) return rows;
  return rows.filter((row) => !matchesMutedWords([row.caption ?? "", ...(row.hashtags ?? [])].join(" "), muted));
}

function viewerFrom(req: Request): string | null {
  return optionalViewerId(req);
}

// ─── GET /api/public/users/:userId/videos ─────────────────────────────────────
router.get("/users/:userId/videos", async (req, res) => {
  try {
    const page = parsePagination(req.query, { limit: 30 });
    if (!page.success || page.data.limit > PROFILE_VIDEOS_MAX_LIMIT) {
      return res.status(400).json({ error: "Invalid videos query", code: "VALIDATION_ERROR" });
    }
    const { limit, offset } = page.data;

    const clerkId = await resolveToClerkId(String(req.params.userId ?? ""));
    if (!clerkId) return res.status(404).json({ error: "Profile not found" });

    const [owner] = await db
      .select({
        clerkId:     users.clerkId,
        accountType: users.accountType,
        displayName: users.displayName,
        brandName:   users.brandName,
        name:        users.name,
        username:    users.username,
        suspendedAt: users.suspendedAt,
      })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);
    if (!owner || owner.suspendedAt) return res.status(404).json({ error: "Profile not found" });

    const viewerId = viewerFrom(req);
    const isSelf = viewerId === clerkId;
    if (viewerId && !isSelf && await isBlockedEitherWay(viewerId, clerkId)) {
      return res.status(404).json({ error: "Profile not found" });
    }

    const isSeller = owner.accountType === "seller";
    const user = {
      userId:      clerkId,
      accountType: isSeller ? "seller" : "buyer",
      displayName: (isSeller ? owner.brandName : null) ?? owner.displayName ?? owner.name ?? null,
      username:    owner.username ?? null,
    };

    if (!isSeller && !isSelf && !(viewerId && await isMutualFollow(viewerId, clerkId))) {
      return res.json({ user, restricted: "friends_only", total: 0, hasMore: false, videos: [] });
    }

    const where = and(
      eq(posts.userId, clerkId),
      isSelf ? ownPostsCondition() : isSeller ? publicPostCondition() : buyerFriendPostsCondition(),
    );

    const [[{ total }], pageRows] = await Promise.all([
      db.select({ total: count() }).from(posts).where(where),
      db
        .select(videoRowSelection)
        .from(posts)
        .innerJoin(users, eq(users.clerkId, posts.userId))
        .where(where)
        .orderBy(desc(posts.createdAt), asc(posts.id))
        .limit(limit)
        .offset(offset),
    ]);

    const rows = isSelf ? pageRows : filterMuted(pageRows as VideoRow[], await mutedPhrasesFor(viewerId));
    const videos = await hydrateVideoRows(rows as VideoRow[], viewerId, isSelf);
    const totalCount = Number(total);
    return res.json({
      user,
      restricted: null,
      total: totalCount,
      hasMore: offset + pageRows.length < totalCount,
      videos,
    });
  } catch (err) {
    req.log.error({ err, userId: req.params.userId }, "Failed to load profile videos");
    return res.status(500).json({ error: "Failed to load videos" });
  }
});

// ─── GET /api/public/products/:productId/videos ───────────────────────────────
router.get("/products/:productId/videos", async (req, res) => {
  try {
    const productId = String(req.params.productId ?? "");
    if (!UUID_RE.test(productId)) return res.status(404).json({ error: "Product not found" });
    const page = parsePagination(req.query, { limit: 12 });
    if (!page.success || page.data.limit > PROFILE_VIDEOS_MAX_LIMIT) {
      return res.status(400).json({ error: "Invalid videos query", code: "VALIDATION_ERROR" });
    }
    const viewerId = viewerFrom(req);

    const tagged = db
      .select({ postId: postTaggedProducts.postId })
      .from(postTaggedProducts)
      .where(eq(postTaggedProducts.productId, productId));

    const where = and(
      inArray(posts.id, tagged),
      eq(users.accountType, "seller"),
      publicPostCondition(),
      notBlockedWith(viewerId, posts.userId),
    );
    const [[{ total }], pageRows] = await Promise.all([
      db.select({ total: count() }).from(posts).innerJoin(users, eq(users.clerkId, posts.userId)).where(where),
      db
        .select(videoRowSelection)
        .from(posts)
        .innerJoin(users, eq(users.clerkId, posts.userId))
        .where(where)
        .orderBy(desc(posts.createdAt), asc(posts.id))
        .limit(page.data.limit)
        .offset(page.data.offset),
    ]);

    const rows = filterMuted(pageRows as VideoRow[], await mutedPhrasesFor(viewerId));
    const videos = await hydrateVideoRows(rows, viewerId);
    const totalCount = Number(total);
    return res.json({ total: totalCount, hasMore: page.data.offset + pageRows.length < totalCount, videos });
  } catch (err) {
    req.log.error({ err, productId: req.params.productId }, "Failed to load product videos");
    return res.status(500).json({ error: "Failed to load videos" });
  }
});

export default router;
