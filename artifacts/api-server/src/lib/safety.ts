/**
 * Shared trust & safety helpers: block visibility, account standing, muted
 * words, and the automatic-filter moderation queue.
 *
 * Block semantics (both directions): if A blocks B, neither sees the other's
 * profile, posts, comments, stories or search results, and neither can message
 * or comment on the other. Only the blocker can undo it.
 */
import type { Request } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, inArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { blocks, db, mutedWords, reports, users } from "@workspace/db";
import type { ModerationCategory } from "./contentModerator";

/** Signed-in viewer on routes that also serve signed-out visitors. */
export function optionalViewerId(req: Request): string | null {
  const fromMiddleware = (req as any).clerkUserId as string | undefined;
  if (fromMiddleware) return fromMiddleware;
  try {
    return getAuth(req).userId ?? null;
  } catch {
    return null;
  }
}

/**
 * SQL predicate: no block exists in either direction between `viewerId` and
 * the user in `authorColumn`. Returns undefined for signed-out viewers so it
 * can be passed straight into drizzle's `and(...)`.
 */
export function notBlockedWith(viewerId: string | null | undefined, authorColumn: SQLWrapper): SQL | undefined {
  if (!viewerId) return undefined;
  return sql`NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = ${viewerId} AND b.blocked_id = ${authorColumn})
       OR (b.blocker_id = ${authorColumn} AND b.blocked_id = ${viewerId})
  )`;
}

/** SQL predicate: the user in `authorColumn` is not suspended or deleted. */
export function authorInGoodStanding(authorColumn: SQLWrapper): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM users su
    WHERE su.clerk_id = ${authorColumn}
      AND (su.suspended_at IS NOT NULL OR su.deleted_at IS NOT NULL)
  )`;
}

/** Every user with a block relationship to `viewerId`, in either direction. */
export async function blockedUserIds(viewerId: string | null | undefined): Promise<Set<string>> {
  if (!viewerId) return new Set();
  const rows = await db
    .select({ blockerId: blocks.blockerId, blockedId: blocks.blockedId })
    .from(blocks)
    .where(or(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, viewerId)));
  const ids = new Set<string>();
  for (const row of rows) ids.add(row.blockerId === viewerId ? row.blockedId : row.blockerId);
  return ids;
}

export type BlockRelation = "none" | "blocked_by_me" | "blocked_me" | "mutual";

export async function blockRelation(viewerId: string, otherId: string): Promise<BlockRelation> {
  if (viewerId === otherId) return "none";
  const rows = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(or(
      and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, otherId)),
      and(eq(blocks.blockerId, otherId), eq(blocks.blockedId, viewerId)),
    ));
  const mine = rows.some((row) => row.blockerId === viewerId);
  const theirs = rows.some((row) => row.blockerId === otherId);
  if (mine && theirs) return "mutual";
  if (mine) return "blocked_by_me";
  if (theirs) return "blocked_me";
  return "none";
}

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  return (await blockRelation(a, b)) !== "none";
}

export interface StandingProblem {
  status: 403 | 410;
  body: { error: string; code: "ACCOUNT_SUSPENDED" | "ACCOUNT_DELETED" };
}

/**
 * Suspended or deleted accounts cannot publish anything (posts, comments,
 * stories, messages, live chat). Returns null when the account may publish.
 */
export async function publishingRestriction(userId: string): Promise<StandingProblem | null> {
  const [account] = await db
    .select({ suspendedAt: users.suspendedAt, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1);
  if (account?.deletedAt) {
    return { status: 410, body: { error: "This account has been deleted.", code: "ACCOUNT_DELETED" } };
  }
  if (account?.suspendedAt) {
    return {
      status: 403,
      body: {
        error: "Your account is suspended for violating the Community Guidelines, so you can't post, comment or message right now. Contact support@brandthread.app to appeal.",
        code: "ACCOUNT_SUSPENDED",
      },
    };
  }
  return null;
}

export async function mutedPhrasesFor(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  const rows = await db
    .select({ phrase: mutedWords.phrase })
    .from(mutedWords)
    .where(eq(mutedWords.userId, userId));
  return rows.map((row) => row.phrase);
}

export type ReportTargetType =
  | "post" | "video" | "live" | "live_comment" | "comment"
  | "story" | "product" | "profile" | "message";

/**
 * Put content held by the automatic filter into the moderation queue. Held
 * content stays hidden from everyone but its author until a moderator either
 * dismisses the flag (publishing it) or removes it.
 */
export async function enqueueAutoFilterReport(input: {
  targetType: ReportTargetType;
  targetId: string;
  ownerId: string;
  excerpt: string;
  category: ModerationCategory;
  label?: string | null;
}): Promise<void> {
  await db.insert(reports).values({
    reporterId: "system:auto-filter",
    source: "auto_filter",
    targetType: input.targetType,
    targetId: input.targetId,
    targetOwnerId: input.ownerId,
    targetLabel: input.label ?? null,
    contentExcerpt: input.excerpt.slice(0, 1000),
    reason: autoFilterReason(input.category),
    description: "Held automatically by the content filter until reviewed.",
  });
}

/** Map filter categories onto the member-facing report reasons. */
export function autoFilterReason(category: ModerationCategory): string {
  switch (category) {
    case "hate_speech": return "hate";
    case "harassment": return "violence";
    case "spam_scam": return "scam";
    case "explicit_sexual": return "nudity";
    case "abuse":
    case "profanity":
    default: return "harassment";
  }
}

/** Resolve a batch of user profiles for display. */
export async function profilesById(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map<string, ProfileSummary>();
  const rows = await db
    .select({
      clerkId: users.clerkId,
      name: users.name,
      displayName: users.displayName,
      brandName: users.brandName,
      username: users.username,
      avatarUrl: users.avatarUrl,
      profileImageUrl: users.profileImageUrl,
      accountType: users.accountType,
      suspendedAt: users.suspendedAt,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(inArray(users.clerkId, unique));
  return new Map(rows.map((row) => [row.clerkId, summarizeProfile(row)]));
}

export interface ProfileSummary {
  userId: string;
  name: string;
  handle: string;
  initials: string;
  avatarUrl: string | null;
  accountType: string | null;
  suspended: boolean;
  deleted: boolean;
}

export function summarizeProfile(row: {
  clerkId: string; name: string | null; displayName: string | null; brandName?: string | null;
  username: string | null; avatarUrl: string | null; profileImageUrl?: string | null;
  accountType: string | null; suspendedAt?: Date | null; deletedAt?: Date | null;
}): ProfileSummary {
  const name = (row.accountType === "seller" ? row.brandName : null) || row.displayName || row.name || "Brandthread member";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = (parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : name.slice(0, 2)).toUpperCase();
  return {
    userId: row.clerkId,
    name,
    handle: row.username ? `@${row.username}` : "",
    initials,
    avatarUrl: row.profileImageUrl || row.avatarUrl || null,
    accountType: row.accountType,
    suspended: !!row.suspendedAt,
    deleted: !!row.deletedAt,
  };
}
