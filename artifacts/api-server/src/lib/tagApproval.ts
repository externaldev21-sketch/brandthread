/**
 * "Manually approve tags" + "Pending tags" (buyer Settings → Tags and mentions).
 *
 * A tag of an account that approves tags manually is stored with status
 * 'pending' — people tags on posts (post_user_tags) and story @mention tags
 * (story_mentions), migration 119. Pending tags are kept off the account's
 * Tagged tab (routes/social.ts), its Story mentions rail
 * (routes/story-mentions.ts) and its notifications until approved.
 * Approve flips the row to 'approved'; Remove untags (deletes the row).
 */
import { and, count, desc, eq } from "drizzle-orm";
import { db, posts, postUserTags, stories, storyMentions, users } from "@workspace/db";
import { publishNotification } from "../routes/notifications-feed";
import { actorFieldsFromProfile, postThumbnail } from "./activityEvents";
import { blockedUserIds, profilesById } from "./safety";
import { tagStatusFor, usersRequiringTagApproval } from "./interactionSettings";
import { logger } from "./logger";

export const TAG_KINDS = ["post", "story"] as const;
export type TagKind = (typeof TAG_KINDS)[number];

/** Instagram allows up to 20 people tags per post. */
export const MAX_POST_USER_TAGS = 20;

export interface PendingTag {
  kind: TagKind;
  /** The post or story id. */
  id: string;
  authorId: string;
  authorName: string | null;
  authorUsername: string | null;
  thumbnailUrl: string | null;
  mediaType: string;
  createdAt: string;
}

export function isTagKind(value: unknown): value is TagKind {
  return TAG_KINDS.includes(value as TagKind);
}

/** Clean list of people to tag on a post: strings, de-duplicated, never the author, capped. */
export function cleanTaggedUserIds(taggerId: string, raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string")) return null;
  const ids = Array.from(new Set((raw as string[]).map((id) => id.trim()).filter((id) => id && id.length <= 200 && id !== taggerId)));
  return ids.length > MAX_POST_USER_TAGS ? null : ids;
}

function storyThumbnail(media: unknown): string | null {
  const items = Array.isArray(media) ? media : [];
  const pick = (m: any) => (typeof m?.imageUri === "string" ? m.imageUri : typeof m?.url === "string" ? m.url : null);
  return items.map(pick).find((u) => !!u) ?? null;
}

/**
 * People tags on a new post. Unknown, deleted/suspended and blocked (either
 * way) accounts are dropped. Accounts with manual approval get a pending tag
 * and no notification; the rest are notified ("tagged you in a post") unless
 * the post is not publicly visible yet (`notify` false).
 */
export async function recordPostUserTags(input: {
  postId: string;
  taggerId: string;
  taggedUserIds: string[];
  notify: boolean;
  post: { thumbnailUrl: string | null; mediaUrl: string | null; mediaUrls?: string[] | null; mediaType: string | null };
}): Promise<{ approved: string[]; pending: string[] }> {
  if (input.taggedUserIds.length === 0) return { approved: [], pending: [] };
  const [profiles, blocked] = await Promise.all([
    profilesById([input.taggerId, ...input.taggedUserIds]),
    blockedUserIds(input.taggerId),
  ]);
  const taggable = input.taggedUserIds.filter((id) => {
    const profile = profiles.get(id);
    return !!profile && !profile.deleted && !profile.suspended && !blocked.has(id);
  });
  if (taggable.length === 0) return { approved: [], pending: [] };
  const approvers = await usersRequiringTagApproval(taggable);
  const rows = taggable.map((taggedUserId) => ({
    postId: input.postId, taggedUserId, status: tagStatusFor(taggedUserId, input.taggerId, approvers),
  }));
  await db.insert(postUserTags).values(rows).onConflictDoNothing();
  const approved = rows.filter((r) => r.status === "approved").map((r) => r.taggedUserId);
  const pending = rows.filter((r) => r.status === "pending").map((r) => r.taggedUserId);
  const tagger = profiles.get(input.taggerId);
  if (input.notify && tagger && !tagger.deleted && !tagger.suspended) {
    const actor = actorFieldsFromProfile(tagger);
    const handle = actor.actorHandle ?? actor.actorName;
    for (const userId of approved) {
      void publishNotification({
        userId,
        category: "social",
        type: "post_tag",
        title: `${handle.startsWith("@") ? handle : `@${handle}`} tagged you in a post`,
        ...actor,
        targetId: input.postId,
        targetType: "post",
        targetImageUrl: postThumbnail(input.post),
      }).catch((err) => logger.warn({ err, postId: input.postId }, "Post tag notification failed"));
    }
  }
  return { approved, pending };
}

