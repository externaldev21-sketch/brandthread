/**
 * GET /api/feed/followed-fresh?limit=20&hours=72  (requireAuth)
 *
 * New posts from the brands (seller accounts) the viewer follows, for the top
 * of the Threads (For You) feed — the Instagram Home order: what's new from
 * accounts you follow first, suggested posts after.
 *
 * - Followed seller accounts only, Thread-surface posts created in the last
 *   `hours` (default 72, max 168).
 * - Same visibility and safety rules as GET /api/posts/feed: public,
 *   published (or due), moderation-visible, author in good standing, private
 *   accounts only when followed, no blocks either way, muted words hidden.
 * - Skips posts the viewer already watched (`video_watched` interactions,
 *   the store behind /api/posts/watched-videos) or marked Not interested.
 * - Newest first, at most 2 posts in a row from one brand.
 *
 * Response: the same array of post objects as /api/posts/feed, so the mobile
 * mapper (`mapApiPostToSellerThreadPost`) reads it unchanged.
 */
import { Router } from "express";
import {
  db, posts, users, follows, interactions, postTaggedProducts, products, productVariants, savedItems,
  feedNotInterested,
} from "@workspace/db";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { deriveSellerVerified } from "../lib/sellerEligibility";
import { publicPostCondition, visibleCommentCounts } from "../lib/postVisibility";
import { mutedPhrasesFor, notBlockedWith } from "../lib/safety";
import { matchesMutedWords } from "../lib/contentModerator";
import { locationsByPlaceId } from "../lib/places";
import { attachQuoteData } from "../lib/quotedPosts";
import { interleaveByAuthor, parseFollowedFreshQuery } from "../lib/followedFresh";
import { taggedProductVisibleTo } from "../lib/productVisibility";

const router = Router();

