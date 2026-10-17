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
 * live (see notifyPostTagsIfLive callers). Each tag row records when its
 * alert went out (notified_at), so later edits, archive/restore or the person
 * clearing their notifications never re-send it.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, posts, postUserTags } from "@workspace/db";
import { resolveCommentMentions } from "./commentMentions";
import { notifyPostTag } from "./activityEvents";
import { logger } from "./logger";

/**
 * Make the post's tag rows match the @mentions in `caption`: removes people
 * no longer mentioned and adds new ones. Returns the tagged user ids.
 */
export const MAX_POST_USER_TAGS = 10;
type TaggedPost = { id: string; userId: string; caption: string | null };
type TagChanges = { added: string[]; removed: string[] };
export function syncPostUserTags(post: TaggedPost): Promise<TagChanges>;
export function syncPostUserTags(postId: string, authorId: string, caption: string | null | undefined): Promise<string[]>;
export async function syncPostUserTags(input: string | TaggedPost, authorId?: string, caption?: string | null): Promise<string[] | TagChanges> {
  const postId = typeof input === "string" ? input : input.id;
  const author = typeof input === "string" ? authorId! : input.userId;
  const text = typeof input === "string" ? caption : input.caption;
  const mentions = await resolveCommentMentions(text ?? "", author, MAX_POST_USER_TAGS);
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
  return typeof input === "string"
    ? wanted
    : { added: wanted.filter(id => !existing.some(row => row.taggedUserId === id)), removed: stale };
}

/** Send "tagged you" to everyone tagged in the post, if it is live. Never throws. */
export async function notifyPostTagsIfLive(postId: string): Promise<void> {
  try {
    const [post] = await db.select({
      userId: posts.userId, postStatus: posts.postStatus, moderationStatus: posts.moderationStatus,
    }).from(posts).where(eq(posts.id, postId)).limit(1);
    if (!post || post.postStatus !== "published" || post.moderationStatus !== "visible") return;
    // Claim un-notified tags first so concurrent publishes can't double-send.
    const tags = await db.update(postUserTags).set({ notifiedAt: new Date() })
      .where(and(eq(postUserTags.postId, postId), isNull(postUserTags.notifiedAt)))
      .returning({ taggedUserId: postUserTags.taggedUserId });
    for (const tag of tags) {
      await notifyPostTag({ postId, taggerId: post.userId, taggedUserId: tag.taggedUserId });
    }
  } catch (err) {
    logger.warn({ err, postId }, "Post tag notifications failed");
  }
}

export const notifyPostUserTags = notifyPostTagsIfLive;

export async function syncAndNotifyPostUserTags(
  post: TaggedPost,
  log?: { error: (obj: unknown, message: string) => void },
): Promise<void> {
  try {
    await syncPostUserTags(post);
    await notifyPostTagsIfLive(post.id);
  } catch (err) {
    log?.error({ err, postId: post.id }, "Could not sync post people tags");
  }
}
