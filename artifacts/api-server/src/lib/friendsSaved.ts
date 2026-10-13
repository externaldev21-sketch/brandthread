/**
 * "Saved by people you follow" on the buyer product page.
 *
 * Only people the viewer follows count, and only saves they let followers
 * see: the saver has "Show your saves" on (users.show_saves_to_followers),
 * the save is loose or in a public collection (a private collection stays
 * private), there is no block either way, and the saver's account is in good
 * standing. The viewer's own save never counts.
 */
import { and, desc, eq, ne, or, isNull, type SQL } from "drizzle-orm";
import { db, follows, savedCollections, savedItems, users } from "@workspace/db";
import { authorInGoodStanding, notBlockedWith, profilesById, type ProfileSummary } from "./safety";

/** Most people the "who" sheet lists; the count above it is always exact. */
export const FRIENDS_SAVED_LIST_MAX = 50;

export function friendsSavedCondition(viewerId: string, productId: string): SQL {
  return and(
    eq(savedItems.itemType, "product"),
    eq(savedItems.targetId, productId),
    ne(savedItems.userId, viewerId),
    eq(users.showSavesToFollowers, true),
    or(isNull(savedItems.collectionId), eq(savedCollections.isPublic, true)),
    notBlockedWith(viewerId, savedItems.userId),
    authorInGoodStanding(savedItems.userId),
  )!;
}

export interface FriendsSaved {
  count: number;
  people: Pick<ProfileSummary, "userId" | "name" | "handle" | "initials" | "avatarUrl">[];
}

export async function friendsWhoSaved(viewerId: string, productId: string): Promise<FriendsSaved> {
  const rows = await db
    .select({ userId: savedItems.userId })
    .from(savedItems)
    .innerJoin(follows, and(eq(follows.followingId, savedItems.userId), eq(follows.followerId, viewerId)))
    .innerJoin(users, eq(users.clerkId, savedItems.userId))
    .leftJoin(savedCollections, eq(savedCollections.id, savedItems.collectionId))
    .where(friendsSavedCondition(viewerId, productId))
    .orderBy(desc(savedItems.createdAt));
  return shapeFriendsSaved(rows.map((r) => r.userId), await profilesById(rows.slice(0, FRIENDS_SAVED_LIST_MAX).map((r) => r.userId)));
}

/** Pure: newest-first saver ids + their profiles → the API response (exported for tests). */
export function shapeFriendsSaved(saverIds: string[], profiles: Map<string, ProfileSummary>): FriendsSaved {
  const unique = [...new Set(saverIds)];
  const people = unique
    .slice(0, FRIENDS_SAVED_LIST_MAX)
    .map((id) => profiles.get(id))
    .filter((p): p is ProfileSummary => !!p && !p.suspended && !p.deleted)
    .map(({ userId, name, handle, initials, avatarUrl }) => ({ userId, name, handle, initials, avatarUrl }));
  return { count: unique.length, people };
}
