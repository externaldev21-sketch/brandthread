import { and, count, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db, postComments, posts } from "@workspace/db";
import { authorInGoodStanding } from "./safety";

/**
 * A post is publicly visible when it is published (or its schedule is due),
 * marked public, not held/removed by moderation, and its author is neither
 * suspended nor deleted. Every public feed and single-post read uses this.
 */
export function publicPostCondition(now = new Date()) {
  return and(
    sql<boolean>`coalesce((${posts.visibility}->>'isPublic')::boolean, true) = true`,
    or(
      eq(posts.postStatus, "published"),
      and(eq(posts.postStatus, "scheduled"), lte(posts.scheduledAt, now)),
    ),
    eq(posts.moderationStatus, "visible"),
    authorInGoodStanding(posts.userId),
  );
}

/**
 * Visible comment counts per post. Held, removed, and suspended/deleted
 * authors' comments are excluded so counts match what people can read.
 */
export async function visibleCommentCounts(postIds: string[]): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map();
  const rows = await db
    .select({ postId: postComments.postId, n: count() })
    .from(postComments)
    .where(and(
      inArray(postComments.postId, postIds),
      eq(postComments.moderationStatus, "visible"),
      authorInGoodStanding(postComments.authorId),
    ))
    .groupBy(postComments.postId);
  return new Map(rows.map((row) => [row.postId, Number(row.n)]));
}
