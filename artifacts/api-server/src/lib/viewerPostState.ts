import { and, eq, inArray } from "drizzle-orm";
import { db, interactions, savedItems } from "@workspace/db";

/**
 * Per-viewer engagement state for a page of posts: did THIS viewer already
 * like / save / repost each one. One source of truth for every feed surface
 * (Following feed, public/For You feed, profile grids, product videos, post
 * detail), so a reload never shows a liked post as unliked — which used to
 * make the next tap send a no-op "add" while the UI counted +1, and left the
 * viewer unable to ever unlike/unsave.
 *
 * Three indexed lookups regardless of page size (no N+1). Signed-out viewers
 * get all-false without touching the database.
 */
export type ViewerPostState = { likedByMe: boolean; savedByMe: boolean; repostedByMe: boolean };

const NONE: ViewerPostState = { likedByMe: false, savedByMe: false, repostedByMe: false };

export async function viewerPostStates(
  viewerId: string | null | undefined,
  postIds: string[],
): Promise<(postId: string) => ViewerPostState> {
  const ids = [...new Set(postIds.filter(Boolean))];
  if (!viewerId || ids.length === 0) return () => NONE;

  const [mine, saved] = await Promise.all([
    db.select({ postId: interactions.postId, type: interactions.type })
      .from(interactions)
      .where(and(
        eq(interactions.userId, viewerId),
        inArray(interactions.postId, ids),
        inArray(interactions.type, ["like", "repost"]),
      )),
    db.select({ targetId: savedItems.targetId })
      .from(savedItems)
      .where(and(
        eq(savedItems.userId, viewerId),
        eq(savedItems.itemType, "post"),
        inArray(savedItems.targetId, ids),
      )),
  ]);

  const liked = new Set<string>();
  const reposted = new Set<string>();
  for (const row of mine) {
    if (!row.postId) continue;
    if (row.type === "like") liked.add(row.postId);
    else if (row.type === "repost") reposted.add(row.postId);
  }
  const savedSet = new Set(saved.map((row) => row.targetId));

  return (postId: string) => ({
    likedByMe: liked.has(postId),
    savedByMe: savedSet.has(postId),
    repostedByMe: reposted.has(postId),
  });
}
