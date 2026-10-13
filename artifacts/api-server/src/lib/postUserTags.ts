/**
 * People tags on posts (the profile "Tagged" tab, GET /api/social/profile/:id/tagged).
 *
 * The create flow's "Tag people" step writes @handles into the caption, so the
 * caption is the source of truth: on create and on every caption edit the
 * post's `post_user_tags` rows are synced to the @handles it contains.
 * Resolution follows the comment-mention rules (lib/commentMentions.ts): not
 * yourself, not a missing/deleted/suspended account, nobody blocked in either
 * direction. Syncing is idempotent (unique (post_id, tagged_user_id)).
 *
 * Tagged people are told once the post is live (published + visible) via the
 * existing notifyPostTag, which is itself idempotent per (person, post, tagger)
 * — so drafts / scheduled / held posts notify when they go live, not before.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, postUserTags, posts } from "@workspace/db";
import { resolveCommentMentions } from "./commentMentions";
import { notifyPostTag } from "./activityEvents";

/** Instagram allows up to 20 people per post; the caption parser caps at 10 handles. */
export const MAX_POST_USER_TAGS = 10;

/** Sync a post's people tags to the @handles in its caption. Returns who was added / removed. */
export async function syncPostUserTags(
  post: { id: string; userId: string; caption: string | null },
): Promise<{ added: string[]; removed: string[] }> {
  const wanted = await resolveCommentMentions(post.caption ?? "", post.userId, MAX_POST_USER_TAGS);
  const wantedIds = new Set(wanted.map((m) => m.userId));
  const existing = await db.select({ taggedUserId: postUserTags.taggedUserId })
    .from(postUserTags).where(eq(postUserTags.postId, post.id));
  const existingIds = new Set(existing.map((row) => row.taggedUserId));
  const added = [...wantedIds].filter((id) => !existingIds.has(id));
  const removed = [...existingIds].filter((id) => !wantedIds.has(id));
  if (removed.length > 0) {
    await db.delete(postUserTags)
      .where(and(eq(postUserTags.postId, post.id), inArray(postUserTags.taggedUserId, removed)));
  }
  if (added.length > 0) {
    await db.insert(postUserTags)
      .values(added.map((taggedUserId) => ({ postId: post.id, taggedUserId })))
      .onConflictDoNothing();
  }
  return { added, removed };
}

/** Tell everyone tagged in a post — only once it is published and visible. */
export async function notifyPostUserTags(postId: string): Promise<void> {
  const [post] = await db.select({ userId: posts.userId, postStatus: posts.postStatus, moderationStatus: posts.moderationStatus })
    .from(posts).where(eq(posts.id, postId)).limit(1);
  if (!post || post.postStatus !== "published" || post.moderationStatus !== "visible") return;
  const tags = await db.select({ taggedUserId: postUserTags.taggedUserId })
    .from(postUserTags).where(eq(postUserTags.postId, postId));
  for (const tag of tags) {
    await notifyPostTag({ postId, taggerId: post.userId, taggedUserId: tag.taggedUserId });
  }
}

/** Create / caption-edit hook: sync tags, then notify if the post is live. Never throws. */
export async function syncAndNotifyPostUserTags(
  post: { id: string; userId: string; caption: string | null },
  log?: { error: (obj: unknown, msg: string) => void },
): Promise<void> {
  try {
    await syncPostUserTags(post);
    await notifyPostUserTags(post.id);
  } catch (err) {
    log?.error({ err, postId: post.id }, "Could not sync post people tags");
  }
}
