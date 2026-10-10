/**
 * Interaction counts for a page of posts, in the same shape GET /api/public/posts
 * returns (likesCount/repostsCount/sharesCount/savesCount/commentsCount), so a
 * feed that hydrates posts elsewhere (GET /api/feed/for-you) renders the same
 * numbers and honours the seller's "hide like count" setting.
 */
import { db, interactions, savedItems } from "@workspace/db";
import { and, count, eq, inArray } from "drizzle-orm";
import { visibleCommentCounts } from "./postVisibility";

export type PostEngagementCounts = {
  likes: number; reposts: number; shares: number; saves: number; comments: number;
};

export type PostEngagementFields = {
  likesCount: number | null;
  repostsCount: number;
  sharesCount: number;
  savesCount: number;
  commentsCount: number;
};

/** Pure: response fields for one post (like count hidden when the seller turned it off). */
export function engagementFields(
  visibility: { showLikeCount?: boolean } | null | undefined,
  counts: PostEngagementCounts | undefined,
): PostEngagementFields {
  return {
    likesCount: visibility?.showLikeCount === false ? null : counts?.likes ?? 0,
    repostsCount: counts?.reposts ?? 0,
    sharesCount: counts?.shares ?? 0,
    savesCount: counts?.saves ?? 0,
    commentsCount: counts?.comments ?? 0,
  };
}

export async function postEngagementCounts(postIds: string[]): Promise<Map<string, PostEngagementCounts>> {
  const out = new Map<string, PostEngagementCounts>();
  if (postIds.length === 0) return out;
  const byType = (type: string) => db
    .select({ postId: interactions.postId, cnt: count() })
    .from(interactions)
    .where(and(inArray(interactions.postId, postIds), eq(interactions.type, type)))
    .groupBy(interactions.postId);
  const [likeRows, repostRows, shareRows, saveRows, commentCounts] = await Promise.all([
    byType("like"),
    byType("repost"),
    byType("share"),
    db.select({ postId: savedItems.targetId, cnt: count() })
      .from(savedItems)
      .where(and(inArray(savedItems.targetId, postIds), eq(savedItems.itemType, "post")))
      .groupBy(savedItems.targetId),
    visibleCommentCounts(postIds),
  ]);
  for (const id of postIds) out.set(id, { likes: 0, reposts: 0, shares: 0, saves: 0, comments: commentCounts.get(id) ?? 0 });
  const put = (rows: Array<{ postId: string | null; cnt: number }>, key: keyof PostEngagementCounts) => {
    for (const r of rows) {
      const entry = r.postId ? out.get(r.postId) : undefined;
      if (entry) entry[key] = Number(r.cnt);
    }
  };
  put(likeRows, "likes");
  put(repostRows, "reposts");
  put(shareRows, "shares");
  put(saveRows, "saves");
  return out;
}
