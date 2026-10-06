/**
 * Account interaction settings — who may comment on an account's posts and
 * whether others may repost or download its content — plus the "Hide story
 * from" list. Stored in user_interaction_settings / story_hidden_viewers
 * (migration 117) and enforced here for every route that acts on them:
 *
 *   • comments  → routes/post-comments.ts (POST)
 *   • reposts   → routes/posts.ts (POST /:id/interact, type "repost")
 *   • downloads → routes/interaction-settings.ts (GET /posts/:postId/download),
 *                 which the share sheet asks before offering "Save video"
 *   • stories   → routes/social.ts + routes/story-mentions.ts read paths
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, follows, storyHiddenViewers, userInteractionSettings } from "@workspace/db";
import { z } from "@workspace/api-zod";

export const COMMENT_AUDIENCES = ["everyone", "following", "nobody"] as const;
export type CommentAudience = (typeof COMMENT_AUDIENCES)[number];

export interface InteractionSettings {
  commentAudience: CommentAudience;
  allowReposts: boolean;
  allowDownloads: boolean;
}

export const DEFAULT_INTERACTION_SETTINGS: InteractionSettings = {
  commentAudience: "everyone",
  allowReposts: true,
  allowDownloads: true,
};

/** Most people one account can hide its stories from. */
export const MAX_STORY_HIDDEN_USERS = 1000;

export const interactionSettingsPatchSchema = z.object({
  commentAudience: z.enum(COMMENT_AUDIENCES).optional(),
  allowReposts: z.boolean().optional(),
  allowDownloads: z.boolean().optional(),
});

export const storyHiddenBodySchema = z.object({
  userIds: z.array(z.string().trim().min(1).max(200)).max(MAX_STORY_HIDDEN_USERS),
});

/** A stored row (or nothing) as the settings the API returns. Unknown values fall back to the defaults. */
export function normalizeInteractionSettings(row?: Partial<Record<keyof InteractionSettings, unknown>> | null): InteractionSettings {
  const audience = row?.commentAudience;
  return {
    commentAudience: COMMENT_AUDIENCES.includes(audience as CommentAudience)
      ? audience as CommentAudience
      : DEFAULT_INTERACTION_SETTINGS.commentAudience,
    allowReposts: typeof row?.allowReposts === "boolean" ? row.allowReposts : DEFAULT_INTERACTION_SETTINGS.allowReposts,
    allowDownloads: typeof row?.allowDownloads === "boolean" ? row.allowDownloads : DEFAULT_INTERACTION_SETTINGS.allowDownloads,
  };
}

/**
 * Whether `commenter` may comment under the owner's audience setting.
 * The owner can always comment on their own posts.
 */
export function commentAllowed(input: {
  audience: CommentAudience;
  isOwner: boolean;
  ownerFollowsCommenter: boolean;
}): boolean {
  if (input.isOwner) return true;
  if (input.audience === "nobody") return false;
  if (input.audience === "following") return input.ownerFollowsCommenter;
  return true;
}

/** The message shown when the audience setting refuses a comment. */
export function commentRefusalMessage(audience: CommentAudience): string {
  return audience === "nobody"
    ? "This account has turned off comments."
    : "Only people this account follows can comment.";
}

/** Deduplicated list without the owner themself. */
export function cleanHiddenUserIds(ownerId: string, userIds: string[]): string[] {
  return Array.from(new Set(userIds.map((id) => id.trim()).filter((id) => id && id !== ownerId)));
}

export async function loadInteractionSettings(userId: string): Promise<InteractionSettings> {
  const [row] = await db.select({
    commentAudience: userInteractionSettings.commentAudience,
    allowReposts: userInteractionSettings.allowReposts,
    allowDownloads: userInteractionSettings.allowDownloads,
  }).from(userInteractionSettings).where(eq(userInteractionSettings.userId, userId)).limit(1);
  return normalizeInteractionSettings(row ?? null);
}

export async function saveInteractionSettings(
  userId: string,
  patch: Partial<InteractionSettings>,
): Promise<InteractionSettings> {
  const next = normalizeInteractionSettings({ ...(await loadInteractionSettings(userId)), ...patch });
  await db.insert(userInteractionSettings)
    .values({ userId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userInteractionSettings.userId,
      set: { ...next, updatedAt: new Date() },
    });
  return next;
}

/** null when `commenterId` may comment on a post owned by `ownerId`; otherwise the refusal. */
export async function commentRefusal(ownerId: string, commenterId: string): Promise<{ message: string } | null> {
  if (ownerId === commenterId) return null;
  const { commentAudience } = await loadInteractionSettings(ownerId);
  if (commentAudience === "everyone") return null;
  let ownerFollowsCommenter = false;
  if (commentAudience === "following") {
    const [row] = await db.select({ followerId: follows.followerId }).from(follows)
      .where(and(eq(follows.followerId, ownerId), eq(follows.followingId, commenterId)))
      .limit(1);
    ownerFollowsCommenter = !!row;
  }
  return commentAllowed({ audience: commentAudience, isOwner: false, ownerFollowsCommenter })
    ? null
    : { message: commentRefusalMessage(commentAudience) };
}

/** Whether people other than the owner may repost the owner's posts. */
export async function repostsAllowedBy(ownerId: string): Promise<boolean> {
  return (await loadInteractionSettings(ownerId)).allowReposts;
}

export async function storyHiddenUserIds(ownerId: string): Promise<string[]> {
  const rows = await db.select({ hiddenUserId: storyHiddenViewers.hiddenUserId })
    .from(storyHiddenViewers).where(eq(storyHiddenViewers.ownerId, ownerId));
  return rows.map((row) => row.hiddenUserId);
}

export async function replaceStoryHiddenUserIds(ownerId: string, userIds: string[]): Promise<string[]> {
  const clean = cleanHiddenUserIds(ownerId, userIds);
  await db.transaction(async (tx) => {
    await tx.delete(storyHiddenViewers).where(eq(storyHiddenViewers.ownerId, ownerId));
    if (clean.length > 0) {
      await tx.insert(storyHiddenViewers)
        .values(clean.map((hiddenUserId) => ({ ownerId, hiddenUserId })))
        .onConflictDoNothing();
    }
  });
  return clean;
}

/** Of `authorIds`, the authors who hide their stories from `viewerId`. */
export async function authorsHidingStoriesFrom(viewerId: string, authorIds: string[]): Promise<Set<string>> {
  const others = authorIds.filter((id) => id !== viewerId);
  if (others.length === 0) return new Set();
  const rows = await db.select({ ownerId: storyHiddenViewers.ownerId }).from(storyHiddenViewers)
    .where(and(eq(storyHiddenViewers.hiddenUserId, viewerId), inArray(storyHiddenViewers.ownerId, others)));
  return new Set(rows.map((row) => row.ownerId));
}

/** True when `authorId` hides their stories from `viewerId` (never for the author). */
export async function storyHiddenFrom(authorId: string, viewerId: string): Promise<boolean> {
  if (authorId === viewerId) return false;
  return (await authorsHidingStoriesFrom(viewerId, [authorId])).has(authorId);
}
