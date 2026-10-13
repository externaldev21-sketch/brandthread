/**
 * Thumbnails for saved posts (F6 item 89 — save posts to collections).
 *
 * Saved product rows already get their photo from fetchProductBadgeInfo; saved
 * post rows had none, so a post filed into a collection showed a blank tile and
 * never became the collection's auto cover. This looks up the same "best
 * thumbnail" activity notifications use (explicit thumbnail, else a still
 * image; videos without a thumbnail get none).
 *
 * Only public, published posts return a thumbnail: the public collection share
 * view uses the same adapter, so a post that went private or was removed never
 * leaks its image through someone's board.
 */
import { and, inArray } from "drizzle-orm";
import { db, posts } from "@workspace/db";
import { postThumbnail } from "./activityEvents";
import { publicPostCondition } from "./postVisibility";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function fetchSavedPostThumbnails(postIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(postIds)].filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      id: posts.id,
      thumbnailUrl: posts.thumbnailUrl,
      mediaUrl: posts.mediaUrl,
      mediaUrls: posts.mediaUrls,
      mediaType: posts.mediaType,
    })
    .from(posts)
    .where(and(inArray(posts.id, ids), publicPostCondition()));
  for (const row of rows) {
    const image = postThumbnail(row);
    if (image) out.set(row.id, image);
  }
  return out;
}