export async function pendingTagCount(userId: string): Promise<number> {
  const [[postRow], [storyRow]] = await Promise.all([
    db.select({ n: count() }).from(postUserTags)
      .where(and(eq(postUserTags.taggedUserId, userId), eq(postUserTags.status, "pending"))),
    db.select({ n: count() }).from(storyMentions)
      .where(and(eq(storyMentions.mentionedUserId, userId), eq(storyMentions.status, "pending"))),
  ]);
  return Number(postRow?.n ?? 0) + Number(storyRow?.n ?? 0);
}

/** My pending tags, newest first (authors blocked either way are left out). */
export async function listPendingTags(userId: string, limit = 100): Promise<PendingTag[]> {
  const [postRows, storyRows, blocked] = await Promise.all([
    db.select({
      id: posts.id,
      authorId: posts.userId,
      thumbnailUrl: posts.thumbnailUrl,
      mediaUrl: posts.mediaUrl,
      mediaUrls: posts.mediaUrls,
      mediaType: posts.mediaType,
      createdAt: postUserTags.createdAt,
      authorName: users.displayName,
      authorUsername: users.username,
    }).from(postUserTags)
      .innerJoin(posts, eq(posts.id, postUserTags.postId))
      .leftJoin(users, eq(users.clerkId, posts.userId))
      .where(and(eq(postUserTags.taggedUserId, userId), eq(postUserTags.status, "pending")))
      .orderBy(desc(postUserTags.createdAt))
      .limit(limit),
    db.select({
      id: stories.id,
      authorId: stories.authorId,
      authorName: stories.authorName,
      authorHandle: stories.authorHandle,
      media: stories.media,
      createdAt: storyMentions.createdAt,
    }).from(storyMentions)
      .innerJoin(stories, eq(stories.id, storyMentions.storyId))
      .where(and(eq(storyMentions.mentionedUserId, userId), eq(storyMentions.status, "pending")))
      .orderBy(desc(storyMentions.createdAt))
      .limit(limit),
    blockedUserIds(userId),
  ]);
  const items: PendingTag[] = [
    ...postRows.map((r) => ({
      kind: "post" as const,
      id: r.id,
      authorId: r.authorId,
      authorName: r.authorName ?? null,
      authorUsername: r.authorUsername ?? null,
      thumbnailUrl: postThumbnail(r),
      mediaType: r.mediaType ?? "photo",
      createdAt: new Date(r.createdAt).toISOString(),
    })),
    ...storyRows.map((r) => ({
      kind: "story" as const,
      id: r.id,
      authorId: r.authorId,
      authorName: r.authorName ?? null,
      authorUsername: (r.authorHandle ?? "").replace(/^@/, "") || null,
      thumbnailUrl: storyThumbnail(r.media),
      mediaType: "story",
      createdAt: new Date(r.createdAt).toISOString(),
    })),
  ];
  return items
    .filter((item) => !blocked.has(item.authorId))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

/** Approve one of my pending tags. false when there is no such pending tag. */
export async function approvePendingTag(userId: string, kind: TagKind, id: string): Promise<boolean> {
  const rows = kind === "post"
    ? await db.update(postUserTags).set({ status: "approved" })
      .where(and(eq(postUserTags.postId, id), eq(postUserTags.taggedUserId, userId), eq(postUserTags.status, "pending")))
      .returning({ id: postUserTags.id })
    : await db.update(storyMentions).set({ status: "approved" })
      .where(and(eq(storyMentions.storyId, id), eq(storyMentions.mentionedUserId, userId), eq(storyMentions.status, "pending")))
      .returning({ id: storyMentions.storyId });
  return rows.length > 0;
}

/** Remove me from a post or story tag (untag). false when I am not tagged there. */
export async function removeTag(userId: string, kind: TagKind, id: string): Promise<boolean> {
  const rows = kind === "post"
    ? await db.delete(postUserTags)
      .where(and(eq(postUserTags.postId, id), eq(postUserTags.taggedUserId, userId)))
      .returning({ id: postUserTags.id })
    : await db.delete(storyMentions)
      .where(and(eq(storyMentions.storyId, id), eq(storyMentions.mentionedUserId, userId)))
      .returning({ id: storyMentions.storyId });
  return rows.length > 0;
}

