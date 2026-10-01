/**
 * Write-side helpers that turn product actions (likes, saves, comments, hides,
 * purchases) into taste-profile updates. All are fire-and-forget safe: they
 * never throw, so a ranking failure cannot fail the user's action.
 */
import {
  db, posts, feedNotInterested, forYouFeedCache, interactions, postTaggedProducts, productVariants,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { logger } from "../logger";
import { applyEventToProfile } from "./forYou";

/** Applies `type` for `userId` using the post's own tags/seller. No-op if the post is gone. */
export async function recordPostSignal(
  userId: string,
  postId: string,
  type: string,
  value?: string | null,
): Promise<void> {
  try {
    const [post] = await db
      .select({ userId: posts.userId, styleTags: posts.styleTags })
      .from(posts)
      .where(eq(posts.id, postId))
      .limit(1);
    if (!post) return;
    await applyEventToProfile(userId, {
      type,
      value,
      styleTags: Array.isArray(post.styleTags) ? (post.styleTags as string[]) : [],
      sellerId: post.userId,
    });
  } catch (err) {
    logger.warn({ err, userId, postId, type }, "Ranking signal failed");
  }
}

/**
 * Persists a "Not interested" hide. Returns true when a NEW row was written
 * (callers apply the negative taste signal only then, so retries don't stack).
 * Drops the cached For You list so the post disappears on the next fetch.
 */
export async function hidePostFromForYou(
  userId: string,
  post: { id: string; sellerId: string | null },
): Promise<boolean> {
  const inserted = await db
    .insert(feedNotInterested)
    .values({ userId, postId: post.id, sellerId: post.sellerId })
    .onConflictDoNothing()
    .returning({ postId: feedNotInterested.postId });
  if (inserted.length > 0) {
    await db.delete(forYouFeedCache).where(eq(forYouFeedCache.userId, userId)).catch((err) => {
      logger.warn({ err, userId }, "For You cache invalidation failed");
    });
  }
  return inserted.length > 0;
}

/** Removes a hide. Returns true if a row existed. */
export async function unhidePostFromForYou(userId: string, postId: string): Promise<boolean> {
  const removed = await db
    .delete(feedNotInterested)
    .where(and(eq(feedNotInterested.userId, userId), eq(feedNotInterested.postId, postId)))
    .returning({ postId: feedNotInterested.postId });
  // The event row would otherwise keep the post in the "recently seen" exclusion window.
  await db.delete(interactions).where(and(
    eq(interactions.userId, userId),
    eq(interactions.postId, postId),
    eq(interactions.type, "not_interested"),
  ));
  if (removed.length > 0) {
    await db.delete(forYouFeedCache).where(eq(forYouFeedCache.userId, userId)).catch(() => undefined);
  }
  return removed.length > 0;
}

/**
 * A completed purchase: boosts the seller and the style tags of recent posts
 * that tag the purchased products (the content that likely led to the buy).
 */
export async function recordPurchaseSignals(input: {
  buyerId: string | null | undefined;
  sellerId: string | null | undefined;
  variantIds: string[];
}): Promise<void> {
  if (!input.buyerId) return;
  try {
    const variantIds = [...new Set(input.variantIds.filter(Boolean))];
    const productRows = variantIds.length === 0 ? [] : await db
      .select({ productId: productVariants.productId })
      .from(productVariants)
      .where(inArray(productVariants.id, variantIds));
    const productIds = [...new Set(productRows.map((r) => r.productId))];
    const tagged = productIds.length === 0 ? [] : await db
      .select({ styleTags: posts.styleTags, sellerId: posts.userId })
      .from(postTaggedProducts)
      .innerJoin(posts, eq(posts.id, postTaggedProducts.postId))
      .where(inArray(postTaggedProducts.productId, productIds))
      .orderBy(desc(posts.createdAt))
      .limit(5);
    if (tagged.length === 0) {
      await applyEventToProfile(input.buyerId, { type: "purchase", sellerId: input.sellerId ?? null });
      return;
    }
    for (const post of tagged) {
      await applyEventToProfile(input.buyerId, {
        type: "purchase",
        styleTags: Array.isArray(post.styleTags) ? (post.styleTags as string[]) : [],
        sellerId: post.sellerId,
      });
    }
  } catch (err) {
    logger.warn({ err, buyerId: input.buyerId }, "Purchase ranking signal failed");
  }
}
