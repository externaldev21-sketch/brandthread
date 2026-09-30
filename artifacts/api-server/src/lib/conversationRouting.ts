/**
 * Single source of truth for "does a DM / story reply land in the
 * recipient's main inbox, or their requests?" — used everywhere a 1:1
 * conversation or its first message is created (POST /api/conversations,
 * story replies, "Message" buttons, product/post shares), so there is
 * exactly one place this policy is decided.
 *
 * Rule (buyer<->buyer, buyer<->seller, seller<->buyer, seller<->seller —
 * no role-pair exceptions):
 *   Goes to recipient R's MAIN INBOX if:
 *     - R already follows sender S, OR
 *     - R is a seller AND S has at least one real paid order from R's
 *       store, placed from S's current account.
 *   Otherwise it goes to R's REQUESTS.
 *
 * "Real paid order" excludes guest checkouts (no buyerId to match),
 * cancelled orders, and orders that were fully refunded — a charge that
 * never actually stuck, or was reversed as fraud, earns no messaging
 * trust. It does NOT require delivery: the buyer already trusted the
 * seller with money the moment payment cleared.
 *
 * Existing conversations are never re-evaluated by this module except via
 * the explicit auto-promote hooks below (follow-back, new paid order) —
 * there is deliberately no bulk migration of past conversations.
 */
import { db, orders, follows, conversations } from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";

export async function isFollowedBy(followerId: string, targetId: string): Promise<boolean> {
  const [row] = await db
    .select({ followerId: follows.followerId })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, targetId)))
    .limit(1);
  return !!row;
}

/** Has `buyerId` ever placed a real (non-cancelled, not fully refunded) paid
 *  order with seller `sellerId`, on this exact Clerk account? A different
 *  account belonging to the same person is a different `buyerId` and will
 *  never match here — that scoping is inherent, not extra logic. */
export async function hasRealPaidOrderWith(buyerId: string, sellerId: string): Promise<boolean> {
  if (!buyerId) return false; // guest checkouts have no buyerId to match
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(
      eq(orders.buyerId, buyerId),
      eq(orders.ownerId, sellerId),
      sql`${orders.paidAt} IS NOT NULL`,
      ne(orders.status, "cancelled"),
      // Not fully refunded — a partial refund (e.g. one damaged item in a
      // multi-item order) still counts as real messaging trust.
      sql`${orders.refundedCents} < ${orders.totalCents}`,
    ))
    .limit(1);
  return !!row;
}

/** True => send to recipient's Requests. False => recipient's main inbox. */
export async function shouldRouteToRequests(
  recipientId: string,
  senderId: string,
  recipientAccountType: string | null | undefined,
): Promise<boolean> {
  const recipientFollowsSender = await isFollowedBy(recipientId, senderId);
  if (recipientFollowsSender) return false;
  if (recipientAccountType === "seller") {
    const hasOrder = await hasRealPaidOrderWith(senderId, recipientId);
    if (hasOrder) return false;
  }
  return true;
}

/** Rule 4: a pending request auto-moves to the main inbox the moment the
 *  condition that would have kept it out of Requests becomes true. Never
 *  touches a conversation that isn't currently a pending request, and never
 *  re-sorts an already-accepted conversation. */
async function promotePendingRequests(recipientId: string, senderId: string): Promise<void> {
  await db
    .update(conversations)
    .set({ isRequest: false, requestedBy: null })
    .where(and(
      eq(conversations.isRequest, true),
      eq(conversations.requestedBy, senderId),
      sql`EXISTS (
        SELECT 1 FROM conversation_participants cp
        WHERE cp.conversation_id = ${conversations.id} AND cp.user_id = ${recipientId}
      )`,
    ));
}

/** Call after a follow succeeds: `follower` now follows `target`. Any
 *  pending request `target` sent to `follower` (still awaiting acceptance)
 *  moves to `follower`'s main inbox — `follower` following back is exactly
 *  the condition that would have routed it there in the first place. */
export async function promotePendingRequestsOnFollow(follower: string, target: string): Promise<void> {
  await promotePendingRequests(follower, target);
}

/** Call after a real paid order is recorded: `buyerId` paid `sellerId`. Any
 *  pending request `buyerId` sent to `sellerId` (still sitting in the
 *  seller's Requests, awaiting the seller's acceptance) moves to the
 *  seller's main inbox — the buyer having a real order with that seller is
 *  exactly the condition that would have routed the request there in the
 *  first place. (The reverse direction — seller messages a buyer who hasn't
 *  ordered — isn't touched here: the order clause only ever applies when
 *  the recipient is a seller, never a buyer.) */
export async function promotePendingRequestsOnOrder(buyerId: string | null | undefined, sellerId: string): Promise<void> {
  if (!buyerId) return;
  await promotePendingRequests(sellerId, buyerId);
}
