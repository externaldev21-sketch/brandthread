import { and, eq, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { db, users, follows, closeFriends } from "@workspace/db";

/**
 * Private accounts (buyers only). A private owner's content (posts, tagged
 * tab, follower/following lists, stories) is visible to: the owner, anyone
 * who follows them (an approved follow request), and platform admins.
 * Everyone else sees only header data (name, avatar, counts). Blocks apply
 * before this check (a blocked pair never sees content either way).
 */
export interface ContentVisibilityInput {
  viewerId: string | null | undefined;
  ownerId: string;
  ownerIsPrivate: boolean;
  viewerFollowsOwner: boolean;
  viewerIsAdmin?: boolean;
  blocked?: boolean;
}

export function canViewerSeeProfileContent(input: ContentVisibilityInput): boolean {
  if (input.blocked) return false;
  if (input.viewerId && input.viewerId === input.ownerId) return true;
  if (!input.ownerIsPrivate) return true;
  if (input.viewerIsAdmin) return true;
  return !!input.viewerId && input.viewerFollowsOwner;
}

/** Stable per-pair key for pg_advisory_xact_lock (same shape as routes/social.ts). */
export function relationshipLockKey(a: string, b: string): string {
  return JSON.stringify([a, b].sort());
}

/** Async convenience: loads the owner's flag + the viewer's follow edge. */
export async function viewerCanSeeContent(viewerId: string | null | undefined, ownerId: string): Promise<boolean> {
  if (viewerId && viewerId === ownerId) return true;
  const [owner] = await db.select({ isPrivate: users.isPrivate }).from(users)
    .where(eq(users.clerkId, ownerId)).limit(1);
  if (!owner?.isPrivate) return true;
  if (!viewerId) return false;
  const [edge] = await db.select({ f: follows.followerId }).from(follows)
    .where(and(eq(follows.followerId, viewerId), eq(follows.followingId, ownerId))).limit(1);
  return canViewerSeeProfileContent({
    viewerId, ownerId, ownerIsPrivate: true, viewerFollowsOwner: !!edge,
  });
}

/**
 * SQL predicate: the author in `authorColumn` is not private, or is the
 * viewer, or the viewer follows them. Signed-out viewers (null) only see
 * non-private authors. Shared by every post feed/search/discover query.
 */
export function privateAuthorVisibleTo(viewerId: string | null | undefined, authorColumn: SQLWrapper): SQL {
  if (!viewerId) {
    return sql`NOT EXISTS (
      SELECT 1 FROM users pa WHERE pa.clerk_id = ${authorColumn} AND pa.is_private = TRUE
    )`;
  }
  return sql`(
    ${authorColumn} = ${viewerId}
    OR NOT EXISTS (
      SELECT 1 FROM users pa WHERE pa.clerk_id = ${authorColumn} AND pa.is_private = TRUE
    )
    OR EXISTS (
      SELECT 1 FROM follows pf WHERE pf.follower_id = ${viewerId} AND pf.following_id = ${authorColumn}
    )
  )`;
}

/** True when `viewerId` is on `ownerId`'s Close Friends list (story gating later). */
export async function isCloseFriendOf(ownerId: string, viewerId: string): Promise<boolean> {
  if (ownerId === viewerId) return true;
  const [row] = await db.select({ f: closeFriends.friendId }).from(closeFriends)
    .where(and(eq(closeFriends.ownerId, ownerId), eq(closeFriends.friendId, viewerId))).limit(1);
  return !!row;
}

/** SQL predicate form: viewer is a close friend of the row's author (or the author). */
export function closeFriendOfAuthor(viewerId: string, authorColumn: SQLWrapper): SQL {
  return sql`(${authorColumn} = ${viewerId} OR EXISTS (
    SELECT 1 FROM close_friends cf WHERE cf.owner_id = ${authorColumn} AND cf.friend_id = ${viewerId}
  ))`;
}

export const CLOSE_FRIENDS_MAX = 500;

/** Normalise a PUT body: dedupe, drop the owner; null if invalid or over the cap. */
export function normalizeCloseFriendIds(input: unknown, ownerId: string): string[] | null {
  if (!Array.isArray(input)) return null;
  const out = new Set<string>();
  for (const v of input) {
    if (typeof v !== "string" || !v.trim() || v.length > 200) return null;
    if (v !== ownerId) out.add(v);
  }
  return out.size > CLOSE_FRIENDS_MAX ? null : [...out];
}

/**
 * Toggle a buyer's private flag (PATCH /api/auth/privacy). Sellers/brands can
 * never go private. Private -> public auto-approves every pending follow
 * request (minus blocked pairs) and clears the queue in the same transaction
 * as the flag change. `updates` carries any other privacy columns to write
 * with it. Returns "forbidden" | "opened" (row written) | "applied" (caller
 * should run its normal update with `updates`, which now includes isPrivate).
 */
export async function applyPrivateAccountToggle(
  clerkUserId: string,
  isPrivate: boolean,
  updates: Record<string, any>,
): Promise<
  | { status: "forbidden" }
  | { status: "opened"; row: { dmPrivacy: string; isPrivate: boolean } | undefined }
  | { status: "applied" }
> {
  const [me] = await db.select({ accountType: users.accountType, isPrivate: users.isPrivate })
    .from(users).where(eq(users.clerkId, clerkUserId)).limit(1);
  if (isPrivate && me?.accountType !== "buyer") return { status: "forbidden" };
  updates.isPrivate = isPrivate;
  if (isPrivate || !me?.isPrivate) return { status: "applied" };

  const [row] = await db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO follows (follower_id, following_id)
      SELECT fr.requester_id, fr.target_id FROM follow_requests fr
      WHERE fr.target_id = ${clerkUserId}
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = fr.requester_id AND b.blocked_id = fr.target_id)
             OR (b.blocker_id = fr.target_id AND b.blocked_id = fr.requester_id)
        )
      ON CONFLICT DO NOTHING
    `);
    await tx.execute(sql`DELETE FROM follow_requests WHERE target_id = ${clerkUserId}`);
    return tx.update(users).set(updates).where(eq(users.clerkId, clerkUserId))
      .returning({ dmPrivacy: users.dmPrivacy, isPrivate: users.isPrivate });
  });
  return { status: "opened", row };
}
