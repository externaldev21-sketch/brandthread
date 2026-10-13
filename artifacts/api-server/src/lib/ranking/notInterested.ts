/**
 * "Not interested" reasons from the feed's long-press sheet (TikTok's
 * Video options → Not interested). The reason rides on the interaction's
 * `value` column, so no new table is needed:
 *   - "video"   (or no value): hide just this post (feed_not_interested row).
 *   - "creator": also stop recommending anything else from that seller in
 *                For You. Undoing the hide (DELETE …/not-interested) removes
 *                the interaction row and with it the creator hide.
 */
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db, interactions, posts } from "@workspace/db";
import { and, eq } from "drizzle-orm";

export const NOT_INTERESTED_REASONS = ["video", "creator"] as const;
export type NotInterestedReason = (typeof NOT_INTERESTED_REASONS)[number];

export function parseNotInterestedReason(value: unknown): NotInterestedReason | null | undefined {
  if (value === undefined || value === null) return undefined;
  return (NOT_INTERESTED_REASONS as readonly unknown[]).includes(value) ? (value as NotInterestedReason) : null;
}

/**
 * SQL predicate for For You queries: the post in `postIdColumn` (by seller in
 * `sellerColumn`) was not hidden by `viewerId`, and its seller was not hidden
 * with the "creator" reason. Undefined for signed-out viewers.
 */
export function notHiddenFromViewer(
  viewerId: string | null | undefined,
  postIdColumn: SQLWrapper,
  sellerColumn: SQLWrapper,
): SQL | undefined {
  if (!viewerId) return undefined;
  return sql`NOT EXISTS (
    SELECT 1 FROM feed_not_interested fni
    WHERE fni.user_id = ${viewerId} AND fni.post_id = ${postIdColumn}
  ) AND NOT EXISTS (
    SELECT 1 FROM interactions ni
    JOIN posts np ON np.id = ni.post_id
    WHERE ni.user_id = ${viewerId} AND ni.type = 'not_interested' AND ni.value = 'creator'
      AND np.user_id = ${sellerColumn}
  )`;
}

/** Sellers this viewer chose "Don't recommend videos from this creator" for. */
export async function hiddenCreatorIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ sellerId: posts.userId })
    .from(interactions)
    .innerJoin(posts, eq(posts.id, interactions.postId))
    .where(and(
      eq(interactions.userId, userId),
      eq(interactions.type, "not_interested"),
      eq(interactions.value, "creator"),
    ));
  return new Set(rows.map((r) => r.sellerId).filter((id): id is string => !!id));
}
