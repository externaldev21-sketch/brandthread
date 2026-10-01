/**
 * Who may open which story.
 *
 * Story audiences: 'public' (the author's followers), 'friends' (mutual
 * follows) and 'close_friends' (people on the author's close_friends list).
 * Every story read path goes through `viewerRelations` + `audienceAllows` so
 * a Close Friends story can never leak through a path that forgot the check.
 * Public stories keep their existing per-endpoint rules untouched.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, follows, closeFriends } from "@workspace/db";

export type StoryAudience = "public" | "friends" | "close_friends";

export function normalizeAudience(v: string | null | undefined): StoryAudience {
  return v === "friends" || v === "close_friends" ? v : "public";
}

export interface ViewerRelations {
  /** authors the viewer follows */
  following: Set<string>;
  /** authors that follow the viewer back (with `following` => mutual) */
  followedBy: Set<string>;
  /** authors whose close-friends list contains the viewer */
  closeFriendOf: Set<string>;
}

export async function viewerRelations(viewerId: string, authorIds: string[]): Promise<ViewerRelations> {
  const ids = [...new Set(authorIds.filter((a) => a !== viewerId))];
  if (ids.length === 0) return { following: new Set(), followedBy: new Set(), closeFriendOf: new Set() };
  const [a, b, c] = await Promise.all([
    db.select({ id: follows.followingId }).from(follows)
      .where(and(eq(follows.followerId, viewerId), inArray(follows.followingId, ids))),
    db.select({ id: follows.followerId }).from(follows)
      .where(and(eq(follows.followingId, viewerId), inArray(follows.followerId, ids))),
    db.select({ id: closeFriends.userId }).from(closeFriends)
      .where(and(eq(closeFriends.friendId, viewerId), inArray(closeFriends.userId, ids))),
  ]);
  return {
    following: new Set(a.map((r) => r.id)),
    followedBy: new Set(b.map((r) => r.id)),
    closeFriendOf: new Set(c.map((r) => r.id)),
  };
}

/**
 * Audience gate only (callers have already handled blocks). 'public' always
 * passes here; callers keep their own follow rules for public stories.
 */
export function audienceAllows(
  audience: string | null | undefined, authorId: string, viewerId: string, rel: ViewerRelations,
): boolean {
  if (authorId === viewerId) return true;
  switch (normalizeAudience(audience)) {
    case "close_friends": return rel.closeFriendOf.has(authorId);
    case "friends": return rel.following.has(authorId) && rel.followedBy.has(authorId);
    default: return true;
  }
}

/** Single-story convenience used by like / view / viewers-style endpoints. */
export async function viewerMayOpenAudience(
  audience: string | null | undefined, authorId: string, viewerId: string,
): Promise<boolean> {
  if (authorId === viewerId || normalizeAudience(audience) === "public") return true;
  return audienceAllows(audience, authorId, viewerId, await viewerRelations(viewerId, [authorId]));
}
