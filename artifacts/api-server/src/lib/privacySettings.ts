/**
 * Account privacy settings from the Privacy screen, enforced server-side.
 *
 * Stored in users.privacy_settings (jsonb). Only keys the person changed are
 * kept; anything missing or invalid falls back to DEFAULT_ACCOUNT_PRIVACY,
 * which matches how every endpoint behaved before these settings existed, so
 * people who never opened the screen see no change.
 *
 * Audiences (from the owner's point of view):
 *   everyone            — anyone not blocked
 *   friends             — people the owner follows ("Only people you follow")
 *   friends_of_friends  — people the owner follows, and people they follow
 *   nobody / only_me    — only the owner
 */
import { inArray, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db, stories, users, userSettings } from "@workspace/db";
import { z } from "@workspace/api-zod";
import { viewerRelations } from "./storyAccess";

export const AUDIENCE_VALUES = ["everyone", "friends", "friends_of_friends", "nobody", "only_me"] as const;
export type PrivacyAudience = typeof AUDIENCE_VALUES[number];

/** The choices each picker on the Privacy screen offers (mirrors the mobile OptionSheets). */
export const accountPrivacySchema = z.object({
  whoCanSendFriendRequests: z.enum(["everyone", "friends_of_friends", "nobody"]),
  whoCanSeePosts: z.enum(["everyone", "friends", "only_me"]),
  whoCanSeeFriendsList: z.enum(["everyone", "friends", "only_me"]),
  whoCanReplyToStories: z.enum(["everyone", "friends", "nobody"]),
  whoCanMention: z.enum(["everyone", "friends", "nobody"]),
  activityStatusVisible: z.boolean(),
  readReceiptsEnabled: z.boolean(),
  searchable: z.boolean(),
});
export type AccountPrivacy = z.infer<typeof accountPrivacySchema>;
export const accountPrivacyPatchSchema = accountPrivacySchema.partial().strict();

export const DEFAULT_ACCOUNT_PRIVACY: AccountPrivacy = {
  whoCanSendFriendRequests: "everyone",
  whoCanSeePosts: "everyone",
  whoCanSeeFriendsList: "everyone",
  whoCanReplyToStories: "everyone",
  whoCanMention: "everyone",
  activityStatusVisible: true,
  readReceiptsEnabled: true,
  searchable: true,
};

export const ACCOUNT_PRIVACY_KEYS = Object.keys(DEFAULT_ACCOUNT_PRIVACY) as Array<keyof AccountPrivacy>;

/** Stored jsonb → effective settings (unknown / invalid keys ignored, defaults filled in). */
export function resolveAccountPrivacy(raw: unknown): AccountPrivacy {
  const out: AccountPrivacy = { ...DEFAULT_ACCOUNT_PRIVACY };
  if (!raw || typeof raw !== "object") return out;
  const shape = accountPrivacySchema.shape;
  for (const key of ACCOUNT_PRIVACY_KEYS) {
    const parsed = shape[key].safeParse((raw as Record<string, unknown>)[key]);
    if (parsed.success) (out as any)[key] = parsed.data;
  }
  return out;
}

export function accountPrivacyFromAppSettings(raw: unknown): Partial<AccountPrivacy> {
  if (!raw || typeof raw !== "object") return {};
  const root = raw as Record<string, unknown>;
  const candidate: Record<string, unknown> = { ...((root.socialPrivacy as Record<string, unknown>) ?? {}) };
  if (root.storyReplies !== undefined) candidate.whoCanReplyToStories = root.storyReplies === "off" ? "nobody" : root.storyReplies;
  if (root.readReceipts !== undefined) candidate.readReceiptsEnabled = root.readReceipts;
  if (root.activityStatus !== undefined) candidate.activityStatusVisible = root.activityStatus;
  const patch: Partial<AccountPrivacy> = {};
  for (const key of ACCOUNT_PRIVACY_KEYS) {
    const parsed = accountPrivacySchema.shape[key].safeParse(candidate[key]);
    if (parsed.success) (patch as Record<string, unknown>)[key] = parsed.data;
  }
  return patch;
}

type SettingsTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Keep the existing account settings/outbox and the reviewed privacy API on one value. */
export async function mirrorAccountPrivacy(tx: SettingsTx, userId: string, patch: Partial<AccountPrivacy>): Promise<void> {
  if (!Object.keys(patch).length) return;
  const aliases: Record<string, unknown> = {};
  if (patch.whoCanReplyToStories !== undefined) aliases.storyReplies = patch.whoCanReplyToStories === "nobody" ? "off" : patch.whoCanReplyToStories;
  if (patch.readReceiptsEnabled !== undefined) aliases.readReceipts = patch.readReceiptsEnabled;
  if (patch.activityStatusVisible !== undefined) aliases.activityStatus = patch.activityStatusVisible;
  await tx.insert(userSettings).values({ userId, settings: { ...aliases, socialPrivacy: patch }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        settings: sql`COALESCE(${userSettings.settings}, '{}'::jsonb) || ${JSON.stringify(aliases)}::jsonb
          || jsonb_build_object('socialPrivacy', COALESCE(${userSettings.settings}->'socialPrivacy', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
        updatedAt: new Date(),
      },
    });
}

export async function privacySettingsFor(userIds: string[]): Promise<Map<string, AccountPrivacy>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, AccountPrivacy>();
  if (unique.length === 0) return out;
  const rows = await db
    .select({ clerkId: users.clerkId, privacySettings: users.privacySettings, readReceipts: users.readReceiptsEnabled, activityStatus: users.showActivityStatus })
    .from(users)
    .where(inArray(users.clerkId, unique))
    .limit(unique.length);
  const legacyRows = await db.select().from(userSettings).where(inArray(userSettings.userId, unique));
  const legacy = new Map(legacyRows.map(row => [row.userId, accountPrivacyFromAppSettings(row.settings)]));
  for (const row of rows) {
    const privacy = resolveAccountPrivacy({ ...legacy.get(row.clerkId), ...row.privacySettings });
    out.set(row.clerkId, { ...privacy, readReceiptsEnabled: privacy.readReceiptsEnabled && row.readReceipts !== false,
      activityStatusVisible: privacy.activityStatusVisible && row.activityStatus !== false });
  }
  for (const id of unique) if (!out.has(id)) out.set(id, { ...DEFAULT_ACCOUNT_PRIVACY });
  return out;
}

export async function privacySettingsOf(userId: string): Promise<AccountPrivacy> {
  return (await privacySettingsFor([userId])).get(userId) ?? { ...DEFAULT_ACCOUNT_PRIVACY };
}

type AudienceKey = "whoCanSendFriendRequests" | "whoCanSeePosts" | "whoCanSeeFriendsList" | "whoCanReplyToStories" | "whoCanMention";

/**
 * Which of `ownerIds` let `viewerId` in for one audience setting. Blocks are
 * the caller's job; this only answers the privacy choice. An owner always
 * passes for themselves.
 */
export async function ownersAllowing(key: AudienceKey, ownerIds: string[], viewerId: string): Promise<Set<string>> {
  const unique = [...new Set(ownerIds.filter(Boolean))];
  const allowed = new Set<string>();
  if (unique.length === 0) return allowed;
  const settings = await privacySettingsFor(unique);
  const needFriends: string[] = [];
  const needFof: string[] = [];
  for (const owner of unique) {
    const audience = settings.get(owner)?.[key] ?? DEFAULT_ACCOUNT_PRIVACY[key];
    if (owner === viewerId || audience === "everyone") allowed.add(owner);
    else if (audience === "friends") needFriends.push(owner);
    else if (audience === "friends_of_friends") needFof.push(owner);
    // nobody / only_me: never
  }
  if (needFriends.length === 0 && needFof.length === 0) return allowed;
  // rel.followedBy = owners who follow the viewer, i.e. the viewer is someone the owner follows.
  const rel = await viewerRelations(viewerId, [...needFriends, ...needFof]);
  for (const owner of [...needFriends, ...needFof]) if (rel.followedBy.has(owner)) allowed.add(owner);
  const fofLeft = needFof.filter((owner) => !allowed.has(owner));
  if (fofLeft.length > 0) {
    // Someone the owner follows follows the viewer.
    const rows = await db.execute(sql`
      SELECT DISTINCT f1.follower_id AS owner
      FROM follows f1
      JOIN follows f2 ON f2.follower_id = f1.following_id AND f2.following_id = ${viewerId}
      WHERE f1.follower_id IN (${sql.join(fofLeft.map((id) => sql`${id}`), sql`, `)})
    `);
    for (const row of ((rows as any).rows ?? []) as Array<{ owner: string }>) allowed.add(String(row.owner));
  }
  return allowed;
}

export async function ownerAllows(key: AudienceKey, ownerId: string, viewerId: string): Promise<boolean> {
  return (await ownersAllowing(key, [ownerId], viewerId)).has(ownerId);
}

/** SQL predicate on a users row: the account has not turned off "Appear in search". */
export function userIsSearchable(
  privacyColumn: SQLWrapper = users.privacySettings,
  userIdColumn: SQLWrapper = users.clerkId,
): SQL {
  // Older accounts stored this choice in account settings. Missing newer JSON
  // must not make an account searchable again before they next edit Privacy.
  return sql`COALESCE(${privacyColumn}->>'searchable', (
    SELECT legacy_privacy.settings->'socialPrivacy'->>'searchable'
    FROM ${userSettings} legacy_privacy WHERE legacy_privacy.user_id = ${userIdColumn}
  ), 'true') <> 'false'`;
}

/** Whether `userId` shares read receipts / activity status (defaults on). */
export async function sharesReadReceipts(userId: string): Promise<boolean> {
  return (await privacySettingsOf(userId)).readReceiptsEnabled;
}
export async function sharesActivityStatus(userId: string): Promise<boolean> {
  return (await privacySettingsOf(userId)).activityStatusVisible;
}

// ─── Story replies ────────────────────────────────────────────────────────────

export type StoryReplyPerm = "everyone" | "friends" | "off";
const REPLY_PERM_RANK: Record<StoryReplyPerm, number> = { everyone: 0, friends: 1, off: 2 };

function asReplyPerm(v: unknown): StoryReplyPerm | null {
  return v === "everyone" || v === "friends" || v === "off" ? v : null;
}

/** The stricter of two story reply permissions (unknown values count as 'everyone'). */
export function stricterReplyPerm(a: unknown, b: unknown): StoryReplyPerm {
  const x = asReplyPerm(a) ?? "everyone";
  const y = asReplyPerm(b) ?? "everyone";
  return REPLY_PERM_RANK[x] >= REPLY_PERM_RANK[y] ? x : y;
}

/**
 * For a DM carrying `story_reply` attachments: an error message when the
 * sender may not reply to one of those stories (replies off on the story, the
 * story's reply permission, or the author's "Who can reply to stories"
 * setting, which also covers stories posted before the setting changed).
 * Null when the reply is allowed or the message isn't a story reply.
 */
export async function storyReplyDenial(senderId: string, attachments: unknown[]): Promise<string | null> {
  const storyIds = [...new Set(attachments
    .map((a: any) => (a?.type === "story_reply" && typeof a?.meta?.storyId === "string" ? a.meta.storyId as string : null))
    .filter((id): id is string => !!id && /^[0-9a-f-]{36}$/i.test(id)))];
  if (storyIds.length === 0) return null;
  const rows = await db
    .select({ authorId: stories.authorId, replyPerm: stories.privacyReplyPerm, repliesDisabled: stories.repliesDisabled })
    .from(stories)
    .where(inArray(stories.id, storyIds));
  const denied = "This person has turned off story replies from you.";
  for (const row of rows) {
    if (row.authorId === senderId) continue;
    if (row.repliesDisabled || row.replyPerm === "off") return denied;
    const audience = row.replyPerm == null
      ? (await privacySettingsOf(row.authorId)).whoCanReplyToStories : null;
    // New stories store the resolved per-story choice. An explicit choice
    // must not subsequently be replaced by the account's creation default.
    const effective = asReplyPerm(row.replyPerm)
      ?? (audience === "nobody" ? "off" : audience ?? "everyone");
    if (effective === "off") return denied;
    if (effective === "friends" && !(await viewerRelations(senderId, [row.authorId])).followedBy.has(row.authorId)) return denied;
  }
  return null;
}

