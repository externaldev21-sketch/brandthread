import { and, count, eq, inArray, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db, interactions, postComments, posts } from "@workspace/db";
import { authorInGoodStanding } from "./safety";
import { privateAuthorVisibleTo } from "./privateAccount";
import { OFFICIAL_ACCOUNT_CLERK_ID, officialSeedPublicSql } from "./officialSeed/config";

/**
 * Official @brandthread posts are visible to everyone only while
 * OFFICIAL_SEED_CONTENT_PUBLIC is on (see officialSeed/config.ts); platform
 * admins always see them. Every other author passes straight through.
 */
export function officialPostVisibleTo(viewerId: string | null | undefined, authorColumn: AnyColumn | SQL) {
  const viewerIsAdmin = viewerId
    ? sql<boolean>`exists (select 1 from users ou where ou.clerk_id = ${viewerId} and ou.role = 'admin' and ou.suspended_at is null)`
    : sql<boolean>`false`;
  return sql<boolean>`(${authorColumn} <> ${OFFICIAL_ACCOUNT_CLERK_ID} or ${officialSeedPublicSql()} or ${viewerIsAdmin})`;
}

/**
 * A post is publicly visible when it is published (or its schedule is due),
 * marked public, not held/removed by moderation, and its author is neither
 * suspended nor deleted. Every public feed and single-post read uses this.
 * Private accounts' posts are hidden unless `viewerId` is the author or
 * follows them (signed-out / omitted viewer: private authors excluded).
 * Official @brandthread posts follow officialPostVisibleTo, checked against
 * `opts.officialViewerId` (defaults to `viewerId`) so a surface can unlock
 * them for admins without also changing its private-account behaviour.
 */
export function publicPostCondition(
  now = new Date(),
  viewerId?: string | null,
  opts: { officialViewerId?: string | null } = {},
) {
  return and(
    sql<boolean>`coalesce((${posts.visibility}->>'isPublic')::boolean, true) = true`,
    or(
      eq(posts.postStatus, "published"),
      and(eq(posts.postStatus, "scheduled"), lte(posts.scheduledAt, now)),
    ),
    eq(posts.moderationStatus, "visible"),
    authorInGoodStanding(posts.userId),
    privateAuthorVisibleTo(viewerId, posts.userId),
    officialPostVisibleTo(opts.officialViewerId ?? viewerId, posts.userId),
  );
}

/** Total likes received on posts eligible for a public profile, independent of pagination. */
export async function publicProfileLikes(userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(interactions)
    .innerJoin(posts, eq(posts.id, interactions.postId))
    .where(and(
      eq(posts.userId, userId),
      eq(interactions.type, "like"),
      publicPostCondition(),
    ));
  return Number(row?.total ?? 0);
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
      eq(postComments.hiddenByOwner, false),
      authorInGoodStanding(postComments.authorId),
    ))
    .groupBy(postComments.postId);
  return new Map(rows.map((row) => [row.postId, Number(row.n)]));
}
