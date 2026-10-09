/**
 * Private-account follow requests + Close Friends.
 *
 * GET    /api/social/follow-requests                   — incoming requests (paginated)
 * POST   /api/social/follow-requests/:userId/approve   — confirm (creates the follows row)
 * POST   /api/social/follow-requests/:userId/decline   — delete
 * GET    /api/social/close-friends                     — my close friends
 * PUT    /api/social/close-friends                     — full replace { friendIds: string[] } (max 500)
 *
 * Requesting / cancelling a request lives on POST / DELETE /api/social/follow.
 */
import { Router } from "express";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, users, follows, followRequests, closeFriends, blocks, notificationsFeed } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { rateLimit } from "../middlewares/rateLimit";
import { publishNotification } from "./notifications-feed";
import { finishListPage, parseListPage, parsePagination, setPaginationHeaders } from "../lib/pagination";
import { actorFieldsFromProfile } from "../lib/activityEvents";
import { profilesById } from "../lib/safety";
import { promotePendingRequestsOnFollow } from "../lib/conversationRouting";
import { CLOSE_FRIENDS_MAX, normalizeCloseFriendIds, relationshipLockKey } from "../lib/privateAccount";

const router = Router();
router.use(requireAuth);

function personFields(row: {
  clerkId: string; name: string | null; displayName: string | null; username: string | null;
  profileImageUrl: string | null; avatarUrl: string | null;
}) {
  const name = row.displayName || row.name || "Unknown";
  return {
    userId: row.clerkId,
    name,
    username: row.username ?? null,
    handle: row.username ? `@${row.username}` : `@${name.toLowerCase().replace(/\s+/g, "")}`,
    avatarUrl: (typeof row.profileImageUrl === "string" && row.profileImageUrl.startsWith("http")
      ? row.profileImageUrl : row.avatarUrl) ?? null,
  };
}

const personColumns = {
  clerkId: users.clerkId, name: users.name, displayName: users.displayName, username: users.username,
  profileImageUrl: users.profileImageUrl, avatarUrl: users.avatarUrl,
};

// ─── GET /follow-requests ────────────────────────────────────────────────────
router.get("/follow-requests", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const page = parsePagination(req.query, { limit: 50 });
  if (!page.success) { res.status(400).json({ error: "Invalid pagination", code: "VALIDATION_ERROR" }); return; }
  const { limit, offset } = page.data;
  const rows = await db
    .select({ ...personColumns, requestedAt: followRequests.createdAt })
    .from(followRequests)
    .innerJoin(users, eq(users.clerkId, followRequests.requesterId))
    .where(and(
      eq(followRequests.targetId, myId),
      sql`${users.suspendedAt} IS NULL AND ${users.deletedAt} IS NULL`,
      sql`NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ${myId} AND b.blocked_id = ${followRequests.requesterId})
           OR (b.blocker_id = ${followRequests.requesterId} AND b.blocked_id = ${myId})
      )`,
    ))
    .orderBy(desc(followRequests.createdAt))
    .limit(limit).offset(offset);
  setPaginationHeaders(res, page.data, rows.length);
  res.json(rows.map((r) => ({ ...personFields(r), requestedAt: r.requestedAt })));
});

