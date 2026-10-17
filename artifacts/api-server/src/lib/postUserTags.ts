/**
 * People tagged in a post (`post_user_tags`), derived from the caption's
 * @mentions — the composer's "Tag people" inserts @handles into the caption,
 * so the caption is the single source of truth for who is tagged.
 *
 * Resolution reuses the comment-mention rules (resolveCommentMentions): no
 * self-tags, no missing/deleted/suspended accounts, nobody in a block
 * relation with the author. Caption @mentions send no separate "mentioned
 * you" notification, so the "tagged you" alert is the only one a person gets.
 *
 * "Tagged you" is only sent once the post is live (published + not held by
 * moderation); drafts, scheduled and held posts are notified when they go
 * live (see notifyPostTagsIfLive callers). notifyPostTag is idempotent per
 * (person, post), so calling it again for already-notified people is safe.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, posts, postUserTags } from "@workspace/db";
import { resolveCommentMentions } from "./commentMentions";
import { notifyPostTag } from "./activityEvents";
import { logger } from "./logger";

/**
 * Make the post's tag rows match the @mentions in `caption`: removes people
 * no longer mentioned and adds new ones. Returns the tagged user ids.
 */
export async function syncPostUserTags(postId: string, authorId: string, caption: string | null | undefined): Promise<string[]> {
  const mentions = await resolveCommentMentions(caption ?? "", authorId);
  const wanted = mentions.map((m) => m.userId);
  const existing = await db.select({ taggedUserId: postUserTags.taggedUserId })
    .from(postUserTags).where(eq(postUserTags.postId, postId));
  const stale = existing.map((r) => r.taggedUserId).filter((id) => !wanted.includes(id));
  if (stale.length > 0) {
    await db.delete(postUserTags)
      .where(and(eq(postUserTags.postId, postId), inArray(postUserTags.taggedUserId, stale)));
  }
  if (wanted.length > 0) {
    await db.insert(postUserTags)
      .values(wanted.map((taggedUserId) => ({ postId, taggedUserId })))
      .onConflictDoNothing();
  }
  return wanted;
}

/** Send "tagged you" to everyone tagged in the post, if it is live. Never throws. */
export async function notifyPostTagsIfLive(postId: string): Promise<void> {
  try {
    const [post] = await db.select({
      userId: posts.userId, postStatus: posts.postStatus, moderationStatus: posts.moderationStatus,
    }).from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post || post.postStatus !== "published" || post.moderationStatus !== "visible") return;
    const tags = await db.select({ taggedUserId: postUserTags.taggedUserId })
      .from(postUserTags).where(eq(postUserTags.postId, postId));
    for (const tag of tags) {
      await notifyPostTag({ postId, taggerId: post.userId, taggedUserId: tag.taggedUserId });
    }
  } catch (err) {
    logger.warn({ err, postId }, "Post tag notifications failed");
  }
}
