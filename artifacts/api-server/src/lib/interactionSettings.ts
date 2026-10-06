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
 *   • tag approval → lib/tagApproval.ts (pending tags), lib/storyMentions.ts
 *                 (recording), routes/social.ts Tagged tab + story-mentions rail
 *   • snooze    → routes/public.ts GET /posts, routes/feed.ts GET /for-you
 *   • remixes   → lib/remix.ts (routes/remix.ts, POST /api/posts remixOfPostId)
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, follows, storyHiddenViewers, userInteractionSettings } from "@workspace/db";
import { z } from "@workspace/api-zod";

export const COMMENT_AUDIENCES = ["everyone", "following", "nobody"] as const;
export type CommentAudience = (typeof COMMENT_AUDIENCES)[number];

export const REMIX_AUDIENCES = ["everyone", "following", "off"] as const;
export type RemixAudience = (typeof REMIX_AUDIENCES)[number];

/** "Snooze suggested posts" lasts 30 days, like Instagram. */
export const SUGGESTED_SNOOZE_DAYS = 30;

export interface InteractionSettings {
  commentAudience: CommentAudience;
  allowReposts: boolean;
  allowDownloads: boolean;
  /** New tags wait in "Pending tags" until approved (migration 119). */
  manualTagApproval: boolean;
  /** Who may remix this account's videos (lib/remix.ts). */
  remixAudience: RemixAudience;
  /** ISO time suggested posts are snoozed until, or null when not snoozed. */
  suggestedSnoozedUntil: string | null;
}

export const DEFAULT_INTERACTION_SETTINGS: InteractionSettings = {
  commentAudience: "everyone",
  allowReposts: true,
  allowDownloads: true,
  manualTagApproval: false,
  remixAudience: "everyone",
  suggestedSnoozedUntil: null,
};

/** Most people one account can hide its stories from. */
export const MAX_STORY_HIDDEN_USERS = 1000;

export const interactionSettingsPatchSchema = z.object({
  commentAudience: z.enum(COMMENT_AUDIENCES).optional(),
  allowReposts: z.boolean().optional(),
  allowDownloads: z.boolean().optional(),
  manualTagApproval: z.boolean().optional(),
  remixAudience: z.enum(REMIX_AUDIENCES).optional(),
  /** true snoozes suggested posts for SUGGESTED_SNOOZE_DAYS from now; false ends the snooze. */
  snoozeSuggested: z.boolean().optional(),
});

export type InteractionSettingsPatch = {
  commentAudience?: CommentAudience;
  allowReposts?: boolean;
  allowDownloads?: boolean;
  manualTagApproval?: boolean;
  remixAudience?: RemixAudience;
  snoozeSuggested?: boolean;
};

export const storyHiddenBodySchema = z.object({
  userIds: z.array(z.string().trim().min(1).max(200)).max(MAX_STORY_HIDDEN_USERS),
});

/** A snooze end time that is still in the future, as ISO; otherwise null. */
export function activeSnoozeUntil(value: unknown, now: Date = new Date()): string | null {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime()) || date.getTime() <= now.getTime()) return null;
  return date.toISOString();
}

/** When a snooze started now ends. */
export function snoozeEndsAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + SUGGESTED_SNOOZE_DAYS * 24 * 60 * 60 * 1000);
}

/** A stored row (or nothing) as the settings the API returns. Unknown values fall back to the defaults. */
export function normalizeInteractionSettings(
  row?: Partial<Record<keyof InteractionSettings, unknown>> | null,
  now: Date = new Date(),
): InteractionSettings {
  const audience = row?.commentAudience;
  return {
    manualTagApproval: typeof row?.manualTagApproval === "boolean" ? row.manualTagApproval : DEFAULT_INTERACTION_SETTINGS.manualTagApproval,
    remixAudience: REMIX_AUDIENCES.includes(row?.remixAudience as RemixAudience)
      ? row!.remixAudience as RemixAudience
      : DEFAULT_INTERACTION_SETTINGS.remixAudience,
    suggestedSnoozedUntil: activeSnoozeUntil(row?.suggestedSnoozedUntil, now),
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
    manualTagApproval: userInteractionSettings.manualTagApproval,
    remixAudience: userInteractionSettings.remixAudience,
    suggestedSnoozedUntil: userInteractionSettings.suggestedSnoozedUntil,
  }).from(userInteractionSettings).where(eq(userInteractionSettings.userId, userId)).limit(1);
  return normalizeInteractionSettings(row ?? null);
}

/** The stored settings after `patch` (snoozeSuggested becomes a concrete end time). */
export function applyInteractionPatch(
  current: InteractionSettings,
  patch: InteractionSettingsPatch,
  now: Date = new Date(),
): InteractionSettings {
  const { snoozeSuggested, ...rest } = patch;
  const merged: InteractionSettings = { ...current, ...rest };
  if (snoozeSuggested === true) merged.suggestedSnoozedUntil = snoozeEndsAt(now).toISOString();
  if (snoozeSuggested === false) merged.suggestedSnoozedUntil = null;
  return normalizeInteractionSettings(merged, now);
}

export async function saveInteractionSettings(
  userId: string,
  patch: InteractionSettingsPatch,
): Promise<InteractionSettings> {
  const next = applyInteractionPatch(await loadInteractionSettings(userId), patch);
  const stored = {
    ...next,
    suggestedSnoozedUntil: next.suggestedSnoozedUntil ? new Date(next.suggestedSnoozedUntil) : null,
  };
  await db.insert(userInteractionSettings)
    .values({ userId, ...stored, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userInteractionSettings.userId,
      set: { ...stored, updatedAt: new Date() },
    });
  return next;
}

/** True while `userId` has suggested posts snoozed (signed-out viewers never do). */
export async function suggestedPostsSnoozed(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  return (await loadInteractionSettings(userId)).suggestedSnoozedUntil !== null;
}

/** The viewer plus every account they follow — the only authors a snoozed feed shows. */
export async function followedAuthorsAndSelf(userId: string): Promise<Set<string>> {
  const rows = await db.select({ id: follows.followingId }).from(follows).where(eq(follows.followerId, userId));
  return new Set([userId, ...rows.map((row) => row.id)]);
}

/**
 * Ranked feed items for `userId`: unchanged unless suggested posts are
 * snoozed, then only items whose author the viewer follows (or is).
 */
export async function withoutSuggestedWhenSnoozed<T>(
  userId: string,
  items: T[],
  authorOf: (item: T) => string,
): Promise<T[]> {
  if (!(await suggestedPostsSnoozed(userId))) return items;
  const allowed = await followedAuthorsAndSelf(userId);
  return items.filter((item) => allowed.has(authorOf(item)));
}

/** Of `userIds`, those with "Manually approve tags" on. */
export async function usersRequiringTagApproval(userIds: string[]): Promise<Set<string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) return new Set();
  const rows = await db.select({ userId: userInteractionSettings.userId }).from(userInteractionSettings)
    .where(and(inArray(userInteractionSettings.userId, ids), eq(userInteractionSettings.manualTagApproval, true)));
  return new Set(rows.map((row) => row.userId));
}

/** 'pending' when the tagged account approves tags manually (never for tagging yourself). */
export function tagStatusFor(taggedUserId: string, taggerId: string, approvers: Set<string>): "approved" | "pending" {
  return taggedUserId !== taggerId && approvers.has(taggedUserId) ? "pending" : "approved";
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