// ─── POST /follow-requests/:userId/approve | decline ─────────────────────────
async function resolveRequest(req: any, res: any, action: "approve" | "decline") {
  const myId = req.clerkUserId as string;
  const requesterId = String(req.params.userId ?? "");
  if (!requesterId || requesterId === myId) { res.status(400).json({ error: "Invalid user" }); return; }

  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${relationshipLockKey(myId, requesterId)}, 0))
    `);
    const removed = await tx.delete(followRequests)
      .where(and(eq(followRequests.requesterId, requesterId), eq(followRequests.targetId, myId)))
      .returning();
    if (removed.length === 0) return { found: false as const };
    // The request notification is resolved either way.
    await tx.delete(notificationsFeed).where(and(
      eq(notificationsFeed.userId, myId),
      eq(notificationsFeed.type, "follow_request"),
      eq(notificationsFeed.actorId, requesterId),
    ));
    if (action === "decline") return { found: true as const, approved: false as const };

    const [blockRow] = await tx.select({ b: blocks.blockerId }).from(blocks).where(or(
      and(eq(blocks.blockerId, myId), eq(blocks.blockedId, requesterId)),
      and(eq(blocks.blockerId, requesterId), eq(blocks.blockedId, myId)),
    )).limit(1);
    if (blockRow) return { found: false as const };

    const inserted = await tx.insert(follows)
      .values({ followerId: requesterId, followingId: myId })
      .onConflictDoNothing()
      .returning();
    return { found: true as const, approved: true as const, inserted };
  });

  if (!result.found) { res.status(404).json({ error: "Follow request not found" }); return; }
  if (result.approved && result.inserted.length > 0) {
    promotePendingRequestsOnFollow(requesterId, myId).catch(() => { /* non-critical */ });
    (async () => {
      try {
        const profile = (await profilesById([myId])).get(myId);
        if (profile && !profile.deleted && !profile.suspended) {
          await publishNotification({
            userId: requesterId,
            category: "social",
            type: "follow_request_accepted",
            title: `${actorFieldsFromProfile(profile).actorName} accepted your follow request`,
            ...actorFieldsFromProfile(profile),
            targetId: myId,
            targetType: "user",
          });
        }
      } catch { /* non-critical */ }
    })();
  }
  res.json({ ok: true, status: action === "approve" ? "approved" : "declined" });
}

router.post("/follow-requests/:userId/approve", rateLimit("follow"), (req, res) => resolveRequest(req, res, "approve"));
router.post("/follow-requests/:userId/decline", rateLimit("follow"), (req, res) => resolveRequest(req, res, "decline"));

// ─── Close friends ───────────────────────────────────────────────────────────
router.get("/close-friends", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  // Opt-in ?limit=&offset=. PUT is a full replace built from this list, so
  // the no-params cap must cover the whole list (CLOSE_FRIENDS_MAX).
  const page = parseListPage(req.query, { defaultLimit: CLOSE_FRIENDS_MAX, maxLimit: CLOSE_FRIENDS_MAX });
  const fetched = await db
    .select({ ...personColumns, addedAt: closeFriends.createdAt })
    .from(closeFriends)
    .innerJoin(users, eq(users.clerkId, closeFriends.friendId))
    .where(and(
      eq(closeFriends.userId, myId),
      sql`${users.suspendedAt} IS NULL AND ${users.deletedAt} IS NULL`,
      sql`NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ${myId} AND b.blocked_id = ${closeFriends.friendId})
           OR (b.blocker_id = ${closeFriends.friendId} AND b.blocked_id = ${myId})
      )`,
    ))
    .orderBy(asc(closeFriends.createdAt), asc(closeFriends.friendId))
    .limit(page.limit + 1)
    .offset(page.offset);
  const rows = finishListPage(res, page, fetched);
  const friends = rows.map((r) => ({ ...personFields(r), addedAt: r.addedAt }));
  res.json({ friendIds: friends.map((f) => f.userId), friends });
});

router.put("/close-friends", rateLimit("follow"), async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const ids = normalizeCloseFriendIds((req.body as any)?.friendIds, myId);
  if (!ids) {
    res.status(400).json({
      error: `friendIds must be an array of at most ${CLOSE_FRIENDS_MAX} user ids`,
      code: "VALIDATION_ERROR",
    });
    return;
  }

  let valid: string[] = [];
  let skipped: string[] = [];
  if (ids.length > 0) {
    const existing = await db.select({ clerkId: users.clerkId }).from(users)
      .where(and(inArray(users.clerkId, ids), sql`${users.deletedAt} IS NULL`));
    const existingSet = new Set(existing.map((r) => r.clerkId));
    const unknown = ids.filter((id) => !existingSet.has(id));
    if (unknown.length > 0) {
      res.status(400).json({ error: "Some users do not exist", code: "INVALID_FRIENDS", invalid: unknown });
      return;
    }
    const blockRows = await db.select({ a: blocks.blockerId, b: blocks.blockedId }).from(blocks)
      .where(or(eq(blocks.blockerId, myId), eq(blocks.blockedId, myId)));
    const blockedSet = new Set(blockRows.map((r) => (r.a === myId ? r.b : r.a)));
    valid = ids.filter((id) => !blockedSet.has(id));
    skipped = ids.filter((id) => blockedSet.has(id));
  }

  await db.transaction(async (tx) => {
    await tx.delete(closeFriends).where(eq(closeFriends.userId, myId));
    if (valid.length > 0) {
      await tx.insert(closeFriends)
        .values(valid.map((friendId) => ({ userId: myId, friendId })))
        .onConflictDoNothing();
    }
  });
  res.json({ ok: true, friendIds: valid, skipped });
});

export default router;