router.get("/followed-fresh", requireAuth, async (req, res) => {
  const viewerId = (req as any).clerkUserId as string;
  const { limit, hours } = parseFollowedFreshQuery(req.query as Record<string, unknown>);
  const now = new Date();
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);

  try {
    const followedIds = db
      .select({ followingId: follows.followingId })
      .from(follows)
      .where(eq(follows.followerId, viewerId));

    // Over-fetch so muted words and the one-brand run cap still fill the page.
    const candidates = await db
      .select({
        id: posts.id,
        userId: posts.userId,
        mediaUrl: posts.mediaUrl,
        thumbnailUrl: posts.thumbnailUrl,
        mediaUrls: posts.mediaUrls,
        mediaType: posts.mediaType,
        aspectRatio: posts.aspectRatio,
        surface: posts.surface,
        caption: posts.caption,
        hashtags: posts.hashtags,
        placeId: posts.placeId,
        styleTags: posts.styleTags,
        sound: posts.sound,
        visibility: posts.visibility,
        createdAt: posts.createdAt,
        displayName: users.displayName,
        brandName: users.brandName,
        verified: users.verified,
        verificationStatus: users.verificationStatus,
        activeStanding: users.activeStanding,
        policyRestricted: users.policyRestricted,
      })
      .from(posts)
      .innerJoin(users, and(
        eq(users.clerkId, posts.userId),
        eq(users.accountType, "seller"),
        inArray(posts.userId, followedIds),
      ))
      .where(and(
        publicPostCondition(now, viewerId),
        eq(posts.surface, "thread"),
        gte(posts.createdAt, since),
        notBlockedWith(viewerId, posts.userId),
        sql`NOT EXISTS (
          SELECT 1 FROM ${interactions}
          WHERE ${interactions.postId} = ${posts.id}
            AND ${interactions.userId} = ${viewerId}
            AND ${interactions.type} = 'video_watched'
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${feedNotInterested}
          WHERE ${feedNotInterested.postId} = ${posts.id}
            AND ${feedNotInterested.userId} = ${viewerId}
        )`,
      ))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit * 3);

    const muted = await mutedPhrasesFor(viewerId);
    const unmuted = muted.length === 0
      ? candidates
      : candidates.filter((row) => !matchesMutedWords([row.caption ?? "", ...(row.hashtags ?? [])].join(" "), muted));
    const rows = interleaveByAuthor(unmuted).slice(0, limit);
    if (rows.length === 0) return res.json([]);

    const postIds = rows.map((row) => row.id);
    const countBy = (type: string) => db
      .select({ postId: interactions.postId, cnt: count() })
      .from(interactions)
      .where(and(inArray(interactions.postId, postIds), eq(interactions.type, type)))
      .groupBy(interactions.postId);
    const [tagRows, likeRows, repostRows, shareRows, saveRows, commentsByPost, locations] = await Promise.all([
      db
        .select({
          postId: postTaggedProducts.postId,
          productId: postTaggedProducts.productId,
          position: postTaggedProducts.position,
          name: products.name,
          images: products.images,
        })
        .from(postTaggedProducts)
        .leftJoin(products, eq(products.id, postTaggedProducts.productId))
        // Same rule as /api/posts/feed: a deleted, draft or archived product is
        // not shown as a shoppable tag (unless it is the viewer's own).
        .where(and(inArray(postTaggedProducts.postId, postIds), taggedProductVisibleTo(viewerId)))
        .orderBy(postTaggedProducts.position),
      countBy("like"),
      countBy("repost"),
      countBy("share"),
      db
        .select({ postId: savedItems.targetId, cnt: count() })
        .from(savedItems)
        .where(and(inArray(savedItems.targetId, postIds), eq(savedItems.itemType, "post")))
        .groupBy(savedItems.targetId),
      visibleCommentCounts(postIds),
      locationsByPlaceId(rows.map((row) => row.placeId)),
    ]);

    const productIds = [...new Set(tagRows.map((tag) => tag.productId))];
    const priceRows = productIds.length === 0 ? [] : await db
      .select({ productId: productVariants.productId, minPriceCents: sql<number>`min(${productVariants.priceCents})` })
      .from(productVariants)
      .where(inArray(productVariants.productId, productIds))
      .groupBy(productVariants.productId);
    const minPrice = new Map(priceRows.map((row) => [row.productId, Number(row.minPriceCents)]));
    const tagsByPost = new Map<string, typeof tagRows>();
    for (const tag of tagRows) tagsByPost.set(tag.postId, [...(tagsByPost.get(tag.postId) ?? []), tag]);
    const toMap = (list: Array<{ postId: string | null; cnt: number }>) =>
      new Map(list.filter((row) => row.postId).map((row) => [row.postId as string, Number(row.cnt)]));
    const likes = toMap(likeRows);
    const reposts = toMap(repostRows);
    const shares = toMap(shareRows);
    const saves = toMap(saveRows);

    const result = rows.map((p) => ({
      id: p.id,
      userId: p.userId,
      mediaUrl: p.mediaUrl,
      thumbnailUrl: p.thumbnailUrl,
      mediaUrls: p.mediaUrls,
      mediaType: p.mediaType,
      aspectRatio: p.aspectRatio,
      surface: p.surface,
      caption: p.caption,
      location: p.placeId ? locations.get(p.placeId) ?? null : null,
      hashtags: p.hashtags,
      styleTags: p.styleTags,
      sound: p.sound,
      visibility: p.visibility,
      createdAt: p.createdAt,
      seller: {
        displayName: p.displayName,
        brandName: p.brandName,
        verified: deriveSellerVerified(p),
      },
      taggedProducts: (tagsByPost.get(p.id) ?? []).map((tag) => ({
        productId: tag.productId,
        position: tag.position,
        name: tag.name,
        images: tag.images,
        priceCents: minPrice.get(tag.productId) ?? 0,
      })),
      likesCount: p.visibility?.showLikeCount === false ? null : likes.get(p.id) ?? 0,
      repostsCount: reposts.get(p.id) ?? 0,
      sharesCount: shares.get(p.id) ?? 0,
      savesCount: saves.get(p.id) ?? 0,
      commentsCount: commentsByPost.get(p.id) ?? 0,
    }));

    return res.json(await attachQuoteData(result, viewerId));
  } catch (err) {
    req.log.error({ err, viewerId }, "Failed to fetch followed-fresh posts");
    return res.status(500).json({ error: "Failed to fetch posts" });
  }
});

export default router;
