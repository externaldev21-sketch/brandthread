/**
 * Close Friends list (server-backed).
 *
 * GET /api/social/close-friends              — my list, with display profiles
 * PUT /api/social/close-friends              — replace the whole list { userIds: string[] }
 *                                              ({ friendIds } is accepted too, see closeFriendsRules)
 * GET /api/social/close-friends/suggestions  — sellers only: top buyers by spend
 *
 * A Close Friends story (POST /stories with privacy.closeFriendsOnly) is only
 * returned to its author and to the people on this list; see lib/storyAccess.ts.
 * The list can only hold people in my follow graph (they follow me, or I follow
 * them) or — for sellers — buyers with a paid order from me, never myself,
 * never anyone blocked either way, never a deleted or suspended account.
 * The rules live in lib/closeFriendsRules.ts.
 */
import { Router } from "express";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db, closeFriends, follows, orders, users } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { blockedUserIds, profilesById } from "../lib/safety";
import {
  allowedCloseFriendIds, closeFriendIdsFromBody, isSellerAccountType, parseSuggestionsLimit,
} from "../lib/closeFriendsRules";

export const CLOSE_FRIENDS_CAP = 500;

const router = Router();
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
  const userIds = friends.map((f) => f.userId);
  // `friendIds` mirrors `userIds` for the mobile api.closeFriends client.
  return { friends, userIds, friendIds: userIds, cap: CLOSE_FRIENDS_CAP };
}

/** Of `ids`, the buyers with a paid, non-cancelled order where `sellerId` is the seller. */
async function paidBuyerIds(sellerId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.selectDistinct({ id: orders.buyerId }).from(orders)
    .where(and(
      eq(orders.ownerId, sellerId),
      inArray(orders.buyerId, ids),
      isNotNull(orders.paidAt),
      ne(orders.status, "cancelled"),
    ));
  return new Set(rows.map((r) => r.id).filter((id): id is string => !!id));
}

// GET /api/social/close-friends/suggestions?limit=25
// "Suggested: your top buyers" — the seller's customers ranked by spend (same
// ranking as GET /api/analytics/customers), limited to buyers with an account
// and a paid order, minus anyone blocked either way, already on the list,
// deleted or suspended.
router.get("/close-friends/suggestions", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const [me] = await db.select({ accountType: users.accountType }).from(users)
    .where(eq(users.clerkId, myId)).limit(1);
  if (!isSellerAccountType(me?.accountType)) {
    res.status(403).json({ error: "Sellers only.", code: "SELLER_ONLY" }); return;
  }
  const limit = parseSuggestionsLimit(req.query.limit);
  try {
    const result = await db.execute(sql`
      SELECT
        o.buyer_id,
        COUNT(o.id)::int                     AS order_count,
        COALESCE(SUM(o.total_cents), 0)::int AS total_cents,
        MAX(o.created_at)                    AS last_order_at
      FROM orders o
      JOIN users u ON u.clerk_id = o.buyer_id
      WHERE o.owner_id = ${myId}
        AND o.buyer_id IS NOT NULL
        AND o.buyer_id <> ${myId}
        AND o.status != 'cancelled'
        AND o.paid_at IS NOT NULL
        AND u.deleted_at IS NULL
        AND u.deletion_requested_at IS NULL
        AND u.suspended_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = ${myId} AND b.blocked_id = o.buyer_id)
             OR (b.blocker_id = o.buyer_id AND b.blocked_id = ${myId})
        )
        AND NOT EXISTS (
          SELECT 1 FROM close_friends cf
          WHERE cf.owner_id = ${myId} AND cf.friend_id = o.buyer_id
        )
      GROUP BY o.buyer_id
      ORDER BY total_cents DESC, last_order_at DESC
      LIMIT ${limit}
    `);
    const rows = result.rows as Array<{ buyer_id: string; order_count: number; total_cents: number }>;
    const ids = rows.map((r) => r.buyer_id);
    const [profiles, followers] = await Promise.all([
      profilesById(ids),
      ids.length
        ? db.select({ id: follows.followerId }).from(follows)
          .where(and(eq(follows.followingId, myId), inArray(follows.followerId, ids)))
        : Promise.resolve([] as Array<{ id: string }>),
    ]);
    const followsMe = new Set(followers.map((r) => r.id));
    const suggestions = rows
      .map((r) => {
        const p = profiles.get(r.buyer_id);
        if (!p || p.deleted || p.suspended) return null;
        return {
          userId: r.buyer_id, name: p.name, handle: p.handle, initials: p.initials, avatarUrl: p.avatarUrl,
          orderCount: Number(r.order_count) || 0, totalCents: Number(r.total_cents) || 0,
          followsYou: followsMe.has(r.buyer_id),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
    res.json({ suggestions });
  } catch (err) {
    (req as any).log?.error?.({ err }, "Failed to load close friends suggestions");
    res.status(500).json({ error: "Failed to load suggestions" });
  }
});

router.get("/close-friends", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  res.json(await listFor(myId));
});

router.put("/close-friends", async (req, res) => {
  const myId = (req as any).clerkUserId as string;
  const raw = closeFriendIdsFromBody(req.body);
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string" || !v || v.length > 200)) {
    res.status(400).json({ error: "userIds must be an array of user ids", code: "VALIDATION_ERROR" }); return;
  }
  const requested = [...new Set(raw as string[])].filter((id) => id !== myId);
  if (requested.length > CLOSE_FRIENDS_CAP) {
    res.status(400).json({ error: `Close Friends is limited to ${CLOSE_FRIENDS_CAP} people`, code: "CLOSE_FRIENDS_LIMIT" }); return;
  }

  let allowed: string[] = [];
  if (requested.length) {
    const [followers, following, blocked, profiles, paidBuyers] = await Promise.all([
      db.select({ id: follows.followerId }).from(follows)
        .where(and(eq(follows.followingId, myId), inArray(follows.followerId, requested))),
      db.select({ id: follows.followingId }).from(follows)
        .where(and(eq(follows.followerId, myId), inArray(follows.followingId, requested))),
      blockedUserIds(myId),
      profilesById(requested),
      // Sellers may add a top buyer (paid order from me) who doesn't follow them.
      paidBuyerIds(myId, requested),
    ]);
    const followGraph = new Set([...followers.map((r) => r.id), ...following.map((r) => r.id)]);
    allowed = allowedCloseFriendIds({ myId, requested, followGraph, paidBuyers, blocked, profiles });
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

  const rejected = requested.filter((id) => !allowed.includes(id));
  // `ok` / `skipped` mirror `rejected` for the mobile api.closeFriends client.
  res.json({ ok: true, ...(await listFor(myId)), rejected, skipped: rejected });
});

export default router;
