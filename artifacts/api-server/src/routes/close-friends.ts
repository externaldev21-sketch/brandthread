/**
 * Close Friends list (server-backed).
 *
 * GET /api/social/close-friends  — my list, with display profiles
 * PUT /api/social/close-friends  — replace the whole list { userIds: string[] }
 *
 * A Close Friends story (POST /stories with privacy.closeFriendsOnly) is only
 * returned to its author and to the people on this list; see lib/storyAccess.ts.
 * The list can only hold people in my follow graph (they follow me, or I follow
 * them), never myself, never anyone blocked either way, never a deleted or
 * suspended account.
 */
import { Router } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, closeFriends, follows } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { blockedUserIds, profilesById } from "../lib/safety";
import { cappedList, looseBody, validateBody } from "../middlewares/bodySchemas";

export const CLOSE_FRIENDS_CAP = 500;

const router = Router();

// Shape + size guard; the handler keeps its own per-item and cap checks.
const closeFriendsBody = looseBody({ userIds: cappedList(2_000, 200) });
router.use(requireAuth);

async function listFor(userId: string) {
  const rows = await db.select({ friendId: closeFriends.friendId, createdAt: closeFriends.createdAt })
    .from(closeFriends).where(eq(closeFriends.userId, userId));
  const profiles = await profilesById(rows.map((r) => r.friendId));
  const blocked = await blockedUserIds(userId);
  const friends = rows
    .filter((r) => !blocked.has(r.friendId))
    .map((r) => {
      const p = profiles.get(r.friendId);
      return p && !p.deleted && !p.suspended
        ? { userId: r.friendId, name: p.name, handle: p.handle, initials: p.initials, avatarUrl: p.avatarUrl, addedAt: new Date(r.createdAt).getTime() }
        : null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { friends, userIds: friends.map((f) => f.userId), cap: CLOSE_FRIENDS_CAP };
}

router.get("/close-friends", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  res.json(await listFor(myId));
});

router.put("/close-friends", validateBody(closeFriendsBody), async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const raw = (req.body as { userIds?: unknown })?.userIds;
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || !v || v.length > 200)) {
    res.status(400).json({ error: "userIds must be an array of user ids", code: "VALIDATION_ERROR" }); return;
  }
  const requested = [...new Set(raw as string[])].filter((id) => id !== myId);
  if (requested.length > CLOSE_FRIENDS_CAP) {
    res.status(400).json({ error: `Close Friends is limited to ${CLOSE_FRIENDS_CAP} people`, code: "CLOSE_FRIENDS_LIMIT" }); return;
  }

  let allowed: string[] = [];
  if (requested.length) {
    const [followers, following, blocked, profiles] = await Promise.all([
      db.select({ id: follows.followerId }).from(follows)
        .where(and(eq(follows.followingId, myId), inArray(follows.followerId, requested))),
      db.select({ id: follows.followingId }).from(follows)
        .where(and(eq(follows.followerId, myId), inArray(follows.followingId, requested))),
      blockedUserIds(myId),
      profilesById(requested),
    ]);
    const graph = new Set([...followers.map((r) => r.id), ...following.map((r) => r.id)]);
    allowed = requested.filter((id) => {
      const p = profiles.get(id);
      return graph.has(id) && !blocked.has(id) && !!p && !p.deleted && !p.suspended;
    });
  }

  await db.transaction(async (tx) => {
    const current = await tx.select({ id: closeFriends.friendId }).from(closeFriends)
      .where(eq(closeFriends.userId, myId));
    const keep = new Set(allowed);
    const drop = current.map((r) => r.id).filter((id) => !keep.has(id));
    if (drop.length) {
      await tx.delete(closeFriends).where(and(eq(closeFriends.userId, myId), inArray(closeFriends.friendId, drop)));
    }
    if (allowed.length) {
      await tx.insert(closeFriends).values(allowed.map((friendId) => ({ userId: myId, friendId }))).onConflictDoNothing();
    }
  });

  res.json({ ...(await listFor(myId)), rejected: requested.filter((id) => !allowed.includes(id)) });
});

export default router;
